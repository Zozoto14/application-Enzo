/**
 * Événements de domaine du module « Ressources » et leur abonné « notifications in-app ». Le journal
 * reçoit déjà tout événement (abonneJournal) ; Discord s'abonne à `resource.created` et
 * `resource.validated` (discord/catalogue.mjs, « Nouvelle ressource », désactivé par défaut), jamais
 * pour une ressource réservée au staff.
 *
 * Notifications : une proposition d'un joueur prévient ceux qui la valident (resources.manage) ; la
 * validation ou le refus prévient le joueur ; un commentaire prévient l'auteur de la ressource. Une
 * ressource publiée ne notifie personne (le compteur « nouveau depuis ma dernière visite » suffit).
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_RESSOURCES = [
  'resource.created',
  'resource.proposed',
  'resource.validated',
  'resource.refused',
  'resource.updated',
  'resource.pinned',
  'resource.deleted',
  'resource.commented',
  'resource.comment_deleted',
  'resource.reaction_changed',
  'resource_category.created',
  'resource_category.updated',
  'resource_category.deleted',
  'resource_category.reordered',
  'resources.settings_changed',
];

async function notifier(base, ev, compte, type, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le],
  );
}

/** Membres actifs qui valident les propositions (resources.manage ; Propriétaires compris). */
async function valideurs(base, teamId) {
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = 'resources.manage'
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [teamId],
  );
  return lignes.map(l => l.compte);
}

export async function abonneRessources(base, ev) {
  if (!TYPES_RESSOURCES.includes(ev.type) || !ev.team_id) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  const module = await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'resources'", [ev.team_id]);
  if (!module || Number(module.active) !== 1) return;
  const titre = charge.titre ?? null;
  if (ev.type === 'resource.proposed') {
    for (const compte of await valideurs(base, ev.team_id)) {
      if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'ressource-proposee', { ressource: ev.entite_id, titre });
    }
    return;
  }
  if ((ev.type === 'resource.validated' || ev.type === 'resource.refused') && typeof charge.auteur === 'string' && charge.auteur !== ev.acteur_id) {
    await notifier(base, ev, charge.auteur, ev.type === 'resource.validated' ? 'ressource-validee' : 'ressource-refusee', { ressource: ev.entite_id, titre, motif: charge.motif ?? null });
    return;
  }
  if (ev.type === 'resource.commented' && typeof charge.auteur === 'string' && charge.auteur !== ev.acteur_id) {
    // L'auteur ne doit plus voir la ressource (staff seulement, retiré…) : pas de notification.
    const r = await base.premier('SELECT visibilite, supprime_le FROM ressources WHERE id = ? AND team_id = ?', [ev.entite_id, ev.team_id]);
    if (!r || r.supprime_le) return;
    if (!(await base.premier("SELECT id FROM membres WHERE team_id = ? AND compte_id = ? AND statut = 'actif'", [ev.team_id, charge.auteur]))) return;
    await notifier(base, ev, charge.auteur, 'ressource-commentaire', { ressource: ev.entite_id, titre, membre: ev.acteur_id });
  }
}
