/**
 * Droits de LECTURE du centre de notifications : calculés à chaque lecture depuis l'état actuel des rôles (team,
 * club, CM, Sponsors), avec la même logique que les pages (contexteTeam : appartenance → module → permission ;
 * contexteCm ; droitsSponsors). Un rôle retiré ferme aussitôt ce qu'il ouvrait.
 *
 *  - Fondateur (super admin, CEO) : tout, sauf le bruit technique (`aucun`) ;
 *  - accès à toutes les teams (rôle du club « Second CEO » par défaut) : les permissions de team partout, sauf
 *    supprimer une team (comme contexteTeam) ; le reste selon ses permissions du club ;
 *  - membre actif : les permissions de son rôle (toutes pour un Propriétaire), module activé ; suspendu : rien.
 */

import { CLE_PROPRIETAIRE, TOUTES_PERMISSIONS, autorise, moduleConnu } from '../permissions.mjs';
import { permissionsGlobalesDe } from '../roles/globales.mjs';
import { droitsSponsors } from '../sponsors/commun.mjs';
import { porteesDe } from '../cm/commun.mjs';

const ACCES_TOTAL = 'teams.acces_total';
const SAUF_ACCES_TOTAL = new Set(['team.delete']);

/** Droits d'un lecteur : `{ tout }` pour le Fondateur, sinon permissions par team, du club et du CM. */
export async function droitsLecteur(base, acteur) {
  if (acteur?.superAdmin) return { tout: true, compte: acteur.compte };
  const club = new Set([...(await permissionsGlobalesDe(base, acteur)), ...(await droitsSponsors(base, acteur))]);
  const accesTotal = club.has(ACCES_TOTAL);
  const teams = await base.tous('SELECT id FROM teams WHERE supprimee_le IS NULL', []);
  const modules = new Map(teams.map(t => [t.id, new Set()]));
  for (const l of await base.tous('SELECT team_id, module FROM team_modules WHERE active = 1', [])) if (moduleConnu(l.module)) modules.get(l.team_id)?.add(l.module);
  const brutes = new Map();
  if (accesTotal) for (const t of teams) brutes.set(t.id, new Set(TOUTES_PERMISSIONS.filter(p => !SAUF_ACCES_TOTAL.has(p))));
  const lignes = await base.tous(
    "SELECT m.team_id, r.cle_systeme, rp.permission FROM membres m JOIN roles r ON r.id = m.role_id LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE m.compte_id = ? AND m.statut = 'actif'",
    [acteur.compte],
  );
  for (const l of lignes) {
    if (!modules.has(l.team_id)) continue;
    const s = brutes.get(l.team_id) ?? new Set();
    if (l.cle_systeme === CLE_PROPRIETAIRE) for (const p of TOUTES_PERMISSIONS) s.add(p);
    else if (l.permission) s.add(l.permission);
    brutes.set(l.team_id, s);
  }
  // Permissions EFFECTIVES (module activé), plus `*` : membre actif (ou accès à toutes les teams).
  const parTeam = new Map();
  for (const [teamId, s] of brutes) {
    const mods = modules.get(teamId) ?? new Set();
    parTeam.set(teamId, new Set(['*', ...[...s].filter(p => autorise(s, mods, p))]));
  }
  const cm = await porteesDe(base, acteur);
  return { tout: false, compte: acteur.compte, club, parTeam, cmClub: cm.club, cmTeams: cm.teams };
}

/** Le lecteur voit-il un élément de clé d'accès `acces` (team de l'élément : `teamId`) ? */
export function voit(droits, acces, teamId) {
  if (!acces || acces === 'aucun') return false;
  if (droits.tout) return true;
  if (acces === 'tous') return true;
  if (acces === 'fondateur') return false;
  const [portee, liste = ''] = acces.split(':');
  const perms = liste.split('|').filter(Boolean);
  const une = s => Boolean(s) && perms.some(p => s.has(p));
  if (portee === 'team') return Boolean(teamId) && une(droits.parTeam.get(teamId));
  if (portee === 'club') return une(droits.club);
  if (portee === 'cm') return teamId ? une(droits.cmTeams.get(teamId)) : une(droits.cmClub);
  return false;
}

/** Teams dont le lecteur est membre actif (ou toutes : Fondateur, accès total) ; `null` = toutes. */
export function teamsDuLecteur(droits) {
  return droits.tout ? null : new Set(droits.parTeam.keys());
}

/** Le lecteur a-t-il un accès quelconque à la section CM (club ou une team) ? */
export function aCm(droits) {
  return droits.tout || droits.cmClub.size > 0 || [...droits.cmTeams.values()].some(s => s.size > 0);
}
