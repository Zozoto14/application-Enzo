/**
 * CONFIDENTIALITÉ de l'IA (décision du Fondateur : « Non, ce n'est pas OK que ça envoie mes réunions à NVIDIA »,
 * esport/noyau/ia/confidentialite.mjs, docs/esport/ia-api.md) :
 *  - une tâche confidentielle (transcription, relecture, résumés de réunion, suivi, strats) ne part JAMAIS à un
 *    moteur d'API (« api », « api2 ») même si l'ordre de repli, `cible` ou `moteurs` le demandent ;
 *  - sans IA locale : refus propre, AUCUN appel réseau ; la relecture des transcriptions est simplement absente ;
 *  - levée explicite par le Fondateur, tâche par tâche (base + journal), refusée à tout autre compte ;
 *  - les profils de jeu, traductions et posts CM partent toujours chez NVIDIA.
 *
 * Faux serveurs seulement : AUCUN appel réseau réel. Tourne sur SQLite et PostgreSQL (ESPORT_TEST_PG).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree } from './base.mjs';
import { envoyer, wavFactice } from './medias-aide.mjs';
import { MOTEURS_IA, configIa, creerIaDepuisEnv, creerRepartiteurIa } from '../noyau/ia/connecteur.mjs';
import { MESSAGE_RELECTURE_DESACTIVEE, TACHES_CONFIDENTIELLES, externeAutorise, tacheConfidentielle } from '../noyau/ia/confidentialite.mjs';
import { servicesJeux } from '../noyau/jeux/service.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { servicesMedias } from '../noyau/medias/service.mjs';
import { configTranscriptionServeur } from '../noyau/medias/fileTranscription.mjs';
import { servicesResumes } from '../noyau/resumes.mjs';
import { preparerCorrecteur } from '../serveur/transcription/correcteur.mjs';
import { executerTravaux } from '../serveur/transcription/travailleur.mjs';

const CLE1 = 'nvapi-FACTICE-principal-0000000000';
const CLE2 = 'nvapi-FACTICE-secondaire-1111111111';
const ENV = {
  IA_API_URL: 'https://integrate.api.nvidia.com/v1',
  IA_API_CLE: CLE1,
  IA_MODELE: 'mistralai/mistral-large-4-1t-a52b',
  IA_API2_CLE: CLE2,
  IA_MODELE2: 'openai/gpt-oss-20b',
  // L'ordre DEMANDE les API d'abord, et même sans IA locale : la règle doit l'emporter.
  IA_ORDRE: 'api,api2',
  IA_ORDRE_LEGER: 'api2,api',
};
const silencieux = { log: () => undefined, warn: () => undefined, error: () => undefined };
const TEXTE_REUNION = 'Réunion staff : Léa passe remplaçante, stratégie B split secrète.';
const msg = [{ role: 'user', content: TEXTE_REUNION }];
const MIO = 1024 * 1024;
const TYPE_HEBDO = '00000000-0000-4000-8000-000000000001';

/** Faux NVIDIA : note chaque appel (moteur, contenu reçu). */
function fauxNvidia() {
  const appels = [];
  const fetch = async (url, init) => {
    const cle = String(init.headers.Authorization ?? '').replace(/^Bearer /, '');
    appels.push({ url, moteur: cle === CLE1 ? 'api' : cle === CLE2 ? 'api2' : '?', corps: String(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok": true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, appels };
}

const localFactice = (pret = true) => {
  const appels = [];
  return { appels, disponible: () => pret, indisponible: () => !pret, images: false, discuter: async m => (appels.push(m), { texte: '{"local": true}', jetons: {}, dureeMs: 1 }) };
};

// ------------------------------------------------------------------ Classement des tâches

test('classement : réunions, transcription, relecture, suivi, strats confidentiels ; profils, traductions, CM non', () => {
  for (const t of ['transcription', 'correction', 'resumes', 'resume', 'reunion', 'suivi', 'notes-staff', 'strats', 'playbook', 'resume-auto-reunion', 'relecture-transcription']) assert.ok(tacheConfidentielle(t), `${t} confidentielle`);
  for (const t of ['profils', 'brouillon', 'verification', 'sources', 'test', 'traduction', 'cm', 'leger']) assert.equal(tacheConfidentielle(t), null, `${t} peut partir chez le fournisseur`);
});

// ------------------------------------------------------------------ Répartiteur

test('répartiteur : une tâche confidentielle n’atteint JAMAIS api/api2, même si l’ordre, `cible` ou `moteurs` le demandent', async () => {
  const ia = fauxNvidia();
  const local = localFactice(true);
  const r = creerIaDepuisEnv(ENV, { fetch: ia.fetch, local });
  for (const tache of [...Object.keys(TACHES_CONFIDENTIELLES), 'reunion', 'notes-staff', 'playbook']) {
    for (const options of [{}, { cible: 'api' }, { cible: 'api2' }, { moteurs: ['api', 'api2'] }, { moteurs: ['api2', 'api', 'local'] }]) {
      const rep = await r.discuterPour(tache, msg, options);
      assert.equal(rep.moteur, 'local', `${tache} ${JSON.stringify(options)}`);
    }
    assert.deepEqual(await r.disponibles(tache), ['local']);
  }
  assert.equal(ia.appels.length, 0, 'aucun appel à NVIDIA');
  // Même avec l'ordre réglé en base (Administration IA) sur les API seulement.
  const r2 = creerRepartiteurIa({ moteurs: { api: { disponible: () => true, discuter: async () => assert.fail('api appelée') }, api2: { disponible: () => true, discuter: async () => assert.fail('api2 appelée') }, local }, ordrePour: async () => ['api2', 'api'] });
  assert.equal((await r2.discuterPour('correction', msg)).moteur, 'local');
  // `executer` (service des profils de jeu) : jamais appelé avec une API pour une tâche confidentielle.
  const vus = [];
  const r3 = creerRepartiteurIa({ moteurs: { api: { disponible: () => true }, api2: { disponible: () => true }, local }, ordres: { profils: ['api'], leger: ['api2', 'api'] }, executer: async m => (vus.push(m), { texte: '{}' }) });
  await r3.discuterPour('transcription', msg, { cible: 'api2' });
  assert.deepEqual(vus, ['local']);
});

test('répartiteur : sans IA locale, une tâche confidentielle est refusée proprement (aucun envoi), les autres partent chez NVIDIA', async () => {
  const ia = fauxNvidia();
  for (const local of [null, localFactice(false)]) {
    const r = creerIaDepuisEnv(ENV, { fetch: ia.fetch, local });
    for (const tache of Object.keys(TACHES_CONFIDENTIELLES)) {
      const e = await r.discuterPour(tache, msg, { cible: 'api2' }).catch(x => x);
      assert.equal(e.code, 'ia-confidentielle-sans-local', tache);
      assert.equal(e.statut, 503);
      assert.match(e.message, /Rien n’a été envoyé/);
    }
  }
  assert.equal(ia.appels.length, 0, 'rien n’est parti chez le fournisseur');
  // Profils de jeu, traductions, posts CM : toujours chez NVIDIA (Mistral pour les profils, gpt-oss pour le léger).
  const r = creerIaDepuisEnv({ ...ENV, IA_ORDRE: '', IA_ORDRE_LEGER: '' }, { fetch: ia.fetch, local: localFactice(true) });
  assert.equal((await r.discuterPour('brouillon', msg)).moteur, 'api');
  assert.equal((await r.discuterPour('verification', msg)).moteur, 'api');
  assert.equal((await r.discuterPour('traduction', msg)).moteur, 'api2');
  assert.equal((await r.discuterPour('cm', msg)).moteur, 'api2');
  assert.deepEqual(ia.appels.map(a => a.moteur), ['api', 'api', 'api2', 'api2']);
  assert.ok(ia.appels.every(a => a.url.startsWith('https://integrate.api.nvidia.com/')));
});

test('répartiteur : levée par le Fondateur tâche par tâche ; une réponse autre que `true` ou une erreur = refus', async () => {
  const ia = fauxNvidia();
  const autorise = new Set(['correction']);
  const r = creerIaDepuisEnv(ENV, { fetch: ia.fetch, local: null, externeAutorise: async t => autorise.has(t) });
  assert.equal((await r.discuterPour('correction', msg)).moteur, 'api2', 'levée : suit l’ordre léger (gpt-oss)');
  assert.equal((await r.discuterPour('transcription', msg).catch(x => x)).code, 'ia-confidentielle-sans-local', 'les autres tâches restent locales');
  assert.equal(ia.appels.length, 1);
  for (const reponse of [async () => 'true', async () => 1, async () => { throw new Error('base'); }]) {
    const r2 = creerIaDepuisEnv(ENV, { fetch: ia.fetch, local: null, externeAutorise: reponse });
    assert.equal((await r2.discuterPour('correction', msg).catch(x => x)).code, 'ia-confidentielle-sans-local');
  }
  assert.equal(ia.appels.length, 1);
});

// ------------------------------------------------------------------ Service (Administration IA)

test('service : Administration IA affiche local/externe ; seul le Fondateur lève la règle (base + journal) ; profils toujours NVIDIA', async () => {
  const base = await baseMigree();
  const horloge = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const fondateur = { compte: 'principal', superAdmin: true };
  const ia = fauxNvidia();
  const lignes = [];
  const journal = { log: () => undefined, warn: (...a) => lignes.push(a.join(' ')), error: () => undefined };
  const app = servicesJeux({ base, maintenant: () => horloge.t, socle: {}, ia: { config: configIa(ENV), fetch: ia.fetch }, travauxIa: 'synchrone', journal });
  let e = await app.etatIa(fondateur);
  assert.deepEqual(e.confidentialite.locales.map(t => [t.cle, t.externeAutorise]), Object.keys(TACHES_CONFIDENTIELLES).map(t => [t, false]));
  assert.deepEqual(e.confidentialite.externes.map(t => t.cle), ['profils', 'traduction', 'cm']);
  // Ordre léger réglé sur les API : la relecture d'une réunion reste refusée sans IA locale.
  await app.reglerIa(fondateur, { ordres: { leger: ['api2', 'api'] } });
  assert.equal((await app.discuterPour('correction', msg).catch(x => x)).code, 'ia-confidentielle-sans-local');
  assert.equal((await app.discuterPour('resumes', msg, { cible: 'api' }).catch(x => x)).code, 'ia-confidentielle-sans-local');
  assert.equal(ia.appels.length, 0);
  assert.equal(Number((await base.premier('SELECT COUNT(*) AS n FROM ia_appels', [])).n), 0, 'aucun appel compté');
  // Profils de jeu et traductions : NVIDIA.
  assert.equal((await app.discuterPour('brouillon', [{ role: 'user', content: 'Valorant' }])).moteur, 'api');
  assert.equal((await app.discuterPour('traduction', [{ role: 'user', content: 'Bonjour' }])).moteur, 'api2');
  assert.equal(ia.appels.length, 2);
  // Un autre compte ne lève rien ; tâche inconnue ou valeur non booléenne : 400.
  await assert.rejects(app.reglerIa({ compte: 'coach123' }, { externes: { correction: true } }), x => x.statut === 403);
  await assert.rejects(app.reglerIa(fondateur, { externes: { profils: true } }), x => x.statut === 400);
  await assert.rejects(app.reglerIa(fondateur, { externes: { correction: 'oui' } }), x => x.statut === 400);
  assert.equal(await externeAutorise(base, 'correction'), false);
  // Le Fondateur lève la règle pour la relecture seulement.
  e = await app.reglerIa(fondateur, { externes: { correction: true } });
  assert.equal(e.confidentialite.locales.find(t => t.cle === 'correction').externeAutorise, true);
  assert.equal(e.confidentialite.locales.find(t => t.cle === 'transcription').externeAutorise, false);
  assert.equal(await externeAutorise(base, 'correction'), true);
  assert.equal((await app.discuterPour('correction', msg)).moteur, 'api2');
  assert.equal((await app.discuterPour('resumes', msg).catch(x => x)).code, 'ia-confidentielle-sans-local');
  // Journalisé : événement en base (acteur, tâche, valeur), et une ligne au journal du serveur.
  const ev = await base.tous("SELECT acteur_id, entite_id, charge FROM evenements WHERE type = 'ia.confidentialite_changed'", []);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].acteur_id, 'principal');
  assert.equal(ev[0].entite_id, 'correction');
  assert.deepEqual(JSON.parse(ev[0].charge), { tache: 'correction', externeAutorise: true });
  assert.ok(lignes.some(l => /confidentialité : envoi de la tâche « correction » .* AUTORISÉ par principal/.test(l)));
  await distribuer(base, { maintenant: horloge.t });
  const j = await base.tous("SELECT acteur_id, entite_id FROM journal WHERE action = 'ia.confidentialite_changed'", []);
  assert.deepEqual(j.map(x => [x.acteur_id, x.entite_id]), [['principal', 'correction']], 'journal d’activité');
  // Même valeur renvoyée : pas de nouvel événement ; retrait : journalisé, la règle revient.
  await app.reglerIa(fondateur, { externes: { correction: true } });
  await app.reglerIa(fondateur, { externes: { correction: false } });
  assert.equal((await base.tous("SELECT id FROM evenements WHERE type = 'ia.confidentialite_changed'", [])).length, 2);
  assert.equal((await app.discuterPour('correction', msg).catch(x => x)).code, 'ia-confidentielle-sans-local');
  // Valeur bricolée en base (autre que '1') : refus.
  await base.executer("INSERT INTO ia_reglages (cle, valeur, maj_le) VALUES ('externe_suivi', 'oui', ?)", [new Date(horloge.t).toISOString()]);
  assert.equal(await externeAutorise(base, 'suivi'), false);
  assert.deepEqual(MOTEURS_IA, ['api', 'api2', 'local']);
});

// ------------------------------------------------------------------ Relecture des transcriptions

test('relecture : sans IA locale, pas de correcteur (message clair, rien envoyé) ; IA locale d’abord ; API seulement si le Fondateur l’a autorisé', async () => {
  const ia = fauxNvidia();
  const env = { ...ENV };
  // Sans IA locale (absente ou tuée par l'hébergeur) : pas de relecture.
  for (const local of [null, localFactice(false)]) {
    const p = await preparerCorrecteur(null, { env, local, externeAutorise: async () => false });
    assert.equal(p.correcteur, null);
    assert.equal(p.raison, MESSAGE_RELECTURE_DESACTIVEE);
    assert.equal(p.raison, 'Relecture IA désactivée : aucune IA locale disponible ; vos réunions ne quittent pas le serveur.');
  }
  // Sans réglage (pas de fonction) : même chose.
  assert.equal((await preparerCorrecteur(null, { env, local: null })).correcteur, null);
  // IA locale prête : le texte va à l'IA locale même si IA_ORDRE_LEGER met gpt-oss en tête.
  const local = localFactice(true);
  const avecLocal = await preparerCorrecteur(null, { env, local, externeAutorise: async () => false });
  const repLocal = await avecLocal.correcteur.appeler(msg, {});
  assert.equal(repLocal.moteur, 'local');
  assert.equal(local.appels.length, 1);
  assert.equal(ia.appels.length, 0);
  // Levée par le Fondateur, sans IA locale : la relecture passe par l'API (son choix explicite).
  const leve = await preparerCorrecteur(null, { env, local: null, externeAutorise: async t => t === 'correction', repartiteur: creerIaDepuisEnv(env, { fetch: ia.fetch, local: null, externeAutorise: async t => t === 'correction' }) });
  assert.ok(leve.correcteur);
  assert.equal((await leve.correcteur.appeler(msg, {})).moteur, 'api2');
  assert.equal(ia.appels.length, 1);
});

const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0, blocS: 60, chevauchementS: 1.5, correctionDisponible: false, correctionApi: true, qualites: { rapide: { disponible: true, moteur: 'whispercpp', modele: 'small' }, equilibree: { disponible: true, moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0' }, maximale: { disponible: false, moteur: 'whispercpp', modele: 'large-v3-q5_0' } } };

function cote(b, extra = {}) {
  const socle = { contexteTeam: async () => { throw new Error('pas de contexte'); } };
  const medias = servicesMedias({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle });
  return servicesResumes({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle, medias, transcriptionServeur: SERVEUR, ...extra });
}

test('de bout en bout : clé NVIDIA configurée mais pas d’IA locale → transcription nettoyée sans IA, message « vos réunions ne quittent pas le serveur »', async () => {
  const b = await banc({ medias: { plafond: 8 * MIO, tailleMorceau: MIO }, transcriptionServeur: SERVEUR });
  const A = await teamAvecMembres(b, { nom: 'Faucons', membres: { own12345: { pseudo: 'Owner', role: 'proprietaire' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const dossier = mkdtempSync(join(tmpdir(), 'esport-confidentialite-'));
  try {
    // Paramètres : la relecture est voulue, mais désactivée faute d'IA locale (l'API ne compte pas sans levée).
    const reg = await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { correction: true } });
    assert.equal(reg.statut, 200, JSON.stringify(reg.corps));
    assert.equal(reg.corps.correctionDisponible, false);
    assert.equal(reg.corps.correctionRaison, MESSAGE_RELECTURE_DESACTIVEE);
    const enr = await envoyer(b, A.sessions.lea12345, A.teamId, wavFactice(20, 8000), { section: 'resumes', nom: 'r.wav' });
    const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre: 'Staff', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id, transcription: 'serveur' } })).corps;
    const ia = fauxNvidia();
    const { correcteur, raison } = await preparerCorrecteur(null, { env: ENV, local: null, externeAutorise: async () => false });
    const transcripteur = { moteur: 'whisper simulé', transcrireBloc: async (pcm, { decalage }) => ({ segments: [[decalage, decalage + 5, 'euh on on on on on joue joue joue joue B split']], langue: 'fr' }) };
    const bilan = await executerTravaux({ resumes: cote(b), stockage: b.stockage, config: SERVEUR, creerTranscripteur: async () => transcripteur, correcteur, sansRelecture: raison, dossierTravail: join(dossier, 'travail'), horloge: () => b.horloge.t, dormir: async () => undefined, journal: silencieux });
    assert.equal(bilan.termines, 1);
    assert.equal(bilan.corriges, 0);
    assert.equal(ia.appels.length, 0, 'aucun envoi à NVIDIA');
    const fin = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.equal(fin.statut, 'prete');
    assert.equal(fin.segmentsBruts, null);
    assert.equal(fin.correction, MESSAGE_RELECTURE_DESACTIVEE);
    assert.ok(!/(on ){4}/.test(fin.segments[0].texte), 'nettoyage déterministe (répétitions) quand même');
    // Levée par le Fondateur : la relecture redevient possible (affichage des paramètres).
    await b.base.executer("INSERT INTO ia_reglages (cle, valeur, maj_le) VALUES ('externe_correction', '1', ?)", [new Date(b.horloge.t).toISOString()]);
    const reg2 = await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { jeton: A.sessions.own12345 });
    assert.equal(reg2.corps.correctionDisponible, true);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
