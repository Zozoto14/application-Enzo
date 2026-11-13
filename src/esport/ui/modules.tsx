/**
 * Écrans des modules livrés, par clé de module (catalogue). Un module activé
 * SANS écran ici apparaît « bientôt » dans la barre de la team. Pour livrer un
 * module : ajouter sa ligne ci-dessous (une seule ligne par module).
 */

import type React from 'react';
import type { ThemeHub } from '../../hub/themes';
import type { ClientEsport, DetailTeam } from '../client';
import type { SaisieEvenement } from '../planning/api';
import { PERMISSION_DISCORD } from '../discord/api';
// Sur le web, chargés à la demande (differe.web.tsx) : bundle principal plus léger.
import { CmTeam, Discord, Disponibilites, Lineups, Planning, Playbook, Presence, Ressources, Resultats, Review, Scouting, Strats, SuiviJoueurs, Tournois } from './differe';

export type SectionModule = `module:${string}`;

export interface PropsModule {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  large: boolean;
  /** Aller à une autre section de la team (ex. proposer un événement depuis la heatmap). */
  onAller(section: SectionModule | 'accueil', brouillon?: Partial<SaisieEvenement>, reviewId?: string): void;
  /** Brouillon d'événement transmis par une autre section. */
  brouillon?: Partial<SaisieEvenement>;
  /** Review à ouvrir directement (ex. « Ouvrir en review vidéo » depuis le scouting). */
  reviewId?: string;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Ouvrir Administration › Jeux (profils de jeu : maps, échelle) ; absent : ce compte n'y a pas accès. */
  onAdminJeux?(): void;
}

export const ECRANS_MODULES: Record<string, (props: PropsModule) => React.ReactElement> = {
  planning: Planning,
  availability: Disponibilites,
  attendance: Presence,
  discord: Discord,
  video_review: Review,
  scouting: Scouting,
  strat_editor: Strats,
  playbook: Playbook,
  lineups: Lineups,
  player_notes: SuiviJoueurs,
  resources: Ressources,
  tournois: Tournois,
  resultats: Resultats,
  cm: CmTeam,
};

/** Permissions dont l'une ouvre l'écran du module (sinon, pas d'entrée dans la barre). */
const ACCES_MODULES: Record<string, string[]> = {
  planning: ['planning.view'],
  availability: ['availability.edit_own', 'availability.view_all'],
  attendance: ['attendance.rsvp_own', 'attendance.view_all', 'attendance.mark'],
  // Le webhook est un secret : l'écran Discord n'existe que pour qui peut le gérer.
  discord: [PERMISSION_DISCORD],
  video_review: ['video_review.view'],
  scouting: ['scouting.view'],
  strat_editor: ['strats.view'],
  playbook: ['playbook.view'],
  lineups: ['lineups.voir'],
  // Notes du staff : jamais pour les joueurs (ils voient les notes partagées sur l'accueil de la team).
  player_notes: ['player_notes.view'],
  resources: ['resources.view'],
  tournois: ['tournois.voir'],
  resultats: ['resultats.voir'],
  // Section CM : le correspondant (déposer), les joueurs (proposer des clips), ceux qui voient la partie CM.
  cm: ['cm.voir', 'cm.deposer', 'cm.clips.proposer'],
};

export function moduleAccessible(cle: string, permissions: readonly string[]): boolean {
  const requises = ACCES_MODULES[cle];
  return !requises || requises.some(p => permissions.includes(p));
}
