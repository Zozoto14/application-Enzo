/**
 * Phrases du journal et des notifications de la section CM (actions `cm.*`, notifications `cm-*`).
 * Pur, testé.
 */

import { tr } from '../i18n';

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
    case 'cm.carte_creee':
      return tr('cm.jr.carte_creee', { qui, titre });
    case 'cm.carte_assignee':
      return tr('cm.jr.carte_assignee', { qui, titre });
    case 'cm.carte_supprimee':
      return tr('cm.jr.carte_supprimee', { qui, titre });
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
    default:
      return undefined;
  }
}
