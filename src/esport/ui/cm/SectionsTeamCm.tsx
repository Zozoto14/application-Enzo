/**
 * Le CM du club EST une team (migrations 0068 et 0069, docs/esport/cm.md, « Le CM du club, une team ») : ses pages de
 * team s'ouvrent DANS l'espace CM, pas sur une page de team à part. Groupe « Équipe » : Équipe CM (membres et rôles de
 * la team), Planning, Disponibilités, Présence, Résumés, Objectifs ; DATA : ressources de l'équipe ; Gestion :
 * Paramètres de la team, Discord, journal de la team. Chaque entrée suit les modules activés et les permissions de
 * team du compte (mêmes règles que la page d'une team : `entreesBarre`, passée par RacineEsport).
 *
 * Module sans écran : l'écran d'une section vient de ../SectionTeamCm.tsx (fourni par RacineEsport, pour ne pas
 * charger les écrans des modules depuis l'espace CM : ils dépendent eux-mêmes de l'espace en différé).
 */

import type React from 'react';
import type { ClientEsport, DetailTeam } from '../../client';
import { nomModule } from '../../client';
import type { ThemeHub } from '../../../hub/themes';
import { tr } from '../../i18n';
import { trCm } from '../../i18n/cm';

/** Onglet de l'espace CM qui montre une section de la team (« team:membres », « team:module:planning »…). */
export type OngletTeamCm = `team:${string}`;
export type GroupeTeamCm = 'equipe' | 'data' | 'gestion';

/** Groupe de l'espace CM où se range une section de la team. */
export function groupeSectionTeam(section: string): GroupeTeamCm {
  if (section === 'module:resources') return 'data';
  if (section === 'parametres' || section === 'module:discord' || section === 'journal') return 'gestion';
  return 'equipe';
}

export interface EntreeTeamCm {
  id: OngletTeamCm;
  libelle: string;
  groupe: GroupeTeamCm;
}

/** Entrée de la barre d'une team (`entreesBarre` de PageTeam). */
export interface EntreeBarreTeam {
  id: string;
  libelle: string;
  bientot?: boolean;
}

/** Sections de la team ouvertes au compte (sans son accueil : c'est l'accueil de l'espace CM), rangées par groupe. */
export function entreesTeamCm(entrees: readonly EntreeBarreTeam[]): EntreeTeamCm[] {
  return entrees
    .filter(e => e.id !== 'accueil' && !e.bientot)
    .map(e => {
      const libelle =
        e.id === 'membres'
          ? trCm('espace.equipe')
          : e.id === 'parametres'
            ? tr('teamCm.parametres')
            : e.id === 'journal'
              ? tr('teamCm.journal')
              : e.id === 'module:resources'
                ? tr('teamCm.ressources_team')
                : e.id.startsWith('module:')
                  ? nomModule(e.id.slice('module:'.length))
                  : e.libelle;
      return { id: `team:${e.id}` as OngletTeamCm, libelle, groupe: groupeSectionTeam(e.id) };
    });
}

export interface PropsSectionTeamCm {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  large: boolean;
  onglet: OngletTeamCm;
  /** Aller à une autre section de la team (proposer un événement depuis les disponibilités…). */
  onAller(onglet: OngletTeamCm): void;
  /** Paramètres enregistrés : relire la team. */
  onChange(): Promise<void>;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}

/** Ce que RacineEsport fournit à l'espace CM pour les sections de la team. */
export interface SectionsTeam {
  entrees(detail: DetailTeam): EntreeBarreTeam[];
  Section: React.ComponentType<PropsSectionTeamCm>;
}
