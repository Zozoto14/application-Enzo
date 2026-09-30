/**
 * Recensement des réglages de l'application, regroupés en sections.
 *
 * Il y a UNE page « Paramètres » (dans le hub, ouverte depuis le bouton du
 * même nom de chaque page). Chaque réglage y a une place et une seule ; les
 * anciennes pages et cartes de réglages (panneau du hub, écran Réglages, écran
 * Alertes, réglages de l'Administration, cartes des écrans) n'existent plus et
 * renvoient ici par un lien « Ouvrir les Paramètres ».
 *
 * Données pures : la recherche, le regroupement et la visibilité selon le rôle
 * se testent sans rendu (voir `recensement.test.ts`). La page ne dessine que
 * ce que l'hôte déclare disponible (`disponibles`) : rien n'est proposé qui ne
 * marcherait pas sur la plateforme ou pour le rôle du compte.
 */

export type IdSection = 'general' | 'synchro' | 'securite' | 'portefeuille' | 'administration' | 'tsuzuku' | 'nouveautes' | 'support' | 'apropos';

export interface SectionParametres {
  id: IdSection;
  titre: string;
  icone: string;
  description: string;
}

/** Ordre d'affichage de la page. */
export const SECTIONS: readonly SectionParametres[] = [
  { id: 'general', titre: 'Général', icone: '⚙︎', description: 'Thème unique, disposition, langue, compte.' },
  { id: 'synchro', titre: 'Synchronisation', icone: '⇄', description: 'Appareils liés, synchronisation entre appareils.' },
  { id: 'securite', titre: 'Sécurité', icone: '🔒', description: 'Mot de passe, code d’authentification, récupération, sauvegardes.' },
  { id: 'portefeuille', titre: 'Portefeuille', icone: '▦', description: 'Cours, alertes, podcast, affichage des montants.' },
  { id: 'administration', titre: 'Administration', icone: '🛡', description: 'Panneau, comptes, journal, verrouillage.' },
  { id: 'tsuzuku', titre: 'Tsuzuku', icone: '▶', description: 'Catalogue de films, doublage, lecture, déjà vus.' },
  { id: 'nouveautes', titre: 'Nouveautés', icone: '✨', description: 'Historique des versions.' },
  { id: 'support', titre: 'Support', icone: '?', description: 'Écrire à l’équipe : bug, question, demande.' },
  { id: 'apropos', titre: 'À propos', icone: 'ⓘ', description: 'Version de l’application et mise à jour.' },
];

export type IdReglage =
  | 'theme'
  | 'tuiles'
  | 'langue'
  | 'compte'
  | 'visite'
  | 'synchro-etat'
  | 'synchro-appareils'
  | 'securite-coffre'
  | 'codes-recuperation'
  | 'sauvegarde-auto'
  | 'sauvegardes'
  | 'confidentialite'
  | 'cours-intervalle'
  | 'cours-fournisseur'
  | 'symboles'
  | 'historique-cours'
  | 'export-excel'
  | 'discretion'
  | 'notifications'
  | 'podcast'
  | 'admin-panel'
  | 'admin-reglages'
  | 'admin-comptes'
  | 'role-gestionnaire'
  | 'tsuzuku-tmdb'
  | 'tsuzuku-lecture'
  | 'nouveautes'
  | 'verrou-auto'
  | 'support'
  | 'juridique'
  | 'version'
  | 'mise-a-jour';

export interface Reglage {
  id: IdReglage;
  section: IdSection;
  titre: string;
  /** Phrase d'aide affichée et cherchée. */
  description: string;
  /** Mots qu'on pourrait taper pour le trouver (avec ou sans accents). */
  mots: readonly string[];
  /** Où il se trouvait avant la réunion (pour mémoire et pour les tests). */
  ancienEmplacement: readonly string[];
}

export const REGLAGES: readonly Reglage[] = [
  // --- Général
  {
    id: 'theme',
    section: 'general',
    titre: 'Thème',
    description: 'Un seul thème, appliqué au hub, au portefeuille, à l’administration et aux futures apps.',
    mots: ['apparence', 'couleurs', 'sombre', 'clair', 'nuit', 'ivoire', 'sauge', 'terminal', 'blocs', 'mode'],
    ancienEmplacement: ['Hub › Paramètres › Apparence', 'Hub › sélecteur de thème', 'Portefeuille › Paramètres › Apparence', 'Administration › Réglages › Apparence du hub'],
  },
  {
    id: 'tuiles',
    section: 'general',
    titre: 'Disposition et densité du hub',
    description: 'Grille ou liste, aéré ou compact, personnalisation et réinitialisation des tuiles.',
    mots: ['grille', 'liste', 'compact', 'aere', 'tuiles', 'personnaliser', 'ordre', 'epingler', 'masquer'],
    ancienEmplacement: ['Hub › Paramètres › Apparence (disposition, densité)', 'Hub › Personnaliser'],
  },
  {
    id: 'langue',
    section: 'general',
    titre: 'Langue et formats',
    description: 'Français, montants en euros, dates au format jour/mois/année.',
    mots: ['langue', 'francais', 'format', 'date', 'euro', 'devise', 'nombre'],
    ancienEmplacement: ['(réglage implicite, non modifiable)'],
  },
  {
    id: 'compte',
    section: 'general',
    titre: 'Compte et verrouillage',
    description: 'Compte ouvert, changer de compte, verrouiller maintenant.',
    mots: ['session', 'profil', 'verrouiller', 'deconnexion', 'utilisateur'],
    ancienEmplacement: ['Hub › Paramètres › Session', 'Hub › en-tête (Verrouiller, Changer de compte)'],
  },
  // --- Synchronisation
  {
    id: 'synchro-etat',
    section: 'synchro',
    titre: 'État de la synchronisation',
    description: 'Dernière synchronisation, changements en attente, synchroniser maintenant.',
    mots: ['synchroniser', 'maintenant', 'etat', 'en ligne', 'hors ligne', 'relais', 'attente'],
    ancienEmplacement: ['Hub › Paramètres › Synchronisation', 'Hub › en-tête (pastille)'],
  },
  {
    id: 'synchro-appareils',
    section: 'synchro',
    titre: 'Appareils liés',
    description: 'Relier un autre appareil, voir les appareils liés, en oublier un, désactiver la synchronisation.',
    mots: ['appareil', 'relier', 'lier', 'iphone', 'ipad', 'pc', 'qr', 'code', 'oublier', 'delier'],
    ancienEmplacement: ['Portefeuille › Paramètres › Synchronisation entre appareils'],
  },
  // --- Sécurité
  {
    id: 'securite-coffre',
    section: 'securite',
    titre: 'Mot de passe et code d’authentification',
    description: 'État de la protection du coffre : mot de passe, code TOTP, codes de récupération restants.',
    mots: ['mot de passe', 'totp', 'authentification', 'double', 'coffre', 'chiffrement', 'securite'],
    ancienEmplacement: ['Administration › Sécurité (état du coffre)'],
  },
  {
    id: 'codes-recuperation',
    section: 'securite',
    titre: 'Codes de récupération',
    description: 'Générer de nouveaux codes si vous avez oublié votre mot de passe ; les anciens cessent de marcher.',
    mots: ['recuperation', 'oublie', 'codes', 'secours', 'renouveler'],
    ancienEmplacement: ['Portefeuille › Paramètres › Codes de récupération'],
  },
  {
    id: 'verrou-auto',
    section: 'securite',
    titre: 'Verrouillage automatique',
    description: 'Verrouille l’application après un temps sans activité (45 minutes par défaut) ; pendant un film, elle demande d’abord si vous êtes toujours là.',
    mots: ['verrouillage', 'verrouiller', 'inactivite', 'automatique', 'minutes', 'delai', 'veille', 'presence', 'toujours la', 'film', 'serie'],
    ancienEmplacement: ['(nouveau : auparavant seul le panneau d’administration se verrouillait)'],
  },
  {
    id: 'sauvegarde-auto',
    section: 'securite',
    titre: 'Sauvegarde automatique',
    description: 'Sauvegarde chiffrée chaque semaine, protégée par un mot de passe.',
    mots: ['sauvegarde', 'automatique', 'hebdomadaire', 'backup', 'archive'],
    ancienEmplacement: ['Portefeuille › Sauvegarde › Sauvegarde automatique'],
  },
  {
    id: 'sauvegardes',
    section: 'securite',
    titre: 'Créer ou restaurer une sauvegarde',
    description: 'Exporter une sauvegarde chiffrée, restaurer ou fusionner une archive.',
    mots: ['sauvegarde', 'restaurer', 'fusionner', 'archive', 'exporter', 'dossier'],
    ancienEmplacement: ['Portefeuille › Sauvegarde'],
  },
  {
    id: 'confidentialite',
    section: 'securite',
    titre: 'Confidentialité de votre compte',
    description: 'Qui peut accéder à votre compte (selon votre rang), et dernier accès.',
    mots: ['confidentialite', 'transparence', 'acces', 'admin', 'audit'],
    ancienEmplacement: ['Hub › Paramètres › Confidentialité'],
  },
  // --- Portefeuille
  {
    id: 'cours-intervalle',
    section: 'portefeuille',
    titre: 'Actualisation des cours',
    description: 'Rythme de relecture des cours tant que la fenêtre est ouverte.',
    mots: ['actualisation', 'rafraichir', 'cours', 'intervalle', 'frequence', 'minutes'],
    ancienEmplacement: ['Portefeuille › Paramètres › Cours automatiques'],
  },
  {
    id: 'cours-fournisseur',
    section: 'portefeuille',
    titre: 'Fournisseur de cotations et clé d’API',
    description: 'Choisir le fournisseur de cours et renseigner sa clé (conservée dans la base chiffrée).',
    mots: ['fournisseur', 'cle', 'api', 'cotations', 'yahoo', 'alpha', 'cours', 'donnees'],
    ancienEmplacement: ['Portefeuille › Paramètres › Fournisseur'],
  },
  {
    id: 'symboles',
    section: 'portefeuille',
    titre: 'Symboles de cotation',
    description: 'Dire à quel marché demander le cours de chaque valeur.',
    mots: ['symbole', 'ticker', 'marche', 'cotation', 'valeur'],
    ancienEmplacement: ['Portefeuille › Paramètres › Symboles de cotation'],
  },
  {
    id: 'historique-cours',
    section: 'portefeuille',
    titre: 'Historique des cours',
    description: 'Charger deux ans d’historique pour les onglets Performances et Risque.',
    mots: ['historique', 'performance', 'risque', 'charger', 'cours', 'annees'],
    ancienEmplacement: ['Portefeuille › Paramètres › Historique des cours'],
  },
  {
    id: 'export-excel',
    section: 'portefeuille',
    titre: 'Export Excel',
    description: 'Tout le portefeuille dans un fichier .xlsx : positions, opérations, dividendes, comptes.',
    mots: ['excel', 'xlsx', 'exporter', 'tableur', 'fichier'],
    ancienEmplacement: ['Portefeuille › Paramètres › Exporter'],
  },
  {
    id: 'discretion',
    section: 'portefeuille',
    titre: 'Masquer les valeurs',
    description: 'Mode discret : les montants en euros sont masqués à l’écran.',
    mots: ['discret', 'masquer', 'montants', 'euros', 'cacher', 'confidentiel'],
    ancienEmplacement: ['Portefeuille › barre latérale (Masquer les €)'],
  },
  {
    id: 'notifications',
    section: 'portefeuille',
    titre: 'Notifications et alertes',
    description: 'Briefings, seuils de prix et de variation, alertes d’événements, démarrage avec Windows, zone de notification.',
    mots: ['alertes', 'notification', 'briefing', 'seuil', 'variation', 'evenements', 'dividendes', 'resultats', 'demarrage', 'plateau', 'windows'],
    ancienEmplacement: ['Portefeuille › Alertes (écran Notifications)'],
  },
  {
    id: 'podcast',
    section: 'portefeuille',
    titre: 'Podcast automatique',
    description: 'Préparer chaque jour le podcast à une heure donnée.',
    mots: ['podcast', 'heure', 'automatique', 'episode', 'quotidien', 'audio'],
    ancienEmplacement: ['Portefeuille › Podcast › Préparer automatiquement'],
  },
  {
    id: 'visite',
    section: 'portefeuille',
    titre: 'Visite guidée',
    description: 'Revoir la visite des nouveautés de l’application.',
    mots: ['tutoriel', 'aide', 'decouverte', 'visite', 'nouveautes'],
    ancienEmplacement: ['Portefeuille › Paramètres › Revoir la visite'],
  },
  // --- Administration
  {
    id: 'admin-panel',
    section: 'administration',
    titre: 'Panneau d’administration',
    description: 'Ouvrir l’Administration : comptes, accès aux apps, journal.',
    mots: ['administration', 'panneau', 'comptes', 'acces', 'apps', 'permissions'],
    ancienEmplacement: ['Hub › Paramètres › Raccourcis'],
  },
  {
    id: 'admin-reglages',
    section: 'administration',
    titre: 'Réglages de l’Administration',
    description: 'Rétention du journal, verrouillage du panneau, validité de l’identité, comptes inactifs, invitations.',
    mots: ['journal', 'retention', 'verrouillage', 'inactivite', 'identite', 'invitation', 'inactif', 'audit'],
    ancienEmplacement: ['Administration › Réglages'],
  },
  {
    id: 'admin-comptes',
    section: 'administration',
    titre: 'Comptes des proches',
    description: 'Ajouter un ami : il a son propre espace chiffré, son mot de passe et son code.',
    mots: ['ami', 'ajouter', 'profil', 'compte', 'proche', 'inviter'],
    ancienEmplacement: ['Portefeuille › Paramètres › Profils'],
  },
  {
    id: 'role-gestionnaire',
    section: 'administration',
    titre: 'Votre rang',
    description: 'Ce que permet, et interdit, votre rang (Gestionnaire, Administrateur, Fondateur).',
    mots: ['gestionnaire', 'administrateur', 'fondateur', 'rang', 'role', 'droits', 'limite'],
    ancienEmplacement: ['Hub › Paramètres › Ton rôle'],
  },
  // --- Tsuzuku
  {
    id: 'tsuzuku-tmdb',
    section: 'tsuzuku',
    titre: 'Clé TMDB (films)',
    description: 'Clé facultative pour tout le catalogue de films ; sans elle, seuls les films d’animation (Jikan) sont proposés.',
    mots: ['tmdb', 'cle', 'films', 'catalogue', 'api', 'cinema', 'jeton'],
    ancienEmplacement: ['Tsuzuku › Réglages (clé TMDB)'],
  },
  {
    id: 'tsuzuku-lecture',
    section: 'tsuzuku',
    titre: 'Lecture et catalogue',
    description: 'Doublage préféré (VF ou VOSTFR), épisode suivant automatique, masquer les titres déjà vus.',
    mots: ['tsuzuku', 'anime', 'animes', 'vf', 'vostfr', 'doublage', 'langue', 'episode', 'suivant', 'automatique', 'deja vus', 'masquer', 'streaming'],
    ancienEmplacement: ['Tsuzuku › Réglages (lecture)'],
  },
  // --- Nouveautés
  {
    id: 'nouveautes',
    section: 'nouveautes',
    titre: 'Historique des nouveautés',
    description: 'Ce qu’apporte chaque version, avec « Essayer » pour ouvrir la fonctionnalité.',
    mots: ['devblog', 'versions', 'changements', 'patch', 'notes', 'quoi de neuf'],
    ancienEmplacement: ['Hub › Paramètres › Nouveautés'],
  },
  // --- Support
  {
    id: 'support',
    section: 'support',
    titre: 'Support et tickets',
    description: 'Écrire à l’équipe (bug, question, demande) et retrouver vos tickets.',
    mots: ['support', 'ticket', 'aide', 'bug', 'probleme', 'question', 'contact', 'discord', 'signaler', 'assistance'],
    ancienEmplacement: ['(nouveau)'],
  },
  // --- À propos
  {
    id: 'juridique',
    section: 'apropos',
    titre: 'Conditions, confidentialité et mentions légales',
    description: 'Conditions d’utilisation, politique de confidentialité, cookies et stockage local, mentions légales.',
    mots: ['conditions', 'cgu', 'confidentialite', 'cookies', 'mentions', 'legales', 'rgpd', 'donnees', 'privee', 'juridique', 'stockage'],
    ancienEmplacement: ['(nouveau)'],
  },
  {
    id: 'version',
    section: 'apropos',
    titre: 'Version',
    description: 'Numéro de version de l’application en service.',
    mots: ['version', 'build', 'commit', 'numero'],
    ancienEmplacement: ['Hub › Paramètres › Application'],
  },
  {
    id: 'mise-a-jour',
    section: 'apropos',
    titre: 'Mise à jour',
    description: 'Vérifier les mises à jour, installer et redémarrer, ou actualiser l’app.',
    mots: ['mettre a jour', 'maj', 'actualiser', 'installer', 'redemarrer', 'recharger'],
    ancienEmplacement: ['Hub › Mettre à jour', 'Hub › Paramètres › Application', 'Portefeuille › Paramètres › Mises à jour'],
  },
];

const PAR_ID = new Map<IdReglage, Reglage>(REGLAGES.map(reglage => [reglage.id, reglage]));

export function reglage(id: IdReglage): Reglage {
  return PAR_ID.get(id)!;
}

export function section(id: IdSection): SectionParametres {
  return SECTIONS.find(candidate => candidate.id === id)!;
}

export function sectionDe(id: IdReglage): IdSection {
  return reglage(id).section;
}

/** Minuscules, sans accents ni ponctuation : « Récupération » et « recuperation » se valent. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vrai si tous les mots de la requête se retrouvent dans le réglage (titre, aide, mots-clés, section). */
export function correspond(r: Reglage, requete: string): boolean {
  const mots = normaliser(requete).split(' ').filter(Boolean);
  if (mots.length === 0) {
    return true;
  }
  const foin = normaliser([r.titre, r.description, ...r.mots, section(r.section).titre].join(' '));
  return mots.every(mot => foin.includes(mot));
}

/** Réglages proposés, dans l'ordre des sections. */
export function reglagesDisponibles(disponibles: ReadonlySet<IdReglage> | readonly IdReglage[]): Reglage[] {
  const ensemble = new Set<IdReglage>(disponibles);
  return SECTIONS.flatMap(s => REGLAGES.filter(r => r.section === s.id && ensemble.has(r.id)));
}

export function reglagesDeSection(id: IdSection, disponibles: ReadonlySet<IdReglage> | readonly IdReglage[]): Reglage[] {
  return reglagesDisponibles(disponibles).filter(r => r.section === id);
}

/** Sections qui ont au moins un réglage disponible. */
export function sectionsVisibles(disponibles: ReadonlySet<IdReglage> | readonly IdReglage[]): SectionParametres[] {
  const ensemble = new Set(reglagesDisponibles(disponibles).map(r => r.section));
  return SECTIONS.filter(s => ensemble.has(s.id));
}

/** Résultat d'une recherche, regroupé par section (les sections sans résultat disparaissent). */
export function rechercher(
  requete: string,
  disponibles: ReadonlySet<IdReglage> | readonly IdReglage[],
): Array<{ section: SectionParametres; reglages: Reglage[] }> {
  const trouves = reglagesDisponibles(disponibles).filter(r => correspond(r, requete));
  return SECTIONS.map(s => ({ section: s, reglages: trouves.filter(r => r.section === s.id) })).filter(groupe => groupe.reglages.length > 0);
}
