/**
 * Écran d'une section du CM du club (la team) dans l'espace CM : membres et rôles, journal, paramètres, résumés,
 * objectifs, écrans des modules (planning, disponibilités, Discord…). Voir cm/SectionsTeamCm.tsx.
 */

import React, { useState } from 'react';
import type { SaisieEvenement } from '../planning/api';
import { Journal } from './Journal';
import { MembresRoles } from './MembresRoles';
import { ECRANS_MODULES } from './modules';
import { SectionObjectifs } from './Objectifs';
import { Parametres, entreesBarre, type SectionTeam } from './PageTeam';
import { SectionResumes } from './Resumes';
import type { PropsSectionTeamCm, SectionsTeam } from './cm/SectionsTeamCm';

export function SectionTeamCm({ theme, client, detail, large, onglet, onAller, onChange, onExporter }: PropsSectionTeamCm) {
  const [brouillon, setBrouillon] = useState<{ n: number; b?: Partial<SaisieEvenement>; reviewId?: string }>({ n: 0 });
  const section = onglet.slice('team:'.length) as SectionTeam;
  if (section === 'membres') return <MembresRoles theme={theme} client={client} detail={detail} large={large} onExporter={onExporter} />;
  if (section === 'journal') return <Journal theme={theme} client={client} detail={detail} onExporter={onExporter} />;
  if (section === 'parametres') return <Parametres theme={theme} client={client} detail={detail} large={large} onChange={onChange} onSupprimee={() => undefined} onExporter={onExporter} />;
  if (section === 'module:meeting_summaries') return <SectionResumes theme={theme} client={client} detail={detail} large={large} />;
  if (section === 'module:goals_tasks') return <SectionObjectifs theme={theme} client={client} detail={detail} large={large} onExporter={onExporter} />;
  const Ecran = section.startsWith('module:') ? ECRANS_MODULES[section.slice('module:'.length)] : undefined;
  if (!Ecran) return null;
  return (
    <Ecran
      key={`${section}-${brouillon.n}`}
      theme={theme}
      client={client}
      detail={detail}
      large={large}
      brouillon={brouillon.b}
      reviewId={brouillon.reviewId}
      onExporter={onExporter}
      onAller={(s, b, reviewId) => {
        setBrouillon(x => ({ n: x.n + 1, b, reviewId }));
        if (s !== 'accueil') onAller(`team:${s}`);
      }}
    />
  );
}

/** Sections du CM du club pour l'espace CM (RacineEsport → EspaceCm). */
export const SECTIONS_TEAM_CM: SectionsTeam = { entrees: entreesBarre, Section: SectionTeamCm };
