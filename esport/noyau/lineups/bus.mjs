/**
 * Événements de domaine des lineups (migration 0082) et leur abonné « notifications in-app ». Le journal d'activité
 * reçoit déjà tout événement (abonneJournal). AUCUN message Discord : un lineup est un contenu tactique
 * (discord/catalogue.mjs n'a volontairement aucun type pour `lineup.*`).
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_LINEUPS = ['lineup.created', 'lineup.updated', 'lineup.validated', 'lineup.deleted', 'lineup.restored', 'lineup.linked', 'lineup.unlinked'];

/** Membres actifs qui gèrent les lineups (Propriétaires compris). */
async function gestionnaires(base, teamId) {
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = 'lineups.gerer'
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [teamId],
  );
  return lignes.map(l => l.compte);
}

const notifier = (base, ev, compte, type, charge) =>
  base.executer('INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le]);

/**
 * Lineup PROPOSÉ par un joueur : ceux qui valident sont prévenus. Lineup VALIDÉ : son auteur est prévenu.
 * (Jamais l'auteur de l'action lui-même.)
 */
export async function abonneLineups(base, ev) {
  if ((ev.type !== 'lineup.created' && ev.type !== 'lineup.validated') || !ev.team_id) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}') ?? {};
  } catch {
    charge = {};
  }
  const module = await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'lineups'", [ev.team_id]);
  if (!module || Number(module.active) !== 1) return;
  const corps = { lineup: ev.entite_id, titre: charge.titre ?? null, carte: charge.carte ?? null };
  if (ev.type === 'lineup.created') {
    if (charge.statut !== 'propose') return;
    for (const compte of await gestionnaires(base, ev.team_id)) {
      if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'lineup-propose', { ...corps, membre: ev.acteur_id });
    }
    return;
  }
  if (typeof charge.auteur === 'string' && charge.auteur && charge.auteur !== ev.acteur_id) {
    // L'auteur a pu quitter la team entre-temps : rien ne lui est écrit.
    const membre = await base.premier("SELECT id FROM membres WHERE team_id = ? AND compte_id = ? AND statut = 'actif'", [ev.team_id, charge.auteur]);
    if (membre) await notifier(base, ev, charge.auteur, 'lineup-valide', corps);
  }
}
