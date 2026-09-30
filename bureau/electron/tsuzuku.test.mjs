import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  creerListeLecteurs, ipEstPrivee, lookupPublic, requeteTsuzuku, validerRequete, verifierAdresse,
} from './tsuzuku.mjs';

const refuse = (url, motif) => assert.throws(() => verifierAdresse(url), motif ?? /.*/, url);

test('la garde refuse tout ce qui n’est pas une adresse publique http(s)', () => {
  for (const url of [
    'http://localhost/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:c0a8:0001]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/', 'http://0.0.0.0/', 'http://nas.local/', 'http://imprimante.lan/', 'http://serveur/',
    'http://exemple.internal/', 'ftp://exemple.fr/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x',
    'http://user:mdp@exemple.fr/', 'http://exemple.fr:22/', 'http://exemple.fr:3000/', '', 'pas une adresse',
    `http://exemple.fr/${'a'.repeat(2100)}`,
  ]) {
    refuse(url);
  }
});

test('la garde accepte les adresses publiques usuelles', () => {
  for (const url of ['https://api.jikan.moe/v4/anime', 'http://exemple.fr/', 'https://exemple.fr:8443/x', 'http://93.184.216.34/', 'https://[2606:4700::1111]/']) {
    assert.doesNotThrow(() => verifierAdresse(url), url);
  }
  assert.equal(ipEstPrivee('8.8.8.8'), false);
  assert.equal(ipEstPrivee('10.1.2.3'), true);
  assert.equal(ipEstPrivee('n’importe quoi'), true);
});

test('le DNS est vérifié à la connexion : un nom qui résout en privé est refusé', async () => {
  const faux = adresses => (hote, opts, rappel) => rappel(null, adresses);
  const lookup = adresses => new Promise(res => lookupPublic(faux(adresses))('exemple.fr', {}, (e, a) => res({ e, a })));
  assert.match((await lookup([{ address: '192.168.0.10', family: 4 }])).e.message, /non publique/);
  assert.match((await lookup([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }])).e.message, /non publique/);
  const ok = await lookup([{ address: '93.184.216.34', family: 4 }]);
  assert.equal(ok.e, null);
});

test('valide la forme de la requête : méthode, bornes, en-têtes sans cookie', () => {
  assert.throws(() => validerRequete({ url: 'https://exemple.fr/', methode: 'DELETE' }));
  assert.throws(() => validerRequete(null));
  const v = validerRequete({
    url: 'https://exemple.fr/', methode: 'GET', delaiMs: 9e9, tailleMax: 9e12,
    entetes: { Cookie: 'x=1', Host: 'autre', 'User-Agent': 'ua', Authorization: 'Bearer z', 'X-Truc': '1', Accept: 'a\r\nb' },
  });
  assert.equal(v.delaiMs, 30000);
  assert.equal(v.tailleMax, 16 * 1024 * 1024);
  assert.deepEqual(v.entetes, { 'user-agent': 'ua', authorization: 'Bearer z' });
  assert.throws(() => validerRequete({ url: 'https://exemple.fr/', methode: 'POST', corps: 'x'.repeat(70_000) }));
});

function fauxReseau(reponse) {
  const vus = [];
  const requeter = (url, options, rappel) => {
    vus.push({ url: String(url), options });
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => { req.detruit = true; };
    req.end = () => {
      const rep = new EventEmitter();
      rep.statusCode = reponse.statut;
      rep.headers = reponse.entetes ?? {};
      rep.resume = () => {};
      rappel(rep);
      for (const m of reponse.morceaux ?? []) rep.emit('data', Buffer.from(m));
      rep.emit('end');
    };
    return req;
  };
  return { requeter, vus };
}

test('n’ouvre jamais une adresse refusée (le réseau n’est même pas sollicité)', async () => {
  const { requeter, vus } = fauxReseau({ statut: 200, morceaux: ['x'] });
  await assert.rejects(requeteTsuzuku({ url: 'http://192.168.1.1/admin', methode: 'GET' }, { requeter }));
  assert.equal(vus.length, 0);
});

test('rend le texte, retire les cookies, force identity et n’envoie pas de cookie', async () => {
  const { requeter, vus } = fauxReseau({
    statut: 200,
    entetes: { 'Content-Type': 'application/json', 'set-cookie': ['a=1'] },
    morceaux: ['{"a":', '1}'],
  });
  const r = await requeteTsuzuku({ url: 'https://exemple.fr/x', methode: 'GET', entetes: { cookie: 'secret=1', accept: 'application/json' } }, { requeter });
  assert.equal(r.statut, 200);
  assert.equal(r.corps, '{"a":1}');
  assert.equal(r.entetes['content-type'], 'application/json');
  assert.equal('set-cookie' in r.entetes, false);
  assert.equal('cookie' in vus[0].options.headers, false);
  assert.equal(vus[0].options.headers['accept-encoding'], 'identity');
  assert.equal(vus[0].options.agent, false);
  assert.equal(typeof vus[0].options.lookup, 'function');
});

test('ne suit pas les redirections : rend le 3xx et son en-tête location', async () => {
  const { requeter, vus } = fauxReseau({ statut: 302, entetes: { location: 'http://192.168.1.1/' }, morceaux: ['corps ignoré'] });
  const r = await requeteTsuzuku({ url: 'https://exemple.fr/', methode: 'GET' }, { requeter });
  assert.equal(r.statut, 302);
  assert.equal(r.entetes.location, 'http://192.168.1.1/');
  assert.equal(r.corps, '');
  assert.equal(vus.length, 1);
});

test('borne la taille de la réponse (annoncée ou reçue)', async () => {
  const annoncee = fauxReseau({ statut: 200, entetes: { 'content-length': '999999' }, morceaux: ['x'] });
  await assert.rejects(requeteTsuzuku({ url: 'https://exemple.fr/', methode: 'GET', tailleMax: 2048 }, { requeter: annoncee.requeter }), /volumineuse/);
  const recue = fauxReseau({ statut: 200, morceaux: ['a'.repeat(1500), 'a'.repeat(1500)] });
  await assert.rejects(requeteTsuzuku({ url: 'https://exemple.fr/', methode: 'GET', tailleMax: 2048 }, { requeter: recue.requeter }), /volumineuse/);
});

test('borne le délai', async () => {
  const requeter = () => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {};
    req.destroy = () => {};
    return req;
  };
  const debut = Date.now();
  await assert.rejects(requeteTsuzuku({ url: 'https://exemple.fr/', methode: 'GET', delaiMs: 1000 }, { requeter }), /Délai/);
  assert.ok(Date.now() - debut < 3000);
});

test('les lecteurs autorisés : seuls les hôtes publics déclarés passent, et ça expire', () => {
  let t = 0;
  const liste = creerListeLecteurs({ maintenant: () => t, duree: 1000, max: 2 });
  assert.equal(liste.sousCadreAutorise('https://lecteur-exemple.fr/embed/1'), false);
  assert.equal(liste.autoriser('https://lecteur-exemple.fr/embed/1'), true);
  assert.equal(liste.sousCadreAutorise('https://lecteur-exemple.fr/autre'), true);
  assert.equal(liste.sousCadreAutorise('https://autre-exemple.fr/'), false);
  assert.equal(liste.autoriser('http://192.168.1.10/lecteur'), false);
  assert.equal(liste.sousCadreAutorise('http://192.168.1.10/lecteur'), false);
  t = 2000;
  assert.equal(liste.sousCadreAutorise('https://lecteur-exemple.fr/embed/1'), false);
  liste.autoriser('https://a-exemple.fr/'); liste.autoriser('https://b-exemple.fr/'); liste.autoriser('https://c-exemple.fr/');
  assert.equal(liste.sousCadreAutorise('https://a-exemple.fr/'), false, 'le plus ancien est évincé');
  assert.equal(liste.sousCadreAutorise('https://c-exemple.fr/'), true);
});
