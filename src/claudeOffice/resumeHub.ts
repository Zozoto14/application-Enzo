/**
 * Petit résumé de Claude Office pour sa tuile du hub (page « Administration ») :
 * combien d'agents travaillent, et d'où vient l'information (en direct sur le
 * PC, ou âge du dernier dépôt ailleurs). Lu seulement quand le hub est affiché
 * et que le profil voit la tuile (Fondateur) ; sur le relais, seulement les
 * petites « présences » (jamais les copies d'historique, plus lourdes).
 */

import { useMemo } from 'react';
import type { InfoLive } from '../hub/types';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { useActiviteBureau } from './activiteBureau';
import { compterBureau, deduireBureau, ilYA, type SourceBureau } from './logiqueBureau';
import { pontClaudeOffice } from './pont';
import type { ServiceHistoriqueRelais } from './synchroHistorique';

export interface ResumeClaudeOffice {
  actifs: number;
  inactifs: number;
  termines: number;
  source: SourceBureau;
  derniereActivite?: number;
  /** Horloge du calcul (ms). */
  le: number;
}

export const INTERVALLE_TUILE_PC_MS = 15_000;
export const INTERVALLE_TUILE_RELAIS_MS = 3 * 60_000;

export function useResumeClaudeOffice({ actif, service, base }: { actif: boolean; service?: ServiceHistoriqueRelais; base?: BasePrefs }): ResumeClaudeOffice | undefined {
  const pont = actif ? pontClaudeOffice()?.historique : undefined;
  const activite = useActiviteBureau({
    pont,
    service: actif ? service : undefined,
    base,
    actif,
    historique: false,
    intervallePc: INTERVALLE_TUILE_PC_MS,
    intervalleRelais: INTERVALLE_TUILE_RELAIS_MS,
  });
  return useMemo(() => {
    if (!actif || !activite.lu || activite.source.genre === 'aucune') return undefined;
    const le = Date.now();
    const bureau = deduireBureau(activite.entrees, { maintenant: le, references: activite.references });
    const c = compterBureau(bureau, [], le);
    return {
      actifs: c.actifs,
      inactifs: c.inactifs,
      termines: c.termines,
      source: activite.source,
      ...(bureau.derniereActivite !== undefined ? { derniereActivite: bureau.derniereActivite } : {}),
      le,
    };
  }, [actif, activite.lu, activite.entrees, activite.references, activite.source]);
}

/** Information en direct de la tuile (données pures). */
export function infoClaudeOffice(resume: ResumeClaudeOffice | undefined): InfoLive | undefined {
  if (!resume) return undefined;
  const sousTitre =
    resume.source.genre === 'local'
      ? resume.actifs ? 'En direct sur ce PC' : resume.derniereActivite ? `Calme · dernière activité ${ilYA(resume.derniereActivite, resume.le)}` : 'Aucune activité récente'
      : resume.source.genre === 'relais' && resume.source.date ? `Copie chiffrée · à jour ${ilYA(resume.source.date, resume.le)}` : 'Aucune copie reçue du PC';
  return {
    sousTitre,
    indicateurs: [
      { libelle: 'Au travail', valeur: String(resume.actifs) },
      { libelle: 'Inactifs', valeur: String(resume.inactifs) },
    ],
  };
}
