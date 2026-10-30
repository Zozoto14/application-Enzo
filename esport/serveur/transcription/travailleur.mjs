/**
 * Processus de fond de la transcription sur le serveur (o2switch, sans PC allumé).
 *
 * Lancé par le cron (esport/serveur/cron.mjs, toutes les 5 minutes) quand des réunions attendent, en
 * tâche DÉTACHÉE et avec la priorité la plus basse (nice 19) : les pages du site restent prioritaires.
 * Garde-fous pour un hébergement mutualisé (limites CloudLinux LVE de processeur, mémoire, processus) :
 *
 *  - UN seul processus à la fois (verrou fichier, plus un bail par travail en base) ;
 *  - moteur par défaut : Whisper par ONNX Runtime DANS CE PROCESSUS (l'hébergeur arrête de force les binaires de
 *    calcul externes, pas `node`) : morceaux de 30 s au plus coupés dans un silence, zone de parole seule, prompt
 *    de vocabulaire de la team + texte du morceau précédent, recherche en faisceau, températures de repli ; fils de
 *    calcul TRANSCRIPTION_THREADS ;
 *  - whisper.cpp (option) : blocs de quelques minutes (TRANSCRIPTION_BLOC_S) avec une petite marge recollée sans
 *    doublon ; s'il est arrêté de force (SIGKILL que nous n'avons pas envoyé), BASCULE sur ONNX pour ce travail
 *    (même bloc repris, sans essai compté) et whisper.cpp désactivé pour la suite ;
 *  - texte nettoyé (boucles de répétition, hallucinations connues), puis RELU par l'IA (post-correction par lots,
 *    garde « ne pas inventer », version brute gardée) ;
 *  - jamais whisper.cpp et l'IA locale en même temps si la mémoire ne le permet pas (moteurs-lourds.mjs) ;
 *  - une PAUSE après chaque morceau (TRANSCRIPTION_REPOS, fraction du temps de calcul : 0,25 = le
 *    processeur se repose 20 % du temps) ;
 *  - plafond de mémoire (TRANSCRIPTION_RAM_MAX) : au-delà, arrêt propre et message clair ;
 *  - CHIEN DE GARDE : sans aucune avancée pendant TRANSCRIPTION_BLOCAGE_MIN, le processus s'arrête (il ne tient
 *    plus le verrou ni le bail) et le passage suivant du cron reprend le travail ;
 *  - durée de vie bornée (TRANSCRIPTION_DUREE_TRAVAILLEUR) : le processus passe la main, le cron suivant
 *    en relance un neuf qui reprend au dernier morceau ;
 *  - chaque morceau est enregistré en base : une coupure (processus tué, redémarrage) reprend là.
 *
 * `executerTravaux` est injectable (transcripteur simulé, horloge, pause) pour les tests.
 */

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decoderVersPcm, dureePcm, energieAutour, fenetreSuivante, lirePcm, zoneDeParole } from './audio.mjs';
import { qualiteEffective } from '../../noyau/medias/fileTranscription.mjs';
import { nettoyerSegments, recollerSegments, texteNormalise } from '../../noyau/medias/qualiteTranscription.mjs';
import { corrigerSegments } from '../../noyau/medias/correctionTranscription.mjs';

const attendre = ms => new Promise(ok => setTimeout(ok, ms));

/** Battement pendant un long calcul (décodage d'une longue vidéo, morceau lent) : bail et verrou renouvelés. */
export const BATTEMENT_MS = 60_000;

/** Fichiers audio temporaires abandonnés (travail annulé pendant une pause) : effacés après quelques jours. */
function menageTravail(dossier, ageMaxMs) {
  for (const f of readdirSync(dossier)) {
    try {
      const c = join(dossier, f);
      if (Date.now() - statSync(c).mtimeMs > ageMaxMs) rmSync(c, { force: true });
    } catch {
      // Fichier déjà parti.
    }
  }
}

/** Message d'erreur simple pour l'app (jamais de chemin du serveur). */
const messageSimple = e => String(e?.message ?? e ?? 'Erreur inconnue.').replace(/\/home\/[^\s)]+/g, '…').slice(0, 300);

/**
 * Copie locale de l'enregistrement : le chemin du fichier sur le disque (stockage disque), sinon une
 * copie par tranches dans le dossier de travail (autre stockage).
 */
export async function fichierLocal(stockage, cle, destination) {
  const direct = stockage.cheminLocal?.(cle);
  if (direct && existsSync(direct)) return { chemin: direct, temporaire: false };
  const taille = await stockage.tailleDe?.(cle);
  const fd = openSync(destination, 'w');
  try {
    if (typeof taille === 'number' && stockage.lireTranche) {
      const pas = 8 * 1024 * 1024;
      for (let debut = 0; debut < taille; debut += pas) {
        const t = await stockage.lireTranche(cle, debut, Math.min(taille, debut + pas) - 1);
        if (t?.octets) writeSync(fd, t.octets);
        else if (t?.flux) for await (const m of t.flux) writeSync(fd, m);
      }
    } else {
      const o = await stockage.lire(cle);
      if (!o) throw new Error('Enregistrement introuvable dans le stockage.');
      writeSync(fd, o.octets);
    }
  } finally {
    closeSync(fd);
  }
  return { chemin: destination, temporaire: true };
}

/** Énergie au point de coupe au-delà de laquelle la coupe tombe en pleine parole (une marge est alors reprise). */
const SEUIL_COUPE = 0.02;

/** Whisper recopie parfois le prompt (vocabulaire) sur un passage inaudible : ce texte-là est écarté. */
export function echoDuPrompt(texte, prompt) {
  const t = texteNormalise(texte);
  const p = texteNormalise(prompt ?? '');
  return t.length >= 12 && p.length > 0 && p.includes(t);
}

/**
 * Traite la file jusqu'à ce qu'elle soit vide (ou la durée de vie atteinte). Options :
 *  - `resumes` : services de esport/noyau/resumes.mjs (file, segments, PDF, notifications) ;
 *  - `stockage` ; `config` : réglages de la transcription serveur (configTranscriptionServeur) ;
 *  - `creerTranscripteur(choix)` → `{ moteur, cle?, transcrireBloc?(pcm, { langue, prompt, decalage }),
 *    transcrireMorceau?(pcm, { langue }), liberer?(), arreter?() }` : whisper.cpp (blocs de plusieurs minutes,
 *    prompt de vocabulaire) ou le repli ONNX (morceaux de 30 s) ;
 *  - `choisir(qualite)` → `{ qualite, moteur, modele }` ou null (qualité effective, voir `qualiteEffective`) ;
 *  - `correcteur` : `{ appeler(messages, options), modele, arreter?() }` (IA locale) ou null ;
 *  - `sansRelecture` : message noté sur la transcription quand la relecture est demandée mais impossible sans
 *    sortir du serveur (aucune IA locale ; tâche confidentielle, voir correcteur.mjs) ;
 *  - `jetonLourd()` → `{ liberer(), noterPid?() }` ou null (file commune avec l'IA locale), ou null si inutile ;
 *  - `ffmpeg` : chemin du binaire (sinon WAV seulement) ; `dossierTravail` ;
 *  - `horloge()` (ms), `dormir(ms)`, `memoire()` (octets), `journal`, `arret()` (true = s'arrêter).
 * Rend un bilan `{ termines, echecs, rendus, morceaux, corriges }`.
 */
export async function executerTravaux({
  resumes,
  stockage,
  config,
  creerTranscripteur,
  choisir = qualite => qualiteEffective(config, qualite) ?? { qualite, moteur: 'onnx', modele: config.modele },
  correcteur = null,
  sansRelecture = null,
  jetonLourd = null,
  ffmpeg = null,
  dossierTravail,
  horloge = () => Date.now(),
  dormir = attendre,
  memoire = () => process.memoryUsage().rss,
  journal = console,
  arret = () => false,
  battement = () => undefined,
  apresTravail = async () => undefined,
  surMoteurTue = null,
  surBlocage = () => undefined,
  battementMs = BATTEMENT_MS,
}) {
  mkdirSync(dossierTravail, { recursive: true });
  menageTravail(dossierTravail, ((config.delaiMaxH ?? 24) + 48) * 3_600_000);
  const bilan = { termines: 0, echecs: 0, rendus: 0, morceaux: 0, recuperes: 0, corriges: 0 };
  const debutProcessus = horloge();
  const finProcessus = debutProcessus + (config.dureeTravailleurMin ?? 120) * 60_000;
  const tempsEcoule = () => arret() || horloge() >= finProcessus;
  let transcripteur = null;
  // Dernière AVANCÉE réelle (audio décodé, bloc ou morceau fait, lot relu) : sans avancée pendant `blocageMs`, le
  // processus est déclaré bloqué (il ne renouvelle plus ni son verrou ni le bail du travail, et `surBlocage` l'arrête) :
  // un processus figé ne peut plus tenir la file indéfiniment.
  let activite = horloge();
  const signe = () => {
    activite = horloge();
  };
  let bloque = false;
  bilan.recuperes = await resumes.recupererTravauxServeur();
  try {
    for (;;) {
      if (tempsEcoule()) break;
      const tache = await resumes.prochainTravailServeur();
      if (!tache) break;
      const { travail: w, reunion: r, fichier: f } = tache;
      const contexte = tache.contexte ?? {};
      const pcm = join(dossierTravail, `${w.reunion_id}.pcm`);
      const copie = join(dossierTravail, `${w.reunion_id}.source`);
      let source = null;
      // Pendant tout le travail : bail en base et verrou du processus renouvelés chaque minute.
      signe();
      const veille = setInterval(() => {
        if (horloge() - activite > (config.blocageMs ?? 45 * 60_000)) {
          if (!bloque) {
            bloque = true;
            journal.error?.(`[transcription] « ${r.titre} » : aucune avancée depuis ${Math.round((horloge() - activite) / 60_000)} min : processus bloqué, arrêt (le travail sera repris par le passage suivant du cron).`);
            surBlocage();
          }
          return;
        }
        battement();
        resumes.prolongerTravailServeur?.(w).catch(() => undefined);
      }, battementMs);
      veille.unref?.();
      try {
        let segments = [...tache.segments];
        let langue = w.langue === 'auto' ? null : w.langue;
        let interrompu = null;
        let duree = Number(w.duree_s ?? 0) || null;
        let moteurNom = tache.moteur || null;
        if ((w.etape ?? 'transcription') === 'transcription') {
          // 1. Audio : décodé une seule fois en PCM 16 kHz prétraité (gardé pour la reprise).
          if (!existsSync(pcm)) {
            source = await fichierLocal(stockage, f.cle_stockage, copie);
            await decoderVersPcm({ source: source.chemin, sortie: pcm, ffmpeg, threads: 1 });
            if (source.temporaire) rmSync(copie, { force: true });
            signe();
          }
          duree = Math.round(dureePcm(pcm) * 10) / 10;
          if (!(duree > 0.5)) throw Object.assign(new Error('Enregistrement sans piste audio lisible.'), { definitif: true });
          // 2. Moteur de la qualité demandée (ou la plus proche disponible) ; gardé d'un travail au suivant.
          let choix = choisir(w.qualite ?? config.qualite);
          if (!choix) throw new Error('Aucun moteur de transcription installé sur le serveur.');
          const preparer = async () => {
            const cle = `${choix.moteur}:${choix.modele}:${choix.qualite}`;
            if (transcripteur && (transcripteur.cle ?? cle) !== cle) {
              await transcripteur.liberer?.().catch?.(() => undefined);
              transcripteur = null;
            }
            if (!transcripteur) transcripteur = await creerTranscripteur(choix);
            moteurNom = transcripteur.moteur;
            signe();
          };
          await preparer();
          let position = tache.progression;
          let secondesCalcul = Number(w.secondes_calcul ?? 0);
          let audioCalcule = Number(w.audio_calcule_s ?? 0);
          // Contexte de Whisper : jetons du texte du morceau précédent (reprise : le dernier segment enregistré).
          let precedent = segments.length && transcripteur.encoder ? transcripteur.encoder(` ${segments[segments.length - 1][2]}`) : null;
          // 3. Blocs (whisper.cpp : quelques minutes coupées dans un silence, avec une marge recollée sans doublon)
          //    ou morceaux de 30 s au plus (ONNX dans le processus : coupés dans le silence, zone de parole seule,
          //    petite marge reprise si la coupe tombe en pleine parole) ; chacun enregistré (reprise exacte).
          while (position < duree - 0.05) {
            if (tempsEcoule()) {
              interrompu = 'rendu';
              break;
            }
            const parBlocs = typeof transcripteur.transcrireBloc === 'function';
            const t0 = horloge();
            let fen;
            if (parBlocs) {
              fen = fenetreSuivante(pcm, position, duree, { max: config.blocS ?? 300, recherche: Math.min(60, Math.max(10, (config.blocS ?? 300) / 5)) });
              const debutLecture = Math.max(0, position - (position > 0 ? (config.chevauchementS ?? 1.5) : 0));
              const jeton = jetonLourd ? await jetonLourd() : null;
              if (jetonLourd && !jeton) {
                // L'IA locale tient le moteur depuis trop longtemps : on rend la main, sans essai compté.
                interrompu = 'rendu';
                break;
              }
              let res;
              try {
                res = await transcripteur.transcrireBloc(lirePcm(pcm, debutLecture, fen.fin), { langue: w.langue, prompt: contexte.prompt ?? '', decalage: debutLecture, surProcessus: jeton?.noterPid });
              } catch (e) {
                // whisper.cpp arrêté de force par l'hébergeur : bascule sur ONNX (dans le processus) pour ce travail,
                // et whisper.cpp désactivé pour la suite (surMoteurTue) ; le même bloc est repris, sans essai compté.
                if (!e?.tueExterne || choix.moteur !== 'whispercpp' || !surMoteurTue) throw e;
                const nouveau = await surMoteurTue({ choix, erreur: e, qualite: w.qualite ?? config.qualite });
                if (!nouveau) throw Object.assign(new Error(`${messageSimple(e)} Aucun autre moteur installé : lancez installer-transcription.sh (moteur ONNX).`), { definitif: false });
                journal.error?.(`[transcription] « ${r.titre} » : whisper.cpp arrêté de force par l’hébergeur (SIGKILL) ; bascule sur ${nouveau.moteur} ${nouveau.modele} dans le processus Node, whisper.cpp désactivé pour la suite.`);
                choix = nouveau;
                await preparer();
                continue;
              } finally {
                jeton?.liberer();
              }
              if (!langue && res?.langue) langue = res.langue;
              segments = recollerSegments(segments, nettoyerSegments(res?.segments ?? []), position);
            } else {
              const marge = position > 0 && energieAutour(pcm, position) > SEUIL_COUPE ? Math.min(2, config.chevauchementS ?? 1.5) : 0;
              fen = fenetreSuivante(pcm, position, duree, { max: 30 - marge });
              const debutLecture = Math.max(0, position - marge);
              const brut = lirePcm(pcm, debutLecture, fen.fin);
              const zone = zoneDeParole(brut);
              if (zone) {
                const d = transcripteur.decodage ?? {};
                const res = await transcripteur.transcrireMorceau(brut.subarray(zone.debut, zone.fin), { langue: w.langue, prompt: contexte.prompt ?? '', precedent, beam: d.beam, bestOf: d.bestOf, temperatures: d.temperatures, graine: Math.round(position * 10) + 1 });
                if (!langue && res?.langue && res.langue !== 'auto') langue = res.langue;
                const texte = String(res?.texte ?? '').trim();
                // Comme Whisper : le texte précédent sert de contexte, sauf s'il vient d'un repli à haute température.
                precedent = texte && !(res.temperature > 0.5) ? res.ids : null;
                if (texte && !echoDuPrompt(texte, contexte.prompt)) {
                  segments = recollerSegments(segments, nettoyerSegments([[debutLecture + zone.debut / 16000, debutLecture + zone.fin / 16000, texte]]), position);
                }
              }
            }
            const calcul = Math.max(0, (horloge() - t0) / 1000);
            position = fen.fin;
            secondesCalcul += calcul;
            audioCalcule += fen.fin - fen.debut;
            bilan.morceaux += 1;
            signe();
            battement();
            const encore = await resumes.progresserServeur(w, { segments, progression: position, duree, langue: langue ?? 'fr', moteur: transcripteur.moteur, secondesCalcul, audioCalcule });
            if (!encore) {
              interrompu = 'annule';
              break;
            }
            if (memoire() > config.ramMax) {
              throw Object.assign(new Error(`Mémoire insuffisante sur le serveur pour ce modèle (${choix.modele}) : choisissez la qualité « Rapide », augmentez TRANSCRIPTION_RAM_MAX ou transcrivez dans le navigateur.`), { definitif: true, memoire: true });
            }
            // Garde-fou du mutualisé : repos proportionnel au calcul.
            if (config.repos > 0 && calcul > 0) await dormir(calcul * config.repos * 1000);
          }
          if (!interrompu && correcteur && contexte.correction) {
            // Transcription finie : la relecture par l'IA locale commence (étape enregistrée : reprise possible).
            if (!(await resumes.commencerCorrectionServeur(w, { segments, langue: langue ?? 'fr', moteur: transcripteur.moteur, duree }))) interrompu = 'annule';
            else w.etape = 'correction';
          }
        }
        let bruts = null;
        // Relecture voulue mais aucune IA locale (et envoi externe non autorisé) : rien n'est envoyé, on le dit.
        let correction = !correcteur && contexte.correction && sansRelecture ? sansRelecture : '';
        if (!interrompu && w.etape === 'correction') {
          // 4. Post-correction par l'IA locale, par lots, chaque lot enregistré (reprise au lot suivant).
          bruts = tache.segmentsBruts?.length ? tache.segmentsBruts : segments;
          const depuis = Number(w.correction_faite ?? 0);
          let rendu = false;
          if (!correcteur) {
            // IA locale désinstallée (ou indisponible) entre-temps : la transcription brute est gardée telle quelle.
            segments = bruts;
            bruts = null;
            if (sansRelecture) correction = sansRelecture;
          }
          const r2 = correcteur
            ? await corrigerSegments({
                segments: bruts,
                dejaCorriges: segments,
                depuis,
                appeler: correcteur.appeler,
                glossaire: contexte.glossaire ?? [],
                langue: langue ?? w.langue ?? 'fr',
                surLot: async ({ segments: s, faits }) => {
                  signe();
                  battement();
                  if (!(await resumes.progresserCorrectionServeur(w, { segments: s, faits }))) {
                    interrompu = 'annule';
                    return false;
                  }
                  if (tempsEcoule()) {
                    rendu = true;
                    return false;
                  }
                  return true;
                },
              })
            : null;
          if (rendu) interrompu = 'rendu';
          if (r2) segments = r2.segments;
          if (r2 && !interrompu) {
            if (r2.erreur) journal.error?.(`[transcription] « ${r.titre} » : relecture par l’IA locale arrêtée (${r2.erreur?.code ?? r2.erreur?.message ?? r2.erreur}) ; le reste est gardé brut.`);
            correction = r2.complete ? `Relue par l’IA (${correcteur?.modele ?? 'IA'}) : ${r2.acceptees} ligne(s) corrigée(s)` : `Relue par l’IA (${correcteur?.modele ?? 'IA'}) : relecture partielle`;
            if (r2.complete) bilan.corriges += 1;
          }
        }
        if (interrompu === 'rendu') {
          await resumes.rendreTravailServeur(w);
          bilan.rendus += 1;
          journal.log?.(`[transcription] « ${r.titre} » : ${w.etape === 'correction' ? 'relecture en cours' : `${Math.round((Number(w.progression_s ?? 0) / (duree || 1)) * 100)} %`}, reprise au prochain passage.`);
          continue;
        }
        if (interrompu === 'annule') {
          rmSync(pcm, { force: true });
          continue;
        }
        // 5. Fin : PDF, statut « prête », notifications.
        if (await resumes.terminerTravailServeur(w, { segments, segmentsBruts: bruts, correction, qualite: w.qualite ?? null, duree, langue: langue ?? 'fr', moteur: moteurNom ?? transcripteur?.moteur ?? '' })) {
          bilan.termines += 1;
          journal.log?.(`[transcription] « ${r.titre} » terminée (${segments.length} segments, ${Math.round((duree ?? 0) / 60)} min d'audio${correction ? `, ${correction}` : ''}).`);
        }
        rmSync(pcm, { force: true });
        // Notifications tout de suite (sans attendre le prochain passage du cron).
        await apresTravail().catch(() => undefined);
      } catch (e) {
        if (source?.temporaire) rmSync(copie, { force: true });
        const message = messageSimple(e);
        journal.error?.(`[transcription] « ${r.titre} » : ${message}`);
        const definitif = Boolean(e?.definitif) || e?.code === 'format';
        const issue = await resumes.echecTravailServeur(w, message, { definitif });
        if (issue.definitif) rmSync(pcm, { force: true });
        bilan.echecs += 1;
        if (issue.definitif) await apresTravail().catch(() => undefined);
        // Mémoire dépassée : on arrête ce processus (le moteur chargé est sans doute en cause).
        if (e?.memoire) break;
      } finally {
        clearInterval(veille);
      }
    }
  } finally {
    await transcripteur?.liberer?.().catch?.(() => undefined);
    await correcteur?.arreter?.()?.catch?.(() => undefined);
  }
  return bilan;
}

// ------------------------------------------------------------------ Verrou du processus

const vivant = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
};

/** Un verrou plus vieux que ceci (pas de battement) est considéré mort. */
export const VERROU_MORT_MS = 30 * 60_000;

/** Le verrou est-il tenu par un processus vivant et récent ? */
export function verrouActif(chemin, maintenant = Date.now()) {
  try {
    const age = maintenant - statSync(chemin).mtimeMs;
    const pid = Number(readFileSync(chemin, 'utf8').trim());
    return age < VERROU_MORT_MS && Number.isInteger(pid) && pid > 0 && vivant(pid);
  } catch {
    return false;
  }
}

/** Prend le verrou (fichier créé en exclusif, avec le pid) ; un verrou mort est remplacé. */
export function prendreVerrou(chemin, pid = process.pid) {
  if (existsSync(chemin) && !verrouActif(chemin)) rmSync(chemin, { force: true });
  try {
    const fd = openSync(chemin, 'wx');
    writeSync(fd, String(pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/** Battement : le verrou reste « récent » tant que le processus avance. */
export function toucherVerrou(chemin) {
  try {
    const t = new Date();
    utimesSync(chemin, t, t);
  } catch {
    // Verrou disparu : sans conséquence (le bail en base protège le travail).
  }
}

// ------------------------------------------------------------------ Lancement direct (par le cron)

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    setPriority(19);
  } catch {
    // Pas grave : le lanceur passe déjà par « nice -n 19 ».
  }
  const { chargerConfigEsport } = await import('../config.mjs');
  const config = chargerConfigEsport();
  const ts = config.transcriptionServeur;
  const { chemins, cheminFfmpeg, creerTranscripteur, desactiverWhisperCpp, etatInstallation } = await import('./moteur.mjs');
  const c = chemins(ts);
  mkdirSync(c.dossier, { recursive: true });
  const etat = etatInstallation(ts);
  if (!etat.installe) {
    console.log(`${new Date().toISOString()} transcription : ${etat.raison}.`);
    process.exit(0);
  }
  if (!prendreVerrou(c.verrou)) {
    console.log(`${new Date().toISOString()} transcription : un autre processus travaille déjà.`);
    process.exit(0);
  }
  const resumeQualites = Object.entries(etat.qualites)
    .map(([q, x]) => `${q} ${x.disponible ? `${x.moteur}:${x.modele}` : '—'}`)
    .join(', ');
  console.log(`${new Date().toISOString()} transcription : processus pid ${process.pid} démarré (${resumeQualites} ; ${ts.threads} fil(s) ONNX).`);
  let arreter = false;
  let transcripteurCourant = null;
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP'])
    process.on(s, () => {
      arreter = true;
      transcripteurCourant?.arreter?.();
    });
  const { basePostgres, optionsDepuisEnv } = await import('../../adaptateurs/postgres.mjs');
  const { stockageDisque } = await import('../../adaptateurs/stockage.mjs');
  const { servicesMedias } = await import('../../noyau/medias/service.mjs');
  const { servicesResumes } = await import('../../noyau/resumes.mjs');
  const { distribuer } = await import('../../noyau/evenements.mjs');
  const { preparerCorrecteur } = await import('./correcteur.mjs');
  const { besoinExclusif, prendreJetonLourd } = await import('../moteurs-lourds.mjs');
  const { MODELES_IA_LOCALE } = await import('../ia-locale/installation.mjs');
  const { MODELES_GGML } = await import('./whispercpp.mjs');
  const base = await basePostgres({ ...optionsDepuisEnv(), max: 2 });
  const ia = config.iaLocale;
  // Relecture : IA locale seule (tâche confidentielle) ; une API seulement si le Fondateur l'a autorisé (base).
  const { autorisationsDepuisBase } = await import('../../noyau/ia/confidentialite.mjs');
  const { correcteur, raison: sansRelecture } = ts.correction !== 'non' ? await preparerCorrecteur(ia, { env: process.env, externeAutorise: autorisationsDepuisBase(base) }) : { correcteur: null, raison: null };
  if (sansRelecture) console.log(`${new Date().toISOString()} transcription : ${sansRelecture}`);
  // File commune avec l'IA locale si la mémoire ne permet pas les deux moteurs (TRANSCRIPTION_EXCLUSIF).
  const memoireWhisperMo = Math.max(...Object.values(ts.qualites ?? {}).filter(q => q.disponible && q.moteur === 'whispercpp').map(q => MODELES_GGML[q.modele]?.memoireMo ?? 2000), 0);
  const exclusif = ia?.installation?.installe && besoinExclusif({ exclusif: ts.exclusif, ramCompte: ts.ramCompte, memoireWhisperMo, memoireIaMo: (MODELES_IA_LOCALE[ia.modele]?.ramGo ?? 6) * 1024 });
  try {
    const stockage = await stockageDisque(config.dossierFichiers);
    const socle = { contexteTeam: async () => { throw new Error('Contexte indisponible dans le processus de transcription.'); } };
    const medias = servicesMedias({ base, stockage, cleSession: config.cleSession, socle, config: config.medias });
    const resumes = servicesResumes({ base, stockage, cleSession: config.cleSession, socle, medias, transcriptionServeur: ts });
    const bilan = await executerTravaux({
      resumes,
      stockage,
      config: ts,
      creerTranscripteur: async choix => (transcripteurCourant = await creerTranscripteur(ts, choix)),
      // whisper.cpp arrêté de force : désactivé pour la suite (Administration), qualités recalculées sans lui.
      surMoteurTue: async ({ erreur, qualite }) => {
        desactiverWhisperCpp(ts, `arrêté de force (SIGKILL) par l’hébergeur pendant une transcription (${String(erreur?.message ?? '').slice(0, 160)})`);
        const e2 = etatInstallation(ts);
        ts.qualites = e2.qualites;
        ts.disponible = e2.installe;
        return qualiteEffective(ts, qualite, { exclure: ['whispercpp'] });
      },
      surBlocage: () => {
        // Processus figé : on part (le verrou n'est plus renouvelé ; le travail sera repris par le passage suivant).
        transcripteurCourant?.arreter?.();
        rmSync(c.verrou, { force: true });
        setTimeout(() => process.exit(3), 2000).unref?.();
      },
      correcteur,
      sansRelecture,
      jetonLourd: exclusif ? () => prendreJetonLourd({ dossierIa: ia.dossier, attenteMs: 10 * 60_000 }) : null,
      ffmpeg: cheminFfmpeg(ts),
      dossierTravail: c.travail,
      arret: () => arreter,
      battement: () => toucherVerrou(c.verrou),
      apresTravail: () => distribuer(base, { maintenant: Date.now(), limite: 200 }),
    });
    console.log(`${new Date().toISOString()} transcription : ${bilan.termines} terminée(s), ${bilan.echecs} échec(s), ${bilan.rendus} à reprendre, ${bilan.morceaux} bloc(s) d’audio, ${bilan.corriges} relue(s) par l’IA.`);
  } catch (e) {
    console.error(`${new Date().toISOString()} transcription : erreur`, e);
    process.exitCode = 1;
  } finally {
    await base.fermer();
    rmSync(c.verrou, { force: true });
    writeFileSync(c.dernierPassage, new Date().toISOString());
  }
}
