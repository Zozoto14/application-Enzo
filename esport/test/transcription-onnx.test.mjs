/**
 * Transcription DANS LE PROCESSUS NODE (ONNX Runtime, moteur par défaut) et robustesse de la file :
 *  - décodeur Whisper avec un FAUX ONNX Runtime (aucun modèle, aucun téléchargement) : découpage en jetons (BPE),
 *    prompt de vocabulaire + texte précédent (<|startofprev|>), 128 bandes mel (large-v3 / turbo), recherche en
 *    faisceau contre glouton, jetons non parlés supprimés, « pas de parole », températures de repli sur une boucle ;
 *  - whisper.cpp ARRÊTÉ DE FORCE (SIGKILL que nous n'avons pas envoyé) : bascule automatique sur ONNX pour le même
 *    travail (sans essai compté), whisper.cpp désactivé pour la suite ;
 *  - file : échec affiché honnêtement (raison, heure du nouvel essai, essais restants), travail bloqué signalé,
 *    « Relancer maintenant », verrou orphelin remplacé, chien de garde d'un processus figé.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import { envoyer, wavFactice } from './medias-aide.mjs';
import { configTranscriptionServeur, qualiteEffective } from '../noyau/medias/fileTranscription.mjs';
import { servicesMedias } from '../noyau/medias/service.mjs';
import { servicesResumes } from '../noyau/resumes.mjs';
import { chargerWhisper, creerEncodeur, tauxCompression, texteDesJetons } from '../serveur/transcription/whisper.mjs';
import { energieAutour, zoneDeParole } from '../serveur/transcription/audio.mjs';
import { echoDuPrompt, executerTravaux, prendreVerrou, verrouActif } from '../serveur/transcription/travailleur.mjs';
import { lancerTravailleur } from '../serveur/transcription/lanceur.mjs';
import { creerTranscripteurWhisperCpp } from '../serveur/transcription/whispercpp.mjs';
import { chemins, creerTranscripteurOnnx, desactivationWhisperCpp, desactiverWhisperCpp } from '../serveur/transcription/moteur.mjs';
import { planDepuisArbre, planOnnx, sha1Git } from '../serveur/transcription/installer.mjs';

const MIO = 1024 * 1024;
const TYPE_HEBDO = '00000000-0000-4000-8000-000000000001';

// ------------------------------------------------------------------ Faux modèle Whisper (sherpa-onnx)

/** ModelProto minimal : ir_version + metadata_props (ce que lit metadonneesOnnx). */
function modeleOnnx(meta) {
  const varint = n => {
    const b = [];
    while (n >= 0x80) {
      b.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    b.push(n);
    return Buffer.from(b);
  };
  const champ = (num, buf) => Buffer.concat([varint((num << 3) | 2), varint(buf.length), buf]);
  const parts = [Buffer.from([0x08, 7])];
  for (const [k, v] of Object.entries(meta)) parts.push(champ(14, Buffer.concat([champ(1, Buffer.from(k)), champ(2, Buffer.from(String(v)))])));
  return Buffer.concat(parts);
}

// Vocabulaire : 0 « ! » (non parlé), 1 « A », 2 « B », 3 « ␣ », 4 « a », 5 « b », 6 « ␣a », 7 « ab », 8 « ␣ab »,
// 9 « ␣Bonjour », 10 et 11 : les deux octets de « é », 12 « x » ; spéciaux à partir de 20.
const VOCAB = ['!', 'A', 'B', ' ', 'a', 'b', ' a', 'ab', ' ab', ' Bonjour', Buffer.from([0xc3]), Buffer.from([0xa9]), 'x'];
const EOT = 20;
const SOT = 21;
const SOT_PREV = 22;
const TRANSCRIBE = 23;
const NO_TS = 24;
const NO_SPEECH = 25;
const FR = 26;
const V = 30;
const META = { n_text_layer: 1, n_text_ctx: 448, n_text_state: 2, n_mels: 128, sot: SOT, eot: EOT, sot_prev: SOT_PREV, transcribe: TRANSCRIBE, no_timestamps: NO_TS, no_speech: NO_SPEECH, blank_id: 3, all_language_codes: 'fr,en', all_language_tokens: `${FR},27`, is_multilingual: 1, non_speech_tokens: '0' };

function fauxModele(d, nom = 'turbo') {
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${nom}-encoder.int8.onnx`), modeleOnnx(META));
  writeFileSync(join(d, `${nom}-decoder.int8.onnx`), modeleOnnx({}));
  const lignes = VOCAB.map((t, i) => `${Buffer.from(t).toString('base64')} ${i}`);
  for (let i = EOT; i < V; i++) lignes.push(`${Buffer.from(`<|${i}|>`).toString('base64')} ${i}`);
  writeFileSync(join(d, `${nom}-tokens.txt`), `${lignes.join('\n')}\n`);
}

/**
 * Faux ONNX Runtime : l'encodeur note la forme du mel ; le décodeur garde la séquence de jetons DANS le cache
 * (jeton + 1 à chaque position), et ses logits viennent de `script(sequence)` (Float32Array de V).
 */
function fauxOrt(script) {
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
    }
  }
  const appels = { encodeur: [], decodeur: [] };
  const encodeur = {
    async run(feeds) {
      appels.encodeur.push(feeds.mel.dims);
      return { n_layer_cross_k: new Tensor('float32', new Float32Array(1), [1]), n_layer_cross_v: new Tensor('float32', new Float32Array(1), [1]) };
    },
    release: async () => undefined,
  };
  const decodeur = {
    async run(feeds) {
      const jetons = Array.from(feeds.tokens.data, Number);
      const decalage = Number(feeds.offset.data[0]);
      appels.decodeur.push({ jetons, decalage });
      const cache = Float32Array.from(feeds.in_n_layer_self_k_cache.data);
      jetons.forEach((j, i) => (cache[(decalage + i) * 2] = j + 1));
      const logits = new Float32Array(jetons.length * V);
      for (let i = 0; i < jetons.length; i++) {
        const seq = [];
        for (let p = 0; p <= decalage + i; p++) seq.push(cache[p * 2] - 1);
        logits.set(script(seq), i * V);
      }
      const cacheTenseur = new Tensor('float32', cache, feeds.in_n_layer_self_k_cache.dims);
      return { logits: new Tensor('float32', logits, [1, jetons.length, V]), out_n_layer_self_k_cache: cacheTenseur, out_n_layer_self_v_cache: cacheTenseur };
    },
    release: async () => undefined,
  };
  return { appels, ort: { Tensor, InferenceSession: { create: async chemin => (chemin.includes('encoder') ? encodeur : decodeur) } } };
}

const genere = seq => seq.slice(seq.lastIndexOf(NO_TS) + 1);
const logits = valeurs => {
  const l = new Float32Array(V).fill(-10);
  for (const [i, v] of Object.entries(valeurs)) l[Number(i)] = v;
  return l;
};
const parole = Float32Array.from({ length: 16000 * 3 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 300 * i) / 16000));

test('BPE de Whisper : rangs = identifiants, fusions dans l’ordre, octets UTF-8 ; texte rendu', () => {
  const jetons = VOCAB.map(t => Buffer.from(t));
  const enc = creerEncodeur(jetons, EOT);
  assert.deepEqual(enc(' ab ab'), [8, 8]);
  assert.deepEqual(enc('abab'), [7, 7], 'fusion de plus petit rang d’abord');
  assert.deepEqual(enc('é'), [10, 11], 'octets UTF-8 sans fusion connue');
  assert.equal(texteDesJetons(jetons, [9, 3, 10, 11, 21], EOT), 'Bonjour é', 'jetons spéciaux ignorés');
  assert.ok(tauxCompression('merci '.repeat(40)) > 2.4);
  assert.ok(tauxCompression('On joue Jett sur Ascent, puis on retake B.') < 2.4);
});

test('décodeur ONNX (faux ONNX Runtime) : 128 bandes mel, prompt et texte précédent, faisceau ≠ glouton, jeton non parlé supprimé', async () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-onnx-'));
  try {
    fauxModele(d);
    // Après l'invite : « ! » (non parlé) en tête, puis A (2,0) et B (1,9). Après A : tout se vaut (peu sûr) ;
    // après B : fin de texte certaine. Le glouton prend A (puis « a »), le faisceau trouve B, plus probable au total.
    const script = seq => {
      const g = genere(seq);
      if (!g.length) return logits({ 0: 5, 1: 2, 2: 1.9 });
      if (g.length === 1 && g[0] === 1) return logits({ 4: 0, 5: 0, 12: 0, [EOT]: 0 });
      return logits({ [EOT]: 10 });
    };
    const { ort, appels } = fauxOrt(script);
    const w = await chargerWhisper({ ort, dossier: d, nom: 'turbo', threads: 2 });
    assert.equal(w.infos.nMels, 128);
    const glouton = await w.transcrireMorceau(parole, { langue: 'fr', prompt: 'ab ab', precedent: [1, 2], beam: 1 });
    assert.deepEqual(appels.encodeur[0], [1, 128, 3000], 'large-v3 / turbo : 128 bandes mel');
    // Invite : <|startofprev|> + vocabulaire (BPE) + texte précédent, puis <|startoftranscript|> fr transcribe notimestamps.
    assert.deepEqual(appels.decodeur[0].jetons, [SOT_PREV, 8, 8, 1, 2, SOT, FR, TRANSCRIBE, NO_TS]);
    assert.equal(glouton.texte, 'Aa');
    assert.ok(!glouton.ids.includes(0), 'jeton non parlé supprimé');
    const faisceau = await w.transcrireMorceau(parole, { langue: 'fr', beam: 5 });
    assert.equal(faisceau.texte, 'B');
    assert.equal(faisceau.temperature, 0);
    assert.ok(faisceau.logprob > glouton.logprob);
    // Silence : rien n'est calculé.
    const n = appels.encodeur.length;
    const silence = await w.transcrireMorceau(new Float32Array(16000), { langue: 'fr' });
    assert.equal(silence.silence, true);
    assert.equal(appels.encodeur.length, n);
    // Le transcripteur du serveur reprend ces réglages par qualité (faisceau 5 pour « équilibrée »).
    const t = await creerTranscripteurOnnx({ ...configTranscriptionServeur({}), dossierModeles: d }, { nom: 'turbo', qualite: 'equilibree', ort, dossier: d });
    assert.deepEqual([t.decodage.beam, t.cle, t.moteur], [5, 'onnx:turbo:equilibree', 'Whisper large-v3-turbo (serveur, ONNX)']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('décodeur ONNX : « pas de parole » sûr → rien ; boucle → températures de repli puis boucle coupée', async () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-onnx-'));
  try {
    fauxModele(d);
    // 1. Probabilité « pas de parole » forte à <|startoftranscript|> et décodage hésitant : texte vide.
    const hesitant = seq => (seq[seq.length - 1] === SOT ? logits({ [NO_SPEECH]: 20 }) : logits({ 1: 0, 2: 0, 4: 0, 5: 0, 12: 0, [EOT]: 0 }));
    let f = fauxOrt(hesitant);
    let w = await chargerWhisper({ ort: f.ort, dossier: d, nom: 'turbo' });
    const r1 = await w.transcrireMorceau(parole, { langue: 'fr', beam: 1 });
    assert.equal(r1.texte, '');
    assert.equal(r1.silence, true);
    // 2. « x x x x… » à toutes les températures : chaque essai est rejeté, le dernier est rendu, boucle coupée.
    const boucle = seq => (genere(seq).length === 0 || genere(seq).at(-1) === 12 ? logits({ 12: 6 }) : logits({ [EOT]: 6 }));
    f = fauxOrt(boucle);
    w = await chargerWhisper({ ort: f.ort, dossier: d, nom: 'turbo' });
    const r2 = await w.transcrireMorceau(parole, { langue: 'fr', beam: 2, bestOf: 2, temperatures: [0, 0.5, 1] });
    assert.equal(r2.temperature, 1, 'toutes les températures essayées');
    assert.equal(r2.boucle, true);
    assert.equal(r2.texte, 'x');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('détection de la parole et coupe : zone de parole seule, silence ignoré ; écho du prompt écarté', () => {
  const pcm = new Float32Array(16000 * 10);
  for (let i = 16000 * 3; i < 16000 * 5; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / 16000);
  const z = zoneDeParole(pcm);
  assert.ok(Math.abs(z.debut / 16000 - 2.8) < 0.05 && Math.abs(z.fin / 16000 - 5.2) < 0.05, JSON.stringify(z));
  assert.equal(zoneDeParole(new Float32Array(16000 * 5)), null);
  assert.equal(echoDuPrompt('Joueurs : Léa, Tom.', 'Réunion de l’équipe Faucons. Joueurs : Léa, Tom. Maps : Ascent.'), true);
  assert.equal(echoDuPrompt('On joue Ascent ce soir.', 'Réunion de l’équipe Faucons. Joueurs : Léa, Tom. Maps : Ascent.'), false);
  const d = mkdtempSync(join(tmpdir(), 'esport-coupe-'));
  try {
    const b = Buffer.alloc(16000 * 2 * 4);
    for (let i = 16000; i < 16000 * 4; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 200 * i) / 16000)), i * 2);
    writeFileSync(join(d, 'a.pcm'), b);
    assert.ok(energieAutour(join(d, 'a.pcm'), 0.5) < 0.01);
    assert.ok(energieAutour(join(d, 'a.pcm'), 2) > 0.1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ Processus de fond

async function preparer(serveur) {
  const b = await banc({ medias: { plafond: 8 * MIO, tailleMorceau: MIO }, transcriptionServeur: serveur });
  const A = await teamAvecMembres(b, { nom: 'Faucons', membres: { own12345: { pseudo: 'Owner', role: 'proprietaire' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const dossier = mkdtempSync(join(tmpdir(), 'esport-transcription-'));
  return { b, A, dossier, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

function cote(b, config) {
  const socle = { contexteTeam: async () => { throw new Error('pas de contexte'); } };
  const medias = servicesMedias({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle });
  return servicesResumes({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle, medias, transcriptionServeur: config });
}

async function deposer(b, A, { secondes = 40, titre = 'Hebdo' } = {}) {
  const enr = await envoyer(b, A.sessions.lea12345, A.teamId, wavFactice(secondes, 8000), { section: 'resumes', nom: 'reunion.wav' });
  const r = await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre, typeId: TYPE_HEBDO, dateReunion: '2026-10-29', envoi: enr.id, transcription: 'serveur', langue: 'fr' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
}

const travail = (b, id) => b.base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [id]);
const etatApp = async (b, A, id) => (await b.appel(`/teams/${A.teamId}/resumes/${id}/transcription`, { jeton: A.sessions.lea12345 })).corps;

test('whisper.cpp ARRÊTÉ DE FORCE (SIGKILL) : bascule sur ONNX pour ce travail, sans essai compté ; whisper.cpp désactivé ensuite', async () => {
  const qualites = { rapide: { disponible: false, moteur: 'whispercpp', modele: null }, equilibree: { disponible: true, moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0', alternatives: [{ disponible: true, moteur: 'onnx', modele: 'turbo' }] }, maximale: { disponible: false, moteur: 'whispercpp', modele: null } };
  const SERVEUR = { ...configTranscriptionServeur({ TRANSCRIPTION_MOTEUR: 'whispercpp' }), disponible: true, repos: 0, blocS: 60, qualites };
  const { b, A, dossier, nettoyer } = await preparer(SERVEUR);
  try {
    const config = { ...SERVEUR, dossierModeles: dossier };
    const r = await deposer(b, A, { secondes: 40 });
    const crees = [];
    const journal = [];
    let bascules = 0;
    const bilan = await executerTravaux({
      resumes: cote(b, config),
      stockage: b.stockage,
      config,
      creerTranscripteur: async choix => {
        crees.push(`${choix.moteur}:${choix.modele}`);
        if (choix.moteur === 'whispercpp') {
          return {
            moteur: 'whisper.cpp (simulé)',
            cle: 'whispercpp:large-v3-turbo-q5_0:equilibree',
            async transcrireBloc() {
              throw Object.assign(new Error('whisper.cpp s’est arrêté (signal SIGKILL) : read_audio_data: trying to decode with miniaudio.'), { signal: 'SIGKILL', tueExterne: true });
            },
          };
        }
        return { moteur: 'Whisper large-v3-turbo (serveur, ONNX)', cle: 'onnx:turbo:equilibree', decodage: { beam: 5 }, encoder: () => [1], transcrireMorceau: async (pcm, o) => ({ texte: `Morceau de ${(pcm.length / 16000).toFixed(0)} s.`, ids: [1], langue: 'fr', temperature: 0, o }) };
      },
      surMoteurTue: async ({ erreur, qualite }) => {
        bascules += 1;
        desactiverWhisperCpp(config, `arrêté de force (${erreur.signal})`);
        return qualiteEffective(config, qualite, { exclure: ['whispercpp'] });
      },
      dossierTravail: join(dossier, 'travail'),
      horloge: () => b.horloge.t,
      dormir: async () => undefined,
      journal: { log: t => journal.push(t), error: t => journal.push(t) },
    });
    assert.equal(bilan.termines, 1);
    assert.equal(bilan.echecs, 0);
    assert.equal(bascules, 1);
    assert.deepEqual(crees, ['whispercpp:large-v3-turbo-q5_0', 'onnx:turbo']);
    assert.ok(journal.some(l => /arrêté de force par l’hébergeur \(SIGKILL\) ; bascule sur onnx turbo/.test(l)));
    const w = await travail(b, r.id);
    assert.deepEqual([w.statut, Number(w.essais)], ['termine', 0]);
    const x = await b.base.premier('SELECT moteur FROM transcriptions WHERE reunion_id = ?', [r.id]);
    assert.match(x.moteur, /ONNX/);
    assert.match(desactivationWhisperCpp(config).raison, /SIGKILL/);
  } finally {
    nettoyer();
  }
});

test('whisper.cpp : un SIGKILL venu de l’extérieur est reconnu ; notre propre arrêt (SIGTERM) ne l’est pas', async () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-tue-'));
  try {
    const binaire = join(d, 'whisper-cli');
    writeFileSync(binaire, '#!/bin/sh\necho "read_audio_data: trying to decode with miniaudio" >&2\nkill -9 $$\n');
    chmodSync(binaire, 0o755);
    const t = creerTranscripteurWhisperCpp({ binaire, fichierModele: join(d, 'm.bin'), nomModele: 'large-v3-turbo-q5_0', dossierTravail: d, nice: 0 });
    const e = await t.transcrireBloc(new Float32Array(16000), { langue: 'fr' }).catch(x => x);
    assert.equal(e.signal, 'SIGKILL');
    assert.equal(e.tueExterne, true);
    assert.match(e.message, /signal SIGKILL/);
    writeFileSync(binaire, '#!/bin/sh\nsleep 5\n');
    const t2 = creerTranscripteurWhisperCpp({ binaire, fichierModele: join(d, 'm.bin'), nomModele: 'small', dossierTravail: d, nice: 0 });
    const p = t2.transcrireBloc(new Float32Array(16000), { langue: 'fr' }).catch(x => x);
    await new Promise(ok => setTimeout(ok, 300));
    t2.arreter();
    const e2 = await p;
    assert.equal(e2.tueExterne, false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('file : échec affiché avec la raison, l’heure du nouvel essai et les essais restants ; bloquée → « Relancer maintenant »', async () => {
  const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0 };
  const { b, A, dossier, nettoyer } = await preparer(SERVEUR);
  try {
    const r = await deposer(b, A, { secondes: 10 });
    let e = await etatApp(b, A, r.id);
    assert.deepEqual([e.travail.statut, e.travail.bloque, e.travail.essaisRestants], ['attente', false, 3]);
    // Un essai échoue (moteur tué) : nouvel essai dans 5 min, raison et essais restants visibles.
    const bilan = await executerTravaux({
      resumes: cote(b, SERVEUR),
      stockage: b.stockage,
      config: SERVEUR,
      creerTranscripteur: async () => {
        throw new Error('ONNX Runtime introuvable.');
      },
      dossierTravail: join(dossier, 'travail'),
      horloge: () => b.horloge.t,
      dormir: async () => undefined,
      journal: { log() {}, error() {} },
    });
    assert.equal(bilan.echecs, 1);
    e = await etatApp(b, A, r.id);
    assert.equal(e.travail.statut, 'attente');
    assert.equal(e.travail.erreur, 'ONNX Runtime introuvable.');
    assert.equal(e.travail.essaisRestants, 2);
    assert.equal(Date.parse(e.travail.prochainEssai), b.horloge.t + 5 * 60_000);
    assert.equal(e.travail.bloque, false);
    // Le cron ne passe plus (processus figé, serveur arrêté…) : 20 min après l'heure prévue, l'app le dit.
    b.horloge.t += 25 * 60_000;
    e = await etatApp(b, A, r.id);
    assert.equal(e.travail.prochainEssai, null, 'jamais une heure déjà passée');
    assert.equal(e.travail.bloque, true);
    // « Relancer maintenant » : en tête de file, essais remis à zéro, plus d'erreur.
    const rel = await b.appel(`/teams/${A.teamId}/resumes/${r.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { relancer: true } });
    assert.equal(rel.statut, 200, JSON.stringify(rel.corps));
    const w = await travail(b, r.id);
    assert.deepEqual([w.statut, Number(w.essais), w.erreur, w.prochain_essai_le], ['attente', 0, '', null]);
    assert.equal(rel.corps.travail.bloque, false);
    // Un travail EN COURS bien vivant n'est pas touché par « Relancer ».
    await b.base.executer("UPDATE travaux_transcription SET statut = 'en_cours', verrou_jusqua = ? WHERE id = ?", [new Date(b.horloge.t + 600_000).toISOString(), w.id]);
    await b.appel(`/teams/${A.teamId}/resumes/${r.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { relancer: true } });
    assert.equal((await travail(b, r.id)).statut, 'en_cours');
    // Bail expiré (processus mort) : signalé, et relançable.
    b.horloge.t += 20 * 60_000;
    e = await etatApp(b, A, r.id);
    assert.equal(e.travail.bloque, true);
    await b.appel(`/teams/${A.teamId}/resumes/${r.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { relancer: true } });
    assert.equal((await travail(b, r.id)).statut, 'attente');
  } finally {
    nettoyer();
  }
});

test('verrous : verrou orphelin (processus mort) remplacé, jamais bloquant ; le cron relance', async () => {
  const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0 };
  const { b, A, dossier, nettoyer } = await preparer(SERVEUR);
  try {
    const config = { transcriptionServeur: { ...SERVEUR, dossierModeles: dossier } };
    const verrou = chemins(config.transcriptionServeur).verrou;
    await deposer(b, A, { secondes: 5 });
    // Verrou d'un processus disparu (pid inexistant) : pas actif, le cron lance un nouveau processus.
    writeFileSync(verrou, '999999');
    assert.equal(verrouActif(verrou), false);
    const lances = [];
    const spawn = (cmd, args) => (lances.push([cmd, ...args].join(' ')), { unref() {} });
    let r = await lancerTravailleur({ base: b.base, config, maintenant: () => b.horloge.t, spawn, fichierJournal: join(dossier, 't.log') });
    assert.equal(r.lance, true);
    assert.equal(existsSync(verrou), false, 'verrou orphelin retiré');
    // Verrou d'un processus vivant mais figé (aucun battement depuis 40 min) : considéré mort aussi.
    writeFileSync(verrou, String(process.pid));
    const vieux = new Date(Date.now() - 40 * 60_000);
    utimesSync(verrou, vieux, vieux);
    assert.equal(verrouActif(verrou), false);
    assert.equal(prendreVerrou(verrou, 4242), true);
    assert.equal(readFileSync(verrou, 'utf8'), '4242');
    rmSync(verrou, { force: true });
    r = await lancerTravailleur({ base: b.base, config, maintenant: () => b.horloge.t, spawn, fichierJournal: join(dossier, 't.log') });
    assert.equal(r.lance, true);
  } finally {
    nettoyer();
  }
});

test('chien de garde : un processus sans aucune avancée s’arrête (verrou et bail plus renouvelés)', async () => {
  const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0, blocageMs: 50 };
  const { b, A, dossier, nettoyer } = await preparer(SERVEUR);
  try {
    await deposer(b, A, { secondes: 5 });
    let debloquer;
    let bloque = 0;
    let battements = 0;
    let battementsApresBlocage = 0;
    // Le minuteur de veille du processus ne retient pas la boucle d'événements (unref) : le test, si.
    const garde = setInterval(() => undefined, 1000);
    const bilan = await executerTravaux({
      resumes: cote(b, SERVEUR),
      stockage: b.stockage,
      config: SERVEUR,
      creerTranscripteur: async () => ({
        moteur: 'figé',
        transcrireMorceau: () =>
          new Promise((_, ko) => {
            debloquer = ko;
          }),
      }),
      dossierTravail: join(dossier, 'travail'),
      dormir: async () => undefined,
      journal: { log() {}, error() {} },
      battementMs: 10,
      battement: () => {
        battements += 1;
        if (bloque) battementsApresBlocage += 1;
      },
      surBlocage: () => {
        bloque += 1;
        setTimeout(() => debloquer(new Error('processus figé arrêté')), 60);
      },
    });
    clearInterval(garde);
    assert.equal(bloque, 1, 'déclaré bloqué une seule fois');
    assert.equal(battementsApresBlocage, 0, 'plus de battement une fois bloqué');
    assert.ok(battements >= 0);
    assert.equal(bilan.echecs, 1);
  } finally {
    nettoyer();
  }
});

test('installation des modèles ONNX : fichiers et empreintes publiés par Hugging Face (faux réseau, rien n’est téléchargé)', async () => {
  assert.equal(sha1Git(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a', 'empreinte git d’un petit fichier');
  const rev = 'c'.repeat(40);
  const lfs = (path, n) => ({ type: 'file', path, size: 134, oid: 'f'.repeat(40), lfs: { oid: String(n).repeat(64).slice(0, 64), size: n * 1000 } });
  const liste = [
    lfs('turbo-encoder.int8.onnx', 1),
    lfs('turbo-decoder.int8.onnx', 2),
    { type: 'file', path: 'turbo-tokens.txt', size: 800, oid: 'a'.repeat(40) },
    lfs('turbo-encoder.onnx', 3),
    lfs('turbo-encoder.weights', 4),
    { type: 'file', path: 'README.md', size: 10, oid: 'b'.repeat(40) },
    lfs('test_wavs/0.wav', 5),
  ];
  const appels = [];
  const fetch = async url => {
    appels.push(url);
    if (url.endsWith('/revision/main')) return new Response(JSON.stringify({ sha: rev }));
    if (url.endsWith('/test_wavs')) return new Response(JSON.stringify(liste.filter(x => x.path.startsWith('test_wavs/'))));
    return new Response(JSON.stringify(liste.filter(x => !x.path.startsWith('test_wavs/'))));
  };
  const plan = await planOnnx('turbo', { fetch });
  assert.equal(plan.revision, rev);
  assert.deepEqual(plan.fichiers.map(f => f.nom), ['test_wavs/0.wav', 'turbo-decoder.int8.onnx', 'turbo-encoder.int8.onnx', 'turbo-tokens.txt'], 'seulement int8, jetons et échantillon');
  assert.equal(plan.fichiers[2].sha256, '1'.repeat(64));
  assert.equal(plan.fichiers[3].sha1Git, 'a'.repeat(40));
  assert.match(plan.fichiers[2].url, new RegExp(`^https://huggingface\\.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/${rev}/turbo-encoder\\.int8\\.onnx$`));
  assert.ok(appels.every(u => u.startsWith('https://huggingface.co/api/models/csukuangfj/sherpa-onnx-whisper-turbo/')));
  // Fichier indispensable absent : refus clair.
  assert.throws(() => planDepuisArbre(liste.filter(x => x.path !== 'turbo-tokens.txt'), { nom: 'turbo', depot: 'x/y', revision: rev }), /turbo-tokens\.txt absent/);
  // Fichier LFS sans SHA-256 publié : ignoré (jamais téléchargé sans empreinte).
  assert.throws(() => planDepuisArbre([{ ...liste[0], lfs: { oid: 'court', size: 1 } }, liste[1], liste[2]], { nom: 'turbo', depot: 'x/y', revision: rev }), /turbo-encoder\.int8\.onnx absent/);
});
