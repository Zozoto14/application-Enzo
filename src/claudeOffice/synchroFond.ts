/**
 * Dépôt de la copie chiffrée de l'historique en arrière-plan, tant
 * qu'AppDashboard est ouvert sur le PC (pas seulement sur l'écran Historique) :
 * un essai peu après l'ouverture, puis toutes les 15 minutes. Rien si la
 * synchro est désactivée (par défaut), hors du PC, ou sans relais relié.
 */

import { useEffect } from 'react';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { pontClaudeOffice } from './pont';
import { DELAI_MIN_ENVOI_MS, lireEtatSynchro, synchroniserSiDu, type ServiceHistoriqueRelais } from './synchroHistorique';

export const PREMIER_ESSAI_MS = 60_000;

export async function tourDeFond(service: ServiceHistoriqueRelais | undefined, base: BasePrefs | undefined) {
  const pont = pontClaudeOffice()?.historique;
  if (!pont || !service || !lireEtatSynchro(base).active) return undefined;
  const lu = await pont.lire();
  if (!lu.ok || !lu.entrees) return undefined;
  return synchroniserSiDu({ service, base, appareilId: lu.reglages?.appareilId, entrees: lu.entrees });
}

export function useSynchroHistoriqueOffice({ service, base }: { service?: ServiceHistoriqueRelais; base?: BasePrefs }) {
  useEffect(() => {
    if (!service || !pontClaudeOffice()?.historique) return undefined;
    const tour = () => void tourDeFond(service, base).catch(() => undefined);
    const premier = setTimeout(tour, PREMIER_ESSAI_MS);
    const suivants = setInterval(tour, DELAI_MIN_ENVOI_MS);
    return () => {
      clearTimeout(premier);
      clearInterval(suivants);
    };
  }, [service, base]);
}
