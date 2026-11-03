/**
 * Confidentialité des tâches de l'IA (décision du Fondateur, 30 octobre 2026 : « Non, ce n'est pas OK que ça envoie
 * mes réunions à NVIDIA »). Mode d'emploi : docs/esport/ia-api.md, partie « Confidentialité ».
 *
 * Une tâche CONFIDENTIELLE (contenu des réunions : audio, transcription brute, texte relu, résumés, PDF ; notes des
 * réunions de l'équipe CM — ordre du jour, compte rendu, tâches de suivi ; notes du
 * staff et suivi des joueurs ; strats) ne part JAMAIS chez un service externe (moteurs « api » et « api2 », API audio
 * de transcription) : seule l'IA LOCALE du serveur peut la faire, quels que soient IA_ORDRE, IA_ORDRE_LEGER, l'ordre
 * choisi dans l'Administration IA ou un moteur imposé par l'appelant. Si l'IA locale est indisponible, la tâche
 * n'est pas faite (la transcription reste brute, nettoyée sans IA).
 *
 * Seul le Fondateur peut lever cette règle, TÂCHE PAR TÂCHE (Administration IA, interrupteur « Autoriser l'envoi à
 * un service externe », désactivé par défaut) : ligne `externe_<tâche>` = '1' de `ia_reglages`, changement journalisé
 * (événement `ia.confidentialite_changed`). Toute valeur autre que '1', une base illisible ou une tâche inconnue de
 * cette liste = REFUS.
 *
 * Les autres tâches (profils de jeu, traductions, textes des posts CM, devblog) peuvent partir chez le fournisseur.
 */

/** Tâches confidentielles (clé du réglage) et leur libellé (Administration IA). */
export const TACHES_CONFIDENTIELLES = {
  transcription: 'Transcription des réunions (envoi de l’audio à une API de transcription)',
  correction: 'Relecture par l’IA des transcriptions de réunion',
  resumes: 'Résumés de réunion (texte, PDF)',
  suivi: 'Notes du staff et suivi des joueurs',
  strats: 'Strats et playbook',
};

/** Tâches qui peuvent partir chez le fournisseur d'API (aucune donnée de réunion). */
export const TACHES_EXTERNES_OK = {
  profils: 'Profils de jeu (brouillons, vérifications, recherche de sources)',
  traduction: 'Traductions',
  cm: 'Textes des posts CM',
  devblog: 'Devblog (notes de mise à jour rédigées à partir des messages de commit, sans donnée de réunion)',
};

/**
 * Noms de tâche (tels que passés à `discuterPour`) → tâche confidentielle. Tout nom qui évoque une réunion, un
 * résumé, une transcription, le suivi ou les strats y est rattaché, pour qu'un module nouveau qui oublierait la
 * liste ne fuie pas par un alias proche.
 */
const ALIAS_CONFIDENTIELS = {
  transcription: 'transcription',
  audio: 'transcription',
  correction: 'correction',
  relecture: 'correction',
  'correction-transcription': 'correction',
  resume: 'resumes',
  resumes: 'resumes',
  reunion: 'resumes',
  reunions: 'resumes',
  // Réunions de l'équipe CM (migration 0039) : ordre du jour, compte rendu, tâches de suivi.
  'cm-reunions': 'resumes',
  'notes-reunion': 'resumes',
  'pre-resume': 'resumes',
  suivi: 'suivi',
  'suivi-joueurs': 'suivi',
  'notes-staff': 'suivi',
  notes: 'suivi',
  strats: 'strats',
  strat: 'strats',
  playbook: 'strats',
};
const MOTIF_CONFIDENTIEL = /(transcri|reunion|r[ée]sum|meeting|suivi|staff|strat|playbook|correction|relecture)/i;

/** Tâche confidentielle (clé de TACHES_CONFIDENTIELLES) d'un nom de tâche, ou null si elle peut partir à l'extérieur. */
export function tacheConfidentielle(tache) {
  const t = String(tache ?? '')
    .trim()
    .toLowerCase();
  if (ALIAS_CONFIDENTIELS[t]) return ALIAS_CONFIDENTIELS[t];
  // Nom inconnu qui ressemble à une donnée de réunion / staff : confidentiel par prudence (relecture).
  if (MOTIF_CONFIDENTIEL.test(t)) return /strat|playbook/i.test(t) ? 'strats' : /suivi|staff/i.test(t) ? 'suivi' : /transcri|correction|relecture/i.test(t) ? 'correction' : 'resumes';
  return null;
}

/** Clé de `ia_reglages` qui lève la règle pour une tâche confidentielle. */
export const cleExterne = tache => `externe_${tache}`;

/**
 * Autorisations du Fondateur lues en base : { transcription: { autorise, le }, … } (toutes à false par défaut).
 * Une base illisible = aucune autorisation.
 */
export async function lireAutorisationsExternes(base) {
  const r = Object.fromEntries(Object.keys(TACHES_CONFIDENTIELLES).map(t => [t, { autorise: false, le: null }]));
  try {
    const lignes = await base.tous("SELECT cle, valeur, maj_le FROM ia_reglages WHERE cle LIKE 'externe_%'", []);
    for (const l of lignes) {
      const t = String(l.cle).slice('externe_'.length);
      if (r[t]) r[t] = { autorise: l.valeur === '1', le: l.maj_le ?? null };
    }
  } catch {
    // Base indisponible : rien n'est autorisé.
  }
  return r;
}

/** Le Fondateur a-t-il autorisé l'envoi de cette tâche confidentielle à un service externe ? (false par défaut) */
export async function externeAutorise(base, tache) {
  const t = tacheConfidentielle(tache) ?? tache;
  if (!TACHES_CONFIDENTIELLES[t] || !base) return false;
  return (await lireAutorisationsExternes(base))[t]?.autorise === true;
}

/** Fonction `externeAutorise(tache)` pour le répartiteur IA (`creerRepartiteurIa`). */
export const autorisationsDepuisBase = base => tache => externeAutorise(base, tache);

/** Message affiché quand la relecture IA ne peut pas se faire sans sortir du serveur. */
export const MESSAGE_RELECTURE_DESACTIVEE = 'Relecture IA désactivée : aucune IA locale disponible ; vos réunions ne quittent pas le serveur.';
