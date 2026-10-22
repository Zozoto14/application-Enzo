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
export const MODELES_SERVEUR = ['tiny', 'base', 'small'];
export const STATUTS_TRAVAIL = ['attente', 'en_cours', 'termine', 'echec', 'annule'];

/**
 * Vitesse de calcul de départ (secondes de calcul par seconde d'audio, 1 thread) pour estimer le
 * temps restant avant la première mesure ; mesurées sur un processeur x64 récent (docs/esport/resumes.md).
 */
export const VITESSE_DEPART = { tiny: 0.15, base: 0.3, small: 1.0 };

const entier = (v, defaut, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
const reel = (v, defaut, min, max) => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};

/**
 * Réglages lus dans ~/.appdashboard/esport.env (tous facultatifs) :
 *
 *   TRANSCRIPTION_MODE=serveur            mode par défaut des teams : serveur | navigateur | externe
 *   TRANSCRIPTION_MODELE=base             tiny | base | small
 *   TRANSCRIPTION_THREADS=1               fils de calcul (1 ou 2 sur un hébergement mutualisé ; 4 au plus)
 *   TRANSCRIPTION_DOSSIER_MODELES=…       dossier du moteur et des modèles (hors public_html)
 *   TRANSCRIPTION_RAM_MAX=2G              mémoire au-delà de laquelle le travail s'arrête proprement
 *   TRANSCRIPTION_REPOS=0.25              pause après chaque morceau (fraction de son temps de calcul)
 *   TRANSCRIPTION_ESSAIS=3                essais avant l'échec définitif
 *   TRANSCRIPTION_DELAI_MAX=24            heures au plus entre la demande et la fin
 *   TRANSCRIPTION_DUREE_TRAVAILLEUR=120   minutes de travail d'un processus avant de passer la main
 *
 * `disponible` (moteur installé) est complété par le serveur Node (moteur.mjs) ; ailleurs, false.
 */
export function configTranscriptionServeur(env = {}) {
  const mode = String(env.TRANSCRIPTION_MODE ?? '').trim().toLowerCase();
  const modele = String(env.TRANSCRIPTION_MODELE ?? '').trim().toLowerCase();
  return {
    mode: MODES_TRANSCRIPTION.includes(mode) ? mode : 'serveur',
    modele: MODELES_SERVEUR.includes(modele) ? modele : 'base',
    threads: entier(env.TRANSCRIPTION_THREADS, 1, 1, 4),
    dossierModeles: String(env.TRANSCRIPTION_DOSSIER_MODELES ?? '').trim(),
    ramMax: lireTaille(env.TRANSCRIPTION_RAM_MAX, 2 * 1024 ** 3),
    repos: reel(env.TRANSCRIPTION_REPOS, 0.25, 0, 5),
    essaisMax: entier(env.TRANSCRIPTION_ESSAIS, 3, 1, 10),
    delaiMaxH: reel(env.TRANSCRIPTION_DELAI_MAX, 24, 1, 24 * 14),
    dureeTravailleurMin: entier(env.TRANSCRIPTION_DUREE_TRAVAILLEUR, 120, 5, 24 * 60),
    disponible: false,
  };
}

/** Bail d'un travail en cours : renouvelé à chaque morceau ; expiré = processus mort (réessai). */
export const BAIL_MS = 10 * 60_000;
/** Attente avant un nouvel essai : 5 min, 15 min, 45 min… */
export const attenteEssai = essais => 5 * 60_000 * 3 ** Math.max(0, essais - 1);

export function servicesFileTranscription({ base, maintenant = () => Date.now(), config = configTranscriptionServeur() }) {
  /** Instructions SQL (à mettre dans un lot) : (re)met la réunion en file. */
  function instructionsEnfiler({ reunionId, teamId, langue, demandePar, t = maintenant() }) {
    return [
      { sql: 'DELETE FROM travaux_transcription WHERE reunion_id = ?', params: [reunionId] },
      {
        sql: `INSERT INTO travaux_transcription (id, team_id, reunion_id, statut, langue, modele, demande_par, essais, progression_s, progression_prise_s, secondes_calcul, audio_calcule_s, erreur, cree_le, maj_le)
              VALUES (?, ?, ?, 'attente', ?, ?, ?, 0, 0, 0, 0, 0, '', ?, ?)`,
        params: [nouvelId(), teamId, reunionId, langue, config.modele, demandePar ?? null, iso(t), iso(t)],
      },
    ];
  }

  const travailDe = reunionId => base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [reunionId]);

  /** Vitesse mesurée (secondes de calcul par seconde d'audio), ou celle de départ du modèle. */
  const vitesse = w => (Number(w.audio_calcule_s) > 20 ? Number(w.secondes_calcul) / Number(w.audio_calcule_s) : (VITESSE_DEPART[w.modele] ?? 0.4) / Math.min(2, config.threads || 1));

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
    return {
      statut: w.statut,
      modele: w.modele,
      langue: w.langue,
      progression,
      duree,
      pourcentage: duree ? Math.min(100, Math.floor((progression / duree) * 100)) : 0,
      restantS: enCours && duree ? Math.max(0, Math.round((duree - progression) * vitesse(w))) : null,
      rang,
      essais: Number(w.essais ?? 0),
      prochainEssai: w.statut === 'attente' && w.prochain_essai_le ? w.prochain_essai_le : null,
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
    prolonger,
    toujoursEnCours,
    instructionTerminer,
    rendre,
    echouer,
    instructionAnnuler,
  };
}
