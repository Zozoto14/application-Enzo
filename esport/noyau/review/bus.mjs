/**
 * Événements de domaine de la review vidéo et du scouting (phase 5), et leur
 * abonné « notifications in-app ». Le journal d'activité reçoit déjà tout
 * événement (abonneJournal) ; Discord (phase 4) s'abonne à `review.created`
 * (« review créée ») sans que la review ne l'appelle jamais.
 *
 * Charge de `review.created` : `{ titre, videoId, url, reference, adversaireId, depuisVod }`.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_REVIEW = [
  'review.created',
  'review.updated',
  'review.deleted',
  'review.marker_added',
  'review.marker_updated',
  'review.marker_deleted',
  'review.comment_added',
  'review.comment_deleted',
  'opponent.created',
  'opponent.updated',
  'opponent.deleted',
  'opponent.detail_changed',
];

async function notifier(base, ev, compte, type, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le],
  );
}

/** Membres actifs d'une team qui peuvent voir la review (Propriétaires compris). */
async function lecteursReview(base, teamId) {
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = 'video_review.view'
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [teamId],
  );
  return lignes.map(l => l.compte);
}

export async function abonneReview(base, ev) {
  if (!TYPES_REVIEW.includes(ev.type)) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  if (ev.type === 'review.created') {
    for (const compte of await lecteursReview(base, ev.team_id)) {
      if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'review-nouvelle', { reviewId: ev.entite_id, titre: charge.titre ?? null });
    }
    return;
  }
  if (ev.type === 'review.comment_added' && typeof charge.auteurRepere === 'string' && charge.auteurRepere !== ev.acteur_id) {
    await notifier(base, ev, charge.auteurRepere, 'review-commentaire', { reviewId: charge.reviewId ?? null, repere: charge.repereTitre ?? null, titre: charge.titre ?? null });
  }
}
