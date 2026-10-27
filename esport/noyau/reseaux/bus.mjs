/**
 * Événements de la page « Réseaux » (espace CM) et leurs abonnés : annonces Discord des posts publiés
 * (annonces.mjs) et notification « relevez les statistiques » (rappels J+1 / J+7, rappels.mjs).
 *
 * Les événements `cm.reseau_*` sont SANS team : ils vont dans le journal de la section CM (club, `cm.gerer`),
 * jamais dans celui d'une team. Leurs charges ne portent ni adresse de webhook ni donnée personnelle.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { comptesClubAvec, comptesTeamAvec } from '../cm/commun.mjs';
import { abonneAnnonces } from './annonces.mjs';

export const TYPES_RESEAUX = [
  'cm.reseau_compte_cree',
  'cm.reseau_compte_modifie',
  'cm.reseau_compte_supprime',
  'cm.reseau_annonce_modifiee',
  'cm.reseau_salon_ajoute',
  'cm.reseau_salon_modifie',
  'cm.reseau_salon_supprime',
  'cm.reseau_publication_ajoutee',
  'cm.reseau_publication_modifiee',
  'cm.reseau_publication_supprimee',
  'cm.reseau_releve',
  'cm.reseau_import',
  'cm.reseau_export',
  'cm.reseau_reglages',
  'cm.reseau_rappel_releve',
];

/** Notification « relevez les statistiques » (aussi dans le récapitulatif e-mail). */
export const NOTIFICATION_RELEVE = 'cm-releve';

async function notifier(base, ev, compte, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, NOTIFICATION_RELEVE, JSON.stringify(charge), ev.cree_le],
  );
}

export async function abonneReseaux(base, ev) {
  await abonneAnnonces(base, ev);
  if (ev.type !== 'cm.reseau_rappel_releve') return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  // Destinataire : qui a publié le post, s'il peut encore saisir des statistiques ; sinon les éditeurs CM.
  const editeurs = charge.team ? await comptesTeamAvec(base, charge.team, 'cm.editer') : await comptesClubAvec(base, 'cm.editer');
  const pour = charge.pour && editeurs.has(charge.pour) ? [charge.pour] : [...editeurs];
  for (const compte of new Set(pour)) {
    await notifier(base, ev, compte, { titre: charge.titre ?? null, reseau: charge.reseau ?? null, j: charge.j ?? null, publication: ev.entite_id });
  }
}
