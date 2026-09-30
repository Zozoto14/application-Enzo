/**
 * Verrouillage automatique GLOBAL de l'application, en données pures.
 *
 * Pourquoi l'ancien verrouillage « ne marchait pas après un certain temps » :
 * il n'existait qu'un verrouillage du PANNEAU d'administration (voir
 * `hub/admin/verrouillage.ts`) ; rien ne verrouillait l'application elle-même,
 * qui restait déverrouillée (clés en mémoire) tant que la fenêtre était ouverte.
 *
 * Règles :
 *  - l'inactivité se mesure avec l'horloge murale (`Date.now`), jamais avec un
 *    compteur de minuteries : un onglet en arrière-plan ralentit ses minuteries
 *    et une mise en veille les suspend. À la reprise, on compare simplement
 *    l'heure d'aujourd'hui à celle de la dernière activité ;
 *  - à l'échéance on VERROUILLE, sauf pendant une lecture (film, épisode) : on
 *    demande alors « Êtes-vous toujours là ? » avec un compte à rebours, et on
 *    ne verrouille qu'à la fin de ce compte à rebours sans réponse ;
 *  - après une mise en veille (saut d'horloge entre deux vérifications), la
 *    lecture a forcément été interrompue : verrouillage direct, sans dialogue ;
 *  - 0 minute : jamais. Le réglage est celui de l'appareil (non synchronisé).
 */

/** Délais proposés, en minutes (0 : jamais). */
export const DELAIS_VERROU_MINUTES: readonly number[] = [5, 15, 30, 45, 60, 120, 0];
export const DELAI_VERROU_DEFAUT = 45;
/** Durée du compte à rebours « Êtes-vous toujours là ? ». */
export const DELAI_PRESENCE_SECONDES = 60;
/** Un écart plus grand entre deux vérifications (pas de 1 s ; un onglet masqué tourne au plus lentement à la minute) signale une mise en veille. */
export const SAUT_VEILLE_MS = 120_000;

/** Clé du réglage sur l'appareil (localStorage) ; hors navigateur, le paramètre du profil (non synchronisé). */
export const CLE_VERROU_AUTO = 'appdashboard.verrou-auto-minutes';

/** Délai lu d'un stockage : toute valeur qui n'est pas dans la liste retombe sur le défaut. */
export function lireDelaiVerrou(brut: string | null | undefined): number {
  if (brut === null || brut === undefined || brut === '') {
    return DELAI_VERROU_DEFAUT;
  }
  const valeur = Number(brut);
  return DELAIS_VERROU_MINUTES.includes(valeur) ? valeur : DELAI_VERROU_DEFAUT;
}

export function libelleDelaiVerrou(minutes: number): string {
  if (minutes === 0) return 'Jamais';
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

export interface EtatVerrouAuto {
  /** Dernière activité réelle (ms). */
  derniere: number;
  /** Dernière vérification (ms) : sert à repérer une mise en veille. */
  verifieLe: number;
  /** Début du dialogue de présence, s'il est affiché. */
  demandeDepuis?: number;
}

export type DecisionVerrou =
  | { action: 'rien' }
  | { action: 'verrouiller'; motif: 'inactivite' | 'veille' | 'presence' }
  | { action: 'demander'; depuis: number; secondesRestantes: number };

export function etatInitial(maintenant: number): EtatVerrouAuto {
  return { derniere: maintenant, verifieLe: maintenant };
}

/** Une vraie activité de l'utilisateur. Sans effet pendant le dialogue : seul « Je suis là » le ferme. */
export function noterActivite(etat: EtatVerrouAuto, maintenant: number): EtatVerrouAuto {
  return etat.demandeDepuis !== undefined ? etat : { ...etat, derniere: Math.max(etat.derniere, maintenant) };
}

/** « Je suis là » : repart de zéro et ferme le dialogue. */
export function confirmerPresence(etat: EtatVerrouAuto, maintenant: number): EtatVerrouAuto {
  return { derniere: maintenant, verifieLe: maintenant };
}

export interface ContexteVerrou {
  /** Délai en minutes ; 0 : jamais. */
  delaiMinutes: number;
  /** Une lecture (film, épisode) est en cours. */
  lecture: boolean;
  presenceSecondes?: number;
}

/**
 * Décide quoi faire à l'instant `maintenant`. Rend aussi le nouvel état
 * (heure de vérification, début éventuel du dialogue).
 */
export function evaluer(etat: EtatVerrouAuto, maintenant: number, contexte: ContexteVerrou): { etat: EtatVerrouAuto; decision: DecisionVerrou } {
  const presenceMs = (contexte.presenceSecondes ?? DELAI_PRESENCE_SECONDES) * 1000;
  const delaiMs = contexte.delaiMinutes * 60_000;
  const saut = maintenant - etat.verifieLe >= SAUT_VEILLE_MS;
  const suivant: EtatVerrouAuto = { ...etat, verifieLe: maintenant };

  if (contexte.delaiMinutes <= 0) {
    // Jamais : on oublie aussi un éventuel dialogue (réglage changé pendant l'attente).
    return { etat: { ...suivant, demandeDepuis: undefined }, decision: { action: 'rien' } };
  }
  if (etat.demandeDepuis !== undefined) {
    const ecoule = maintenant - etat.demandeDepuis;
    if (saut || ecoule >= presenceMs) {
      return { etat: suivant, decision: { action: 'verrouiller', motif: saut ? 'veille' : 'presence' } };
    }
    return { etat: suivant, decision: { action: 'demander', depuis: etat.demandeDepuis, secondesRestantes: Math.ceil((presenceMs - ecoule) / 1000) } };
  }
  if (maintenant - etat.derniere < delaiMs) {
    return { etat: suivant, decision: { action: 'rien' } };
  }
  if (contexte.lecture && !saut) {
    return {
      etat: { ...suivant, demandeDepuis: maintenant },
      decision: { action: 'demander', depuis: maintenant, secondesRestantes: Math.ceil(presenceMs / 1000) },
    };
  }
  return { etat: suivant, decision: { action: 'verrouiller', motif: saut ? 'veille' : 'inactivite' } };
}

export type MotifVerrou = 'inactivite' | 'veille' | 'presence' | 'manuel';

/** Message affiché sur l'écran de déverrouillage ; rien quand l'utilisateur a verrouillé lui-même. */
export function messageVerrou(motif: MotifVerrou, delaiMinutes: number): string | undefined {
  if (motif === 'manuel') {
    return undefined;
  }
  if (motif === 'presence') {
    return 'Verrouillé : sans réponse à « Êtes-vous toujours là ? ».';
  }
  return motif === 'veille'
    ? `Verrouillé après une mise en veille (délai réglé : ${libelleDelaiVerrou(delaiMinutes)}).`
    : `Verrouillé après ${libelleDelaiVerrou(delaiMinutes)} d’inactivité.`;
}

interface StockageTexte {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
}

/**
 * Réglage de l'APPAREIL (jamais synchronisé) : `localStorage` sur le site et
 * sur PC ; en natif, où il n'y en a pas, un paramètre de la base locale du
 * profil (hors liste de synchronisation).
 */
export function lireDelaiAppareil(local: StockageTexte | undefined, lireParametre?: () => string | undefined): number {
  try {
    if (local) {
      return lireDelaiVerrou(local.getItem(CLE_VERROU_AUTO));
    }
    return lireDelaiVerrou(lireParametre?.());
  } catch {
    return DELAI_VERROU_DEFAUT;
  }
}

export function ecrireDelaiAppareil(local: StockageTexte | undefined, minutes: number, ecrireParametre?: (valeur: string) => void): void {
  try {
    if (local) {
      local.setItem(CLE_VERROU_AUTO, String(minutes));
    } else {
      ecrireParametre?.(String(minutes));
    }
  } catch {
    // Stockage refusé : le réglage vaut pour cette session seulement.
  }
}

/** Réglages d'essai (tests de bout en bout) : un délai court, posé dans le stockage de l'appareil. Ne peut que raccourcir. */
export const CLE_VERROU_AUTO_ESSAI_MS = 'appdashboard.verrou-auto-essai-ms';
export const CLE_PRESENCE_ESSAI_S = 'appdashboard.presence-essai-s';

export function lireSurchargeEssai(local: { getItem(cle: string): string | null } | undefined): { delaiMinutes?: number; presenceSecondes?: number } {
  try {
    const ms = Number(local?.getItem(CLE_VERROU_AUTO_ESSAI_MS));
    const s = Number(local?.getItem(CLE_PRESENCE_ESSAI_S));
    return {
      ...(Number.isFinite(ms) && ms >= 500 && ms <= 120_000 ? { delaiMinutes: ms / 60_000 } : {}),
      ...(Number.isFinite(s) && s >= 1 && s <= 60 ? { presenceSecondes: s } : {}),
    };
  } catch {
    return {};
  }
}
