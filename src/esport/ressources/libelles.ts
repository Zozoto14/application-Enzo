/**
 * Libellés du module « Ressources » : noms des catégories par défaut (traduits tant qu'elles ne sont
 * pas renommées), types, niveaux, phrases du journal et des notifications.
 */

import { tr } from '../i18n';
import type { NomIcone } from '../../ui/icones/traces';
import type { CategorieRessource, GenreRessource, NiveauRessource } from './api';

const CLES_CATEGORIES = new Set(['guides', 'videos_pros', 'lineups', 'aim', 'outils', 'mental', 'divers']);

/** Nom affiché d'une catégorie (une catégorie par défaut suit la langue de l'app). */
export function nomCategorie(c: Pick<CategorieRessource, 'nom' | 'cleDefaut'> | null | undefined): string {
  if (!c) return tr('ressources.sans_categorie');
  return c.cleDefaut && CLES_CATEGORIES.has(c.cleDefaut) ? tr(`ressources.cat.${c.cleDefaut}` as 'ressources.cat.guides') : c.nom;
}

/** Icône monochrome de chaque genre de ressource (src/ui/icones). */
export const GLYPHES_GENRE: Record<GenreRessource, NomIcone> = { lien: 'lien', youtube: 'lecture', fichier: 'trombone', note: 'note' };

export const nomGenre = (g: GenreRessource): string => tr(`ressources.genre.${g}` as 'ressources.genre.lien');
export const nomNiveau = (n: NiveauRessource): string => tr(`ressources.niveau.${n}` as 'ressources.niveau.debutant');

const texte = (v: unknown): string => (typeof v === 'string' ? v : '?');

/** Phrase du journal pour un événement du module (ou undefined : pas le nôtre). */
export function phraseJournalRessources(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  switch (action) {
    case 'resource.created':
      return tr(m.multi ? 'ressources.jr.created_multi' : 'ressources.jr.created', { qui, titre: texte(m.titre) });
    case 'resource.proposed':
      return tr('ressources.jr.proposed', { qui, titre: texte(m.titre) });
    case 'resource.validated':
      return tr('ressources.jr.validated', { qui, titre: texte(m.titre) });
    case 'resource.refused':
      return tr('ressources.jr.refused', { qui, titre: texte(m.titre) });
    case 'resource.updated':
      return tr('ressources.jr.updated', { qui, titre: texte(m.titre) });
    case 'resource.pinned':
      return tr(m.epingle ? 'ressources.jr.pinned' : 'ressources.jr.unpinned', { qui, titre: texte(m.titre) });
    case 'resource.deleted':
      return tr('ressources.jr.deleted', { qui, titre: texte(m.titre) });
    case 'resource.commented':
      return tr('ressources.jr.commented', { qui, titre: texte(m.titre) });
    case 'resource.comment_deleted':
      return tr('ressources.jr.comment_deleted', { qui, titre: texte(m.titre) });
    case 'resource.reaction_changed':
      return tr(m.actif ? 'ressources.jr.reacted' : 'ressources.jr.unreacted', { qui, titre: texte(m.titre), emoji: texte(m.emoji) });
    case 'resource_category.created':
      return tr('ressources.jr.category_created', { qui, nom: texte(m.nom) });
    case 'resource_category.updated':
      return tr('ressources.jr.category_updated', { qui, de: texte(m.de), nom: texte(m.nom) });
    case 'resource_category.deleted':
      return tr('ressources.jr.category_deleted', { qui, nom: texte(m.nom) });
    case 'resource_category.reordered':
      return tr('ressources.jr.category_reordered', { qui });
    case 'resources.settings_changed':
      return tr('ressources.jr.settings_changed', { qui });
    default:
      return undefined;
  }
}

/** Phrase d'une notification du module (ou undefined). */
export function phraseNotificationRessources(type: string, team: string, c: Record<string, unknown>): string | undefined {
  switch (type) {
    case 'ressource-proposee':
      return tr('ressources.nt.proposee', { team, titre: texte(c.titre) });
    case 'ressource-validee':
      return tr('ressources.nt.validee', { team, titre: texte(c.titre) });
    case 'ressource-refusee':
      return tr(typeof c.motif === 'string' && c.motif ? 'ressources.nt.refusee_motif' : 'ressources.nt.refusee', { team, titre: texte(c.titre), motif: texte(c.motif) });
    case 'ressource-commentaire':
      return tr('ressources.nt.commentaire', { team, titre: texte(c.titre) });
    default:
      return undefined;
  }
}
