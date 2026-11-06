/**
 * Tickets : catégories PAR DÉFAUT (modèles), bilingues, avec un formulaire Discord prêt à l'emploi (5 champs au plus ;
 * libellé ≤ 45 caractères, texte d'exemple ≤ 100, réponse ≤ 4000 : limites des fenêtres Discord, vérifiées par les
 * tests et par validerCategorie).
 *
 *  - semées AUTOMATIQUEMENT (sauf les catégories d'ÉVÉNEMENT, `evenement: true`, comme « Inscription The Nuke End ») à la première lecture de la configuration quand il n'existe encore AUCUNE catégorie (une
 *    seule fois : réglage `categories_defaut`) ; une installation qui a déjà des catégories n'est jamais touchée ;
 *  - ajoutables à tout moment (Configuration › Catégories › « Catégories par défaut ») : celles cochées sont créées,
 *    sauf si une catégorie du même nom (français ou anglais) existe déjà.
 *
 * Qui traite chaque catégorie (rôles Discord, rôles de l'app) reste à choisir, sauf deux évidences (rôles système du
 * catalogue, gardés seulement s'ils existent) : Contenu & médias → « Responsable CM », Partenariat & sponsoring →
 * « Second CEO » (le Fondateur voit tout). Tout reste modifiable ensuite.
 */

const court = (id, libelle, placeholder, { requis = true, min = 0, max = 100 } = {}) => ({ id, libelle, placeholder, style: 'court', requis, min, max });
const long = (id, libelle, placeholder, { requis = true, max = 1500 } = {}) => ({ id, libelle, placeholder, style: 'long', requis, min: 0, max });
const JEU = { fr: 'Jeu (Valorant ou The Finals)', en: 'Game (Valorant or The Finals)' };

export const CATEGORIES_DEFAUT = Object.freeze([
  {
    cle: 'support',
    nom: { fr: 'Support général', en: 'General support' },
    description: { fr: 'Une question sur le club, son fonctionnement ou ses activités', en: 'A question about the club, how it works or its activities' },
    icone: 'question',
    couleur: '#5865f2',
    modeleNom: 'support-{numero}-{pseudo}',
    formulaire: [
      court('sujet', { fr: 'Sujet de votre demande', en: 'Subject of your request' }, { fr: 'Ex. : entraînements, événements à venir, rôles Discord', en: 'E.g. training sessions, upcoming events, Discord roles' }),
      long('details', { fr: 'Votre question en détail', en: 'Your question in detail' }, { fr: 'Donnez-nous le plus de contexte possible.', en: 'Give us as much context as possible.' }),
    ],
  },
  {
    cle: 'recrutement',
    nom: { fr: 'Recrutement joueur', en: 'Player recruitment' },
    description: { fr: 'Rejoindre une équipe Valorant ou The Finals du club', en: 'Join one of the club’s Valorant or The Finals teams' },
    icone: 'manette',
    couleur: '#e8a23a',
    modeleNom: 'recrutement-{numero}-{pseudo}',
    formulaire: [
      court('jeu', JEU, { fr: 'Valorant ou The Finals', en: 'Valorant or The Finals' }, { max: 30 }),
      court('pseudo_rang', { fr: 'Pseudo en jeu et rang / elo actuel', en: 'In-game name and current rank / elo' }, { fr: 'Ex. : Pseudo#TAG, Ascendant 2', en: 'E.g. Name#TAG, Ascendant 2' }),
      court('role', { fr: 'Rôle ou main', en: 'Role or main' }, { fr: 'Ex. : duelliste, contrôleur, ou Light / Medium / Heavy', en: 'E.g. duelist, controller, or Light / Medium / Heavy' }),
      court('dispos', { fr: 'Disponibilités (jours et horaires)', en: 'Availability (days and times)' }, { fr: 'Ex. : du lundi au jeudi, 20 h - 23 h', en: 'E.g. Monday to Thursday, 8 pm - 11 pm' }, { max: 200 }),
      long('experience', { fr: 'Expérience et lien tracker', en: 'Experience and tracker link' }, { fr: 'Équipes passées, tournois joués, lien vers votre profil de statistiques', en: 'Past teams, tournaments played, link to your stats profile' }, { requis: false, max: 1000 }),
    ],
  },
  {
    cle: 'staff',
    nom: { fr: 'Candidature staff', en: 'Staff application' },
    description: { fr: 'Rejoindre le staff : CM, coach, analyste, manager, graphiste, monteur…', en: 'Join the staff: CM, coach, analyst, manager, designer, video editor…' },
    icone: 'membres',
    couleur: '#9b59b6',
    modeleNom: 'staff-{numero}-{pseudo}',
    formulaire: [
      court('poste', { fr: 'Poste visé', en: 'Position you are applying for' }, { fr: 'CM, coach, analyste, manager, graphiste, monteur…', en: 'CM, coach, analyst, manager, designer, video editor…' }),
      long('experience', { fr: 'Votre expérience', en: 'Your experience' }, { fr: 'Ce que vous avez déjà fait dans ce rôle (club, projet, études…)', en: 'What you have already done in this role (club, project, studies…)' }),
      court('portfolio', { fr: 'Portfolio ou réalisations (lien)', en: 'Portfolio or past work (link)' }, { fr: 'Lien vers vos travaux, si vous en avez', en: 'Link to your work, if you have any' }, { requis: false, max: 300 }),
      court('dispos', { fr: 'Disponibilités par semaine', en: 'Weekly availability' }, { fr: 'Ex. : 5 h par semaine, surtout le soir', en: 'E.g. 5 hours a week, mostly evenings' }, { max: 200 }),
      long('motivation', { fr: 'Votre motivation', en: 'Your motivation' }, { fr: 'Pourquoi le club, et ce que vous voulez y apporter', en: 'Why the club, and what you want to bring to it' }),
    ],
  },
  {
    cle: 'partenariat',
    nom: { fr: 'Partenariat & sponsoring', en: 'Partnership & sponsorship' },
    description: { fr: 'Proposer un partenariat ou un sponsoring au club', en: 'Offer the club a partnership or sponsorship' },
    icone: 'partenaires',
    couleur: '#c99a1e',
    modeleNom: 'partenariat-{numero}-{pseudo}',
    fermetureAutoH: 0,
    fermetureStaffSeul: true,
    rolesApp: ['club:role-global-second-ceo'],
    liaison: { type: 'sponsors' },
    formulaire: [
      court('entreprise', { fr: 'Entreprise ou marque', en: 'Company or brand' }, { fr: 'Nom de votre entreprise, marque ou organisation', en: 'Name of your company, brand or organisation' }),
      court('contact', { fr: 'Nom et fonction du contact', en: 'Contact name and position' }, { fr: 'Ex. : Camille Martin, responsable marketing', en: 'E.g. Alex Smith, marketing manager' }, { max: 150 }),
      long('proposition', { fr: 'Votre proposition', en: 'Your proposal' }, { fr: 'Ce que vous proposez au club et ce que vous en attendez', en: 'What you offer the club and what you expect in return' }, { max: 2000 }),
      court('site', { fr: 'Site web ou réseaux', en: 'Website or social media' }, { fr: 'Lien vers votre site ou vos réseaux', en: 'Link to your website or social media' }, { requis: false, max: 200 }),
      court('type_budget', { fr: 'Type de partenariat et budget envisagé', en: 'Partnership type and planned budget' }, { fr: 'Ex. : matériel, dotation, financier ; ordre de grandeur', en: 'E.g. gear, prizes, financial; rough amount' }, { requis: false, max: 150 }),
    ],
  },
  {
    cle: 'signalement',
    nom: { fr: 'Signalement', en: 'Report' },
    description: { fr: 'Signaler un comportement ou un problème (non anonyme)', en: 'Report a behaviour or an issue (not anonymous)' },
    icone: 'alerte',
    couleur: '#d9534f',
    modeleNom: 'signalement-{numero}',
    prioriteDefaut: 'urgent',
    formulaire: [
      court('qui', { fr: 'Personne(s) concernée(s)', en: 'Person(s) involved' }, { fr: 'Pseudo Discord ou en jeu', en: 'Discord or in-game name' }, { max: 150 }),
      long('quoi', { fr: 'Ce qui s’est passé', en: 'What happened' }, { fr: 'Décrivez les faits le plus précisément possible.', en: 'Describe what happened as precisely as possible.' }, { max: 2000 }),
      court('quand', { fr: 'Quand ? (date et heure approximatives)', en: 'When? (approximate date and time)' }, { fr: 'Ex. : hier vers 21 h, pendant un match', en: 'E.g. yesterday around 9 pm, during a match' }),
      long('preuves', { fr: 'Preuves (liens vers captures ou vidéos)', en: 'Evidence (links to screenshots or videos)' }, { fr: 'Collez les liens de vos captures ou vidéos', en: 'Paste the links to your screenshots or videos' }, { requis: false, max: 1000 }),
    ],
  },
  {
    cle: 'scrim',
    nom: { fr: 'Scrim & tournoi', en: 'Scrim & tournament' },
    description: { fr: 'Proposer un scrim ou inviter le club à un tournoi', en: 'Offer a scrim or invite the club to a tournament' },
    icone: 'trophee',
    couleur: '#4caf7a',
    modeleNom: 'scrim-{numero}-{pseudo}',
    formulaire: [
      court('equipe', { fr: 'Nom de votre équipe ou organisation', en: 'Your team or organisation name' }, { fr: 'Nom de l’équipe, de l’organisation ou du tournoi', en: 'Name of the team, organisation or tournament' }),
      court('jeu', JEU, { fr: 'Valorant ou The Finals', en: 'Valorant or The Finals' }, { max: 30 }),
      court('date', { fr: 'Date et heure souhaitées', en: 'Preferred date and time' }, { fr: 'Ex. : samedi 14 à 20 h (heure de Paris)', en: 'E.g. Saturday 14th at 8 pm (Paris time)' }),
      court('format', { fr: 'Format (BO1, BO3, nombre de maps…)', en: 'Format (BO1, BO3, number of maps…)' }, { fr: 'Ex. : BO3, maps au choix, niveau de l’équipe', en: 'E.g. BO3, map picks, team level' }, { max: 150 }),
      court('contact', { fr: 'Contact (Discord ou autre)', en: 'Contact (Discord or other)' }, { fr: 'La personne à contacter pour organiser', en: 'The person to contact to organise it' }, { max: 150 }),
    ],
  },
  {
    cle: 'contenu',
    nom: { fr: 'Contenu & médias', en: 'Content & media' },
    description: { fr: 'Proposer un clip, une interview ou une collaboration à l’équipe CM', en: 'Suggest a clip, an interview or a collab to the CM team' },
    icone: 'megaphone',
    couleur: '#db2777',
    modeleNom: 'contenu-{numero}-{pseudo}',
    rolesApp: ['cm:cm-role-responsable'],
    formulaire: [
      court('type', { fr: 'Type de demande', en: 'Type of request' }, { fr: 'Clip, interview, collaboration, autre', en: 'Clip, interview, collaboration, other' }),
      long('description', { fr: 'Votre proposition en détail', en: 'Your proposal in detail' }, { fr: 'L’idée, le public visé, ce que vous attendez du club', en: 'The idea, the audience, what you expect from the club' }),
      court('lien', { fr: 'Lien (clip, chaîne, réseaux)', en: 'Link (clip, channel, social media)' }, { fr: 'Lien vers le clip ou vers vos réseaux', en: 'Link to the clip or to your social media' }, { requis: false, max: 300 }),
      court('echeance', { fr: 'Échéance éventuelle', en: 'Deadline, if any' }, { fr: 'Ex. : avant la fin du mois', en: 'E.g. before the end of the month' }, { requis: false }),
    ],
  },
  {
    cle: 'appdashboard',
    nom: { fr: 'Problème AppDashboard', en: 'AppDashboard issue' },
    description: { fr: 'Un bug ou une difficulté sur l’AppDashboard', en: 'A bug or a difficulty with the AppDashboard' },
    icone: 'bug',
    couleur: '#0d9488',
    modeleNom: 'app-{numero}-{pseudo}',
    formulaire: [
      court('page', { fr: 'Page ou fonction concernée', en: 'Page or feature concerned' }, { fr: 'Ex. : Planning, Tickets, Drive', en: 'E.g. Planning, Tickets, Drive' }),
      long('probleme', { fr: 'Ce qui s’est passé', en: 'What happened' }, { fr: 'Ce que vous attendiez, et ce qui s’est passé à la place', en: 'What you expected, and what happened instead' }),
      long('etapes', { fr: 'Étapes pour reproduire', en: 'Steps to reproduce' }, { fr: '1. J’ouvre… 2. Je clique sur… 3. …', en: '1. I open… 2. I click… 3. …' }, { requis: false }),
      court('appareil', { fr: 'Appareil et navigateur', en: 'Device and browser' }, { fr: 'Ex. : téléphone Android, application de bureau', en: 'E.g. Android phone, desktop app' }, { requis: false }),
    ],
  },
  {
    // Événement : jamais semé automatiquement (seulement depuis « Catégories par défaut » ou le panneau « The Nuke End »).
    cle: 'the-nuke-end',
    evenement: true,
    nom: { fr: 'Inscription The Nuke End', en: 'The Nuke End registration' },
    description: { fr: 'Inscrire son équipe au tournoi The Finals The Nuke End (3v3v3v3)', en: 'Register your team for The Nuke End, a The Finals tournament (3v3v3v3)' },
    icone: 'trophee',
    couleur: '#e4572e',
    modeleNom: 'nuke-end-{numero}-{pseudo}',
    fermetureAutoH: 0,
    fermetureStaffSeul: true,
    accueil: {
      fr: 'Bonjour {utilisateur}, merci pour l’inscription de votre équipe à The Nuke End (ticket n° {numero}).\n\nDernière étape : envoyez le logo de votre équipe sous forme de lien vers l’image (hébergement d’images ou lien de partage public).\n\nLe staff vérifie votre équipe (joueurs, Discord ID et Embark ID) et vous confirmera l’inscription ici même.',
      en: 'Hi {utilisateur}, thanks for registering your team for The Nuke End (ticket #{numero}).\n\nOne last step: send your team logo as a link to the image (image host or public sharing link).\n\nThe staff will check your team (players, Discord IDs and Embark IDs) and confirm your registration right here.',
    },
    formulaire: [
      court('equipe', { fr: 'Nom de l’équipe', en: 'Team name' }, { fr: 'Nom complet de votre équipe ou organisation', en: 'Full name of your team or organisation' }, { max: 50 }),
      court('tag', { fr: 'TAG (3 à 4 lettres)', en: 'TAG (3 to 4 letters)' }, { fr: 'Ex. : LZ0', en: 'E.g. LZ0' }, { min: 3, max: 4 }),
      long('joueurs', { fr: 'Joueurs 1 à 3', en: 'Players 1 to 3' }, { fr: 'Une ligne par joueur : Discord ID — Embark ID (ex. pseudo#1234)', en: 'One line per player: Discord ID — Embark ID (e.g. name#1234)' }, { max: 600 }),
      court('coach', { fr: 'Coach (facultatif)', en: 'Coach (optional)' }, { fr: 'Discord ID — Embark ID', en: 'Discord ID — Embark ID' }, { requis: false, max: 200 }),
      long('remplacants', { fr: 'Remplaçants (facultatif)', en: 'Subs (optional)' }, { fr: 'Sub 1 et Sub 2 : Discord ID — Embark ID, une ligne chacun', en: 'Sub 1 and Sub 2: Discord ID — Embark ID, one line each' }, { requis: false, max: 400 }),
    ],
  },
  {
    cle: 'autre',
    nom: { fr: 'Autre', en: 'Other' },
    description: { fr: 'Toute autre demande', en: 'Any other request' },
    icone: 'bulle',
    couleur: '#8b8b9a',
    modeleNom: 'ticket-{numero}-{pseudo}',
    formulaire: [
      court('sujet', { fr: 'Sujet', en: 'Subject' }, { fr: 'En quelques mots', en: 'In a few words' }),
      long('details', { fr: 'Votre demande en détail', en: 'Your request in detail' }, { fr: 'Expliquez-nous ce dont vous avez besoin.', en: 'Tell us what you need.' }),
    ],
  },
]);

/** Corps de création d'une catégorie (validerCategorie) à partir d'un modèle ; `rolesExistants` : clés `club:`/`cm:` présentes. */
export function corpsModele(m, rolesExistants = new Set()) {
  return {
    nom: m.nom,
    description: m.description,
    icone: m.icone,
    couleur: m.couleur,
    actif: true,
    modeleNom: m.modeleNom,
    formulaire: m.formulaire,
    ...(m.accueil ? { accueil: m.accueil } : {}),
    fermetureAutoH: m.fermetureAutoH ?? null,
    fermetureStaffSeul: m.fermetureStaffSeul === true,
    prioriteDefaut: m.prioriteDefaut ?? 'moyen',
    rolesApp: (m.rolesApp ?? []).filter(r => rolesExistants.has(r)),
    rolesDiscord: [],
    liaison: m.liaison ?? { type: 'aucune' },
    satisfaction: true,
    maxOuverts: 1,
  };
}

/** Nom normalisé (comparaison des doublons : casse, accents, espaces). */
export const nomNormalise = v =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Catégories semées sur une installation vide, et listées par le panneau « Support LZ » : tout sauf les événements. */
export const CLES_SEMEES = Object.freeze(CATEGORIES_DEFAUT.filter(m => !m.evenement).map(m => m.cle));

// ------------------------------------------------------------------ Panneaux par défaut

/**
 * Panneaux PAR DÉFAUT (Configuration › Panneaux › « Panneaux par défaut ») : texte bilingue prêt à publier, catégories
 * désignées par leur clé de modèle (retrouvées par leur nom, français ou anglais, comme les doublons). Le panneau créé
 * s'ouvre dans l'éditeur : rien n'est publié tant que personne n'a choisi le salon et cliqué sur « Publier ».
 *
 *  - `categories` : clés de CATEGORIES_DEFAUT, ou 'toutes' (toutes les catégories actives, dans leur ordre ; les modèles
 *    manquants proposés sont alors CLES_SEMEES) ;
 *  - `style` : 'boutons', 'menu', ou 'auto' (menu au-delà de 5 catégories) ;
 *  - `evenement` : le nom de l'événement est demandé (variable {evenement} du titre et du texte) et la catégorie peut
 *    être choisie parmi celles qui existent ; `evenementFixe` : nom déjà connu (panneau prêt d'un tournoi) ;
 *  - `libelleBouton` : libellé du bouton à la place du nom de la catégorie (panneau à une catégorie) ;
 *  - variables du texte remplies à la création : {reponse} (consigne selon « Répondre uniquement depuis
 *    l'AppDashboard ») et {horaires} (ligne retirée quand les horaires du support ne sont pas actifs).
 *
 * Limites vérifiées par les tests : titre ≤ 256 (une fois {evenement} rempli, 100 caractères au plus), texte ≤ 1800 par
 * langue (validerPanneau ; l'embed Discord en accepte 4096), libellé de bouton ≤ 80.
 */
export const PANNEAUX_DEFAUT = Object.freeze([
  {
    cle: 'support',
    nom: { fr: 'Support LZ — Centre d’aide', en: 'LZ Support — Help center' },
    description: { fr: 'Le panneau principal : toutes les catégories actives, dans leur ordre', en: 'The main panel: every active category, in order' },
    titre: { fr: 'Centre d’aide LZ', en: 'LZ Help Center' },
    texte: {
      fr: [
        'Une question, une candidature, un partenariat ou un problème à signaler ? Ouvrez un ticket pour échanger en privé avec le staff de LZ.',
        '',
        '**Comment ça marche**',
        '1. Choisissez ci-dessous la catégorie qui correspond à votre demande.',
        '2. Remplissez le court formulaire qui s’affiche : plus il est précis, plus la réponse sera rapide.',
        '3. Un salon privé s’ouvre, visible uniquement par vous et par l’équipe concernée.',
        '4. {reponse}',
        '',
        '**Quelques règles**',
        '- Un seul ticket par sujet : inutile d’en ouvrir plusieurs pour la même demande.',
        '- Restez courtois et respectueux envers le staff comme envers les autres membres.',
        '- Pas de spam ni de mentions répétées : chaque ticket est traité dans l’ordre.',
        '{horaires}',
      ].join('\n'),
      en: [
        'A question, an application, a partnership or an issue to report? Open a ticket to talk privately with the LZ staff.',
        '',
        '**How it works**',
        '1. Pick the category that matches your request below.',
        '2. Fill in the short form that appears: the more precise it is, the faster the answer.',
        '3. A private channel opens, visible only to you and the team in charge.',
        '4. {reponse}',
        '',
        '**A few rules**',
        '- One ticket per subject: no need to open several for the same request.',
        '- Stay polite and respectful towards the staff and the other members.',
        '- No spam or repeated mentions: tickets are handled in order.',
        '{horaires}',
      ].join('\n'),
    },
    couleur: '#0c66e4',
    style: 'auto',
    categories: 'toutes',
  },
  {
    cle: 'recrutement',
    nom: { fr: 'Recrutement', en: 'Recruitment' },
    description: { fr: 'Recrutement joueur et candidature staff, en boutons', en: 'Player recruitment and staff applications, as buttons' },
    titre: { fr: 'Rejoindre LZ', en: 'Join LZ' },
    texte: {
      fr: [
        'LZ recrute des joueurs pour ses équipes Valorant et The Finals, et des profils pour renforcer son staff : CM, coach, analyste, manager, graphiste, monteur.',
        '',
        '**Pour postuler**',
        '1. Cliquez sur le bouton qui correspond à votre candidature.',
        '2. Remplissez le formulaire : pseudo, rang, rôle, disponibilités, expérience.',
        '3. Un salon privé s’ouvre avec l’équipe de recrutement. {reponse}',
        '',
        'Une seule candidature à la fois, merci. Chaque dossier est lu, et nous revenons vers vous dans le ticket.',
        '{horaires}',
      ].join('\n'),
      en: [
        'LZ is recruiting players for its Valorant and The Finals teams, and people to strengthen its staff: CM, coach, analyst, manager, designer, video editor.',
        '',
        '**How to apply**',
        '1. Click the button that matches your application.',
        '2. Fill in the form: name, rank, role, availability, experience.',
        '3. A private channel opens with the recruitment team. {reponse}',
        '',
        'One application at a time, please. Every application is read, and we will get back to you in the ticket.',
        '{horaires}',
      ].join('\n'),
    },
    couleur: '#e8a23a',
    style: 'boutons',
    categories: ['recrutement', 'staff'],
  },
  {
    cle: 'partenariats',
    nom: { fr: 'Partenariats', en: 'Partnerships' },
    description: { fr: 'Partenariat & sponsoring, un seul bouton', en: 'Partnership & sponsorship, a single button' },
    titre: { fr: 'Partenariats et sponsoring', en: 'Partnerships and sponsorship' },
    texte: {
      fr: [
        'Vous représentez une marque, une entreprise ou une organisation et souhaitez soutenir LZ ou construire un projet avec le club ?',
        '',
        'Cliquez sur le bouton ci-dessous et présentez votre proposition : entreprise, contact, ce que vous proposez et ce que vous attendez en retour. Un salon privé s’ouvre avec la direction du club. {reponse}',
        '',
        'Les demandes de partenariat restent ouvertes jusqu’à ce que le staff les clôture.',
        '{horaires}',
      ].join('\n'),
      en: [
        'Do you represent a brand, a company or an organisation and want to support LZ or build a project with the club?',
        '',
        'Click the button below and present your proposal: company, contact, what you offer and what you expect in return. A private channel opens with the club management. {reponse}',
        '',
        'Partnership requests stay open until the staff closes them.',
        '{horaires}',
      ].join('\n'),
    },
    couleur: '#c99a1e',
    style: 'boutons',
    categories: ['partenariat'],
  },
  {
    cle: 'evenement',
    nom: { fr: 'Tournoi / Événement', en: 'Tournament / Event' },
    description: { fr: 'Inscription à un événement : nom de l’événement et catégorie à choisir', en: 'Event registration: choose the event name and the category' },
    evenement: true,
    titre: { fr: 'Inscription — {evenement}', en: 'Registration — {evenement}' },
    texte: {
      fr: [
        'Les inscriptions pour **{evenement}** sont ouvertes.',
        '',
        'Cliquez sur « S’inscrire » et remplissez le formulaire. Un salon privé s’ouvre avec les organisateurs. {reponse}',
        '',
        'Votre inscription est confirmée par le staff dans le ticket : tant qu’elle n’est pas validée, elle n’est pas définitive.',
      ].join('\n'),
      en: [
        'Registrations for **{evenement}** are open.',
        '',
        'Click “Register” and fill in the form. A private channel opens with the organisers. {reponse}',
        '',
        'The staff confirms your registration in the ticket: until it is validated, it is not final.',
      ].join('\n'),
    },
    couleur: '#4caf7a',
    style: 'boutons',
    categories: ['scrim'],
    libelleBouton: { fr: 'S’inscrire', en: 'Register' },
  },
  {
    cle: 'the-nuke-end',
    nom: { fr: 'The Nuke End — Inscription', en: 'The Nuke End — Registration' },
    description: { fr: 'Tournoi The Finals 3v3v3v3 : panneau et catégorie d’inscription prêts', en: 'The Finals 3v3v3v3 tournament: registration panel and category ready' },
    evenementFixe: 'The Nuke End',
    titre: { fr: 'Inscription — {evenement}', en: 'Registration — {evenement}' },
    texte: {
      fr: [
        'Les inscriptions pour **{evenement}**, tournoi The Finals au format **3v3v3v3**, sont ouvertes.',
        '',
        '**À préparer avant de cliquer**',
        '- le nom de votre équipe et son TAG (3 à 4 lettres) ;',
        '- vos 3 joueurs, avec pour chacun son Discord ID et son Embark ID ;',
        '- facultatif : un coach et jusqu’à 2 remplaçants (Discord ID et Embark ID) ;',
        '- le logo de l’équipe, sous forme de lien vers l’image (demandé dans le ticket).',
        '',
        'Cliquez sur « S’inscrire » et remplissez le formulaire. Un salon privé s’ouvre avec les organisateurs. {reponse}',
        '',
        'Le staff vérifie chaque équipe et confirme l’inscription dans le ticket : tant qu’elle n’est pas validée, elle n’est pas définitive.',
      ].join('\n'),
      en: [
        'Registrations for **{evenement}**, a The Finals tournament in **3v3v3v3** format, are open.',
        '',
        '**What to prepare before clicking**',
        '- your team name and its TAG (3 to 4 letters);',
        '- your 3 players, each with their Discord ID and Embark ID;',
        '- optional: a coach and up to 2 subs (Discord ID and Embark ID);',
        '- your team logo, as a link to the image (asked in the ticket).',
        '',
        'Click “Register” and fill in the form. A private channel opens with the organisers. {reponse}',
        '',
        'The staff checks every team and confirms the registration in the ticket: until it is validated, it is not final.',
      ].join('\n'),
    },
    couleur: '#e4572e',
    style: 'boutons',
    categories: ['the-nuke-end'],
    libelleBouton: { fr: 'S’inscrire', en: 'Register' },
  },
]);

const REPONSE = {
  app: { fr: 'Pour écrire dans votre ticket, utilisez le bouton **Répondre** du bot : le staff vous répond dans le même salon.', en: 'To write in your ticket, use the bot’s **Reply** button: the staff answers you in the same channel.' },
  salon: { fr: 'Écrivez directement dans votre ticket : le staff vous répond dans le même salon.', en: 'Write directly in your ticket: the staff answers you in the same channel.' },
};
const JOURS = { fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'], en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] };

/** Horaires du support lisibles (« lundi 18:00-23:00, … (Europe/Paris) »), ou '' s'ils ne sont pas actifs. */
export function texteHoraires(horaires, langue) {
  if (!horaires?.actif || !horaires.plages?.length) return '';
  const plages = [...horaires.plages].sort((a, b) => a.jour - b.jour || a.debut.localeCompare(b.debut)).map(p => `${JOURS[langue][p.jour - 1] ?? p.jour} ${p.debut}-${p.fin}`);
  return langue === 'fr'
    ? `\n\n**Horaires du support** : ${plages.join(', ')} (${horaires.fuseau}). En dehors, votre ticket est bien enregistré et traité dès la reprise.`
    : `\n\n**Support hours**: ${plages.join(', ')} (${horaires.fuseau}). Outside these hours, your ticket is still recorded and handled as soon as we are back.`;
}

/**
 * Titre et texte d'un panneau par défaut, variables remplies. `evenement` : nom de l'événement (100 caractères au
 * plus) ; `appSeule` : réglage « Répondre uniquement depuis l'AppDashboard » ; `horaires` : réglage des horaires.
 */
export function textesPanneauModele(m, { evenement = '', appSeule = true, horaires = null } = {}) {
  const nomEv = String(m.evenementFixe ?? evenement ?? '').trim();
  const remplir = (v, l) =>
    v
      .replace(/\{evenement\}/g, nomEv)
      .replace(/\{reponse\}/g, REPONSE[appSeule ? 'app' : 'salon'][l])
      .replace(/\n?\{horaires\}/g, texteHoraires(horaires, l))
      .trim();
  return {
    titre: { fr: remplir(m.titre.fr, 'fr'), en: remplir(m.titre.en, 'en') },
    texte: { fr: remplir(m.texte.fr, 'fr'), en: remplir(m.texte.en, 'en') },
  };
}
