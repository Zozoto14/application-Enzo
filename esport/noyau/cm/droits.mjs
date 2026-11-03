/**
 * Section CM : rôles CM du club, affectations, réglages, « moi » et journal de la section.
 *
 * Rôles CM : « Responsable CM » et « Correspondant CM » (rôles système : nom et couleur fixes, permissions
 * modifiables, « Rétablir » revient aux permissions par défaut), et ceux que le Fondateur crée. Une
 * AFFECTATION donne un rôle à un compte pour tout le club, ou pour une team (le compte doit en être membre
 * actif : c'est le correspondant de la team).
 *
 * Gestion : cm.gerer au niveau du club (le Fondateur l'a toujours). Anti-escalade comme pour les rôles de
 * team : hors Fondateur, on n'ajoute à un rôle, et on n'attribue, que des permissions que l'on a soi-même.
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { MOTIF_COMPTE, MOTIF_COULEUR, PORTEE_CLUB, contexteCm, exiger, exigerUuid, lirePortee, porteesDe, teamDePortee } from './commun.mjs';
import { CLES_RESEAUX } from './reseaux.mjs';
import { PERMISSIONS_ROLES_CM, droitsSponsors } from '../sponsors/commun.mjs';
import { permissionsGlobalesDe } from '../roles/globales.mjs';
import { droitsReunions } from './reunions/service.mjs';
import { horsTableauxInterdits, lecteurTableaux } from './acces.mjs';
import { lecteurLiens } from './liensAcces.mjs';

/** Permissions par défaut des rôles CM système (migration 0023 ; 0024 : Sponsors pour le Responsable CM ; 0027 : Drive ; 0030 : trombinoscope ; 0032 : badges ; 0039 : réunions). */
export const ROLES_CM_SYSTEME = Object.freeze({
  responsable: ['cm.voir', 'cm.deposer', 'cm.editer', 'cm.valider', 'cm.gerer', 'cm.clips.proposer', 'sponsors.voir', 'sponsors.gerer', 'cm.drive.voir', 'cm.drive.envoyer', 'cm.drive.gerer', 'membres.trombi.voir', 'membres.trombi.editer', 'membres.badges.gerer', 'cm.reunions.voir', 'cm.reunions.gerer'],
  correspondant: ['cm.voir', 'cm.deposer', 'cm.clips.proposer', 'cm.drive.voir', 'cm.drive.envoyer', 'membres.trombi.voir', 'cm.reunions.voir'],
});

/** Types de suggestions automatiques (cartes brouillon dans « Idées »). */
export const TYPES_SUGGESTIONS = Object.freeze(['tournoi', 'j1', 'jourj', 'resultat', 'final']);
export const REGLAGES_DEFAUT = Object.freeze({
  suggestions: { actif: true, types: Object.fromEntries(TYPES_SUGGESTIONS.map(t => [t, true])), reseaux: [...CLES_RESEAUX], hashtags: '' },
});

/** Réglages de la section (valeurs par défaut complétées). */
export async function lireReglagesCm(base) {
  const l = await base.premier("SELECT valeur FROM cm_reglages WHERE cle = 'suggestions'", []);
  const v = jsonOu(l?.valeur, {});
  const d = REGLAGES_DEFAUT.suggestions;
  return {
    suggestions: {
      actif: typeof v.actif === 'boolean' ? v.actif : d.actif,
      types: Object.fromEntries(TYPES_SUGGESTIONS.map(t => [t, typeof v.types?.[t] === 'boolean' ? v.types[t] : true])),
      reseaux: Array.isArray(v.reseaux) ? CLES_RESEAUX.filter(r => v.reseaux.includes(r)) : [...d.reseaux],
      hashtags: typeof v.hashtags === 'string' ? v.hashtags : '',
    },
  };
}

function lirePermissionsCm(v) {
  if (!Array.isArray(v) || v.length > 20 || v.some(p => !PERMISSIONS_ROLES_CM.includes(p))) throw echec(400, 'permissions', 'Permissions inconnues ou illisibles.');
  return [...new Set(v)].sort();
}

export function servicesDroitsCm({ base, maintenant = () => Date.now() }) {
  /**
   * Contexte de gestion du club : `cm.gerer`. Les rôles CM et leurs affectations (Équipe CM, page Rôles et
   * permissions) s'ouvrent aussi à `roles.gerer` (`{ roles: true }`). Anti-escalade : toutes les permissions du club
   * de l'acteur comptent (CM, Sponsors, trombinoscope : vue permissions_club, migration 0033).
   */
  async function ctxClub(acteur, { roles = false } = {}) {
    const ctx = await contexteCm(base, acteur, PORTEE_CLUB);
    const club = await permissionsGlobalesDe(base, acteur);
    if (!(ctx.permissions.has('cm.gerer') || (roles && club.has('roles.gerer')))) exiger(ctx, 'cm.gerer');
    return { ...ctx, permissions: new Set([...ctx.permissions, ...club, ...(await droitsSponsors(base, acteur))]) };
  }

  function antiEscalade(ctx, demandees) {
    if (ctx.acteur.superAdmin) return;
    const manquantes = demandees.filter(p => !ctx.permissions.has(p));
    if (manquantes.length) {
      const e = echec(403, 'escalade', 'Vous ne pouvez pas accorder une permission que vous n’avez pas.');
      e.details = { manquantes };
      throw e;
    }
  }

  async function permissionsDuRole(roleId) {
    return (await base.tous('SELECT permission FROM cm_role_permissions WHERE role_id = ? ORDER BY permission', [roleId])).map(l => l.permission);
  }

  async function roleLigne(id) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) throw echec(404, 'role-introuvable', 'Rôle introuvable.');
    const r = await base.premier('SELECT * FROM cm_roles WHERE id = ?', [id]);
    if (!r) throw echec(404, 'role-introuvable', 'Rôle introuvable.');
    return r;
  }

  async function rolePublic(r, affectations = 0) {
    const permissions = await permissionsDuRole(r.id);
    const defaut = r.cle_systeme ? [...(ROLES_CM_SYSTEME[r.cle_systeme] ?? [])].sort() : null;
    return {
      id: r.id,
      nom: r.nom,
      couleur: r.couleur,
      systeme: Number(r.systeme) === 1,
      cle: r.cle_systeme ?? null,
      permissions,
      affectations,
      ...(defaut ? { permissionsParDefaut: defaut, modifie: defaut.join() !== permissions.join() } : {}),
    };
  }

  /** `GET /cm/roles` : rôles CM (permissions, nombre d'affectations). */
  async function roles(acteur) {
    await ctxClub(acteur, { roles: true });
    const lignes = await base.tous('SELECT * FROM cm_roles ORDER BY systeme DESC, position, nom', []);
    const n = new Map((await base.tous('SELECT role_id, COUNT(*) AS n FROM cm_affectations GROUP BY role_id', [])).map(l => [l.role_id, Number(l.n)]));
    const sortie = [];
    for (const r of lignes) sortie.push(await rolePublic(r, n.get(r.id) ?? 0));
    return { roles: sortie, permissions: [...PERMISSIONS_ROLES_CM] };
  }

  async function creerRole(acteur, corps) {
    const ctx = await ctxClub(acteur, { roles: true });
    const nom = texteNettoye(corps?.nom, 40);
    if (nom.length < 2) throw echec(400, 'nom', 'Nom du rôle : 2 caractères au moins.');
    const couleur = corps?.couleur ?? '#8b8b9a';
    if (!MOTIF_COULEUR.test(couleur)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
    const permissions = lirePermissionsCm(corps?.permissions ?? []);
    antiEscalade(ctx, permissions);
    const existants = await base.tous('SELECT nom FROM cm_roles', []);
    if (existants.some(r => r.nom.toLocaleLowerCase('fr') === nom.toLocaleLowerCase('fr'))) throw echec(409, 'nom-pris', 'Un rôle CM porte déjà ce nom.');
    const pos = await base.premier('SELECT MAX(position) AS p FROM cm_roles', []);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO cm_roles (id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, NULL, ?, ?, 0, ?, ?, ?)', params: [id, nom, couleur.toLowerCase(), Number(pos?.p ?? 0) + 1, iso(t), iso(t)] },
      ...permissions.map(p => ({ sql: 'INSERT INTO cm_role_permissions (role_id, permission) VALUES (?, ?)', params: [id, p] })),
      evenement('cm.role_cree', { acteur: acteur.compte, entiteType: 'cm_role', entiteId: id, charge: { nom, permissions }, maintenant: t }),
    ]);
    return rolePublic(await roleLigne(id));
  }

  async function modifierRole(acteur, id, corps) {
    const ctx = await ctxClub(acteur, { roles: true });
    const r = await roleLigne(id);
    const systeme = Number(r.systeme) === 1;
    if (systeme && (corps?.nom !== undefined || corps?.couleur !== undefined)) throw echec(403, 'role-systeme', 'Le nom et la couleur d’un rôle système ne changent pas.');
    const lot = [];
    const t = maintenant();
    let nom = r.nom;
    if (corps?.nom !== undefined) {
      nom = texteNettoye(corps.nom, 40);
      if (nom.length < 2) throw echec(400, 'nom', 'Nom du rôle : 2 caractères au moins.');
      const autres = await base.tous('SELECT nom FROM cm_roles WHERE id <> ?', [r.id]);
      if (autres.some(x => x.nom.toLocaleLowerCase('fr') === nom.toLocaleLowerCase('fr'))) throw echec(409, 'nom-pris', 'Un rôle CM porte déjà ce nom.');
    }
    if (corps?.couleur !== undefined && !MOTIF_COULEUR.test(corps.couleur)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
    lot.push({ sql: 'UPDATE cm_roles SET nom = ?, couleur = ?, maj_le = ? WHERE id = ?', params: [nom, corps?.couleur !== undefined ? corps.couleur.toLowerCase() : r.couleur, iso(t), r.id] });
    let ajoutees = [];
    let retirees = [];
    if (corps?.permissions !== undefined) {
      const nouvelles = lirePermissionsCm(corps.permissions);
      const actuelles = await permissionsDuRole(r.id);
      ajoutees = nouvelles.filter(p => !actuelles.includes(p));
      retirees = actuelles.filter(p => !nouvelles.includes(p));
      antiEscalade(ctx, ajoutees);
      lot.push({ sql: 'DELETE FROM cm_role_permissions WHERE role_id = ?', params: [r.id] }, ...nouvelles.map(p => ({ sql: 'INSERT INTO cm_role_permissions (role_id, permission) VALUES (?, ?)', params: [r.id, p] })));
    }
    lot.push(evenement('cm.role_modifie', { acteur: acteur.compte, entiteType: 'cm_role', entiteId: r.id, charge: { nom, ajoutees, retirees }, maintenant: t }));
    await base.lot(lot);
    return rolePublic(await roleLigne(r.id));
  }

  async function retablirRole(acteur, id) {
    const ctx = await ctxClub(acteur, { roles: true });
    const r = await roleLigne(id);
    if (!r.cle_systeme) throw echec(409, 'role-personnalise', 'Seul un rôle système se rétablit.');
    const defaut = ROLES_CM_SYSTEME[r.cle_systeme] ?? [];
    const actuelles = await permissionsDuRole(r.id);
    antiEscalade(ctx, defaut.filter(p => !actuelles.includes(p)));
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_role_permissions WHERE role_id = ?', params: [r.id] },
      ...defaut.map(p => ({ sql: 'INSERT INTO cm_role_permissions (role_id, permission) VALUES (?, ?)', params: [r.id, p] })),
      evenement('cm.role_modifie', { acteur: acteur.compte, entiteType: 'cm_role', entiteId: r.id, charge: { nom: r.nom, retabli: true }, maintenant: t }),
    ]);
    return rolePublic(await roleLigne(r.id));
  }

  async function supprimerRole(acteur, id) {
    const ctx = await ctxClub(acteur, { roles: true });
    const r = await roleLigne(id);
    if (Number(r.systeme) === 1) throw echec(403, 'role-systeme', 'Un rôle système ne se supprime pas.');
    antiEscalade(ctx, await permissionsDuRole(r.id));
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_affectations WHERE role_id = ?', params: [r.id] },
      { sql: 'DELETE FROM cm_role_permissions WHERE role_id = ?', params: [r.id] },
      { sql: 'DELETE FROM cm_roles WHERE id = ?', params: [r.id] },
      evenement('cm.role_supprime', { acteur: acteur.compte, entiteType: 'cm_role', entiteId: r.id, charge: { nom: r.nom }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Affectations

  async function affectations(acteur) {
    await ctxClub(acteur, { roles: true });
    const lignes = await base.tous('SELECT a.*, r.nom AS role_nom, r.couleur AS role_couleur, r.cle_systeme FROM cm_affectations a JOIN cm_roles r ON r.id = a.role_id ORDER BY a.cree_le', []);
    const noms = await pseudosDe(base, lignes.map(l => l.compte_id));
    const teams = new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE id', lignes.map(l => l.team_id).filter(Boolean))).map(t => [t.id, t.nom]));
    return {
      affectations: lignes.map(l => ({
        id: l.id,
        compte: l.compte_id,
        pseudo: noms[l.compte_id] ?? null,
        role: { id: l.role_id, nom: l.role_nom, couleur: l.role_couleur, cle: l.cle_systeme ?? null },
        portee: l.portee,
        team: l.team_id ? { id: l.team_id, nom: teams.get(l.team_id) ?? null } : null,
        creeLe: l.cree_le,
      })),
    };
  }

  async function affecter(acteur, corps) {
    const ctx = await ctxClub(acteur, { roles: true });
    const compte = corps?.compte;
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) throw echec(400, 'compte', 'Compte inconnu.');
    // Le Fondateur a tout, d'office : on ne lui attribue (ni ne lui retire) aucun rôle.
    if (compte === 'principal') throw echec(403, 'compte-fondateur', 'Le Fondateur a déjà tous les droits.');
    if (!(await base.premier('SELECT id FROM comptes WHERE id = ?', [compte]))) throw echec(400, 'compte', 'Ce compte n’a pas encore de profil Esport.');
    const r = await roleLigne(corps?.roleId);
    const portee = lirePortee(corps?.portee ?? PORTEE_CLUB);
    if (portee !== PORTEE_CLUB) {
      const m = await base.premier("SELECT m.id FROM membres m JOIN teams t ON t.id = m.team_id WHERE m.team_id = ? AND m.compte_id = ? AND m.statut = 'actif' AND t.supprimee_le IS NULL", [portee, compte]);
      if (!m) throw echec(400, 'pas-membre', 'Un correspondant doit être membre actif de la team.');
    }
    antiEscalade(ctx, await permissionsDuRole(r.id));
    const t = maintenant();
    const id = nouvelId();
    const res = await base.lot([
      { sql: 'INSERT INTO cm_affectations (id, compte_id, role_id, portee, team_id, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', params: [id, compte, r.id, portee, teamDePortee(portee), acteur.compte, iso(t)] },
    ]);
    if (res[0].changements === 1) {
      await base.lot([evenement('cm.affectation_ajoutee', { teamId: teamDePortee(portee), acteur: acteur.compte, entiteType: 'cm_affectation', entiteId: id, charge: { compte, role: r.nom, portee }, maintenant: t })]);
    }
    return affectations(acteur);
  }

  async function retirerAffectation(acteur, id) {
    const ctx = await ctxClub(acteur, { roles: true });
    exigerUuid(id, 'affectation');
    const a = await base.premier('SELECT a.*, r.nom AS role_nom FROM cm_affectations a JOIN cm_roles r ON r.id = a.role_id WHERE a.id = ?', [id]);
    if (!a) throw echec(404, 'affectation-introuvable', 'Affectation introuvable.');
    antiEscalade(ctx, await permissionsDuRole(a.role_id));
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_affectations WHERE id = ?', params: [a.id] },
      evenement('cm.affectation_retiree', { teamId: a.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_affectation', entiteId: a.id, charge: { compte: a.compte_id, role: a.role_nom, portee: a.portee }, maintenant: t }),
    ]);
    return affectations(acteur);
  }

  /** `GET /cm/comptes` : comptes Esport (profil), avec leurs teams actives (choix d'une affectation). */
  async function comptes(acteur) {
    await ctxClub(acteur, { roles: true });
    const lignes = await base.tous('SELECT id, pseudo FROM comptes ORDER BY pseudo_cle LIMIT 2000', []);
    const membres = await base.tous("SELECT m.compte_id, t.id, t.nom FROM membres m JOIN teams t ON t.id = m.team_id WHERE m.statut = 'actif' AND t.supprimee_le IS NULL", []);
    const parCompte = new Map();
    for (const m of membres) {
      if (!parCompte.has(m.compte_id)) parCompte.set(m.compte_id, []);
      parCompte.get(m.compte_id).push({ id: m.id, nom: m.nom });
    }
    return { comptes: lignes.map(l => ({ compte: l.id, pseudo: l.pseudo, teams: parCompte.get(l.id) ?? [] })) };
  }

  // ---------------------------------------------------------------- Réglages, moi, journal

  async function reglages(acteur) {
    await ctxClub(acteur);
    return lireReglagesCm(base);
  }

  async function changerReglages(acteur, corps) {
    await ctxClub(acteur);
    const actuels = (await lireReglagesCm(base)).suggestions;
    const s = corps?.suggestions;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw echec(400, 'reglages', 'Réglages illisibles.');
    const types = { ...actuels.types };
    if (s.types !== undefined) {
      if (!s.types || typeof s.types !== 'object') throw echec(400, 'reglages', 'Réglages illisibles.');
      for (const [k, v] of Object.entries(s.types)) if (TYPES_SUGGESTIONS.includes(k)) types[k] = Boolean(v);
    }
    let reseaux = actuels.reseaux;
    if (s.reseaux !== undefined) {
      if (!Array.isArray(s.reseaux) || s.reseaux.some(r => !CLES_RESEAUX.includes(r))) throw echec(400, 'reseaux', 'Réseau inconnu.');
      reseaux = CLES_RESEAUX.filter(r => s.reseaux.includes(r));
    }
    const hashtags = s.hashtags !== undefined ? texteNettoye(s.hashtags, 200) : actuels.hashtags;
    const valeur = { actif: s.actif !== undefined ? Boolean(s.actif) : actuels.actif, types, reseaux, hashtags };
    const t = maintenant();
    await base.lot([
      {
        sql: "INSERT INTO cm_reglages (cle, valeur, maj_par, maj_le) VALUES ('suggestions', ?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le",
        params: [JSON.stringify(valeur), acteur.compte, iso(t)],
      },
      evenement('cm.reglages_modifies', { acteur: acteur.compte, entiteType: 'cm_reglages', entiteId: 'suggestions', charge: { actif: valeur.actif }, maintenant: t }),
    ]);
    return lireReglagesCm(base);
  }

  /**
   * `GET /cm/moi` : ce que l'acteur peut faire dans la section CM (carte « CM du club » de la page Teams, onglet CM
   * des teams), et le nombre de posts à valider (badge).
   */
  async function moi(acteur) {
    const portees = await porteesDe(base, acteur);
    const teams = [...portees.teams].map(([id, s]) => ({ ...portees.noms.get(id), permissions: [...s].sort() }));
    // Sponsors (migration 0024) : la rubrique s'ouvre aussi à qui n'a QUE sponsors.voir (affectation « club »).
    const sponsors = [...(await droitsSponsors(base, acteur))].sort();
    // Drive (migration 0027) : un compte qui n'a QUE le Drive (cm.drive.voir) ouvre aussi l'espace.
    const voitDrive = s => s.has('cm.drive.voir') || s.has('cm.drive.envoyer') || s.has('cm.drive.gerer');
    // Réunions de l'équipe CM (migration 0039) : l'équipe CM (voir), et tout membre du club invité à une réunion à venir.
    const reunions = await droitsReunions(base, acteur);
    const invite = !reunions.voir && acteur.compte
      ? Boolean(await base.premier("SELECT p.reunion_id FROM cm_reunion_participants p JOIN cm_reunions r ON r.id = p.reunion_id WHERE p.compte_id = ? AND r.statut = 'active' AND (r.recurrence IS NOT NULL OR r.fin > ?) LIMIT 1", [acteur.compte, new Date(maintenant()).toISOString()]))
      : false;
    const espace = portees.club.has('cm.voir') || teams.some(t => t.permissions.includes('cm.voir')) || sponsors.includes('sponsors.voir') || voitDrive(portees.club) || [...portees.teams.values()].some(voitDrive) || reunions.voir || invite;
    return {
      espace,
      reunions: { voir: reunions.voir, gerer: reunions.gerer, invite },
      sponsors,
      club: [...portees.club].sort(),
      teams,
      gerer: portees.club.has('cm.gerer'),
    };
  }

  async function journal(acteur, { avant } = {}) {
    await ctxClub(acteur);
    const pagine = typeof avant === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(avant);
    // Tableaux restreints dont l'acteur n'est pas (migration 0046) : ni le tableau ni ses cartes.
    // Ressources restreintes dont il n'est pas (migration 0048) : ni leurs entrées.
    const hors = horsTableauxInterdits(null, await lecteurTableaux(base, acteur).interdits(), await lecteurLiens(base, acteur, await porteesDe(base, acteur)).interdits());
    const conditions = ["action LIKE 'cm.%'", ...(pagine ? ['cree_le < ?'] : []), hors.sql];
    const lignes = await base.tous(`SELECT * FROM journal WHERE ${conditions.join(' AND ')} ORDER BY cree_le DESC, id LIMIT 100`, [...(pagine ? [avant] : []), ...hors.params]);
    const noms = await pseudosDe(base, lignes.flatMap(l => [l.acteur_id, jsonOu(l.meta, {}).compte]).filter(Boolean));
    const teams = new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE id', lignes.map(l => l.team_id).filter(Boolean))).map(t => [t.id, t.nom]));
    return {
      entrees: lignes.map(l => ({ id: l.id, acteur: l.acteur_id ?? null, action: l.action, entite: l.entite_type ?? null, entiteId: l.entite_id ?? null, meta: jsonOu(l.meta, {}), team: l.team_id ? { id: l.team_id, nom: teams.get(l.team_id) ?? null } : null, date: l.cree_le })),
      noms,
    };
  }

  return { roles, creerRole, modifierRole, retablirRole, supprimerRole, affectations, affecter, retirerAffectation, comptes, reglages, changerReglages, moi, journal };
}
