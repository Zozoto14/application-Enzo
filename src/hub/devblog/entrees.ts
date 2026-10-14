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
  /** Visible de l'administrateur et des seuls comptes qui ont cette app (ex. l'ami à qui Tâches est ouverte). */
  app?: string;
  /** Avec `app` : réservée aux comptes non administrateurs qui ont l'app (l'administrateur ne la voit pas). */
  amiSeulement?: boolean;
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
    version: '2026.10.27',
    date: '2026-10-27',
    titre: 'Plusieurs apps ouvertes en même temps',
    resume:
      'Vos apps s’ouvrent désormais en onglets, comme dans un navigateur : passez de l’une à l’autre sans rien perdre. Sur grand écran, affichez-en deux côte à côte ; sur le PC, ouvrez une app dans sa propre fenêtre.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'multi-onglets',
        emoji: '🗂',
        titre: 'Des onglets pour vos apps',
        texte:
          'Chaque app ouverte depuis le hub a son onglet en haut de l’écran ; elle garde son état (recherche, filtres, position) quand vous passez à une autre. Clic molette, Ctrl+clic ou appui long sur une tuile : nouvel onglet sans quitter le hub. Raccourcis : Ctrl+Tab, Ctrl+Maj+Tab, Ctrl+1 à 9, Ctrl+W. Vos onglets vous attendent au prochain démarrage.',
      },
      {
        id: 'multi-cote-a-cote',
        emoji: '◫',
        titre: 'Deux apps côte à côte',
        texte:
          'Sur un écran large (PC, iPad à l’horizontale) : « ⋯ » sur un onglet, puis « Afficher à côté ». Glissez la séparation pour régler les largeurs ; ⇄ échange les côtés. Sur téléphone, le bouton ▤ de l’en-tête liste vos apps ouvertes.',
      },
      {
        id: 'multi-fenetres',
        emoji: '⧉',
        titre: 'Une app dans sa propre fenêtre',
        texte:
          'Sur le PC : « Ouvrir dans une nouvelle fenêtre » (menu « ⋯ » d’un onglet), sans vous reconnecter. Sur le site : « Ouvrir dans un nouvel onglet du navigateur », un lien qui ouvre directement l’app après le déverrouillage. Vos droits restent les mêmes : un lien n’ouvre jamais une app qui ne vous est pas ouverte.',
      },
    ],
  },
  {
    version: '2026.10.25',
    date: '2026-10-25',
    titre: 'Tâches V2 : temps, journal, notifications, liens',
    resume:
      'Un minuteur sur chaque tâche et un relevé de la semaine, un journal du jour et son débriefing, des notifications réglables à ta façon, la corbeille, des projets à ton image et des liens avec tes autres apps.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'taches-temps',
        emoji: '⏱',
        titre: 'Suivi du temps',
        texte:
          'Dans le détail d’une tâche : ▶ démarre le minuteur (un seul à la fois, il te suit d’un appareil à l’autre), ou saisis « 1h30 ». Estimation contre réel, relevé de la semaine par projet ou étiquette, export CSV (bouton ⏱).',
        essayer: { genre: 'app', app: 'taches' },
        app: 'taches',
      },
      {
        id: 'taches-notifications',
        emoji: '🔔',
        titre: 'Tes notifications, tes réglages',
        texte:
          'Dans 👥 › Notifications : par type (échéance, retard, tâche assignée, modification de l’autre…), système ou pastille, heures calmes, projets en sourdine, un seul appareil, et « Tester une notification ».',
        essayer: { genre: 'app', app: 'taches' },
        app: 'taches',
      },
      {
        id: 'taches-journal',
        emoji: '📓',
        titre: 'Journal du jour et débriefing',
        texte:
          'Note en une phrase ce que tu as fait (📓) : tes tâches terminées et ton temps du jour sont proposés. Le débriefing du jour ou de la semaine résume tout pour les autres membres du projet — à copier en Markdown.',
        essayer: { genre: 'app', app: 'taches' },
        app: 'taches',
      },
      {
        id: 'taches-projets',
        emoji: '⚙️',
        titre: 'Projets à ton image, ouverture sur la semaine',
        texte: 'Icône, description, dates, étiquettes et statuts de chaque projet (avec son historique) ; Tâches s’ouvre maintenant sur le calendrier de la semaine (réglable dans 👥).',
        essayer: { genre: 'app', app: 'taches' },
        adminSeulement: true,
      },
      {
        id: 'taches-liens',
        emoji: '🔗',
        titre: 'Liens avec tes autres apps',
        texte:
          'Crée une tâche depuis un agent de Claude Office (elle passe « En revue » quand il a fini) ; les relances de Prospects, les échéances d’Abonnements, le versement mensuel et les dividendes du portefeuille deviennent des tâches — à activer un par un, jamais montré à ton ami.',
        essayer: { genre: 'app', app: 'taches' },
        adminSeulement: true,
      },
      {
        id: 'taches-corbeille',
        emoji: '🗑',
        titre: 'Supprimer sans crainte',
        texte: 'Espaces, projets et listes se suppriment par le menu ⋯ (ou l’appui long, ou Suppr) : déplace d’abord leur contenu si tu veux, « Annuler » 10 s, puis 30 jours dans la corbeille.',
        essayer: { genre: 'app', app: 'taches' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.24',
    date: '2026-10-24',
    titre: 'Nouvelle app : Tâches',
    resume:
      'Espaces, projets, listes et tâches, en liste, en Kanban, au calendrier et dans « Ma journée » ; ajout rapide en une ligne, rappels, et partage d’un projet avec un ami, chiffré de bout en bout.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'taches-v1',
        emoji: '☑️',
        titre: 'Tâches, façon ClickUp',
        texte:
          'Écris « Appeler Paul demain #prospects !haute » : date, étiquette et priorité sont comprises. Glisse les cartes du Kanban ou les tâches du calendrier (souris ou doigt), raccourcis N, /, 1-4.',
        essayer: { genre: 'app', app: 'taches' },
        app: 'taches',
      },
      {
        id: 'taches-partage',
        emoji: '👥',
        titre: 'Partage avec un ami',
        texte:
          'Dans ⚙︎ de Tâches, choisis un ami et partage tes projets un par un, en lecture ou en écriture. Il ne voit que ceux-là ; tout reste chiffré sur le relais.',
        essayer: { genre: 'app', app: 'taches' },
        adminSeulement: true,
      },
      {
        id: 'taches-partage-ami',
        emoji: '👥',
        titre: 'Des projets partagés avec toi',
        texte: 'Le Fondateur t’a ouvert Tâches : tu vois les projets qu’il te partage, et tu peux les modifier quand il te les partage en écriture.',
        essayer: { genre: 'app', app: 'taches' },
        app: 'taches',
        amiSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.23',
    date: '2026-10-23',
    titre: 'Claude Office v4 : la scène en grand, les sous-agents et le suivi',
    resume:
      'L’open space prend tout l’écran (zoom, plein écran, écran d’ambiance), les sous-agents apparaissent dès leur lancement, et un onglet Suivi rassemble récap, alertes, équipe et notes.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'claude-office-v4-scene',
        emoji: '🔭',
        titre: 'La scène en plein cadre',
        texte:
          'Zoom, glisser, plein écran (touche F) et écran d’ambiance ; le détail au survol ou au toucher, « Suivre cet agent » (J / K), mini-carte et relecture de la journée.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-v4-sous-agents',
        emoji: '🧑‍🤝‍🧑',
        titre: 'Les sous-agents, en direct',
        texte:
          'Chaque sous-agent devient un petit personnage dès son lancement, va travailler puis rend son travail au parent ; statistiques et récap les comptent. Mets à jour le hook sur le PC (Mise en route).',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-v4-suivi',
        emoji: '🔔',
        titre: 'Onglet Suivi : récap, alertes, équipe',
        texte:
          'Récap du jour ou de la semaine (export), alertes réglables (attend ta réponse, a fini…), surnom, couleur et accessoire de chaque agent, notes de session et raccourcis clavier (?).',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.22',
    date: '2026-10-22',
    titre: 'Claude Office : des zones, une salle d’attente et « attend ta réponse »',
    resume:
      'L’open space de Claude Office passe en zones à thème : chaque agent marche jusqu’à celle de ce qu’il fait, lève la main quand Claude attend ta réponse et passe en salle d’attente quand il a fini.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'claude-office-zones',
        emoji: '🗺️',
        titre: 'Des zones à thème',
        texte:
          'Atelier code, Salle des machines, Bibliothèque, Café web, Réunion, Réflexion, Accueil, Détente : chaque agent rejoint la zone de son activité, sans aller-retour à chaque outil. « ? » explique tout.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-attente',
        emoji: '✋',
        titre: 'Attend ta réponse, terminé à voir',
        texte:
          'Une autorisation ou une question en attente : il lève la main au guichet (notification possible sur le PC). Une tâche finie : salle d’attente, avec ce qu’il a fait. Pense à mettre à jour le hook sur le PC (Mise en route).',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-detail-stats',
        emoji: '📊',
        titre: 'Mise en route, détail, statistiques',
        texte:
          'Une check-list dit ce qui manque et comment le régler ; toucher un agent montre la chronologie de sa session ; un onglet Statistiques ; vue Liste, filtres par projet, démo enrichie.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.21',
    date: '2026-10-21',
    titre: 'Tsuzuku : VF ou VOSTFR, au choix',
    resume:
      'Quand vous ouvrez un épisode, un bouton « VF | VOSTFR » permet de changer de langue : l’épisode se recharge au même numéro dans l’autre version. Tsuzuku retient votre choix pour chaque série.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'tsuzuku-vf-vostfr',
        emoji: '🗣️',
        titre: 'Un bouton VF | VOSTFR',
        texte:
          'Dans le lecteur et au-dessus de la liste d’épisodes : choisissez VF ou VOSTFR. Si une langue n’existe pas sur vos sources, le bouton est grisé et dit pourquoi ; si la source ne précise pas la langue, Tsuzuku affiche « Langue inconnue » plutôt que de deviner.',
        essayer: { genre: 'app', app: 'tsuzuku' },
      },
      {
        id: 'tsuzuku-langue-par-serie',
        emoji: '📌',
        titre: 'Votre langue, série par série',
        texte:
          'Le choix est retenu pour chaque série (sur cet appareil). Langue par défaut dans Paramètres › Tsuzuku : VF, VOSTFR, ou « au choix à chaque fois ». Un épisode vu en VF compte comme vu : la progression est commune aux deux langues.',
        essayer: { genre: 'parametres' },
      },
    ],
  },
  {
    version: '2026.10.20',
    date: '2026-10-20',
    titre: 'Claude Office devient un vrai open space',
    resume:
      'L’onglet Bureau de Claude Office est redessiné en open space vu en 3D isométrique : îlots de bureaux, salle de réunion vitrée, cuisine et machine à café, coin salon, de jour en thème clair et de nuit en thème sombre. Chaque session de Claude Code y a son personnage.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'claude-office-open-space',
        emoji: '🏢',
        titre: 'Un open space vivant',
        texte:
          'Chaque agent arrive par la porte, rejoint son poste, tape, ouvre un terminal, cherche, lit, consulte le web, réfléchit (bulle de pensée), prend un café, fête la fin de sa session puis repart avec son carton. Son écran et son badge montrent l’outil en cours, la bulle sa dernière demande (secrets masqués).',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-demo',
        emoji: '🎬',
        titre: 'Mode démo',
        texte:
          '« Voir la démo » remplit l’open space de sessions fictives animées, clairement étiquetées « Démo », pour voir la scène même sans activité. Rien de réel n’est lu ni déposé ; « Quitter la démo » revient à vos agents.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-open-space-accessible',
        emoji: '♿',
        titre: 'Léger, lisible, accessible',
        texte:
          'Aucune image : tout est dessiné à la volée (environ 18 Ko compressés). Les animations s’arrêtent hors de l’écran et respectent « réduire les animations » (scène fixe mais expressive). Sous la scène, la liste des agents (état, projet, dernière demande) se parcourt au clavier ; sur téléphone, la scène se fait glisser ou s’affiche en entier.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.19',
    date: '2026-10-19',
    titre: 'Tsuzuku : vos sources trouvent mieux les animés, et disent pourquoi',
    resume:
      'Quand une source ne trouve pas un animé, Tsuzuku en donne maintenant la vraie raison (site qui bloque les robots, page construite en JavaScript, adresse à revoir…) et lit beaucoup plus de sites : API JSON, recherche en POST, adresses directes {slug}, cartes d’articles, épisodes paginés ou par saisons, pages en ISO-8859-1.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'tsuzuku-sources-reel-lecture',
        emoji: '🔎',
        titre: 'Des sources lues comme un humain les lirait',
        texte:
          'Si les sélecteurs ne trouvent rien, Tsuzuku repère seul les résultats (cartes, liens titrés, données structurées) et les épisodes (« Épisode 12 », « EP 3 », « S2E03 »…), suit les pages suivantes et garde la bonne saison. Les titres « Épisode N », « S2 », « Re:Zero », les apostrophes et les films sont mieux reconnus.',
        essayer: { genre: 'app', app: 'tsuzuku' },
      },
      {
        id: 'tsuzuku-sources-reel-diagnostic',
        emoji: '🩺',
        titre: 'Diagnostic détaillé à copier, et test sur le titre de la fiche',
        texte:
          'Sur la fiche, « Détail du diagnostic » montre chaque requête (statut, type, taille, page JavaScript, anti-robot, candidats et scores) et « Copier le diagnostic » le donne en texte, sans clé ni secret. « Tester une source sur ce titre » rejoue la recherche pas à pas. Nouvelle aide : « Comment bien configurer une source ».',
        essayer: { genre: 'app', app: 'tsuzuku' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.18',
    date: '2026-10-18',
    titre: 'Claude Office : le bureau des agents, partout',
    resume:
      'Le bureau de Claude Office s’affiche maintenant directement dans le hub, sur le PC, le site et le téléphone, sans serveur à lancer ni rien à installer sur l’appareil où vous regardez. Un personnage par session de Claude Code, qui écrit, utilise un outil, réfléchit ou attend.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'claude-office-bureau',
        emoji: '🧑‍💻',
        titre: 'Onglet « Bureau », dessiné dans le hub',
        texte:
          'Chaque session de Claude Code a son poste et son personnage, animé selon ce qu’il fait, avec sa dernière demande résumée dans une bulle (secrets masqués) et des compteurs du jour. Animations coupées si votre système demande de les réduire. Le vrai Claude Office reste ouvrable en fenêtre à part sur le PC, en option avancée.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-bureau-partout',
        emoji: '📱',
        titre: 'En direct sur le PC, à distance ailleurs',
        texte:
          'Sur le PC, le bureau relit le journal local toutes les 2 secondes. Sur le site et le téléphone, il lit la copie chiffrée que le PC dépose (à activer dans l’onglet Bureau du PC) et indique son âge : « à jour il y a 7 min ». La « présence rapide », facultative, réduit ce délai à 5 minutes pendant l’activité. Le hook reste nécessaire sur le PC où tourne Claude Code.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-tuile',
        emoji: '▣',
        titre: 'État des agents sur la tuile',
        texte: 'La tuile Claude Office de la page Administration montre combien d’agents travaillent, et depuis quand l’information date.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.17',
    date: '2026-10-17',
    titre: 'Claude Office garde l’historique de vos requêtes',
    resume:
      'Chaque demande faite à Claude Code sur un PC équipé est notée dans un journal local, même quand AppDashboard et Claude Office sont fermés. Un nouvel onglet « Historique » permet de la retrouver, la filtrer, l’exporter ou la supprimer.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'claude-office-historique',
        emoji: '🗂️',
        titre: 'Onglet « Historique » de Claude Office',
        texte:
          'Liste par jour et par session, recherche dans les demandes, filtres (projet, appareil, période, outil), détail et copie, export JSON ou CSV, suppression d’une entrée, d’une période ou de tout (confirmée deux fois). Les secrets reconnus sont masqués avant l’écriture et les sorties d’outils ne sont pas gardées par défaut.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-historique-hook',
        emoji: '📝',
        titre: 'Même application fermée',
        texte:
          'Le hook d’historique de Claude Code écrit directement dans ~/.agent-office/historique : rien ne se perd si AppDashboard est fermé. Installation : npm run office:hooks (aperçu, confirmation, sauvegarde). Un PC éteint ou un appareil sans le hook n’enregistre rien.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-historique-synchro',
        emoji: '🔐',
        titre: 'Copie chiffrée, au choix',
        texte:
          'Désactivée par défaut : activez-la sur le PC pour relire l’historique depuis le site ou le téléphone, même PC éteint. Chiffrée avec votre clé de synchronisation, réservée au compte principal, déposée au plus toutes les 15 minutes.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.16',
    date: '2026-10-16',
    titre: 'Tsuzuku : les fiches trouvent enfin vos épisodes',
    resume:
      'Une source qui réussit son test trouve désormais aussi les épisodes depuis la fiche : même recherche, titres alternatifs du catalogue et diagnostic clair. Et vos sources suivent votre compte sur tous vos appareils.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'tsuzuku-fiche-sources',
        emoji: '🔎',
        titre: 'La fiche cherche comme le test',
        texte:
          'La fiche essaie le titre affiché, sa forme courte (sans sous-titre ni saison), le romaji, le titre français et les synonymes du catalogue, puis garde le résultat le plus ressemblant. Un bloc « Sur vos sources » dit ce qui a été trouvé, ou pourquoi rien ne l’est, avec « Réessayer » et « Chercher avec un autre titre ».',
        essayer: { genre: 'app', app: 'tsuzuku' },
      },
      {
        id: 'tsuzuku-test-catalogue',
        emoji: '🧪',
        titre: 'Tester une source sur un vrai titre du catalogue',
        texte: 'Le test pas à pas de l’assistant suit exactement le chemin de la fiche, et peut prendre une fiche du catalogue avec tous ses titres.',
        adminSeulement: true,
      },
      {
        id: 'tsuzuku-sources-synchro',
        emoji: '🔄',
        titre: 'Vos sources sur tous vos appareils',
        texte:
          'Sources, activation, partage, dernier test et clés d’API se synchronisent chiffrés entre le PC, le site et le téléphone du même compte. Deux modifications sur deux appareils ne s’écrasent plus ; une suppression suit partout. Une pastille « Synchronisé / En attente » l’indique sur la page Sources.',
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.15',
    date: '2026-10-15',
    titre: 'Claude Office arrive dans le hub',
    resume:
      'Le bureau en pixel art des agents de Claude Code a sa tuile : il dit si Claude Office tourne sur le PC, l’ouvre dans sa fenêtre et installe ses hooks après vous avoir montré exactement ce qui change.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'claude-office-tuile',
        emoji: '🏢',
        titre: 'Tuile « Claude Office » (Fondateur)',
        texte:
          'Sur le PC : état du serveur local, nombre d’agents actifs, bouton « Ouvrir Claude Office » et choix du dossier. Sur le site et le téléphone : la commande à lancer sur le PC. Réservée au Fondateur, jamais proposée aux amis.',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
      {
        id: 'claude-office-hooks',
        emoji: '🪝',
        titre: 'Hooks de Claude Code, sans surprise',
        texte:
          '« Voir ce qui sera modifié » montre le fichier et chaque ajout ; « Installer les hooks… » redemande confirmation, sauvegarde le fichier puis l’écrit. Relancer ne change rien. En terminal : npm run office:hooks (avec --a-blanc pour un aperçu seul).',
        essayer: { genre: 'app', app: 'claude-office' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.14',
    date: '2026-10-14',
    titre: 'Nouvelle app : Prospects',
    resume:
      'Un carnet de prospection personnel, réservé au Fondateur : vos contacts, leurs relances et vos modèles de messages, chiffrés et synchronisés entre vos appareils comme le reste de l’administration.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'prospects-carnet',
        emoji: '✉️',
        titre: 'Un carnet de prospects',
        texte:
          'Nom, entreprise, e-mail, téléphone, source, étiquettes, statut (nouveau → gagné ou perdu), prochaine relance, notes et historique des contacts. Recherche, filtres par statut ou étiquette, tri, compteurs, et la vue « À relancer aujourd’hui ».',
        essayer: { genre: 'app', app: 'prospects' },
        adminSeulement: true,
      },
      {
        id: 'prospects-lot-csv',
        emoji: '📋',
        titre: 'Ajout en lot et CSV',
        texte:
          'Collez une liste d’adresses (une par ligne, ou séparées par des virgules ou points-virgules) : les doublons, quelle que soit la casse, et les adresses mal formées sont écartés. Import et export CSV complets.',
        adminSeulement: true,
      },
      {
        id: 'prospects-ecrire',
        emoji: '✍️',
        titre: '« Écrire », un message à la fois',
        texte:
          'Le bouton « Écrire » ouvre votre messagerie avec un modèle personnalisé ({prenom}, {entreprise}) ; rien n’est envoyé automatiquement et aucune adresse n’est collectée sur le web. Un rappel sur les règles de la prospection (RGPD, consentement, désinscription) est affiché, et « Ne plus contacter » bloque le bouton.',
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.13',
    date: '2026-10-13',
    titre: 'Deux pages dans le hub, et une app Abonnements',
    resume:
      'Le hub sépare désormais vos applications des outils d’administration : un onglet « Applications » pour tout le monde, un onglet « Administration » pour les rangs habilités. Le suivi des abonnements devient une app à part entière.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'hub-pages-administration',
        emoji: '🗂️',
        titre: 'Applications · Administration',
        texte:
          'En haut du hub (ou par l’entrée « Admin » de la barre basse sur téléphone), passez de vos applications aux apps réservées à l’administration. L’onglet n’apparaît qu’aux rangs qui y ont au moins une app ; les autres comptes ne voient aucun changement.',
        adminSeulement: true,
      },
      {
        id: 'app-abonnements',
        emoji: '💳',
        titre: 'App Abonnements',
        texte:
          'Le suivi manuel des abonnements quitte l’Administration pour sa propre tuile, dans la page Administration : mêmes comptes, mêmes paiements, mêmes rappels, rien n’est perdu. Ses réglages (devise, rappels, modèle du message) sont dans son onglet Réglages. Réservée aux Fondateurs, comme avant.',
        essayer: { genre: 'app', app: 'abonnements' },
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.12',
    date: '2026-10-12',
    titre: 'Tsuzuku : page Sources et assistant guidé',
    resume:
      'Ajouter une source n’est plus caché dans les réglages : Tsuzuku a une page « Sources » (onglet sur PC, barre basse sur téléphone) avec un assistant pas à pas qui part du lien d’un site, et chaque écran dit clairement quoi faire quand aucune source n’est configurée.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'tsuzuku-page-sources',
        emoji: '🧩',
        titre: 'Page « Sources » dans Tsuzuku',
        texte:
          'Un onglet « Sources » (avec le nombre de sources actives) ouvre la liste : type animés/films, activée ou non, dernier test OK/KO, avec qui elle est partagée. « + Ajouter une source » propose l’assistant (recommandé) ou le JSON. C’est la même page que Paramètres › Administration › Tsuzuku · Sources, réservée aux Fondateurs.',
        essayer: { genre: 'app', app: 'tsuzuku' },
        adminSeulement: true,
      },
      {
        id: 'tsuzuku-assistant-4-etapes',
        emoji: '🪄',
        titre: 'Assistant en 4 étapes',
        texte:
          '1. Collez l’adresse du site (vérifiée : sites publics seulement). 2. Copiez le prompt généré dans l’IA de votre choix (boutons « Copier », « Ouvrir ChatGPT / Claude »). 3. Collez sa réponse : les erreurs s’affichent ligne par ligne et « Réparer avec l’IA » prépare un prompt de correction. 4. Testez (recherche → épisodes → lecteur), puis enregistrez avec le partage voulu. Sur le site web, collez le code de la page ou laissez l’IA analyser le site.',
        adminSeulement: true,
      },
      {
        id: 'tsuzuku-sauvegarde-sources',
        emoji: '💾',
        titre: 'Importer / exporter les sources',
        texte:
          'Les sources s’exportent en JSON pour une sauvegarde ou un autre appareil, sans clé d’API ni partage ; l’import vérifie chaque source. Un bouton « ? » explique ce qu’est une source et comment la tester. N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.',
        adminSeulement: true,
      },
      {
        id: 'tsuzuku-sans-source',
        emoji: '🧭',
        titre: 'Quand aucune source n’est configurée',
        texte:
          'L’accueil, le catalogue, la recherche et les fiches l’indiquent clairement : Tsuzuku a besoin d’au moins une source pour lire des épisodes et des films. Les Fondateurs ont un bouton vers l’assistant ; les autres comptes savent qu’il faut demander à l’administrateur. Le lien direct reste disponible sur chaque fiche.',
        essayer: { genre: 'app', app: 'tsuzuku' },
      },
    ],
  },
  {
    version: '2026.10.11',
    date: '2026-10-11',
    titre: 'Déverrouillage : diagnostic et messages plus clairs',
    resume:
      'Des identifiants justes ne doivent plus être refusés sans explication : l’écran de déverrouillage distingue un problème de l’appareil d’un mauvais mot de passe, tolère les copier-coller imparfaits, repère une horloge décalée et propose un diagnostic à envoyer au support.',
    illustration: 'isolation',
    fonctionnalites: [
      {
        id: 'deverrouillage-erreur-technique',
        emoji: '🧮',
        titre: 'Problème de l’appareil ≠ mauvais mot de passe',
        texte:
          'Si le navigateur ne parvient pas à calculer la clé (mémoire insuffisante, par exemple sur un vieil iPad), l’écran le dit clairement au lieu d’afficher « Mot de passe ou code incorrect », et l’essai ne compte pas dans les tentatives. Un échec d’authentification, lui, ne dit toujours pas lequel des deux facteurs est faux.',
      },
      {
        id: 'deverrouillage-copier-coller',
        emoji: '📋',
        titre: 'Copier-coller toléré',
        texte:
          'Un espace ou un retour à la ligne collé au début ou à la fin du mot de passe, un caractère invisible ou un accent décomposé ne font plus échouer le déverrouillage (la saisie exacte est toujours essayée en premier : rien ne change pour les mots de passe existants). Le code « 123 456 » collé avec une espace est accepté, et les correcteurs automatiques sont coupés.',
      },
      {
        id: 'deverrouillage-horloge',
        emoji: '⏱️',
        titre: 'Horloge décalée détectée',
        texte:
          'Après un échec, l’heure de l’appareil est comparée à celle du relais : au-delà de 20 secondes d’écart, l’écran indique de combien elle est décalée et demande d’activer le réglage automatique de la date et de l’heure (les codes à six chiffres en dépendent).',
      },
      {
        id: 'deverrouillage-coffre-pc',
        emoji: '🔁',
        titre: 'Mot de passe changé sur le PC',
        texte:
          'Le navigateur lit le coffre publié par votre PC : si le mot de passe y a été changé, le nouveau mot de passe ouvre aussi ce navigateur. Si ce navigateur garde un autre coffre que celui de votre PC, il le suggère après deux échecs (« relier mon compte »). Le compte à rebours « Trop de tentatives » avance désormais tout seul.',
        adminSeulement: true,
      },
      {
        id: 'deverrouillage-diagnostic',
        emoji: '🩺',
        titre: 'Lien « Diagnostic »',
        texte:
          'Sous l’écran de déverrouillage, un lien discret affiche la version, l’appareil, l’écart d’horloge, ce que le navigateur sait faire, l’état de la liaison et du coffre — sans aucun secret — avec un bouton « Copier le diagnostic » pour le support.',
      },
    ],
  },
  {
    version: '2026.10.10',
    date: '2026-10-10',
    titre: 'Affichage téléphone repensé (1/2)',
    resume:
      'Sur téléphone, l’application ne se contente plus de rétrécir l’affichage du PC : écrans d’entrée, hub, Paramètres et Support ont été refaits pour le pouce, avec une barre de navigation en bas, des textes lisibles et des boutons faciles à toucher. Le PC et la tablette en paysage ne changent pas. Les apps (Portefeuille, Administration, Tsuzuku) suivront dans la deuxième partie.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'mobile-barre-basse',
        emoji: '📱',
        titre: 'Une barre en bas de l’écran',
        texte:
          'Accueil, Support, Réglages et Compte sont toujours à portée de pouce. « Compte » ouvre une feuille avec l’état de la synchronisation, « Changer de compte » et « Verrouiller ». Un balayage depuis le bord gauche revient en arrière, comme sur iPhone.',
      },
      {
        id: 'mobile-hub',
        emoji: '🧩',
        titre: 'Un hub fait pour le téléphone',
        texte:
          'Tuiles compactes sur deux colonnes, bandeaux lisibles en pleine largeur, et une personnalisation au doigt : chaque app a ses boutons pour monter, descendre, épingler, masquer ou changer de taille, sans glisser-déposer à deviner.',
        essayer: { genre: 'personnaliser' },
      },
      {
        id: 'mobile-reglages',
        emoji: '⚙️',
        titre: 'Des Paramètres en liste',
        texte:
          'Les Paramètres sont une liste de sections qui ouvrent chacune leur page, avec une recherche en tête. Les textes font au moins 15 px, les boutons au moins 44 px, et les champs ouvrent le bon clavier (chiffres pour les codes, remplissage automatique des mots de passe) sans que la page zoome.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'mobile-entree',
        emoji: '🔐',
        titre: 'Connexion et Support plus confortables',
        texte:
          'Connexion, déverrouillage, premier lancement, liaison d’un appareil et mot de passe oublié tiennent sur une colonne, avec le bouton principal collé en bas de l’écran, au-dessus du clavier. Les fenêtres de confirmation deviennent des feuilles qui montent du bas, et le formulaire de Support se remplit d’une main.',
      },
    ],
  },
  {
    version: '2026.10.09',
    date: '2026-10-09',
    titre: 'Synchronisation dès le démarrage',
    resume:
      'La synchronisation n’attend plus le mot de passe : dès que l’application (ou le PC) démarre, elle récupère les nouveautés des autres appareils et envoie ce qui était resté en attente, toujours chiffré. Au déverrouillage, tout est déjà là, thème compris.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'synchro-demarrage-reception',
        emoji: '⚡',
        titre: 'Tout est prêt au déverrouillage',
        texte:
          'Au lancement, avant même le mot de passe, les modifications faites sur vos autres appareils sont téléchargées sous forme chiffrée (illisibles sans votre clé). Dès que vous déverrouillez, elles sont appliquées immédiatement : thème, tuiles et données s’affichent à jour dès la première image, sans attendre le réseau.',
        adminSeulement: true,
      },
      {
        id: 'synchro-demarrage-envoi',
        emoji: '📤',
        titre: 'Rien ne reste coincé hors ligne',
        texte:
          'Une modification faite sans connexion (ou juste avant une fermeture brutale) est préparée, chiffrée, pour l’envoi. Au démarrage suivant — y compris au démarrage de Windows, l’application près de l’horloge — elle part toute seule dès que le réseau revient, sans avoir à déverrouiller.',
        adminSeulement: true,
      },
      {
        id: 'synchro-demarrage-indicateur',
        emoji: '🕒',
        titre: 'L’état visible avant de se connecter',
        texte:
          'L’écran de connexion indique discrètement « 1 mise à jour reçue, en attente de déverrouillage », « 1 élément prêt à envoyer » et « Synchronisé il y a X min ». Rien d’autre : ni compte, ni contenu.',
      },
    ],
  },
  {
    version: '2026.10.08',
    date: '2026-10-08',
    titre: 'Verrouillage automatique, Support et mentions légales',
    resume:
      'L’application se verrouille seule après 45 minutes d’inactivité (réglable), vous pouvez écrire à l’équipe depuis un formulaire de support, et les conditions, la confidentialité, les cookies et les mentions légales sont consultables.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'verrou-auto',
        emoji: '🔒',
        titre: 'Verrouillage automatique',
        texte:
          'Sans geste de votre part pendant 45 minutes (5, 15, 30, 45, 60, 120 minutes ou jamais : Paramètres › Sécurité), l’application se verrouille et efface les clés de la mémoire. Pendant un film ou un épisode, elle demande d’abord « Êtes-vous toujours là ? » (60 secondes pour répondre).',
      },
      {
        id: 'support-tickets',
        emoji: '🛟',
        titre: 'Support : écrire à l’équipe',
        texte:
          'Bouton « ? Support » du hub et de chaque app, ou Paramètres › Support : catégorie, sujet, message, capture facultative. Le ticket arrive dans le salon Discord de l’équipe ; « Mes tickets » garde l’historique, et un ticket écrit hors ligne part tout seul au retour du réseau.',
      },
      {
        id: 'mentions-legales',
        emoji: '📄',
        titre: 'Conditions, confidentialité, cookies, mentions légales',
        texte:
          'Accessibles depuis l’écran de connexion et Paramètres › À propos. Vous les acceptez à la première connexion (et de nouveau quand elles changent) ; un Fondateur peut adapter les textes. Modèle informatif à faire relire par un professionnel du droit.',
        essayer: { genre: 'parametres' },
      },
    ],
  },
  {
    version: '2026.10.07',
    date: '2026-10-07',
    titre: 'Tsuzuku : sources partagées et assistant d’ajout',
    resume:
      'Les sources de Tsuzuku sont désormais gérées par les Fondateurs dans Paramètres › Administration › Tsuzuku, et partagées, chiffrées, avec les utilisateurs choisis. Un assistant aide à décrire une nouvelle source à partir d’un lien. Et Tsuzuku retrouve son allure d’avant.',
    illustration: 'isolation',
    fonctionnalites: [
      {
        id: 'tsuzuku-sources-partagees',
        emoji: '🔗',
        titre: 'Sources partagées avec vous',
        texte:
          'Paramètres › Tsuzuku : les sources que l’administration vous partage (nom, animés ou films, état). Activez ou désactivez chacune pour vous seul ; vous ne pouvez pas les modifier, et aucune clé d’API ne vous est transmise.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'tsuzuku-partage-admin',
        emoji: '🛡',
        titre: 'Qui a accès à chaque source',
        texte:
          'Administration › Tsuzuku › Sources : pour chaque source, vous seul, tous les utilisateurs de Tsuzuku ou une sélection. La liste part chiffrée dans l’espace de chaque bénéficiaire ; un retrait est propagé. Clés d’API et options du moteur sont à côté, jamais réaffichées en entier.',
        essayer: { genre: 'parametres' },
        adminSeulement: true,
      },
      {
        id: 'tsuzuku-assistant',
        emoji: '🧭',
        titre: 'Assistant d’ajout par lien',
        texte:
          'Collez l’adresse d’une page : l’app en résume la structure et prépare un texte à donner à une IA, qui propose la description complète de la source. Collez sa réponse : elle est vérifiée puis testée avant l’enregistrement. N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.',
        essayer: { genre: 'parametres' },
        adminSeulement: true,
      },
      {
        id: 'tsuzuku-design',
        emoji: '🎬',
        titre: 'Tsuzuku comme avant',
        texte:
          'Bandeau « à la une », rangée « Reprendre » avec la progression, affiches avec note et badges « Déjà vu » / « Vu ailleurs », fiche immersive, liste d’épisodes numérotée, lecteur plus clair — dans le thème de votre hub.',
        essayer: { genre: 'app', app: 'tsuzuku' },
      },
    ],
  },
  {
    version: '2026.10.06',
    date: '2026-10-06',
    titre: 'Gestion des abonnements',
    resume:
      'Un suivi manuel des abonnements dans l’Administration : qui a payé, prochaine échéance, rappels. Rien n’est prélevé ni coupé automatiquement.',
    illustration: 'administration',
    fonctionnalites: [
      {
        id: 'abonnements-suivi',
        emoji: '💳',
        titre: 'Suivi des paiements',
        texte:
          'Administration › Abonnements : statut de chaque compte (À jour, Échéance proche, En retard, Offert, Suspendu), « Marquer payé » avec recalcul de l’échéance, paiement partiel, pause, historique et export CSV. Réservé aux Fondateurs ; informatif, sans conseil fiscal ni juridique.',
        essayer: { genre: 'app', app: 'administration' },
        adminSeulement: true,
      },
      {
        id: 'abonnements-rappels',
        emoji: '🔔',
        titre: 'Rappels',
        texte:
          'Une cloche dans le hub et le tableau de bord (« 2 abonnements en retard, 3 échéances cette semaine »), une notification locale par jour si activée, et un message de rappel à copier pour l’envoyer vous-même. Réglages dans Paramètres › Administration.',
        adminSeulement: true,
      },
      {
        id: 'abonnements-ami',
        emoji: '🙂',
        titre: 'Un rappel amical, le tien seulement',
        texte:
          'Si l’administrateur l’a activé, tu vois un petit rappel dans ton hub quand ton échéance approche, une fois par jour. Tu ne vois que ton propre état : ni notes, ni les autres comptes.',
      },
    ],
  },
  {
    version: '2026.10.05',
    date: '2026-10-05',
    titre: 'Rangs : Fondateur, Administrateur, Gestionnaire',
    resume:
      'Quatre rangs ordonnés — Fondateur › Administrateur › Gestionnaire › Ami. Chacun n’agit que sur les rangs strictement inférieurs, et la clé d’un compte n’est scellée que pour les rangs au-dessus.',
    illustration: 'sequestre',
    fonctionnalites: [
      {
        id: 'rangs-regle',
        emoji: '🏅',
        titre: 'Un rang n’agit que vers le bas',
        texte:
          'Un Administrateur gère les Gestionnaires et les Amis — jusqu’à ouvrir leur compte avec SES propres codes d’accès — mais ne voit, n’ouvre ni ne modifie jamais un Fondateur ou un autre Administrateur. Chaque accès est journalisé, avec son nom.',
      },
      {
        id: 'rangs-changer',
        emoji: '🔁',
        titre: '« Changer le rang »',
        texte:
          'Fiche d’un compte › Rang : seuls les rangs permis sont proposés, avec ce que chacun permet. Nommer un Administrateur crée sa clé de séquestre et lui re-scelle les comptes inférieurs ; nommer un Fondateur demande une confirmation forte.',
        essayer: { genre: 'app', app: 'administration' },
        adminSeulement: true,
      },
      {
        id: 'rangs-transparence',
        emoji: '👁️',
        titre: 'Qui peut accéder à ton compte',
        texte:
          'Paramètres › Confidentialité le dit selon ton rang : « Les administrateurs et fondateurs peuvent accéder à ton compte » (amis), « Les fondateurs peuvent accéder à ton compte » (administrateurs), rien pour un Fondateur. Le dernier accès indique qui.',
      },
    ],
  },
  {
    version: '2026.10.04',
    date: '2026-10-04',
    titre: 'Tsuzuku arrive dans le hub',
    resume:
      'Animés et films dans une nouvelle app du hub : même mot de passe, mêmes profils, mêmes permissions, et aucun serveur. Votre bibliothèque reste dans votre compte chiffré.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'tsuzuku-app',
        emoji: '▶',
        titre: 'Animés et films, sans serveur',
        texte:
          'Catalogue, fiches, lecteur, bibliothèque avec « vu ailleurs » et statistiques : tout tourne sur votre appareil. Animés en couleurs vives, films en version cinéma sobre.',
        essayer: { genre: 'app', app: 'tsuzuku' },
      },
      {
        id: 'tsuzuku-liens',
        emoji: '🔗',
        titre: 'Vos liens, vos épisodes',
        texte:
          'Collez l’adresse d’un épisode : Tsuzuku en déduit celle des suivants. Pour un film, un lien direct suffit. Rien n’est préconfiguré : vous branchez ce que vous avez le droit d’utiliser.',
      },
      {
        id: 'tsuzuku-reglages',
        emoji: '⚙︎',
        titre: 'Réglages dans les Paramètres',
        texte: 'Clé TMDB facultative, VF ou VOSTFR, épisode suivant automatique, masquer les déjà vus : tout est dans Paramètres › Tsuzuku.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'tsuzuku-sources',
        emoji: '🧩',
        titre: 'Sources et import',
        texte: 'Les sources se règlent depuis l’app par l’administrateur, et l’ancienne bibliothèque Tsuzuku s’importe dans le profil ouvert. Les amis utilisent les sources de l’administrateur.',
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.03',
    date: '2026-10-03',
    titre: 'Le site, exactement comme le PC',
    resume:
      'Sur le site ou un téléphone, on retrouve son compte : même prénom, même mot de passe, même code. Les comptes, la politique des apps et le journal de l’Administration sont les mêmes partout.',
    illustration: 'isolation',
    fonctionnalites: [
      {
        id: 'site-relier',
        emoji: '🔗',
        titre: 'Relier un navigateur d’abord',
        texte:
          'Un navigateur neuf propose en premier « J’ai déjà un compte (le relier) » : le code du PC, une seule fois, puis l’écran prénom comme sur le PC. Un ancien coffre créé sur le site se remplace après une sauvegarde proposée.',
      },
      {
        id: 'site-comptes',
        emoji: '👥',
        titre: 'Comptes et Administration synchronisés',
        texte:
          'Un compte ajouté sur le PC apparaît sur le site (et inversement) ; accès, politique des apps, réglages et journal suivent. Rien n’est lisible sur le relais : empreintes, blocs scellés.',
        essayer: { genre: 'app', app: 'administration' },
        adminSeulement: true,
      },
      {
        id: 'site-code-ami',
        emoji: '🎟️',
        titre: 'Un code de connexion par ami',
        texte:
          'Fiche d’un compte › « Envoyer un code de connexion au site » : ce code n’ouvre que le compte de cet ami — jamais l’annuaire, ni les autres comptes, ni le vôtre.',
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.02',
    date: '2026-10-02',
    titre: 'Paramètres réunis et thème unique',
    resume:
      'Tous les réglages sont dans une seule page Paramètres, et un seul thème habille le hub, le portefeuille et l’administration. Au lancement, tout est déjà à sa place.',
    illustration: 'hub',
    fonctionnalites: [
      {
        id: 'parametres-unique',
        emoji: '⚙︎',
        titre: 'Une seule page Paramètres',
        texte:
          'Général, Synchronisation, Sécurité, Portefeuille, Administration, Nouveautés, À propos : chaque réglage a sa place, avec une recherche pour le retrouver (touche « / »). Le bouton Paramètres est le même dans le hub, le portefeuille et l’administration.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'theme-unique',
        emoji: '🎨',
        titre: 'Un thème pour toutes les pages',
        texte:
          'Le thème du hub s’applique aussi au portefeuille et à l’administration, et suit d’un appareil à l’autre. Le portefeuille garde son identité par sa couleur d’accent.',
        essayer: { genre: 'parametres' },
      },
      {
        id: 'demarrage-instantane',
        emoji: '⚡',
        titre: 'Thème appliqué dès le lancement',
        texte:
          'L’écran de connexion est déjà à votre thème, et la synchronisation démarre dès le déverrouillage : plus d’écran qui change de couleur quelques instants après l’ouverture.',
      },
      {
        id: 'synchro-partout',
        emoji: '✓',
        titre: 'Synchronisation visible partout',
        texte:
          'La pastille « À jour · il y a 2 min » est aussi dans le portefeuille et l’administration ; un clic ouvre Paramètres › Synchronisation.',
        adminSeulement: true,
      },
    ],
  },
  {
    version: '2026.10.01',
    date: '2026-10-01',
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
