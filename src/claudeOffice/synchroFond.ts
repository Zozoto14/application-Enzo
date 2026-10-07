/**
 * Dépôt de la copie chiffrée de l'historique en arrière-plan, tant
 * qu'AppDashboard est ouvert sur le PC (pas seulement sur l'écran Historique) :
 * un essai peu après l'ouverture, puis toutes les 15 minutes. Rien si la
 * synchro est désactivée (par défaut), hors du PC, ou sans relais relié.
 *
 * Même chose pour la petite « présence » (activité récente, pour le bureau du
 * site et du téléphone) : un essai toutes les 5 minutes, qui n'écrit que si
 * elle est activée, que l'activité a changé et que le plafond du jour n'est
 * pas atteint (voir `presenceSiDue`).
 */

import { useEffect } from 'react';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { pontClaudeOffice } from './pont';
import {
  DELAI_MIN_ENVOI_MS, DELAI_MIN_PRESENCE_MS, lireEtatPresence, lireEtatSynchro, presenceSiDue, synchroniserSiDu, type ServiceHistoriqueRelais,
} from './synchroHistorique';

export const PREMIER_ESSAI_MS = 60_000;

export async function tourDeFond(service: ServiceHistoriqueRelais | undefined, base: BasePrefs | undefined) {
  const pont = pontClaudeOffice()?.historique;
  if (!pont || !service || !lireEtatSynchro(base).active) return undefined;
  const lu = await pont.lire();
  if (!lu.ok || !lu.entrees) return undefined;
  return synchroniserSiDu({ service, base, appareilId: lu.reglages?.appareilId, entrees: lu.entrees });
}

export async function tourPresence(service: ServiceHistoriqueRelais | undefined, base: BasePrefs | undefined, maintenant?: Date) {
  const pont = pontClaudeOffice()?.historique;
  if (!pont || !service || !lireEtatSynchro(base).active || !lireEtatPresence(base).active) return undefined;
  // Lecture légère (activité récente) si le PC la connaît, sinon tout le journal.
  if (pont.activite) {
    const lu = await pont.activite();
    if (!lu.ok || !lu.entrees) return undefined;
    return presenceSiDue({ service, base, appareilId: lu.appareilId, entrees: lu.entrees, maintenant });
  }
  const lu = await pont.lire();
  if (!lu.ok || !lu.entrees) return undefined;
  return presenceSiDue({ service, base, appareilId: lu.reglages?.appareilId, entrees: lu.entrees, maintenant });
}

export function useSynchroHistoriqueOffice({ service, base }: { service?: ServiceHistoriqueRelais; base?: BasePrefs }) {
  useEffect(() => {
    if (!service || !pontClaudeOffice()?.historique) return undefined;
    const tour = () => void tourDeFond(service, base).catch(() => undefined);
    const presence = () => void tourPresence(service, base).catch(() => undefined);
    const premier = setTimeout(tour, PREMIER_ESSAI_MS);
    const suivants = setInterval(tour, DELAI_MIN_ENVOI_MS);
    const presences = setInterval(presence, DELAI_MIN_PRESENCE_MS);
    return () => {
      clearTimeout(premier);
      clearInterval(suivants);
      clearInterval(presences);
    };
  }, [service, base]);
}
