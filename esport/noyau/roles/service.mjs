/**
 * Page « Rôles et permissions » (Esport › Membres, migration 0033 ; docs/esport/roles-permissions.md).
 *
 * Réservée au Fondateur et aux comptes qui ont la permission du club `roles.gerer` (aucun rôle ne l'a par défaut ;
 * seul le Fondateur l'accorde ou la retire). Elle réunit :
 *  - les RÔLES DU CLUB (`roles_globaux`) : « Second CEO » (rôle système) et les rôles personnalisés, avec leurs
 *    comptes ; permissions transverses (catalogue.json, `permissionsGlobales`) et permissions CM du club ;
 *  - les RÔLES CM (Équipe CM : routes /cm/roles, ouvertes à roles.gerer) ;
 *  - le MODÈLE des rôles des nouvelles teams (Fondateur seul) et la liste des teams dont l'acteur gère les rôles
 *    (routes /teams/:id/roles existantes) ;
 *  - le journal des changements de rôles (club, CM, teams).
 *
 * Garde-fous (en plus de l'authentification) :
 *  - le Fondateur n'a aucune ligne : rien ne peut lui retirer un droit ; on n'attribue aucun rôle au compte
 *    « principal » ;
 *  - un délégué n'accorde que des permissions qu'il a, ne touche pas à un rôle qui a une permission qu'il n'a pas,
 *    ne touche jamais à `roles.gerer` (impossible de s'en priver ou d'en priver un autre délégué) ni au rôle
 *    « Second CEO » (permissions, attribution) : le Fondateur seul ;
 *  - le modèle des nouvelles teams : le Fondateur seul.
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteNettoye } from '../outils.mjs';
import { CLE_PROPRIETAIRE, ROLES_SYSTEME, TOUTES_PERMISSIONS, catalogue, permissionsRoleSysteme } from '../permissions.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { PERMISSIONS_ROLES_CM } from '../sponsors/commun.mjs';
import { PERMISSIONS_FONDATEUR_SEUL, PERMISSIONS_GLOBALES, aGlobale, permissionsGlobalesDe } from './globales.mjs';
import { modeleRolesTeam } from './modele.mjs';

export const PERMISSION_ROLES = 'roles.gerer';
export const CLE_SECOND_CEO = 'second_ceo';
/** Permissions qu'un rôle du club peut porter : celles du club et celles du CM (Équipe CM). */
export const PERMISSIONS_ROLE_GLOBAL = Object.freeze([...new Set([...PERMISSIONS_GLOBALES, ...PERMISSIONS_ROLES_CM])]);
/** Rôles système du club que seul le Fondateur modifie et attribue. */
const ROLES_RESERVES = new Set([CLE_SECOND_CEO]);
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
const MOTIF_COMPTE = /^[a-z0-9]{6,16}$/;
const MOTIF_ID = /^[a-z0-9-]{1,40}$/;

/** Permissions par défaut d'un rôle système du club (catalogue.json, `rolesGlobauxSysteme`). */
export function permissionsParDefautGlobal(cle) {
  const r = catalogue.rolesGlobauxSysteme.find(x => x.cle === cle);
  if (!r) return null;
  return PERMISSIONS_ROLE_GLOBAL.filter(p => !(r.sauf ?? []).includes(p)).sort();
}

/** Actions du journal affichées par la page (club, CM, teams). */
export const ACTIONS_JOURNAL_ROLES = Object.freeze([
  'roles.global_cree',
  'roles.global_modifie',
  'roles.global_supprime',
  'roles.global_attribue',
  'roles.global_retire',
  'roles.modele_modifie',
  'cm.role_cree',
  'cm.role_modifie',
  'cm.role_supprime',
  'cm.affectation_ajoutee',
  'cm.affectation_retiree',
  'role.created',
  'role.updated',
  'role.deleted',
]);

function lirePermissions(v, autorisees) {
  if (!Array.isArray(v) || v.length > 100 || v.some(p => typeof p !== 'string' || !autorisees.includes(p))) throw echec(400, 'permissions', 'Permissions inconnues ou illisibles.');
  return [...new Set(v)].sort();
}

export function servicesRoles({ base, maintenant = () => Date.now(), noyau }) {
  // -------------------------------------------------------------- Droits

  /** Contexte de la page : `roles.gerer` (Fondateur : toujours), sinon 404 (on ne dit pas que la page existe). */
  async function ctxRoles(acteur) {
    if (!(await aGlobale(base, acteur, PERMISSION_ROLES))) throw echec(404, 'route', 'Adresse inconnue.');
    return { acteur, fondateur: Boolean(acteur.superAdmin), permissions: await permissionsGlobalesDe(base, acteur) };
  }

  function erreurEscalade(manquantes) {
    const e = echec(403, 'escalade', 'Vous ne pouvez pas accorder une permission que vous n’avez pas.');
    e.details = { manquantes };
    return e;
  }

  /**
   * Garde-fous d'un délégué (le Fondateur passe toujours) : `touchees` (permissions ajoutées ou retirées), `portees`
   * (permissions du rôle avant et après) ; `role` : la ligne du rôle (rôle réservé ?).
   */
  function garder(ctx, { role = null, touchees = [], portees = [] }) {
    if (ctx.fondateur) return;
    if (role?.cle_systeme && ROLES_RESERVES.has(role.cle_systeme)) throw echec(403, 'role-reserve', 'Seul le Fondateur modifie ou attribue ce rôle.');
    const reservees = [...touchees, ...portees].filter(p => PERMISSIONS_FONDATEUR_SEUL.includes(p));
    if (reservees.length) {
      const e = echec(403, 'permission-reservee', 'Seul le Fondateur accorde ou retire cette permission.');
      e.details = { permissions: [...new Set(reservees)] };
      throw e;
    }
    const manquantes = [...new Set([...touchees, ...portees])].filter(p => !ctx.permissions.has(p));
    if (manquantes.length) throw erreurEscalade(manquantes);
  }

  // -------------------------------------------------------------- Lectures

  async function permissionsDuRole(id) {
    return (await base.tous('SELECT permission FROM roles_globaux_permissions WHERE role_id = ? ORDER BY permission', [id])).map(l => l.permission);
  }

  async function roleLigne(id) {
    if (typeof id !== 'string' || !MOTIF_ID.test(id)) throw echec(404, 'role-introuvable', 'Rôle introuvable.');
    const r = await base.premier('SELECT * FROM roles_globaux WHERE id = ?', [id]);
    if (!r) throw echec(404, 'role-introuvable', 'Rôle introuvable.');
    return r;
  }

  async function rolePublic(r) {
    const permissions = await permissionsDuRole(r.id);
    const lignes = await base.tous('SELECT compte_id, attribue_le FROM roles_globaux_affectations WHERE role_id = ? ORDER BY attribue_le', [r.id]);
    const noms = await pseudosDe(base, lignes.map(l => l.compte_id));
    const defaut = r.cle_systeme ? permissionsParDefautGlobal(r.cle_systeme) : null;
    return {
      id: r.id,
      nom: r.nom,
      couleur: r.couleur,
      systeme: Number(r.systeme) === 1,
      cle: r.cle_systeme ?? null,
      permissions,
      comptes: lignes.map(l => ({ compte: l.compte_id, pseudo: noms[l.compte_id] ?? null, depuis: l.attribue_le })),
      ...(defaut ? { permissionsParDefaut: defaut, modifie: defaut.join() !== permissions.join() } : {}),
    };
  }

  async function rolesGlobaux() {
    const sortie = [];
    for (const r of await base.tous('SELECT * FROM roles_globaux ORDER BY systeme DESC, position, nom', [])) sortie.push(await rolePublic(r));
    return sortie;
  }

  async function modele() {
    const m = await modeleRolesTeam(base);
    return ROLES_SYSTEME.filter(r => r.cle !== CLE_PROPRIETAIRE).map(r => {
      const defaut = [...new Set(permissionsRoleSysteme(r.cle))].sort();
      const permissions = m[r.cle] ?? defaut;
      return { cle: r.cle, nom: r.nom, couleur: r.couleur, permissions, permissionsParDefaut: defaut, modifie: defaut.join() !== permissions.join() };
    });
  }

  /** `GET /roles-permissions` : tout ce que la page affiche. */
  async function vue(acteur) {
    const ctx = await ctxRoles(acteur);
    // Teams dont l'acteur gère les rôles (roles.manage) : l'éditeur des rôles de la team s'y ouvre.
    const teams = (await noyau.contextesDe(acteur)).filter(c => c.permissions.has('roles.manage')).map(c => ({ id: c.team.id, nom: c.team.nom, slug: c.team.slug }));
    const comptes = await base.tous("SELECT id, pseudo FROM comptes WHERE id <> 'principal' ORDER BY pseudo_cle LIMIT 2000", []);
    return {
      moi: { fondateur: ctx.fondateur, permissions: ctx.fondateur ? [] : [...ctx.permissions].sort() },
      globaux: { roles: await rolesGlobaux(), permissions: [...PERMISSIONS_ROLE_GLOBAL], reservees: [...PERMISSIONS_FONDATEUR_SEUL] },
      cm: { permissions: [...PERMISSIONS_ROLES_CM] },
      modele: { roles: await modele(), permissions: [...TOUTES_PERMISSIONS], modifiable: ctx.fondateur },
      teams,
      comptes: comptes.map(c => ({ compte: c.id, pseudo: c.pseudo })),
    };
  }

  // -------------------------------------------------------------- Rôles du club

  async function nomLibre(nom, sauf = '') {
    const autres = await base.tous('SELECT nom FROM roles_globaux WHERE id <> ?', [sauf]);
    if (autres.some(r => r.nom.toLocaleLowerCase('fr') === nom.toLocaleLowerCase('fr'))) throw echec(409, 'nom-pris', 'Un rôle du club porte déjà ce nom.');
  }

  const lireNom = v => {
    const nom = texteNettoye(v, 40);
    if (nom.length < 2) throw echec(400, 'nom', 'Nom du rôle : 2 caractères au moins.');
    return nom;
  };

  const lireCouleur = v => {
    const c = v ?? '#8b8b9a';
    if (typeof c !== 'string' || !MOTIF_COULEUR.test(c)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
    return c.toLowerCase();
  };

  /** `POST /roles-permissions/globaux` `{ nom, couleur, permissions }` (dupliquer : les permissions d'un autre rôle). */
  async function creer(acteur, corps) {
    const ctx = await ctxRoles(acteur);
    const nom = lireNom(corps?.nom);
    const couleur = lireCouleur(corps?.couleur);
    const permissions = lirePermissions(corps?.permissions ?? [], PERMISSIONS_ROLE_GLOBAL);
    garder(ctx, { touchees: permissions });
    await nomLibre(nom);
    const pos = await base.premier('SELECT MAX(position) AS p FROM roles_globaux', []);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO roles_globaux (id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, NULL, ?, ?, 0, ?, ?, ?)', params: [id, nom, couleur, Number(pos?.p ?? 0) + 1, iso(t), iso(t)] },
      ...permissions.map(p => ({ sql: 'INSERT INTO roles_globaux_permissions (role_id, permission) VALUES (?, ?)', params: [id, p] })),
      evenement('roles.global_cree', { acteur: acteur.compte, entiteType: 'role_global', entiteId: id, charge: { nom, permissions }, maintenant: t }),
    ]);
    return rolePublic(await roleLigne(id));
  }

  async function enregistrer(acteur, r, { nom, couleur, permissions, ajoutees, retirees, retabli = false }) {
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE roles_globaux SET nom = ?, couleur = ?, maj_le = ? WHERE id = ?', params: [nom, couleur, iso(t), r.id] },
      ...(permissions
        ? [{ sql: 'DELETE FROM roles_globaux_permissions WHERE role_id = ?', params: [r.id] }, ...permissions.map(p => ({ sql: 'INSERT INTO roles_globaux_permissions (role_id, permission) VALUES (?, ?)', params: [r.id, p] }))]
        : []),
      evenement('roles.global_modifie', { acteur: acteur.compte, entiteType: 'role_global', entiteId: r.id, charge: { nom, ajoutees, retirees, ...(retabli ? { retabli: true } : {}) }, maintenant: t }),
    ]);
    return rolePublic(await roleLigne(r.id));
  }

  /** `PATCH /roles-permissions/globaux/:id` `{ nom?, couleur?, permissions? }` (rôle système : permissions seulement). */
  async function modifier(acteur, id, corps) {
    const ctx = await ctxRoles(acteur);
    const r = await roleLigne(id);
    if (Number(r.systeme) === 1 && (corps?.nom !== undefined || corps?.couleur !== undefined)) throw echec(403, 'role-systeme', 'Le nom et la couleur d’un rôle système ne changent pas.');
    const actuelles = await permissionsDuRole(r.id);
    const nom = corps?.nom !== undefined ? lireNom(corps.nom) : r.nom;
    const couleur = corps?.couleur !== undefined ? lireCouleur(corps.couleur) : r.couleur;
    const permissions = corps?.permissions !== undefined ? lirePermissions(corps.permissions, PERMISSIONS_ROLE_GLOBAL) : null;
    const ajoutees = permissions ? permissions.filter(p => !actuelles.includes(p)) : [];
    const retirees = permissions ? actuelles.filter(p => !permissions.includes(p)) : [];
    garder(ctx, { role: r, touchees: [...ajoutees, ...retirees], portees: actuelles });
    if (corps?.nom !== undefined) await nomLibre(nom, r.id);
    return enregistrer(acteur, r, { nom, couleur, permissions, ajoutees, retirees });
  }

  /** `POST /roles-permissions/globaux/:id/retablir` : permissions par défaut d'un rôle système du club. */
  async function retablir(acteur, id) {
    const ctx = await ctxRoles(acteur);
    const r = await roleLigne(id);
    const defaut = r.cle_systeme ? permissionsParDefautGlobal(r.cle_systeme) : null;
    if (!defaut) throw echec(409, 'role-personnalise', 'Seul un rôle système se rétablit.');
    const actuelles = await permissionsDuRole(r.id);
    const ajoutees = defaut.filter(p => !actuelles.includes(p));
    const retirees = actuelles.filter(p => !defaut.includes(p));
    garder(ctx, { role: r, touchees: [...ajoutees, ...retirees], portees: actuelles });
    return enregistrer(acteur, r, { nom: r.nom, couleur: r.couleur, permissions: defaut, ajoutees, retirees, retabli: true });
  }

  /** `DELETE /roles-permissions/globaux/:id` : rôle personnalisé (ses comptes le perdent). */
  async function supprimer(acteur, id) {
    const ctx = await ctxRoles(acteur);
    const r = await roleLigne(id);
    if (Number(r.systeme) === 1) throw echec(403, 'role-systeme', 'Un rôle système ne se supprime pas.');
    garder(ctx, { role: r, portees: await permissionsDuRole(r.id) });
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM roles_globaux_affectations WHERE role_id = ?', params: [r.id] },
      { sql: 'DELETE FROM roles_globaux_permissions WHERE role_id = ?', params: [r.id] },
      { sql: 'DELETE FROM roles_globaux WHERE id = ?', params: [r.id] },
      evenement('roles.global_supprime', { acteur: acteur.compte, entiteType: 'role_global', entiteId: r.id, charge: { nom: r.nom }, maintenant: t }),
    ]);
    return { ok: true };
  }

  function lireCompte(v) {
    if (v === 'principal') throw echec(403, 'compte-fondateur', 'Le Fondateur a déjà tous les droits : on ne lui attribue ni ne lui retire aucun rôle.');
    if (typeof v !== 'string' || !MOTIF_COMPTE.test(v)) throw echec(400, 'compte', 'Compte inconnu.');
    return v;
  }

  /** `POST /roles-permissions/globaux/:id/comptes` `{ compte }` : donne le rôle à un compte Esport. */
  async function attribuer(acteur, id, corps) {
    const ctx = await ctxRoles(acteur);
    const r = await roleLigne(id);
    const compte = lireCompte(corps?.compte);
    if (!(await base.premier('SELECT id FROM comptes WHERE id = ?', [compte]))) throw echec(400, 'compte', 'Ce compte n’a pas encore de profil Esport.');
    garder(ctx, { role: r, portees: await permissionsDuRole(r.id) });
    const t = maintenant();
    const res = await base.lot([
      { sql: 'INSERT INTO roles_globaux_affectations (role_id, compte_id, attribue_par, attribue_le) VALUES (?, ?, ?, ?) ON CONFLICT (role_id, compte_id) DO NOTHING', params: [r.id, compte, acteur.compte, iso(t)] },
    ]);
    if (res[0].changements === 1) {
      await base.lot([evenement('roles.global_attribue', { acteur: acteur.compte, entiteType: 'role_global', entiteId: r.id, charge: { nom: r.nom, compte }, maintenant: t })]);
    }
    return rolePublic(r);
  }

  /** `DELETE /roles-permissions/globaux/:id/comptes/:compte` : retire le rôle. */
  async function retirer(acteur, id, compteBrut) {
    const ctx = await ctxRoles(acteur);
    const r = await roleLigne(id);
    const compte = lireCompte(compteBrut);
    garder(ctx, { role: r, portees: await permissionsDuRole(r.id) });
    const t = maintenant();
    const res = await base.lot([{ sql: 'DELETE FROM roles_globaux_affectations WHERE role_id = ? AND compte_id = ?', params: [r.id, compte] }]);
    if (res[0].changements === 1) {
      await base.lot([evenement('roles.global_retire', { acteur: acteur.compte, entiteType: 'role_global', entiteId: r.id, charge: { nom: r.nom, compte }, maintenant: t })]);
    }
    return rolePublic(r);
  }

  // -------------------------------------------------------------- Modèle des nouvelles teams (Fondateur)

  async function cleModele(acteur, cle) {
    const ctx = await ctxRoles(acteur);
    if (!ctx.fondateur) throw echec(403, 'super-admin', 'Seul le Fondateur règle le modèle des nouvelles teams.');
    if (cle === CLE_PROPRIETAIRE || !ROLES_SYSTEME.some(r => r.cle === cle)) throw echec(404, 'role-introuvable', 'Rôle introuvable.');
    return ctx;
  }

  async function ecrireModele(acteur, cle, permissions, retabli) {
    const actuel = (await modele()).find(r => r.cle === cle);
    const t = maintenant();
    await base.lot([
      retabli
        ? { sql: 'DELETE FROM roles_modele WHERE cle_systeme = ?', params: [cle] }
        : {
            sql: 'INSERT INTO roles_modele (cle_systeme, permissions, maj_par, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT (cle_systeme) DO UPDATE SET permissions = excluded.permissions, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
            params: [cle, JSON.stringify(permissions), acteur.compte, iso(t)],
          },
      evenement('roles.modele_modifie', {
        acteur: acteur.compte,
        entiteType: 'role_modele',
        entiteId: cle,
        charge: { cle, ajoutees: permissions.filter(p => !actuel.permissions.includes(p)), retirees: actuel.permissions.filter(p => !permissions.includes(p)), ...(retabli ? { retabli: true } : {}) },
        maintenant: t,
      }),
    ]);
    return (await modele()).find(r => r.cle === cle);
  }

  /** `PUT /roles-permissions/modele/:cle` `{ permissions }` : modèle d'un rôle système des nouvelles teams. */
  async function modifierModele(acteur, cle, corps) {
    await cleModele(acteur, cle);
    return ecrireModele(acteur, cle, lirePermissions(corps?.permissions, TOUTES_PERMISSIONS), false);
  }

  /** `POST /roles-permissions/modele/:cle/retablir` : retour aux permissions par défaut du catalogue. */
  async function retablirModele(acteur, cle) {
    await cleModele(acteur, cle);
    return ecrireModele(acteur, cle, [...new Set(permissionsRoleSysteme(cle))].sort(), true);
  }

  // -------------------------------------------------------------- Journal

  /** `GET /roles-permissions/journal?avant=` : 100 derniers changements de rôles (club, CM, teams). */
  async function journal(acteur, { avant } = {}) {
    await ctxRoles(acteur);
    const pagine = typeof avant === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(avant);
    const actions = ACTIONS_JOURNAL_ROLES;
    const lignes = await base.tous(
      `SELECT * FROM journal WHERE action IN (${actions.map(() => '?').join(', ')}) ${pagine ? 'AND cree_le < ?' : ''} ORDER BY cree_le DESC, id LIMIT 100`,
      [...actions, ...(pagine ? [avant] : [])],
    );
    const noms = await pseudosDe(base, lignes.flatMap(l => [l.acteur_id, jsonOu(l.meta, {}).compte]).filter(Boolean));
    const teams = new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE id', lignes.map(l => l.team_id).filter(Boolean))).map(t => [t.id, t.nom]));
    return {
      entrees: lignes.map(l => ({ id: l.id, acteur: l.acteur_id ?? null, action: l.action, entiteId: l.entite_id ?? null, meta: jsonOu(l.meta, {}), team: l.team_id ? { id: l.team_id, nom: teams.get(l.team_id) ?? null } : null, date: l.cree_le })),
      noms,
    };
  }

  return { vue, creer, modifier, retablir, supprimer, attribuer, retirer, modifierModele, retablirModele, journal };
}

/**
 * Routes de la page (après l'authentification). `undefined` : pas une route d'ici.
 *   GET            /roles-permissions                                 la page
 *   POST           /roles-permissions/globaux                         créer (ou dupliquer) un rôle du club
 *   PATCH|DELETE   /roles-permissions/globaux/:id                     modifier, supprimer
 *   POST           /roles-permissions/globaux/:id/retablir            permissions par défaut (rôle système)
 *   POST           /roles-permissions/globaux/:id/comptes             { compte } : attribuer
 *   DELETE         /roles-permissions/globaux/:id/comptes/:compte     retirer
 *   PUT            /roles-permissions/modele/:cle ; POST …/retablir   modèle des nouvelles teams (Fondateur)
 *   GET            /roles-permissions/journal?avant=                  journal des changements
 */
export async function routesRoles({ rl, acteur, chemin, methode: m, url, lireCorps, limite }) {
  if (chemin !== '/roles-permissions' && !chemin.startsWith('/roles-permissions/')) return undefined;
  const ecrire = async () => {
    await limite('roles', acteur.compte);
    return lireCorps();
  };
  if (chemin === '/roles-permissions' && m === 'GET') return rl.vue(acteur);
  if (chemin === '/roles-permissions/journal' && m === 'GET') return rl.journal(acteur, { avant: url.searchParams.get('avant') ?? undefined });
  if (chemin === '/roles-permissions/globaux' && m === 'POST') return rl.creer(acteur, await ecrire());
  const g = /^\/roles-permissions\/globaux\/([^/]+)(?:\/(retablir|comptes)(?:\/([^/]+))?)?$/.exec(chemin);
  if (g) {
    const id = decodeURIComponent(g[1]);
    if (!g[2] && m === 'PATCH') return rl.modifier(acteur, id, await ecrire());
    if (!g[2] && m === 'DELETE') return rl.supprimer(acteur, id);
    if (g[2] === 'retablir' && !g[3] && m === 'POST') return rl.retablir(acteur, id);
    if (g[2] === 'comptes' && !g[3] && m === 'POST') return rl.attribuer(acteur, id, await ecrire());
    if (g[2] === 'comptes' && g[3] && m === 'DELETE') return rl.retirer(acteur, id, decodeURIComponent(g[3]));
  }
  const md = /^\/roles-permissions\/modele\/([a-z_]+)(\/retablir)?$/.exec(chemin);
  if (md && !md[2] && m === 'PUT') return rl.modifierModele(acteur, md[1], await ecrire());
  if (md && md[2] && m === 'POST') return rl.retablirModele(acteur, md[1]);
  throw echec(404, 'route', 'Adresse inconnue.');
}
