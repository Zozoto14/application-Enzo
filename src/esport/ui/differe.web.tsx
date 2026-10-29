/**
 * Site et app PC : les écrans lourds des modules (planning, disponibilités,
 * présence, review vidéo, scouting, strats, playbook, ressources, Discord) sont chargés à
 * la demande, dans des fichiers séparés : l'Esport s'ouvre sans attendre le
 * code des modules qu'on n'ouvre pas.
 */

import type React from 'react';
import { differe } from './attente';
import type { PropsModule } from './modules';

export const Planning = differe<PropsModule>(async () => (await import('./planning/Planning')).Planning);
export const Disponibilites = differe<PropsModule>(async () => (await import('./planning/Disponibilites')).Disponibilites);
export const Presence = differe<PropsModule>(async () => (await import('./planning/Presence')).Presence);
export const Review = differe<PropsModule>(async () => (await import('./review/Review')).Review);
export const Scouting = differe<PropsModule>(async () => (await import('./scouting/Scouting')).Scouting);
export const Strats = differe<PropsModule>(async () => (await import('./strats/Strats')).Strats);
export const Playbook = differe<PropsModule>(async () => (await import('./strats/Playbook')).Playbook);
export const SuiviJoueurs = differe<PropsModule>(async () => (await import('./suivi/SuiviJoueurs')).SuiviJoueurs);
export const Discord = differe<PropsModule>(async () => (await import('./Discord')).Discord);
export const Ressources = differe<PropsModule>(async () => (await import('./ressources/Ressources')).Ressources);
export const Tournois = differe<PropsModule>(async () => (await import('./competition/Tournois')).Tournois);
export const Resultats = differe<PropsModule>(async () => (await import('./competition/Resultats')).Resultats);
// Section CM (onglet de team et espace du club) : chargée seulement quand on l'ouvre.
export const CmTeam = differe<PropsModule>(async () => (await import('./cm/CmTeam')).CmTeam);
export const EspaceCm = differe<React.ComponentProps<typeof import('./cm/EspaceCm').EspaceCm>>(async () => (await import('./cm/EspaceCm')).EspaceCm);
// Page « Statistiques » (Fondateur) : chargée seulement quand il l'ouvre.
export const Statistiques = differe<React.ComponentProps<typeof import('./Statistiques').Statistiques>>(async () => (await import('./Statistiques')).Statistiques);
// Page « Jeux » (profils de jeu, assistant IA) : chargée seulement quand on l'ouvre.
// Trombinoscope (page Membres) et « Ma fiche » (Mon profil) : chargés seulement quand on les ouvre.
export const Trombinoscope = differe<React.ComponentProps<typeof import('./membres/Trombinoscope').Trombinoscope>>(async () => (await import('./membres/Trombinoscope')).Trombinoscope);
// Page Membres › Rôles et permissions (Fondateur, roles.gerer) : chargée seulement quand on l'ouvre.
export const RolesPermissions = differe<React.ComponentProps<typeof import('./membres/RolesPermissions').RolesPermissions>>(async () => (await import('./membres/RolesPermissions')).RolesPermissions);
export const MaFicheTrombi = differe<React.ComponentProps<typeof import('./membres/FicheTrombi').MaFicheTrombi>>(async () => (await import('./membres/FicheTrombi')).MaFicheTrombi);
export const Jeux = differe<React.ComponentProps<typeof import('./jeux/Jeux').Jeux>>(async () => (await import('./jeux/Jeux')).Jeux);
