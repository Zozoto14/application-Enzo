/** Fiches du catalogue → cartes d'affiche (avec le badge « déjà vu » de la bibliothèque). Données pures. */

import { dejaVu, type Bibliotheque, type Genre } from '../moteur/bibliotheque';
import type { FicheAnime, FicheFilm } from '../moteur/catalogue';
import { LIBELLE_STATUT, type ElementCarte } from './ui';

function badge(db: Bibliotheque | undefined, kind: Genre, id: string, titre: string, annee: number | null, total: number | null = null) {
  if (!db) {
    return { vu: false, badge: undefined as string | undefined };
  }
  const d = dejaVu(db, kind, { id, title: titre, year: annee });
  const e = d.entree;
  const tot = kind === 'anime' ? (e?.totalEpisodes ?? total) : null;
  return {
    vu: d.vu,
    badge: d.statut ? LIBELLE_STATUT[d.statut] : undefined,
    // Statut, note, favori et progression : comme les cartes de l'ancienne version.
    statut: d.vu && d.statut !== 'vu_ailleurs' ? ('vu' as const) : d.statut,
    note: e?.rating ?? null,
    favori: Boolean(e?.favorite),
    progression: e && tot ? Math.min(1, (e.currentEpisode || 0) / tot) : 0,
    ligneAccent: e && kind === 'anime' ? `Épisode ${e.currentEpisode || 0}${tot ? ` / ${tot}` : ''}` : undefined,
  };
}

export function carteAnime(f: FicheAnime, db: Bibliotheque | undefined, aller: (id: string) => void): ElementCarte & { vu: boolean } {
  const id = String(f.id);
  const { vu, badge: b, ...etat } = badge(db, 'anime', id, f.title, f.year, f.totalEpisodes);
  return {
    cle: `anime-${id}`,
    titre: f.title,
    image: f.image,
    sousTitre: [f.type, f.year, f.totalEpisodes ? `${f.totalEpisodes} ép.` : null].filter(Boolean).join(' · ') || undefined,
    badge: b,
    score: f.score,
    ...etat,
    vu,
    onPress: () => aller(id),
  };
}

export function carteFilm(f: FicheFilm, db: Bibliotheque | undefined, aller: (id: string) => void): ElementCarte & { vu: boolean } {
  const { vu, badge: b, ...etat } = badge(db, 'movie', f.id, f.title, f.year);
  return {
    cle: `movie-${f.id}`,
    titre: f.title,
    image: f.image,
    sousTitre: [f.year, f.runtime ? `${f.runtime} min` : null].filter(Boolean).join(' · ') || undefined,
    badge: b,
    score: f.score,
    ...etat,
    vu,
    onPress: () => aller(f.id),
  };
}

/** Retire les titres déjà vus si le réglage le demande. */
export function sansVus<T extends { vu: boolean }>(liste: T[], masquer: boolean): T[] {
  return masquer ? liste.filter(e => !e.vu) : liste;
}
