/**
 * Source du Journal automatique pour Tsuzuku (contrat `hub/journal/contrat.ts`) :
 * les épisodes (et films) vus ce jour-là, lus dans l'historique de la
 * bibliothèque du profil ouvert. Aucune écriture.
 */

import type { EvenementJournal, SourceJournal } from '../../hub/journal/contrat';
import type { ContexteHub } from '../../hub/types';
import { migrerBibliotheque } from '../moteur/bibliotheque';
import { CLES } from '../plateforme/stockage';

export const ID_SOURCE_TSUZUKU = 'tsuzuku';

const deux = (n: number) => String(n).padStart(2, '0');

export function evenementsTsuzuku(jour: string, contexte: Pick<ContexteHub, 'baseProfil'>): EvenementJournal[] {
  const brut = contexte.baseProfil?.lire(CLES.bibliotheque);
  if (!brut) return [];
  let db;
  try {
    db = migrerBibliotheque(JSON.parse(brut));
  } catch {
    return [];
  }
  const sortie: EvenementJournal[] = [];
  for (const h of db.history) {
    const ms = Date.parse(h.watchedAt);
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    if (`${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}` !== jour) continue;
    const film = h.kind === 'movie';
    sortie.push({
      id: `${h.kind}:${h.animeId}:${film ? 'film' : h.episode}:${h.watchedAt}`,
      source: ID_SOURCE_TSUZUKU,
      famille: 'tsuzuku',
      genre: 'episode-vu',
      jour,
      heure: `${deux(d.getHours())}:${deux(d.getMinutes())}`,
      titre: h.title,
      groupe: h.title,
      ...(film ? { detail: 'film' } : { nombre: h.episode }),
    });
  }
  return sortie;
}

export const SOURCE_TSUZUKU: SourceJournal = {
  id: ID_SOURCE_TSUZUKU,
  nom: 'Tsuzuku',
  famille: 'tsuzuku',
  lire: (jour, contexte) => evenementsTsuzuku(jour, contexte),
};
