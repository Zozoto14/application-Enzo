/**
 * Transcription automatique SUR LE SERVEUR (migration 0016) : file de travaux en base, verrou (un seul
 * processus, bail par travail), reprise après interruption au dernier morceau fait, réessais et échec
 * définitif (repli : transcrire dans le navigateur), progression et temps restant, PDF et
 * notifications, visibilité staff, mode de la team, lanceur du cron. Transcripteur SIMULÉ (aucun
 * modèle) ; tourne sur SQLite et sur PostgreSQL (ESPORT_TEST_PG).
 *
 * En plus, un test d'intégration avec le VRAI moteur (Whisper par ONNX Runtime) quand un modèle est
 * installé (TRANSCRIPTION_DOSSIER_MODELES, ~/esport-modeles par défaut) ; sinon il est sauté.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import { envoyer, wavFactice } from './medias-aide.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { attenteEssai, BAIL_MS, configTranscriptionServeur, servicesFileTranscription } from '../noyau/medias/fileTranscription.mjs';
import { servicesMedias } from '../noyau/medias/service.mjs';
import { servicesResumes } from '../noyau/resumes.mjs';
import { decoderVersPcm, dureePcm, ecrireWav, fenetreSuivante, lirePcm, wavVersPcm } from '../serveur/transcription/audio.mjs';
import { prendreVerrou, verrouActif, executerTravaux } from '../serveur/transcription/travailleur.mjs';
import { lancerTravailleur } from '../serveur/transcription/lanceur.mjs';
import { executerCron } from '../serveur/cron.mjs';
import { couperRepetitions, filtres, logMel, metadonneesOnnx } from '../serveur/transcription/whisper.mjs';

const MIO = 1024 * 1024;
const TYPE_STAFF = '00000000-0000-4000-8000-000000000004';
const TYPE_HEBDO = '00000000-0000-4000-8000-000000000001';
const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0 };

async function preparer({ serveur = SERVEUR } = {}) {
  const b = await banc({ medias: { plafond: 8 * MIO, tailleMorceau: MIO }, transcriptionServeur: serveur });
  const A = await teamAvecMembres(b, {
    nom: 'Faucons',
    membres: {
      own12345: { pseudo: 'Owner', role: 'proprietaire' },
      coa12345: { pseudo: 'Coach', role: 'coach' },
      man12345: { pseudo: 'Manon', role: 'manager' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      tom12345: { pseudo: 'Tom', role: 'joueur' },
    },
  });
  const dossier = mkdtempSync(join(tmpdir(), 'esport-transcription-'));
  return { b, A, dossier, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

/** Services vus par le processus de fond (pas d'acteur), sur la même base et la même horloge. */
function cote(b, config = SERVEUR) {
  const socle = { contexteTeam: async () => { throw new Error('pas de contexte'); } };
  const medias = servicesMedias({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle });
  return servicesResumes({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle, medias, transcriptionServeur: config });
}

/** Transcripteur simulé : un texte par morceau (avec sa durée) ; `crochet(n, pcm)` pour les scénarios. */
function simule({ crochet } = {}) {
  const appels = [];
  return {
    appels,
    creer: async () => ({
      moteur: 'Whisper simulé (serveur)',
      async transcrireMorceau(pcm, { langue }) {
        appels.push(pcm.length / 16000);
        const r = crochet ? await crochet(appels.length, pcm) : undefined;
        if (r !== undefined) return r;
        return { texte: `Phrase ${appels.length} en ${langue}, durée ${(pcm.length / 16000).toFixed(1)} secondes.`, langue };
      },
    }),
  };
}

async function deposer(b, A, { jeton = A.sessions.lea12345, secondes = 70, frequence = 8000, type = TYPE_HEBDO, mode = 'serveur', titre = 'Hebdo serveur', langue = 'fr' } = {}) {
  const enr = await envoyer(b, jeton, A.teamId, wavFactice(secondes, frequence), { section: 'resumes', nom: 'reunion.wav' });
  const r = await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton, corps: { titre, typeId: type, dateReunion: '2026-10-20', envoi: enr.id, transcription: mode, langue } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
}

const travail = (b, id) => b.base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [id]);
const notifs = async (b, jeton, type) => (await b.appel('/notifications', { jeton })).corps.liste.filter(n => n.type === type);

function executer(b, dossier, sim, options = {}) {
  return executerTravaux({
    resumes: cote(b, options.config ?? SERVEUR),
    stockage: b.stockage,
    config: options.config ?? SERVEUR,
    creerTranscripteur: sim.creer,
    dossierTravail: join(dossier, 'travail'),
    horloge: options.horloge ?? (() => b.horloge.t),
    dormir: async () => undefined,
    journal: { log() {}, error() {} },
    apresTravail: () => distribuer(b.base, { maintenant: b.horloge.t }),
    ...options,
  });
}

// ------------------------------------------------------------------ Fonctions pures

test('réglages : TRANSCRIPTION_MODE, MODELE, THREADS bornés, dossier, RAM, repos', () => {
  const d = configTranscriptionServeur({});
  assert.deepEqual([d.mode, d.modele, d.threads, d.essaisMax, d.delaiMaxH, d.disponible, d.ramMax, d.blocageMs, d.moteur], ['serveur', 'base', 4, 3, 24, false, 8 * 1024 ** 3, 45 * 60_000, 'auto']);
  assert.deepEqual(d.modelesOnnx, { rapide: 'small', equilibree: 'turbo', maximale: 'large-v3' });
  const c = configTranscriptionServeur({ TRANSCRIPTION_MODE: 'Navigateur', TRANSCRIPTION_MODELE: 'small', TRANSCRIPTION_THREADS: '99', TRANSCRIPTION_RAM_MAX: '1G', TRANSCRIPTION_REPOS: '0.5', TRANSCRIPTION_DOSSIER_MODELES: '/home/x/esport-modeles', TRANSCRIPTION_ONNX_MAXIMALE: 'medium', TRANSCRIPTION_BLOCAGE_MIN: '1' });
  assert.deepEqual([c.mode, c.modele, c.threads, c.ramMax, c.repos, c.dossierModeles, c.modelesOnnx.maximale, c.blocageMs], ['navigateur', 'small', 16, 1024 ** 3, 0.5, '/home/x/esport-modeles', 'medium', 10 * 60_000]);
  assert.equal(configTranscriptionServeur({ TRANSCRIPTION_MODELE: 'enorme', TRANSCRIPTION_MODE: 'n’importe' }).modele, 'base');
  assert.equal(configTranscriptionServeur({ TRANSCRIPTION_MODE: 'x' }).mode, 'serveur');
  assert.deepEqual([attenteEssai(1), attenteEssai(2)], [5 * 60_000, 15 * 60_000]);
});

test('audio : WAV 8 kHz → PCM 16 kHz (durée gardée), morceaux ≤ 30 s coupés dans le silence, reprise identique', () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-audio-'));
  try {
    // 95 s : parole simulée (sinus) avec un silence de 0,5 s à 24 s et à 50 s.
    const n = 95 * 8000;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i / 8000;
      pcm[i] = (s > 24 && s < 24.5) || (s > 50 && s < 50.5) ? 0 : 0.3 * Math.sin((2 * Math.PI * 220 * i) / 8000);
    }
    ecrireWav(join(d, 'a.wav'), pcm, 8000);
    wavVersPcm(join(d, 'a.wav'), join(d, 'a.pcm'));
    assert.ok(Math.abs(dureePcm(join(d, 'a.pcm')) - 95) < 0.01);
    const f1 = fenetreSuivante(join(d, 'a.pcm'), 0);
    assert.ok(f1.fin > 24 && f1.fin < 24.5, `coupe dans le silence : ${f1.fin}`);
    const f2 = fenetreSuivante(join(d, 'a.pcm'), f1.fin);
    assert.ok(f2.fin > 50 && f2.fin < 50.5, `coupe dans le silence : ${f2.fin}`);
    const f3 = fenetreSuivante(join(d, 'a.pcm'), f2.fin);
    assert.ok(f3.fin - f3.debut <= 30);
    // Déterministe : la reprise à f2.debut retombe sur la même coupe.
    assert.deepEqual(fenetreSuivante(join(d, 'a.pcm'), f1.fin), f2);
    assert.equal(lirePcm(join(d, 'a.pcm'), 10, 12).length, 32000);
    // Sans ffmpeg, un format autre que WAV est refusé avec un message clair.
    writeFileSync(join(d, 'b.mp3'), Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]));
    return assert.rejects(decoderVersPcm({ source: join(d, 'b.mp3'), sortie: join(d, 'b.pcm') }), /ffmpeg/);
  } finally {
    setTimeout(() => rmSync(d, { recursive: true, force: true }), 100);
  }
});

test('Whisper (sans modèle) : filtres mel, log-mel 80 × 3000 normalisé, boucles de répétition, métadonnées ONNX', () => {
  const f = filtres();
  assert.equal(f.length, 80 * 201);
  assert.ok(f.every(x => x >= 0));
  const pcm = Float32Array.from({ length: 16000 * 2 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 16000));
  const mel = logMel(pcm);
  assert.equal(mel.length, 80 * 3000);
  const max = mel.reduce((m, x) => Math.max(m, x), -Infinity);
  const min = mel.reduce((m, x) => Math.min(m, x), Infinity);
  assert.ok(max <= 1.5 + 1e-6 && min >= max - 2 - 1e-6, 'plage de Whisper : (log10 + 4) / 4, 8 décades au plus');
  assert.deepEqual(couperRepetitions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).coupe, false);
  const boucle = [5, 6, ...Array.from({ length: 6 }, () => [7, 8, 9]).flat()];
  assert.deepEqual(couperRepetitions(boucle), { ids: [5, 6, 7, 8, 9], coupe: true });
  // Protobuf minimal : ModelProto { ir_version = 7 (champ 1), metadata_props (champ 14) { key, value } }.
  const d = mkdtempSync(join(tmpdir(), 'esport-onnx-'));
  try {
    const entree = Buffer.concat([Buffer.from([0x0a, 3]), Buffer.from('sot'), Buffer.from([0x12, 5]), Buffer.from('50258')]);
    writeFileSync(join(d, 'm.onnx'), Buffer.concat([Buffer.from([0x08, 7]), Buffer.from([0x72, entree.length]), entree]));
    assert.deepEqual(metadonneesOnnx(join(d, 'm.onnx')), { sot: '50258' });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('verrou du processus : un seul à la fois, verrou d’un processus mort remplacé', () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-verrou-'));
  try {
    const v = join(d, 'v');
    assert.equal(prendreVerrou(v), true);
    assert.equal(verrouActif(v), true);
    assert.equal(prendreVerrou(v), false, 'déjà pris');
    rmSync(v);
    writeFileSync(v, '999999999');
    assert.equal(verrouActif(v), false);
    assert.equal(prendreVerrou(v), true, 'processus mort : verrou repris');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ File, PDF, notifications

test('dépôt en mode serveur : travail en file, transcrit par morceaux, PDF, notifications au déposant et aux rédacteurs', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { secondes: 70 });
    assert.equal(depot.transcription.statut, 'serveur');
    assert.equal(depot.transcription.serveur, true);
    assert.equal(depot.transcription.travail.statut, 'attente');
    const t0 = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 });
    assert.equal(t0.corps.travail.statut, 'attente');
    assert.equal(t0.corps.travail.rang, 0);
    // Progression vue de l'app pendant le travail (au 2e morceau).
    let pendant;
    const sim = simule({
      crochet: async n => {
        if (n === 2) pendant = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
        b.horloge.t += 3000; // 3 s de calcul par morceau
      },
    });
    const bilan = await executer(b, dossier, sim);
    assert.deepEqual([bilan.termines, bilan.echecs], [1, 0]);
    assert.equal(sim.appels.length, 3, 'trois morceaux (30 + 30 + 10 s)');
    assert.ok(sim.appels.every(s => s <= 30));
    assert.equal(pendant.statut, 'serveur');
    assert.equal(pendant.travail.statut, 'en_cours');
    assert.ok(pendant.travail.pourcentage > 0 && pendant.travail.pourcentage < 100, `pourcentage ${pendant.travail.pourcentage}`);
    assert.ok(pendant.travail.restantS > 0);
    assert.equal(pendant.segments.length, 1, 'le premier morceau est déjà enregistré');
    const fin = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.equal(fin.statut, 'prete');
    assert.equal(fin.partielle, false);
    assert.equal(fin.segments.length, 3);
    assert.equal(fin.moteur, 'Whisper simulé (serveur)');
    assert.ok(Math.abs(fin.duree - 70) < 0.2);
    assert.ok(fin.pdf, 'PDF généré par le serveur');
    assert.equal(fin.travail.statut, 'termine');
    assert.equal(fin.travail.pourcentage, 100);
    const lien = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/lien`, { methode: 'POST', jeton: A.sessions.lea12345, corps: {} })).corps;
    const pdf = await b.brut(lien.url);
    assert.equal(pdf.status, 200);
    assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5)), '%PDF-');
    // Notifications : le déposant (même s'il a demandé la transcription) et les rédacteurs ; pas les autres joueurs.
    assert.equal((await notifs(b, A.sessions.lea12345, 'transcription-prete')).length, 1);
    assert.equal((await notifs(b, A.sessions.man12345, 'transcription-prete')).length, 1);
    assert.equal((await notifs(b, A.sessions.tom12345, 'transcription-prete')).length, 0);
    assert.ok(await b.base.premier("SELECT id FROM journal WHERE action = 'meeting.transcription_ready' AND acteur_id IS NULL", []));
    // Le fichier audio temporaire est effacé ; la file est vide.
    assert.deepEqual(readdirSync(join(dossier, 'travail')), []);
    assert.equal(await servicesFileTranscription({ base: b.base, maintenant: () => b.horloge.t }).nombreAFaire(), 0);
    // La transcription se corrige ensuite comme avant (PDF régénéré).
    const corrige = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: A.sessions.man12345, corps: { segments: fin.segments.map(s => ({ ...s, texte: s.texte.toUpperCase() })), langue: 'fr', moteur: fin.moteur } });
    assert.equal(corrige.statut, 200);
    assert.equal(corrige.corps.statut, 'prete');
  } finally {
    nettoyer();
  }
});

test('bail : deux processus ne prennent jamais le même travail ; ordre d’arrivée ; rang dans la file', async () => {
  const { b, A, nettoyer } = await preparer();
  try {
    const d1 = await deposer(b, A, { secondes: 5, titre: 'Premier' });
    b.horloge.t += 1000;
    const d2 = await deposer(b, A, { secondes: 5, titre: 'Second' });
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${d2.id}/transcription`, { jeton: A.sessions.lea12345 })).corps.travail.rang, 1);
    const f1 = servicesFileTranscription({ base: b.base, maintenant: () => b.horloge.t });
    const f2 = servicesFileTranscription({ base: b.base, maintenant: () => b.horloge.t });
    const [p1, p2] = await Promise.all([f1.prendre(), f2.prendre()]);
    assert.ok(p1 && p2);
    assert.notEqual(p1.id, p2.id);
    assert.deepEqual(new Set([p1.reunion_id, p2.reunion_id]), new Set([d1.id, d2.id]));
    assert.equal(await f1.prendre(), null, 'plus rien à prendre');
    assert.equal(await f1.nombreAFaire(), 0);
    // Long calcul (décodage d'une longue vidéo) : le bail est prolongé, le travail reste à son processus.
    b.horloge.t += BAIL_MS - 60_000;
    assert.equal(await f1.prolonger(p1.id), true);
    assert.equal(await f1.prolonger(p2.id), true);
    b.horloge.t += BAIL_MS - 60_000;
    assert.equal(await f1.nombreAFaire(), 0, 'bail prolongé : pas repris');
    // Bail expiré : le travail redevient disponible.
    b.horloge.t += BAIL_MS + 1000;
    assert.equal(await f1.nombreAFaire(), 2);
  } finally {
    nettoyer();
  }
});

test('reprise après interruption (processus tué) : repart au dernier morceau fait, sans doublon ni essai compté', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { secondes: 95 });
    // 1er processus : tué pendant le 3e morceau (la promesse ne se termine jamais).
    const tue = simule({ crochet: n => (n === 3 ? new Promise(() => undefined) : undefined) });
    void executer(b, dossier, tue);
    for (let i = 0; i < 200 && tue.appels.length < 3; i++) await new Promise(ok => setTimeout(ok, 5));
    assert.equal(tue.appels.length, 3);
    const w = await travail(b, depot.id);
    assert.equal(w.statut, 'en_cours');
    assert.ok(Number(w.progression_s) >= 50 && Number(w.progression_s) <= 60, `progression ${w.progression_s}`);
    // Tant que le bail court, personne d'autre ne le prend.
    const vide = simule();
    assert.equal((await executer(b, dossier, vide)).termines, 0);
    assert.equal(vide.appels.length, 0);
    // Bail expiré : un nouveau processus reprend au morceau suivant.
    b.horloge.t += BAIL_MS + 60_000;
    const suite = simule();
    const bilan = await executer(b, dossier, suite);
    assert.equal(bilan.termines, 1);
    assert.equal(suite.appels.length, 2, 'les deux morceaux restants seulement');
    const fin = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.equal(fin.statut, 'prete');
    assert.equal(fin.segments.length, 4);
    const debuts = fin.segments.map(s => s.debut);
    assert.deepEqual(debuts, [...debuts].sort((x, y) => x - y));
    assert.equal(new Set(debuts).size, 4, 'aucun doublon');
    assert.equal(Number((await travail(b, depot.id)).essais), 0, 'il avait avancé : simple reprise');
  } finally {
    nettoyer();
  }
});

test('durée de vie du processus atteinte : le travail est rendu à la file (sans essai) puis terminé au passage suivant', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { secondes: 70 });
    const config = { ...SERVEUR, dureeTravailleurMin: 5 };
    const lent = simule({ crochet: () => void (b.horloge.t += 4 * 60_000) });
    const bilan = await executer(b, dossier, lent, { config });
    assert.deepEqual([bilan.termines, bilan.rendus], [0, 1]);
    const w = await travail(b, depot.id);
    assert.deepEqual([w.statut, Number(w.essais)], ['attente', 0]);
    assert.ok(Number(w.progression_s) > 0);
    const suite = simule();
    assert.equal((await executer(b, dossier, suite, { config })).termines, 1);
    assert.equal(lent.appels.length + suite.appels.length, 3);
  } finally {
    nettoyer();
  }
});

test('échec : réessais espacés, puis échec définitif → statut « échec », notification, repli navigateur possible', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { secondes: 5 });
    const casse = simule({ crochet: () => { throw new Error('Moteur en panne.'); } });
    assert.equal((await executer(b, dossier, casse)).echecs, 1);
    let w = await travail(b, depot.id);
    assert.deepEqual([w.statut, Number(w.essais), w.erreur], ['attente', 1, 'Moteur en panne.']);
    // Pas de nouvel essai avant l'heure.
    assert.equal((await executer(b, dossier, casse)).echecs, 0);
    b.horloge.t += attenteEssai(1) + 1000;
    assert.equal((await executer(b, dossier, casse)).echecs, 1);
    b.horloge.t += attenteEssai(2) + 1000;
    await executer(b, dossier, casse);
    w = await travail(b, depot.id);
    assert.deepEqual([w.statut, Number(w.essais)], ['echec', 3]);
    const t = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.equal(t.statut, 'echec');
    assert.equal(t.travail.statut, 'echec');
    assert.equal(t.erreur, 'Moteur en panne.');
    assert.equal((await notifs(b, A.sessions.lea12345, 'transcription-echec')).length, 1);
    assert.equal((await notifs(b, A.sessions.tom12345, 'transcription-echec')).length, 0);
    // Repli : la transcription dans le navigateur reste possible (PUT), et annule tout travail serveur.
    const navigateur = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: A.sessions.lea12345, corps: { segments: [{ debut: 0, fin: 5, texte: 'Faite dans le navigateur.' }], langue: 'fr', moteur: 'Whisper base (navigateur)' } });
    assert.equal(navigateur.corps.statut, 'prete');
    // Nouvel essai sur le serveur à la demande (Retranscrire).
    const re = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { langue: 'fr' } });
    assert.equal(re.statut, 200);
    assert.equal(re.corps.statut, 'serveur');
    assert.deepEqual([re.corps.travail.statut, re.corps.travail.essais], ['attente', 0]);
  } finally {
    nettoyer();
  }
});

test('processus mort sans avancer : un essai compté à chaque fois, échec définitif au 3e', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { secondes: 5 });
    const f = servicesFileTranscription({ base: b.base, maintenant: () => b.horloge.t });
    for (let i = 1; i <= 3; i++) {
      assert.ok(await f.prendre(), `prise ${i}`);
      b.horloge.t += BAIL_MS + 1000;
      await cote(b).recupererTravauxServeur();
    }
    const w = await travail(b, depot.id);
    assert.equal(w.statut, 'echec');
    assert.match(w.erreur, /Interrompue trop souvent/);
    assert.equal((await b.base.premier('SELECT transcription_statut FROM reunions WHERE id = ?', [depot.id])).transcription_statut, 'echec');
    void dossier;
  } finally {
    nettoyer();
  }
});

test('garde-fous : format illisible et mémoire dépassée = échec définitif immédiat ; délai maximal dépassé', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const d1 = await deposer(b, A, { secondes: 5 });
    // Mémoire : au-delà du plafond, arrêt propre (message simple, sans chemin du serveur).
    const bilan = await executer(b, dossier, simule(), { memoire: () => 10 * 1024 ** 3 });
    assert.equal(bilan.echecs, 1);
    const w1 = await travail(b, d1.id);
    assert.equal(w1.statut, 'echec');
    assert.match(w1.erreur, /Mémoire insuffisante.*« Rapide ».*TRANSCRIPTION_RAM_MAX/);
    // Délai maximal : un travail resté en attente trop longtemps échoue.
    const d2 = await deposer(b, A, { secondes: 5, titre: 'Oubliée' });
    b.horloge.t += 25 * 3_600_000;
    await executer(b, dossier, simule(), { creerTranscripteur: async () => { throw new Error('ne doit pas être chargé'); } });
    const w2 = await travail(b, d2.id);
    assert.equal(w2.statut, 'echec');
    assert.match(w2.erreur, /Délai maximal/);
  } finally {
    nettoyer();
  }
});

test('annulation : DELETE ou transcription faite ailleurs ; dépôt retiré ; le processus ignore le travail', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const d1 = await deposer(b, A, { secondes: 5 });
    const del = await b.appel(`/teams/${A.teamId}/resumes/${d1.id}/transcription/serveur`, { methode: 'DELETE', jeton: A.sessions.lea12345 });
    assert.equal(del.corps.statut, 'a_faire');
    assert.equal(del.corps.travail.statut, 'annule');
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${d1.id}/transcription/serveur`, { methode: 'DELETE', jeton: A.sessions.tom12345 })).statut, 403);
    const d2 = await deposer(b, A, { secondes: 5, titre: 'Retirée' });
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${d2.id}`, { methode: 'DELETE', jeton: A.sessions.lea12345 })).statut, 200);
    assert.equal((await travail(b, d2.id)).statut, 'annule');
    const sim = simule();
    assert.equal((await executer(b, dossier, sim)).termines, 0);
    assert.equal(sim.appels.length, 0);
  } finally {
    nettoyer();
  }
});

test('visibilité staff : réunion staff transcrite sur le serveur, invisible (404) pour un Joueur, notifiée au staff seulement', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { jeton: A.sessions.coa12345, type: TYPE_STAFF, titre: 'Point staff', secondes: 5 });
    await executer(b, dossier, simule());
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).statut, 404);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: {} })).statut, 404);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.man12345 })).corps.statut, 'prete');
    assert.equal((await notifs(b, A.sessions.coa12345, 'transcription-prete')).length, 1, 'le déposant (coach)');
    assert.equal((await notifs(b, A.sessions.man12345, 'transcription-prete')).length, 1, 'le rédacteur');
    assert.equal((await notifs(b, A.sessions.lea12345, 'transcription-prete')).length, 0);
  } finally {
    nettoyer();
  }
});

test('mode de la team (Paramètres) : lecture par les membres, changement par team.manage ; serveur absent → navigateur', async () => {
  const { b, A, nettoyer } = await preparer();
  try {
    const r0 = await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { jeton: A.sessions.lea12345 });
    assert.deepEqual([r0.corps.mode, r0.corps.choisi, r0.corps.disponibles.serveur, r0.corps.modifiable], ['serveur', null, true, false]);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.lea12345, corps: { mode: 'navigateur' } })).statut, 403);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { mode: 'magie' } })).statut, 400);
    const r1 = await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { mode: 'navigateur' } });
    assert.deepEqual([r1.corps.mode, r1.corps.choisi, r1.corps.modifiable], ['navigateur', 'navigateur', true]);
    // API externe choisie mais pas activée : le mode effectif retombe sur le serveur.
    const r2 = await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { mode: 'externe' } });
    assert.equal(r2.corps.mode, 'serveur');
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { mode: null } })).corps.choisi, null);
  } finally {
    nettoyer();
  }
  // Serveur sans moteur installé : le dépôt « serveur » reste « à transcrire » (l'app propose le navigateur).
  const p = await preparer({ serveur: { ...SERVEUR, disponible: false } });
  try {
    const r = await p.b.appel(`/teams/${p.A.teamId}/resumes/reglages-transcription`, { jeton: p.A.sessions.lea12345 });
    assert.deepEqual([r.corps.mode, r.corps.disponibles.serveur], ['navigateur', false]);
    const depot = await deposer(p.b, p.A, { secondes: 3 });
    assert.equal(depot.transcription.statut, 'a_faire');
    assert.equal(depot.transcription.serveur, false);
    assert.equal((await p.b.appel(`/teams/${p.A.teamId}/resumes/${depot.id}/transcription/serveur`, { methode: 'POST', jeton: p.A.sessions.lea12345, corps: {} })).corps.code, 'transcription-serveur-absente');
    assert.equal((await p.b.appel('/sante')).corps.medias.transcriptionServeur, false);
  } finally {
    p.nettoyer();
  }
});

test('cron : lance le processus détaché (nice 19) seulement s’il y a du travail et pas d’autre processus', async () => {
  const { b, A, dossier, nettoyer } = await preparer();
  try {
    const config = { transcriptionServeur: { ...SERVEUR, dossierModeles: dossier } };
    const lances = [];
    const spawn = (cmd, args, opts) => {
      lances.push({ cmd, args, opts });
      return { unref() {} };
    };
    const journalFichier = join(dossier, 'logs', 't.log');
    assert.equal((await lancerTravailleur({ base: b.base, config, maintenant: () => b.horloge.t, spawn, fichierJournal: journalFichier })).raison, 'rien à faire');
    await deposer(b, A, { secondes: 3 });
    const r = await lancerTravailleur({ base: b.base, config, maintenant: () => b.horloge.t, spawn, fichierJournal: journalFichier });
    assert.equal(r.lance, true);
    assert.equal(lances.length, 1);
    const ligne = [lances[0].cmd, ...lances[0].args].join(' ');
    assert.match(ligne, /travailleur\.mjs$/);
    if (existsSync('/usr/bin/nice') || existsSync('/bin/nice')) assert.match(ligne, /nice -n 19 /);
    assert.equal(lances[0].opts.detached, true);
    // Un processus vivant tient le verrou : rien de plus.
    writeFileSync(join(dossier, 'travailleur.verrou'), String(process.pid));
    assert.equal((await lancerTravailleur({ base: b.base, config, maintenant: () => b.horloge.t, spawn, fichierJournal: journalFichier })).raison, `déjà en cours (pid ${process.pid})`);
    assert.equal(lances.length, 1);
    // Dernière décision notée pour l'Administration (et le journal du cron).
    assert.match(readFileSync(join(dossier, 'lanceur.json'), 'utf8'), /"raison":"déjà en cours \(pid \d+\)","n":1/);
    // Moteur pas installé : rien n'est lancé.
    assert.equal((await lancerTravailleur({ base: b.base, config: { transcriptionServeur: { ...SERVEUR, disponible: false } }, spawn })).lance, false);
    // Branché dans le cron du serveur (rapport).
    const rapport = await executerCron(b.base, { ...config, cleSession: 'x'.repeat(40) }, { maintenant: () => b.horloge.t, stockage: b.stockage, fetchImportJeux: async () => { throw new Error('réseau interdit en test'); }, lancer: async () => ({ lance: true, raison: 'lancé', n: 1 }) });
    assert.ok(rapport.some(x => x.tache === 'transcription serveur' && x.ok));
  } finally {
    nettoyer();
  }
});

test('déploiement automatique : deployer.sh ne touche ni au moteur ni au modèle (jamais retéléchargés)', async () => {
  const { readFileSync } = await import('node:fs');
  const script = readFileSync(new URL('../serveur/deployer.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /esport-modeles|installer-transcription|huggingface|onnxruntime/);
  const installateur = readFileSync(new URL('../serveur/installer-transcription.sh', import.meta.url), 'utf8');
  assert.match(installateur, /installer\.mjs/);
  // Le moteur n'est pas une dépendance du serveur (npm install de deployer.sh) : il vit hors du dépôt.
  const paquet = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(paquet.dependencies['onnxruntime-node'], undefined);
});

test('RGPD : la suppression du compte efface « demandé par » du travail de transcription', async () => {
  const { b, A, nettoyer } = await preparer();
  try {
    const depot = await deposer(b, A, { secondes: 3 });
    assert.equal((await travail(b, depot.id)).demande_par, 'lea12345');
    const r = await b.appel('/moi', { methode: 'DELETE', jeton: A.sessions.lea12345 });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal((await travail(b, depot.id)).demande_par, null);
  } finally {
    nettoyer();
  }
});

// ------------------------------------------------------------------ Intégration avec le VRAI moteur

const dossierModeles = process.env.TRANSCRIPTION_DOSSIER_MODELES || join(process.env.HOME ?? '', 'esport-modeles');
const modeleReel = ['base', 'tiny', 'small'].find(m => existsSync(join(dossierModeles, `whisper-${m}`, `${m}-encoder.int8.onnx`)) && existsSync(join(dossierModeles, 'moteur', 'node_modules', 'onnxruntime-node')));
const echantillon = modeleReel ? join(dossierModeles, 'essai', 'essai.wav') : null;

test(
  'intégration : vrai Whisper (ONNX Runtime) sur un court enregistrement, de bout en bout (file → PDF)',
  { skip: !modeleReel || !existsSync(echantillon) ? `pas de modèle installé dans ${dossierModeles} (lancer esport/serveur/installer-transcription.sh) : test sauté` : false, timeout: 300_000 },
  async () => {
    const { creerTranscripteurWhisper, cheminFfmpeg } = await import('../serveur/transcription/moteur.mjs');
    const config = { ...SERVEUR, modele: modeleReel, dossierModeles, threads: 1 };
    const { b, A, dossier, nettoyer } = await preparer({ serveur: config });
    try {
      const { readFileSync } = await import('node:fs');
      const octets = new Uint8Array(readFileSync(echantillon));
      const enr = await envoyer(b, A.sessions.lea12345, A.teamId, octets, { section: 'resumes', nom: 'essai.wav' });
      const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre: 'Essai réel', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id, transcription: 'serveur', langue: 'en' } })).corps;
      const bilan = await executerTravaux({
        resumes: cote(b, config),
        stockage: b.stockage,
        config,
        creerTranscripteur: () => creerTranscripteurWhisper(config),
        ffmpeg: cheminFfmpeg(config),
        dossierTravail: join(dossier, 'travail'),
        journal: { log() {}, error() {} },
      });
      assert.equal(bilan.termines, 1);
      const t = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
      assert.equal(t.statut, 'prete');
      assert.match(t.segments.map(s => s.texte).join(' ').toLowerCase(), /nightfall|yellow lamps/);
      assert.ok(t.pdf);
    } finally {
      nettoyer();
    }
  },
);
