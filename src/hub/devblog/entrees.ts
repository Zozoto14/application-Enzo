/**
 * Entrées du devblog « Quoi de neuf », versionnées.
 *
 * **Ajouter une version = ajouter une entrée en TÊTE de `ENTREES`**, avec un
 * identifiant de version nouveau (jamais réutilisé : c'est lui qu'on
 * mémorise comme « lu »). Une entrée ne présente que les nouveautés de sa
 * version. Le devblog s'affiche une fois par profil pour la dernière entrée ;
 * les précédentes restent consultables dans Paramètres › Nouveautés.
 */

/** Ce que « Essayer » ouvre. */
export type CibleEssai =
  | { genre: 'app'; app: string }
  | { genre: 'parametres' }
  | { genre: 'personnaliser' };

/** Illustration dessinée en vues (aucune image à embarquer). */
export type Illustration = 'hub' | 'administration' | 'isolation' | 'sequestre';

export interface Fonctionnalite {
  id: string;
  emoji: string;
  titre: string;
  texte: string;
  essayer?: CibleEssai;
  /** Réservée à l'administrateur (un ami ne la voit pas dans son devblog). */
  adminSeulement?: boolean;
  /** Réservée aux gestionnaires (« tu es gestionnaire ») : ni l'administrateur ni un simple ami ne la voient. */
  gestionnaireSeulement?: boolean;
}

export interface EntreeDevblog {
  /** Identifiant de version, unique et croissant (AAAA.MM.JJ). */
  version: string;
  date: string;
  titre: string;
  resume: string;
  illustration: Illustration;
  fonctionnalites: readonly Fonctionnalite[];
}

export const ENTREES: readonly EntreeDevblog[] = [
  {
    version: '2026.09.30',
    date: '2026-09-30',
    titre: 'Un ami peut devenir gestionnaire',
    resume:
      'L’administrateur peut confier une Administration limitée à un ami : créer et gérer des amis, sans jamais pouvoir ouvrir le compte de quelqu’un. Les comptes restent isolés.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'roles',
        emoji: '🧑‍💼',
        titre: 'Le rôle « Gestionnaire »',
        texte:
          'L’administrateur peut désormais confier à un ami une Administration limitée (créer et gérer des amis). Si c’est ton cas, un bandeau te le dit dans tes Paramètres. Un gestionnaire ne peut jamais ouvrir ton compte : les comptes restent isolés.',
      },
      {
        id: 'role-gestionnaire',
        emoji: '🧑‍💼',
        titre: 'Nouveau rôle « Gestionnaire »',
        texte:
          'Depuis la fiche d’un utilisateur, promouvez un ami Gestionnaire en un clic (avec votre mot de passe et votre code). Il voit une tuile « Administration » limitée : tableau de bord sans prénoms, création d’amis, accès par app, activation et suspension des amis qu’il a créés. Pas de séquestre, pas de sécurité, pas d’apps globales ; ses actions sont à votre journal, avec son nom. Administrateur complet : bientôt.',
        essayer: { genre: 'app', app: 'administration' },
        adminSeulement: true,
      },
      {
        id: 'tu-es-gestionnaire',
        emoji: '🧑‍💼',
        titre: 'Tu es gestionnaire',
        texte:
          'L’administrateur t’a confié une Administration limitée. Tu peux créer des amis et gérer ceux que tu as créés (accès aux apps, activation, suspension, identifiants). Tu ne peux ouvrir le compte de personne, et les autres comptes ne te sont pas montrés. Tes actions sont inscrites au journal de l’administrateur, avec ton nom.',
        essayer: { genre: 'app', app: 'administration' },
        gestionnaireSeulement: true,
      },
      {
        id: 'aide-maintenance',
        emoji: '🛠',
        titre: 'Maintenance, expliquée',
        texte:
          'Dans Applications, une phrase explique désormais le mode maintenance : l’app reste visible avec votre message mais les amis ne peuvent pas l’ouvrir, contrairement à « Désactiver » qui la fait disparaître.',
        essayer: { genre: 'app', app: 'administration' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.09.29',
    date: '2026-09-29',
    titre: 'Un hub qui vous ressemble, des comptes vraiment séparés',
    resume:
      'Cette version donne à l’administrateur un vrai panneau de gestion, sépare strictement les comptes de chacun, et rend le hub plus personnel : thèmes, disposition, mises à jour et paramètres à portée de main.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'admin-avance',
        emoji: '⚙︎',
        titre: 'Panneau d’administration avancé',
        texte:
          'Tableau de bord, utilisateurs (recherche, filtres, fiche, notes, modèles de permissions, actions groupées, invitations), applications (activation, maintenance), sécurité, journal d’audit exportable et réglages.',
        essayer: { genre: 'app', app: 'administration' },
        adminSeulement: true,
      },
      {
        id: 'isolation',
        emoji: '🔒',
        titre: 'Comptes isolés',
        texte:
          'Chaque compte ne voit que ses propres données : plus de liste des comptes à l’ouverture (on saisit son prénom), fichiers, préférences, journaux et caches séparés, et tout est effacé de la mémoire quand on change de compte.',
      },
      {
        id: 'acces-admin',
        emoji: '🗝',
        titre: 'Accès administrateur transparent',
        texte:
          'L’administrateur peut ouvrir le compte d’un ami avec un code d’accès propre à ce compte. L’ami en est informé dans ses Paramètres, chaque accès est journalisé et un bandeau reste affiché pendant la session.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'maj-parametres',
        emoji: '⟳',
        titre: 'Boutons « Mettre à jour » et « Paramètres »',
        texte: 'Vérifiez et installez les mises à jour depuis le hub, et retrouvez thème, disposition, version et raccourcis dans un seul panneau.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'themes',
        emoji: '🎨',
        titre: 'Thèmes du hub',
        texte: 'Huit thèmes, du clair éditorial au sombre vif, choisis pour chaque compte.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'personnalisation',
        emoji: '✎',
        titre: 'Hub personnalisable',
        texte: 'Réordonnez, épinglez, masquez et redimensionnez les tuiles ; grille ou liste, aéré ou compact.',
        essayer: { genre: 'personnaliser' },
      },
    ],
  },
];
