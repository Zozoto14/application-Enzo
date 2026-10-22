/**
 * Appels de la page « Statistiques » (Fondateur SEUL : le serveur répond 404 à tout autre compte). À part du
 * client principal : chargés avec la page, le bundle principal ne grossit pas.
 */

import { requeteUrl, type ClientEsport, type FicheUsage, type FiltresStatistiques, type ReglagesUsage, type StatistiquesUsage } from '../client';

export function apiStatistiques(client: ClientEsport) {
  return {
    tableau: (f: FiltresStatistiques = {}) => client.requete<StatistiquesUsage>(`/statistiques${requeteUrl({ ...f })}`),
    fiche: (compte: string, p: { du?: string; au?: string } = {}) => client.requete<FicheUsage>(`/statistiques/membres/${encodeURIComponent(compte)}${requeteUrl({ du: p.du, au: p.au })}`),
    reglages: () => client.requete<ReglagesUsage>('/statistiques/reglages'),
    changerCollecte: (collecte: boolean) => client.requete<ReglagesUsage>('/statistiques/reglages', 'PUT', { collecte }),
  };
}
