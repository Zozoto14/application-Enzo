/**
 * Liens profonds vers une app du hub : `#/app/<id>` (pur, testé).
 *
 * Sur le site, « Ouvrir dans un nouvel onglet du navigateur » ouvre l'adresse
 * du site suivie de `#/app/<id>` : après le déverrouillage, l'app s'ouvre
 * directement. Le lien ne donne AUCUN droit : l'hôte revérifie, comme pour une
 * tuile, que le profil peut ouvrir l'app (`decisionLienProfond`). Les autres
 * usages de l'adresse (code de liaison `#liaison=AB1.…`) ne sont pas touchés.
 */

import { appsVisibles, etatTuile } from '../permissions';
import type { AppHub, ContexteHub } from '../types';
import { idValide } from './onglets';

const PREFIXE = '#/app/';

/** App désignée par un fragment d'adresse (`#/app/taches`, `#/app/taches/`, `#/app/taches?x`), sinon `undefined`. */
export function lireLienProfond(fragment: string | undefined | null): string | undefined {
  if (!fragment || !fragment.startsWith(PREFIXE)) {
    return undefined;
  }
  let id = fragment.slice(PREFIXE.length);
  try {
    id = decodeURIComponent(id);
  } catch {
    return undefined;
  }
  id = id.split(/[/?#&]/)[0]?.toLowerCase() ?? '';
  return idValide(id) ? id : undefined;
}

export function fragmentApp(id: string): string {
  return `${PREFIXE}${encodeURIComponent(id)}`;
}

/** Adresse profonde d'une app, à partir de l'adresse courante (son fragment est remplacé). */
export function adresseProfonde(adresse: string, id: string): string {
  const sansFragment = adresse.split('#')[0] ?? adresse;
  return `${sansFragment}${fragmentApp(id)}`;
}

export type DecisionLien =
  | { genre: 'ouvrir'; app: AppHub }
  | { genre: 'refuse'; motif: 'inconnue' | 'interdite' | 'maintenance'; message: string };

/** Le profil peut-il ouvrir cette app par un lien ? Mêmes règles qu'une tuile : droits par rang, politique, maintenance. */
export function decisionLienProfond(id: string, registre: readonly AppHub[], contexte: ContexteHub): DecisionLien {
  // Même message pour une app inconnue et une app interdite : le lien n'apprend rien des apps réservées.
  const message = 'Ce lien ouvre une app qui ne vous est pas ouverte : vous restez sur le hub.';
  const app = registre.find(candidate => candidate.id === id);
  if (!app) {
    return { genre: 'refuse', motif: 'inconnue', message };
  }
  if (!appsVisibles(registre, contexte).some(candidate => candidate.id === id)) {
    return { genre: 'refuse', motif: 'interdite', message };
  }
  if (!etatTuile(app, contexte).ouvrable) {
    return { genre: 'refuse', motif: 'maintenance', message: `${app.nom} est en maintenance : elle s’ouvrira quand elle sera de retour.` };
  }
  return { genre: 'ouvrir', app };
}

/** Le fragment désigne-t-il un écran à l'intérieur de l'app (`#/app/<id>/…`) ? */
export function aSousRoute(fragment: string | undefined | null): boolean {
  return Boolean(fragment && lireLienProfond(fragment) && /^#\/app\/[^/?#&]+\/./.test(fragment));
}

/** Fragment courant de la page (web), sinon `undefined`. */
export function fragmentCourant(): string | undefined {
  return (globalThis as { location?: { hash?: string } }).location?.hash;
}

/**
 * Efface le lien profond de l'adresse une fois suivi, sans recharger ni
 * ajouter d'entrée à l'historique : un rechargement revient alors sur le hub.
 */
export function effacerLienProfond(): void {
  const g = globalThis as { location?: { hash?: string; href?: string }; history?: { replaceState?(etat: unknown, titre: string, url: string): void } };
  if (!g.location?.hash || !lireLienProfond(g.location.hash) || !g.history?.replaceState || !g.location.href) {
    return;
  }
  // Adresse d'un écran DANS l'app (`#/app/esport/c/…`, lien direct d'une notification) : l'app la lit et la tient à
  // jour elle-même ; la garder permet de recharger la page au même endroit.
  if (aSousRoute(g.location.hash)) {
    return;
  }
  try {
    g.history.replaceState(null, '', g.location.href.split('#')[0]);
  } catch {
    // Adresse non modifiable (fichier local, bac à sable) : sans conséquence.
  }
}
