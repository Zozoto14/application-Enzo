/**
 * Section CM : contrôle d'accès et outils communs.
 *
 * Deux portées : « club » (l'espace CM global, au-dessus des teams) et une team (sa partie CM, module `cm`).
 * Les permissions CM d'un compte sur une portée viennent :
 *  - du Fondateur (super admin) : toutes, partout ;
 *  - de ses AFFECTATIONS à un rôle CM (`cm_affectations`) : portée « club » (valables pour le club ET pour
 *    toutes les teams dont le module CM est activé), ou portée d'une team (le correspondant de la team ;
 *    valables seulement tant qu'il est membre actif de cette team) ;
 *  - de son RÔLE dans la team (portée d'une team seulement) : les trois permissions « de team » du
 *    catalogue (cm.voir, cm.deposer, cm.clips.proposer ; le Propriétaire les a). Éditer, valider et gérer
 *    ne viennent jamais d'un rôle de team : ce sont des permissions du club.
 *
 * Ordre des contrôles (portée d'une team) : session → team existante → module `cm` activé (404) →
 * appartenance OU affectation (404 : on ne dit pas que la team existe) → permission (403).
 * Le CM ne lit QUE la section CM et les résumés publiables (competition/resume.mjs) : jamais les strats,
 * le scouting détaillé, les notes du staff ni un résultat réservé au staff.
 */

import { CLE_PROPRIETAIRE } from '../permissions.mjs';
import { echec, iso, nouvelId } from '../outils.mjs';

export const MODULE_CM = 'cm';
/**
 * Drive de la section CM (migration 0027) : voir (parcourir, télécharger), envoyer (déposer, organiser ses
 * fichiers), gérer (tout, dossiers restreints, corbeille, versions). Portées par les rôles CM seulement
 * (affectation « club » ou d'une team), jamais par un rôle de team.
 */
export const PERMISSIONS_DRIVE_CM = Object.freeze(['cm.drive.voir', 'cm.drive.envoyer', 'cm.drive.gerer']);
export const PORTEE_CLUB = 'club';
export const PERMISSIONS_CM = Object.freeze(['cm.voir', 'cm.deposer', 'cm.editer', 'cm.valider', 'cm.gerer', 'cm.clips.proposer', ...PERMISSIONS_DRIVE_CM]);
/** Permissions CM qu'un rôle de TEAM peut porter (catalogue.json, groupe « cm »). */
export const PERMISSIONS_EQUIPE = Object.freeze(['cm.voir', 'cm.deposer', 'cm.clips.proposer']);
export const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
export const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;

/** Couleurs des étiquettes (proposées dans l'app ; celles de Trello s'y ramènent). */
export const COULEURS_ETIQUETTES = Object.freeze({
  vert: '#4bce97',
  jaune: '#e2b203',
  orange: '#faa53d',
  rouge: '#f87462',
  violet: '#9f8fef',
  bleu: '#579dff',
  ciel: '#6cc3e0',
  citron: '#94c748',
  rose: '#e774bb',
  noir: '#8590a2',
});

export const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/** Portée saisie : « club » ou l'identifiant d'une team (sinon 404). */
export function lirePortee(v) {
  if (v === PORTEE_CLUB) return PORTEE_CLUB;
  return exigerUuid(v, 'team');
}

export const teamDePortee = portee => (portee === PORTEE_CLUB ? null : portee);

/** Permissions CM de niveau club d'un compte (ses affectations « club »). */
export async function permissionsClub(base, compte) {
  if (!compte) return new Set();
  const lignes = await base.tous(
    "SELECT DISTINCT rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee = 'club'",
    [compte],
  );
  return new Set(lignes.map(l => l.permission).filter(p => PERMISSIONS_CM.includes(p)));
}

async function moduleActif(base, teamId) {
  const l = await base.premier('SELECT active FROM team_modules WHERE team_id = ? AND module = ?', [teamId, MODULE_CM]);
  return Boolean(l && Number(l.active) === 1);
}

/**
 * Contexte CM d'un acteur sur une portée : `{ acteur, portee, team, membre, permissions }`.
 * Portée d'une team inconnue, supprimée, sans module CM, ou où l'acteur n'a ni appartenance ni
 * affectation ni droit du club : 404.
 */
export async function contexteCm(base, acteur, portee) {
  const p = lirePortee(portee);
  const club = acteur.superAdmin ? new Set(PERMISSIONS_CM) : await permissionsClub(base, acteur.compte);
  if (p === PORTEE_CLUB) return { acteur, portee: p, team: null, membre: null, permissions: club };
  const team = await base.premier('SELECT id, nom, slug, logo_url, fuseau, jeu FROM teams WHERE id = ? AND supprimee_le IS NULL', [p]);
  if (!team) throw echec(404, 'team-introuvable', 'Team introuvable.');
  const membre = await base.premier("SELECT m.id, m.statut, m.role_id, r.cle_systeme FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = ? AND m.compte_id = ?", [p, acteur.compte]);
  const actif = membre && membre.statut === 'actif';
  if (!(await moduleActif(base, p))) {
    if (!actif && club.size === 0) throw echec(404, 'team-introuvable', 'Team introuvable.');
    throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
  }
  const permissions = new Set(club);
  if (actif) {
    if (membre.cle_systeme === CLE_PROPRIETAIRE) for (const x of PERMISSIONS_EQUIPE) permissions.add(x);
    else {
      const rp = await base.tous('SELECT permission FROM role_permissions WHERE role_id = ?', [membre.role_id]);
      for (const { permission } of rp) if (PERMISSIONS_EQUIPE.includes(permission)) permissions.add(permission);
    }
    const aff = await base.tous('SELECT DISTINCT rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee = ?', [acteur.compte, p]);
    for (const { permission } of aff) if (PERMISSIONS_CM.includes(permission)) permissions.add(permission);
  }
  if (!actif && permissions.size === 0) throw echec(404, 'team-introuvable', 'Team introuvable.');
  return { acteur, portee: p, team, membre: actif ? membre : null, permissions };
}

export function exiger(ctx, ...permissions) {
  if (!permissions.some(p => ctx.permissions.has(p))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
}

export const peut = (ctx, p) => ctx.permissions.has(p);

/**
 * Portées où l'acteur a l'une des permissions : `{ club: bool, teams: Map<teamId, Set<permission>> }`.
 * Une seule passe groupée (pas une requête par team). Teams : celles dont le module CM est activé.
 */
export async function porteesDe(base, acteur) {
  const club = acteur.superAdmin ? new Set(PERMISSIONS_CM) : await permissionsClub(base, acteur.compte);
  const teams = await base.tous("SELECT t.id, t.nom, t.slug, t.logo_url FROM teams t JOIN team_modules m ON m.team_id = t.id AND m.module = ? AND m.active = 1 WHERE t.supprimee_le IS NULL ORDER BY t.nom", [MODULE_CM]);
  const parTeam = new Map(teams.map(t => [t.id, new Set(club)]));
  if (acteur.compte) {
    const membres = await base.tous(
      "SELECT m.team_id, r.cle_systeme, rp.permission FROM membres m JOIN roles r ON r.id = m.role_id LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE m.compte_id = ? AND m.statut = 'actif'",
      [acteur.compte],
    );
    const actives = new Set(membres.map(m => m.team_id));
    for (const m of membres) {
      const s = parTeam.get(m.team_id);
      if (!s) continue;
      if (m.cle_systeme === CLE_PROPRIETAIRE) for (const x of PERMISSIONS_EQUIPE) s.add(x);
      else if (m.permission && PERMISSIONS_EQUIPE.includes(m.permission)) s.add(m.permission);
    }
    const aff = await base.tous("SELECT a.portee, rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee <> 'club'", [acteur.compte]);
    for (const a of aff) if (actives.has(a.portee) && PERMISSIONS_CM.includes(a.permission)) parTeam.get(a.portee)?.add(a.permission);
  }
  const noms = new Map(teams.map(t => [t.id, { id: t.id, nom: t.nom, slug: t.slug, logoUrl: t.logo_url ?? null }]));
  for (const [id, s] of [...parTeam]) if (s.size === 0) parTeam.delete(id);
  return { club, teams: parTeam, noms };
}

/** Permissions de l'acteur sur une portée, depuis `porteesDe` (Set vide si aucune). */
export const permissionsSur = (portees, portee) => (portee === PORTEE_CLUB ? portees.club : (portees.teams.get(portee) ?? new Set()));

/** Position entre deux voisins (null : bord de liste). */
export function positionEntre(avant, apres) {
  if (avant === null && apres === null) return 1024;
  if (avant === null) return apres - 1024;
  if (apres === null) return avant + 1024;
  return (avant + apres) / 2;
}

/** Instructions : version du tableau + 1 (rafraîchissement des autres utilisateurs). */
export const versionTableau = (tableauId, t) => ({ sql: 'UPDATE cm_tableaux SET version = version + 1, maj_le = ? WHERE id = ?', params: [iso(t), tableauId] });

/** Instruction : une ligne d'activité de la carte. */
export const activite = (carteId, tableauId, acteur, action, meta, t) => ({
  sql: 'INSERT INTO cm_activite (id, carte_id, tableau_id, acteur_id, action, meta, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)',
  params: [nouvelId(), carteId, tableauId, acteur ?? null, action, JSON.stringify(meta ?? {}), iso(t)],
});

/** Comptes qui ont une permission CM au niveau du club (affectations), et le Fondateur s'il a un profil. */
export async function comptesClubAvec(base, permission, { fondateur = true } = {}) {
  const lignes = await base.tous(
    "SELECT DISTINCT a.compte_id FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.portee = 'club' AND rp.permission = ?",
    [permission],
  );
  const s = new Set(lignes.map(l => l.compte_id));
  if (fondateur && (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", []))) s.add('principal');
  return s;
}

/** Comptes qui ont une permission CM sur une team (club, affectation de la team, rôle de team). */
export async function comptesTeamAvec(base, teamId, permission) {
  const s = await comptesClubAvec(base, permission);
  const aff = await base.tous(
    "SELECT DISTINCT a.compte_id FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id JOIN membres m ON m.team_id = a.portee AND m.compte_id = a.compte_id AND m.statut = 'actif' WHERE a.portee = ? AND rp.permission = ?",
    [teamId, permission],
  );
  for (const l of aff) s.add(l.compte_id);
  if (PERMISSIONS_EQUIPE.includes(permission)) {
    const roles = await base.tous(
      `SELECT DISTINCT m.compte_id FROM membres m JOIN roles r ON r.id = m.role_id LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = ?
        WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
      [permission, teamId],
    );
    for (const l of roles) s.add(l.compte_id);
  }
  return s;
}
