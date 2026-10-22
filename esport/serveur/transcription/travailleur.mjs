/**
 * Processus de fond de la transcription sur le serveur (o2switch, sans PC allumé).
 *
 * Lancé par le cron (esport/serveur/cron.mjs, toutes les 5 minutes) quand des réunions attendent, en
 * tâche DÉTACHÉE et avec la priorité la plus basse (nice 19) : les pages du site restent prioritaires.
 * Garde-fous pour un hébergement mutualisé (limites CloudLinux LVE de processeur, mémoire, processus) :
 *
 *  - UN seul processus à la fois (verrou fichier, plus un bail par travail en base) ;
 *  - 1 à 2 fils de calcul (TRANSCRIPTION_THREADS) ;
 *  - morceaux d'au plus 30 s, une PAUSE après chaque morceau (TRANSCRIPTION_REPOS, fraction du temps
 *    de calcul : 0,25 = le processeur se repose 20 % du temps) ;
 *  - plafond de mémoire (TRANSCRIPTION_RAM_MAX) : au-delà, arrêt propre et message clair ;
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
import { decoderVersPcm, dureePcm, fenetreSuivante, lirePcm } from './audio.mjs';

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

/**
 * Traite la file jusqu'à ce qu'elle soit vide (ou la durée de vie atteinte). Options :
 *  - `resumes` : services de esport/noyau/resumes.mjs (file, segments, PDF, notifications) ;
 *  - `stockage` ; `config` : réglages de la transcription serveur (configTranscriptionServeur) ;
 *  - `creerTranscripteur()` → `{ moteur, transcrireMorceau(pcm, { langue }), liberer?() }` ;
 *  - `ffmpeg` : chemin du binaire (sinon WAV seulement) ; `dossierTravail` ;
 *  - `horloge()` (ms), `dormir(ms)`, `memoire()` (octets), `journal`, `arret()` (true = s'arrêter).
 * Rend un bilan `{ termines, echecs, rendus, morceaux }`.
 */
export async function executerTravaux({
  resumes,
  stockage,
  config,
  creerTranscripteur,
  ffmpeg = null,
  dossierTravail,
  horloge = () => Date.now(),
  dormir = attendre,
  memoire = () => process.memoryUsage().rss,
  journal = console,
  arret = () => false,
  battement = () => undefined,
  apresTravail = async () => undefined,
}) {
  mkdirSync(dossierTravail, { recursive: true });
  menageTravail(dossierTravail, ((config.delaiMaxH ?? 24) + 48) * 3_600_000);
  const bilan = { termines: 0, echecs: 0, rendus: 0, morceaux: 0, recuperes: 0 };
  const debutProcessus = horloge();
  const finProcessus = debutProcessus + (config.dureeTravailleurMin ?? 120) * 60_000;
  let transcripteur = null;
  bilan.recuperes = await resumes.recupererTravauxServeur();
  try {
    for (;;) {
      if (arret() || horloge() >= finProcessus) break;
      const tache = await resumes.prochainTravailServeur();
      if (!tache) break;
      const { travail: w, reunion: r, fichier: f } = tache;
      const pcm = join(dossierTravail, `${w.reunion_id}.pcm`);
      const copie = join(dossierTravail, `${w.reunion_id}.source`);
      let source = null;
      // Pendant tout le travail : bail en base et verrou du processus renouvelés chaque minute.
      const veille = setInterval(() => {
        battement();
        resumes.prolongerTravailServeur?.(w).catch(() => undefined);
      }, BATTEMENT_MS);
      veille.unref?.();
      try {
        // 1. Audio : décodé une seule fois en PCM 16 kHz (gardé pour la reprise).
        if (!existsSync(pcm)) {
          source = await fichierLocal(stockage, f.cle_stockage, copie);
          await decoderVersPcm({ source: source.chemin, sortie: pcm, ffmpeg, threads: Math.min(2, config.threads || 1) });
          if (source.temporaire) rmSync(copie, { force: true });
        }
        const duree = Math.round(dureePcm(pcm) * 10) / 10;
        if (!(duree > 0.5)) throw Object.assign(new Error('Enregistrement sans piste audio lisible.'), { definitif: true });
        // 2. Moteur : chargé au premier travail, gardé pour les suivants.
        if (!transcripteur) transcripteur = await creerTranscripteur();
        const segments = [...tache.segments];
        let position = tache.progression;
        let langue = w.langue === 'auto' ? null : w.langue;
        let secondesCalcul = Number(w.secondes_calcul ?? 0);
        let audioCalcule = Number(w.audio_calcule_s ?? 0);
        let interrompu = null;
        // 3. Morceaux de 30 s au plus, chacun enregistré (reprise exacte).
        while (position < duree - 0.05) {
          if (arret() || horloge() >= finProcessus) {
            interrompu = 'rendu';
            break;
          }
          const fen = fenetreSuivante(pcm, position, duree);
          const t0 = horloge();
          const res = await transcripteur.transcrireMorceau(lirePcm(pcm, fen.debut, fen.fin), { langue: w.langue });
          const calcul = Math.max(0, (horloge() - t0) / 1000);
          if (!langue && res?.langue) langue = res.langue;
          const texte = String(res?.texte ?? '').trim();
          if (texte) segments.push([fen.debut, fen.fin, texte]);
          position = fen.fin;
          secondesCalcul += calcul;
          audioCalcule += fen.fin - fen.debut;
          bilan.morceaux += 1;
          battement();
          const encore = await resumes.progresserServeur(w, { segments, progression: position, duree, langue: langue ?? 'fr', moteur: transcripteur.moteur, secondesCalcul, audioCalcule });
          if (!encore) {
            interrompu = 'annule';
            break;
          }
          if (memoire() > config.ramMax) {
            throw Object.assign(new Error(`Mémoire insuffisante sur le serveur pour le modèle « ${config.modele} » : choisissez un modèle plus petit (TRANSCRIPTION_MODELE=tiny) ou transcrivez dans le navigateur.`), { definitif: true, memoire: true });
          }
          // Garde-fou du mutualisé : repos proportionnel au calcul.
          if (config.repos > 0 && calcul > 0) await dormir(calcul * config.repos * 1000);
        }
        if (interrompu === 'rendu') {
          await resumes.rendreTravailServeur(w);
          bilan.rendus += 1;
          journal.log?.(`[transcription] « ${r.titre} » : ${Math.round((position / duree) * 100)} %, reprise au prochain passage.`);
          continue;
        }
        if (interrompu === 'annule') {
          rmSync(pcm, { force: true });
          continue;
        }
        // 4. Fin : PDF, statut « prête », notifications.
        if (await resumes.terminerTravailServeur(w, { segments, duree, langue: langue ?? 'fr', moteur: transcripteur.moteur })) {
          bilan.termines += 1;
          journal.log?.(`[transcription] « ${r.titre} » terminée (${segments.length} segments, ${Math.round(duree / 60)} min d'audio).`);
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
  const { chemins, cheminFfmpeg, creerTranscripteurWhisper, etatInstallation } = await import('./moteur.mjs');
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
  let arreter = false;
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => (arreter = true));
  const { basePostgres, optionsDepuisEnv } = await import('../../adaptateurs/postgres.mjs');
  const { stockageDisque } = await import('../../adaptateurs/stockage.mjs');
  const { servicesMedias } = await import('../../noyau/medias/service.mjs');
  const { servicesResumes } = await import('../../noyau/resumes.mjs');
  const { distribuer } = await import('../../noyau/evenements.mjs');
  const base = await basePostgres({ ...optionsDepuisEnv(), max: 2 });
  try {
    const stockage = await stockageDisque(config.dossierFichiers);
    const socle = { contexteTeam: async () => { throw new Error('Contexte indisponible dans le processus de transcription.'); } };
    const medias = servicesMedias({ base, stockage, cleSession: config.cleSession, socle, config: config.medias });
    const resumes = servicesResumes({ base, stockage, cleSession: config.cleSession, socle, medias, transcriptionServeur: ts });
    const bilan = await executerTravaux({
      resumes,
      stockage,
      config: ts,
      creerTranscripteur: () => creerTranscripteurWhisper(ts),
      ffmpeg: cheminFfmpeg(ts),
      dossierTravail: c.travail,
      arret: () => arreter,
      battement: () => toucherVerrou(c.verrou),
      apresTravail: () => distribuer(base, { maintenant: Date.now(), limite: 200 }),
    });
    console.log(`${new Date().toISOString()} transcription : ${bilan.termines} terminée(s), ${bilan.echecs} échec(s), ${bilan.rendus} à reprendre, ${bilan.morceaux} morceau(x) de 30 s.`);
  } catch (e) {
    console.error(`${new Date().toISOString()} transcription : erreur`, e);
    process.exitCode = 1;
  } finally {
    await base.fermer();
    rmSync(c.verrou, { force: true });
    writeFileSync(join(c.dossier, 'dernier-passage.txt'), new Date().toISOString());
  }
}
