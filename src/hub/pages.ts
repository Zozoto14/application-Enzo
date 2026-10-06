/**
 * Les deux pages du hub, d'après la catégorie déclarée par chaque app du
 * registre (`AppHub.page`) :
 *
 *  - « Applications » (`publique`) : les apps publiques, visibles selon les
 *    autorisations habituelles (`permissions.ts`) ;
 *  - « Administration » (`administration`) : les apps réservées à
 *    l'administration (Administration, Abonnements…).
 *
 * Une page n'existe que si au moins une de ses apps est visible pour le
 * profil : un ami n'a donc jamais de page « Administration », un Gestionnaire
 * l'a (pour l'Administration limitée). Rien n'est codé en dur : ajouter une
 * app = une entrée de registre avec sa catégorie. Données pures, testées.
 */

import { appsVisibles } from './permissions';
import type { AppHub, CategorieApp, ContexteHub } from './types';

export const PAGES_HUB: ReadonlyArray<{ id: CategorieApp; libelle: string; glyphe: string; description: string }> = [
  { id: 'publique', libelle: 'Applications', glyphe: '▦', description: 'Applications : vos apps' },
  { id: 'administration', libelle: 'Administration', glyphe: '◈', description: 'Administration : apps réservées à l’administration' },
];

/** Catégorie d'une app : « publique » si le registre ne dit rien. */
export function categorieDe(app: Pick<AppHub, 'page'>): CategorieApp {
  return app.page === 'administration' ? 'administration' : 'publique';
}

/** Apps d'une catégorie, dans l'ordre du registre (sans filtre de droits). */
export function appsDeCategorie(registre: readonly AppHub[], categorie: CategorieApp): AppHub[] {
  return registre.filter(app => categorieDe(app) === categorie);
}

/** Apps visibles pour le profil sur une page du hub. */
export function appsDePage(registre: readonly AppHub[], contexte: ContexteHub, page: CategorieApp): AppHub[] {
  return appsVisibles(registre, contexte).filter(app => categorieDe(app) === page);
}

/** Pages à proposer : « Applications » toujours, « Administration » seulement si l'une de ses apps est visible. */
export function pagesVisibles(registre: readonly AppHub[], contexte: ContexteHub): CategorieApp[] {
  const visibles = appsVisibles(registre, contexte);
  return PAGES_HUB.map(p => p.id).filter(id => id === 'publique' || visibles.some(app => categorieDe(app) === id));
}

/** Page réellement affichée : celle demandée si elle est permise, sinon « Applications ». */
export function pageEffective(demandee: CategorieApp | undefined, pages: readonly CategorieApp[]): CategorieApp {
  return demandee && pages.includes(demandee) ? demandee : 'publique';
}
