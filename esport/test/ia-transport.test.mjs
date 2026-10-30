/**
 * Transport des moteurs d'IA externes (esport/adaptateurs/fetchIaNode.mjs) et délais du connecteur, contre de FAUX
 * SERVEURS NVIDIA locaux (http://127.0.0.1, aucun appel réseau réel) : réponse JSON immédiate, flux SSE avec et
 * sans `[DONE]`, flux qui garde la connexion ouverte après `[DONE]`, serveur muet (premier octet), réponse commencée
 * puis bloquée (lecture), nom introuvable (DNS) ; étapes mesurées et journalisées, erreur précise, clé jamais
 * visible. Outil de diagnostic `esport/outils/tester-ia.mjs` : lecture de la config, clé masquée.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configIa, creerConnecteur } from '../noyau/ia/connecteur.mjs';
import { testerConnexion } from '../noyau/ia/assistant.mjs';
import { creerFetchIaNode } from '../adaptateurs/fetchIaNode.mjs';
import { apercuCle, lireArguments, masquer, principal as outil, requeteTest, resumerReponse } from '../outils/tester-ia.mjs';

const CLE = 'nvapi-FACTICE-transport-2222222222';
const ENV = { IA_API_URL: 'https://integrate.api.nvidia.com/v1', IA_API_CLE: 'nvapi-FACTICE-principal-0000000000', IA_MODELE: 'mistralai/mistral-large-4-1t-a52b', IA_API2_CLE: CLE, IA_MODELE2: 'openai/gpt-oss-20b' };
const JSON_OK = JSON.stringify({ choices: [{ message: { content: '{"ok": true}', reasoning_content: 'Just output JSON.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8 } });
const sse = objets => objets.map(x => `data: ${JSON.stringify(x)}\n\n`).join('');
const MORCEAUX = [{ choices: [{ delta: { reasoning_content: 'PENSEE ' } }] }, { choices: [{ delta: { content: '{"ok":' } }] }, { choices: [{ delta: { content: ' true}' }, finish_reason: 'stop' }] }];

/** Faux NVIDIA local : `traiter(req, res, corps)` ; rend { url, requetes, fermer }. */
async function fauxServeur(traiter) {
  const requetes = [];
  const sockets = new Set();
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', m => (corps += m));
    req.on('end', () => {
      requetes.push({ entetes: req.headers, corps: JSON.parse(corps || '{}') });
      traiter(req, res, corps);
    });
  });
  serveur.on('connection', s => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${serveur.address().port}/v1/chat/completions`,
    requetes,
    fermer: () =>
      new Promise(ok => {
        for (const s of sockets) s.destroy();
        serveur.close(() => ok());
      }),
  };
}

/** Connecteur « api2 » (gpt-oss) vers le faux serveur, transport Node, journal en mémoire. */
function connecteur(url, envEnPlus = {}, options = {}) {
  const lignes = [];
  const c = configIa({ ...ENV, ...envEnPlus }).secondaire;
  const cx = creerConnecteur({ ...c, url }, { fetch: creerFetchIaNode(options), journal: (t, code) => lignes.push(`${t} ${code ?? ''}`) });
  return { cx, lignes };
}

const test0 = cx => testerConnexion({ appeler: (_g, m, o) => cx.discuter(m, o), delaiMax: 5000 });

test('réponse JSON immédiate (comme curl : 0,66 s) : lue tout de suite, étapes mesurées et journalisées, effort low envoyé', async () => {
  const s = await fauxServeur((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'keep-alive', 'Keep-Alive': 'timeout=60' });
    res.end(JSON_OK);
  });
  try {
    const { cx, lignes } = connecteur(s.url);
    const t0 = Date.now();
    const r = await test0(cx);
    assert.equal(r.reponse, true);
    assert.ok(Date.now() - t0 < 2000, 'réponse sans attendre la fermeture de la connexion (keep-alive)');
    const corps = s.requetes[0].corps;
    assert.equal(corps.model, 'openai/gpt-oss-20b');
    assert.equal(corps.reasoning_effort, 'low', 'sans effort, gpt-oss raisonne longtemps : le test dépassait 90 s');
    assert.deepEqual(corps.response_format, { type: 'json_object' });
    assert.equal(corps.stream, undefined);
    assert.equal(s.requetes[0].entetes.authorization, `Bearer ${CLE}`);
    assert.equal(s.requetes[0].entetes.accept, 'application/json');
    assert.ok(lignes.some(l => /étapes : DNS .*connexion .*premier octet .*fin \d+ ms/.test(l)), lignes.join('\n'));
    assert.ok(!lignes.join('\n').includes(CLE));
  } finally {
    await s.fermer();
  }
});

test('flux SSE (IA_API2_FLUX=oui) : avec [DONE] (même si la connexion reste ouverte), sans [DONE] mais fin annoncée, coupé en route', async () => {
  let mode = 'done-ouvert';
  const s = await fauxServeur((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    if (mode === 'done-ouvert') res.write(`${sse(MORCEAUX)}data: [DONE]\n\n`); // jamais fermé : seul [DONE] dit la fin
    else if (mode === 'sans-done') res.end(sse([...MORCEAUX, { usage: { prompt_tokens: 3, completion_tokens: 4 } }]));
    else res.end(sse(MORCEAUX.slice(0, 2)));
  });
  try {
    const { cx } = connecteur(s.url, { IA_API2_FLUX: 'oui' });
    const t0 = Date.now();
    assert.equal((await test0(cx)).reponse, true);
    assert.ok(Date.now() - t0 < 2000, '[DONE] termine la lecture sans attendre la fermeture');
    assert.equal(s.requetes[0].corps.stream, true);
    assert.equal(s.requetes[0].entetes.accept, 'text/event-stream');
    mode = 'sans-done';
    const r = await cx.discuter([{ role: 'user', content: 'x' }], { premierOctet: 1000 });
    assert.equal(r.texte, '{"ok": true}');
    assert.deepEqual(r.jetons, { entree: 3, sortie: 4 });
    mode = 'coupe';
    const e = await cx.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
    assert.equal(e.code, 'ia-reponse');
    assert.match(e.message, /interrompue/);
  } finally {
    await s.fermer();
  }
});

test('flux demandé, servi sans type « event-stream » : lu quand même comme un flux', async () => {
  const s = await fauxServeur((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(`${sse(MORCEAUX)}data: [DONE]\n\n`);
  });
  try {
    const { cx } = connecteur(s.url, { IA_API2_FLUX: 'oui' });
    assert.equal((await cx.discuter([{ role: 'user', content: 'x' }])).texte, '{"ok": true}');
  } finally {
    await s.fermer();
  }
});

test('serveur muet (le modèle calcule) : délai du PREMIER OCTET, erreur précise, étapes au journal ; réponse bloquée en cours : délai de LECTURE', async () => {
  let mode = 'muet';
  const s = await fauxServeur((req, res) => {
    if (mode === 'muet') return; // ni en-têtes ni corps
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices": [');
  });
  try {
    const { cx, lignes } = connecteur(s.url);
    const t0 = Date.now();
    const e = await cx.discuter([{ role: 'user', content: 'x' }], { premierOctet: 300, delai: 5000 }).catch(x => x);
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(e.code, 'ia-delai-premier-octet');
    assert.equal(e.statut, 504);
    assert.equal(e.etape, 'premier-octet');
    assert.match(e.message, /pas commencé à répondre en 0 s|pas commencé à répondre/);
    assert.ok(Number.isFinite(e.etapes.connexionMs), 'connexion établie : mesurée');
    assert.equal(e.etapes.premierOctetMs, null);
    assert.ok(lignes.some(l => /ia-delai-premier-octet \(étape premier-octet\).*étapes : DNS/.test(l)), lignes.join('\n'));
    mode = 'bloque';
    const e2 = await cx.discuter([{ role: 'user', content: 'x' }], { delaiMax: 400 }).catch(x => x);
    assert.equal(e2.code, 'ia-delai-lecture');
    assert.ok(Number.isFinite(e2.etapes.premierOctetMs));
    assert.ok(!JSON.stringify([lignes, e.message, e2.message]).includes(CLE));
  } finally {
    await s.fermer();
  }
});

test('nom introuvable : étape DNS nommée ; port fermé : connexion refusée', async () => {
  const { cx } = connecteur('http://hote-inexistant.invalid/v1/chat/completions');
  const e = await cx.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
  assert.ok(['ia-dns', 'ia-delai-dns'].includes(e.code), e.code);
  const s = await fauxServeur(() => undefined);
  const url = s.url;
  await s.fermer();
  const e2 = await connecteur(url).cx.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
  assert.equal(e2.code, 'ia-injoignable');
  assert.equal(e2.etape, 'connexion');
  assert.equal(e2.cause, 'ECONNREFUSED');
});

test('IPv4 seulement (IA_IPV4=oui) : connexion en IPv4', async () => {
  const s = await fauxServeur((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON_OK);
  });
  try {
    const r = await creerFetchIaNode({ ipv4: true })(s.url.replace('127.0.0.1', 'localhost'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200);
    await r.text();
    assert.equal(r.etapesIa.famille, 4);
    assert.ok(Number.isFinite(r.etapesIa.finMs));
  } finally {
    await s.fermer();
  }
});

test('outil tester-ia : arguments, clé jamais affichée (longueur + 6 caractères), requête identique à celle de l’app, config lue comme l’app', async () => {
  assert.deepEqual(lireArguments(['api2', '--flux', '--ipv4']), { moteur: 'api2', flux: true, ipv4: true, effort: undefined, commeCurl: false, delaiS: 90, aide: false });
  assert.throws(() => lireArguments(['--inconnu']));
  assert.equal(apercuCle(CLE), `présente, ${CLE.length} caractères, commence par « nvapi- »`);
  assert.equal(masquer(`Incorrect key ${CLE} / Bearer ${CLE}`, CLE).includes(CLE), false);
  assert.match(resumerReponse(JSON_OK), /contenu « \{"ok": true\} », raisonnement 17 caractères/);
  assert.match(resumerReponse(`${sse(MORCEAUX)}data: [DONE]\n\n`), /\[DONE\] reçu, fin stop, contenu « \{"ok": true\} »/);
  const c = configIa(ENV).secondaire;
  const { init } = requeteTest(c);
  assert.equal(JSON.parse(init.body).reasoning_effort, 'low');
  assert.equal(JSON.parse(requeteTest(c, { effort: 'aucun' }).init.body).reasoning_effort, undefined);
  assert.equal(JSON.parse(requeteTest(c, { commeCurl: true }).init.body).temperature, undefined);
  // De bout en bout contre un faux serveur : esport.env lu par le chargeur de l'app (ligne MAIL_FROM=Nom <adresse> comprise).
  const s = await fauxServeur((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON_OK);
  });
  const dossier = mkdtempSync(join(tmpdir(), 'tester-ia-'));
  try {
    const fichier = join(dossier, 'esport.env');
    writeFileSync(fichier, `MAIL_FROM=Team Test <contact@exemple.fr>\nIA_API2_URL=https://integrate.api.nvidia.com/v1\nIA_API2_CLE=${CLE}\nIA_MODELE2=openai/gpt-oss-20b\n`);
    const sortie = [];
    const env = { ESPORT_ENV: fichier };
    // Le faux serveur remplace l'adresse NVIDIA (fetch global et node:https redirigés vers lui).
    const vers = u => String(u).replace('https://integrate.api.nvidia.com/v1/chat/completions', s.url);
    const code = await outil(['api2', '--delai', '5'], { env, ecrire: t => sortie.push(t), fetchGlobal: (u, i) => fetch(vers(u), i), transport: o => { const f = creerFetchIaNode(o); return (u, i) => f(vers(u), i); }, resoudre: false });
    const texte = sortie.join('\n');
    assert.equal(code, 0, texte);
    assert.equal(env.MAIL_FROM, 'Team Test <contact@exemple.fr>');
    assert.match(texte, /Bilan : fetch OK, node:https OK, app OK/);
    assert.match(texte, /commence par « nvapi- »/);
    assert.ok(!texte.includes(CLE), 'clé affichée');
    assert.equal(s.requetes.length, 3);
    assert.deepEqual(s.requetes[0].corps, s.requetes[2].corps, 'essai brut = requête du test de l’app');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
    await s.fermer();
  }
});
