/**
 * Transcription automatique SUR LE SERVEUR : file de travaux en base (migration 0016).
 *
 * Un dépôt de réunion avec enregistrement (mode « serveur ») met un travail « attente » dans la table
 * `travaux_transcription`. Un processus de fond (esport/serveur/transcription/travailleur.mjs, lancé
 * par le cron toutes les 5 minutes, un seul à la fois) le prend, transcrit par morceaux de 30 s au
 * plus et enregistre chaque morceau : une interruption (limite de l'hébergeur, redémarrage) reprend au
 * dernier morceau fait.
 *
 * Ce module ne contient que la file (SQL standard, SQLite et PostgreSQL) : prise d'un travail avec un
 * BAIL (`verrou_jusqua`, renouvelé à chaque morceau : un travail dont le processus est mort redevient
 * disponible), réessais espacés, délai maximal, progression et temps restant estimé. Le moteur
 * (Whisper) et l'audio sont côté serveur Node, jamais ici (cœur portable).
 */

import { iso, nouvelId } from '../outils.mjs';
import { lireTaille } from './tailles.mjs';

export const MODES_TRANSCRIPTION = ['serveur', 'navigateur', 'externe'];
/**
 * Modèles du moteur PAR DÉFAUT : Whisper par ONNX Runtime DANS le processus Node (exports int8 de sherpa-onnx, voir
 * esport/serveur/transcription/whisper.mjs). « turbo » = large-v3-turbo.
 */
export const MODELES_ONNX = ['tiny', 'base', 'small', 'medium', 'turbo', 'large-v3'];
/** Ancien nom (modèle du « repli » ONNX, TRANSCRIPTION_MODELE). */
export const MODELES_SERVEUR = MODELES_ONNX;
/** Modèles de whisper.cpp (binaire externe, en OPTION) : voir esport/serveur/transcription/whispercpp.mjs. */
export const MODELES_WHISPER_CPP = ['small', 'medium', 'large-v3-turbo-q5_0', 'large-v3-turbo', 'large-v3-q5_0'];
/**
 * auto (défaut) : ONNX dans le processus Node, whisper.cpp seulement pour une qualité dont le modèle ONNX manque ;
 * onnx : ONNX seulement ; whispercpp : whisper.cpp d'abord (bascule automatique sur ONNX s'il est tué par l'hébergeur).
 */
export const MOTEURS_TRANSCRIPTION = ['auto', 'onnx', 'whispercpp'];
export const STATUTS_TRAVAIL = ['attente', 'en_cours', 'termine', 'echec', 'annule'];

/**
 * Qualités proposées dans l'app (docs/esport/transcription.md) : modèle et réglages du décodage.
 *  - rapide : Whisper small (ONNX int8), recherche gloutonne (beam 1), repli à 3 températures ;
 *  - equilibree (défaut) : Whisper large-v3-turbo (ONNX int8), beam search 5 ;
 *  - maximale : Whisper large-v3 (ONNX int8), beam search 5, 5 candidats par température de repli.
 * Avec whisper.cpp (option) : small, large-v3-turbo q5_0, large-v3 q5_0.
 */
export const QUALITES = ['rapide', 'equilibree', 'maximale'];
export const QUALITE_DEFAUT = 'equilibree';
export const MODELES_QUALITE_DEFAUT = { rapide: 'small', equilibree: 'large-v3-turbo-q5_0', maximale: 'large-v3-q5_0' };
export const MODELES_ONNX_QUALITE_DEFAUT = { rapide: 'small', equilibree: 'turbo', maximale: 'large-v3' };
export const DECODAGE_QUALITE = {
  rapide: { beam: 1, bestOf: 2, temperatures: [0, 0.4, 0.8] },
  equilibree: { beam: 5, bestOf: 5, temperatures: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  maximale: { beam: 5, bestOf: 5, temperatures: [0, 0.2, 0.4, 0.6, 0.8, 1] },
};

/**
 * Vitesse de calcul de départ (secondes de calcul par seconde d'audio) pour estimer le temps restant avant la
 * première mesure. ONNX : 1 fil, processeur x64 récent (divisée ensuite selon TRANSCRIPTION_THREADS) ; whisper.cpp :
 * 8 fils (TRANSCRIPTION_THREADS_WHISPER). Remplacées par les mesures de `installer-transcription.sh --test`
 * (pret.json) dès qu'elles existent.
 */
export const VITESSE_DEPART = { tiny: 0.15, base: 0.3, small: 1.0, medium: 2.6, turbo: 2.2, 'large-v3': 5.5, 'whispercpp:small': 0.12, 'whispercpp:medium': 0.35, 'whispercpp:large-v3-turbo-q5_0': 0.25, 'whispercpp:large-v3-turbo': 0.3, 'whispercpp:large-v3-q5_0': 0.8 };
/** Gain des fils de calcul d'ONNX Runtime (loin d'être linéaire). */
export const gainFils = n => Math.max(1, Math.min(16, Number(n) || 1)) ** 0.75;

const entier = (v, defaut, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
const reel = (v, defaut, min, max) => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
const choix = (v, liste, defaut) => {
  const x = String(v ?? '').trim().toLowerCase();
  return liste.includes(x) ? x : defaut;
};

/**
 * Réglages lus dans ~/.appdashboard/esport.env (tous facultatifs) :
 *
 *   TRANSCRIPTION_MODE=serveur            mode par défaut des teams : serveur | navigateur | externe
 *   TRANSCRIPTION_MOTEUR=auto             auto (ONNX dans le processus Node ; whisper.cpp seulement pour une qualité
 *                                         sans modèle ONNX) | onnx | whispercpp (whisper.cpp d'abord, bascule sur ONNX
 *                                         s'il est arrêté de force par l'hébergeur)
 *   TRANSCRIPTION_QUALITE=equilibree      qualité par défaut : rapide | equilibree | maximale
 *   TRANSCRIPTION_ONNX_RAPIDE=small       modèle ONNX de chaque qualité (tiny, base, small, medium, turbo, large-v3)
 *   TRANSCRIPTION_ONNX_EQUILIBREE=turbo
 *   TRANSCRIPTION_ONNX_MAXIMALE=large-v3
 *   TRANSCRIPTION_THREADS=4               fils de calcul d'ONNX Runtime (1 à 16)
 *   TRANSCRIPTION_MODELE_RAPIDE=small     modèle whisper.cpp de chaque qualité (small, medium,
 *   TRANSCRIPTION_MODELE_EQUILIBREE=large-v3-turbo-q5_0      large-v3-turbo-q5_0, large-v3-turbo, large-v3-q5_0)
 *   TRANSCRIPTION_MODELE_MAXIMALE=large-v3-q5_0
 *   TRANSCRIPTION_THREADS_WHISPER=8       fils de calcul de whisper.cpp (1 à 32)
 *   TRANSCRIPTION_BLOC_S=300              durée d'un bloc d'audio confié à whisper.cpp (coupé dans un silence)
 *   TRANSCRIPTION_CHEVAUCHEMENT_S=1.5     marge entre deux blocs (recollés sans doublon)
 *   TRANSCRIPTION_VAD=oui                 détection de la parole (Silero) : silences et bruits ignorés
 *   TRANSCRIPTION_CORRECTION=auto         post-correction par l'IA locale : auto (si installée) | oui | non
 *   TRANSCRIPTION_EXCLUSIF=auto           whisper.cpp et l'IA locale jamais en même temps : auto (si la mémoire
 *                                         ne permet pas les deux) | oui | non
 *   TRANSCRIPTION_RAM_COMPTE=48G          mémoire du compte (limite cPanel), pour décider « auto » ci-dessus
 *   TRANSCRIPTION_MODELE=base             ancien réglage : modèle ONNX utilisé si aucun modèle de qualité n'est installé
 *   TRANSCRIPTION_DOSSIER_MODELES=…       dossier des moteurs et des modèles (hors public_html)
 *   TRANSCRIPTION_RAM_MAX=8G              mémoire du processus Node (modèle ONNX compris) au-delà de laquelle le
 *                                         travail s'arrête
 *   TRANSCRIPTION_BLOCAGE_MIN=45          minutes sans aucune avancée avant de déclarer le processus bloqué (il
 *                                         s'arrête, le travail est repris par le passage suivant du cron)
 *   TRANSCRIPTION_REPOS=0.25              pause après chaque morceau (fraction de son temps de calcul)
 *   TRANSCRIPTION_ESSAIS=3                essais avant l'échec définitif
 *   TRANSCRIPTION_DELAI_MAX=24            heures au plus entre la demande et la fin
 *   TRANSCRIPTION_DUREE_TRAVAILLEUR=120   minutes de travail d'un processus avant de passer la main
 *
 * `disponible` (un moteur installé) et `qualites` (qualités disponibles : moteur et modèle) sont complétés par le
 * serveur Node (esport/serveur/transcription/moteur.mjs) ; ailleurs, rien n'est disponible.
 */
export function configTranscriptionServeur(env = {}) {
  const modele = String(env.TRANSCRIPTION_MODELE ?? '').trim().toLowerCase();
  return {
    mode: choix(env.TRANSCRIPTION_MODE, MODES_TRANSCRIPTION, 'serveur'),
    moteur: choix(env.TRANSCRIPTION_MOTEUR, MOTEURS_TRANSCRIPTION, 'auto'),
    qualite: choix(env.TRANSCRIPTION_QUALITE, QUALITES, QUALITE_DEFAUT),
    modelesOnnx: {
      rapide: choix(env.TRANSCRIPTION_ONNX_RAPIDE, MODELES_ONNX, MODELES_ONNX_QUALITE_DEFAUT.rapide),
      equilibree: choix(env.TRANSCRIPTION_ONNX_EQUILIBREE, MODELES_ONNX, MODELES_ONNX_QUALITE_DEFAUT.equilibree),
      maximale: choix(env.TRANSCRIPTION_ONNX_MAXIMALE, MODELES_ONNX, MODELES_ONNX_QUALITE_DEFAUT.maximale),
    },
    modelesQualite: {
      rapide: choix(env.TRANSCRIPTION_MODELE_RAPIDE, MODELES_WHISPER_CPP, MODELES_QUALITE_DEFAUT.rapide),
      equilibree: choix(env.TRANSCRIPTION_MODELE_EQUILIBREE, MODELES_WHISPER_CPP, MODELES_QUALITE_DEFAUT.equilibree),
      maximale: choix(env.TRANSCRIPTION_MODELE_MAXIMALE, MODELES_WHISPER_CPP, MODELES_QUALITE_DEFAUT.maximale),
    },
    threadsWhisper: entier(env.TRANSCRIPTION_THREADS_WHISPER, 8, 1, 32),
    blocS: entier(env.TRANSCRIPTION_BLOC_S, 300, 60, 1800),
    chevauchementS: reel(env.TRANSCRIPTION_CHEVAUCHEMENT_S, 1.5, 0, 5),
    vad: !['non', 'no', '0', 'false'].includes(String(env.TRANSCRIPTION_VAD ?? '').trim().toLowerCase()),
    correction: choix(env.TRANSCRIPTION_CORRECTION, ['auto', 'oui', 'non'], 'auto'),
    exclusif: choix(env.TRANSCRIPTION_EXCLUSIF, ['auto', 'oui', 'non'], 'auto'),
    ramCompte: env.TRANSCRIPTION_RAM_COMPTE ? lireTaille(env.TRANSCRIPTION_RAM_COMPTE, null) : null,
    modele: MODELES_ONNX.includes(modele) ? modele : 'base',
    threads: entier(env.TRANSCRIPTION_THREADS, 4, 1, 16),
    dossierModeles: String(env.TRANSCRIPTION_DOSSIER_MODELES ?? '').trim(),
    ramMax: lireTaille(env.TRANSCRIPTION_RAM_MAX, 8 * 1024 ** 3),
    blocageMs: entier(env.TRANSCRIPTION_BLOCAGE_MIN, 45, 10, 24 * 60) * 60_000,
    repos: reel(env.TRANSCRIPTION_REPOS, 0.25, 0, 5),
    essaisMax: entier(env.TRANSCRIPTION_ESSAIS, 3, 1, 10),
    delaiMaxH: reel(env.TRANSCRIPTION_DELAI_MAX, 24, 1, 24 * 14),
    dureeTravailleurMin: entier(env.TRANSCRIPTION_DUREE_TRAVAILLEUR, 120, 5, 24 * 60),
    disponible: false,
    qualites: null,
    vitesses: {},
    correctionDisponible: false,
  };
}

/**
 * Qualité effectivement disponible : celle demandée si son moteur est prêt, sinon la plus proche (en
 * descendant, puis en montant). Rend `{ qualite, moteur, modele }` ou null (aucun moteur). Sans détail des
 * qualités (`config.qualites` absent : ancien serveur, tests), le repli ONNX avec `config.modele`.
 */
export function qualiteEffective(config, demandee = config?.qualite ?? QUALITE_DEFAUT, options = {}) {
  if (!config?.disponible) return null;
  const q = config.qualites;
  if (!q) return { qualite: QUALITES.includes(demandee) ? demandee : QUALITE_DEFAUT, moteur: 'onnx', modele: config.modele };
  // Ne marche que dans un sens : pour une même qualité, l'autre moteur (bascule après un arrêt de force).
  const exclus = new Set(options.exclure ?? []);
  const i = Math.max(0, QUALITES.indexOf(demandee));
  const ordre = [i, ...Array.from({ length: QUALITES.length }, (_, k) => i - 1 - k).filter(k => k >= 0), ...Array.from({ length: QUALITES.length }, (_, k) => i + 1 + k).filter(k => k < QUALITES.length)];
  for (const k of ordre) {
    const x = q[QUALITES[k]];
    if (x?.disponible && !exclus.has(x.moteur)) return { qualite: QUALITES[k], moteur: x.moteur, modele: x.modele };
    // Le moteur principal de cette qualité est exclu : son remplaçant (autre moteur, même qualité), s'il y en a un.
    const alt = (x?.alternatives ?? []).find(a => a.disponible && !exclus.has(a.moteur));
    if (alt) return { qualite: QUALITES[k], moteur: alt.moteur, modele: alt.modele };
  }
  return null;
}

/** Clé de vitesse d'un modèle (ONNX : « base » ; whisper.cpp : « whispercpp:large-v3-turbo-q5_0 »). */
export const cleVitesse = (moteur, modele) => (moteur === 'whispercpp' ? `whispercpp:${modele}` : modele);

/** Attente au-delà de laquelle un travail « en attente » est signalé comme bloqué (le cron passe toutes les 5 min). */
export const ATTENTE_SUSPECTE_MS = 15 * 60_000;

/** Bail d'un travail en cours : renouvelé à chaque morceau ; expiré = processus mort (réessai). */
export const BAIL_MS = 10 * 60_000;
/** Attente avant un nouvel essai : 5 min, 15 min, 45 min… */
export const attenteEssai = essais => 5 * 60_000 * 3 ** Math.max(0, essais - 1);

export function servicesFileTranscription({ base, maintenant = () => Date.now(), config = configTranscriptionServeur() }) {
  /** Instructions SQL (à mettre dans un lot) : (re)met la réunion en file. */
  function instructionsEnfiler({ reunionId, teamId, langue, demandePar, qualite = config.qualite ?? QUALITE_DEFAUT, t = maintenant() }) {
    // Modèle prévu (affichage, estimation) : celui de la qualité disponible ; le processus de fond rechoisit au moment du calcul.
    const q = qualiteEffective(config, qualite);
    const modele = q ? cleVitesse(q.moteur, q.modele) : config.modele;
    return [
      { sql: 'DELETE FROM travaux_transcription WHERE reunion_id = ?', params: [reunionId] },
      {
        sql: `INSERT INTO travaux_transcription (id, team_id, reunion_id, statut, langue, modele, qualite, etape, correction_faite, demande_par, essais, progression_s, progression_prise_s, secondes_calcul, audio_calcule_s, erreur, cree_le, maj_le)
              VALUES (?, ?, ?, 'attente', ?, ?, ?, 'transcription', 0, ?, 0, 0, 0, 0, 0, '', ?, ?)`,
        params: [nouvelId(), teamId, reunionId, langue, modele, q?.qualite ?? qualite, demandePar ?? null, iso(t), iso(t)],
      },
    ];
  }

  const travailDe = reunionId => base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [reunionId]);

  /** Vitesse mesurée (secondes de calcul par seconde d'audio), ou celle de départ du modèle. */
  const vitesse = w => {
    if (Number(w.audio_calcule_s) > 20) return Number(w.secondes_calcul) / Number(w.audio_calcule_s);
    const mesuree = Number(config.vitesses?.[w.modele]);
    if (mesuree > 0) return mesuree;
    const depart = VITESSE_DEPART[w.modele] ?? 0.4;
    return String(w.modele).startsWith('whispercpp:') ? depart : depart / gainFils(config.threads);
  };

  /** État visible dans l'app (progression, temps restant estimé, rang dans la file). */
  async function etatPublic(w) {
    if (!w) return null;
    const duree = w.duree_s == null ? null : Number(w.duree_s);
    const progression = Number(w.progression_s ?? 0);
    let rang = 0;
    if (w.statut === 'attente') {
      rang = Number((await base.premier("SELECT COUNT(*) AS n FROM travaux_transcription WHERE statut IN ('attente', 'en_cours') AND cree_le < ? AND id <> ?", [w.cree_le, w.id]))?.n ?? 0);
    }
    return publierTravail(w, { duree, progression, rang });
  }

  function publierTravail(w, { duree = w.duree_s == null ? null : Number(w.duree_s), progression = Number(w.progression_s ?? 0), rang = 0 } = {}) {
    const enCours = w.statut === 'attente' || w.statut === 'en_cours';
    const t = maintenant();
    const essais = Number(w.essais ?? 0);
    // En attente sans nouvel essai prévu depuis plus de 15 min (le cron passe toutes les 5 min), ou en cours sans
    // battement (bail expiré) : le processus du serveur ne démarre pas ou s'est arrêté. Affiché tel quel, avec
    // « Relancer » (voir `relancer`).
    const depuis = Date.parse(w.maj_le ?? '');
    const prevu = w.prochain_essai_le ? Date.parse(w.prochain_essai_le) : null;
    const bloque =
      (w.statut === 'attente' && rang === 0 && Number.isFinite(depuis) && t - Math.max(depuis, prevu ?? 0) > ATTENTE_SUSPECTE_MS) ||
      (w.statut === 'en_cours' && w.verrou_jusqua && Date.parse(w.verrou_jusqua) < t - 60_000);
    return {
      statut: w.statut,
      modele: w.modele,
      qualite: w.qualite ?? null,
      // « transcription » puis « correction » (relecture par l'IA locale : `correctionFaite` segments relus).
      etape: w.etape ?? 'transcription',
      correctionFaite: Number(w.correction_faite ?? 0),
      langue: w.langue,
      progression,
      duree,
      pourcentage: duree ? Math.min(100, Math.floor((progression / duree) * 100)) : 0,
      restantS: enCours && duree ? Math.max(0, Math.round((duree - progression) * vitesse(w))) : null,
      rang,
      essais,
      essaisMax: config.essaisMax ?? 3,
      essaisRestants: Math.max(0, (config.essaisMax ?? 3) - essais),
      prochainEssai: w.statut === 'attente' && w.prochain_essai_le && Date.parse(w.prochain_essai_le) > t ? w.prochain_essai_le : null,
      bloque: Boolean(bloque),
      attenteDepuis: w.statut === 'attente' ? (w.maj_le ?? null) : null,
      erreur: w.erreur || null,
      debutLe: w.debut_le ?? null,
      finLe: w.fin_le ?? null,
      majLe: w.maj_le,
    };
  }

  /** États de plusieurs réunions d'un coup (listes) : Map reunionId → état (sans rang). */
  async function etatsDe(reunionIds) {
    const ids = [...new Set(reunionIds.filter(Boolean))];
    const sortie = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const tranche = ids.slice(i, i + 200);
      const lignes = await base.tous(`SELECT * FROM travaux_transcription WHERE reunion_id IN (${tranche.map(() => '?').join(', ')})`, tranche);
      for (const w of lignes) sortie.set(w.reunion_id, publierTravail(w));
    }
    return sortie;
  }

  /** Travaux disponibles maintenant (pour savoir s'il faut lancer un processus). */
  async function nombreAFaire() {
    const t = iso(maintenant());
    const r = await base.premier(
      `SELECT COUNT(*) AS n FROM travaux_transcription
        WHERE (statut = 'attente' AND (prochain_essai_le IS NULL OR prochain_essai_le <= ?)) OR (statut = 'en_cours' AND verrou_jusqua < ?)`,
      [t, t],
    );
    return Number(r?.n ?? 0);
  }

  /**
   * Remet en file les travaux dont le processus est mort (bail expiré) en comptant un essai, et
   * rend la liste des travaux devenus définitivement en échec (trop d'essais, délai dépassé) : le
   * serveur les signale (statut de la réunion, notification).
   */
  async function recuperer() {
    const t = maintenant();
    const echoues = [];
    const morts = await base.tous("SELECT * FROM travaux_transcription WHERE statut = 'en_cours' AND verrou_jusqua < ?", [iso(t)]);
    for (const w of morts) {
      // Le processus a avancé avant de mourir (limite de l'hébergeur sur un long travail) : pas d'essai
      // compté, on reprendra au dernier morceau fait. Sinon (il meurt sans avancer) : un essai de plus.
      const avance = Number(w.progression_s) > Number(w.progression_prise_s ?? 0) + 1;
      const essais = Number(w.essais) + (avance ? 0 : 1);
      if (essais >= config.essaisMax) {
        const r = await base.executer("UPDATE travaux_transcription SET statut = 'echec', essais = ?, erreur = ?, fin_le = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ? AND statut = 'en_cours' AND verrou_jusqua < ?", [
          essais,
          'Interrompue trop souvent (limite de l’hébergeur ou redémarrage).',
          iso(t),
          iso(t),
          w.id,
          iso(t),
        ]);
        if (r.changements) echoues.push({ ...w, statut: 'echec', essais, erreur: 'Interrompue trop souvent (limite de l’hébergeur ou redémarrage).' });
      } else {
        await base.executer("UPDATE travaux_transcription SET statut = 'attente', essais = ?, prochain_essai_le = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ? AND statut = 'en_cours' AND verrou_jusqua < ?", [
          essais,
          iso(t),
          iso(t),
          w.id,
          iso(t),
        ]);
      }
    }
    // Délai maximal dépassé (depuis la demande) : échec définitif, même s'il reste des essais.
    const limite = iso(t - config.delaiMaxH * 3_600_000);
    const vieux = await base.tous("SELECT * FROM travaux_transcription WHERE statut = 'attente' AND cree_le < ?", [limite]);
    for (const w of vieux) {
      const message = `Délai maximal dépassé (${config.delaiMaxH} h).`;
      const r = await base.executer("UPDATE travaux_transcription SET statut = 'echec', erreur = ?, fin_le = ?, maj_le = ? WHERE id = ? AND statut = 'attente'", [message, iso(t), iso(t), w.id]);
      if (r.changements) echoues.push({ ...w, statut: 'echec', erreur: message });
    }
    return echoues;
  }

  /** Prend le plus ancien travail disponible (bail posé). Rend la ligne, ou null. */
  async function prendre() {
    const t = maintenant();
    for (let i = 0; i < 5; i++) {
      const w = await base.premier("SELECT * FROM travaux_transcription WHERE statut = 'attente' AND (prochain_essai_le IS NULL OR prochain_essai_le <= ?) ORDER BY cree_le, id LIMIT 1", [iso(t)]);
      if (!w) return null;
      const r = await base.executer(
        "UPDATE travaux_transcription SET statut = 'en_cours', verrou_jusqua = ?, progression_prise_s = progression_s, debut_le = COALESCE(debut_le, ?), maj_le = ? WHERE id = ? AND statut = 'attente'",
        [iso(t + BAIL_MS), iso(t), iso(t), w.id],
      );
      // Un autre processus l'a pris entre-temps : on essaie le suivant.
      if (r.changements) return base.premier('SELECT * FROM travaux_transcription WHERE id = ?', [w.id]);
    }
    return null;
  }

  /**
   * Instruction SQL de progression (bail renouvelé) : à mettre dans le même lot que les segments
   * enregistrés. `WHERE statut = 'en_cours'` : un travail annulé entre-temps n'est pas ressuscité.
   */
  function instructionProgression(id, { progression, duree, secondesCalcul, audioCalcule }) {
    const t = maintenant();
    return {
      sql: "UPDATE travaux_transcription SET progression_s = ?, duree_s = ?, secondes_calcul = ?, audio_calcule_s = ?, verrou_jusqua = ?, maj_le = ? WHERE id = ? AND statut = 'en_cours'",
      params: [progression, duree, secondesCalcul, audioCalcule, iso(t + BAIL_MS), iso(t), id],
    };
  }

  /**
   * Instruction : étape du travail (« transcription », « correction ») et avancée de la correction (bail
   * renouvelé). Même condition que la progression : un travail annulé n'est pas ressuscité.
   */
  function instructionEtape(id, { etape, correctionFaite = 0, modele = null }) {
    const t = maintenant();
    return {
      sql: "UPDATE travaux_transcription SET etape = ?, correction_faite = ?, modele = COALESCE(?, modele), verrou_jusqua = ?, maj_le = ? WHERE id = ? AND statut = 'en_cours'",
      params: [etape, correctionFaite, modele, iso(t + BAIL_MS), iso(t), id],
    };
  }

  /** Prolonge le bail pendant un long calcul (décodage d'une longue vidéo, morceau lent). */
  async function prolonger(id) {
    const t = maintenant();
    const r = await base.executer("UPDATE travaux_transcription SET verrou_jusqua = ?, maj_le = ? WHERE id = ? AND statut = 'en_cours'", [iso(t + BAIL_MS), iso(t), id]);
    return Boolean(r.changements);
  }

  /** Le travail est-il toujours à nous (pas annulé, pas repris par un autre) ? */
  async function toujoursEnCours(id) {
    return Boolean(await base.premier("SELECT id FROM travaux_transcription WHERE id = ? AND statut = 'en_cours'", [id]));
  }

  const instructionTerminer = id => {
    const t = iso(maintenant());
    return { sql: "UPDATE travaux_transcription SET statut = 'termine', erreur = '', verrou_jusqua = NULL, fin_le = ?, maj_le = ? WHERE id = ?", params: [t, t, id] };
  };

  /** Rend le travail à la file sans compter d'essai (le processus passe la main : durée de travail atteinte). */
  async function rendre(id) {
    const t = iso(maintenant());
    await base.executer("UPDATE travaux_transcription SET statut = 'attente', verrou_jusqua = NULL, prochain_essai_le = NULL, maj_le = ? WHERE id = ? AND statut = 'en_cours'", [t, id]);
  }

  /**
   * Échec d'un essai : nouvel essai plus tard, ou échec définitif (`definitif`, ou trop d'essais).
   * Rend `{ definitif, essais }`.
   */
  async function echouer(id, erreur, { definitif = false } = {}) {
    const w = await base.premier('SELECT * FROM travaux_transcription WHERE id = ?', [id]);
    if (!w || !['en_cours', 'attente'].includes(w.statut)) return { definitif: false, essais: Number(w?.essais ?? 0), ignore: true };
    const t = maintenant();
    const essais = Number(w.essais) + 1;
    const message = String(erreur ?? 'Erreur inconnue.').slice(0, 300);
    if (definitif || essais >= config.essaisMax) {
      await base.executer("UPDATE travaux_transcription SET statut = 'echec', essais = ?, erreur = ?, verrou_jusqua = NULL, fin_le = ?, maj_le = ? WHERE id = ?", [essais, message, iso(t), iso(t), id]);
      return { definitif: true, essais };
    }
    await base.executer("UPDATE travaux_transcription SET statut = 'attente', essais = ?, erreur = ?, verrou_jusqua = NULL, prochain_essai_le = ?, maj_le = ? WHERE id = ?", [
      essais,
      message,
      iso(t + attenteEssai(essais)),
      iso(t),
      id,
    ]);
    return { definitif: false, essais };
  }

  /**
   * « Relancer » (bouton de l'app) : un travail en attente (essai prévu plus tard, ou rien ne démarre) ou resté
   * « en cours » sans battement est remis en tête de file, tout de suite, essais remis à zéro. Rend true si un
   * travail a été relancé. Un travail en cours bien vivant n'est pas touché.
   */
  async function relancer(reunionId) {
    const t = maintenant();
    const r = await base.executer(
      `UPDATE travaux_transcription SET statut = 'attente', essais = 0, erreur = '', prochain_essai_le = NULL, verrou_jusqua = NULL, maj_le = ?
        WHERE reunion_id = ? AND (statut = 'attente' OR (statut = 'en_cours' AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)))`,
      [iso(t), reunionId, iso(t)],
    );
    return Boolean(r.changements);
  }

  /** Nombre de travaux par statut (Administration), et ceux qui semblent bloqués. */
  async function resumeFile() {
    const t = maintenant();
    const lignes = await base.tous('SELECT statut, COUNT(*) AS n FROM travaux_transcription GROUP BY statut', []);
    const file = Object.fromEntries(STATUTS_TRAVAIL.map(x => [x, 0]));
    for (const l of lignes) file[l.statut] = Number(l.n);
    const b = await base.premier(
      "SELECT COUNT(*) AS n FROM travaux_transcription WHERE (statut = 'attente' AND maj_le < ? AND (prochain_essai_le IS NULL OR prochain_essai_le < ?)) OR (statut = 'en_cours' AND verrou_jusqua < ?)",
      [iso(t - ATTENTE_SUSPECTE_MS), iso(t - ATTENTE_SUSPECTE_MS), iso(t - 60_000)],
    );
    return { file, bloques: Number(b?.n ?? 0) };
  }

  /** Instruction : annule le travail d'une réunion (transcription faite autrement, dépôt retiré). */
  const instructionAnnuler = reunionId => {
    const t = iso(maintenant());
    return { sql: "UPDATE travaux_transcription SET statut = 'annule', verrou_jusqua = NULL, maj_le = ? WHERE reunion_id = ? AND statut IN ('attente', 'en_cours')", params: [t, reunionId] };
  };

  return {
    config,
    instructionsEnfiler,
    travailDe,
    etatPublic,
    etatsDe,
    nombreAFaire,
    recuperer,
    prendre,
    instructionProgression,
    instructionEtape,
    prolonger,
    toujoursEnCours,
    instructionTerminer,
    rendre,
    echouer,
    instructionAnnuler,
    relancer,
    resumeFile,
  };
}
