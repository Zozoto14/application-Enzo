/**
 * QUALITÉ de la transcription sur le serveur (migration 0035, docs/esport/transcription.md) :
 *  - prompt de vocabulaire de la team (glossaire, pseudos, adversaires, agents / maps du profil de jeu) ;
 *  - garde-fous contre les défauts de Whisper (boucles, génériques inventés, annotations) ;
 *  - découpage en blocs coupés aux silences, chevauchement recollé sans doublon ;
 *  - post-correction par l'IA (faux moteur) avec la garde « ne pas inventer » ;
 *  - choix du moteur (whisper.cpp, sinon repli ONNX) et des qualités disponibles ;
 *  - whisper-cli : arguments, lecture de la sortie JSON, transcripteur avec un FAUX binaire ;
 *  - file commune avec l'IA locale (un seul moteur lourd à la fois si la mémoire ne suffit pas) ;
 *  - de bout en bout : dépôt → blocs → relecture → transcription relue + brute gardée (SQLite et PostgreSQL).
 * Aucun téléchargement, aucun vrai modèle (sauf le test d'intégration facultatif, sauté par défaut).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import { envoyer, wavFactice } from './medias-aide.mjs';
import { configTranscriptionServeur, qualiteEffective, QUALITES } from '../noyau/medias/fileTranscription.mjs';
import { construirePromptVocabulaire, estHallucination, filtrerRepetitions, lireGlossaire, nettoyerAnnotations, nettoyerSegments, recollerSegments, vocabulaireTeam } from '../noyau/medias/qualiteTranscription.mjs';
import { corrigerSegments, lireReponseCorrection, lotsDeCorrection, messagesCorrection, verifierLigne } from '../noyau/medias/correctionTranscription.mjs';
import { transcrireParApi } from '../noyau/medias/transcription.mjs';
import { servicesMedias } from '../noyau/medias/service.mjs';
import { servicesResumes } from '../noyau/resumes.mjs';
import { ecrireWav, fenetreSuivante, pretraiterPcm, wavVersPcm } from '../serveur/transcription/audio.mjs';
import { executerTravaux } from '../serveur/transcription/travailleur.mjs';
import { chemins, etatInstallation, qualitesDisponibles } from '../serveur/transcription/moteur.mjs';
import { argumentsWhisperCli, creerTranscripteurWhisperCpp, lireSortieWhisperCli, MODELES_GGML, VAD_SILERO, WHISPER_CPP } from '../serveur/transcription/whispercpp.mjs';
import { compilateurSystemeSuffit, lireOptions, modelesAInstaller } from '../serveur/transcription/installer.mjs';
import { creerCorrecteur, TACHE_CORRECTION } from '../serveur/transcription/correcteur.mjs';
import { besoinExclusif, prendreJetonLourd } from '../serveur/moteurs-lourds.mjs';
import { verrouActif as verrouIaActif } from '../serveur/ia-locale/gestionnaire.mjs';
import { cheminsIaLocale } from '../serveur/ia-locale/installation.mjs';

const MIO = 1024 * 1024;
const TYPE_HEBDO = '00000000-0000-4000-8000-000000000001';

// ------------------------------------------------------------------ Prompt de vocabulaire

test('vocabulaire : ordre de priorité, doublons, Riot ID, termes du jeu ; prompt borné, en français ou en anglais', () => {
  const v = vocabulaireTeam({
    glossaire: lireGlossaire('B main\nconnecteur, Zozoto\n\n  zozoto  '),
    pseudos: ['Zozoto', 'Léa', 'Tom', 'Kaze#EUW1', '<script>', 'x'],
    adversaires: ['Karmine Corp', 'Team Vitality'],
    personnages: ['Jett', 'Sova', 'KAY/O'],
    cartes: ['Ascent', 'Bind'],
    modes: ['Classé'],
    jeu: { nom: 'Valorant', base: 'valorant', cle: 'valorant' },
    equipe: 'Faucons',
  });
  assert.deepEqual(v.glossaire, ['B main', 'connecteur', 'Zozoto']);
  // Doublon du glossaire retiré, Riot ID réduit au pseudo, valeurs invalides retirées.
  assert.deepEqual(v.pseudos, ['Léa', 'Tom', 'Kaze', 'script']);
  assert.ok(v.termes.includes('Spike') && v.termes.includes('clutch'));
  const p = construirePromptVocabulaire(v, { langue: 'fr' });
  assert.match(p, /^Réunion de l’équipe Faucons sur Valorant\. Vocabulaire : B main, connecteur, Zozoto\. Joueurs : Léa, Tom, Kaze, script\. Adversaires : Karmine Corp, Team Vitality\. Agents : Jett, Sova, KAY\/O\. Maps : Ascent, Bind\./);
  assert.ok(p.length <= 600);
  assert.match(construirePromptVocabulaire(v, { langue: 'en' }), /^Faucons team meeting about Valorant\. Vocabulary : /);
  // Prompt court : les catégories de faible priorité sautent d'abord, jamais au milieu d'un mot.
  const court = construirePromptVocabulaire(v, { maxCaracteres: 120 });
  assert.ok(court.length <= 120);
  assert.match(court, /Zozoto/);
  assert.doesNotMatch(court, /Ascent/);
  // Beaucoup de pseudos : coupé à la limite, liste toujours propre.
  const gros = construirePromptVocabulaire(vocabulaireTeam({ pseudos: Array.from({ length: 300 }, (_, i) => `Joueur${i}`) }));
  assert.ok(gros.length <= 600 && /Joueur0, Joueur1/.test(gros) && !/, $/.test(gros));
  assert.equal(construirePromptVocabulaire(null), '');
});

// ------------------------------------------------------------------ Garde-fous

test('anti-répétition : boucles coupées, répétitions naturelles gardées ; annotations et génériques retirés', () => {
  assert.equal(filtrerRepetitions('on push B on push B on push B on push B maintenant'), 'on push B maintenant');
  assert.equal(filtrerRepetitions('merci merci merci merci merci merci'), 'merci merci');
  assert.equal(filtrerRepetitions('non non non on rotate'), 'non non non on rotate', 'trois fois : parole naturelle');
  assert.equal(filtrerRepetitions('il faut, il faut, il faut, il faut que tu trade'), 'il faut, que tu trade');
  assert.equal(filtrerRepetitions('Jett entry, Sova drone, Omen smoke.'), 'Jett entry, Sova drone, Omen smoke.');
  assert.equal(nettoyerAnnotations('[Musique] on y va ♪ (rires) go'), 'on y va go');
  assert.equal(estHallucination('Sous-titres réalisés par la communauté d’Amara.org'), true);
  assert.equal(estHallucination("Sous-titres réalisés par la communauté d'Amara.org"), true);
  assert.equal(estHallucination('Merci d’avoir regardé cette vidéo !'), true);
  assert.equal(estHallucination('Merci d’avoir regardé la VOD de Karmine hier, on a vu leur exec sur B'), false);
  assert.equal(estHallucination('[Musique]'), true);
  const s = nettoyerSegments([
    [0, 5, 'On commence par Ascent.'],
    [5, 30, 'Sous-titres réalisés par la communauté d’Amara.org'],
    [30, 35, 'Bon, on regarde le round 3.'],
    [35, 40, 'Bon, on regarde le round 3.'],
    [40, 42, 'Oui.'],
    [42, 44, 'Oui.'],
    [44, 50, 'go go go go go go go go'],
  ]);
  assert.deepEqual(s, [
    [0, 5, 'On commence par Ascent.'],
    [30, 35, 'Bon, on regarde le round 3.'],
    [40, 42, 'Oui.'],
    [42, 44, 'Oui.'],
    [44, 50, 'go go'],
  ]);
});

// ------------------------------------------------------------------ Découpage et recollage

test('recollage de deux blocs qui se chevauchent : ni segment en double, ni mots répétés à la jointure', () => {
  const bloc1 = [
    [0, 4, 'On joue Jett sur Ascent.'],
    [4, 9.8, 'Après le plant on tient le site'],
  ];
  // Bloc 2 commencé à 8,5 s (marge) pour une coupe à 10 s : il redonne la fin du segment précédent.
  const bloc2 = [
    [8.5, 9.8, 'on tient le site'],
    [9.6, 13, 'le site et on attend le retake.'],
    [13, 16, 'Sova lance son drone.'],
  ];
  const r = recollerSegments(bloc1, bloc2, 10);
  assert.deepEqual(r, [
    [0, 4, 'On joue Jett sur Ascent.'],
    [4, 9.8, 'Après le plant on tient le site'],
    [9.8, 13, 'et on attend le retake.'],
    [13, 16, 'Sova lance son drone.'],
  ]);
  // Rien à recoller au début ; mots communs sans recouvrement réel (1 mot) gardés.
  assert.deepEqual(recollerSegments([], bloc1, 0), bloc1);
  assert.deepEqual(recollerSegments([[0, 2, 'on va B']], [[2, 4, 'B main']], 2), [[0, 2, 'on va B'], [2, 4, 'B main']]);
  // Le nouveau bloc entièrement redondant : rien d'ajouté.
  assert.deepEqual(recollerSegments([[0, 5, 'on tient le site']], [[3, 5.2, 'on tient le site']], 5), [[0, 5, 'on tient le site']]);
});

test('blocs whisper.cpp : coupés dans le silence le plus proche de la fin (recherche 60 s), reprise identique ; prétraitement sans ffmpeg', () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-blocs-'));
  try {
    const n = 700 * 8000;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i / 8000;
      pcm[i] = (s > 262 && s < 262.6) || (s > 530 && s < 530.6) ? 0 : 0.02 * Math.sin((2 * Math.PI * 220 * i) / 8000);
    }
    ecrireWav(join(d, 'a.wav'), pcm, 8000);
    wavVersPcm(join(d, 'a.wav'), join(d, 'a.pcm'));
    const f1 = fenetreSuivante(join(d, 'a.pcm'), 0, undefined, { max: 300, recherche: 60 });
    assert.ok(f1.fin > 262 && f1.fin < 262.6, `coupe ${f1.fin}`);
    const f2 = fenetreSuivante(join(d, 'a.pcm'), f1.fin, undefined, { max: 300, recherche: 60 });
    assert.ok(f2.fin > 530 && f2.fin < 530.6, `coupe ${f2.fin}`);
    assert.deepEqual(fenetreSuivante(join(d, 'a.pcm'), f1.fin, undefined, { max: 300, recherche: 60 }), f2);
    // Prétraitement : voix faible (0,02) remontée vers -20 dBFS, silence gardé à zéro.
    const { gain } = pretraiterPcm(join(d, 'a.pcm'));
    assert.ok(gain > 5 && gain <= 20, `gain ${gain}`);
    const o = readFileSync(join(d, 'a.pcm'));
    assert.equal(o.readInt16LE(Math.round(262.3 * 16000) * 2), 0);
    let max = 0;
    for (let i = 16000 * 10; i < 16000 * 11; i++) max = Math.max(max, Math.abs(o.readInt16LE(i * 2)));
    assert.ok(max / 32768 > 0.1 && max / 32768 < 0.9, `niveau ${max / 32768}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ Post-correction

test('garde « ne pas inventer » : orthographe et noms du glossaire acceptés ; ajout, résumé, réécriture refusés', () => {
  const glossaire = ['Jett', 'Ascent', 'Sova', 'retake'];
  assert.equal(verifierLigne('on joue jet sur assent', 'On joue Jett sur Ascent.', { glossaire }).ok, true);
  assert.equal(verifierLigne('ils sont aller sur le site B', 'Ils sont allés sur le site B.').ok, true);
  assert.equal(verifierLigne('a', 'a').raison, 'identique');
  // Contenu ajouté (nouvelle information).
  const ajout = verifierLigne('on push B', 'On push B, puis on gagne la manche grâce au clutch de Tom.');
  assert.equal(ajout.ok, false);
  // Résumé (contenu retiré).
  const resume = verifierLigne('alors euh je pense que sur le round trois on aurait dû attendre le retake au lieu de peek mid tout seul', 'Il fallait attendre le retake.', { glossaire });
  assert.equal(resume.ok, false);
  assert.equal(resume.raison, 'longueur');
  // Reformulation de même longueur avec d'autres mots.
  assert.equal(verifierLigne('on rotate vers A après la smoke', 'nous changeons de site dès que possible').ok, false);
  assert.equal(verifierLigne('texte', '').ok, false);
});

test('post-correction par lots (faux moteur) : corrections gardées, inventions refusées (ligne brute gardée), reprise, erreur', async () => {
  const segments = Array.from({ length: 20 }, (_, i) => [i * 5, i * 5 + 5, i === 3 ? 'on joue jet sur assent' : `ligne ${i} on push b`]);
  const lots = lotsDeCorrection(segments, { maxSegments: 8 });
  assert.deepEqual(lots.map(l => l.indices.length), [8, 8, 4]);
  const m = messagesCorrection({ lignes: ['a <<<b>>>'], glossaire: ['Jett'] });
  assert.match(m[0].content, /Ne résume pas/);
  assert.match(m[1].content, /Glossaire : Jett/);
  assert.match(m[1].content, /1\. <<<a b>>>/, 'les balises du texte ne peuvent pas fermer la donnée');
  assert.deepEqual([...lireReponseCorrection('```json\n{"lignes":[{"n":1,"texte":"x"},{"n":9,"texte":"y"},{"n":1,"texte":"z"}]}\n```', 2)], [[1, 'x']]);
  const appels = [];
  const appeler = async (messages, options) => {
    appels.push(options);
    const lignes = [...messages[1].content.matchAll(/^(\d+)\. <<<(.*)>>>$/gm)].map(x => ({ n: Number(x[1]), t: x[2] }));
    return {
      texte: JSON.stringify({
        lignes: lignes.map(({ n, t }) => ({ n, texte: t === 'on joue jet sur assent' ? 'On joue Jett sur Ascent.' : t === 'ligne 5 on push b' ? 'Ligne 5 : on push B et Tom fait un ace incroyable en fin de round.' : t.replace(' b', ' B.') })),
      }),
    };
  };
  const vus = [];
  const r = await corrigerSegments({ segments, appeler, glossaire: ['Jett', 'Ascent'], tailleLot: { maxSegments: 8 }, surLot: async ({ faits }) => vus.push(faits) });
  assert.equal(r.complete, true);
  assert.deepEqual(vus, [8, 16, 20]);
  assert.equal(r.segments[3][2], 'On joue Jett sur Ascent.');
  assert.equal(r.segments[5][2], 'ligne 5 on push b', 'invention refusée : la ligne reste brute');
  assert.equal(r.segments[0][2], 'ligne 0 on push B.');
  assert.deepEqual(r.segments[3].slice(0, 2), [15, 20], 'horodatage inchangé');
  assert.equal(r.refusees, 1);
  assert.equal(r.acceptees, 19);
  assert.equal(appels[0].json, true);
  assert.equal(appels[0].temperature, 0);
  assert.ok(appels[0].schema?.properties?.lignes);
  // Reprise au lot 2 (les 8 premiers déjà corrigés, repris tels quels) ; arrêt demandé après un lot.
  const deja = r.segments;
  const r2 = await corrigerSegments({ segments, dejaCorriges: deja, depuis: 8, appeler, tailleLot: { maxSegments: 8 }, surLot: async () => false });
  assert.equal(r2.complete, false);
  assert.equal(r2.faits, 16);
  assert.equal(r2.segments[3][2], 'On joue Jett sur Ascent.');
  // Moteur en erreur (occupé, délai) : arrêt propre, le reste brut.
  const r3 = await corrigerSegments({ segments, appeler: async () => { throw Object.assign(new Error('occupée'), { code: 'ia-locale-occupee' }); } });
  assert.equal(r3.complete, false);
  assert.equal(r3.erreur.code, 'ia-locale-occupee');
  assert.deepEqual(r3.segments, segments);
  // Le correcteur passe par le répartiteur du connecteur IA (tâche « correction », moteur choisi par l'ordre de repli).
  const recus = [];
  const c = creerCorrecteur(null, { local: null, repartiteur: { discuterPour: async (tache, messages) => (recus.push([tache, messages.length]), { texte: '{}', moteur: 'api2' }) } });
  await c.appeler([{ role: 'user', content: 'x' }], {});
  assert.deepEqual(recus, [[TACHE_CORRECTION, 1]]);
  assert.equal(c.modele, 'API secondaire');
  // Répartiteur construit depuis l'environnement même sans moteur configuré.
  assert.equal(creerCorrecteur(null, { local: null, env: {} }).modele, 'IA', 'répartiteur sans moteur : il répondra « non configuré », la relecture s’arrêtera proprement');
});

// ------------------------------------------------------------------ Moteurs, qualités, repli

function installationFactice(d, { binaire = true, modeles = ['large-v3-turbo-q5_0'], onnx = false } = {}) {
  const config = { ...configTranscriptionServeur({}), dossierModeles: d };
  const c = chemins(config);
  const pret = { version: 1 };
  if (binaire) {
    mkdirSync(c.whispercpp, { recursive: true });
    writeFileSync(c.binaireWhisper, '#!/bin/sh\n');
    chmodSync(c.binaireWhisper, 0o755);
    mkdirSync(c.ggml, { recursive: true });
    mkdirSync(join(d, 'vad'), { recursive: true });
    writeFileSync(c.vad, Buffer.alloc(VAD_SILERO.taille));
    pret.whispercpp = { binaire: c.binaireWhisper, commit: WHISPER_CPP.commit, modeles: {}, vitesses: { 'large-v3-turbo-q5_0': 0.21 } };
    for (const m of modeles) {
      writeFileSync(join(c.ggml, MODELES_GGML[m].fichier), Buffer.alloc(10));
      pret.whispercpp.modeles[m] = { taille: 10 };
    }
  }
  if (onnx) {
    mkdirSync(join(c.moteur, 'node_modules', 'onnxruntime-node'), { recursive: true });
    writeFileSync(join(c.moteur, 'node_modules', 'onnxruntime-node', 'package.json'), '{}');
    mkdirSync(c.modele, { recursive: true });
    for (const f of c.fichiersModele) writeFileSync(f, 'x');
    pret.modeles = ['base'];
  }
  writeFileSync(c.pret, JSON.stringify(pret));
  return config;
}

test('choix du moteur : whisper.cpp par qualité, repli ONNX sans whisper.cpp, qualité la plus proche, rien d’installé', () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-moteurs-'));
  try {
    // whisper.cpp avec le seul modèle « équilibrée » : les autres qualités retombent dessus.
    let config = installationFactice(d);
    let e = etatInstallation(config);
    assert.equal(e.installe, true);
    assert.deepEqual(e.qualites.equilibree, { disponible: true, moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0' });
    assert.equal(e.qualites.maximale.disponible, false);
    assert.equal(e.vitesses['whispercpp:large-v3-turbo-q5_0'], 0.21);
    const cfg = { ...config, disponible: true, qualites: e.qualites };
    assert.deepEqual(qualiteEffective(cfg, 'maximale'), { qualite: 'equilibree', moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0' });
    assert.deepEqual(qualiteEffective(cfg, 'rapide'), { qualite: 'equilibree', moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0' });
    // Modèle effacé du disque (taille différente) : plus disponible.
    writeFileSync(join(chemins(config).ggml, MODELES_GGML['large-v3-turbo-q5_0'].fichier), Buffer.alloc(3));
    e = etatInstallation(config);
    assert.equal(e.installe, false);
    assert.match(e.raison, /aucun modèle GGML/);
    rmSync(d, { recursive: true, force: true });
    // Pas de whisper.cpp, repli ONNX : seule la qualité « équilibrée », moteur ONNX.
    config = installationFactice(d, { binaire: false, onnx: true });
    e = etatInstallation(config);
    assert.equal(e.installe, true);
    assert.deepEqual(e.qualites.equilibree, { disponible: true, moteur: 'onnx', modele: 'base' });
    assert.equal(e.qualites.rapide.disponible, false);
    assert.deepEqual(qualiteEffective({ ...config, disponible: true, qualites: e.qualites }, 'maximale'), { qualite: 'equilibree', moteur: 'onnx', modele: 'base' });
    // Les deux installés : whisper.cpp prioritaire ; TRANSCRIPTION_MOTEUR=onnx force le repli.
    rmSync(d, { recursive: true, force: true });
    config = installationFactice(d, { modeles: ['small', 'large-v3-turbo-q5_0', 'large-v3-q5_0'], onnx: true });
    const q = qualitesDisponibles(config, etatInstallation(config));
    assert.deepEqual(QUALITES.map(k => `${q[k].moteur}:${q[k].modele}`), ['whispercpp:small', 'whispercpp:large-v3-turbo-q5_0', 'whispercpp:large-v3-q5_0']);
    assert.equal(etatInstallation({ ...config, moteur: 'onnx' }).qualites.equilibree.moteur, 'onnx');
    assert.equal(etatInstallation({ ...config, moteur: 'onnx' }).qualites.maximale.disponible, false);
    // Rien d'installé.
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d);
    e = etatInstallation({ ...configTranscriptionServeur({}), dossierModeles: d });
    assert.equal(e.installe, false);
    assert.match(e.raison, /whisper\.cpp non installé/);
    assert.equal(qualiteEffective({ disponible: false }, 'rapide'), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('réglages : qualité, modèles par qualité, VAD, relecture, file exclusive ; options de l’installateur', () => {
  const c = configTranscriptionServeur({ TRANSCRIPTION_QUALITE: 'Maximale', TRANSCRIPTION_MODELE_RAPIDE: 'medium', TRANSCRIPTION_MODELE_MAXIMALE: 'inconnu', TRANSCRIPTION_THREADS_WHISPER: '64', TRANSCRIPTION_BLOC_S: '10', TRANSCRIPTION_VAD: 'non', TRANSCRIPTION_CORRECTION: 'non', TRANSCRIPTION_RAM_COMPTE: '48G', TRANSCRIPTION_MOTEUR: 'onnx' });
  assert.deepEqual([c.qualite, c.modelesQualite.rapide, c.modelesQualite.maximale, c.threadsWhisper, c.blocS, c.vad, c.correction, c.ramCompte, c.moteur], ['maximale', 'medium', 'large-v3-q5_0', 32, 60, false, 'non', 48 * 1024 ** 3, 'onnx']);
  const d = configTranscriptionServeur({});
  assert.deepEqual([d.qualite, d.modelesQualite.equilibree, d.vad, d.correction, d.exclusif, d.moteur], ['equilibree', 'large-v3-turbo-q5_0', true, 'auto', 'auto', 'auto']);
  assert.deepEqual(modelesAInstaller(d, lireOptions([])), ['large-v3-turbo-q5_0']);
  assert.deepEqual(modelesAInstaller(d, lireOptions(['--tous', '--modele', 'medium'])), ['small', 'large-v3-turbo-q5_0', 'large-v3-q5_0', 'medium']);
  assert.equal(lireOptions(['--modele', 'base']).onnx, true, 'ancienne option : repli ONNX');
  assert.throws(() => lireOptions(['--modele', 'enorme']), /Modèle inconnu/);
  assert.throws(() => lireOptions(['--route', 'magie']), /--route/);
  assert.equal(compilateurSystemeSuffit({ gxx: [8, 5], cmake: [3, 20] }), false, 'CloudLinux 8 (GCC 8) : GCC 14 figé');
  assert.equal(compilateurSystemeSuffit({ gxx: [13, 3], cmake: [3, 28] }), true);
  // Toutes les empreintes figées ont la bonne forme.
  for (const m of Object.values(MODELES_GGML)) assert.match(m.sha1, /^[0-9a-f]{40}$/);
  assert.match(VAD_SILERO.sha256, /^[0-9a-f]{64}$/);
  assert.match(WHISPER_CPP.commit, /^[0-9a-f]{40}$/);
});

// ------------------------------------------------------------------ whisper-cli

test('whisper-cli : arguments (beam, repli de température, seuils, prompt gardé, VAD), sortie JSON lue en secondes absolues', () => {
  const a = argumentsWhisperCli({ fichierModele: '/m.bin', wav: '/b.wav', sortie: '/b', langue: 'fr', prompt: 'Joueurs : Léa.', threads: 8, beam: 5, bestOf: 5, vad: '/vad.bin' });
  const ligne = a.join(' ');
  for (const x of ['-m /m.bin', '-f /b.wav', '-l fr', '-t 8', '-bs 5', '-bo 5', '-tp 0', '-tpi 0.2', '-et 2.4', '-lpt -1.0', '-nth 0.6', '-sns', '-ojf', '-of /b', '--carry-initial-prompt', '--vad -vm /vad.bin']) assert.ok(ligne.includes(x), x);
  assert.equal(a[a.indexOf('--prompt') + 1], 'Joueurs : Léa.', 'prompt passé tel quel (un seul argument)');
  assert.ok(!argumentsWhisperCli({ fichierModele: 'm', wav: 'w', sortie: 's', langue: 'xx' }).includes('--vad'));
  assert.equal(argumentsWhisperCli({ fichierModele: 'm', wav: 'w', sortie: 's', langue: 'xx' })[5], 'fr');
  const json = { result: { language: 'fr' }, transcription: [{ offsets: { from: 150, to: 4200 }, text: ' On joue Jett.' }, { offsets: { from: 4200, to: 4300 }, text: ' [_BEG_] ' }, { offsets: { from: 5000, to: 9000 }, text: 'Sova drone.' }] };
  assert.deepEqual(lireSortieWhisperCli(JSON.stringify(json), { decalage: 600 }), { segments: [[600.15, 604.2, 'On joue Jett.'], [605, 609, 'Sova drone.']], langue: 'fr' });
  assert.throws(() => lireSortieWhisperCli('{pas du json'), /illisible/);
});

/** Faux whisper-cli (script Node) : lit -of et -l, écrit une sortie JSON comme le vrai ; « ECHEC » dans le prompt → code 1. */
function fauxWhisper(d) {
  const script = join(d, 'faux-whisper.mjs');
  writeFileSync(
    script,
    `import { writeFileSync, statSync } from 'node:fs';
const a = process.argv.slice(2);
const v = k => a[a.indexOf(k) + 1];
if (String(v('--prompt')).includes('ECHEC')) { process.stderr.write('whisper_init: modèle illisible\\nerror: failed to load model\\n'); process.exit(1); }
const duree = (statSync(v('-f')).size - 44) / 32000;
writeFileSync(v('-of') + '.json', JSON.stringify({ result: { language: v('-l') === 'auto' ? 'en' : v('-l') }, transcription: [{ offsets: { from: 0, to: Math.round(duree * 1000) }, text: ' bloc de ' + duree.toFixed(1) + ' s, prompt ' + (a.includes('--prompt') ? 'oui' : 'non') }] }));
`,
  );
  return (cmd, args, opts) => spawn(process.execPath, [script, ...args.slice(args.indexOf(cmd) + 1 || 0)], opts);
}

test('transcripteur whisper.cpp avec un FAUX binaire : WAV écrit, sortie lue et décalée, fichiers temporaires effacés, erreur claire', async () => {
  const d = mkdtempSync(join(tmpdir(), 'esport-faux-whisper-'));
  try {
    const t = creerTranscripteurWhisperCpp({ binaire: '/opt/inexistant/whisper-cli', fichierModele: '/m.bin', nomModele: 'large-v3-turbo-q5_0', dossierTravail: d, nice: 0, spawn: fauxWhisper(d) });
    assert.equal(t.moteur, 'whisper.cpp large-v3-turbo (q5_0) (serveur)');
    const r = await t.transcrireBloc(new Float32Array(16000 * 3), { langue: 'fr', prompt: 'Joueurs : Léa.', decalage: 120 });
    assert.deepEqual(r, { segments: [[120, 123, 'bloc de 3.0 s, prompt oui']], langue: 'fr' });
    await assert.rejects(t.transcrireBloc(new Float32Array(1600), { prompt: 'ECHEC' }), /whisper\.cpp s’est arrêté \(code 1\) : error: failed to load model/);
    const restes = (await import('node:fs')).readdirSync(d).filter(f => f.startsWith('bloc-'));
    assert.deepEqual(restes, [], 'WAV et JSON temporaires effacés');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ File commune avec l'IA locale

test('moteurs lourds : exclusif selon la mémoire ; verrou commun avec l’IA locale (attente, puis rendu)', async () => {
  assert.equal(besoinExclusif({ exclusif: 'auto', ramCompte: 48 * 1024 ** 3, memoireWhisperMo: 2000, memoireIaMo: 6144 }), false, '48 Go : les deux tiennent');
  assert.equal(besoinExclusif({ exclusif: 'auto', ramCompte: 6 * 1024 ** 3, memoireWhisperMo: 2000, memoireIaMo: 6144 }), true);
  assert.equal(besoinExclusif({ exclusif: 'auto', ramCompte: null, limite: null }), true, 'mémoire inconnue : prudence');
  assert.equal(besoinExclusif({ exclusif: 'non', ramCompte: 1 }), false);
  const d = mkdtempSync(join(tmpdir(), 'esport-lourds-'));
  try {
    const c = cheminsIaLocale(d);
    const j = await prendreJetonLourd({ dossierIa: d, attenteMs: 0 });
    assert.ok(j);
    const v = JSON.parse(readFileSync(c.verrouServeur, 'utf8'));
    assert.equal(v.role, 'transcription');
    assert.equal(v.port, null);
    assert.equal(verrouIaActif(v), true, 'le gestionnaire de l’IA locale voit le moteur occupé');
    // Un second preneur attend puis renonce (null) : pas de second moteur.
    let t = 0;
    assert.equal(await prendreJetonLourd({ dossierIa: d, attenteMs: 5000, maintenant: () => t, dormir: async ms => void (t += ms) }), null);
    j.noterPid(1234);
    assert.equal(JSON.parse(readFileSync(c.verrouServeur, 'utf8')).moteurTranscription, 1234);
    j.liberer();
    assert.equal(existsSync(c.verrouServeur), false);
    // Verrou mort (sans battement depuis longtemps) : retiré, puis pris.
    writeFileSync(c.verrouServeur, JSON.stringify({ proprietaire: 999999, role: 'app', jeton: 'x', majLe: '2020-01-01T00:00:00.000Z' }));
    const j2 = await prendreJetonLourd({ dossierIa: d, attenteMs: 0 });
    assert.ok(j2);
    j2.liberer();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ De bout en bout

const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0, blocS: 60, chevauchementS: 1.5, correctionDisponible: true, qualites: { rapide: { disponible: true, moteur: 'whispercpp', modele: 'small' }, equilibree: { disponible: true, moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0' }, maximale: { disponible: false, moteur: 'whispercpp', modele: 'large-v3-q5_0' } }, vitesses: { 'whispercpp:large-v3-turbo-q5_0': 0.2 } };

function cote(b, config = SERVEUR, extra = {}) {
  const socle = { contexteTeam: async () => { throw new Error('pas de contexte'); } };
  const medias = servicesMedias({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle });
  return servicesResumes({ base: b.base, stockage: b.stockage, cleSession: 'x'.repeat(40), maintenant: () => b.horloge.t, socle, medias, transcriptionServeur: config, ...extra });
}

/** Transcripteur par blocs simulé : un segment par tranche de 10 s (temps absolus), texte brut en minuscules. */
function blocsSimules() {
  const appels = [];
  return {
    appels,
    creer: async choix => ({
      moteur: `whisper.cpp ${choix.modele} (simulé)`,
      async transcrireBloc(pcm, { prompt, decalage, langue }) {
        appels.push({ decalage, duree: pcm.length / 16000, prompt, langue, choix });
        const fin = decalage + pcm.length / 16000;
        const segments = [];
        for (let t = Math.ceil(decalage / 10) * 10; t < fin - 0.5; t += 10) segments.push([t, Math.min(t + 10, fin), t === 20 ? 'on joue jet sur assent' : `phrase a ${t} secondes`]);
        segments.push([fin - 0.5, fin, 'Sous-titres réalisés par la communauté d’Amara.org']);
        return { segments, langue: 'fr' };
      },
    }),
  };
}

const correcteurSimule = (journal = []) => ({
  modele: 'Qwen simulé',
  async appeler(messages) {
    journal.push(messages);
    const lignes = [...messages[1].content.matchAll(/^(\d+)\. <<<(.*)>>>$/gm)];
    return { texte: JSON.stringify({ lignes: lignes.map(x => ({ n: Number(x[1]), texte: x[2] === 'on joue jet sur assent' ? 'On joue Jett sur Ascent.' : `${x[2].charAt(0).toUpperCase()}${x[2].slice(1)}.` })) }) };
  },
});

test('de bout en bout : vocabulaire de la team dans le prompt, blocs recollés sans doublon, relecture IA, brute gardée, qualité', async () => {
  const b = await banc({ medias: { plafond: 8 * MIO, tailleMorceau: MIO }, transcriptionServeur: SERVEUR });
  const A = await teamAvecMembres(b, { nom: 'Faucons', membres: { own12345: { pseudo: 'Owner', role: 'proprietaire' }, lea12345: { pseudo: 'Léa', role: 'joueur' }, tom12345: { pseudo: 'Tom', role: 'joueur' } } });
  const dossier = mkdtempSync(join(tmpdir(), 'esport-qualite-'));
  try {
    // Paramètres de la team : glossaire, qualité, langue ; un adversaire en scouting.
    const reg = await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { glossaire: 'Zozoto, B main', qualite: 'rapide', langue: 'fr', correction: true } });
    assert.equal(reg.statut, 200, JSON.stringify(reg.corps));
    assert.deepEqual([reg.corps.qualite, reg.corps.glossaire, reg.corps.correction, reg.corps.correctionDisponible], ['rapide', 'Zozoto, B main', true, true]);
    assert.deepEqual(reg.corps.qualites.map(q => [q.cle, q.disponible]), [['rapide', true], ['equilibree', true], ['maximale', false]]);
    assert.equal(reg.corps.qualites[1].facteur, 0.2);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { qualite: 'ultra' } })).statut, 400);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.lea12345, corps: { glossaire: 'x' } })).statut, 403);
    await b.base.executer("INSERT INTO adversaires (id, team_id, nom, notes, cree_par, cree_le, maj_le) VALUES ('11111111-1111-4111-8111-111111111111', ?, 'Karmine Corp', '', 'own12345', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')", [A.teamId]);
    // Dépôt en qualité « équilibrée » (au dépôt), 150 s d'audio : blocs de 60 s.
    const enr = await envoyer(b, A.sessions.lea12345, A.teamId, wavFactice(150, 8000), { section: 'resumes', nom: 'reunion.wav' });
    const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre: 'Hebdo', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id, transcription: 'serveur', qualite: 'equilibree' } })).corps;
    assert.equal(depot.transcription.statut, 'serveur');
    assert.equal(depot.transcription.travail.qualite, 'equilibree');
    assert.equal(depot.transcription.travail.modele, 'whispercpp:large-v3-turbo-q5_0');
    assert.equal(depot.transcription.meilleureQualite, 'equilibree');
    assert.equal(depot.transcription.qualites[1].facteur, 0.2, 'durée estimée possible dans l’app');
    const sim = blocsSimules();
    const journalIa = [];
    // Relecture interrompue (arrêt du processus : signal, durée de vie) après le premier lot, puis reprise.
    let lots = 0;
    const config = { ...SERVEUR };
    const correcteur = correcteurSimule(journalIa);
    const correcteurInterrompu = { ...correcteur, appeler: async (m, o) => { lots += 1; return correcteur.appeler(m, o); } };
    const opts = { resumes: cote(b, config), stockage: b.stockage, config, creerTranscripteur: sim.creer, dossierTravail: join(dossier, 'travail'), horloge: () => b.horloge.t, dormir: async () => undefined, journal: { log() {}, error() {} } };
    const bilan1 = await executerTravaux({ ...opts, correcteur: correcteurInterrompu, arret: () => lots >= 1 });
    assert.equal(bilan1.rendus, 1, 'relecture rendue à la file');
    // Blocs : ≤ 60 s, chevauchement de 1,5 s, prompt avec le vocabulaire de la team, modèle de la qualité demandée.
    assert.ok(sim.appels.length >= 3);
    assert.ok(sim.appels.every(a => a.duree <= 60 + 1.5 + 0.01));
    assert.equal(sim.appels[0].decalage, 0);
    assert.ok(Math.abs(sim.appels[1].decalage - (sim.appels[0].duree - 1.5)) < 0.01, 'le bloc suivant commence 1,5 s avant la coupe');
    assert.equal(sim.appels[0].choix.modele, 'large-v3-turbo-q5_0');
    const prompt = sim.appels[0].prompt;
    for (const mot of ['Faucons', 'Zozoto', 'B main', 'Léa', 'Tom', 'Karmine Corp', 'Jett', 'Ascent']) assert.ok(prompt.includes(mot), `${mot} dans « ${prompt} »`);
    let w = await b.base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [depot.id]);
    assert.deepEqual([w.statut, w.etape], ['attente', 'correction']);
    assert.ok(Number(w.correction_faite) > 0);
    const pendant = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.equal(pendant.travail.etape, 'correction');
    assert.ok(pendant.segmentsBruts.length > 0);
    // Reprise : la transcription n'est pas refaite, seulement la fin de la relecture.
    const nAppels = sim.appels.length;
    const bilan2 = await executerTravaux({ ...opts, horloge: () => b.horloge.t, correcteur });
    assert.equal(bilan2.termines, 1);
    assert.equal(bilan2.corriges, 1);
    assert.equal(sim.appels.length, nAppels, 'aucun bloc retranscrit');
    const fin = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.equal(fin.statut, 'prete');
    assert.equal(fin.qualite, 'equilibree');
    assert.match(fin.correction, /^Relue par l’IA \(Qwen simulé\) : \d+ ligne\(s\) corrigée\(s\)$/);
    assert.match(fin.moteur, /whisper\.cpp large-v3-turbo-q5_0/);
    const debuts = fin.segments.map(s => s.debut);
    assert.deepEqual(debuts, [...debuts].sort((x, y) => x - y));
    assert.equal(new Set(debuts).size, debuts.length, 'aucun doublon au recollage');
    assert.ok(!fin.segments.some(s => /Amara/.test(s.texte)), 'générique inventé retiré');
    assert.equal(fin.segments.find(s => s.debut === 20).texte, 'On joue Jett sur Ascent.');
    assert.equal(fin.segmentsBruts.find(s => s.debut === 20).texte, 'on joue jet sur assent', 'version brute gardée');
    assert.equal(fin.segments.length, fin.segmentsBruts.length);
    assert.match(journalIa[0][1].content, /Zozoto/, 'glossaire envoyé à l’IA');
    // Correction à la main : la version brute reste ; « Retranscrire » repart de zéro (bruts effacés pendant le travail).
    const corrige = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: A.sessions.lea12345, corps: { segments: fin.segments.map(s => (s.debut === 0 ? { ...s, texte: 'Corrigé à la main.' } : s)), langue: 'fr', moteur: fin.moteur } });
    assert.equal(corrige.statut, 200);
    assert.ok(corrige.corps.segmentsBruts?.length, 'brute gardée après une correction à la main');
    assert.equal(corrige.corps.correction, fin.correction);
    // Transcrite ailleurs (navigateur) : l'ancienne version brute n'a plus de sens.
    const nav = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { methode: 'PUT', jeton: A.sessions.lea12345, corps: { segments: [{ debut: 0, fin: 5, texte: 'Navigateur.' }], langue: 'fr', moteur: 'Whisper base (navigateur)' } });
    assert.equal(nav.corps.segmentsBruts, null);
    // Retranscrire avec la meilleure qualité : demande enregistrée avec la qualité.
    const re = await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { qualite: 'maximale' } });
    assert.equal(re.statut, 200);
    w = await b.base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [depot.id]);
    assert.deepEqual([w.qualite, w.etape, Number(w.correction_faite), w.langue], ['equilibree', 'transcription', 0, 'fr'], 'maximale indisponible : la plus proche');
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/serveur`, { methode: 'DELETE', jeton: A.sessions.lea12345 })).statut, 200);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription/serveur`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { qualite: 'magique' } })).statut, 400);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('sans IA (relecture désactivée par la team, ou IA indisponible) : transcription brute, sans version « brute » à part', async () => {
  const b = await banc({ medias: { plafond: 8 * MIO, tailleMorceau: MIO }, transcriptionServeur: SERVEUR });
  const A = await teamAvecMembres(b, { nom: 'Faucons', membres: { own12345: { pseudo: 'Owner', role: 'proprietaire' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const dossier = mkdtempSync(join(tmpdir(), 'esport-qualite-'));
  try {
    await b.appel(`/teams/${A.teamId}/resumes/reglages-transcription`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { correction: false, langue: 'auto' } });
    const enr = await envoyer(b, A.sessions.lea12345, A.teamId, wavFactice(20, 8000), { section: 'resumes', nom: 'r.wav' });
    const depot = (await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: A.sessions.lea12345, corps: { titre: 'Courte', typeId: TYPE_HEBDO, dateReunion: '2026-10-20', envoi: enr.id, transcription: 'serveur' } })).corps;
    const w = await b.base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [depot.id]);
    assert.deepEqual([w.langue, w.qualite], ['auto', 'equilibree'], 'langue de la team (détection), qualité du serveur');
    const sim = blocsSimules();
    const ia = [];
    const bilan = await executerTravaux({ resumes: cote(b), stockage: b.stockage, config: SERVEUR, creerTranscripteur: sim.creer, correcteur: correcteurSimule(ia), dossierTravail: join(dossier, 'travail'), horloge: () => b.horloge.t, dormir: async () => undefined, journal: { log() {}, error() {} } });
    assert.equal(bilan.termines, 1);
    assert.equal(ia.length, 0, 'relecture désactivée par la team');
    assert.equal(sim.appels[0].langue, 'auto');
    const fin = (await b.appel(`/teams/${A.teamId}/resumes/${depot.id}/transcription`, { jeton: A.sessions.lea12345 })).corps;
    assert.deepEqual([fin.statut, fin.segmentsBruts, fin.correction, fin.langue], ['prete', null, null, 'fr']);
    assert.equal(fin.segments.find(s => s.debut === 0).texte, 'phrase a 0 secondes');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('API externe (compatible OpenAI) : prompt de vocabulaire et température 0 envoyés ; réponse nettoyée', async () => {
  let formulaire = null;
  const fetch = async (_url, init) => {
    formulaire = init.body;
    return { ok: true, json: async () => ({ duration: 10, segments: [{ start: 0, end: 5, text: 'On joue Jett.' }, { start: 5, end: 10, text: 'Merci d’avoir regardé cette vidéo !' }] }) };
  };
  const r = await transcrireParApi({ octets: new Uint8Array(10), nom: 'a.wav', type: 'audio/wav', langue: 'fr', prompt: 'Joueurs : Léa, Tom.', config: { actif: true, url: 'https://api.exemple/v1/audio/transcriptions', cle: 'k', modele: 'whisper-1', tailleMax: 1000 }, fetch });
  assert.equal(formulaire.get('prompt'), 'Joueurs : Léa, Tom.');
  assert.equal(formulaire.get('temperature'), '0');
  assert.equal(formulaire.get('language'), 'fr');
  assert.equal(r.segments.length, 2);
  assert.deepEqual(nettoyerSegments(r.segments), [[0, 5, 'On joue Jett.']]);
});

// ------------------------------------------------------------------ Intégration facultative avec le VRAI whisper.cpp

const VRAI_BINAIRE = process.env.ESPORT_TEST_WHISPER_CLI;
const VRAI_MODELE = process.env.ESPORT_TEST_WHISPER_MODELE;
const ECHANTILLON = process.env.ESPORT_TEST_WHISPER_WAV;

test(
  'intégration : vrai whisper-cli (VAD, prompt, JSON) sur un échantillon WAV',
  { skip: !VRAI_BINAIRE || !VRAI_MODELE || !ECHANTILLON ? 'ESPORT_TEST_WHISPER_CLI, ESPORT_TEST_WHISPER_MODELE et ESPORT_TEST_WHISPER_WAV non définis : test sauté' : false, timeout: 600_000 },
  async () => {
    const d = mkdtempSync(join(tmpdir(), 'esport-vrai-whisper-'));
    try {
      const { decoderVersPcm, lirePcm, dureePcm } = await import('../serveur/transcription/audio.mjs');
      await decoderVersPcm({ source: ECHANTILLON, sortie: join(d, 'e.pcm'), ffmpeg: existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : null });
      const t = creerTranscripteurWhisperCpp({ binaire: VRAI_BINAIRE, fichierModele: VRAI_MODELE, nomModele: 'essai', vad: process.env.ESPORT_TEST_WHISPER_VAD ?? null, threads: 4, dossierTravail: d });
      const r = await t.transcrireBloc(lirePcm(join(d, 'e.pcm'), 0, dureePcm(join(d, 'e.pcm'))), { langue: process.env.ESPORT_TEST_WHISPER_LANGUE ?? 'en', prompt: 'Esports team meeting. Players: Jett, Sova.', decalage: 100 });
      assert.ok(r.segments.length > 0);
      assert.ok(r.segments[0][0] >= 100);
      assert.match(nettoyerSegments(r.segments).map(s => s[2]).join(' '), new RegExp(process.env.ESPORT_TEST_WHISPER_ATTENDU ?? 'country', 'i'));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  },
);
