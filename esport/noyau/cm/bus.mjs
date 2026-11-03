/**
 * Événements de domaine de la section CM et leur abonné « notifications in-app ». Le journal reçoit déjà
 * tout événement (abonneJournal : actions `cm.*`, module « CM » des filtres du journal de la team pour une
 * portée de team ; journal de la section pour le club). `cm.post_publie` et `cm.post_adresses` sont consommés
 * par la page Réseaux (reseaux/annonces.mjs : annonce Discord, publications suivies pour les statistiques).
 *
 * Notifications : membres assignés à une carte, personnes @mentionnées dans un commentaire, valideurs
 * (post soumis, ou repassé « à valider » après une modification), auteur du post (validé, refusé), CM
 * (dépôt d'une team, clip proposé), proposeur d'un clip (décision), compte affecté à un rôle CM, gestionnaires
 * du Drive (espace utilisé à 80 %). Réunions de l'équipe CM : invités (créée, modifiée, annulée), organisateur
 * (réponse, rendez-vous réservé), participants (rappel) ; rappel et annulation partent aussi en MP Discord du bot
 * (file `cm_reunion_mp`, reunions/rappels.mjs). Le centre de notifications consomme ces événements tels quels.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { comptesClubAvec, comptesTeamAvec } from './commun.mjs';
import { mettreMpEnFile } from './reunions/mp.mjs';

export const TYPES_CM = [
  'cm.tableau_cree',
  'cm.tableau_modifie',
  'cm.tableau_supprime',
  'cm.etiquette_modifiee',
  'cm.etiquette_supprimee',
  'cm.etiquette_fusionnee',
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
  // Adresse ajoutée ou changée sur un post déjà publié (migration 0026 : l'annonce Discord est rééditée).
  'cm.post_adresses',
  'cm.clip_propose',
  'cm.clip_decide',
  'cm.import_trello',
  'cm.role_cree',
  'cm.role_modifie',
  'cm.role_supprime',
  'cm.affectation_ajoutee',
  'cm.affectation_retiree',
  'cm.reglages_modifies',
  'cm.charte_modifiee',
  'cm.modele_cree',
  'cm.modele_modifie',
  'cm.modele_supprime',
  'cm.visuel_genere',
  // Drive (migration 0027).
  'cm.drive_fichier_ajoute',
  'cm.drive_fichier_modifie',
  'cm.drive_version_ajoutee',
  'cm.drive_dossier_cree',
  'cm.drive_dossier_modifie',
  'cm.drive_corbeille',
  'cm.drive_restaure',
  'cm.drive_supprime',
  'cm.drive_corbeille_videe',
  'cm.drive_quota',
  // Étiquettes (tags) des fichiers du Drive : renommées ou supprimées d'un coup pour toute la portée.
  'cm.drive_tag_renomme',
  'cm.drive_tag_supprime',
  // Réunions de l'équipe CM (migration 0039, docs/esport/cm-reunions.md) : SANS team, JAMAIS de notes dans la charge.
  'cm.reunion_creee',
  'cm.reunion_modifiee',
  'cm.reunion_annulee',
  'cm.reunion_reponse',
  'cm.reunion_rappel',
  'cm.rdv_reserve',
  // Ajout dans le Drive (migration 0038), pour le centre de notifications : un fichier ou un dossier ajouté, une
  // nouvelle version. Charge : { portee, dossierId, element: 'fichier' | 'dossier', genre: 'ajout' | 'copie' |
  // 'version' | 'rangement', nom, version }. Le destinataire doit VOIR l'élément : drive.destinatairesAjout(ev)
  // (service du Drive) donne les comptes concernés, l'auteur exclu. Hors du journal (cm.drive_* y est déjà).
  'drive.ajout',
];

/** Événements du bus qui ne vont pas au journal d'activité (signaux pour d'autres abonnés, déjà journalisés). */
export const TYPES_HORS_JOURNAL = ['drive.ajout'];

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
    case 'cm.reunion_creee':
      return envoyer(charge.participants ?? [], 'cm-reunion-invite', { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id, genre: charge.genre ?? 'reunion' });
    case 'cm.reunion_modifiee':
      return envoyer(charge.participants ?? [], 'cm-reunion-modifiee', { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id, changements: charge.changements ?? [] });
    case 'cm.reunion_annulee': {
      const donnees = { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.occurrence ?? charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id, motif: charge.motif ?? null, serie: charge.serie !== false };
      await envoyer(charge.participants ?? [], 'cm-reunion-annulee', donnees);
      return mettreMpEnFile(base, ev, (charge.participants ?? []).filter(c => c && c !== ev.acteur_id), 'annulee', charge.occurrence ?? null);
    }
    case 'cm.reunion_reponse':
      return envoyer([charge.organisateur], 'cm-reunion-reponse', { titre: charge.titre ?? null, reunion: ev.entite_id, reponse: charge.reponse ?? null, membre: ev.acteur_id, proposition: charge.proposition ?? null });
    case 'cm.rdv_reserve':
      return envoyer([charge.proprietaire], 'cm-rdv-reserve', { titre: charge.titre ?? null, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id });
    case 'cm.reunion_rappel': {
      if (!charge.compte) return;
      await notifier(base, ev, charge.compte, 'cm-reunion-rappel', { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, minutes: charge.minutes ?? null });
      return mettreMpEnFile(base, ev, [charge.compte], 'rappel', charge.occurrence ?? null);
    }
    case 'cm.drive_quota':
      // Drive plein à 80 % (au plus une fois par semaine) : ceux qui gèrent le Drive du club.
      return envoyer([...(await comptesClubAvec(base, 'cm.drive.gerer'))], 'cm-drive-quota', { pourcent: charge.pourcent ?? null, utilise: charge.utilise ?? null, limite: charge.limite ?? null });
    default:
      return;
  }
}
