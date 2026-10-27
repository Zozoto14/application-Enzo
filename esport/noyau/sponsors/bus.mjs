/**
 * Événements de la rubrique Sponsors et leur abonné « notifications in-app ». Le journal reçoit tout événement
 * (abonneJournal) : actions `sponsors.*`, SANS team (jamais dans le journal d'une team), lues seulement par
 * `GET /sponsors/journal` (sponsors.gerer). Les charges ne portent que des noms d'entreprises.
 *
 * Notifications (types `sp-*`, aussi dans le récapitulatif e-mail) : rappel de prochaine action, contrepartie
 * à faire avant l'échéance, contrat qui arrive à sa fin, fiche confiée (responsable). Destinataires : le
 * responsable s'il voit encore la rubrique, sinon les gestionnaires (sponsors.gerer) ; jamais un compte qui a
 * perdu le droit de voir la rubrique.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { comptesSponsors } from './commun.mjs';

export const TYPES_SPONSORS = [
  'sponsors.etapes_modifiees',
  'sponsors.prospect_cree',
  'sponsors.prospect_modifie',
  'sponsors.prospect_deplace',
  'sponsors.prospect_supprime',
  'sponsors.prospect_converti',
  'sponsors.partenaire_cree',
  'sponsors.partenaire_modifie',
  'sponsors.partenaire_supprime',
  'sponsors.contrat_enregistre',
  'sponsors.contrat_supprime',
  'sponsors.obligation_enregistree',
  'sponsors.obligation_suivie',
  'sponsors.obligation_supprimee',
  'sponsors.responsable',
  'sponsors.import',
  'sponsors.export',
  'sponsors.rgpd_contact',
  'sponsors.rappel_action',
  'sponsors.rappel_obligation',
  'sponsors.rappel_contrat',
];

/** Types de notifications de la rubrique (récapitulatif e-mail : recap.mjs). */
export const NOTIFICATIONS_SPONSORS = ['sp-action', 'sp-obligation', 'sp-contrat', 'sp-responsable'];

async function notifier(base, ev, compte, type, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, type, JSON.stringify(charge), ev.cree_le],
  );
}

export async function abonneSponsors(base, ev) {
  if (!TYPES_SPONSORS.includes(ev.type)) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  const lecteurs = await comptesSponsors(base, 'sponsors.voir');
  const destinataires = async responsable => (responsable && lecteurs.has(responsable) ? [responsable] : [...(await comptesSponsors(base, 'sponsors.gerer'))]);
  const envoyer = async (comptes, type, donnees) => {
    for (const compte of new Set(comptes)) if (compte && compte !== ev.acteur_id && lecteurs.has(compte)) await notifier(base, ev, compte, type, donnees);
  };
  switch (ev.type) {
    case 'sponsors.rappel_action':
      return envoyer(await destinataires(charge.responsable), 'sp-action', { titre: charge.titre ?? null, action: charge.action ?? '', quand: charge.quand ?? null, prospect: ev.entite_id });
    case 'sponsors.rappel_obligation':
      return envoyer(await destinataires(charge.responsable), 'sp-obligation', { titre: charge.titre ?? null, intitule: charge.intitule ?? '', periode: charge.periode ?? null, fin: charge.fin ?? null, fait: charge.fait ?? 0, quantite: charge.quantite ?? 1, partenaire: charge.partenaire ?? null });
    case 'sponsors.rappel_contrat':
      return envoyer(await destinataires(charge.responsable), 'sp-contrat', { titre: charge.titre ?? null, fin: charge.fin ?? null, renouvellement: charge.renouvellement ?? null, partenaire: charge.partenaire ?? null });
    case 'sponsors.responsable':
      return envoyer([charge.compte], 'sp-responsable', { titre: charge.titre ?? null, genre: charge.genre ?? null, id: ev.entite_id, membre: ev.acteur_id });
    default:
      return;
  }
}
