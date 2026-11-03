/**
 * Phrases du journal et des notifications de la section CM (actions `cm.*`, notifications `cm-*`).
 * Pur, testé.
 */

import { langueCourante, tr } from '../i18n';
import { traduireServeur } from '../i18n/erreurs';
import { trCm } from '../i18n/cm';
import { trDr } from '../i18n/drive';
import { trRe, type CleRe } from '../i18n/reunions';
import { trLi } from '../i18n/liens';
import { formaterDate } from '../i18n';
import { tailleMedia } from '../medias/envoi';

const texte = (v: unknown, secours = '?'): string => (typeof v === 'string' && v ? v : secours);

/** Phrase d'une entrée du journal de la section CM (ou undefined si l'action n'est pas du CM). */
export function phraseJournalCm(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  const titre = texte(m.titre);
  switch (action) {
    case 'cm.tableau_cree':
      return tr('cm.jr.tableau_cree', { qui, nom: texte(m.nom) });
    case 'cm.tableau_modifie':
      return tr('cm.jr.tableau_modifie', { qui });
    case 'cm.tableau_supprime':
      return tr('cm.jr.tableau_supprime', { qui });
    case 'cm.etiquette_modifiee':
      return tr('cm.jr.etiquette_modifiee', { qui, nom: texte(m.nom) });
    case 'cm.etiquette_supprimee':
      return tr('cm.jr.etiquette_supprimee', { qui, nom: texte(m.nom), n: typeof m.cartes === 'number' ? m.cartes : 0 });
    case 'cm.etiquette_fusionnee':
      return tr('cm.jr.etiquette_fusionnee', { qui, nom: texte(m.nom), vers: texte(m.vers), n: typeof m.cartes === 'number' ? m.cartes : 0 });
    case 'cm.carte_creee':
      return tr('cm.jr.carte_creee', { qui, titre });
    case 'cm.carte_assignee':
      return tr('cm.jr.carte_assignee', { qui, titre });
    case 'cm.carte_supprimee':
      return tr('cm.jr.carte_supprimee', { qui, titre });
    case 'cm.carte_urgence':
      return tr('cm.jr.carte_urgence', { qui, titre, niveau: m.niveau === 'faible' || m.niveau === 'moyen' || m.niveau === 'urgent' || m.niveau === 'critique' ? trCm(`urgence.${m.niveau}`) : '?' });
    case 'cm.commentaire_ajoute':
      return tr('cm.jr.commentaire_ajoute', { qui, titre });
    case 'cm.depot':
      return tr('cm.jr.depot', { qui, titre });
    case 'cm.post_soumis':
      return tr('cm.jr.post_soumis', { qui, titre });
    case 'cm.post_valide':
      return tr('cm.jr.post_valide', { qui, titre });
    case 'cm.post_refuse':
      return tr('cm.jr.post_refuse', { qui, titre });
    case 'cm.post_invalide':
      return tr('cm.jr.post_invalide', { titre });
    case 'cm.post_publie':
      return tr('cm.jr.post_publie', { qui, titre });
    case 'cm.post_adresses':
      return tr('cm.jr.post_adresses', { qui, titre });
    // Page Réseaux (migration 0026).
    case 'cm.reseau_compte_cree':
    case 'cm.reseau_compte_modifie':
    case 'cm.reseau_compte_supprime':
      return tr('cm.jr.reseau_compte', { qui, compte: texte(m.identifiant) });
    case 'cm.reseau_annonce_modifiee':
      return tr('cm.jr.reseau_annonce', { qui, compte: texte(m.identifiant) });
    case 'cm.reseau_salon_ajoute':
    case 'cm.reseau_salon_modifie':
    case 'cm.reseau_salon_supprime':
      return tr('cm.jr.reseau_salon', { qui, nom: texte(m.nom) });
    case 'cm.reseau_publication_ajoutee':
    case 'cm.reseau_publication_modifiee':
    case 'cm.reseau_publication_supprimee':
      return tr('cm.jr.reseau_publication', { qui, titre });
    case 'cm.reseau_releve':
      return tr('cm.jr.reseau_releve', { qui });
    case 'cm.reseau_import':
      return tr('cm.jr.reseau_import', { qui });
    case 'cm.reseau_export':
      return tr('cm.jr.reseau_export', { qui });
    case 'cm.reseau_reglages':
      return tr('cm.jr.reseau_reglages', { qui });
    case 'cm.reseau_rappel_releve':
      return tr('cm.jr.reseau_rappel', { titre });
    case 'cm.annonce_abandonnee':
      return tr('cm.jr.annonce_abandonnee', { reseau: texte(m.reseau), motif: traduireServeur(texte(m.motif)) });
    case 'cm.annonce_fil_impossible':
      return tr('cm.jr.annonce_fil', { reseau: texte(m.reseau), motif: traduireServeur(texte(m.motif)) });
    case 'cm.clip_propose':
      return tr('cm.jr.clip_propose', { qui, titre });
    case 'cm.clip_decide':
      return tr('cm.jr.clip_decide', { qui, titre });
    case 'cm.import_trello':
      return tr('cm.jr.import_trello', { qui, nom: texte(m.nom) });
    case 'cm.role_cree':
    case 'cm.role_modifie':
    case 'cm.role_supprime':
      return tr('cm.jr.role', { qui });
    case 'cm.affectation_ajoutee':
    case 'cm.affectation_retiree':
      return tr('cm.jr.affectation', { qui });
    case 'cm.reglages_modifies':
      return tr('cm.jr.reglages', { qui });
    // Drive (migration 0027).
    case 'cm.drive_fichier_ajoute':
      return trDr('jr.ajoute', { qui, nom: texte(m.nom) });
    case 'cm.drive_fichier_modifie':
      return trDr('jr.modifie', { qui, nom: texte(m.nom) });
    case 'cm.drive_version_ajoutee':
      return trDr('jr.version', { qui, nom: texte(m.nom), v: typeof m.version === 'number' ? m.version : '?' });
    case 'cm.drive_dossier_cree':
      return trDr('jr.dossier_cree', { qui, nom: texte(m.nom) });
    case 'cm.drive_dossier_modifie':
      return trDr('jr.dossier_modifie', { qui, nom: texte(m.nom) });
    case 'cm.drive_corbeille':
      return trDr('jr.corbeille', { qui, nom: texte(m.nom) });
    case 'cm.drive_restaure':
      return trDr('jr.restaure', { qui, nom: texte(m.nom) });
    case 'cm.drive_supprime':
      return trDr('jr.supprime', { qui, nom: texte(m.nom) });
    case 'cm.drive_corbeille_videe':
      return trDr('jr.corbeille_videe', { qui });
    case 'cm.drive_tag_renomme':
      return trDr('jr.tag_renomme', { qui, tag: texte(m.tag), nom: texte(m.nom), n: typeof m.fichiers === 'number' ? m.fichiers : 0 });
    case 'cm.drive_tag_supprime':
      return trDr('jr.tag_supprime', { qui, tag: texte(m.tag), n: typeof m.fichiers === 'number' ? m.fichiers : 0 });
    case 'cm.drive_quota':
      return trDr('jr.quota', { p: typeof m.pourcent === 'number' ? m.pourcent : '?' });
    // Liens utiles de DATA › Ressources (migration 0044).
    case 'cm.lien_cree':
      return trLi('jr.cree', { qui, titre });
    case 'cm.lien_modifie':
      return trLi('jr.modifie', { qui, titre });
    case 'cm.lien_supprime':
      return trLi('jr.supprime', { qui, titre });
    case 'cm.lien_lie':
      return trLi('jr.lie', { qui, titre });
    case 'cm.lien_delie':
      return trLi('jr.delie', { qui, titre });
    // Réunions de l'équipe CM (migration 0039).
    case 'cm.reunion_creee':
      return trRe('jr.creee', { qui, titre });
    case 'cm.reunion_modifiee':
      return trRe('jr.modifiee', { qui, titre });
    case 'cm.reunion_annulee':
      return trRe('jr.annulee', { qui, titre });
    case 'cm.reunion_reponse':
      return trRe('jr.reponse', { qui, titre });
    case 'cm.reunion_rappel':
      return trRe('jr.rappel', { titre });
    case 'cm.rdv_reserve':
      return trRe('jr.rdv', { qui, titre });
    default:
      return undefined;
  }
}

/** Phrase d'une notification de la section CM (ou undefined). `nom(id)` : pseudo d'un compte. */
export function phraseNotificationCm(type: string, team: string, c: Record<string, unknown>, nom: (id: unknown) => string): string | undefined {
  const titre = texte(c.titre);
  const motif = typeof c.motif === 'string' && c.motif ? tr('cm.nt.motif', { motif: c.motif }) : '';
  switch (type) {
    case 'cm-assigne':
      return tr('cm.nt.assigne', { membre: nom(c.membre), titre });
    case 'cm-mention':
      return tr('cm.nt.mention', { membre: nom(c.membre), titre });
    case 'cm-urgence':
      return tr(c.niveau === 'critique' ? 'cm.nt.urgence_critique' : 'cm.nt.urgence_urgent', { membre: nom(c.membre), titre });
    case 'cm-commentaire':
      return tr('cm.nt.commentaire', { membre: nom(c.membre), titre });
    case 'cm-a-valider':
      return tr(c.invalide ? 'cm.nt.a_revalider' : 'cm.nt.a_valider', { titre });
    case 'cm-valide':
      return tr('cm.nt.valide', { titre });
    case 'cm-refuse':
      return tr('cm.nt.refuse', { titre, motif });
    case 'cm-depot':
      return tr('cm.nt.depot', { membre: nom(c.membre), team, titre });
    case 'cm-clip-propose':
      return tr('cm.nt.clip_propose', { membre: nom(c.membre), team, titre });
    case 'cm-clip-decide':
      return c.statut === 'retenu'
        ? tr('cm.nt.clip_retenu', { titre })
        : c.statut === 'utilise'
          ? tr('cm.nt.clip_utilise', { titre })
          : c.statut === 'refuse'
            ? tr('cm.nt.clip_refuse', { titre, motif })
            : tr('cm.nt.clip_propose_retour', { titre });
    case 'cm-affecte':
      return tr('cm.nt.affecte', { role: texte(c.role) });
    case 'cm-drive-quota': {
      const octets = (v: unknown) => tailleMedia(typeof v === 'number' ? v : 0, langueCourante());
      return trDr('nt.quota', { p: typeof c.pourcent === 'number' ? c.pourcent : '?', u: octets(c.utilise), l: octets(c.limite) });
    }
    // Réunions de l'équipe CM (migration 0039) : l'heure dans le fuseau de la réunion.
    case 'cm-reunion-invite':
      return trRe(c.genre === 'rdv' ? 'nt.invite_rdv' : 'nt.invite', { membre: nom(c.membre), titre, quand: quandReunion(c) });
    case 'cm-reunion-modifiee':
      return trRe('nt.modifiee', { titre, quand: quandReunion(c) });
    case 'cm-reunion-annulee':
      return trRe('nt.annulee', { titre, quand: quandReunion(c), motif: typeof c.motif === 'string' && c.motif ? trRe('nt.motif', { motif: c.motif }) : '' });
    case 'cm-reunion-reponse':
      return ['accepte', 'peut_etre', 'refuse', 'propose'].includes(String(c.reponse)) ? trRe(`nt.reponse.${String(c.reponse)}` as CleRe, { membre: nom(c.membre), titre }) : undefined;
    case 'cm-rdv-reserve':
      return trRe('nt.rdv_reserve', { membre: nom(c.membre), titre, quand: quandReunion(c) });
    case 'cm-reunion-rappel':
      return trRe('nt.rappel', { titre, heure: typeof c.debut === 'string' ? formaterDate(c.debut, { hour: '2-digit', minute: '2-digit', timeZone: typeof c.fuseau === 'string' ? c.fuseau : undefined }) : '?' });
    case 'cm-releve':
      return tr('cm.nt.releve', { titre, reseau: texte(c.reseau), j: typeof c.j === 'number' ? c.j : '?' });
    default:
      return undefined;
  }
}

/** « mar. 22 oct. 18:00 » d'une notification de réunion (fuseau de la réunion). */
function quandReunion(c: Record<string, unknown>): string {
  if (typeof c.debut !== 'string') return '?';
  try {
    return formaterDate(c.debut, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: typeof c.fuseau === 'string' ? c.fuseau : undefined });
  } catch {
    return formaterDate(c.debut, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
