/**
 * Politique globale des apps : activée ou non, en maintenance, niveau par
 * défaut des nouveaux comptes.
 *
 * Elle est rangée **dans la liste des profils**, sur l'entrée de
 * l'administrateur, et non dans sa base chiffrée : le hub d'un ami doit la
 * lire, et un ami n'a pas la clé de l'administrateur. Elle ne contient donc
 * rien de secret — des identifiants d'app, des booléens et un message court.
 * Comme le reste de cette liste, elle n'est pas protégée en intégrité : elle
 * règle ce que le hub **propose**, elle ne chiffre rien.
 */

import { estNiveau, type NiveauAcces } from './niveaux';

export const VERSION_POLITIQUE = 1;
const MOTIF_APP = /^[a-z0-9-]{2,32}$/;
export const LONGUEUR_MAX_MESSAGE = 140;

export interface EtatAppPolitique {
  /** Faux : l'app est masquée pour tous, sauf l'administrateur. */
  active: boolean;
  /** Présent : l'app est en maintenance, ce message s'affiche sur sa tuile. */
  maintenance?: string;
  /** Niveau proposé à la création d'un compte. */
  defaut: NiveauAcces;
}

export interface PolitiqueHub {
  version: number;
  apps: Record<string, EtatAppPolitique>;
}

export const ETAT_APP_DEFAUT: EtatAppPolitique = { active: true, defaut: 'complet' };

export function politiqueVide(): PolitiqueHub {
  return { version: VERSION_POLITIQUE, apps: {} };
}

/** Texte d'une ligne, sans caractères de contrôle, borné. */
export function nettoyerMessage(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle.
  const propre = valeur.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, LONGUEUR_MAX_MESSAGE);
  return propre;
}

/** Lecture défensive : toute valeur inattendue retombe sur les défauts. */
export function lirePolitique(brut: unknown): PolitiqueHub {
  const politique = politiqueVide();
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return politique;
  }
  const apps = (brut as { apps?: unknown }).apps;
  if (!apps || typeof apps !== 'object' || Array.isArray(apps)) {
    return politique;
  }
  for (const [id, valeur] of Object.entries(apps as Record<string, unknown>)) {
    if (!MOTIF_APP.test(id) || !valeur || typeof valeur !== 'object') {
      continue;
    }
    const v = valeur as Record<string, unknown>;
    const etat: EtatAppPolitique = {
      active: v.active !== false,
      defaut: estNiveau(v.defaut) ? v.defaut : ETAT_APP_DEFAUT.defaut,
    };
    const message = nettoyerMessage(v.maintenance);
    if (message !== undefined) {
      etat.maintenance = message;
    }
    politique.apps[id] = etat;
  }
  return politique;
}

/** Forme enregistrée : seules les apps qui s'écartent des défauts. */
export function ecrirePolitique(politique: PolitiqueHub): PolitiqueHub | undefined {
  const apps: Record<string, EtatAppPolitique> = {};
  for (const [id, etat] of Object.entries(politique.apps)) {
    if (etat.active && etat.maintenance === undefined && etat.defaut === ETAT_APP_DEFAUT.defaut) {
      continue;
    }
    apps[id] = { ...etat };
  }
  return Object.keys(apps).length > 0 ? { version: VERSION_POLITIQUE, apps } : undefined;
}

export function etatApp(politique: PolitiqueHub | undefined, id: string): EtatAppPolitique {
  return politique?.apps[id] ?? ETAT_APP_DEFAUT;
}

export function modifierEtatApp(politique: PolitiqueHub | undefined, id: string, changement: Partial<EtatAppPolitique>): PolitiqueHub {
  const base = politique ?? politiqueVide();
  const suivant: EtatAppPolitique = { ...etatApp(base, id), ...changement };
  if ('maintenance' in changement) {
    const message = nettoyerMessage(changement.maintenance);
    if (message === undefined) {
      delete suivant.maintenance;
    } else {
      suivant.maintenance = message;
    }
  }
  return { version: VERSION_POLITIQUE, apps: { ...base.apps, [id]: suivant } };
}

/** Message affiché sur la tuile d'une app en maintenance. */
export function messageMaintenance(etat: EtatAppPolitique): string | undefined {
  if (etat.maintenance === undefined) {
    return undefined;
  }
  return etat.maintenance || 'Maintenance en cours : l’app revient bientôt.';
}
