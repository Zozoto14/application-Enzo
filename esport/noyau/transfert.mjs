/**
 * Export et import JSON de TOUTE la base Esport (déménagement vers un vrai
 * serveur, sauvegarde). Le format ne dépend ni de D1 ni de SQLite : des
 * tables, des lignes, des valeurs texte ou nombre.
 *
 * L'import ne se fait que dans une base VIDE (schéma déjà migré) : il ne
 * fusionne jamais, pour ne rien écraser par erreur.
 */

import { echec, iso } from './outils.mjs';

export const FORMAT_EXPORT = 'applibourse-esport';
export const VERSION_EXPORT = 1;

/** Tables dans l'ordre des dépendances (clés étrangères) ; `tentatives` (passagère) n'est pas exportée. */
export const TABLES = [
  ['comptes', 'id'],
  ['teams', 'id'],
  ['team_modules', 'team_id, module'],
  ['roles', 'id'],
  ['role_permissions', 'role_id, permission'],
  ['membres', 'id'],
  ['invitations', 'id'],
  ['planning_evenements', 'id'],
  ['planning_exceptions', 'evenement_id, occurrence'],
  ['presences', 'evenement_id, occurrence, compte_id'],
  ['dispo_regles', 'id'],
  ['dispo_exceptions', 'id'],
  ['ical_jetons', 'id'],
  ['evenements', 'id'],
  ['journal', 'id'],
  ['notifications', 'id'],
  // Phase 3 (migration 0003).
  ['types_reunion', 'id'],
  ['fichiers', 'id'],
  ['reunions', 'id'],
  ['objectifs', 'id'],
  ['taches', 'id'],
  // Phase 4 (migration 0004) : l'adresse du webhook reste CHIFFRÉE dans l'export.
  ['discord_webhooks', 'team_id'],
  ['discord_notification_settings', 'team_id, cle'],
  ['discord_file', 'id'],
  ['discord_rappels', 'evenement_id, occurrence, genre'],
];
const NOMS_TABLES = TABLES.map(([t]) => t);
const MOTIF_COLONNE = /^[a-z_][a-z0-9_]{0,40}$/;

export async function exporterBase(base, maintenant = Date.now()) {
  const tables = {};
  for (const [table, ordre] of TABLES) {
    tables[table] = (await base.tous(`SELECT * FROM ${table} ORDER BY ${ordre}`, [])).map(l => ({ ...l }));
  }
  return { format: FORMAT_EXPORT, version: VERSION_EXPORT, exporteLe: iso(maintenant), tables };
}

export async function baseVide(base) {
  for (const table of ['comptes', 'teams', 'journal']) {
    const l = await base.premier(`SELECT COUNT(*) AS n FROM ${table}`, []);
    if (Number(l?.n ?? 0) > 0) return false;
  }
  return true;
}

/** Importe un export dans une base vide ; rend le nombre de lignes par table. */
export async function importerBase(base, donnees, { tailleLot = 50 } = {}) {
  if (!donnees || donnees.format !== FORMAT_EXPORT || donnees.version !== VERSION_EXPORT || typeof donnees.tables !== 'object') {
    throw echec(400, 'format', 'Ce fichier n’est pas un export Esport (version 1).');
  }
  for (const nom of Object.keys(donnees.tables)) {
    if (!NOMS_TABLES.includes(nom)) throw echec(400, 'table-inconnue', `Table inconnue dans l’export : ${String(nom).slice(0, 40)}`);
  }
  if (!(await baseVide(base))) throw echec(409, 'base-non-vide', 'La base de destination n’est pas vide : l’import ne fusionne jamais.');
  const bilan = {};
  for (const table of NOMS_TABLES) {
    const lignes = Array.isArray(donnees.tables[table]) ? donnees.tables[table] : [];
    // Types de réunion globaux posés par la migration : remplacés par ceux de l'export (éventuellement modifiés).
    if (table === 'types_reunion' && lignes.length > 0) await base.executer('DELETE FROM types_reunion WHERE team_id IS NULL', []);
    bilan[table] = lignes.length;
    let lot = [];
    for (const ligne of lignes) {
      const colonnes = Object.keys(ligne);
      if (colonnes.length === 0 || !colonnes.every(c => MOTIF_COLONNE.test(c))) throw echec(400, 'colonne', `Colonne illisible dans ${table}.`);
      const valeurs = colonnes.map(c => {
        const v = ligne[c];
        if (v === null || typeof v === 'string' || typeof v === 'number') return v;
        throw echec(400, 'valeur', `Valeur illisible dans ${table}.${c}.`);
      });
      lot.push({ sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: valeurs });
      if (lot.length >= tailleLot) {
        await base.lot(lot);
        lot = [];
      }
    }
    if (lot.length > 0) await base.lot(lot);
  }
  return bilan;
}
