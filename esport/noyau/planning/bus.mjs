/**
 * Événements de domaine du planning, des disponibilités et de la présence,
 * et leur abonné « notifications in-app ». Le journal d'activité reçoit déjà
 * tout événement (abonneJournal) ; Discord (phase 4) s'abonnera aux mêmes
 * événements (`event.created`, `attendance.reminder`…), sans que le planning
 * ne l'appelle jamais.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_PLANNING = [
  'event.created',
  'event.updated',
  'event.deleted',
  'event.occurrence_updated',
  'event.occurrence_cancelled',
  'attendance.rsvp',
  'attendance.marked',
  'attendance.reminder',
  'availability.updated',
  'availability.settings_changed',
  'ical.token_created',
  'ical.token_revoked',
];

async function notifier(base, ev, compte, type, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le],
  );
}

/**
 * Destinataires d'une notification d'événement : les CONVOQUÉS (`convoques`,
 * résolus à l'écriture) qui voient le planning. Ancien format (`concernes`,
 * liste vide = toute la team) : gardé pour les événements de l'outbox d'avant.
 */
async function concernes(base, teamId, liste, convoques) {
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = 'planning.view'
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [teamId],
  );
  const tous = lignes.map(l => l.compte);
  if (Array.isArray(convoques)) return tous.filter(c => convoques.includes(c));
  return Array.isArray(liste) && liste.length > 0 ? tous.filter(c => liste.includes(c)) : tous;
}

const NOTIFS = {
  'event.created': 'evenement-nouveau',
  'event.updated': 'evenement-modifie',
  'event.occurrence_updated': 'evenement-modifie',
  'event.deleted': 'evenement-annule',
  'event.occurrence_cancelled': 'evenement-annule',
};

export async function abonnePlanning(base, ev) {
  if (!TYPES_PLANNING.includes(ev.type)) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  if (ev.type === 'attendance.reminder') {
    if (typeof charge.compte === 'string') {
      await notifier(base, ev, charge.compte, 'rappel-rsvp', { evenementId: charge.evenementId, occurrence: charge.occurrence, titre: charge.titre, debut: charge.debut, type: charge.type });
    }
    return;
  }
  const type = NOTIFS[ev.type];
  if (!type) return;
  for (const compte of await concernes(base, ev.team_id, charge.concernes, charge.convoques)) {
    if (compte === ev.acteur_id) continue;
    await notifier(base, ev, compte, type, { evenementId: ev.entite_id, titre: charge.titre ?? null, debut: charge.debut ?? null, type: charge.type ?? null, occurrence: charge.occurrence ?? null });
  }
}
