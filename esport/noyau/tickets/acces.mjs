/**
 * Tickets : droits d'un compte de l'app (docs/esport/tickets.md, « Qui voit quoi »).
 *
 * Quatre permissions du CLUB (catalogue.json, vue `permissions_club`) :
 *  - `tickets.voir`       : la page Tickets, les tickets des catégories qu'on traite ;
 *  - `tickets.repondre`   : répondre depuis l'app, notes internes, prendre en charge, attente, fermer, rouvrir ;
 *  - `tickets.gerer`      : TOUTES les catégories, assigner, changer de catégorie, ajouter / retirer quelqu'un,
 *                           transcripts, statistiques (implique voir et répondre) ;
 *  - `tickets.configurer` : la Configuration (n'ouvre AUCUN ticket à lui seul).
 *
 * Catégories visibles (sans `tickets.gerer`) : celles dont un des « rôles de l'app » est porté par le compte (rôle du
 * club `club:<id>` ou rôle CM attribué au club `cm:<id>`) ; une catégorie sans rôle de l'app réglé est visible de
 * tous ceux qui ont `tickets.voir`. Le Fondateur voit tout. Recalculé à chaque requête (aucun cache) : un rôle retiré
 * ferme aussitôt ce qu'il ouvrait (routes, temps réel rejoué au nom du destinataire, notifications relues).
 *
 * Un compte sans `tickets.voir` ni `tickets.configurer` reçoit 404 sur toute la rubrique.
 */

import { echec, jsonOu } from '../outils.mjs';

export const PERMISSIONS_TICKETS = Object.freeze(['tickets.voir', 'tickets.repondre', 'tickets.gerer', 'tickets.configurer']);

/** Rôles de l'app d'un compte, sous la forme des réglages d'une catégorie : `club:<id>` et `cm:<id>`. */
export async function rolesAppDe(base, compte) {
  if (!compte) return new Set();
  const club = await base.tous('SELECT role_id FROM roles_globaux_affectations WHERE compte_id = ?', [compte]);
  const cm = await base.tous("SELECT role_id FROM cm_affectations WHERE compte_id = ? AND portee = 'club'", [compte]);
  return new Set([...club.map(l => `club:${l.role_id}`), ...cm.map(l => `cm:${l.role_id}`)]);
}

/** La catégorie (ligne brute) est-elle traitée par ces rôles ? Sans rôle de l'app réglé : oui. */
export function categorieOuverte(categorie, roles) {
  const voulus = jsonOu(categorie?.roles_app, []);
  if (!Array.isArray(voulus) || voulus.length === 0) return true;
  return voulus.some(r => roles.has(r));
}

/**
 * Droits d'un acteur : `{ voir, repondre, gerer, configurer, tout, categories: Set }` (`tout` : toutes les catégories,
 * `categories` vide alors). Fondateur : tout.
 */
export async function droitsTickets(base, acteur) {
  if (acteur?.superAdmin) return { voir: true, repondre: true, gerer: true, configurer: true, tout: true, categories: new Set(), fondateur: true };
  if (!acteur?.compte) return { voir: false, repondre: false, gerer: false, configurer: false, tout: false, categories: new Set() };
  const voulues = PERMISSIONS_TICKETS;
  const lignes = await base.tous(`SELECT DISTINCT permission FROM permissions_club WHERE compte_id = ? AND permission IN (${voulues.map(() => '?').join(', ')})`, [acteur.compte, ...voulues]);
  const p = new Set(lignes.map(l => l.permission));
  const gerer = p.has('tickets.gerer');
  const repondre = gerer || p.has('tickets.repondre');
  const voir = repondre || p.has('tickets.voir');
  const configurer = p.has('tickets.configurer');
  const categories = new Set();
  if (voir && !gerer) {
    const roles = await rolesAppDe(base, acteur.compte);
    for (const c of await base.tous('SELECT id, roles_app FROM tickets_categories', [])) if (categorieOuverte(c, roles)) categories.add(c.id);
  }
  return { voir, repondre, gerer, configurer, tout: gerer, categories };
}

/** L'acteur voit-il les tickets de cette catégorie ? */
export const voitCategorie = (droits, categorieId) => Boolean(droits.voir && (droits.tout || droits.categories.has(categorieId)));

/** Contexte de la rubrique : 404 sans voir ni configurer ; `exiger` : une des permissions (403 sinon). */
export async function contexteTickets(base, acteur, { exiger } = {}) {
  const droits = await droitsTickets(base, acteur);
  if (!droits.voir && !droits.configurer) throw echec(404, 'route', 'Adresse inconnue.');
  if (exiger && !droits[exiger]) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  return { acteur, droits };
}

/**
 * Comptes de l'app qui voient une catégorie (destinataires des notifications) : Fondateur, `tickets.gerer`, et
 * `tickets.voir` / `tickets.repondre` avec un des rôles de la catégorie (ou sans rôle réglé). `repondre` : seulement
 * ceux qui peuvent répondre.
 */
export async function comptesDeCategorie(base, categorieId, { repondre = false } = {}) {
  const categorie = await base.premier('SELECT id, roles_app FROM tickets_categories WHERE id = ?', [categorieId]);
  const voulues = repondre ? ['tickets.repondre', 'tickets.gerer'] : PERMISSIONS_TICKETS.filter(p => p !== 'tickets.configurer');
  const lignes = await base.tous(`SELECT compte_id, permission FROM permissions_club WHERE permission IN (${voulues.map(() => '?').join(', ')})`, voulues);
  const parCompte = new Map();
  for (const l of lignes) {
    if (!parCompte.has(l.compte_id)) parCompte.set(l.compte_id, new Set());
    parCompte.get(l.compte_id).add(l.permission);
  }
  const sortie = new Set();
  for (const [compte, perms] of parCompte) {
    if (perms.has('tickets.gerer')) sortie.add(compte);
    else if (categorie && categorieOuverte(categorie, await rolesAppDe(base, compte))) sortie.add(compte);
  }
  if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) sortie.add('principal');
  return sortie;
}
