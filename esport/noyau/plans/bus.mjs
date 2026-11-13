/**
 * Événements de domaine des plans de match (migration 0083) et leur abonné « notifications in-app ». Leur charge ne
 * porte que le titre, l'adversaire et la date : rien de tactique. L'annonce Discord facultative « plan prêt »
 * (discord/catalogue.mjs, désactivée par défaut) n'utilise que l'adversaire et la date.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_PLANS = ['plan_match.created', 'plan_match.updated', 'plan_match.ready', 'plan_match.played', 'plan_match.deleted', 'plan_match.restored'];

/** Plan PRÊT : chaque membre actif qui peut lire les plans est prévenu (jamais l'auteur de l'action). */
export async function abonnePlans(base, ev) {
  if (ev.type !== 'plan_match.ready' || !ev.team_id) return;
  const module = await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'plans_match'", [ev.team_id]);
  if (!module || Number(module.active) !== 1) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}') ?? {};
  } catch {
    charge = {};
  }
  const lecteurs = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = 'plans.voir'
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [ev.team_id],
  );
  const corps = JSON.stringify({ plan: ev.entite_id, titre: charge.titre ?? null, adversaire: charge.adversaire ?? null, date: charge.date ?? null });
  for (const { compte } of lecteurs) {
    if (compte === ev.acteur_id) continue;
    await base.executer('INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [`${ev.id}:${compte}`, compte, ev.team_id, 'plan-pret', corps, ev.cree_le]);
  }
}
