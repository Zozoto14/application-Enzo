/**
 * Événements de domaine des strats et du playbook (phase 6), et leur abonné
 * « notifications in-app ». Le journal d'activité reçoit déjà tout événement
 * (abonneJournal) ; Discord s'abonne à
 * `playbook.validated` (discord/catalogue.mjs, désactivés par défaut).
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_STRATS = [
  'strat.created',
  'strat.updated',
  'strat.duplicated',
  'strat.deleted',
  'strat.restored',
  'strat.share_created',
  'strat.share_revoked',
  'playbook.created',
  'playbook.updated',
  'playbook.validated',
  'playbook.archived',
  'playbook.deleted',
  'playbook.restored',
];

/** Membres actifs qui lisent le playbook (Propriétaires compris). */
async function lecteursPlaybook(base, teamId) {
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = 'playbook.view'
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [teamId],
  );
  return lignes.map(l => l.compte);
}

/** Une entrée validée du playbook : prévenir la team (sauf l'auteur de la validation). */
export async function abonneStrats(base, ev) {
  if (ev.type !== 'playbook.validated' || !ev.team_id) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  const module = await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'playbook'", [ev.team_id]);
  if (!module || Number(module.active) !== 1) return;
  for (const compte of await lecteursPlaybook(base, ev.team_id)) {
    if (compte === ev.acteur_id) continue;
    await base.executer(
      'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      [`${ev.id}:${compte}`, compte, ev.team_id, 'playbook-valide', JSON.stringify({ entree: ev.entite_id, titre: charge.titre ?? null, carte: charge.carte ?? null }), ev.cree_le],
    );
  }
}
