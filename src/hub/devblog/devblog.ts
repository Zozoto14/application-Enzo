/**
 * Quand montrer le devblog, en données pures.
 *
 * Règles :
 *  - on ne montre d'office que la **dernière** entrée, une seule fois par
 *    profil (mémorisée dans la base chiffrée du profil, clé `hub.devblog`) ;
 *  - jamais à un profil neuf : il n'a rien connu d'avant, lui présenter des
 *    « nouveautés » n'aurait pas de sens. Toutes les entrées sont alors
 *    marquées lues d'emblée ;
 *  - jamais une entrée vide (sans fonctionnalité visible pour ce profil) ;
 *  - les autres entrées restent consultables (historique).
 */

import type { EtapeVisite } from '../../ui/VisiteGuidee';
import { ENTREES, type EntreeDevblog, type Fonctionnalite } from './entrees';

export const CLE_DEVBLOG = 'hub.devblog';

export interface EtatDevblog {
  version: 1;
  vues: string[];
}

export function lireEtat(brut: string | undefined | null): EtatDevblog | undefined {
  if (!brut) {
    return undefined;
  }
  try {
    const o = JSON.parse(brut) as { vues?: unknown };
    const vues = Array.isArray(o.vues) ? o.vues.filter((v): v is string => typeof v === 'string' && v.length <= 32) : [];
    return { version: 1, vues: [...new Set(vues)] };
  } catch {
    return { version: 1, vues: [] };
  }
}

export function marquerLues(brut: string | undefined | null, versions: readonly string[]): string {
  const etat = lireEtat(brut) ?? { version: 1, vues: [] };
  return JSON.stringify({ version: 1, vues: [...new Set([...etat.vues, ...versions])].sort() });
}

/** Fonctionnalités d'une entrée visibles pour ce profil. */
export function fonctionnalitesPour(entree: EntreeDevblog, admin: boolean): Fonctionnalite[] {
  return entree.fonctionnalites.filter(f => admin || !f.adminSeulement);
}

export type Decision =
  | { genre: 'afficher'; entree: EntreeDevblog }
  /** Profil neuf : tout marquer lu, sans rien montrer. */
  | { genre: 'marquer'; valeur: string }
  | { genre: 'rien' };

export function decider(
  brut: string | undefined | null,
  options: { profilNeuf: boolean; admin: boolean },
  entrees: readonly EntreeDevblog[] = ENTREES,
): Decision {
  const etat = lireEtat(brut);
  if (!etat && options.profilNeuf) {
    return { genre: 'marquer', valeur: marquerLues(brut, entrees.map(e => e.version)) };
  }
  const derniere = entrees[0];
  if (!derniere || etat?.vues.includes(derniere.version) || fonctionnalitesPour(derniere, options.admin).length === 0) {
    return { genre: 'rien' };
  }
  return { genre: 'afficher', entree: derniere };
}

/** Étapes de la visite guidée des nouveautés, tirées d'une entrée. */
export function etapesVisite(entree: EntreeDevblog, admin: boolean): EtapeVisite[] {
  return [
    { id: `devblog-${entree.version}-intro`, emoji: '✨', titre: entree.titre, texte: entree.resume },
    ...fonctionnalitesPour(entree, admin).map(f => ({ id: `devblog-${entree.version}-${f.id}`, emoji: f.emoji, titre: f.titre, texte: f.texte })),
  ];
}
