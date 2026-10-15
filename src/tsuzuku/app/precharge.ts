/**
 * Préchargement d'INTENTION (temps de réponse) : ce que l'utilisateur va
 * probablement ouvrir part avant le clic, de façon BORNÉE.
 *
 * - Carte d'un animé, au toucher (`onPressIn`, avant même le relâchement) ou
 *   après un survol prolongé (souris) : la fiche du catalogue part, et la
 *   recherche sur les sources aussi. Pour une carte Jikan (recherche,
 *   classements), elle part TOUT DE SUITE avec les titres de la carte, qui sont
 *   ceux de la fiche complète (même mise en forme) : la fiche, à son ouverture,
 *   rejoint cette recherche (même clé, une seule part). Sinon (AniList : pas
 *   de titre français), elle attend la fiche complète.
 *   Une seule recherche sur les sources « par intention » en vol à la fois.
 * - Accueil : les fiches du catalogue des premières cartes visibles (4 au
 *   plus, l'une après l'autre, après un temps de calme) ; jamais les sources.
 * - Ligne d'épisode : la page de l'épisode (lecteurs gardés 20 min).
 *
 * Aucune erreur ne remonte : un préchargement raté est simplement refait au clic.
 */

import type { FicheAnime } from '../moteur/catalogue';
import { langueVoulue } from './langues';
import { episodesDisponibles, prechargerEpisode, titresPourSources } from './resoudre';
import type { ServicesTsuzuku } from './services';

export { poigneesIntention, SURVOL_MS } from './intention';

/** Accueil : fiches préchargées au plus, et attente de calme avant de commencer. */
export const FICHES_ACCUEIL_MAX = 4;
export const CALME_ACCUEIL_MS = 1200;

/** Une même intention n'est pas relancée pendant ce délai (le cache du profil prend le relais). */
export const OUBLI_MS = 10 * 60_000;

/** Demandes déjà faites, datées (une fois par 10 min). */
class Vues {
  private readonly dates = new Map<string, number>();
  has(cle: string): boolean {
    const d = this.dates.get(cle);
    return d !== undefined && Date.now() - d < OUBLI_MS;
  }
  add(cle: string): void {
    this.dates.delete(cle);
    this.dates.set(cle, Date.now());
    while (this.dates.size > 300) this.dates.delete(this.dates.keys().next().value as string);
  }
  delete(cle: string): void {
    this.dates.delete(cle);
  }
}

interface Etat {
  /** Recherche sur les sources lancée par intention, en cours (une seule). */
  recherche?: string;
  vues: Vues;
}
const etats = new WeakMap<object, Etat>();
const etatDe = (s: object): Etat => {
  let e = etats.get(s);
  if (!e) {
    e = { vues: new Vues() };
    etats.set(s, e);
  }
  return e;
};

/** La recherche sur les sources d'un animé, comme la fiche la lancerait (même langue, mêmes titres). */
async function lancerRecherche(s: ServicesTsuzuku, id: string, titres: readonly string[]): Promise<void> {
  const e = etatDe(s);
  if (e.recherche || e.vues.has(`src|${id}`) || !s.lectureSources || !titres.length) return;
  e.vues.add(`src|${id}`);
  e.recherche = id;
  try {
    const langue = (await langueVoulue(s, `anime:${id}`)).langue;
    await episodesDisponibles(s, { id, titres, langue, davance: true });
  } catch {
    // Refait au clic.
  } finally {
    if (e.recherche === id) e.recherche = undefined;
  }
}

/**
 * Intention d'ouvrir la fiche d'un animé (toucher ou survol prolongé) : fiche
 * du catalogue et recherche sur les sources. Ne rend rien, ne lève jamais.
 */
export function intentionAnime(s: ServicesTsuzuku, f: Pick<FicheAnime, 'id' | 'fournisseur' | 'title' | 'titleOriginal' | 'titresAlternatifs' | 'titleJapanese'>): void {
  if (f.id == null) return;
  const id = String(f.id);
  const e = etatDe(s);
  if (f.fournisseur === 'jikan') void lancerRecherche(s, id, titresPourSources(f));
  if (e.vues.has(`cat|${id}`)) return;
  e.vues.add(`cat|${id}`);
  void s.catalogue.animes
    .parId(id)
    .then(r => (f.fournisseur === 'jikan' ? undefined : lancerRecherche(s, id, titresPourSources(r.data))))
    .catch(() => undefined);
}

/**
 * Accueil : fiches du catalogue des premières cartes (bornées, l'une après
 * l'autre, après un temps de calme ; ni sources ni images). Rend de quoi arrêter.
 */
export function prechargerFichesAccueil(s: ServicesTsuzuku, fiches: ReadonlyArray<Pick<FicheAnime, 'id'>>, o: { max?: number; calmeMs?: number } = {}): () => void {
  let arrete = false;
  const ids = fiches
    .map(f => (f.id == null ? '' : String(f.id)))
    .filter(Boolean)
    .slice(0, o.max ?? FICHES_ACCUEIL_MAX);
  const minuteur = setTimeout(async () => {
    const e = etatDe(s);
    for (const id of ids) {
      if (arrete) return;
      if (e.vues.has(`cat|${id}`)) continue;
      e.vues.add(`cat|${id}`);
      await s.catalogue.animes.parId(id).catch(() => undefined);
    }
  }, o.calmeMs ?? CALME_ACCUEIL_MS);
  return () => {
    arrete = true;
    clearTimeout(minuteur);
  };
}

/** Intention de lire un épisode (toucher ou survol prolongé d'une ligne) : sa page est lue d'avance. */
export function intentionEpisode(s: ServicesTsuzuku, o: { id: string; titres: readonly string[]; numero: number }): void {
  if (!s.lectureSources) return;
  const e = etatDe(s);
  const cle = `ep|${o.id}|${o.numero}`;
  if (e.vues.has(cle)) return;
  e.vues.add(cle);
  void langueVoulue(s, `anime:${o.id}`)
    .then(v => prechargerEpisode(s, { ...o, langue: v.langue }))
    .then(ok => {
      if (!ok) e.vues.delete(cle);
    })
    .catch(() => e.vues.delete(cle));
}
