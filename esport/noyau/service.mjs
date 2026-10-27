/**
 * Logique métier de l'Esport (phase 1 : fondations).
 *
 * Indépendante du runtime : elle ne parle qu'à une `base` (interface décrite
 * dans adaptateurs/sqlite.mjs : `tous`, `premier`, `executer`, `lot`) avec du
 * SQL standard (paramètres `?`, UUID texte, dates ISO), compatible SQLite
 * et Postgres. Toute vérification de droits est faite ICI, côté serveur :
 * l'app n'affiche que ce que le serveur permet, mais ne décide de rien.
 *
 * Ordre des contrôles pour une route de team : authentification (api.mjs) →
 * appartenance à la team → module activé → permission.
 */

import { evenement } from './evenements.mjs';
import {
  CLE_PROPRIETAIRE,
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
import { aleatoire, echec, iso, jsonOu, nouvelId, slugDe, texteLong, texteNettoye } from './outils.mjs';
import { lireLangue } from './langues.mjs';
import { lignesParIds, pseudosDe } from './requetes.mjs';
import { lireDessin } from './review/dessin.mjs';
import { effacementUsage } from './usage/collecte.mjs';
import { aPermissionJeux, jeuValidePourTeam, nomsDesJeux } from './jeux/service.mjs';
import { effacementCompetition } from './competition/rgpd.mjs';
import { effacementCm, exportCm } from './cm/rgpd.mjs';
import { effacementSponsors, exportSponsors } from './sponsors/rgpd.mjs';

const MOTIF_PSEUDO = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,23}$/u;
const MOTIF_RIOT = /^[^#\s][^#]{2,15}#[\p{L}\p{N}]{3,5}$/u;
const MOTIF_DISCORD = /^[a-z0-9_.]{2,32}$/;
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUTS_MEMBRE = ['actif', 'suspendu'];

/** Pseudo saisi (nettoyé) ou erreur 400. */
export function lirePseudo(saisie) {
  const pseudo = texteNettoye(saisie, 24);
  if (!MOTIF_PSEUDO.test(pseudo)) throw echec(400, 'pseudo', 'Pseudo : 2 à 24 caractères (lettres, chiffres, espace, _ . -).');
  return pseudo;
}

/**
 * Codes d'invitation `esp_…` : retirés (invitation directe depuis l'Esport,
 * voir comptes.mjs et docs/esport/invitations.md). Les routes répondent 410.
 */
export const CODES_RETIRES = 'Les codes d’invitation esp_ sont retirés : le Fondateur crée le compte depuis l’Esport (page Membres) et le joueur voit directement ses teams.';

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
    return base.premier('SELECT id, pseudo, riot_id, discord, discord_id, langue, langue_defaut, cree_le, maj_le FROM comptes WHERE id = ?', [compte]);
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

  const rolePublic = async role => {
    const permissions = await permissionsDuRole(role);
    return {
      id: role.id,
      nom: role.nom,
      couleur: role.couleur,
      systeme: Number(role.systeme) === 1,
      cle: role.cle_systeme ?? null,
      position: Number(role.position),
      permissions,
      ...rolesParDefaut(role, permissions),
    };
  };

  /** Rôle système (hors Propriétaire) : ses permissions par défaut et s'il a été modifié dans cette team. */
  function rolesParDefaut(role, permissions) {
    if (Number(role.systeme) !== 1 || !role.cle_systeme) return {};
    if (role.cle_systeme === CLE_PROPRIETAIRE) return { verrouille: true, modifie: false };
    const defaut = [...new Set(permissionsRoleSysteme(role.cle_systeme))].sort();
    const actuelles = [...permissions].sort();
    return { permissionsParDefaut: defaut, modifie: defaut.length !== actuelles.length || defaut.some((p, i) => p !== actuelles[i]) };
  }

  /** Team telle que l'app la voit ; `jeux` (facultatif) : noms des profils de jeu (`jeuNom`, `jeuCouleur`). */
  const teamPublique = (t, jeux) => ({
    id: t.id,
    nom: t.nom,
    slug: t.slug,
    jeu: t.jeu,
    ...(jeux ? { jeuNom: jeux.get(t.jeu)?.nom ?? t.jeu, jeuCouleur: jeux.get(t.jeu)?.couleur ?? null } : {}),
    description: t.description,
    logoUrl: t.logo_url ?? null,
    fuseau: t.fuseau,
    creeLe: t.cree_le,
    archivee: Boolean(t.archivee_le),
  });

  // -------------------------------------------------------------- Profil

  /** Langue par défaut réglée par le Fondateur avant la création de la fiche Esport du compte (migration 0019). */
  async function langueEnAttente(compte) {
    return lireLangue((await base.premier('SELECT langue FROM langues_attente WHERE compte_id = ?', [compte]))?.langue);
  }

  async function moi(acteur) {
    const profil = await profilDe(acteur.compte);
    return {
      compte: acteur.compte,
      superAdmin: acteur.superAdmin,
      profil: profil ? { pseudo: profil.pseudo, riotId: profil.riot_id ?? null, discord: profil.discord ?? null } : null,
      // Langue choisie par l'utilisateur dans son profil (null : jamais choisie ; elle PRIME sur la langue par défaut).
      langue: lireLangue(profil?.langue),
      // Langue par défaut définie par l'administrateur (migration 0019) : sert tant que l'utilisateur n'a pas choisi la sienne.
      langueDefaut: profil ? (lireLangue(profil.langue_defaut) ?? 'fr') : ((await langueEnAttente(acteur.compte)) ?? undefined),
      peutCreerTeam: acteur.superAdmin || creationTeams === 'tous',
      // Permission globale « Gérer les profils de jeu » (migration 0021) : le Fondateur, et ceux à qui il l'accorde.
      peutGererJeux: await aPermissionJeux(base, acteur),
    };
  }

  async function majProfil(acteur, corps) {
    const pseudo = lirePseudo(corps?.pseudo);
    const riot = corps?.riotId ? texteNettoye(corps.riotId, 22) : '';
    if (riot && !MOTIF_RIOT.test(riot)) throw echec(400, 'riot-id', 'Riot ID : de la forme Pseudo#TAG.');
    const discord = corps?.discord ? texteNettoye(corps.discord, 32).toLowerCase() : '';
    if (discord && !MOTIF_DISCORD.test(discord)) throw echec(400, 'discord', 'Nom Discord : 2 à 32 caractères (a-z, 0-9, _ et .).');
    const cle = pseudo.toLocaleLowerCase('fr');
    const pris = await base.premier('SELECT id FROM comptes WHERE pseudo_cle = ? AND id <> ?', [cle, acteur.compte]);
    if (pris) throw echec(409, 'pseudo-pris', 'Ce pseudo est déjà pris.');
    // Langue : facultative ; absente, celle déjà enregistrée est conservée.
    const langue = corps?.langue === undefined || corps?.langue === null ? null : lireLangue(corps.langue);
    if (corps?.langue !== undefined && corps?.langue !== null && !langue) throw echec(400, 'langue', 'Langue : fr ou en.');
    const date = iso(maintenant());
    // Nouvelle fiche : la langue par défaut déjà réglée par le Fondateur (Administration) s'applique, sinon le français.
    const attente = await langueEnAttente(acteur.compte);
    await base.executer(
      `INSERT INTO comptes (id, pseudo, pseudo_cle, riot_id, discord, langue, langue_defaut, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET pseudo = excluded.pseudo, pseudo_cle = excluded.pseudo_cle, riot_id = excluded.riot_id, discord = excluded.discord,
         langue = COALESCE(excluded.langue, comptes.langue), maj_le = excluded.maj_le`,
      [acteur.compte, pseudo, cle, riot || null, discord || null, langue, attente ?? 'fr', date, date],
    );
    if (attente) await base.executer('DELETE FROM langues_attente WHERE compte_id = ?', [acteur.compte]);
    return moi(acteur);
  }

  /**
   * `PUT /moi/langue` { langue } : change la langue du profil (français / anglais). `{ langue: null }` efface
   * le choix de l'utilisateur : la langue définie par l'administrateur s'applique de nouveau.
   */
  async function majLangue(acteur, corps) {
    const langue = corps?.langue === null ? null : lireLangue(corps?.langue);
    if (corps?.langue !== null && !langue) throw echec(400, 'langue', 'Langue : fr ou en.');
    await exigerProfil(acteur);
    await base.executer('UPDATE comptes SET langue = ?, maj_le = ? WHERE id = ?', [langue, iso(maintenant()), acteur.compte]);
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
    // Effectifs et modules de toutes les teams listées : deux requêtes groupées (pas une par team).
    const ids = lignes.map(l => l.id);
    const effectifs = new Map(
      (await lignesParIds(base, "SELECT team_id, COUNT(*) AS n FROM membres WHERE statut = 'actif' AND team_id", ids, { apres: 'GROUP BY team_id' })).map(l => [l.team_id, Number(l.n)]),
    );
    const modulesParTeam = new Map(ids.map(id => [id, []]));
    for (const m of await lignesParIds(base, 'SELECT team_id, module FROM team_modules WHERE active = 1 AND team_id', ids)) modulesParTeam.get(m.team_id)?.push(m.module);
    const jeux = await nomsDesJeux(base);
    const teams = [];
    for (const l of lignes) {
      teams.push({
        ...teamPublique(l, jeux),
        membres: effectifs.get(l.id) ?? 0,
        modules: MODULES.filter(m => modulesParTeam.get(l.id)?.includes(m)),
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
    // Profil de jeu obligatoire (migration 0021) : un profil actif, configuré avant la création de la team.
    const jeu = await jeuValidePourTeam(base, corps?.jeu);
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

  /** Permissions CM données par les rôles CM du compte (club, ou cette team) quand le module CM est activé. */
  async function permissionsCmDeTeam(ctx) {
    if (!ctx.modules.has('cm') || !ctx.membre || ctx.membre.statut !== 'actif') return [];
    const lignes = await base.tous(
      "SELECT DISTINCT rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND (a.portee = 'club' OR a.portee = ?)",
      [ctx.acteur.compte, ctx.team.id],
    );
    return lignes.map(l => l.permission);
  }

  async function detailTeam(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    const modules = await base.tous('SELECT module, active FROM team_modules WHERE team_id = ?', [teamId]);
    const n = await base.premier("SELECT COUNT(*) AS n FROM membres WHERE team_id = ? AND statut = 'actif'", [teamId]);
    return {
      team: teamPublique(ctx.team, await nomsDesJeux(base)),
      modules: MODULES.map(cle => ({ cle, active: modules.some(m => m.module === cle && Number(m.active) === 1) })),
      membres: Number(n?.n ?? 0),
      moi: {
        membreId: ctx.membre?.id ?? null,
        role: ctx.role ? { id: ctx.role.id, nom: ctx.role.nom, couleur: ctx.role.couleur, cle: ctx.role.cle_systeme ?? null } : null,
        // Permissions utilisables : celles du rôle dont le module est activé (et, module CM activé, celles des rôles
        // CM du compte valables pour cette team : l'onglet CM s'affiche pour le correspondant de la team).
        permissions: [...new Set([...[...ctx.permissions].filter(p => autorise(ctx.permissions, ctx.modules, p)), ...(await permissionsCmDeTeam(ctx))])].sort(),
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
      champs.push('jeu');
      valeurs.push(await jeuValidePourTeam(base, corps.jeu, { actuel: ctx.team.jeu }));
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

  /**
   * Garde-fous communs à toute modification d'un rôle existant (personnalisé ou système) :
   *  - `roles.manage` exigé ; le rôle Propriétaire est verrouillé (toujours toutes les permissions) ;
   *  - hiérarchie : hors Propriétaire et Fondateur, on ne modifie qu'un rôle placé SOUS le sien
   *    (un Manager ne touche ni au Propriétaire, ni au Manager) ;
   *  - anti-escalade : chaque permission AJOUTÉE doit être détenue par l'acteur ;
   *  - la team garde toujours au moins un membre actif capable de gérer les rôles.
   */
  async function verifierModificationRole(ctx, teamId, role, nouvelles) {
    exiger(ctx, 'roles.manage');
    if (role.cle_systeme === CLE_PROPRIETAIRE) throw echec(403, 'role-verrouille', 'Le rôle Propriétaire est verrouillé : il a toujours toutes les permissions.');
    const libre = ctx.acteur.superAdmin || ctx.role?.cle_systeme === CLE_PROPRIETAIRE;
    if (!libre && (!ctx.role || Number(role.position) <= Number(ctx.role.position))) {
      throw echec(403, 'role-superieur', 'Vous ne pouvez pas modifier un rôle égal ou supérieur au vôtre.');
    }
    const actuelles = await permissionsDuRole(role);
    if (!nouvelles) return { actuelles, ajoutees: [], retirees: [] };
    const ajoutees = nouvelles.filter(p => !actuelles.includes(p));
    const retirees = actuelles.filter(p => !nouvelles.includes(p));
    exigerSousEnsemble(ctx, ajoutees);
    if (retirees.includes('roles.manage')) {
      const reste = await base.premier(
        `SELECT COUNT(*) AS n FROM membres m JOIN roles r ON r.id = m.role_id
          WHERE m.team_id = ? AND m.statut = 'actif' AND r.id <> ?
            AND (r.cle_systeme = ? OR EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = 'roles.manage'))`,
        [teamId, role.id, CLE_PROPRIETAIRE],
      );
      if (Number(reste?.n ?? 0) === 0) throw echec(409, 'dernier-gestionnaire', 'La team doit garder au moins un membre capable de gérer les rôles.');
    }
    return { actuelles, ajoutees, retirees };
  }

  /** Remplace les permissions d'un rôle et journalise ajouts et retraits (effet à la requête suivante : aucun cache). */
  async function enregistrerRole(acteur, teamId, role, { nom, couleur, permissions, ajoutees, retirees, retabli = false }) {
    const t = maintenant();
    const lot = [{ sql: 'UPDATE roles SET nom = ?, couleur = ?, maj_le = ? WHERE id = ?', params: [nom, couleur, iso(t), role.id] }];
    if (permissions) {
      lot.push({ sql: 'DELETE FROM role_permissions WHERE role_id = ?', params: [role.id] });
      for (const p of permissions) lot.push({ sql: 'INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', params: [role.id, p] });
    }
    const charge = { nom, ajoutees, retirees, systeme: Number(role.systeme) === 1 };
    if (retabli) charge.retabli = true;
    lot.push(evenement('role.updated', { teamId, acteur: acteur.compte, entiteType: 'role', entiteId: role.id, charge, maintenant: t }));
    await base.lot(lot);
    return rolePublic(await roleDeTeam(teamId, role.id));
  }

  /**
   * Modifier un rôle existant. Personnalisé : nom, couleur, permissions. Système (Manager, Coach,
   * Analyste, Joueur, Remplaçant) : permissions seulement, propres à la team (chaque team a sa copie).
   */
  async function modifierRole(acteur, teamId, roleId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'roles.manage');
    const role = await roleDeTeam(teamId, roleId);
    const systeme = Number(role.systeme) === 1;
    if (systeme && role.cle_systeme !== CLE_PROPRIETAIRE && (corps?.nom !== undefined || corps?.couleur !== undefined)) {
      throw echec(403, 'role-systeme', 'Le nom et la couleur d’un rôle système ne changent pas : seules ses permissions se modifient.');
    }
    const saisi = lireRoleSaisi(corps, true);
    const { ajoutees, retirees } = await verifierModificationRole(ctx, teamId, role, saisi.permissions);
    if (saisi.nom) await nomDeRoleLibre(teamId, saisi.nom, roleId);
    return enregistrerRole(acteur, teamId, role, { nom: saisi.nom ?? role.nom, couleur: saisi.couleur ?? role.couleur, permissions: saisi.permissions, ajoutees, retirees });
  }

  /** Rétablir les permissions par défaut d'un rôle système (catalogue), pour cette team seulement. */
  async function retablirRole(acteur, teamId, roleId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'roles.manage');
    const role = await roleDeTeam(teamId, roleId);
    if (Number(role.systeme) !== 1 || !role.cle_systeme) throw echec(400, 'role-personnalise', 'Seul un rôle système a des permissions par défaut.');
    const defaut = validerPermissions(permissionsRoleSysteme(role.cle_systeme));
    const { ajoutees, retirees } = await verifierModificationRole(ctx, teamId, role, defaut);
    return enregistrerRole(acteur, teamId, role, { nom: role.nom, couleur: role.couleur, permissions: defaut, ajoutees, retirees, retabli: true });
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
      `SELECT m.id, m.compte_id, m.role_id, m.poste_jeu, m.statut, m.rejoint_le, c.pseudo, c.riot_id, c.discord, c.invite_le, c.active_le, r.nom AS role_nom, r.couleur AS role_couleur, r.cle_systeme
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
      // Compte créé depuis l'Esport, pas encore connecté (première session à venir).
      invite: Boolean(l.invite_le) && !l.active_le,
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

  /** Codes `esp_…` retirés : plus aucune création (410). Les anciennes invitations restent listables et révocables. */
  async function creerInvitation(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'members.invite');
    throw echec(410, 'codes-retires', CODES_RETIRES);
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

  /** Codes `esp_…` retirés : l'acceptation répond 410, sans rien écrire. */
  async function accepterInvitation() {
    throw echec(410, 'codes-retires', CODES_RETIRES);
  }

  // -------------------------------------------------------------- Notifications

  async function notifications(acteur) {
    const lignes = await base.tous(
      'SELECT n.*, t.nom AS team_nom FROM notifications n LEFT JOIN teams t ON t.id = n.team_id WHERE n.compte_id = ? ORDER BY n.cree_le DESC LIMIT 50',
      [acteur.compte],
    );
    const nonLues = await base.premier('SELECT COUNT(*) AS n FROM notifications WHERE compte_id = ? AND lue_le IS NULL', [acteur.compte]);
    const noms = await pseudosDe(base, lignes.map(l => jsonOu(l.charge, {}).membre));
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

  /**
   * Toutes les données Esport d'un compte (droit d'accès et de portabilité) :
   * profil, appartenances, notifications, actions du journal, disponibilités,
   * présences, réunions déposées, tâches et objectifs, repères (et leurs
   * dessins), commentaires et réactions 👍 / 👎 de review, strats et entrées de playbook créées, abonnements iCal (sans
   * leur jeton), invitations créées (sans leur code).
   */
  async function donneesDuCompte(compte, { parFondateur = false } = {}) {
    const profil = await profilDe(compte);
    const q = sql => base.tous(`${sql} LIMIT ?`, [compte, 5000]);
    const nomsTeams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, t.nom]));
    const team = id => nomsTeams.get(id) ?? null;
    const appartenances = await base.tous(
      'SELECT t.nom AS team, r.nom AS role, m.poste_jeu, m.statut, m.rejoint_le FROM membres m JOIN teams t ON t.id = m.team_id JOIN roles r ON r.id = m.role_id WHERE m.compte_id = ?',
      [compte],
    );
    return {
      format: 'applibourse-esport-mes-donnees',
      version: 2,
      compte,
      profil: profil ? { pseudo: profil.pseudo, riotId: profil.riot_id ?? null, discord: profil.discord ?? null, discordId: profil.discord_id ?? null, langue: lireLangue(profil.langue), langueDefaut: lireLangue(profil.langue_defaut) ?? 'fr', creeLe: profil.cree_le, majLe: profil.maj_le } : null,
      teams: appartenances.map(a => ({ team: a.team, role: a.role, posteJeu: a.poste_jeu ?? null, statut: a.statut, rejointLe: a.rejoint_le })),
      notifications: (await q('SELECT type, team_id, charge, lue_le, cree_le FROM notifications WHERE compte_id = ? ORDER BY cree_le')).map(n => ({ type: n.type, team: team(n.team_id), charge: jsonOu(n.charge, {}), lue: Boolean(n.lue_le), date: n.cree_le })),
      journal: (await q('SELECT team_id, action, entite_type, meta, cree_le FROM journal WHERE acteur_id = ? ORDER BY cree_le')).map(a => ({ team: team(a.team_id), action: a.action, entite: a.entite_type, meta: jsonOu(a.meta, {}), date: a.cree_le })),
      disponibilites: {
        regles: (await q('SELECT team_id, jour, debut, fin, type, fuseau FROM dispo_regles WHERE compte_id = ? ORDER BY team_id, jour, debut')).map(r => ({ ...r, team_id: undefined, team: team(r.team_id) })),
        exceptions: (await q('SELECT team_id, debut, fin, type, note FROM dispo_exceptions WHERE compte_id = ? ORDER BY debut')).map(r => ({ ...r, team_id: undefined, team: team(r.team_id) })),
      },
      presences: (await q('SELECT p.team_id, e.titre, p.occurrence, p.rsvp, p.reel, p.note FROM presences p LEFT JOIN planning_evenements e ON e.id = p.evenement_id WHERE p.compte_id = ? ORDER BY p.occurrence')).map(r => ({ team: team(r.team_id), evenement: r.titre ?? null, occurrence: r.occurrence, rsvp: r.rsvp, presence: r.reel, note: r.note })),
      reunionsDeposees: (await q('SELECT team_id, titre, lien, date_reunion, note, statut, cree_le FROM reunions WHERE depose_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(r => ({ team: team(r.team_id), titre: r.titre, lien: r.lien, date: r.date_reunion, note: r.note, statut: r.statut, deposeLe: r.cree_le })),
      taches: (await base.tous('SELECT team_id, titre, description, statut, priorite, echeance, assigne_id, cree_par, cree_le FROM taches WHERE (assigne_id = ? OR cree_par = ?) AND supprime_le IS NULL ORDER BY cree_le LIMIT 5000', [compte, compte])).map(t => ({ team: team(t.team_id), titre: t.titre, description: t.description, statut: t.statut, priorite: t.priorite, echeance: t.echeance, assigneAMoi: t.assigne_id === compte, creeeParMoi: t.cree_par === compte, creeLe: t.cree_le })),
      objectifs: (await base.tous('SELECT team_id, titre, description, statut, date_cible, proprietaire_id, cree_par, cree_le FROM objectifs WHERE (proprietaire_id = ? OR cree_par = ?) AND supprime_le IS NULL ORDER BY cree_le LIMIT 5000', [compte, compte])).map(o => ({ team: team(o.team_id), titre: o.titre, description: o.description, statut: o.statut, dateCible: o.date_cible, aMoi: o.proprietaire_id === compte, creeParMoi: o.cree_par === compte, creeLe: o.cree_le })),
      reviewReperes: (await base.tous('SELECT r.team_id, v.titre AS review, r.debut_s, r.categorie, r.titre, r.note, r.dessin, r.auteur_id, r.cible_id, r.cree_le FROM review_reperes r JOIN reviews v ON v.id = r.review_id WHERE (r.auteur_id = ? OR r.cible_id = ?) AND r.supprime_le IS NULL ORDER BY r.cree_le LIMIT 5000', [compte, compte])).map(r => ({ team: team(r.team_id), review: r.review, seconde: Number(r.debut_s), categorie: r.categorie, titre: r.titre, note: r.note, dessin: lireDessin(r.dessin), auteur: r.auteur_id === compte, concerne: r.cible_id === compte, date: r.cree_le })),
      reviewReactions: (await base.tous("SELECT x.team_id, v.titre AS review, p.titre AS repere, x.cible_type, x.valeur, x.cree_le, x.maj_le FROM review_reactions x JOIN reviews v ON v.id = x.review_id JOIN review_reperes p ON p.id = x.repere_id WHERE x.compte_id = ? ORDER BY x.cree_le LIMIT ?", [compte, 5000])).map(x => ({ team: team(x.team_id), review: x.review, repere: x.repere, cible: x.cible_type, reaction: Number(x.valeur) === 1 ? 'like' : 'dislike', date: x.maj_le })),
      reviewCommentaires: (await q('SELECT team_id, texte, cree_le FROM review_commentaires WHERE auteur_id = ? AND supprime_le IS NULL ORDER BY cree_le')).map(c => ({ team: team(c.team_id), texte: c.texte, date: c.cree_le })),
      strats: (await q('SELECT team_id, titre, carte_nom, side, type, visibilite, cree_le FROM strats WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({ team: team(x.team_id), titre: x.titre, carte: x.carte_nom, side: x.side, type: x.type, visibilite: x.visibilite, creeLe: x.cree_le })),
      playbook: (await q('SELECT team_id, titre, statut, cree_le FROM playbook_entrees WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({ team: team(x.team_id), titre: x.titre, statut: x.statut, creeLe: x.cree_le })),
      // Ressources (migration 0017) : celles qu'il a publiées ou proposées, ses commentaires, réactions et favoris.
      ressources: (await q('SELECT team_id, genre, titre, description, url, tags, visibilite, statut, cree_le, publie_le FROM ressources WHERE auteur_id = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({ team: team(x.team_id), genre: x.genre, titre: x.titre, description: x.description, url: x.url ?? null, tags: jsonOu(x.tags, []), visibilite: x.visibilite, statut: x.statut, creeLe: x.cree_le, publieLe: x.publie_le ?? null })),
      ressourcesCommentaires: (await q('SELECT c.team_id, r.titre, c.texte, c.cree_le FROM ressource_commentaires c JOIN ressources r ON r.id = c.ressource_id WHERE c.auteur_id = ? AND c.supprime_le IS NULL ORDER BY c.cree_le')).map(c => ({ team: team(c.team_id), ressource: c.titre, texte: c.texte, date: c.cree_le })),
      ressourcesReactions: (await q('SELECT x.team_id, r.titre, x.emoji, x.cree_le FROM ressource_reactions x JOIN ressources r ON r.id = x.ressource_id WHERE x.compte_id = ? ORDER BY x.cree_le')).map(x => ({ team: team(x.team_id), ressource: x.titre, reaction: x.emoji, date: x.cree_le })),
      ressourcesFavoris: (await q('SELECT f.team_id, r.titre, f.cree_le FROM ressource_favoris f JOIN ressources r ON r.id = f.ressource_id WHERE f.compte_id = ? ORDER BY f.cree_le')).map(x => ({ team: team(x.team_id), ressource: x.titre, date: x.cree_le })),
      abonnementsIcal: (await q('SELECT team_id, libelle, cree_le, dernier_acces_le, revoque_le FROM ical_jetons WHERE compte_id = ? ORDER BY cree_le')).map(j => ({ team: team(j.team_id), libelle: j.libelle, creeLe: j.cree_le, dernierAcces: j.dernier_acces_le, revoqueLe: j.revoque_le })),
      // Bot Discord : liaison du compte (identifiant Discord public, jamais de code).
      discord: await (async () => {
        const l = await base.premier('SELECT discord_user_id, discord_nom, lie_le FROM discord_comptes WHERE compte_id = ?', [compte]);
        return l ? { lie: true, discordUserId: l.discord_user_id, discordNom: l.discord_nom || null, lieLe: l.lie_le } : { lie: false };
      })(),
      // Récapitulatif e-mail (migration 0015) : réglage seulement (l'adresse reste chiffrée sur le serveur).
      recapCourriel: await (async () => {
        const l = await base.premier('SELECT frequence, dernier_envoi_le, cree_le FROM courriel_recap WHERE compte_id = ?', [compte]);
        return l ? { actif: true, frequence: l.frequence, dernierEnvoi: l.dernier_envoi_le ?? null, depuis: l.cree_le } : { actif: false };
      })(),
      // Suivi des joueurs : les notes du staff PARTAGÉES avec lui (auteur selon son choix). Les notes privées du staff
      // ne figurent que dans l'export demandé par le Fondateur (`notesStaffPrivees`) : voir docs/esport/suivi-joueurs.md.
      notesPartagees: await (async () => {
        const lignes = await q('SELECT team_id, categorie, ton, contenu, tags, date_note, auteur_id, auteur_masque FROM notes_joueurs WHERE joueur_id = ? AND partagee = 1 ORDER BY date_note');
        const noms = await pseudosDe(base, lignes.filter(n => Number(n.auteur_masque) !== 1).map(n => n.auteur_id).filter(Boolean));
        return lignes.map(n => ({ team: team(n.team_id), date: n.date_note, categorie: n.categorie, ton: n.ton, contenu: n.contenu, tags: jsonOu(n.tags, []), auteur: Number(n.auteur_masque) === 1 || !n.auteur_id ? null : (noms[n.auteur_id] ?? null) }));
      })(),
      ...(parFondateur
        ? {
            notesStaffPrivees: (await q('SELECT team_id, categorie, ton, contenu, tags, date_note, auteur_id FROM notes_joueurs WHERE joueur_id = ? AND partagee = 0 ORDER BY date_note')).map(n => ({ team: team(n.team_id), date: n.date_note, categorie: n.categorie, ton: n.ton, contenu: n.contenu, tags: jsonOu(n.tags, []), auteur: n.auteur_id ?? null })),
          }
        : {}),
      notesRedigees: (await q('SELECT team_id, COUNT(*) AS n FROM notes_joueurs WHERE auteur_id = ? GROUP BY team_id')).map(n => ({ team: team(n.team_id), notes: Number(n.n) })),
      invitationsCreees: (await q('SELECT team_id, libelle, expire_le, utilisations, utilisations_max, cree_le FROM invitations WHERE cree_par = ? ORDER BY cree_le')).map(i => ({ team: team(i.team_id), libelle: i.libelle, expireLe: i.expire_le, utilisations: Number(i.utilisations), utilisationsMax: Number(i.utilisations_max), creeLe: i.cree_le })),
      // Profils de jeu (migration 0021) : permissions globales reçues et versions de profils enregistrées.
      permissionsGlobales: (await q('SELECT permission, cree_le FROM permissions_globales WHERE compte_id = ? ORDER BY cree_le')).map(p => ({ permission: p.permission, depuis: p.cree_le })),
      versionsProfilsJeu: (await q('SELECT jeu_cle, version, motif, cree_le FROM jeu_versions WHERE auteur_id = ? ORDER BY cree_le')).map(v => ({ jeu: v.jeu_cle, version: Number(v.version), motif: v.motif, date: v.cree_le })),
      // Tournois et résultats (migration 0022) : rosters où il est inscrit, matchs où il a été aligné (ses personnages et
      // ses statistiques), résultats et tournois qu'il a saisis.
      tournois: (await q('SELECT r.team_id, t.nom, t.debut, t.fin, t.statut, r.role FROM tournoi_roster r JOIN tournois t ON t.id = r.tournoi_id WHERE r.compte_id = ? AND t.supprime_le IS NULL ORDER BY t.debut')).map(x => ({ team: team(x.team_id), tournoi: x.nom, debut: x.debut ?? null, fin: x.fin ?? null, statut: x.statut, role: x.role })),
      resultatsJoues: (await q('SELECT j.team_id, r.date_match, r.genre, r.issue, r.place, r.adversaires, r.mvp_id, j.personnages, j.stats FROM resultat_joueurs j JOIN resultats r ON r.id = j.resultat_id WHERE j.compte_id = ? AND r.supprime_le IS NULL ORDER BY r.date_match')).map(x => ({
        team: team(x.team_id),
        date: x.date_match,
        genre: x.genre,
        issue: x.issue ?? null,
        place: x.place === null || x.place === undefined ? null : Number(x.place),
        adversaires: jsonOu(x.adversaires, []).map(a => a.nom),
        mvp: x.mvp_id === compte,
        personnages: jsonOu(x.personnages, []),
        stats: jsonOu(x.stats, {}),
      })),
      resultatsSaisis: (await q('SELECT team_id, COUNT(*) AS n FROM resultats WHERE saisi_par = ? GROUP BY team_id')).map(x => ({ team: team(x.team_id), resultats: Number(x.n) })),
      tournoisCrees: (await q('SELECT team_id, nom, cree_le FROM tournois WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({ team: team(x.team_id), tournoi: x.nom, creeLe: x.cree_le })),
      // Section CM (migration 0023) : rôles CM, cartes créées ou assignées, commentaires, clips proposés, fichiers déposés.
      ...(await exportCm(base, compte)),
      // Sponsors (migration 0024) : fiches dont il est responsable, échanges qu'il a notés.
      ...(await exportSponsors(base, compte)),
    };
  }

  async function exporter(acteur, compte) {
    const t = maintenant();
    const donnees = await donneesDuCompte(compte, { parFondateur: compte !== acteur.compte && acteur.superAdmin });
    await base.lot([
      evenement('account.exported', { acteur: acteur.compte, entiteType: 'compte', entiteId: compte, charge: compte === acteur.compte ? {} : { compte, parFondateur: true }, maintenant: t }),
    ]);
    return { ...donnees, exporteLe: iso(t) };
  }

  /** Export de mes données (droit d'accès). */
  async function exporterMesDonnees(acteur) {
    return exporter(acteur, acteur.compte);
  }

  /**
   * Suppression (droit à l'effacement) : le compte Esport et ses données
   * personnelles sont effacés ; ce qu'il a écrit pour la team (réunions
   * déposées, repères, commentaires, strats) reste, mais n'est plus relié à
   * un pseudo (« Compte supprimé ») ; il est retiré des tâches et objectifs
   * qui lui étaient attribués et des repères qui le visaient. Le journal garde
   * l'identifiant technique (sans pseudo), effacé à la fin de sa rétention.
   */
  async function supprimerCompte(acteur, compte) {
    const membres = await base.tous('SELECT m.*, t.nom AS team_nom FROM membres m JOIN teams t ON t.id = m.team_id WHERE m.compte_id = ? AND t.supprimee_le IS NULL', [compte]);
    const bloquantes = [];
    for (const m of membres) if (await estDernierProprietaire(m.team_id, m)) bloquantes.push(m.team_nom);
    if (bloquantes.length > 0) {
      const qui = compte === acteur.compte ? 'Vous êtes' : 'Ce compte est';
      const e = echec(409, 'dernier-proprietaire', `${qui} le dernier Propriétaire de : ${bloquantes.join(', ')}. Nommez un autre Propriétaire (ou supprimez la team) d’abord.`);
      e.details = { teams: bloquantes };
      throw e;
    }
    const t = maintenant();
    const lot = [];
    for (const m of membres) {
      lot.push(evenement(compte === acteur.compte ? 'member.left' : 'member.removed', { teamId: m.team_id, acteur: acteur.compte, entiteType: 'membre', entiteId: m.id, charge: { compte, suppression: true }, maintenant: t }));
    }
    lot.push(
      { sql: 'DELETE FROM membres WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM notifications WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM dispo_regles WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM dispo_exceptions WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM presences WHERE compte_id = ?', params: [compte] },
      // Ses demandes de compte en attente (avec l'adresse proposée) disparaissent.
      { sql: "DELETE FROM demandes_compte WHERE demandeur_id = ? AND statut = 'en_attente'", params: [compte] },
      { sql: 'DELETE FROM ical_jetons WHERE compte_id = ?', params: [compte] },
      // Bot Discord : liaison du compte et codes en cours.
      { sql: 'DELETE FROM discord_comptes WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM discord_codes WHERE compte_id = ?', params: [compte] },
      // Récapitulatif e-mail (migration 0015) : l'adresse chiffrée disparaît avec le compte.
      { sql: 'DELETE FROM courriel_recap WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM langues_attente WHERE compte_id = ?', params: [compte] },
      // Anonymisation : plus rien n'est attribué à ce compte.
      { sql: 'UPDATE taches SET assigne_id = NULL WHERE assigne_id = ?', params: [compte] },
      { sql: 'UPDATE objectifs SET proprietaire_id = NULL WHERE proprietaire_id = ?', params: [compte] },
      { sql: 'UPDATE review_reperes SET cible_id = NULL WHERE cible_id = ?', params: [compte] },
      { sql: 'DELETE FROM review_reactions WHERE compte_id = ?', params: [compte] },
      // Ressources (migration 0017) : ce qu'il a publié et ses commentaires restent, anonymes ; ses favoris, ses
      // réactions et ses visites du canal sont effacés.
      { sql: 'UPDATE ressources SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
      { sql: 'UPDATE ressources SET valide_par = NULL WHERE valide_par = ?', params: [compte] },
      { sql: 'UPDATE ressource_commentaires SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
      { sql: 'DELETE FROM ressource_favoris WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM ressource_reactions WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM ressource_visites WHERE compte_id = ?', params: [compte] },
      // Vidéos, enregistrements et transcriptions (migration 0014) : ce qu'il a déposé reste pour la team, sans
      // auteur ; ses envois inachevés sont confiés au cron (effacés au passage suivant).
      { sql: 'UPDATE transcriptions SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
      { sql: 'UPDATE transcriptions SET modifie_par = NULL WHERE modifie_par = ?', params: [compte] },
      // Transcription sur le serveur (migration 0016) : qui l'a demandée.
      { sql: 'UPDATE travaux_transcription SET demande_par = NULL WHERE demande_par = ?', params: [compte] },
      { sql: "UPDATE fichiers SET depose_par = '' WHERE depose_par = ? AND entite_type IN ('review_video', 'reunion_enregistrement', 'reunion_transcription', 'ressource_fichier')", params: [compte] },
      { sql: "UPDATE envois SET compte_id = '', maj_le = '1970-01-01T00:00:00.000Z' WHERE compte_id = ? AND fichier_id IS NULL", params: [compte] },
      // Suivi des joueurs : les notes du staff SUR lui sont effacées (ses données) ; celles qu'il a écrites restent, sans auteur.
      { sql: 'DELETE FROM notes_joueurs WHERE joueur_id = ?', params: [compte] },
      { sql: 'UPDATE notes_joueurs SET auteur_id = NULL, auteur_masque = 1 WHERE auteur_id = ?', params: [compte] },
      { sql: 'DELETE FROM tentatives WHERE cle = ?', params: [`invitation:compte:${compte}`] },
      // Statistiques d'usage (migration 0018) : détail et agrégats du compte effacés.
      ...effacementUsage(compte),
      // Profils de jeu (migration 0021) : sa délégation disparaît ; ce qu'il a écrit ou décidé reste, sans auteur.
      { sql: 'DELETE FROM permissions_globales WHERE compte_id = ?', params: [compte] },
      { sql: 'UPDATE jeux SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
      { sql: 'UPDATE jeux SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
      { sql: 'UPDATE jeu_versions SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
      { sql: 'UPDATE ia_travaux SET demande_par = NULL WHERE demande_par = ?', params: [compte] },
      { sql: 'UPDATE ia_propositions SET decide_par = NULL WHERE decide_par = ?', params: [compte] },
      ...effacementCompetition(compte),
      // Section CM (migration 0023) : affectations et assignations effacées ; ce qu'il a écrit reste, sans auteur.
      ...(await effacementCm(base, compte)),
      // Sponsors (migration 0024) : plus responsable de rien ; ce qu'il a écrit reste, sans auteur.
      ...effacementSponsors(compte),
      { sql: 'DELETE FROM comptes WHERE id = ?', params: [compte] },
      evenement('account.deleted', { acteur: acteur.compte, entiteType: 'compte', entiteId: compte, charge: { teams: membres.length, ...(compte === acteur.compte ? {} : { parFondateur: true }) }, maintenant: t }),
    );
    await base.lot(lot);
    return { ok: true };
  }

  async function supprimerMesDonnees(acteur) {
    return supprimerCompte(acteur, acteur.compte);
  }

  const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
  function compteCible(acteur, compte) {
    if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    return compte;
  }

  /** Fondateur : export des données d'un membre (demande RGPD transmise au Fondateur). */
  async function exporterCompte(acteur, compte) {
    compteCible(acteur, compte);
    if (!(await profilDe(compte)) && !(await base.premier('SELECT id FROM membres WHERE compte_id = ?', [compte]))) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    return exporter(acteur, compte);
  }

  /** Fondateur : suppression (anonymisation) du compte Esport d'un membre. */
  async function supprimerCompteMembre(acteur, compte) {
    compteCible(acteur, compte);
    if (!(await profilDe(compte)) && !(await base.premier('SELECT id FROM membres WHERE compte_id = ?', [compte]))) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    return supprimerCompte(acteur, compte);
  }

  // -------------------------------------------------------------- Vues globales

  /**
   * Contextes de toutes les teams que l'acteur peut ouvrir : membre ACTIF
   * (une team où il est suspendu n'y figure pas), ou toutes pour le super
   * admin. Base des vues de premier niveau (Dashboard, Membres).
   */
  async function contextesDe(acteur) {
    const lignes = acteur.superAdmin
      ? await base.tous('SELECT id FROM teams WHERE supprimee_le IS NULL ORDER BY nom', [])
      : await base.tous(
          "SELECT t.id FROM membres m JOIN teams t ON t.id = m.team_id WHERE m.compte_id = ? AND m.statut = 'actif' AND t.supprimee_le IS NULL ORDER BY t.nom",
          [acteur.compte],
        );
    const sortie = [];
    for (const { id } of lignes) {
      const ctx = await contexteTeam(acteur, id).catch(() => null);
      if (ctx) sortie.push(ctx);
    }
    return sortie;
  }

  /** Vrai si l'acteur peut attribuer ce rôle / agir sur un membre qui l'a (anti-escalade, voir exigerRoleGerable). */
  async function roleGerable(ctx, role) {
    try {
      await exigerRoleGerable(ctx, role);
      return true;
    } catch {
      return false;
    }
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
    contextesDe,
    exiger,
    exigerRoleGerable,
    roleGerable,
    roleDeTeam,
    permissionsDuRole,
    estDernierProprietaire,
    teamPublique,
    moi,
    majProfil,
    majLangue,
    listeTeams,
    creerTeam,
    detailTeam,
    modifierTeam,
    supprimerTeam,
    changerModules,
    listeRoles,
    creerRole,
    modifierRole,
    retablirRole,
    supprimerRole,
    listeMembres,
    modifierMembre,
    retirerMembre,
    listeInvitations,
    creerInvitation,
    revoquerInvitation,
    accepterInvitation,
    notifications,
    marquerLues,
    exporterMesDonnees,
    supprimerMesDonnees,
    exporterCompte,
    supprimerCompteMembre,
    moduleFutur,
  };
}
