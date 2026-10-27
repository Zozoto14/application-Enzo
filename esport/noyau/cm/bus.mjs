/**
 * Événements de domaine de la section CM et leur abonné « notifications in-app ». Le journal reçoit déjà
 * tout événement (abonneJournal : actions `cm.*`, module « CM » des filtres du journal de la team pour une
 * portée de team ; journal de la section pour le club). Pas de Discord à cette étape : `cm.post_publie`
 * porte déjà de quoi annoncer un post publié (réseaux, adresses, liens) pour la prochaine étape.
 *
 * Notifications : membres assignés à une carte, personnes @mentionnées dans un commentaire, valideurs
 * (post soumis, ou repassé « à valider » après une modification), auteur du post (validé, refusé), CM
 * (dépôt d'une team, clip proposé), proposeur d'un clip (décision), compte affecté à un rôle CM.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { comptesClubAvec, comptesTeamAvec } from './commun.mjs';

export const TYPES_CM = [
  'cm.tableau_cree',
  'cm.tableau_modifie',
  'cm.tableau_supprime',
  'cm.carte_creee',
  'cm.carte_assignee',
  'cm.carte_supprimee',
  'cm.commentaire_ajoute',
  'cm.depot',
  'cm.post_soumis',
  'cm.post_valide',
  'cm.post_refuse',
  'cm.post_invalide',
  'cm.post_publie',
  'cm.clip_propose',
  'cm.clip_decide',
  'cm.import_trello',
  'cm.role_cree',
  'cm.role_modifie',
  'cm.role_supprime',
  'cm.affectation_ajoutee',
  'cm.affectation_retiree',
  'cm.reglages_modifies',
];

async function notifier(base, ev, compte, type, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le],
  );
}

/** Valideurs d'un tableau : niveau club, ou club + affectations de la team pour un tableau de team. */
const valideurs = (base, ev, charge) => (charge.portee && charge.portee !== 'club' ? comptesTeamAvec(base, charge.portee, 'cm.valider') : comptesClubAvec(base, 'cm.valider'));

export async function abonneCm(base, ev) {
  if (!TYPES_CM.includes(ev.type)) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  const carte = ev.entite_id;
  const envoyer = async (comptes, type, donnees) => {
    for (const compte of new Set(comptes)) if (compte && compte !== ev.acteur_id) await notifier(base, ev, compte, type, donnees);
  };
  switch (ev.type) {
    case 'cm.carte_assignee':
      return envoyer(charge.comptes ?? [], 'cm-assigne', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, membre: ev.acteur_id });
    case 'cm.commentaire_ajoute':
      return envoyer(charge.mentions ?? [], 'cm-mention', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, membre: ev.acteur_id });
    case 'cm.post_soumis':
    case 'cm.post_invalide':
      return envoyer([...(await valideurs(base, ev, charge))], 'cm-a-valider', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, invalide: ev.type === 'cm.post_invalide', membre: ev.acteur_id });
    case 'cm.post_valide':
    case 'cm.post_refuse': {
      const membres = (await base.tous('SELECT compte_id FROM cm_carte_membres WHERE carte_id = ?', [carte])).map(l => l.compte_id);
      return envoyer([charge.soumisPar, ...membres], ev.type === 'cm.post_valide' ? 'cm-valide' : 'cm-refuse', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, motif: charge.motif ?? null, membre: ev.acteur_id });
    }
    case 'cm.depot':
      return envoyer([...(await comptesClubAvec(base, 'cm.editer'))], 'cm-depot', { titre: charge.titre ?? null, genre: charge.genre ?? null, carte, tableau: charge.tableau ?? null, membre: ev.acteur_id });
    case 'cm.clip_propose':
      if (!ev.team_id) return;
      return envoyer([...(await comptesTeamAvec(base, ev.team_id, 'cm.editer'))], 'cm-clip-propose', { titre: charge.titre ?? null, clip: ev.entite_id, membre: ev.acteur_id });
    case 'cm.clip_decide':
      return envoyer([charge.proposePar], 'cm-clip-decide', { titre: charge.titre ?? null, statut: charge.statut ?? null, motif: charge.motif ?? null, clip: ev.entite_id });
    case 'cm.affectation_ajoutee':
      return envoyer([charge.compte], 'cm-affecte', { role: charge.role ?? null, portee: charge.portee ?? null });
    default:
      return;
  }
}
