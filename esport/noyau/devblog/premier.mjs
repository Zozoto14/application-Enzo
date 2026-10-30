/**
 * Premier devblog, posé en BROUILLON (jamais publié automatiquement) : tout ce qui a été livré depuis le devblog
 * du 23/10/2026, en français et en anglais, dans la DA du devblog. Le Fondateur le relit, le corrige, puis le
 * publie (et l'annonce sur Discord) lui-même. Posé une seule fois : supprimé, il ne revient pas.
 */

export const ID_PREMIER_DEVBLOG = 'devblog-2026-10-30';
export const DATE_PREMIER_DEVBLOG = '2026-10-30';

export const PREMIER_DEVBLOG_FR = Object.freeze({
  titre: 'Nouvelle Mise à Jour !',
  intro: 'Salut à tous ! Une grosse mise à jour est en ligne avec son lot d’ajouts et de correctifs. Voici ce qui change :',
  sections: [
    {
      emoji: '🎮',
      titre: 'Compétition & Jeux',
      puces: [
        { nom: 'Profils de jeu', description: 'Plusieurs jeux gérés : Valorant déjà prêt, The Finals, formats 5v5 et 3v3v3v3. Un assistant IA vous aide à les préparer et les mises à jour vous sont proposées automatiquement.' },
        { nom: 'Tournois', description: 'Inscriptions, check-in, parcours et classement, avec les matchs ajoutés directement au planning.' },
        { nom: 'Résultats', description: 'Scores par map ou par manche selon le jeu, MVP, bilans par map et par adversaire.' },
      ],
    },
    {
      emoji: '📣',
      titre: 'Section CM',
      puces: [
        { nom: 'Espace CM du club', description: 'Un espace dédié aux CM, directement dans Teams.' },
        { nom: 'Tableaux', description: 'Des tableaux façon Trello, avec import de vos tableaux Trello existants.' },
        { nom: 'Posts réseaux', description: 'Posts X, Instagram et TikTok en français et en anglais, avec validation obligatoire avant publication.' },
        { nom: 'Calendrier éditorial', description: 'Tous les contenus prévus, d’un seul coup d’œil.' },
        { nom: 'Clips', description: 'Les joueurs peuvent proposer leurs meilleurs clips aux CM.' },
        { nom: 'Visuels', description: 'Visuels automatiques au style cyberpunk et éditeur d’affiches.' },
        { nom: 'Drive des CM', description: 'Tous les fichiers de la section rangés au même endroit.' },
        { nom: 'Sponsors & prospects', description: 'Suivi des partenaires et des prospects du club.' },
        { nom: 'Page Réseaux', description: 'Annonce Discord des posts publiés et statistiques de vos comptes.' },
        { nom: 'Étiquettes', description: 'Créez et gérez vos propres étiquettes.' },
      ],
    },
    {
      emoji: '👥',
      titre: 'Membres & Rôles',
      puces: [
        { nom: 'Trombinoscope', description: 'Une fiche par joueur : palmarès, elo, anciennes structures, réseaux et photo.' },
        { nom: 'Badges', description: 'Des badges personnalisés affichés sous les pseudos.' },
        { nom: 'Rôles et permissions', description: 'Une nouvelle page pour régler qui peut faire quoi dans le club.' },
        { nom: 'Second CEO', description: 'Un nouveau rôle pour épauler la direction du club.' },
      ],
    },
    {
      emoji: '🤖',
      titre: 'Discord',
      puces: [
        { nom: 'Messages bilingues', description: 'Les messages du bot partent en anglais, avec un fil 🇫🇷 Version française.' },
        { nom: 'Moins de pings', description: 'Un seul ping par événement, fini les mentions en double.' },
        { nom: 'Relances en MP', description: 'Les rappels peuvent arriver en message privé.' },
        { nom: 'Test des MP', description: 'Vérifiez en un clic que le bot peut bien vous écrire en privé.' },
      ],
    },
    {
      emoji: '🧠',
      titre: 'IA & Transcription',
      puces: [
        { nom: 'Assistant IA', description: 'Plus rapide qu’avant.' },
        { nom: 'Transcription des réunions', description: 'Bien plus précise : elle connaît le vocabulaire de l’équipe et évite d’inventer des phrases.' },
        { nom: 'Confidentialité', description: 'Vos réunions restent sur le serveur.' },
      ],
    },
    {
      emoji: '🔧',
      titre: 'Corrections',
      puces: [
        { nom: 'Menus « ⋯ »', description: 'Toujours visibles, sur ordinateur comme sur téléphone.' },
        { nom: 'Strats', description: 'Suppression possible, avec une corbeille pour les récupérer.' },
        { nom: 'Navigation mobile', description: 'Plus légère et plus simple.' },
        { nom: 'Connexion', description: 'Correction de la connexion après une réinitialisation du mot de passe.' },
        { nom: 'Bug fixes', description: 'Diverses corrections pour améliorer la stabilité globale de la plateforme.' },
      ],
    },
  ],
  conclusion: 'Merci pour vos retours et bonne navigation sur appdashboard.fr ! 🚀',
});

export const PREMIER_DEVBLOG_EN = Object.freeze({
  titre: 'New Update!',
  intro: 'Hi everyone! A big update is live with a batch of new features and fixes. Here’s what’s new:',
  sections: [
    {
      emoji: '🎮',
      titre: 'Competition & Games',
      puces: [
        { nom: 'Game profiles', description: 'Several games supported: Valorant ready to go, The Finals, 5v5 and 3v3v3v3 formats. An AI assistant helps you set them up and updates are suggested automatically.' },
        { nom: 'Tournaments', description: 'Sign-ups, check-in, bracket path and standings, with matches added straight to the schedule.' },
        { nom: 'Results', description: 'Scores per map or per round depending on the game, MVP, records per map and per opponent.' },
      ],
    },
    {
      emoji: '📣',
      titre: 'CM Section',
      puces: [
        { nom: 'Club CM space', description: 'A dedicated space for the CMs, right inside Teams.' },
        { nom: 'Boards', description: 'Trello-style boards, with import of your existing Trello boards.' },
        { nom: 'Social posts', description: 'X, Instagram and TikTok posts in French and English, with required approval before publishing.' },
        { nom: 'Content calendar', description: 'All planned content at a glance.' },
        { nom: 'Clips', description: 'Players can suggest their best clips to the CMs.' },
        { nom: 'Visuals', description: 'Automatic cyberpunk-style visuals and a poster editor.' },
        { nom: 'CM Drive', description: 'All the section’s files in one place.' },
        { nom: 'Sponsors & prospects', description: 'Keep track of the club’s partners and prospects.' },
        { nom: 'Socials page', description: 'Discord announcement of published posts and stats for your accounts.' },
        { nom: 'Labels', description: 'Create and manage your own labels.' },
      ],
    },
    {
      emoji: '👥',
      titre: 'Members & Roles',
      puces: [
        { nom: 'Player directory', description: 'One card per player: achievements, elo, past teams, socials and photo.' },
        { nom: 'Badges', description: 'Custom badges shown under usernames.' },
        { nom: 'Roles & permissions', description: 'A new page to set who can do what in the club.' },
        { nom: 'Second CEO', description: 'A new role to support the club’s management.' },
      ],
    },
    {
      emoji: '🤖',
      titre: 'Discord',
      puces: [
        { nom: 'Bilingual messages', description: 'Bot messages are posted in English, with a 🇫🇷 French version thread.' },
        { nom: 'Fewer pings', description: 'One ping per event, no more duplicate mentions.' },
        { nom: 'DM reminders', description: 'Reminders can now reach you by direct message.' },
        { nom: 'DM test', description: 'Check in one click that the bot can message you privately.' },
      ],
    },
    {
      emoji: '🧠',
      titre: 'AI & Transcription',
      puces: [
        { nom: 'AI assistant', description: 'Faster than before.' },
        { nom: 'Meeting transcription', description: 'Much more accurate: it knows the team’s vocabulary and avoids making up sentences.' },
        { nom: 'Privacy', description: 'Your meetings stay on the server.' },
      ],
    },
    {
      emoji: '🔧',
      titre: 'Fixes',
      puces: [
        { nom: '“⋯” menus', description: 'Always visible, on desktop and on mobile.' },
        { nom: 'Strats', description: 'Strats can now be deleted, with a trash bin to get them back.' },
        { nom: 'Mobile navigation', description: 'Lighter and simpler.' },
        { nom: 'Sign-in', description: 'Fixed signing in after a password reset.' },
        { nom: 'Bug fixes', description: 'Various fixes to improve the overall stability of the platform.' },
      ],
    },
  ],
  conclusion: 'Thanks for your feedback and enjoy browsing appdashboard.fr! 🚀',
});
