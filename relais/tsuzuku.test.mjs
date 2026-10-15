import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import relais, { jetonDeProfil } from './worker.mjs';
import {
  CHEMIN_TSUZUKU,
  TAILLE_MAX_REPONSE,
  creerLimiteur,
  decoderTexte,
  ipEstPrivee,
  jeuDeCaracteres,
  routeTsuzuku,
  verifierAdresse,
  verifierDns,
} from './tsuzuku.mjs';

const JETON = 'jeton-de-test-tsuzuku-0123456789abcdef';
const SITE = 'https://site-exemple.fr';
const env = (plus = {}) => ({ JETON, ORIGINES_SITE: `${SITE}, http://localhost:5199`, LIMITE_TSUZUKU_MINUTE: '1000', ...plus });
const PUBLIQUE = async () => ['93.184.215.14'];

/** Faux `fetch` sortant : rend `reponse` et retient chaque appel. */
function fauxFetch(reponse = () => new Response('<p>ok</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) {
  const appels = [];
  const fn = async (url, init) => {
    appels.push({ url, init });
    return typeof reponse === 'function' ? reponse(url, init) : reponse;
  };
  fn.appels = appels;
  return fn;
}

const demande = (corps, { jeton = JETON, origine = SITE, methode = 'POST', brut } = {}) =>
  new Request(`https://relais.test${CHEMIN_TSUZUKU}`, {
    method: methode,
    headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(origine ? { Origin: origine } : {}), 'Content-Type': 'application/json' },
    body: methode === 'GET' || methode === 'OPTIONS' ? undefined : brut ?? JSON.stringify(corps),
  });

/** Appelle la route avec la vraie vérification de jeton du Worker. */
async function appeler(corps, options = {}, deps = {}, e = env()) {
  const journal = [];
  const requete = demande(corps, options);
  const { porteeDuJeton } = await import('./worker.mjs');
  const rep = await routeTsuzuku(requete, e, () => porteeDuJeton((requete.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''), e.JETON), {
    resoudre: PUBLIQUE,
    journal: l => journal.push(l),
    ...deps,
  });
  return { rep, json: await rep.json().catch(() => null), journal };
}

// ------------------------------------------------------------------ Adresses

test('refuse les IP privées sous toutes leurs formes, les noms locaux, schémas et ports interdits', () => {
  const refusees = [
    'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://0x7f.0.0.1/',
    'http://10.0.0.1/', 'http://172.16.5.4/', 'http://192.168.1.1/admin', 'http://100.64.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/', 'http://224.0.0.1/', 'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/',
    'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[64:ff9b::a00:1]/', 'http://[2002:c0a8:101::1]/',
    'http://8.8.8.8/', 'http://[2606:4700::1111]/',
    'http://localhost/', 'http://localhost./', 'http://LOCALHOST:8080/', 'http://box.local/', 'http://nas.lan/', 'http://metadata.google.internal/',
    'http://intranet/', 'http://site.test/', 'http://site.example/', 'http://service.home.arpa/', 'http://x.onion/', 'http://a.localhost/',
    'ftp://site-exemple.fr/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'gopher://site-exemple.fr/',
    'http://site-exemple.fr:22/', 'http://site-exemple.fr:6379/', 'https://site-exemple.fr:8000/', 'http://site-exemple.fr:0/',
    'http://moi:secret@site-exemple.fr/', 'https://site-exemple.fr/' + 'a'.repeat(2100), '', 'pas une adresse',
  ];
  for (const url of refusees) {
    assert.throws(() => verifierAdresse(url), err => err.statut === 400 && err.code === 'adresse', url);
  }
  assert.throws(() => verifierAdresse('https://relais-exemple.fr/sante', { hoteRelais: 'relais-exemple.fr' }), /lui-même/);
  for (const url of ['https://spa-exemple.fr/recherche?q=x', 'http://site-exemple.fr:8080/', 'https://miroir-exemple.fr:8443/a', 'https://sous.domaine-exemple.fr/']) {
    assert.equal(verifierAdresse(url).url.href.startsWith('http'), true, url);
  }
});

test('ipEstPrivee : même table que le PC (IPv4, IPv6, mappées, NAT64, 6to4)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.1.1', '::1', '::ffff:10.0.0.1', 'fe80::1', 'fd00::1', '2001:db8::1', 'pas-une-ip']) {
    assert.equal(ipEstPrivee(ip), true, ip);
  }
  for (const ip of ['93.184.215.14', '1.1.1.1', '2606:4700::1111', '::ffff:93.184.215.14']) {
    assert.equal(ipEstPrivee(ip), false, ip);
  }
});

test('DNS : un nom qui résout vers une IP privée (même une seule) est refusé ; nom introuvable ou DNS en panne aussi', async () => {
  await assert.rejects(verifierDns('prive-exemple.fr', async () => ['10.0.0.5']), err => err.code === 'dns' && err.statut === 400);
  await assert.rejects(verifierDns('mixte-exemple.fr', async () => ['93.184.215.14', '::1']), err => err.code === 'dns');
  await assert.rejects(verifierDns('absent-exemple.fr', async () => []), err => err.code === 'dns' && err.statut === 502);
  await assert.rejects(verifierDns('panne-exemple.fr', async () => Promise.reject(new Error('x'))), err => err.code === 'dns' && /impossible/.test(err.message));
  await verifierDns('public-exemple.fr', PUBLIQUE);
  // Résultat gardé 60 s : pas de nouvelle résolution.
  let n = 0;
  await verifierDns('garde-exemple.fr', async () => (n++, ['93.184.215.14']), 1000);
  await verifierDns('garde-exemple.fr', async () => (n++, ['10.0.0.1']), 2000);
  assert.equal(n, 1);
});

test('route : un nom qui résout vers le réseau local n’est jamais appelé', async () => {
  const fetch = fauxFetch();
  const { rep, json } = await appeler({ url: 'https://rebond-exemple.fr/' }, {}, { fetch, resoudre: async () => ['192.168.1.1'] });
  assert.equal(rep.status, 400);
  assert.equal(json.code, 'dns');
  assert.equal(fetch.appels.length, 0);
});

// ------------------------------------------------------------------ Jetons et rangs

test('401 sans jeton ou avec un faux ; 403 pour tout jeton de profil (ami, gestionnaire, administrateur, autre Fondateur)', async () => {
  const fetch = fauxFetch();
  assert.equal((await appeler({ url: 'https://spa-exemple.fr/' }, { jeton: '' }, { fetch })).rep.status, 401);
  assert.equal((await appeler({ url: 'https://spa-exemple.fr/' }, { jeton: 'faux-jeton-0123456789abcdef' }, { fetch })).rep.status, 401);
  for (const id of ['amilea0001', 'gestion001', 'admin00001', 'fondateur2']) {
    const { rep, json } = await appeler({ url: 'https://spa-exemple.fr/' }, { jeton: await jetonDeProfil(JETON, id) }, { fetch });
    assert.equal(rep.status, 403, id);
    assert.deepEqual(json, { erreur: 'Réservé au compte Fondateur relié au relais.', code: 'interdit' });
  }
  assert.equal(fetch.appels.length, 0);
  assert.equal((await appeler({ url: 'https://spa-exemple.fr/' }, {}, { fetch })).rep.status, 200);
});

test('méthode : POST seulement (GET 405) ; méthode sortante GET ou POST seulement', async () => {
  assert.equal((await appeler(undefined, { methode: 'GET' }, { fetch: fauxFetch() })).rep.status, 405);
  const { rep, json } = await appeler({ url: 'https://spa-exemple.fr/', method: 'DELETE' }, {}, { fetch: fauxFetch() });
  assert.equal(rep.status, 400);
  assert.equal(json.code, 'requete');
});

// ------------------------------------------------------------------ CORS

test('CORS : préliminaire OPTIONS pour l’origine du site seulement ; autre origine refusée ; no-store partout', async () => {
  const ok = await relais.fetch(new Request(`https://relais.test${CHEMIN_TSUZUKU}`, { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } }), env());
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.match(ok.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal(ok.headers.get('Vary'), 'Origin');
  const autre = await relais.fetch(new Request(`https://relais.test${CHEMIN_TSUZUKU}`, { method: 'OPTIONS', headers: { Origin: 'https://pirate-exemple.fr' } }), env());
  assert.equal(autre.status, 403);
  assert.equal(autre.headers.get('Access-Control-Allow-Origin'), null);
  // Sans ORIGINES_SITE : aucune origine de navigateur.
  const sansVar = await relais.fetch(new Request(`https://relais.test${CHEMIN_TSUZUKU}`, { method: 'OPTIONS', headers: { Origin: SITE } }), { JETON });
  assert.equal(sansVar.status, 403);

  const fetch = fauxFetch();
  const refuse = await appeler({ url: 'https://spa-exemple.fr/' }, { origine: 'https://pirate-exemple.fr' }, { fetch });
  assert.equal(refuse.rep.status, 403);
  assert.equal(refuse.json.code, 'origine');
  assert.equal(refuse.rep.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(fetch.appels.length, 0);
  const bon = await appeler({ url: 'https://spa-exemple.fr/' }, {}, { fetch });
  assert.equal(bon.rep.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(bon.rep.headers.get('Cache-Control'), 'no-store');
  assert.equal(refuse.rep.headers.get('Cache-Control'), 'no-store');
  // Les autres routes gardent leur CORS d'origine.
  const boite = await relais.fetch(new Request('https://relais.test/boite', { method: 'OPTIONS' }), env());
  assert.equal(boite.headers.get('Access-Control-Allow-Origin'), '*');
});

// ------------------------------------------------------------------ Requête sortante

test('en-têtes sortants en liste blanche, jamais de cookie ; redirect manuel', async () => {
  const fetch = fauxFetch();
  const { rep } = await appeler(
    {
      url: 'https://ajax-exemple.fr/ajax/recherche',
      method: 'POST',
      body: 'action=recherche&terme=voyage',
      headers: {
        Accept: 'text/html', 'Accept-Language': 'fr-FR', 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ajax-exemple.fr/', 'User-Agent': 'Mozilla/5.0 Test',
        'X-Requested-With': 'XMLHttpRequest', Cookie: 'session=secrete', Authorization: 'Bearer x', Origin: 'https://pirate-exemple.fr', 'X-Forwarded-For': '127.0.0.1', Host: 'localhost',
        'Accept-Encoding': 'identity', 'User-Agent\r\nX-Inject': 'a',
      },
    },
    {},
    { fetch },
  );
  assert.equal(rep.status, 200);
  const { url, init } = fetch.appels[0];
  assert.equal(url, 'https://ajax-exemple.fr/ajax/recherche');
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'action=recherche&terme=voyage');
  assert.equal(init.redirect, 'manual');
  assert.equal('credentials' in init, false, 'option inconnue des Workers : jamais passée');
  assert.deepEqual(Object.keys(init.headers).sort(), ['accept', 'accept-language', 'content-type', 'referer', 'user-agent', 'x-requested-with']);
  // Valeurs piégées écartées.
  const piege = await appeler({ url: 'https://spa-exemple.fr/', headers: { 'User-Agent': 'a\r\nCookie: x', 'X-Requested-With': 'autre', Referer: 'javascript:1' } }, {}, { fetch });
  assert.equal(piege.rep.status, 200);
  assert.deepEqual(fetch.appels[1].init.headers, {});
});

test('réponse : en-têtes filtrés, Set-Cookie jamais rendu (seulement signalé), corps UTF-8 décodé', async () => {
  const fetch = fauxFetch(
    () =>
      new Response('<p>Épisode 1 – ok</p>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': '__cf_bm=valeur-secrete; HttpOnly', server: 'nginx', 'x-interne': 'secret', 'cf-mitigated': 'challenge' },
      }),
  );
  const { json } = await appeler({ url: 'https://spa-exemple.fr/page' }, {}, { fetch });
  assert.equal(json.status, 200);
  assert.equal(json.texte, '<p>Épisode 1 – ok</p>');
  assert.equal(json.charset, 'utf-8');
  assert.equal(json.contentType, 'text/html');
  assert.equal(json.finalUrl, 'https://spa-exemple.fr/page');
  assert.equal(json.tronque, false);
  assert.deepEqual(json.headers, { 'content-type': 'text/html; charset=utf-8', server: 'nginx', 'cf-mitigated': 'challenge', 'x-tsuzuku-cookie': '1' });
  assert.equal(JSON.stringify(json).includes('valeur-secrete'), false);
});

test('jeu de caractères : ISO-8859-1 (en-tête ou <meta>) décodé côté Worker ; binaire en base64', async () => {
  const latin = Buffer.from('<ul><li>Été éternel — œuvre</li></ul>', 'latin1');
  const parEntete = await appeler({ url: 'https://latin-exemple.fr/' }, {}, { fetch: fauxFetch(() => new Response(latin, { headers: { 'content-type': 'text/html; charset=ISO-8859-1' } })) });
  assert.equal(parEntete.json.charset, 'windows-1252');
  assert.match(parEntete.json.texte, /Été éternel/);
  const meta = Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>Café</body></html>', 'latin1');
  const parMeta = await appeler({ url: 'https://latin-exemple.fr/m' }, {}, { fetch: fauxFetch(() => new Response(meta, { headers: { 'content-type': 'text/html' } })) });
  assert.match(parMeta.json.texte, /Café/);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  const binaire = await appeler({ url: 'https://img-exemple.fr/a.png' }, {}, { fetch: fauxFetch(() => new Response(png, { headers: { 'content-type': 'image/png' } })) });
  assert.equal(binaire.json.texte, undefined);
  assert.deepEqual([...Buffer.from(binaire.json.bodyBase64, 'base64')], [...png]);
  // Repli windows-1252 sans TextDecoder qui le connaisse ; jeu inconnu : rien (le site décodera le base64).
  assert.equal(decoderTexte(new Uint8Array([0x80, 0xe9]), 'windows-1252'), '€é');
  assert.equal(decoderTexte(new Uint8Array([0x41]), 'jeu-inconnu-x'), undefined);
  assert.equal(jeuDeCaracteres('', new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?>')), 'windows-1252');
});

test('redirections : la 3xx est rendue telle quelle (Location), jamais suivie par le relais', async () => {
  const fetch = fauxFetch(() => new Response('corps ignoré', { status: 301, headers: { location: 'http://192.168.1.1/admin', 'set-cookie': 'a=b' } }));
  const { json } = await appeler({ url: 'https://ancien-exemple.fr/recherche' }, {}, { fetch });
  assert.equal(fetch.appels.length, 1);
  assert.equal(json.status, 301);
  assert.equal(json.headers.location, 'http://192.168.1.1/admin');
  assert.equal(json.headers['x-tsuzuku-cookie'], '1');
  assert.equal(json.texte, '');
});

test('taille : réponse au-delà de 2 Mo tronquée et signalée ; requête trop grosse refusée (413)', async () => {
  const gros = 'a'.repeat(TAILLE_MAX_REPONSE + 50_000);
  const { json } = await appeler({ url: 'https://gros-exemple.fr/' }, {}, { fetch: fauxFetch(() => new Response(gros, { headers: { 'content-type': 'text/plain' } })) });
  assert.equal(json.tronque, true);
  assert.equal(json.headers['x-tsuzuku-tronque'], '1');
  assert.equal(json.texte.length, TAILLE_MAX_REPONSE);
  const fetch = fauxFetch();
  const requeteGrosse = await appeler(undefined, { brut: JSON.stringify({ url: 'https://spa-exemple.fr/', bourrage: 'x'.repeat(100 * 1024) }) }, { fetch });
  assert.equal(requeteGrosse.rep.status, 413);
  const corpsGros = await appeler({ url: 'https://spa-exemple.fr/', method: 'POST', body: 'x'.repeat(70 * 1024) }, {}, { fetch });
  assert.equal(corpsGros.rep.status, 413);
  const illisible = await appeler(undefined, { brut: '{pas du json' }, { fetch });
  assert.equal(illisible.rep.status, 400);
  assert.equal(fetch.appels.length, 0);
});

test('délai : au-delà, la requête est abandonnée (504), sans détail interne', async () => {
  const fetch = (url, init) =>
    new Promise((_, rejeter) => init.signal.addEventListener('abort', () => rejeter(new DOMException('aborted', 'AbortError'))));
  const { rep, json } = await appeler({ url: 'https://lent-exemple.fr/' }, {}, { fetch, delaiMs: 50 });
  assert.equal(rep.status, 504);
  assert.equal(json.code, 'delai');
});

test('erreurs uniformes : site injoignable sans fuite (ni IP, ni pile), journal sans adresse complète ni corps', async () => {
  const fetch = async () => {
    throw new Error('connect ECONNREFUSED 10.1.2.3:443 /chemin/interne');
  };
  const { rep, json, journal } = await appeler({ url: 'https://panne-site-exemple.fr/chemin/secret?cle=CLE-FICTIVE', method: 'POST', body: 'motdepasse=xyz' }, {}, { fetch });
  assert.equal(rep.status, 502);
  assert.deepEqual(json, { erreur: 'Le site est injoignable.', code: 'injoignable' });
  const ok = await appeler({ url: 'https://spa-exemple.fr/chemin/secret?cle=CLE-FICTIVE' }, {}, { fetch: fauxFetch() });
  const tout = [...journal, ...ok.journal].join('\n');
  assert.equal(/chemin|CLE-FICTIVE|motdepasse|secret/.test(tout), false, tout);
  assert.match(ok.journal[0], /^tsuzuku spa-exemple\.fr 200 \d+ms$/);
});

test('débit : au-delà de la limite par minute, 429 avec Retry-After (compteur en mémoire, pas de KV)', async () => {
  const e = env({ LIMITE_TSUZUKU_MINUTE: '3', BOITE: { get: async () => assert.fail('KV lu'), put: async () => assert.fail('KV écrit') } });
  const fetch = fauxFetch();
  for (let i = 0; i < 3; i++) assert.equal((await appeler({ url: 'https://spa-exemple.fr/' }, {}, { fetch }, e)).rep.status, 200);
  const { rep, json } = await appeler({ url: 'https://spa-exemple.fr/' }, {}, { fetch }, e);
  assert.equal(rep.status, 429);
  assert.equal(json.code, 'debit');
  assert.ok(Number(rep.headers.get('Retry-After')) >= 1);
  assert.equal(fetch.appels.length, 3);
  // Fenêtre glissante d'une minute.
  const limiteur = creerLimiteur({ limite: 2 });
  assert.equal(limiteur('x', 0).ok, true);
  assert.equal(limiteur('x', 10).ok, true);
  assert.equal(limiteur('x', 20).ok, false);
  assert.equal(limiteur('x', 60_001).ok, true);
});

test('Worker complet : la route passe par le fetch global, les autres routes ne changent pas', async () => {
  const fetchOrigine = globalThis.fetch;
  const vus = [];
  globalThis.fetch = async (url, init) => {
    vus.push(String(url));
    if (String(url).startsWith('https://cloudflare-dns.com/dns-query')) {
      const type = new URL(url).searchParams.get('type');
      return Response.json({ Status: 0, Answer: type === 'A' ? [{ type: 5, data: 'cdn-exemple.fr.' }, { type: 1, data: '93.184.215.14' }] : [] });
    }
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  };
  try {
    const rep = await relais.fetch(demande({ url: 'https://api-worker-exemple.fr/v1?q=1' }), env());
    const json = await rep.json();
    assert.equal(rep.status, 200);
    assert.equal(json.texte, '{"ok":true}');
    assert.ok(vus.some(u => u.includes('dns-query') && u.includes('api-worker-exemple.fr')), 'résolution DNS sur HTTPS avant l’appel');
    assert.ok(vus.includes('https://api-worker-exemple.fr/v1?q=1'));
    const ami = await relais.fetch(demande({ url: 'https://api-worker-exemple.fr/' }, { jeton: await jetonDeProfil(JETON, 'amilea0001') }), env());
    assert.equal(ami.status, 403);
    const sante = await relais.fetch(new Request('https://relais.test/sante', { headers: { Authorization: `Bearer ${JETON}` } }), env());
    assert.ok((await sante.json()).version >= 5);
  } finally {
    globalThis.fetch = fetchOrigine;
  }
});

test('le modèle wrangler.toml autorise l’origine du site déclarée dans src/config/site.json', () => {
  const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  const { site } = JSON.parse(readFileSync(new URL('../src/config/site.json', import.meta.url), 'utf8'));
  assert.match(toml, /^\[vars\]$/m);
  assert.equal(/ORIGINES_SITE = "([^"]+)"/.exec(toml)?.[1], site);
  assert.equal(/JETON|DISCORD/.test(toml.replace(/#.*$/gm, '')), false, 'aucun secret dans le modèle');
});

test('workflow de déploiement : à la main seulement, réservé à main, ne touche jamais au secret JETON', () => {
  const yml = readFileSync(new URL('../.github/workflows/relais.yml', import.meta.url), 'utf8');
  const actif = yml.replace(/^\s*#.*$/gm, '');
  assert.match(actif, /^on:\n\s+workflow_dispatch:\s*$/m);
  assert.equal(/\bpush:|pull_request|schedule:/.test(actif), false);
  assert.match(actif, /if: github\.ref == 'refs\/heads\/main'/);
  assert.equal(/secret\s+(put|delete|bulk)|secrets\.JETON|\bJETON\b(?!\|)/.test(actif.replace(/JETON\|DISCORD_WEBHOOK/g, '')), false);
  assert.match(actif, /wrangler@4 deploy --config relais\/wrangler\.ci\.toml/);
  assert.match(actif, /\/sante/);
});
