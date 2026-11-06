/**
 * Tickets : catégories PAR DÉFAUT (modèles), bilingues, avec un formulaire Discord prêt à l'emploi (5 champs au plus ;
 * libellé ≤ 45 caractères, texte d'exemple ≤ 100, réponse ≤ 4000 : limites des fenêtres Discord, vérifiées par les
 * tests et par validerCategorie).
 *
 *  - semées AUTOMATIQUEMENT à la première lecture de la configuration quand il n'existe encore AUCUNE catégorie (une
 *    seule fois : réglage `categories_defaut`) ; une installation qui a déjà des catégories n'est jamais touchée ;
 *  - ajoutables à tout moment (Configuration › Catégories › « Catégories par défaut ») : celles cochées sont créées,
 *    sauf si une catégorie du même nom (français ou anglais) existe déjà.
 *
 * Qui traite chaque catégorie (rôles Discord, rôles de l'app) reste à choisir, sauf deux évidences (rôles système du
 * catalogue, gardés seulement s'ils existent) : Contenu & médias → « Responsable CM », Partenariat & sponsoring →
 * « Second CEO » (le Fondateur voit tout). Tout reste modifiable ensuite.
 */

const court = (id, libelle, placeholder, { requis = true, max = 100 } = {}) => ({ id, libelle, placeholder, style: 'court', requis, min: 0, max });
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
