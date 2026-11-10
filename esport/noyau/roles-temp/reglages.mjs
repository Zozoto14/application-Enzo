/**
 * Rôles Discord temporaires des teams (docs/esport/bot-discord.md, « Rôles temporaires ») : réglages, lus et validés
 * ici. Fonctions sur la base, sans réseau.
 *
 *  - `roles_temp_reglages` (une ligne par team, migration 0066) : rôle Discord à donner, durée par défaut, nombre de
 *    personnes en même temps, rôles de la team autorisés, salon des journaux, message privé à la personne ;
 *  - `tickets_reglages`, clé `roles_temp_commandes` : chaque sous-commande de /role-temp activée ou non, et ses rôles
 *    Discord autorisés (comme les commandes des tickets et de /voc).
 * Le serveur Discord est celui du club (Tickets › Configuration › Général), sinon celui lié à la team par le bot.
 */

import { echec, iso, jsonOu } from '../outils.mjs';
import { lireGeneral } from '../tickets/reglages.mjs';

/** Sous-commandes de /role-temp. */
export const COMMANDES_ROLES_TEMP = Object.freeze(['donner', 'retirer', 'liste']);
/** Clés des rôles système de la team autorisés par défaut : Coach, Manager, Propriétaire. */
export const ROLES_PAR_DEFAUT = Object.freeze(['coach', 'manager', 'proprietaire']);
export const LIMITES_ROLES_TEMP = Object.freeze({ dureeMinH: 1, dureeMaxH: 720, dureeDefautH: 24, maxMin: 1, maxMax: 100, maxDefaut: 10, roles: 20 });

export const REGLAGES_DEFAUT = Object.freeze({
  actif: false,
  roleId: null,
  roleNom: '',
  dureeDefautH: LIMITES_ROLES_TEMP.dureeDefautH,
  maxSimultanes: LIMITES_ROLES_TEMP.maxDefaut,
  rolesAutorises: [],
  salonJournalId: null,
  mp: true,
});

const ID = /^\d{5,25}$/;
const UUID = /^[0-9a-f-]{36}$/;

const idOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !ID.test(v)) throw echec(400, quoi, 'Identifiant Discord invalide (chiffres seulement).');
  return v;
};

const entier = (v, min, max, quoi, defaut) => {
  if (v === undefined || v === null || v === '') return defaut;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw echec(400, quoi, `Valeur hors limites (${min} à ${max}).`);
  return n;
};

/** Réglages d'une team tels qu'ils sont gardés (ligne de la base → objet ; absente : valeurs par défaut). */
export function reglagesDepuisLigne(l) {
  if (!l) return { ...REGLAGES_DEFAUT, rolesAutorises: [] };
  const roles = jsonOu(l.roles_autorises, []);
  return {
    actif: Number(l.actif) === 1,
    roleId: l.role_id && ID.test(l.role_id) ? l.role_id : null,
    roleNom: String(l.role_nom ?? ''),
    dureeDefautH: Number(l.duree_defaut_h) || LIMITES_ROLES_TEMP.dureeDefautH,
    maxSimultanes: Number(l.max_simultanes) || LIMITES_ROLES_TEMP.maxDefaut,
    rolesAutorises: Array.isArray(roles) ? roles.filter(x => typeof x === 'string' && UUID.test(x)) : [],
    salonJournalId: l.salon_journal_id && ID.test(l.salon_journal_id) ? l.salon_journal_id : null,
    mp: Number(l.mp) !== 0,
  };
}

export async function lireReglagesEquipe(base, teamId) {
  return reglagesDepuisLigne(await base.premier('SELECT * FROM roles_temp_reglages WHERE team_id = ?', [teamId]));
}

/** Valide les réglages (fusion avec l'existant : seuls les champs fournis changent). */
export function validerReglagesEquipe(c, actuel) {
  if (!c || typeof c !== 'object') throw echec(400, 'roles-temp', 'Réglages illisibles.');
  const s = { ...actuel, rolesAutorises: [...(actuel.rolesAutorises ?? [])] };
  if (c.actif !== undefined) s.actif = c.actif === true;
  if (c.roleId !== undefined) {
    s.roleId = idOuNull(c.roleId, 'roles-temp-role');
    if (!s.roleId) s.roleNom = '';
  }
  if (c.roleNom !== undefined) {
    if (typeof c.roleNom !== 'string') throw echec(400, 'roles-temp-role', 'Nom du rôle illisible.');
    // Nom Discord gardé tel quel (Unicode fantaisie compris) : seuls les caractères de contrôle sont retirés.
    // eslint-disable-next-line no-control-regex
    s.roleNom = c.roleNom.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  }
  s.dureeDefautH = entier(c.dureeDefautH, LIMITES_ROLES_TEMP.dureeMinH, LIMITES_ROLES_TEMP.dureeMaxH, 'roles-temp-duree', s.dureeDefautH);
  s.maxSimultanes = entier(c.maxSimultanes, LIMITES_ROLES_TEMP.maxMin, LIMITES_ROLES_TEMP.maxMax, 'roles-temp-max', s.maxSimultanes);
  if (c.rolesAutorises !== undefined) {
    const l = c.rolesAutorises;
    if (!Array.isArray(l) || l.length > LIMITES_ROLES_TEMP.roles || l.some(x => typeof x !== 'string' || !UUID.test(x))) throw echec(400, 'roles-temp-autorises', 'Liste de rôles de la team invalide.');
    s.rolesAutorises = [...new Set(l)];
  }
  if (c.salonJournalId !== undefined) s.salonJournalId = idOuNull(c.salonJournalId, 'roles-temp-journal');
  if (c.mp !== undefined) s.mp = c.mp !== false;
  if (s.actif && !s.roleId) throw echec(400, 'roles-temp-role', 'Choisissez le rôle Discord à donner avant d’activer les rôles temporaires.');
  return s;
}

export function instructionReglagesEquipe(teamId, s, compte, t) {
  return {
    sql: `INSERT INTO roles_temp_reglages (team_id, actif, role_id, role_nom, duree_defaut_h, max_simultanes, roles_autorises, salon_journal_id, mp, maj_par, maj_le)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (team_id) DO UPDATE SET actif = excluded.actif, role_id = excluded.role_id, role_nom = excluded.role_nom, duree_defaut_h = excluded.duree_defaut_h,
            max_simultanes = excluded.max_simultanes, roles_autorises = excluded.roles_autorises, salon_journal_id = excluded.salon_journal_id, mp = excluded.mp,
            maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
    params: [teamId, s.actif ? 1 : 0, s.roleId, s.roleNom, s.dureeDefautH, s.maxSimultanes, JSON.stringify(s.rolesAutorises), s.salonJournalId, s.mp ? 1 : 0, compte ?? null, iso(t)],
  };
}

/** Identifiants des rôles de la team autorisés à donner le rôle : ceux réglés, sinon Coach, Manager et Propriétaire. */
export async function rolesAutorisesDeEquipe(base, teamId, reglages) {
  const lignes = await base.tous('SELECT id, cle_systeme FROM roles WHERE team_id = ?', [teamId]);
  const choisis = new Set(reglages.rolesAutorises);
  if (choisis.size) return new Set(lignes.filter(r => choisis.has(r.id)).map(r => r.id));
  return new Set(lignes.filter(r => ROLES_PAR_DEFAUT.includes(r.cle_systeme)).map(r => r.id));
}

/** Serveur Discord d'une team : celui du club (réglage des tickets), sinon celui lié à la team par le bot. */
export async function guildDeEquipe(base, teamId, general) {
  const g = general ?? (await lireGeneral(base));
  if (g.guildId) return g.guildId;
  const l = await base.premier('SELECT guild_id FROM discord_serveurs WHERE team_id = ?', [teamId]);
  return l?.guild_id && ID.test(l.guild_id) ? l.guild_id : null;
}

// ------------------------------------------------------------------ Commandes

async function lireCle(base, cle) {
  const l = await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [cle]);
  const v = jsonOu(l?.valeur, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export async function lireCommandesRolesTemp(base) {
  const v = await lireCle(base, 'roles_temp_commandes');
  return Object.fromEntries(COMMANDES_ROLES_TEMP.map(c => [c, { actif: v[c]?.actif !== false, roles: Array.isArray(v[c]?.roles) ? v[c].roles.filter(x => ID.test(String(x))) : [] }]));
}

export function validerCommandesRolesTemp(c) {
  const s = {};
  for (const nom of COMMANDES_ROLES_TEMP) {
    const v = c?.[nom];
    if (!v) continue;
    const roles = v.roles ?? [];
    if (!Array.isArray(roles) || roles.length > LIMITES_ROLES_TEMP.roles || roles.some(x => typeof x !== 'string' || !ID.test(x))) throw echec(400, `commande-${nom}`, 'Liste d’identifiants Discord invalide.');
    s[nom] = { actif: v.actif !== false, roles: [...new Set(roles)] };
  }
  return s;
}
