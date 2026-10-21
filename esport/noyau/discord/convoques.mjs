/**
 * Qui est convoqué à une occurrence : le SEUL endroit du bot qui répond à
 * « qui pinger ». Il s'appuie sur la règle des convocations du planning
 * (planning/convocations.mjs, migration 0009) : groupes, choix nominatifs,
 * exclusions, convocation propre à une date ; un Propriétaire (ou le
 * Fondateur) n'est jamais convoqué sans être coché. Le bot, les rappels, les
 * relances et /prochain passent tous par ici.
 */

import { convocationDe, convoques as convoquesRegle, groupeDe, normaliserConvocation } from '../planning/convocations.mjs';

/**
 * Membres actifs d'une team, avec ce que les convocations et le bot doivent
 * savoir : `{ compte, pseudo, cle, rejointLe, proprietaire, perms, staff, discordId, discordLie }`.
 * « Staff » : groupe staff des convocations (Manager, Coach, Analyste, rôles
 * qui marquent la présence ou créent au planning) ou Propriétaire.
 */
export async function membresTeam(base, teamId) {
  const lignes = await base.tous(
    `SELECT m.compte_id, m.rejoint_le, c.pseudo, c.discord_id, r.cle_systeme, rp.permission, dc.discord_user_id FROM membres m
       JOIN roles r ON r.id = m.role_id
       JOIN comptes c ON c.id = m.compte_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN discord_comptes dc ON dc.compte_id = m.compte_id
      WHERE m.team_id = ? AND m.statut = 'actif'`,
    [teamId],
  );
  const parCompte = new Map();
  for (const l of lignes) {
    if (!parCompte.has(l.compte_id)) {
      parCompte.set(l.compte_id, {
        compte: l.compte_id,
        pseudo: l.pseudo,
        cle: l.cle_systeme ?? null,
        rejointLe: l.rejoint_le ?? null,
        proprietaire: l.cle_systeme === 'proprietaire',
        perms: new Set(),
        // Qui pinger : la liaison /lier VÉRIFIÉE prime ; sinon le Discord ID saisi par le Fondateur (migration 0015).
        discordId: l.discord_user_id ?? l.discord_id ?? null,
        discordLie: Boolean(l.discord_user_id),
      });
    }
    if (l.permission) parCompte.get(l.compte_id).perms.add(l.permission);
  }
  return [...parCompte.values()]
    .map(m => {
      const g = groupeDe(m);
      return { ...m, staff: g === 'staff' || g === 'proprietaire' };
    })
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
}

/** Convocation effective d'une occurrence : celle de la date (exception), sinon celle de la série. */
export function convocationOccurrence(evenement, occurrence) {
  return occurrence?.convocation ? (normaliserConvocation(occurrence.convocation) ?? convocationDe(evenement)) : convocationDe(evenement);
}

/** Convoqués d'une occurrence (`evenement` : ligne de planning_evenements ; `occurrence` : `{ convocation?, fin? }`). */
export function comptesConvoques(membres, evenement, occurrence) {
  return convoquesRegle(convocationOccurrence(evenement, occurrence), membres, occurrence?.fin);
}

/** Convoqués d'une occurrence, membres lus au besoin. */
export async function convoquesEvenement(base, teamId, evenement, occurrence, membres) {
  return comptesConvoques(membres ?? (await membresTeam(base, teamId)), evenement, occurrence);
}

/**
 * Réunion staff : une « réunion » dont tous les convoqués sont du staff (ou
 * des Propriétaires). Jamais annoncée publiquement (ni bot ni webhook).
 */
export function estReunionStaff(evenement, membres, occurrence) {
  if (evenement?.type !== 'meeting') return false;
  const choisis = comptesConvoques(membres, evenement, occurrence);
  return choisis.length > 0 && choisis.every(m => m.staff);
}

/** Convocation de /evenement-creer : « joueurs » (défaut), « staff » ou « tous » (jamais les Propriétaires). */
export function convocationParGroupe(groupe) {
  return { groupes: [['joueurs', 'staff', 'tous'].includes(groupe) ? groupe : 'joueurs'], membres: [], exclus: [], proprietaires: [] };
}
