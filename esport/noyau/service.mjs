/**
 * Logique métier de l'Esport (phase 1 : fondations).
 *
 * Indépendante du runtime : elle ne parle qu'à une `base` (interface décrite
 * dans adaptateurs/sqlite.mjs : `tous`, `premier`, `executer`, `lot`) avec du
 * SQL standard (paramètres `?`, UUID texte, dates ISO), compatible SQLite (D1)
 * et Postgres. Toute vérification de droits est faite ICI, côté serveur :
 * l'app n'affiche que ce que le serveur permet, mais ne décide de rien.
 *
 * Ordre des contrôles pour une route de team : authentification (api.mjs) →
 * appartenance à la team → module activé → permission.
 */

import { evenement } from './evenements.mjs';
import {
  CLE_PROPRIETAIRE,
  JEUX,
  MODULES,
  ROLES_SYSTEME,
  TOUTES_PERMISSIONS,
  autorise,
  moduleConnu,
  moduleDePermission,
  modulesDuPreset,
  permissionsEffectives,
  permissionsManquantes,
  permissionsRoleSysteme,
  validerPermissions,
} from './permissions.mjs';
import { aleatoire, echec, iso, jsonOu, nouvelId, sha256Hex, slugDe, texteLong, texteNettoye } from './outils.mjs';

const MOTIF_PSEUDO = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,23}$/u;
const MOTIF_RIOT = /^[^#\s][^#]{2,15}#[\p{L}\p{N}]{3,5}$/u;
const MOTIF_DISCORD = /^[a-z0-9_.]{2,32}$/;
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_CODE = /^esp_[A-Za-z0-9_-]{32}$/;
const STATUTS_MEMBRE = ['actif', 'suspendu'];

/** Anti-force brute des invitations : essais libres, puis attente doublée à chaque échec. */
const ESSAIS_LIBRES = 5;
const ATTENTE_MAX_S = 3600;
const OUBLI_ECHECS_MS = 86_400_000;

export function attenteApres(echecs, libres = ESSAIS_LIBRES, max = ATTENTE_MAX_S, base = 30) {
  if (echecs < libres) return 0;
  return Math.min(max, base * 2 ** (echecs - libres));
}

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/**
 * Services de l'Esport sur une base. `maintenant` est injectable (tests).
 * `creationTeams` : « fondateur » (défaut : seul le super admin crée une
 * team) ou « tous » (tout compte authentifié).
 */
export function servicesEsport({ base, maintenant = () => Date.now(), creationTeams = 'fondateur' }) {
  // -------------------------------------------------------------- Lectures internes

  async function profilDe(compte) {
    return base.premier('SELECT id, pseudo, riot_id, discord, cree_le, maj_le FROM comptes WHERE id = ?', [compte]);
  }

  async function exigerProfil(acteur) {
    const profil = await profilDe(acteur.compte);
    if (!profil) throw echec(428, 'pseudo-requis', 'Choisissez d’abord votre pseudo Esport.');
    return profil;
  }

  async function permissionsDuRole(role) {
    if (!role) return [];
    if (role.cle_systeme === CLE_PROPRIETAIRE) return [...TOUTES_PERMISSIONS];
    const lignes = await base.tous('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission', [role.id]);
    return lignes.map(l => l.permission);
  }

  /**
   * Appartenance : la team existe (non supprimée) et l'acteur en est membre
   * actif, ou super admin. Sinon 404 (on ne dit pas qu'elle existe).
   */
  async function contexteTeam(acteur, teamId) {
    exigerUuid(teamId, 'team');
    const team = await base.premier('SELECT * FROM teams WHERE id = ? AND supprimee_le IS NULL', [teamId]);
    if (!team) throw echec(404, 'team-introuvable', 'Team introuvable.');
    const membre = await base.premier('SELECT * FROM membres WHERE team_id = ? AND compte_id = ?', [teamId, acteur.compte]);
    if (!membre && !acteur.superAdmin) throw echec(404, 'team-introuvable', 'Team introuvable.');
    if (membre && membre.statut !== 'actif' && !acteur.superAdmin) throw echec(403, 'suspendu', 'Votre accès à cette team est suspendu.');
    const role = membre ? await base.premier('SELECT * FROM roles WHERE id = ?', [membre.role_id]) : null;
    const permissionsRole = await permissionsDuRole(role);
    const permissions = permissionsEffectives({ superAdmin: acteur.superAdmin, membre, role, permissionsRole });
    const lignesModules = await base.tous('SELECT module, active FROM team_modules WHERE team_id = ?', [teamId]);
    const modules = new Set(lignesModules.filter(l => Number(l.active) === 1 && moduleConnu(l.module)).map(l => l.module));
    return { acteur, team, membre, role, permissions, modules };
  }

  /** Module activé, puis permission. Module désactivé : 404 ; permission absente : 403. */
  function exiger(ctx, permission) {
    const module = moduleDePermission(permission);
    if (module && !ctx.modules.has(module)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (!autorise(ctx.permissions, ctx.modules, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  /** Anti-escalade : refuse si `demandees` contient une permission que l'acteur n'a pas. */
  function exigerSousEnsemble(ctx, demandees, message) {
    if (ctx.acteur.superAdmin) return;
    const manquantes = permissionsManquantes(ctx.permissions, demandees);
    if (manquantes.length > 0) {
      const e = echec(403, 'escalade', message ?? 'Vous ne pouvez pas accorder une permission que vous n’avez pas.');
      e.details = { manquantes };
      throw e;
    }
  }

  /**
   * Peut-on attribuer ce rôle (invitation, changement de rôle) ou agir sur un membre qui l'a ?
   * Oui si ses permissions sont toutes les nôtres (anti-escalade), ou si c'est un rôle système
   * placé SOUS le nôtre dans la hiérarchie (un Manager invite un Coach ou un Joueur). Jamais le
   * rôle Propriétaire, sauf pour un Propriétaire ou le super admin.
   */
  async function exigerRoleGerable(ctx, role, message) {
    if (ctx.acteur.superAdmin || ctx.role?.cle_systeme === CLE_PROPRIETAIRE) return;
    const perms = await permissionsDuRole(role);
    if (permissionsManquantes(ctx.permissions, perms).length === 0) return;
    if (Number(role.systeme) === 1 && Number(ctx.role?.systeme) === 1 && Number(role.position) > Number(ctx.role.position)) return;
    exigerSousEnsemble(ctx, perms, message);
  }

  async function roleDeTeam(teamId, roleId) {
    exigerUuid(roleId, 'role');
    const role = await base.premier('SELECT * FROM roles WHERE id = ? AND team_id = ?', [roleId, teamId]);
    if (!role) throw echec(404, 'role-introuvable', 'Rôle introuvable.');
    return role;
  }

  async function nombreProprietairesActifs(teamId) {
    const l = await base.premier(
      "SELECT COUNT(*) AS n FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = ? AND m.statut = 'actif' AND r.cle_systeme = ?",
      [teamId, CLE_PROPRIETAIRE],
    );
    return Number(l?.n ?? 0);
  }

  async function estDernierProprietaire(teamId, membre) {
    const role = await base.premier('SELECT cle_systeme FROM roles WHERE id = ?', [membre.role_id]);
    return role?.cle_systeme === CLE_PROPRIETAIRE && membre.statut === 'actif' && (await nombreProprietairesActifs(teamId)) <= 1;
  }

  const rolePublic = async role => ({
    id: role.id,
    nom: role.nom,
    couleur: role.couleur,
    systeme: Number(role.systeme) === 1,
    cle: role.cle_systeme ?? null,
    position: Number(role.position),
    permissions: await permissionsDuRole(role),
  });

  const teamPublique = t => ({
    id: t.id,
    nom: t.nom,
    slug: t.slug,
    jeu: t.jeu,
    description: t.description,
    logoUrl: t.logo_url ?? null,
    fuseau: t.fuseau,
    creeLe: t.cree_le,
    archivee: Boolean(t.archivee_le),
  });

  // -------------------------------------------------------------- Profil

  async function moi(acteur) {
    const profil = await profilDe(acteur.compte);
    return {
      compte: acteur.compte,
      superAdmin: acteur.superAdmin,
      profil: profil ? { pseudo: profil.pseudo, riotId: profil.riot_id ?? null, discord: profil.discord ?? null } : null,
      peutCreerTeam: acteur.superAdmin || creationTeams === 'tous',
    };
  }

  async function majProfil(acteur, corps) {
    const pseudo = texteNettoye(corps?.pseudo, 24);
    if (!MOTIF_PSEUDO.test(pseudo)) throw echec(400, 'pseudo', 'Pseudo : 2 à 24 caractères (lettres, chiffres, espace, _ . -).');
    const riot = corps?.riotId ? texteNettoye(corps.riotId, 22) : '';
    if (riot && !MOTIF_RIOT.test(riot)) throw echec(400, 'riot-id', 'Riot ID : de la forme Pseudo#TAG.');
    const discord = corps?.discord ? texteNettoye(corps.discord, 32).toLowerCase() : '';
    if (discord && !MOTIF_DISCORD.test(discord)) throw echec(400, 'discord', 'Nom Discord : 2 à 32 caractères (a-z, 0-9, _ et .).');
    const cle = pseudo.toLocaleLowerCase('fr');
    const pris = await base.premier('SELECT id FROM comptes WHERE pseudo_cle = ? AND id <> ?', [cle, acteur.compte]);
    if (pris) throw echec(409, 'pseudo-pris', 'Ce pseudo est déjà pris.');
    const date = iso(maintenant());
    await base.executer(
      `INSERT INTO comptes (id, pseudo, pseudo_cle, riot_id, discord, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET pseudo = excluded.pseudo, pseudo_cle = excluded.pseudo_cle, riot_id = excluded.riot_id, discord = excluded.discord, maj_le = excluded.maj_le`,
      [acteur.compte, pseudo, cle, riot || null, discord || null, date, date],
    );
    return moi(acteur);
  }

  // -------------------------------------------------------------- Teams

  async function listeTeams(acteur) {
    const lignes = acteur.superAdmin
      ? await base.tous(
          `SELECT t.*, m.id AS membre_id, m.statut AS membre_statut, r.nom AS role_nom, r.couleur AS role_couleur
             FROM teams t LEFT JOIN membres m ON m.team_id = t.id AND m.compte_id = ? LEFT JOIN roles r ON r.id = m.role_id
            WHERE t.supprimee_le IS NULL ORDER BY t.nom`,
          [acteur.compte],
        )
      : await base.tous(
          `SELECT t.*, m.id AS membre_id, m.statut AS membre_statut, r.nom AS role_nom, r.couleur AS role_couleur
             FROM membres m JOIN teams t ON t.id = m.team_id JOIN roles r ON r.id = m.role_id
            WHERE m.compte_id = ? AND t.supprimee_le IS NULL ORDER BY t.nom`,
          [acteur.compte],
        );
    const teams = [];
    for (const l of lignes) {
      const n = await base.premier("SELECT COUNT(*) AS n FROM membres WHERE team_id = ? AND statut = 'actif'", [l.id]);
      const mods = await base.tous('SELECT module FROM team_modules WHERE team_id = ? AND active = 1', [l.id]);
      teams.push({
        ...teamPublique(l),
        membres: Number(n?.n ?? 0),
        modules: mods.map(m => m.module).filter(moduleConnu),
        role: l.membre_id ? { nom: l.role_nom, couleur: l.role_couleur } : null,
        suspendu: l.membre_statut === 'suspendu',
      });
    }
    return teams;
  }

  async function slugLibre(nom) {
    const base_ = slugDe(nom);
    const pris = new Set((await base.tous('SELECT slug FROM teams WHERE slug = ? OR slug LIKE ?', [base_, `${base_}-%`])).map(l => l.slug));
    if (!pris.has(base_)) return base_;
    for (let i = 2; i < 1000; i++) if (!pris.has(`${base_}-${i}`)) return `${base_}-${i}`;
    return `${base_}-${aleatoire(4).toLowerCase()}`;
  }

  async function creerTeam(acteur, corps) {
    if (!acteur.superAdmin && creationTeams !== 'tous') throw echec(403, 'creation-reservee', 'La création de teams est réservée au Fondateur.');
    await exigerProfil(acteur);
    const nom = texteNettoye(corps?.nom, 60);
    if (nom.length < 2) throw echec(400, 'nom', 'Nom de la team : 2 caractères au moins.');
    const jeu = corps?.jeu ?? 'valorant';
    if (!JEUX.some(j => j.cle === jeu)) throw echec(400, 'jeu', 'Jeu inconnu.');
    const modules = modulesDuPreset(corps?.preset ?? 'valorant_complet', Array.isArray(corps?.modules) ? corps.modules : []);
    if (!modules) throw echec(400, 'preset', 'Preset inconnu.');
    const description = texteLong(corps?.description, 500);
    const t = maintenant();
    const date = iso(t);
    const teamId = nouvelId();
    const slug = await slugLibre(nom);
    const lot = [
      {
        sql: 'INSERT INTO teams (id, nom, slug, jeu, description, fuseau, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [teamId, nom, slug, jeu, description, 'Europe/Paris', acteur.compte, date, date],
      },
    ];
    for (const module of MODULES) {
      lot.push({ sql: 'INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, ?, ?, ?, ?)', params: [teamId, module, modules.includes(module) ? 1 : 0, '{}', date] });
    }
    let roleProprietaire;
    ROLES_SYSTEME.forEach((r, position) => {
      const id = nouvelId();
      if (r.cle === CLE_PROPRIETAIRE) roleProprietaire = id;
      lot.push({
        sql: 'INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        params: [id, teamId, r.cle, r.nom, r.couleur, position, date, date],
      });
      // Le Propriétaire a tout par définition : pas de liste à tenir à jour.
      if (r.cle !== CLE_PROPRIETAIRE) {
        for (const p of permissionsRoleSysteme(r.cle)) lot.push({ sql: 'INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', params: [id, p] });
      }
    });
    const membreId = nouvelId();
    lot.push({
      sql: "INSERT INTO membres (id, team_id, compte_id, role_id, statut, rejoint_le, maj_le) VALUES (?, ?, ?, ?, 'actif', ?, ?)",
      params: [membreId, teamId, acteur.compte, roleProprietaire, date, date],
    });
    lot.push(evenement('team.created', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: { nom, jeu, modules }, maintenant: t }));
    await base.lot(lot);
    return detailTeam(acteur, teamId);
  }

  async function detailTeam(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    const modules = await base.tous('SELECT module, active FROM team_modules WHERE team_id = ?', [teamId]);
    const n = await base.premier("SELECT COUNT(*) AS n FROM membres WHERE team_id = ? AND statut = 'actif'", [teamId]);
    return {
      team: teamPublique(ctx.team),
      modules: MODULES.map(cle => ({ cle, active: modules.some(m => m.module === cle && Number(m.active) === 1) })),
      membres: Number(n?.n ?? 0),
      moi: {
        membreId: ctx.membre?.id ?? null,
        role: ctx.role ? { id: ctx.role.id, nom: ctx.role.nom, couleur: ctx.role.couleur, cle: ctx.role.cle_systeme ?? null } : null,
        // Permissions utilisables : celles du rôle dont le module est activé.
        permissions: [...ctx.permissions].filter(p => autorise(ctx.permissions, ctx.modules, p)).sort(),
        superAdmin: acteur.superAdmin,
      },
    };
  }

  async function modifierTeam(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'team.manage');
    const champs = [];
    const valeurs = [];
    if (corps?.nom !== undefined) {
      const nom = texteNettoye(corps.nom, 60);
      if (nom.length < 2) throw echec(400, 'nom', 'Nom de la team : 2 caractères au moins.');
      champs.push('nom');
      valeurs.push(nom);
    }
    if (corps?.description !== undefined) {
      champs.push('description');
      valeurs.push(texteLong(corps.description, 500));
    }
    if (corps?.jeu !== undefined) {
      if (!JEUX.some(j => j.cle === corps.jeu)) throw echec(400, 'jeu', 'Jeu inconnu.');
      champs.push('jeu');
      valeurs.push(corps.jeu);
    }
    if (corps?.fuseau !== undefined) {
      const fuseau = texteNettoye(corps.fuseau, 60);
      if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(fuseau)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
      champs.push('fuseau');
      valeurs.push(fuseau);
    }
    if (corps?.archivee !== undefined) {
      champs.push('archivee_le');
      valeurs.push(corps.archivee ? iso(maintenant()) : null);
    }
    if (champs.length === 0) return detailTeam(acteur, teamId);
    const t = maintenant();
    await base.lot([
      { sql: `UPDATE teams SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...valeurs, iso(t), teamId] },
      evenement('team.updated', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: { champs }, maintenant: t }),
    ]);
    return detailTeam(acteur, teamId);
  }

  async function supprimerTeam(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'team.delete');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE teams SET supprimee_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), teamId] },
      { sql: 'UPDATE invitations SET revoquee_le = ? WHERE team_id = ? AND revoquee_le IS NULL', params: [iso(t), teamId] },
      evenement('team.deleted', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: { nom: ctx.team.nom }, maintenant: t }),
    ]);
    return { ok: true };
  }

  async function changerModules(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'modules.manage');
    const demandes = corps?.modules;
    if (!demandes || typeof demandes !== 'object' || Array.isArray(demandes)) throw echec(400, 'modules', 'Liste de modules illisible.');
    const actives = [];
    const desactives = [];
    for (const [cle, active] of Object.entries(demandes)) {
      if (!moduleConnu(cle)) throw echec(400, 'module-inconnu', `Module inconnu : ${String(cle).slice(0, 40)}`);
      const deja = ctx.modules.has(cle);
      if (active && !deja) actives.push(cle);
      if (!active && deja) desactives.push(cle);
    }
    if (actives.length + desactives.length === 0) return detailTeam(acteur, teamId);
    const t = maintenant();
    const lot = [];
    // Désactiver ne supprime rien : les données du module restent, cachées, jusqu'à sa réactivation.
    for (const cle of [...actives, ...desactives]) {
      lot.push({
        sql: `INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, ?, ?, '{}', ?)
              ON CONFLICT (team_id, module) DO UPDATE SET active = excluded.active, maj_le = excluded.maj_le`,
        params: [teamId, cle, actives.includes(cle) ? 1 : 0, iso(t)],
      });
    }
    lot.push(evenement('modules.changed', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: { actives, desactives }, maintenant: t }));
    await base.lot(lot);
    return detailTeam(acteur, teamId);
  }

  // -------------------------------------------------------------- Rôles

  async function listeRoles(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    if (!ctx.permissions.has('members.view') && !ctx.permissions.has('roles.manage')) exiger(ctx, 'members.view');
    const roles = await base.tous('SELECT * FROM roles WHERE team_id = ? ORDER BY position, nom', [teamId]);
    const comptes = await base.tous('SELECT role_id, COUNT(*) AS n FROM membres WHERE team_id = ? GROUP BY role_id', [teamId]);
    const liste = [];
    for (const r of roles) liste.push({ ...(await rolePublic(r)), membres: Number(comptes.find(c => c.role_id === r.id)?.n ?? 0) });
    return liste;
  }

  function lireRoleSaisi(corps, partiel = false) {
    const sortie = {};
    if (!partiel || corps?.nom !== undefined) {
      const nom = texteNettoye(corps?.nom, 40);
      if (nom.length < 2) throw echec(400, 'nom', 'Nom du rôle : 2 caractères au moins.');
      sortie.nom = nom;
    }
    if (!partiel || corps?.couleur !== undefined) {
      const couleur = corps?.couleur ?? '#8b8b9a';
      if (!MOTIF_COULEUR.test(couleur)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
      sortie.couleur = couleur.toLowerCase();
    }
    if (!partiel || corps?.permissions !== undefined) {
      try {
        sortie.permissions = validerPermissions(corps?.permissions ?? []);
      } catch {
        throw echec(400, 'permissions', 'Permissions inconnues ou illisibles.');
      }
    }
    return sortie;
  }

  async function nomDeRoleLibre(teamId, nom, sauf) {
    const meme = await base.tous('SELECT id, nom FROM roles WHERE team_id = ?', [teamId]);
    if (meme.some(r => r.id !== sauf && r.nom.toLocaleLowerCase('fr') === nom.toLocaleLowerCase('fr'))) {
      throw echec(409, 'nom-pris', 'Un rôle porte déjà ce nom dans la team.');
    }
  }

  async function creerRole(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'roles.manage');
    const saisi = lireRoleSaisi(corps);
    exigerSousEnsemble(ctx, saisi.permissions);
    await nomDeRoleLibre(teamId, saisi.nom);
    const pos = await base.premier('SELECT MAX(position) AS p FROM roles WHERE team_id = ?', [teamId]);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      {
        sql: 'INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, NULL, ?, ?, 0, ?, ?, ?)',
        params: [id, teamId, saisi.nom, saisi.couleur, Number(pos?.p ?? 0) + 1, iso(t), iso(t)],
      },
      ...saisi.permissions.map(p => ({ sql: 'INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', params: [id, p] })),
      evenement('role.created', { teamId, acteur: acteur.compte, entiteType: 'role', entiteId: id, charge: { nom: saisi.nom, permissions: saisi.permissions }, maintenant: t }),
    ]);
    return rolePublic(await roleDeTeam(teamId, id));
  }

  async function modifierRole(acteur, teamId, roleId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'roles.manage');
    const role = await roleDeTeam(teamId, roleId);
    if (Number(role.systeme) === 1) throw echec(403, 'role-systeme', 'Un rôle système ne se modifie pas : dupliquez-le en rôle personnalisé.');
    const actuelles = await permissionsDuRole(role);
    exigerSousEnsemble(ctx, actuelles, 'Ce rôle a des permissions que vous n’avez pas : vous ne pouvez pas le modifier.');
    const saisi = lireRoleSaisi(corps, true);
    if (saisi.permissions) exigerSousEnsemble(ctx, saisi.permissions);
    if (saisi.nom) await nomDeRoleLibre(teamId, saisi.nom, roleId);
    const t = maintenant();
    const lot = [
      {
        sql: 'UPDATE roles SET nom = ?, couleur = ?, maj_le = ? WHERE id = ?',
        params: [saisi.nom ?? role.nom, saisi.couleur ?? role.couleur, iso(t), roleId],
      },
    ];
    let ajoutees = [];
    let retirees = [];
    if (saisi.permissions) {
      ajoutees = saisi.permissions.filter(p => !actuelles.includes(p));
      retirees = actuelles.filter(p => !saisi.permissions.includes(p));
      lot.push({ sql: 'DELETE FROM role_permissions WHERE role_id = ?', params: [roleId] });
      for (const p of saisi.permissions) lot.push({ sql: 'INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', params: [roleId, p] });
    }
    lot.push(evenement('role.updated', { teamId, acteur: acteur.compte, entiteType: 'role', entiteId: roleId, charge: { nom: saisi.nom ?? role.nom, ajoutees, retirees }, maintenant: t }));
    await base.lot(lot);
    return rolePublic(await roleDeTeam(teamId, roleId));
  }

  async function supprimerRole(acteur, teamId, roleId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'roles.manage');
    const role = await roleDeTeam(teamId, roleId);
    if (Number(role.systeme) === 1) throw echec(403, 'role-systeme', 'Un rôle système ne se supprime pas.');
    exigerSousEnsemble(ctx, await permissionsDuRole(role), 'Ce rôle a des permissions que vous n’avez pas : vous ne pouvez pas le supprimer.');
    const n = await base.premier('SELECT COUNT(*) AS n FROM membres WHERE role_id = ?', [roleId]);
    if (Number(n?.n ?? 0) > 0) {
      const e = echec(409, 'role-assigne', `Ce rôle est encore attribué à ${n.n} membre${Number(n.n) > 1 ? 's' : ''} : changez d’abord leur rôle.`);
      e.details = { membres: Number(n.n) };
      throw e;
    }
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM invitations WHERE role_id = ?', params: [roleId] },
      { sql: 'DELETE FROM role_permissions WHERE role_id = ?', params: [roleId] },
      { sql: 'DELETE FROM roles WHERE id = ?', params: [roleId] },
      evenement('role.deleted', { teamId, acteur: acteur.compte, entiteType: 'role', entiteId: roleId, charge: { nom: role.nom }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Membres

  async function listeMembres(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'members.view');
    const lignes = await base.tous(
      `SELECT m.id, m.compte_id, m.role_id, m.poste_jeu, m.statut, m.rejoint_le, c.pseudo, c.riot_id, c.discord, r.nom AS role_nom, r.couleur AS role_couleur, r.cle_systeme
         FROM membres m JOIN comptes c ON c.id = m.compte_id JOIN roles r ON r.id = m.role_id
        WHERE m.team_id = ? ORDER BY r.position, c.pseudo_cle`,
      [teamId],
    );
    return lignes.map(l => ({
      id: l.id,
      compte: l.compte_id,
      pseudo: l.pseudo,
      riotId: l.riot_id ?? null,
      discord: l.discord ?? null,
      posteJeu: l.poste_jeu ?? null,
      statut: l.statut,
      rejointLe: l.rejoint_le,
      role: { id: l.role_id, nom: l.role_nom, couleur: l.role_couleur, cle: l.cle_systeme ?? null },
      moi: l.compte_id === acteur.compte,
    }));
  }

  async function membreDeTeam(teamId, membreId) {
    exigerUuid(membreId, 'membre');
    const m = await base.premier('SELECT * FROM membres WHERE id = ? AND team_id = ?', [membreId, teamId]);
    if (!m) throw echec(404, 'membre-introuvable', 'Membre introuvable.');
    return m;
  }

  async function modifierMembre(acteur, teamId, membreId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    const cible = await membreDeTeam(teamId, membreId);
    const soiMeme = cible.compte_id === acteur.compte;
    const roleActuel = await base.premier('SELECT * FROM roles WHERE id = ?', [cible.role_id]);
    const t = maintenant();
    const lot = [];
    const champs = [];
    const valeurs = [];

    if (corps?.roleId !== undefined && corps.roleId !== cible.role_id) {
      exiger(ctx, 'members.assign_role');
      const nouveau = await roleDeTeam(teamId, corps.roleId);
      await exigerRoleGerable(ctx, nouveau, 'Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre.');
      await exigerRoleGerable(ctx, roleActuel, 'Ce membre a un rôle plus élevé que le vôtre.');
      if (nouveau.cle_systeme !== CLE_PROPRIETAIRE && (await estDernierProprietaire(teamId, cible))) {
        throw echec(409, 'dernier-proprietaire', 'Le dernier Propriétaire de la team ne peut pas changer de rôle : nommez d’abord un autre Propriétaire.');
      }
      champs.push('role_id');
      valeurs.push(nouveau.id);
      lot.push(
        evenement('member.role_changed', {
          teamId,
          acteur: acteur.compte,
          entiteType: 'membre',
          entiteId: membreId,
          charge: { compte: cible.compte_id, de: roleActuel?.nom ?? null, vers: nouveau.nom },
          maintenant: t,
        }),
      );
    }
    if (corps?.posteJeu !== undefined) {
      if (!soiMeme) exiger(ctx, 'members.assign_role');
      const poste = corps.posteJeu ? texteNettoye(corps.posteJeu, 30) : null;
      champs.push('poste_jeu');
      valeurs.push(poste || null);
    }
    if (corps?.statut !== undefined && corps.statut !== cible.statut) {
      if (!STATUTS_MEMBRE.includes(corps.statut)) throw echec(400, 'statut', 'Statut inconnu.');
      if (soiMeme) throw echec(403, 'soi-meme', 'Vous ne pouvez pas vous suspendre vous-même.');
      exiger(ctx, 'members.remove');
      await exigerRoleGerable(ctx, roleActuel, 'Ce membre a un rôle plus élevé que le vôtre.');
      if (corps.statut === 'suspendu' && (await estDernierProprietaire(teamId, cible))) {
        throw echec(409, 'dernier-proprietaire', 'Le dernier Propriétaire de la team ne peut pas être suspendu.');
      }
      champs.push('statut');
      valeurs.push(corps.statut);
      lot.push(
        evenement('member.status_changed', { teamId, acteur: acteur.compte, entiteType: 'membre', entiteId: membreId, charge: { compte: cible.compte_id, statut: corps.statut }, maintenant: t }),
      );
    }
    if (champs.length > 0) {
      lot.unshift({ sql: `UPDATE membres SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...valeurs, iso(t), membreId] });
      await base.lot(lot);
    }
    return (await listeMembresBrut(teamId)).find(m => m.id === membreId);
  }

  async function listeMembresBrut(teamId) {
    return listeMembres({ compte: '', superAdmin: true }, teamId);
  }

  async function retirerMembre(acteur, teamId, membreId) {
    const ctx = await contexteTeam(acteur, teamId);
    const cible = await membreDeTeam(teamId, membreId);
    const soiMeme = cible.compte_id === acteur.compte;
    if (!soiMeme) {
      exiger(ctx, 'members.remove');
      const role = await base.premier('SELECT * FROM roles WHERE id = ?', [cible.role_id]);
      await exigerRoleGerable(ctx, role, 'Ce membre a un rôle plus élevé que le vôtre.');
    }
    if (await estDernierProprietaire(teamId, cible)) {
      throw echec(409, 'dernier-proprietaire', 'Le dernier Propriétaire de la team ne peut pas être retiré : nommez d’abord un autre Propriétaire.');
    }
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM membres WHERE id = ?', params: [membreId] },
      evenement(soiMeme ? 'member.left' : 'member.removed', { teamId, acteur: acteur.compte, entiteType: 'membre', entiteId: membreId, charge: { compte: cible.compte_id }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Invitations

  const invitationPublique = (i, maintenantMs) => ({
    id: i.id,
    libelle: i.libelle,
    role: { id: i.role_id, nom: i.role_nom ?? null },
    expireLe: i.expire_le,
    utilisationsMax: Number(i.utilisations_max),
    utilisations: Number(i.utilisations),
    creeLe: i.cree_le,
    etat: i.revoquee_le ? 'revoquee' : Date.parse(i.expire_le) <= maintenantMs ? 'expiree' : Number(i.utilisations) >= Number(i.utilisations_max) ? 'epuisee' : 'active',
  });

  async function listeInvitations(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'members.invite');
    const lignes = await base.tous(
      'SELECT i.*, r.nom AS role_nom FROM invitations i JOIN roles r ON r.id = i.role_id WHERE i.team_id = ? ORDER BY i.cree_le DESC LIMIT 100',
      [teamId],
    );
    const t = maintenant();
    return lignes.map(i => invitationPublique(i, t));
  }

  async function creerInvitation(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'members.invite');
    const role = await roleDeTeam(teamId, corps?.roleId);
    await exigerRoleGerable(ctx, role, 'Vous ne pouvez pas inviter avec un rôle plus élevé que le vôtre.');
    const jours = Number(corps?.joursValidite ?? 7);
    if (!Number.isInteger(jours) || jours < 1 || jours > 30) throw echec(400, 'validite', 'Validité : 1 à 30 jours.');
    const max = Number(corps?.utilisationsMax ?? 1);
    if (!Number.isInteger(max) || max < 1 || max > 50) throw echec(400, 'utilisations', 'Utilisations : 1 à 50.');
    const libelle = texteNettoye(corps?.libelle, 60);
    // Le code n'est montré qu'une fois ; seule son empreinte est gardée.
    const code = `esp_${aleatoire(24)}`;
    const t = maintenant();
    const id = nouvelId();
    const expire = iso(t + jours * 86_400_000);
    await base.lot([
      {
        sql: 'INSERT INTO invitations (id, team_id, role_id, jeton_hash, libelle, expire_le, utilisations_max, utilisations, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        params: [id, teamId, role.id, await sha256Hex(code), libelle, expire, max, acteur.compte, iso(t)],
      },
      evenement('invitation.created', { teamId, acteur: acteur.compte, entiteType: 'invitation', entiteId: id, charge: { role: role.nom, expireLe: expire, utilisationsMax: max }, maintenant: t }),
    ]);
    return { code, invitation: invitationPublique({ id, libelle, role_id: role.id, role_nom: role.nom, expire_le: expire, utilisations_max: max, utilisations: 0, cree_le: iso(t) }, t) };
  }

  async function revoquerInvitation(acteur, teamId, invitationId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'members.invite');
    exigerUuid(invitationId, 'invitation');
    const inv = await base.premier('SELECT * FROM invitations WHERE id = ? AND team_id = ?', [invitationId, teamId]);
    if (!inv) throw echec(404, 'invitation-introuvable', 'Invitation introuvable.');
    if (inv.revoquee_le) return { ok: true };
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE invitations SET revoquee_le = ? WHERE id = ?', params: [iso(t), invitationId] },
      evenement('invitation.revoked', { teamId, acteur: acteur.compte, entiteType: 'invitation', entiteId: invitationId, charge: {}, maintenant: t }),
    ]);
    return { ok: true };
  }

  async function verifierTentatives(cles) {
    const t = maintenant();
    for (const cle of cles) {
      const l = await base.premier('SELECT bloque_jusqua FROM tentatives WHERE cle = ?', [cle]);
      if (l?.bloque_jusqua && Date.parse(l.bloque_jusqua) > t) {
        const e = echec(429, 'trop-de-tentatives', 'Trop de codes invalides : réessayez plus tard.');
        e.attente = Math.ceil((Date.parse(l.bloque_jusqua) - t) / 1000);
        throw e;
      }
    }
  }

  async function noterEchec(cles) {
    const t = maintenant();
    for (const cle of cles) {
      const l = await base.premier('SELECT echecs, maj_le FROM tentatives WHERE cle = ?', [cle]);
      const echecs = (l && t - Date.parse(l.maj_le) < OUBLI_ECHECS_MS ? Number(l.echecs) : 0) + 1;
      const attente = attenteApres(echecs);
      await base.executer(
        `INSERT INTO tentatives (cle, echecs, bloque_jusqua, maj_le) VALUES (?, ?, ?, ?)
         ON CONFLICT (cle) DO UPDATE SET echecs = excluded.echecs, bloque_jusqua = excluded.bloque_jusqua, maj_le = excluded.maj_le`,
        [cle, echecs, attente > 0 ? iso(t + attente * 1000) : null, iso(t)],
      );
    }
  }

  async function accepterInvitation(acteur, corps, ip) {
    const cles = [`invitation:compte:${acteur.compte}`, ...(ip ? [`invitation:ip:${ip}`] : [])];
    await verifierTentatives(cles);
    await exigerProfil(acteur);
    const code = String(corps?.code ?? '').trim();
    const refuser = async (statut, codeErreur, message) => {
      await noterEchec(cles);
      throw echec(statut, codeErreur, message);
    };
    if (!MOTIF_CODE.test(code)) return refuser(404, 'invitation-inconnue', 'Code d’invitation inconnu.');
    const inv = await base.premier('SELECT * FROM invitations WHERE jeton_hash = ?', [await sha256Hex(code)]);
    if (!inv) return refuser(404, 'invitation-inconnue', 'Code d’invitation inconnu.');
    const t = maintenant();
    const team = await base.premier('SELECT * FROM teams WHERE id = ? AND supprimee_le IS NULL', [inv.team_id]);
    if (!team || inv.revoquee_le) return refuser(410, 'invitation-revoquee', 'Cette invitation a été annulée.');
    if (Date.parse(inv.expire_le) <= t) return refuser(410, 'invitation-expiree', 'Cette invitation a expiré : demandez-en une nouvelle.');
    if (Number(inv.utilisations) >= Number(inv.utilisations_max)) return refuser(410, 'invitation-epuisee', 'Cette invitation a déjà servi.');
    const deja = await base.premier('SELECT id FROM membres WHERE team_id = ? AND compte_id = ?', [inv.team_id, acteur.compte]);
    if (deja) throw echec(409, 'deja-membre', 'Vous êtes déjà membre de cette team.');
    const role = await base.premier('SELECT * FROM roles WHERE id = ?', [inv.role_id]);
    const membreId = nouvelId();
    const ev = evenement('member.joined', {
      teamId: inv.team_id,
      acteur: acteur.compte,
      entiteType: 'membre',
      entiteId: membreId,
      charge: { role: role?.nom ?? null, invitation: inv.id },
      maintenant: t,
    });
    // Un seul lot atomique, conditionné : deux acceptations simultanées ne dépassent jamais `utilisations_max`.
    const condition = 'EXISTS (SELECT 1 FROM invitations WHERE id = ? AND revoquee_le IS NULL AND utilisations < utilisations_max)';
    const resultats = await base.lot([
      {
        sql: `INSERT INTO membres (id, team_id, compte_id, role_id, statut, rejoint_le, maj_le) SELECT ?, ?, ?, ?, 'actif', ?, ? WHERE ${condition}`,
        params: [membreId, inv.team_id, acteur.compte, inv.role_id, iso(t), iso(t), inv.id],
      },
      {
        sql: `INSERT INTO evenements (id, type, team_id, acteur_id, entite_type, entite_id, charge, cree_le, essais) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM membres WHERE id = ?) AND ${condition}`,
        params: [...ev.params, membreId, inv.id],
      },
      { sql: 'UPDATE invitations SET utilisations = utilisations + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM membres WHERE id = ?) AND utilisations < utilisations_max', params: [inv.id, membreId] },
    ]);
    if (!resultats?.[0] || resultats[0].changements === 0) return refuser(410, 'invitation-epuisee', 'Cette invitation a déjà servi.');
    await base.executer('DELETE FROM tentatives WHERE cle = ?', [cles[0]]);
    return { team: teamPublique(team), role: role ? { id: role.id, nom: role.nom, couleur: role.couleur } : null };
  }

  // -------------------------------------------------------------- Journal

  async function journal(acteur, teamId, filtres = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'activity_log.view');
    const limite = Math.min(100, Math.max(1, Number(filtres.limite) || 50));
    const conditions = ['team_id = ?'];
    const params = [teamId];
    if (filtres.avant && !Number.isNaN(Date.parse(filtres.avant))) {
      conditions.push('cree_le < ?');
      params.push(new Date(Date.parse(filtres.avant)).toISOString());
    }
    if (filtres.action && /^[a-z_]+(\.[a-z_]+)?$/.test(filtres.action)) {
      conditions.push(filtres.action.includes('.') ? 'action = ?' : 'action LIKE ?');
      params.push(filtres.action.includes('.') ? filtres.action : `${filtres.action}.%`);
    }
    if (filtres.acteur && /^(principal|[a-z0-9]{6,16})$/.test(filtres.acteur)) {
      conditions.push('acteur_id = ?');
      params.push(filtres.acteur);
    }
    const lignes = await base.tous(`SELECT * FROM journal WHERE ${conditions.join(' AND ')} ORDER BY cree_le DESC, id DESC LIMIT ?`, [...params, limite + 1]);
    const entrees = lignes.slice(0, limite).map(l => ({
      id: l.id,
      action: l.action,
      acteur: l.acteur_id,
      entiteType: l.entite_type,
      entiteId: l.entite_id,
      meta: jsonOu(l.meta, {}),
      date: l.cree_le,
    }));
    const ids = new Set();
    for (const e of entrees) {
      if (e.acteur) ids.add(e.acteur);
      // Comptes cités dans les métadonnées (membre visé, assigné d'une tâche, déposant d'une réunion).
      for (const cle of ['compte', 'assigne', 'deposePar']) if (typeof e.meta[cle] === 'string') ids.add(e.meta[cle]);
    }
    const noms = {};
    for (const id of ids) {
      const c = await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [id]);
      noms[id] = c?.pseudo ?? null;
    }
    return { entrees, noms, suite: lignes.length > limite ? entrees[entrees.length - 1].date : null };
  }

  // -------------------------------------------------------------- Notifications

  async function notifications(acteur) {
    const lignes = await base.tous(
      'SELECT n.*, t.nom AS team_nom FROM notifications n LEFT JOIN teams t ON t.id = n.team_id WHERE n.compte_id = ? ORDER BY n.cree_le DESC LIMIT 50',
      [acteur.compte],
    );
    const nonLues = await base.premier('SELECT COUNT(*) AS n FROM notifications WHERE compte_id = ? AND lue_le IS NULL', [acteur.compte]);
    const ids = new Set();
    for (const l of lignes) {
      const c = jsonOu(l.charge, {});
      if (typeof c.membre === 'string') ids.add(c.membre);
    }
    const noms = {};
    for (const id of ids) noms[id] = (await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [id]))?.pseudo ?? null;
    return {
      nonLues: Number(nonLues?.n ?? 0),
      noms,
      liste: lignes.map(l => ({ id: l.id, type: l.type, team: l.team_id ? { id: l.team_id, nom: l.team_nom ?? null } : null, charge: jsonOu(l.charge, {}), lue: Boolean(l.lue_le), date: l.cree_le })),
    };
  }

  async function marquerLues(acteur, corps) {
    const date = iso(maintenant());
    if (corps?.tout) {
      await base.executer('UPDATE notifications SET lue_le = ? WHERE compte_id = ? AND lue_le IS NULL', [date, acteur.compte]);
    } else if (Array.isArray(corps?.ids)) {
      for (const id of corps.ids.slice(0, 100)) {
        if (typeof id === 'string' && id.length < 200) await base.executer('UPDATE notifications SET lue_le = ? WHERE id = ? AND compte_id = ? AND lue_le IS NULL', [date, id, acteur.compte]);
      }
    }
    return notifications(acteur);
  }

  // -------------------------------------------------------------- RGPD

  async function exporterMesDonnees(acteur) {
    const profil = await profilDe(acteur.compte);
    const appartenances = await base.tous(
      'SELECT t.nom AS team, r.nom AS role, m.poste_jeu, m.statut, m.rejoint_le FROM membres m JOIN teams t ON t.id = m.team_id JOIN roles r ON r.id = m.role_id WHERE m.compte_id = ?',
      [acteur.compte],
    );
    const notifs = await base.tous('SELECT type, charge, lue_le, cree_le FROM notifications WHERE compte_id = ? ORDER BY cree_le', [acteur.compte]);
    const actions = await base.tous('SELECT action, entite_type, meta, cree_le FROM journal WHERE acteur_id = ? ORDER BY cree_le LIMIT 5000', [acteur.compte]);
    const dispos = await base.tous('SELECT team_id, jour, debut, fin, type, fuseau FROM dispo_regles WHERE compte_id = ? ORDER BY team_id, jour, debut', [acteur.compte]);
    const exceptionsDispo = await base.tous('SELECT team_id, debut, fin, type, note FROM dispo_exceptions WHERE compte_id = ? ORDER BY debut', [acteur.compte]);
    const presences = await base.tous('SELECT team_id, evenement_id, occurrence, rsvp, reel, note FROM presences WHERE compte_id = ? ORDER BY occurrence LIMIT 5000', [acteur.compte]);
    const t = maintenant();
    await base.lot([evenement('account.exported', { acteur: acteur.compte, entiteType: 'compte', entiteId: acteur.compte, charge: {}, maintenant: t })]);
    return {
      format: 'applibourse-esport-mes-donnees',
      exporteLe: iso(t),
      compte: acteur.compte,
      profil: profil ? { pseudo: profil.pseudo, riotId: profil.riot_id ?? null, discord: profil.discord ?? null, creeLe: profil.cree_le } : null,
      teams: appartenances.map(a => ({ team: a.team, role: a.role, posteJeu: a.poste_jeu ?? null, statut: a.statut, rejointLe: a.rejoint_le })),
      notifications: notifs.map(n => ({ type: n.type, charge: jsonOu(n.charge, {}), lue: Boolean(n.lue_le), date: n.cree_le })),
      journal: actions.map(a => ({ action: a.action, entite: a.entite_type, meta: jsonOu(a.meta, {}), date: a.cree_le })),
      disponibilites: { regles: dispos, exceptions: exceptionsDispo },
      presences,
    };
  }

  async function supprimerMesDonnees(acteur) {
    const membres = await base.tous('SELECT m.*, t.nom AS team_nom FROM membres m JOIN teams t ON t.id = m.team_id WHERE m.compte_id = ? AND t.supprimee_le IS NULL', [acteur.compte]);
    const bloquantes = [];
    for (const m of membres) if (await estDernierProprietaire(m.team_id, m)) bloquantes.push(m.team_nom);
    if (bloquantes.length > 0) {
      const e = echec(409, 'dernier-proprietaire', `Vous êtes le dernier Propriétaire de : ${bloquantes.join(', ')}. Nommez un autre Propriétaire (ou supprimez la team) d’abord.`);
      e.details = { teams: bloquantes };
      throw e;
    }
    const t = maintenant();
    const lot = [];
    for (const m of membres) {
      lot.push(evenement('member.left', { teamId: m.team_id, acteur: acteur.compte, entiteType: 'membre', entiteId: m.id, charge: { compte: acteur.compte, suppression: true }, maintenant: t }));
    }
    lot.push(
      { sql: 'DELETE FROM membres WHERE compte_id = ?', params: [acteur.compte] },
      { sql: 'DELETE FROM notifications WHERE compte_id = ?', params: [acteur.compte] },
      { sql: 'DELETE FROM dispo_regles WHERE compte_id = ?', params: [acteur.compte] },
      { sql: 'DELETE FROM dispo_exceptions WHERE compte_id = ?', params: [acteur.compte] },
      { sql: 'DELETE FROM presences WHERE compte_id = ?', params: [acteur.compte] },
      { sql: 'UPDATE ical_jetons SET revoque_le = ? WHERE compte_id = ? AND revoque_le IS NULL', params: [iso(t), acteur.compte] },
      { sql: 'DELETE FROM tentatives WHERE cle = ?', params: [`invitation:compte:${acteur.compte}`] },
      { sql: 'DELETE FROM comptes WHERE id = ?', params: [acteur.compte] },
      evenement('account.deleted', { acteur: acteur.compte, entiteType: 'compte', entiteId: acteur.compte, charge: { teams: membres.length }, maintenant: t }),
    );
    await base.lot(lot);
    return { ok: true };
  }

  // -------------------------------------------------------------- Modules futurs

  /** Route d'un module des phases suivantes : 404 s'il est désactivé, 501 « bientôt » sinon. */
  async function moduleFutur(acteur, teamId, module) {
    const ctx = await contexteTeam(acteur, teamId);
    if (!moduleConnu(module) || !ctx.modules.has(module)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    throw echec(501, 'bientot', 'Ce module arrive bientôt.');
  }

  return {
    contexteTeam,
    exiger,
    moi,
    majProfil,
    listeTeams,
    creerTeam,
    detailTeam,
    modifierTeam,
    supprimerTeam,
    changerModules,
    listeRoles,
    creerRole,
    modifierRole,
    supprimerRole,
    listeMembres,
    modifierMembre,
    retirerMembre,
    listeInvitations,
    creerInvitation,
    revoquerInvitation,
    accepterInvitation,
    journal,
    notifications,
    marquerLues,
    exporterMesDonnees,
    supprimerMesDonnees,
    moduleFutur,
  };
}
