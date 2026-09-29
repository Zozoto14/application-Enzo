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
    titre: 'Synchronisation complète',
    resume:
      'Votre PC et le site restent alignés tout seuls : thème, tuiles et nouveautés déjà lues voyagent aussi, et un indicateur vous dit toujours où en est la synchronisation.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'sync-hub',
        emoji: '🎨',
        titre: 'Thèmes et disposition synchronisés',
        texte:
          'Le thème du hub, celui du portefeuille, l’ordre et la taille des tuiles suivent d’un appareil à l’autre. Les nouveautés déjà lues ne reviennent plus : lisez-les une fois, elles disparaissent partout.',
        adminSeulement: true,
      },
      {
        id: 'sync-auto',
        emoji: '⟳',
        titre: 'Synchronisation automatique',
        texte:
          'Un tour part à l’ouverture, au retour sur l’application, quand la connexion revient, peu après une modification, et à la fermeture de la page. Après un échec, l’essai reprend vite (5 s, 30 s, 2 min, 10 min).',
        adminSeulement: true,
      },
      {
        id: 'sync-indicateur',
        emoji: '✓',
        titre: 'Indicateur de synchronisation',
        texte:
          '« À jour · il y a 2 min », « 3 éléments en attente (hors ligne) » ou une erreur claire, en haut du hub et dans Paramètres, avec le bouton « Synchroniser maintenant ». Hors connexion, rien n’est perdu : tout part au retour du réseau.',
        essayer: { genre: 'parametres' },
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
