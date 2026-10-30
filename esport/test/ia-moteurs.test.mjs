/**
 * Plusieurs moteurs d'IA (docs/esport/ia-api.md) : moteur d'API principal (NVIDIA Mistral Large), secondaire
 * (NVIDIA gpt-oss-20b), IA locale ; détection de NVIDIA, `reasoning_effort` (seulement pour les modèles qui
 * l'acceptent), `reasoning_content` ignoré, 429 → attente puis moteur suivant, ordre de repli par tâche, plafond
 * par moteur, images, et la clé n'apparaît NULLE PART (erreurs, journaux, état de l'Administration IA).
 *
 * Faux serveurs seulement : AUCUN appel réseau réel. Clés factices évidentes.
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { baseMigree } from './base.mjs';
import {
  attenteApres429,
  configIa,
  creerConnecteur,
  creerConnecteurLocal,
  creerIaDepuisEnv,
  creerRepartiteurIa,
  fournisseurDeUrl,
  lireOrdreIa,
  messageAvecImages,
  ordresIaEnv,
  profilModele,
  tacheIa,
} from '../noyau/ia/connecteur.mjs';
import { servicesJeux } from '../noyau/jeux/service.mjs';

const CLE1 = 'nvapi-FACTICE-principal-0000000000';
const CLE2 = 'nvapi-FACTICE-secondaire-1111111111';
const MISTRAL = 'mistralai/mistral-large-4-1t-a52b';
const GPTOSS = 'openai/gpt-oss-20b';
const ENV = {
  IA_API_URL: 'https://integrate.api.nvidia.com/v1',
  IA_API_CLE: CLE1,
  IA_MODELE: MISTRAL,
  IA_API2_CLE: CLE2,
  IA_MODELE2: GPTOSS,
};
const silencieux = { log: () => undefined, warn: () => undefined, error: () => undefined };

/** Aucune trace des clés factices dans ce texte. */
function sansCle(texte, quoi = 'texte') {
  const t = typeof texte === 'string' ? texte : JSON.stringify(texte);
  assert.ok(!t.includes(CLE1) && !t.includes(CLE2) && !t.includes('nvapi-FACTICE'), `clé trouvée dans ${quoi}`);
}

/**
 * Faux NVIDIA : `repondre(corps, cle)` → objet message ({ content, reasoning_content }), { statut, corps, entetes }
 * ou une chaîne (contenu). La clé reçue (en-tête) dit quel moteur appelle.
 */
function fauxNvidia(repondre) {
  const appels = [];
  const fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    const cle = String(init.headers.Authorization ?? '').replace(/^Bearer /, '');
    appels.push({ url, corps, cle, moteur: cle === CLE1 ? 'api' : cle === CLE2 ? 'api2' : '?' });
    const r = await repondre(corps, cle);
    if (r && typeof r === 'object' && 'statut' in r) return new Response(typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps ?? {}), { status: r.statut, headers: r.entetes ?? {} });
    const message = typeof r === 'string' ? { role: 'assistant', content: r } : { role: 'assistant', ...r };
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: r?.fin ?? 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, appels };
}

function journalMemoire() {
  const lignes = [];
  const j = (texte, code) => lignes.push(`${texte} ${code ?? ''}`);
  return { lignes, j, console: { log: (...a) => lignes.push(a.join(' ')), warn: (...a) => lignes.push(a.join(' ')), error: (...a) => lignes.push(a.join(' ')) } };
}

// ------------------------------------------------------------------ Configuration

test('NVIDIA détecté par l’adresse ; moteurs principal et secondaire (adresse reprise), ordres, profils de modèles ; clés invisibles', () => {
  assert.equal(fournisseurDeUrl('https://integrate.api.nvidia.com/v1'), 'nvidia');
  assert.equal(fournisseurDeUrl('https://integrate.api.nvidia.com.pirate-exemple.fr/v1'), 'autre');
  const c = configIa(ENV);
  assert.equal(c.moteur, 'api');
  assert.equal(c.fournisseur, 'nvidia');
  assert.equal(c.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(c.raisonnement, true);
  assert.equal(c.effort, 'high');
  assert.equal(c.images, true);
  assert.equal(c.delaiMs, 300_000, 'modèle à raisonnement : 5 min');
  const s = c.secondaire;
  assert.equal(s.moteur, 'api2');
  assert.equal(s.actif, true);
  assert.equal(s.fournisseur, 'nvidia', 'IA_API2_URL vide : adresse du principal');
  assert.equal(s.modele, GPTOSS);
  assert.equal(s.effort, 'low', 'gpt-oss : reasoning_effort low (sans lui, la sortie JSON pouvait dépasser 90 s)');
  assert.equal(s.images, false);
  assert.equal(s.lireCle(), CLE2);
  assert.deepEqual(c.ordres, { profils: ['api', 'api2', 'local'], leger: ['api2', 'api', 'local'] });
  // Réglages fins.
  const f = configIa({ ...ENV, IA_API_EFFORT: 'aucun', IA_API2_EFFORT: 'medium', IA_API2_DELAI_S: '45', IA_API2_IMAGES: 'oui', IA_API2_FLUX: 'oui' });
  assert.equal(f.effort, null);
  assert.equal(f.secondaire.effort, 'medium');
  assert.equal(f.secondaire.delaiMs, 45_000);
  assert.equal(f.secondaire.images, true);
  assert.equal(f.secondaire.flux, true);
  // Ordres : lecture tolérante, défaut sensé.
  assert.deepEqual(lireOrdreIa('local, api2 , inconnu, local'), ['local', 'api2']);
  assert.deepEqual(lireOrdreIa('rien'), ['api', 'api2', 'local']);
  assert.deepEqual(ordresIaEnv({ IA_ORDRE: 'api2,api', IA_ORDRE_LEGER: 'local' }), { profils: ['api2', 'api'], leger: ['local'] });
  assert.deepEqual(ordresIaEnv({ IA_FOURNISSEUR: 'local' }).profils, ['local', 'api', 'api2']);
  assert.equal(tacheIa('brouillon'), 'profils');
  assert.equal(tacheIa('transcription'), 'leger');
  assert.equal(tacheIa('traduction'), 'leger');
  assert.equal(profilModele('modele-inconnu').raisonnement, false);
  // Secondaire sans clé : inactif ; le principal seul fonctionne.
  assert.equal(configIa({ ...ENV, IA_API2_CLE: '' }).secondaire.raison, 'cle-absente');
  // Rien de secret dans la sérialisation ni l'état public.
  sansCle(JSON.stringify(c), 'JSON.stringify');
  sansCle(JSON.stringify({ c, s }), 'JSON.stringify imbriqué');
  sansCle(c.moteurPublic(), 'moteurPublic');
  sansCle(s.moteurPublic(), 'moteurPublic secondaire');
  assert.equal(s.moteurPublic().cle, 'presente');
});

// ------------------------------------------------------------------ Requêtes et réponses

test('requêtes NVIDIA : reasoning_effort (Mistral Large high, gpt-oss low ; low pour le test), paramètres d’exemple, clé dans l’en-tête seulement', async () => {
  const ia = fauxNvidia(() => '{"ok": true}');
  const c = configIa(ENV);
  const principal = creerConnecteur(c, { fetch: ia.fetch });
  const secondaire = creerConnecteur(c.secondaire, { fetch: ia.fetch });
  await principal.discuter([{ role: 'user', content: 'x' }], { maxJetons: 200 });
  await principal.discuter([{ role: 'user', content: 'x' }], { maxJetons: 200, effort: 'low' });
  await secondaire.discuter([{ role: 'user', content: 'x' }], { maxJetons: 200, effort: 'high' });
  const [a, b, g] = ia.appels;
  assert.equal(a.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(a.corps.model, MISTRAL);
  assert.equal(a.corps.reasoning_effort, 'high');
  assert.equal(a.corps.temperature, 0.5);
  assert.equal(a.corps.top_p, 1);
  assert.equal(a.corps.max_tokens, 4096, 'le raisonnement consomme des jetons : 4096 au moins');
  assert.deepEqual(a.corps.response_format, { type: 'json_object' });
  assert.equal(b.corps.reasoning_effort, 'low');
  assert.equal(g.corps.model, GPTOSS);
  assert.equal(g.corps.reasoning_effort, 'high', 'gpt-oss : effort demandé envoyé');
  assert.equal(g.corps.temperature, 1);
  assert.equal(g.corps.top_p, 1);
  assert.equal(a.cle, CLE1);
  assert.equal(g.cle, CLE2);
  for (const x of ia.appels) sansCle(x.corps, 'corps de requête');
});

test('reasoning_content IGNORÉ (jamais lu comme la réponse, jamais journalisé) ; <think> retiré ; réponse tronquée', async () => {
  const SECRET = 'RAISONNEMENT-PRIVE {"faux": "ne pas lire"}';
  let mode = 'ok';
  const ia = fauxNvidia(() => {
    if (mode === 'ok') return { content: '{"vrai": 1}', reasoning_content: SECRET };
    if (mode === 'think') return { content: '<think>{"faux": 2}</think>\n{"vrai": 2}' };
    if (mode === 'vide') return { content: null, reasoning_content: SECRET };
    return { content: '', reasoning_content: SECRET, fin: 'length' };
  });
  const j = journalMemoire();
  const cx = creerConnecteur(configIa(ENV).secondaire, { fetch: ia.fetch, journal: j.j });
  assert.equal((await cx.discuter([{ role: 'user', content: 'x' }])).texte, '{"vrai": 1}');
  mode = 'think';
  assert.equal((await cx.discuter([{ role: 'user', content: 'x' }])).texte, '{"vrai": 2}');
  mode = 'vide';
  const e = await cx.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
  assert.equal(e.code, 'ia-reponse');
  mode = 'tronque';
  assert.equal((await cx.discuter([{ role: 'user', content: 'x' }]).catch(x => x)).code, 'ia-reponse-tronquee');
  const journal = j.lignes.join('\n');
  assert.ok(!journal.includes('RAISONNEMENT-PRIVE'), 'le raisonnement n’est pas journalisé');
  assert.match(journal, /raisonnement ignoré : \d+ caractères/);
  sansCle(journal, 'journal');
});

test('paramètre refusé (HTTP 400) : reasoning_effort puis response_format retirés, et retenus pour la suite', async () => {
  const ia = fauxNvidia(corps => {
    if (corps.reasoning_effort) return { statut: 400, corps: { error: { message: 'Unsupported parameter: reasoning_effort' } } };
    if (corps.response_format) return { statut: 400, corps: { detail: 'response_format json_object is not supported for this model' } };
    return '{"ok": true}';
  });
  const j = journalMemoire();
  const cx = creerConnecteur(configIa(ENV), { fetch: ia.fetch, journal: j.j });
  assert.equal((await cx.discuter([{ role: 'user', content: 'x' }])).texte, '{"ok": true}');
  assert.equal(ia.appels.length, 3);
  await cx.discuter([{ role: 'user', content: 'x' }]);
  assert.equal(ia.appels.length, 4, 'retenu : un seul appel ensuite');
  assert.equal(ia.appels[3].corps.reasoning_effort, undefined);
  assert.equal(ia.appels[3].corps.response_format, undefined);
  // Autre refus : erreur claire, sans nouvel essai.
  const autre = creerConnecteur(configIa(ENV), { fetch: fauxNvidia(() => ({ statut: 400, corps: { error: `bad request ${CLE1}` } })).fetch, journal: j.j });
  const e = await autre.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
  assert.equal(e.code, 'ia-requete-refusee');
  sansCle(e.message, 'message d’erreur');
  sansCle(j.lignes.join('\n'), 'journal');
});

test('HTTP 429 (limite de débit NVIDIA) : attente Retry-After puis nouvel essai ; attente trop longue → erreur aussitôt', async () => {
  assert.equal(attenteApres429(new Headers({ 'Retry-After': '3' })), 3000);
  assert.equal(attenteApres429(new Headers({}), 0), 2000);
  assert.equal(attenteApres429(new Headers({}), 2), 8000);
  const date = new Date(Date.now() + 5000).toUTCString();
  assert.ok(attenteApres429(new Headers({ 'Retry-After': date })) <= 5000);
  let n = 0;
  const attentes = [];
  const ia = fauxNvidia(() => (n++ === 0 ? { statut: 429, corps: { error: 'Too Many Requests' }, entetes: { 'Retry-After': '2' } } : '{"ok": true}'));
  const cx = creerConnecteur(configIa(ENV), { fetch: ia.fetch, attendre: async ms => attentes.push(ms) });
  assert.equal((await cx.discuter([{ role: 'user', content: 'x' }])).texte, '{"ok": true}');
  assert.deepEqual(attentes, [2000]);
  // Toujours limité : une attente, puis l'erreur (le répartiteur passe au moteur suivant).
  const toujours = creerConnecteur(configIa(ENV), { fetch: fauxNvidia(() => ({ statut: 429, entetes: { 'Retry-After': '1' } })).fetch, attendre: async ms => attentes.push(ms) });
  const e = await toujours.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
  assert.equal(e.code, 'ia-limite-fournisseur');
  assert.equal(attentes.length, 2);
  // Retry-After de 2 minutes : pas d'attente.
  const long = creerConnecteur(configIa(ENV), { fetch: fauxNvidia(() => ({ statut: 429, entetes: { 'Retry-After': '120' } })).fetch, attendre: async ms => attentes.push(ms) });
  const e2 = await long.discuter([{ role: 'user', content: 'x' }]).catch(x => x);
  assert.equal(e2.code, 'ia-limite-fournisseur');
  assert.equal(e2.reessayerApresMs, 120_000);
  assert.equal(attentes.length, 2);
});

test('réponse en flux (IA_API_FLUX) : morceaux assemblés, raisonnement en flux ignoré', async () => {
  const sse = [
    { choices: [{ delta: { reasoning_content: 'PENSEE-PRIVEE ' } }] },
    { choices: [{ delta: { content: '{"ok":' } }] },
    { choices: [{ delta: { content: ' true}' }, finish_reason: 'stop' }] },
    { usage: { prompt_tokens: 3, completion_tokens: 4 } },
  ].map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n';
  const appels = [];
  const fetch = async (url, init) => {
    appels.push(JSON.parse(init.body));
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const cx = creerConnecteur(configIa({ ...ENV, IA_API_FLUX: 'oui' }), { fetch });
  const r = await cx.discuter([{ role: 'user', content: 'x' }]);
  assert.equal(r.texte, '{"ok": true}');
  assert.deepEqual(r.jetons, { entree: 3, sortie: 4 });
  assert.equal(appels[0].stream, true);
});

// ------------------------------------------------------------------ Répartiteur

test('répartiteur : ordre par tâche, 429 → moteur suivant, erreur de la demande non répétée, moteur absent ignoré, aucune clé', async () => {
  const etat = { api: 'ok', api2: 'ok' };
  const ia = fauxNvidia((corps, cle) => {
    const m = cle === CLE1 ? 'api' : 'api2';
    if (etat[m] === '429') return { statut: 429, entetes: { 'Retry-After': '600' } };
    if (etat[m] === '500') return { statut: 500, corps: { error: CLE1 } };
    return `{"moteur": "${m}"}`;
  });
  const j = journalMemoire();
  const appelsLocaux = [];
  const local = { disponible: () => true, images: false, discuter: async () => (appelsLocaux.push(1), { texte: '{"moteur": "local"}', jetons: {}, dureeMs: 1 }) };
  const r = creerIaDepuisEnv(ENV, { fetch: ia.fetch, local, journal: j.j });
  // Tâche lourde : Mistral (principal) ; tâche légère : gpt-oss (secondaire).
  assert.equal((await r.discuterPour('brouillon', [{ role: 'user', content: 'x' }])).moteur, 'api');
  assert.equal((await r.discuterPour('traduction', [{ role: 'user', content: 'x' }])).moteur, 'api2');
  // Transcription : tâche CONFIDENTIELLE (réunions), IA locale seulement (test dédié : ia-confidentialite.test.mjs).
  assert.equal((await r.discuterPour('transcription', [{ role: 'user', content: 'x' }])).moteur, 'local');
  // gpt-oss limité (429) : Mistral prend le relais ; puis les deux : l'IA locale.
  etat.api2 = '429';
  assert.equal((await r.discuterPour('cm', [{ role: 'user', content: 'x' }])).moteur, 'api');
  etat.api = '500';
  assert.equal((await r.discuterPour('cm', [{ role: 'user', content: 'x' }])).moteur, 'local');
  assert.equal(appelsLocaux.length, 2);
  // Cible imposée : pas de repli.
  assert.equal((await r.discuterPour('cm', [{ role: 'user', content: 'x' }], { cible: 'api' }).catch(x => x)).code, 'ia-injoignable');
  // Ordre imposé pour un appel.
  etat.api = 'ok';
  assert.equal((await r.discuterPour('cm', [{ role: 'user', content: 'x' }], { moteurs: ['api', 'local'] })).moteur, 'api');
  // Erreur de la demande (400) : pas répétée ailleurs.
  const rep = creerRepartiteurIa({
    moteurs: { api: { disponible: () => true }, api2: { disponible: () => true } },
    executer: async m => {
      if (m === 'api') throw Object.assign(new Error('Demande invalide.'), { statut: 400, code: 'nom' });
      return { texte: '{}' };
    },
  });
  assert.equal((await rep.discuterPour('leger', [], { moteurs: ['api', 'api2'] }).catch(x => x)).code, 'nom');
  // Sans aucun moteur.
  const vide = creerIaDepuisEnv({});
  assert.equal((await vide.discuterPour('leger', []).catch(x => x)).code, 'ia-non-configuree');
  // Secondaire sans clé : ignoré, le principal sert les tâches légères.
  const sansSecondaire = creerIaDepuisEnv({ ...ENV, IA_API2_CLE: '' }, { fetch: fauxNvidia(() => '{}').fetch });
  assert.equal((await sansSecondaire.discuterPour('traduction', [{ role: 'user', content: 'x' }])).moteur, 'api');
  sansCle(j.lignes.join('\n'), 'journal');
  assert.ok(j.lignes.some(l => /moteur api2 en échec \(ia-limite-fournisseur\) : repli sur api/.test(l)));
});

test('images : message multimodal validé ; seul un moteur qui lit les images les reçoit', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const m = messageAvecImages('Lis ce bracket.', [PNG]);
  assert.deepEqual(m.content[1], { type: 'image_url', image_url: { url: PNG } });
  assert.throws(() => messageAvecImages('x', ['data:text/html;base64,PHA+']), e => e.code === 'ia-image');
  assert.throws(() => messageAvecImages('x', ['http://images-exemple.fr/a.png']), e => e.code === 'ia-image');
  assert.equal(messageAvecImages('x', ['https://images-exemple.fr/a.png']).content.length, 2);
  const ia = fauxNvidia(() => '{"score": "13-11"}');
  const r = creerIaDepuisEnv(ENV, { fetch: ia.fetch });
  // Tâche légère (gpt-oss d'abord) : gpt-oss ne lit pas les images, Mistral Large les reçoit.
  const rep = await r.discuterPour('leger', [m]);
  assert.equal(rep.moteur, 'api');
  assert.equal(ia.appels.length, 1);
  assert.equal(ia.appels[0].corps.messages[0].content[1].type, 'image_url');
  // Aucun moteur qui lit les images.
  const seul = creerIaDepuisEnv({ ...ENV, IA_API_CLE: '' }, { fetch: ia.fetch });
  assert.equal((await seul.discuterPour('leger', [m]).catch(x => x)).code, 'ia-image-non-geree');
  const local = creerConnecteurLocal({ executer: async () => ({}) });
  assert.equal((await local.discuter([m]).catch(x => x)).code, 'ia-image-non-geree');
});

// ------------------------------------------------------------------ Service (Administration IA)

test('Administration IA : moteurs listés (clé présente/absente, jamais la valeur), ordres par tâche, plafond par moteur, test par moteur', async () => {
  const etat = { api: 'ok', api2: 'ok' };
  const ia = fauxNvidia((corps, cle) => {
    const m = cle === CLE1 ? 'api' : 'api2';
    if (etat[m] === '429') return { statut: 429, entetes: { 'Retry-After': '900' } };
    return { content: '{"ok": true}', reasoning_content: 'pensée' };
  });
  // Journal du service (console) capturé pendant le test : la clé ne doit pas y paraître.
  const lignes = [];
  const origine = { warn: console.warn, error: console.error };
  console.warn = (...a) => lignes.push(a.join(' '));
  console.error = (...a) => lignes.push(a.join(' '));
  const b = await banc({ ia: { config: configIa(ENV), fetch: ia.fetch, telecharger: async () => ({ statut: 404, corps: '' }) } });
  const f = await b.session('principal', 'Fondateur');
  let e = (await b.appel('/jeux/ia', { jeton: f })).corps;
  assert.deepEqual(e.moteurs.map(x => [x.id, x.fournisseur, x.modele, x.cle, x.pret]), [
    ['api', 'nvidia', MISTRAL, 'presente', true],
    ['api2', 'nvidia', GPTOSS, 'presente', true],
    ['local', 'local', null, null, false],
  ]);
  assert.equal(e.moteurs[0].raisonnement, true);
  assert.equal(e.moteurs[0].images, true);
  assert.equal(e.moteurs[1].plafond, 200);
  assert.deepEqual(e.ordres, { profils: ['api', 'api2', 'local'], leger: ['api2', 'api', 'local'] });
  sansCle(e, 'état de l’Administration IA');
  // Test de chaque moteur.
  const t2 = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'api2' } })).corps;
  assert.equal(t2.ok, true);
  assert.equal(t2.cible, 'api2');
  assert.equal(ia.appels.at(-1).cle, CLE2);
  assert.equal(ia.appels.at(-1).corps.reasoning_effort, 'low', 'gpt-oss : test en effort bas, comme curl');
  const t1 = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'api' } })).corps;
  assert.equal(t1.ok, true);
  assert.equal(ia.appels.at(-1).corps.reasoning_effort, 'low', 'test rapide : effort bas');
  e = t1.etat;
  assert.equal(e.moteurs[0].appelsMois, 1);
  assert.equal(e.moteurs[1].appelsMois, 1);
  assert.equal(typeof e.moteurs[1].latenceMoyenneMs, 'number');
  assert.equal(e.moteurs[1].dernierAppel.statut, 'ok');
  // Ordres : réglés, refusés s'ils sont invalides, remis par défaut avec null.
  assert.equal((await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { ordres: { leger: ['api2', 'api2'] } } })).corps.code, 'ordre-ia');
  assert.equal((await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { ordres: { leger: ['gpu'] } } })).corps.code, 'ordre-ia');
  e = (await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { ordres: { profils: ['api2', 'api'], leger: 'api,local' }, quotaAppelsApi2: 1 } })).corps;
  assert.deepEqual(e.ordres, { profils: ['api2', 'api'], leger: ['api', 'local'] });
  assert.equal(e.reglages.quotaAppelsApi2, 1);
  // Plafond du secondaire atteint (1 appel déjà) : le test des profils (api2 d'abord) passe au principal.
  const t3 = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f })).corps;
  assert.equal(t3.ok, true);
  assert.equal(t3.moteur, 'api');
  e = (await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { ordres: { profils: null, leger: null }, quotaAppelsApi2: 200 } })).corps;
  assert.deepEqual(e.ordres, { profils: ['api', 'api2', 'local'], leger: ['api2', 'api', 'local'] });
  // Ancien réglage « mode » : il fixe l'ordre des profils.
  e = (await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { mode: 'api' } })).corps;
  assert.deepEqual(e.ordres.profils, ['api', 'api2']);
  // Principal limité (429 longue) : le test des profils passe au secondaire, sans la clé nulle part.
  etat.api = '429';
  b.horloge.t += 60_000; // appel plus récent que les précédents (« dernier appel » trié par date)
  const t4 = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f })).corps;
  assert.equal(t4.ok, true);
  assert.equal(t4.moteur, 'api2');
  e = t4.etat;
  assert.equal(e.moteurs[0].erreursMois, 1);
  assert.equal(e.moteurs[0].dernierAppel.erreur, 'ia-limite-fournisseur');
  sansCle(e, 'état');
  Object.assign(console, origine);
  sansCle(lignes.join('\n'), 'journal');
  assert.ok(lignes.some(l => /moteur api en échec \(ia-limite-fournisseur\)/.test(l)), 'le repli est journalisé (codes seulement)');
  // Un délégué (non Fondateur) ne règle pas les ordres.
  assert.equal((await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: await b.session('compte01', 'Joueur'), corps: { ordres: { leger: ['api'] } } })).statut, 403);
});

test('service : discuterPour (tâche légère, comptée par moteur) ; brouillon : les deux API limitées → repli vers l’IA locale confié au processus de fond', async () => {
  const base = await baseMigree();
  const horloge = { t: Date.parse('2026-10-20T10:00:00.000Z') };
  const fondateur = { compte: 'principal', superAdmin: true };
  const etat = { api: 'ok', api2: 'ok' };
  const ia = fauxNvidia((corps, cle) => {
    const m = cle === CLE1 ? 'api' : 'api2';
    if (etat[m] === '429') return { statut: 429, entetes: { 'Retry-After': '900' } };
    return '{"texte": "Hello"}';
  });
  const locaux = [];
  const lancements = [];
  const g = { executer: async (fn, o) => fn({ port: 41235, cle: 'k', limite: Date.now() + o.delai }), noterMesure: () => undefined };
  const fetchLocal = async (url, init) => {
    const corps = JSON.parse(init.body);
    locaux.push(corps);
    const sys = corps.messages[0].content;
    const r = /at most 3 https URLs/.test(sys) ? { urls: [] } : { nom: 'Exemple Arena', couleur: '#3366cc', profil: { formats: [{ cle: '5v5', nom: '5v5', equipes: 2, joueursParEquipe: 5, bo: [1] }], score: { type: 'rounds' }, modes: [], cartes: [], classes: [], personnages: [], roster: { titulaires: 5, remplacants: 1 }, rolesJoueurs: [] }, sources: [], incertitudes: [] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }), { status: 200 });
  };
  const local = { connecteur: creerConnecteurLocal(g, { modele: 'qwen2.5-7b', fetch: fetchLocal }), disponible: () => true, raison: null, info: { modele: 'qwen2.5-7b', delaiMs: 60_000 }, etat: () => ({}), lancerTravailleur: () => (lancements.push(1), { lance: true }) };
  const j = journalMemoire();
  const iaService = { config: configIa(ENV), fetch: ia.fetch, telecharger: async () => ({ statut: 404, corps: '' }), local };
  const app = servicesJeux({ base, maintenant: () => horloge.t, socle: {}, ia: iaService, travauxIa: 'fond', journal: j.console });
  // Tâche légère pour un autre module : gpt-oss (secondaire), comptée sur ce moteur.
  const r = await app.discuterPour('traduction', [{ role: 'user', content: 'Bonjour' }]);
  assert.equal(r.moteur, 'api2');
  assert.equal(ia.appels.at(-1).corps.model, GPTOSS);
  let e = await app.etatIa(fondateur);
  assert.equal(e.moteurs[1].appelsMois, 1);
  assert.equal(e.moteurs[1].dernierAppel.genre, 'traduction');
  // Les deux API limitées : le brouillon commence (app Passenger), échoue sur les deux, et part au processus de fond.
  etat.api = '429';
  etat.api2 = '429';
  const w = await app.lancerBrouillon(fondateur, { nom: 'Exemple Arena' });
  await new Promise(ok => setTimeout(ok, 50));
  let x = await app.travail(fondateur, w.id);
  assert.equal(x.statut, 'attente', JSON.stringify(x.erreur));
  assert.deepEqual(x.demande.exclus, ['api', 'api2']);
  assert.equal(lancements.length, 1, 'processus de fond lancé');
  assert.equal(locaux.length, 0, 'rien de calculé en local dans l’app');
  // Le cron ne le prend pas (il commence par l'IA locale) : il demande le processus de fond.
  const cron = servicesJeux({ base, maintenant: () => horloge.t + 10 * 60_000, socle: {}, ia: iaService, travauxIa: 'synchrone', journal: silencieux });
  const bilan = await cron.tacheCron({ limite: 0 });
  assert.equal(bilan.raison, 'ia-locale');
  assert.equal(bilan.aFaire, 1);
  // Le processus de fond : consignes compactes, IA locale.
  const fond = servicesJeux({ base, maintenant: () => horloge.t, socle: {}, ia: iaService, travauxIa: 'synchrone', journal: silencieux });
  const rf = await fond.tacheCron({ executionLocale: true, limite: 0 });
  assert.equal(rf.n, 1);
  x = await app.travail(fondateur, w.id);
  assert.equal(x.statut, 'pret', JSON.stringify(x.erreur));
  assert.ok(locaux.length >= 2, 'brouillon fait par l’IA locale');
  assert.equal(locaux[0].response_format.type, 'json_schema', 'consignes compactes (schéma)');
  e = await app.etatIa(fondateur);
  assert.ok(e.moteurs[0].erreursMois >= 1);
  assert.ok(e.moteurs[2].appelsMois >= 2);
  sansCle(j.lignes.join('\n'), 'journal');
  sansCle(e, 'état');
  assert.ok(j.lignes.some(l => /repli sur local/.test(l)));
  await base.fermer?.();
});

test('Administration IA : test d’un moteur long (raisonnement) EN TÂCHE DE FOND : réponse immédiate, résultat interrogé ensuite ; test expiré', async () => {
  // Faux NVIDIA lent (400 ms) et attente de la requête réduite à 50 ms : la réponse HTTP n'attend pas le modèle
  // (en vrai : 10 s, sous le délai de l'app et du frontal ; le modèle à raisonnement peut prendre plus d'une minute).
  const lent = fauxNvidia(async () => {
    await new Promise(ok => setTimeout(ok, 400));
    return '{"ok": true}';
  });
  const b = await banc({ ia: { config: configIa(ENV), fetch: lent.fetch, attenteTestMs: 50, telecharger: async () => ({ statut: 404, corps: '' }) } });
  const f = await b.session('principal', 'Fondateur');
  const t0 = Date.now();
  const r = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'api' } })).corps;
  assert.ok(Date.now() - t0 < 350, 'la requête n’attend pas la fin du test');
  assert.equal(r.enCours, true);
  assert.equal(r.cible, 'api');
  assert.match(r.test.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.test.plafondMs, 90_000);
  let e = (await b.appel(`/jeux/ia/test/${r.test.id}`, { jeton: f })).corps;
  assert.equal(e.enCours, true);
  for (let i = 0; i < 50 && e.enCours; i++) {
    await new Promise(ok => setTimeout(ok, 50));
    e = (await b.appel(`/jeux/ia/test/${r.test.id}`, { jeton: f })).corps;
  }
  assert.equal(e.enCours, false);
  assert.equal(e.ok, true);
  assert.equal(e.moteur, 'api');
  assert.equal(e.etat.moteurs[0].appelsMois, 1);
  sansCle(e, 'résultat du test');
  // Processus de l'app arrêté pendant un test : au-delà de son plafond, il est déclaré en échec (jamais « en cours » sans fin).
  const id = '00000000-0000-4000-8000-0000000000aa';
  await b.base.executer('INSERT INTO ia_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', [`test:${id}`, JSON.stringify({ statut: 'en_cours', cible: 'local', debut: new Date(b.horloge.t - 10 * 60_000).toISOString(), plafondMs: 240_000 }), new Date(b.horloge.t).toISOString()]);
  e = (await b.appel(`/jeux/ia/test/${id}`, { jeton: f })).corps;
  assert.deepEqual([e.ok, e.enCours, e.erreur.code, e.cible], [false, false, 'ia-test-sans-resultat', 'local']);
  assert.equal((await b.appel('/jeux/ia/test/00000000-0000-4000-8000-0000000000bb', { jeton: f })).corps.code, 'test-introuvable');
  // Réservé au Fondateur.
  const autre = await b.session('membre12', 'Membre');
  assert.equal((await b.appel(`/jeux/ia/test/${r.test.id}`, { jeton: autre })).statut, 403);
});
