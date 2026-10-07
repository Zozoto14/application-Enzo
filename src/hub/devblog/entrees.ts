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
    version: '2026.10.13',
    date: '2026-10-13',
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
