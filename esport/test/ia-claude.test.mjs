/**
 * Moteur « claude » (API Anthropic, SDK officiel @anthropic-ai/sdk ; docs/esport/ia-api.md) :
 *  - configuration (ANTHROPIC_API_KEY, IA_CLAUDE_MODELE[_LEGER] : claude-sonnet-5-5 par défaut, efforts) ;
 *  - forme de la requête : modèle de la tâche, output_config.effort, JAMAIS thinking / temperature / top_p / top_k
 *    ni pré-remplissage, repli côté serveur (Sonnet/Opus 5.5), format JSON structuré, flux au-delà de 16 000 jetons ;
 *  - réponse : blocs « text » seuls (réflexion ignorée), max_tokens → tronquée, refusal → moteur suivant ;
 *  - erreurs typées du SDK : 401 (clé Anthropic invalide), 429 (essais puis repli), 529 ;
 *  - ordre de repli (IA_ORDRE=claude,api2) ; tâches CONFIDENTIELLES jamais chez Claude, même levées ;
 *  - Administration IA : Claude listé (modèle, dernière erreur, dernière latence), jamais la clé.
 *
 * Le VRAI SDK est utilisé, avec un faux transport (`fetch` injecté) : AUCUN appel réseau réel.
 * Tourne sur SQLite et PostgreSQL (ESPORT_TEST_PG).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { banc } from './aide.mjs';
import { MODELE_CLAUDE_DEFAUT, configClaude, configIa, creerConnecteurClaude, creerIaDepuisEnv, creerRepartiteurIa, messagesClaude } from '../noyau/ia/connecteur.mjs';
import { TACHES_CONFIDENTIELLES } from '../noyau/ia/confidentialite.mjs';
import { creerFetchIaNode } from '../adaptateurs/fetchIaNode.mjs';

const CLE_CLAUDE = 'sk-ant-api03-FACTICE-claude-22222222222222';
const CLE2 = 'nvapi-FACTICE-secondaire-1111111111';
const ENV = {
  ANTHROPIC_API_KEY: CLE_CLAUDE,
  IA_API2_URL: 'https://integrate.api.nvidia.com/v1',
  IA_API2_CLE: CLE2,
  IA_MODELE2: 'openai/gpt-oss-20b',
  IA_CLAUDE_ESSAIS: '0',
  IA_ORDRE: 'claude,api2',
  IA_ORDRE_LEGER: 'claude,api2',
};
const msg = [{ role: 'user', content: 'Bonjour' }];

function sansCle(v, quoi = 'texte') {
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  assert.ok(!t.includes(CLE_CLAUDE) && !t.includes('sk-ant-api03') && !t.includes(CLE2), `clé trouvée dans ${quoi}`);
}

const message = (corps, { content = [{ type: 'text', text: '{"ok": true}' }], stop_reason = 'end_turn', stop_details = null } = {}) => ({
  id: 'msg_factice',
  type: 'message',
  role: 'assistant',
  model: corps.model,
  content,
  stop_reason,
  stop_details,
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 7 },
});

/**
 * Faux transport : Anthropic (api.anthropic.com) et NVIDIA (api2). `repondre(corps, n, entetes)` pour Anthropic →
 * options du message ({ content, stop_reason… }), { statut, type, entetes } (erreur), ou une Response.
 */
function fauxServeurs(repondre = () => ({})) {
  const appels = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const corps = JSON.parse(String(init.body));
    if (u.startsWith('https://integrate.api.nvidia.com/')) {
      appels.push({ moteur: 'api2', url: u, corps });
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"nvidia": true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(typeof init.headers, 'object');
    assert.ok(!(init.headers instanceof Headers), 'en-têtes en objet simple (transport Node)');
    const n = appels.filter(a => a.moteur === 'claude').length + 1;
    appels.push({ moteur: 'claude', url: u, corps, entetes: init.headers });
    const r = await repondre(corps, n, init.headers);
    if (r instanceof Response) return r;
    if (r?.statut) return new Response(JSON.stringify({ type: 'error', error: { type: r.type ?? 'api_error', message: 'erreur factice' } }), { status: r.statut, headers: { 'content-type': 'application/json', ...(r.entetes ?? {}) } });
    return new Response(JSON.stringify(message(corps, r ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_factice' } });
  };
  return { fetch, appels, claude: () => appels.filter(a => a.moteur === 'claude') };
}

const connecteur = (env, serveurs, extra = {}) => creerConnecteurClaude({ ...configClaude({ ...ENV, ...env }), ...extra }, { fetch: serveurs.fetch });

// ------------------------------------------------------------------ Configuration

test('configuration : Sonnet 5.5 par défaut (normal et léger), efforts medium / low, clé jamais visible', () => {
  const c = configClaude(ENV);
  assert.equal(MODELE_CLAUDE_DEFAUT, 'claude-sonnet-5-5');
  assert.equal(c.actif, true);
  assert.equal(c.modele, 'claude-sonnet-5-5');
  assert.equal(c.modeleLeger, 'claude-sonnet-5-5');
  assert.equal(c.effort, 'medium');
  assert.equal(c.effortLeger, 'low');
  assert.equal(c.delaiMs, 120_000);
  assert.equal(c.moteurPublic().cle, 'presente');
  sansCle(c, 'JSON de la config');
  sansCle(c.moteurPublic(), 'état public');
  // Sans clé : désactivé.
  const vide = configClaude({});
  assert.equal(vide.actif, false);
  assert.equal(vide.raison, 'cle-absente');
  assert.equal(vide.moteurPublic().cle, 'absente');
  // Modèles et efforts réglables ; valeur invalide = défaut.
  const o = configClaude({ ANTHROPIC_API_KEY: 'x', IA_CLAUDE_MODELE: 'claude-opus-5-5', IA_CLAUDE_MODELE_LEGER: 'claude-haiku-5-5', IA_CLAUDE_EFFORT: 'high' });
  assert.deepEqual([o.modele, o.modeleLeger, o.effort, o.effortLeger], ['claude-opus-5-5', 'claude-haiku-5-5', 'high', 'high']);
  const x = configClaude({ ANTHROPIC_API_KEY: 'x', IA_CLAUDE_MODELE: 'gpt-4o; rm -rf', IA_CLAUDE_EFFORT: 'enorme', IA_CLAUDE_EFFORT_LEGER: 'medium' });
  assert.deepEqual([x.modele, x.effort, x.effortLeger], ['claude-sonnet-5-5', 'medium', 'medium']);
  // Porté par la config principale (serveur : config.ia.claude).
  assert.equal(configIa(ENV).claude.modele, 'claude-sonnet-5-5');
});

test('messages : system à part, images en blocs, aucun pré-remplissage assistant', () => {
  const m = messagesClaude([
    { role: 'system', content: 'Consigne A' },
    { role: 'assistant', content: 'début orphelin' },
    { role: 'user', content: [{ type: 'text', text: 'Lis' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'image_url', image_url: { url: 'https://exemple.test/a.png' } }] },
    { role: 'assistant', content: 'Réponse' },
    { role: 'user', content: 'Encore' },
    { role: 'assistant', content: '{"' },
  ]);
  assert.equal(m.system, 'Consigne A');
  assert.deepEqual(m.messages.map(x => x.role), ['user', 'assistant', 'user']);
  assert.deepEqual(m.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
  assert.deepEqual(m.messages[0].content[2], { type: 'image', source: { type: 'url', url: 'https://exemple.test/a.png' } });
});

// ------------------------------------------------------------------ Requête

test('requête : modèle et effort de la tâche, pas de thinking / temperature / top_p / top_k, repli serveur, clé en en-tête seulement', async () => {
  const s = fauxServeurs();
  const cx = connecteur({ IA_CLAUDE_MODELE: 'claude-opus-5-5' }, s);
  const r = await cx.discuter([{ role: 'system', content: 'Tu es utile.' }, ...msg], { tache: 'brouillon', temperature: 0.7, maxJetons: 4000 });
  assert.equal(r.texte, '{"ok": true}');
  assert.deepEqual(r.jetons, { entree: 12, sortie: 7 });
  await cx.discuter(msg, { tache: 'traduction' });
  const [a, b] = s.claude();
  assert.match(a.url, /^https:\/\/api\.anthropic\.com\/v1\/messages(\?beta=true)?$/);
  assert.equal(a.corps.model, 'claude-opus-5-5');
  assert.deepEqual(a.corps.output_config, { effort: 'medium' });
  assert.equal(a.corps.max_tokens, 16_000);
  assert.match(a.corps.system, /^Tu es utile\.\n\nRéponds uniquement par un objet JSON valide/);
  assert.equal(b.corps.model, 'claude-sonnet-5-5', 'tâche légère : IA_CLAUDE_MODELE_LEGER');
  assert.deepEqual(b.corps.output_config, { effort: 'low' });
  for (const { corps, entetes } of [a, b]) {
    for (const interdit of ['thinking', 'temperature', 'top_p', 'top_k', 'betas', 'tool_choice']) assert.ok(!(interdit in corps), `${interdit} jamais envoyé`);
    assert.equal(corps.messages.at(-1).role, 'user');
    assert.equal(corps.fallbacks, 'default', 'repli côté serveur (Sonnet/Opus 5.5)');
    assert.match(entetes['anthropic-beta'], /server-side-fallback-2026-07-01/);
    // SDK 1.x : la clé d'API part dans « Authorization: Bearer » (et nulle part ailleurs).
    assert.equal(entetes.authorization, `Bearer ${CLE_CLAUDE}`);
    assert.ok(entetes['anthropic-version']);
    sansCle(corps, 'corps de la requête');
  }
  // Effort imposé (test de connexion) ; Haiku : pas de repli côté serveur.
  const h = connecteur({ IA_CLAUDE_MODELE: 'claude-haiku-5-5' }, s);
  await h.discuter(msg, { tache: 'test', effort: 'low', json: false });
  const c = s.claude().at(-1);
  assert.deepEqual([c.corps.model, c.corps.output_config.effort, 'fallbacks' in c.corps, c.entetes['anthropic-beta'] ?? null], ['claude-haiku-5-5', 'low', false, null]);
  assert.ok(!('system' in c.corps), 'json: false : pas de consigne JSON ajoutée');
});

test('format JSON structuré avec un schéma ; HTTP 400 : repli serveur puis format retirés, et retenus', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const s = fauxServeurs((corps, n) => (n <= 2 ? { statut: 400, type: 'invalid_request_error' } : {}));
  const cx = connecteur({}, s);
  const r = await cx.discuter(msg, { tache: 'brouillon', schema });
  assert.equal(r.texte, '{"ok": true}');
  const [a, b, c] = s.claude();
  assert.deepEqual(a.corps.output_config, { effort: 'medium', format: { type: 'json_schema', schema } });
  assert.equal(a.corps.fallbacks, 'default');
  assert.ok(!('fallbacks' in b.corps) && b.corps.output_config.format, '1er refus : sans le repli serveur');
  assert.deepEqual(c.corps.output_config, { effort: 'medium' }, '2e refus : sans le format');
  await cx.discuter(msg, { tache: 'brouillon', schema });
  const d = s.claude().at(-1);
  assert.ok(!('fallbacks' in d.corps) && !d.corps.output_config.format, 'retenu pour la suite');
});

test('réponse longue (maxJetons > 16 000) : flux puis finalMessage', async () => {
  const sse = corps => {
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const m = message(corps, { content: [] });
    return [
      ev('message_start', { message: { ...m, stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } }),
      ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
      ev('content_block_stop', { index: 0 }),
      ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '{"long":' } }),
      ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: ' true}' } }),
      ev('content_block_stop', { index: 1 }),
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }),
      ev('message_stop', {}),
    ].join('');
  };
  const s = fauxServeurs(corps => new Response(sse(corps), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const r = await connecteur({}, s).discuter(msg, { tache: 'devblog', maxJetons: 24_000 });
  assert.equal(r.texte, '{"long": true}');
  const a = s.claude()[0];
  assert.equal(a.corps.stream, true);
  assert.equal(a.corps.max_tokens, 24_000);
});

test('transport Node (fetchIaNode) : en-têtes du SDK transmis (objet Headers converti : clé, version), réponse lue', async () => {
  let recu = null;
  const serveur = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      recu = { url: req.url, entetes: req.headers, corps: JSON.parse(b) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(message(recu.corps, { content: [{ type: 'text', text: 'pong' }] })));
    });
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  try {
    const cfg = { ...configClaude(ENV), url: `http://127.0.0.1:${serveur.address().port}` };
    const r = await creerConnecteurClaude(cfg, { fetch: creerFetchIaNode() }).discuter(msg, { json: false });
    assert.equal(r.texte, 'pong');
    assert.match(recu.url, /^\/v1\/messages(\?beta=true)?$/);
    assert.equal(recu.entetes.authorization, `Bearer ${CLE_CLAUDE}`);
    assert.ok(recu.entetes['anthropic-version']);
    assert.equal(recu.entetes['content-type'], 'application/json');
  } finally {
    serveur.close();
  }
});

// ------------------------------------------------------------------ Réponse

test('réponse : blocs de réflexion ignorés, seul le texte compte', async () => {
  const s = fauxServeurs(() => ({ content: [{ type: 'thinking', thinking: 'RAISONNEMENT SECRET', signature: 's' }, { type: 'redacted_thinking', data: 'zzz' }, { type: 'text', text: '{"a": ' }, { type: 'text', text: '1}' }] }));
  const lignes = [];
  const cx = creerConnecteurClaude(configClaude(ENV), { fetch: s.fetch, journal: t => lignes.push(t) });
  const r = await cx.discuter(msg, { tache: 'cm' });
  assert.equal(r.texte, '{"a": 1}');
  assert.ok(!JSON.stringify(r).includes('RAISONNEMENT'));
  assert.ok(!lignes.join('\n').includes('RAISONNEMENT'));
});

test('stop_reason max_tokens : JSON coupé → ia-reponse-tronquee ; texte libre complet rendu ; refusal → ia-refus', async () => {
  const s = fauxServeurs((corps, n) => (n === 1 ? { content: [{ type: 'text', text: '{"a": [1, 2' }], stop_reason: 'max_tokens' } : n === 2 ? { content: [{ type: 'text', text: 'Un texte' }], stop_reason: 'max_tokens' } : { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } }));
  const cx = connecteur({}, s);
  const e = await cx.discuter(msg, { tache: 'devblog' }).catch(x => x);
  assert.equal(e.code, 'ia-reponse-tronquee');
  assert.equal((await cx.discuter(msg, { tache: 'devblog', json: false })).texte, 'Un texte');
  const refus = await cx.discuter(msg, { tache: 'cm' }).catch(x => x);
  assert.equal(refus.code, 'ia-refus');
  assert.match(refus.message, /catégorie cyber/);
  assert.ok(refus.statut >= 500, 'le répartiteur passe au moteur suivant');
  assert.equal(cx.etat().derniereErreur.code, 'ia-refus');
});

// ------------------------------------------------------------------ Erreurs du SDK

test('erreurs typées : 401 → clé Anthropic invalide ; 429 → essais du SDK puis ia-limite-fournisseur ; 529 → ia-injoignable', async () => {
  const s401 = fauxServeurs(() => ({ statut: 401, type: 'authentication_error' }));
  const e401 = await connecteur({}, s401).discuter(msg).catch(x => x);
  assert.equal(e401.code, 'ia-cle-refusee');
  assert.match(e401.message, /Clé Anthropic invalide/);
  sansCle(e401.message, 'message 401');
  assert.equal(s401.claude().length, 1, '401 : jamais réessayé');
  // 429 : un essai du SDK (retry-after-ms), puis réussite.
  const s429 = fauxServeurs((c, n) => (n === 1 ? { statut: 429, type: 'rate_limit_error', entetes: { 'retry-after-ms': '5' } } : {}));
  assert.equal((await connecteur({ IA_CLAUDE_ESSAIS: '1' }, s429).discuter(msg)).texte, '{"ok": true}');
  assert.equal(s429.claude().length, 2);
  // 429 persistant : essais épuisés → ia-limite-fournisseur (repli).
  const sTout = fauxServeurs(() => ({ statut: 429, type: 'rate_limit_error', entetes: { 'retry-after-ms': '5' } }));
  const e429 = await connecteur({ IA_CLAUDE_ESSAIS: '1' }, sTout).discuter(msg).catch(x => x);
  assert.equal(e429.code, 'ia-limite-fournisseur');
  assert.equal(sTout.claude().length, 2);
  const e529 = await connecteur({}, fauxServeurs(() => ({ statut: 529, type: 'overloaded_error' }))).discuter(msg).catch(x => x);
  assert.equal(e529.code, 'ia-injoignable');
  assert.match(e529.message, /529/);
  const e404 = await connecteur({}, fauxServeurs(() => ({ statut: 404, type: 'not_found_error' }))).discuter(msg).catch(x => x);
  assert.equal(e404.code, 'ia-modele');
  // Sans clé : refus sans appel.
  const s0 = fauxServeurs();
  const e0 = await creerConnecteurClaude(configClaude({}), { fetch: s0.fetch }).discuter(msg).catch(x => x);
  assert.equal(e0.code, 'ia-non-configuree');
  assert.equal(s0.appels.length, 0);
});

// ------------------------------------------------------------------ Répartiteur

test('ordre de repli IA_ORDRE=claude,api2 : Claude d’abord ; refus, 401, 429 ou 529 → NVIDIA', async () => {
  let mode = 'ok';
  const s = fauxServeurs(() => (mode === 'ok' ? {} : mode === 'refus' ? { content: [], stop_reason: 'refusal' } : { statut: Number(mode), type: 'x' }));
  const r = creerIaDepuisEnv(ENV, { fetch: s.fetch });
  assert.equal((await r.discuterPour('brouillon', msg)).moteur, 'claude');
  assert.equal((await r.discuterPour('traduction', msg)).moteur, 'claude');
  for (mode of ['refus', '401', '429', '529', '500']) {
    const rep = await r.discuterPour('cm', msg);
    assert.equal(rep.moteur, 'api2', `repli après ${mode}`);
    assert.equal(rep.texte, '{"nvidia": true}');
  }
  // Ordres par défaut (sans IA_ORDRE) : Claude n'est pas utilisé tant qu'on ne le place pas.
  const s2 = fauxServeurs();
  const d = creerIaDepuisEnv({ ...ENV, IA_ORDRE: '', IA_ORDRE_LEGER: '' }, { fetch: s2.fetch });
  assert.equal((await d.discuterPour('traduction', msg)).moteur, 'api2');
  assert.equal(s2.claude().length, 0);
  // Sans clé Anthropic : sauté.
  const s3 = fauxServeurs();
  const sans = creerIaDepuisEnv({ ...ENV, ANTHROPIC_API_KEY: '' }, { fetch: s3.fetch });
  assert.equal((await sans.discuterPour('brouillon', msg)).moteur, 'api2');
  assert.equal(s3.claude().length, 0);
});

test('CONFIDENTIALITÉ : une tâche confidentielle n’atteint JAMAIS Claude (ordre, cible, moteurs, levée du Fondateur)', async () => {
  const s = fauxServeurs();
  const appelsLocaux = [];
  const local = { disponible: () => true, images: false, discuter: async m => (appelsLocaux.push(m), { texte: '{"local": true}', jetons: {}, dureeMs: 1 }) };
  const taches = [...Object.keys(TACHES_CONFIDENTIELLES), 'reunion', 'resume', 'notes-staff', 'playbook', 'transcript', 'ticket', 'cm-reunions', 'pdf-resume-reunion'];
  const r = creerIaDepuisEnv(ENV, { fetch: s.fetch, local });
  for (const tache of taches) {
    for (const options of [{}, { cible: 'claude' }, { moteurs: ['claude'] }, { moteurs: ['claude', 'api2', 'local'] }]) {
      assert.equal((await r.discuterPour(tache, msg, options)).moteur, 'local', `${tache} ${JSON.stringify(options)}`);
    }
    assert.ok(!(await r.disponibles(tache)).includes('claude'));
  }
  // Même LEVÉE par le Fondateur (envoi externe autorisé) : les API NVIDIA, jamais Claude.
  const leve = creerIaDepuisEnv(ENV, { fetch: s.fetch, local: null, externeAutorise: async () => true });
  for (const tache of taches) {
    assert.equal((await leve.discuterPour(tache, msg)).moteur, 'api2', tache);
    assert.equal((await leve.discuterPour(tache, msg, { cible: 'claude' }).catch(x => x)).code, 'ia-non-configuree', `${tache} : cible claude refusée`);
    assert.deepEqual(await leve.disponibles(tache), ['api2']);
  }
  // `executer` (service des profils de jeu) : jamais appelé avec Claude pour une tâche confidentielle.
  const vus = [];
  const r3 = creerRepartiteurIa({ moteurs: { claude: { disponible: () => true, images: true }, local }, ordrePour: async () => ['claude'], executer: async m => (vus.push(m), { texte: '{}' }), externeAutorise: async () => true });
  for (const tache of taches) await r3.discuterPour(tache, msg).catch(() => undefined);
  assert.ok(!vus.includes('claude'));
  // Garde-fou du connecteur lui-même (appel direct avec le nom de la tâche).
  const cx = creerConnecteurClaude(configClaude(ENV), { fetch: s.fetch });
  for (const tache of taches) assert.equal((await cx.discuter(msg, { tache }).catch(x => x)).code, 'ia-confidentielle-externe');
  assert.equal(s.claude().length, 0, 'aucun appel à Anthropic');
  assert.ok(appelsLocaux.length > 0);
  // Les tâches non confidentielles partent bien chez Claude.
  assert.equal((await r.discuterPour('devblog', msg)).moteur, 'claude');
  assert.equal(s.claude().length, 1);
});

// ------------------------------------------------------------------ Administration IA

test('Administration IA : Claude listé (modèle, effort, dernière latence, dernière erreur), test et plafond ; jamais la clé', async () => {
  let mode = 'ok';
  const s = fauxServeurs(() => (mode === 'ok' ? {} : { statut: 401, type: 'authentication_error' }));
  const lignes = [];
  const origine = { warn: console.warn, error: console.error };
  console.warn = (...a) => lignes.push(a.join(' '));
  console.error = (...a) => lignes.push(a.join(' '));
  try {
    const b = await banc({ ia: { config: configIa(ENV), fetch: s.fetch, telecharger: async () => ({ statut: 404, corps: '' }) } });
    const f = await b.session('principal', 'Fondateur');
    let e = (await b.appel('/jeux/ia', { jeton: f })).corps;
    const claude = () => e.moteurs.find(m => m.id === 'claude');
    assert.deepEqual([claude().configure, claude().fournisseur, claude().modele, claude().modeleLeger, claude().effort, claude().effortLeger, claude().cle, claude().pret, claude().hote], [true, 'anthropic', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'medium', 'low', 'presente', true, 'api.anthropic.com']);
    assert.equal(claude().plafond, 100);
    assert.equal(claude().derniereErreur, null);
    sansCle(e, 'état de l’Administration IA');
    // Test de Claude seul : effort bas, compté dans le mois.
    const t = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'claude' } })).corps;
    assert.equal(t.ok, true);
    assert.equal(t.cible, 'claude');
    assert.equal(s.claude().at(-1).corps.output_config.effort, 'low');
    e = t.etat;
    assert.equal(claude().appelsMois, 1);
    assert.equal(typeof claude().derniereLatenceMs, 'number');
    // Clé refusée : dernière erreur claire, le test retombe sur NVIDIA quand il n'est pas ciblé.
    mode = '401';
    b.horloge.t += 60_000;
    const t2 = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'claude' } })).corps;
    assert.equal(t2.ok, false);
    assert.equal(t2.erreur.code, 'ia-cle-refusee');
    assert.match(t2.erreur.message, /Clé Anthropic invalide/);
    e = t2.etat;
    assert.equal(claude().derniereErreur.code, 'ia-cle-refusee');
    sansCle(t2, 'résultat du test');
    // Ordre avec Claude, plafond propre.
    e = (await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { ordres: { leger: ['claude', 'api2', 'local'] }, quotaAppelsClaude: 5 } })).corps;
    assert.deepEqual(e.ordres.leger, ['claude', 'api2', 'local']);
    assert.equal(e.reglages.quotaAppelsClaude, 5);
    assert.equal(e.usage.plafondAppelsClaude, 5);
    assert.equal(typeof e.usage.appelsClaude, 'number');
    sansCle(e, 'réglages');
    sansCle(lignes.join('\n'), 'journal');
  } finally {
    Object.assign(console, origine);
  }
});
