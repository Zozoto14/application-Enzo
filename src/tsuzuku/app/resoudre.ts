/**
 * Du titre au lecteur : liens manuels d'abord, puis sources de l'administrateur.
 * Fonctions asynchrones sans interface, testées avec un faux réseau.
 */

import { lireAssociation, lireLienFilm, adresseEpisode } from '../moteur/liensManuels';
import { classerMedia } from '../moteur/garde';
import { messageDe } from '../moteur/erreurs';
import { variantesDeRecherche } from '../moteur/appariement';
import {
  lecteursPourPage,
  trouverEpisodes,
  trouverFilm,
  trouverLecteurs,
  type DiagnosticSource,
  type EpisodeSource,
  type Lecteur,
  type ResultatEpisodes,
} from '../moteur/resolution';
import type { DefinitionSource } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';
import type { ServicesTsuzuku } from './services';

/** Pourquoi rien n'est lisible : chaque cas a son message et son action. */
export type RaisonEchec =
  | 'aucune-source'
  | 'site'
  | 'erreur'
  | 'titre-introuvable'
  | 'aucun-resultat'
  | 'aucun-episode'
  | 'episode-absent'
  | 'aucun-lecteur';

export interface DiagnosticLecture {
  raison: RaisonEchec;
  /** Titres cherchés (variantes comprises), dans l'ordre. */
  titres: string[];
  /** Une entrée par source essayée : requêtes, nombre de résultats, titre retenu ou écarté. */
  sources: DiagnosticSource[];
}

export interface Lecture {
  lecteurs: Lecteur[];
  origine: 'manuel' | 'source' | 'aucune';
  /** Pourquoi rien n'est lisible, ou ce qu'il faut savoir (page seule, site refusant l'iframe…). */
  message?: string;
  diagnostic?: DiagnosticLecture;
}

const AUCUNE_SOURCE = 'Aucune source ne fournit ce titre. Ajoutez un lien direct, ou demandez à l’administrateur de brancher une source.';
export const MESSAGE_SITE_SOURCES = `${MESSAGE_SITE} Le navigateur ne peut pas lire les pages de vos sources (CORS) : ouvrez la fiche dans l’app PC ou iPhone, ou collez un lien direct.`;

/** Titres d'une fiche à chercher sur les sources (titre affiché, original, alternatifs, japonais), sans doublon. */
export function titresPourSources(f: { title?: string | null; titleOriginal?: string | null; titresAlternatifs?: readonly string[] | null; titleJapanese?: string | null; originalTitle?: string | null }): string[] {
  const vus = new Set<string>();
  return [f.title, f.titleOriginal, f.originalTitle, ...(f.titresAlternatifs ?? []), f.titleJapanese].filter((t): t is string => {
    const cle = String(t ?? '').trim().toLowerCase();
    if (!cle || vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/** Titre choisi à la main (« Chercher avec un autre titre »), par fiche, dans la base du profil. */
export async function lireTitresPerso(s: Pick<ServicesTsuzuku, 'stockage'>): Promise<Record<string, string>> {
  try {
    const brut = JSON.parse((await s.stockage.lire(CLES.titresRecherche)) ?? '{}') as unknown;
    return brut && typeof brut === 'object' && !Array.isArray(brut) ? Object.fromEntries(Object.entries(brut as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).slice(0, 200)])) : {};
  } catch {
    return {};
  }
}

export async function enregistrerTitrePerso(s: Pick<ServicesTsuzuku, 'stockage'>, cle: string, titre: string): Promise<void> {
  const tous = await lireTitresPerso(s);
  if (titre.trim()) tous[cle] = titre.trim().slice(0, 200);
  else delete tous[cle];
  await s.stockage.ecrire(CLES.titresRecherche, JSON.stringify(tous));
}

/** Titre personnalisé en tête, puis ceux du catalogue. */
const avecPerso = (titres: readonly string[], perso?: string) => (perso ? [perso, ...titres.filter(t => t.trim().toLowerCase() !== perso.trim().toLowerCase())] : [...titres]);

/** Message clair pour chaque raison (la fiche et le lecteur affichent le même). */
export function messageEchec(d: DiagnosticLecture, numero?: number): string {
  const premier = d.sources.find(x => x.statut === 'ok' || x.statut === 'aucun-episode') ?? d.sources[0];
  const requetes = d.sources.flatMap(x => x.requetes);
  switch (d.raison) {
    case 'aucune-source':
      return AUCUNE_SOURCE;
    case 'site':
      return MESSAGE_SITE_SOURCES;
    case 'erreur': {
      const enErreur = d.sources.filter(x => x.statut === 'erreur');
      return `Source en erreur : ${enErreur.map(x => `« ${x.source} » (${x.erreur ?? 'erreur inconnue'})`).join(', ')}. Vérifiez la connexion, puis « Réessayer ».`;
    }
    case 'titre-introuvable': {
      const refuse = d.sources.find(x => x.refuse)?.refuse;
      return `${refuse ? `« ${refuse.title} » ressemble trop peu au titre : rien n’a été lu. ` : ''}Essayez « Chercher avec un autre titre » (le titre tel que le site l’écrit).`;
    }
    case 'aucun-resultat':
      return `Titre non trouvé sur vos sources (${requetes.length} recherche(s), aucun résultat). Essayez « Chercher avec un autre titre ».`;
    case 'aucun-episode':
      return `« ${premier?.serie?.title ?? 'La série'} » trouvé sur « ${premier?.source ?? 'la source'} », mais aucun épisode n’a été lu sur sa page (sélecteur d’épisode à revoir).`;
    case 'episode-absent':
      return `« ${premier?.serie?.title ?? 'La série'} » trouvé sur « ${premier?.source ?? 'la source'} » (${premier?.episodes ?? 0} épisode(s)), mais pas l’épisode ${numero ?? ''}.`.replace(' .', '.');
    case 'aucun-lecteur':
      return 'La page de l’épisode ne contient aucun lecteur reconnu.';
  }
}

/** Raison d'un échec, d'après les diagnostics des sources (la plus utile d'abord). */
function raisonDe(diags: readonly DiagnosticSource[]): RaisonEchec {
  const statuts = new Set(diags.map(d => d.statut));
  if (statuts.has('aucun-episode')) return 'aucun-episode';
  if (statuts.has('titre-introuvable')) return 'titre-introuvable';
  if (statuts.has('erreur')) return 'erreur';
  if (statuts.has('aucun-resultat')) return 'aucun-resultat';
  return 'aucune-source';
}

export interface Disponibilite {
  episodes: EpisodeSource[];
  resultat: ResultatEpisodes | null;
  diagnostic: DiagnosticLecture;
  /** Message à afficher quand rien n'est trouvé. */
  message?: string;
}

const DUREE_CACHE_MS = 10 * 60_000;
const caches = new WeakMap<object, Map<string, { quand: number; r: ResultatEpisodes }>>();
const signature = (sources: readonly DefinitionSource[]) => sources.filter(x => x.enabled).map(x => `${x.id}:${x.search.path}:${x.search.item}:${x.episodes.item}`).join('|');

/**
 * Épisodes d'un animé sur les sources de l'utilisateur : la fiche (« Sur vos
 * sources ») et le lecteur passent par ici, donc par `trouverEpisodes`, comme
 * le test pas à pas de l'assistant. Un résultat trouvé est gardé 10 min par
 * profil (le lecteur ne relance pas la recherche que la fiche vient de faire).
 */
export async function episodesDisponibles(
  s: ServicesTsuzuku,
  o: { id: string | number; titres: readonly string[]; forcer?: boolean },
): Promise<Disponibilite> {
  const perso = (await lireTitresPerso(s))[`anime:${o.id}`];
  const titres = avecPerso(o.titres, perso);
  const sources = await s.sources();
  const vide = (raison: RaisonEchec): Disponibilite => {
    const diagnostic = { raison, titres: variantesDeRecherche(titres), sources: [] };
    const message = raison === 'aucune-source' && !s.lectureSources ? `${AUCUNE_SOURCE} ${MESSAGE_SITE}` : messageEchec(diagnostic);
    return { episodes: [], resultat: null, diagnostic, message };
  };
  if (!sources.some(x => x.enabled)) return vide('aucune-source');
  if (!s.lectureSources) return vide('site');
  const langue = (await s.reglages()).langue;
  const cle = `${o.id}|${titres.join('|')}|${langue}|${signature(sources)}`;
  const cache = caches.get(s) ?? new Map<string, { quand: number; r: ResultatEpisodes }>();
  caches.set(s, cache);
  const memo = cache.get(cle);
  let r: ResultatEpisodes;
  if (memo && !o.forcer && Date.now() - memo.quand < DUREE_CACHE_MS) {
    r = memo.r;
  } else {
    r = await trouverEpisodes(s.ctx, sources, { titres, langue });
    if (r.episodes.length) cache.set(cle, { quand: Date.now(), r });
    else cache.delete(cle);
  }
  const diagnostic: DiagnosticLecture = { raison: r.episodes.length ? 'aucune-source' : raisonDe(r.diagnostics), titres: variantesDeRecherche(titres), sources: r.diagnostics };
  return { episodes: r.episodes, resultat: r, diagnostic, message: r.episodes.length ? undefined : messageEchec(diagnostic) };
}

/** Lien manuel → lecteurs. Sur le site (pas de lecture de pages) : le lien est affiché tel quel. */
async function depuisLien(s: ServicesTsuzuku, url: string, label: string, kind: 'anime' | 'movie'): Promise<Lecture> {
  if (!s.lectureSources) {
    const media = classerMedia(url);
    return {
      lecteurs: [{ label: media === 'iframe' ? `${label} - page intégrée` : `${label} - fichier vidéo`, url, kind: media }],
      origine: 'manuel',
      message: media === 'iframe' ? `${MESSAGE_SITE} La page est affichée telle quelle (le site peut refuser l’intégration).` : undefined,
    };
  }
  const r = await lecteursPourPage(s.ctx, await s.sources(), url, { label, kind });
  return { lecteurs: r.sources, origine: 'manuel', message: r.warning };
}

export async function lireAnime(
  s: ServicesTsuzuku,
  o: { id: string | number; titres: readonly string[]; numero: number; forcer?: boolean },
): Promise<Lecture> {
  const db = await s.depot.lire();
  const adresse = adresseEpisode(lireAssociation(db.manualSources, o.id), o.numero);
  if (adresse) {
    return depuisLien(s, adresse, `Épisode ${o.numero}`, 'anime');
  }
  try {
    const d = await episodesDisponibles(s, o);
    if (!d.episodes.length) {
      return { lecteurs: [], origine: 'aucune', message: d.message, diagnostic: d.diagnostic };
    }
    const ep: EpisodeSource | undefined = d.episodes.find(e => e.number === o.numero);
    if (!ep) {
      const diagnostic: DiagnosticLecture = { ...d.diagnostic, raison: 'episode-absent' };
      return { lecteurs: [], origine: 'aucune', message: messageEchec(diagnostic, o.numero), diagnostic };
    }
    const lecteurs = await trouverLecteurs(s.ctx, await s.sources(), ep.url);
    if (lecteurs.length) return { lecteurs, origine: 'source' };
    const diagnostic: DiagnosticLecture = { ...d.diagnostic, raison: 'aucun-lecteur' };
    return { lecteurs, origine: 'aucune', message: messageEchec(diagnostic), diagnostic };
  } catch (erreur) {
    return { lecteurs: [], origine: 'aucune', message: messageDe(erreur), diagnostic: { raison: 'erreur', titres: [...o.titres], sources: [] } };
  }
}

export async function lireFilm(
  s: ServicesTsuzuku,
  o: { id: string; titres: readonly string[]; annee?: number | null },
): Promise<Lecture> {
  const db = await s.depot.lire();
  const lien = lireLienFilm(db.manualSources, o.id);
  if (lien) {
    return depuisLien(s, lien.url, lien.label || 'Film', 'movie');
  }
  const titres = avecPerso(o.titres, (await lireTitresPerso(s))[`movie:${o.id}`]);
  const sources = await s.sources();
  const vide = (raison: RaisonEchec): Lecture => {
    const diagnostic = { raison, titres: variantesDeRecherche(titres), sources: [] };
    const message = raison === 'aucune-source' && !s.lectureSources ? `${AUCUNE_SOURCE} ${MESSAGE_SITE}` : messageEchec(diagnostic);
    return { lecteurs: [], origine: 'aucune', message, diagnostic };
  };
  if (!sources.some(x => x.enabled)) return vide('aucune-source');
  if (!s.lectureSources) return vide('site');
  try {
    const r = await trouverFilm(s.ctx, sources, { titres, annee: o.annee });
    if (r.sources.length) return { lecteurs: r.sources, origine: 'source' };
    const diagnostic: DiagnosticLecture = { raison: r.diagnostics.some(x => x.statut === 'aucun-episode') ? 'aucun-lecteur' : raisonDe(r.diagnostics), titres: variantesDeRecherche(titres), sources: r.diagnostics };
    return { lecteurs: [], origine: 'aucune', message: messageEchec(diagnostic), diagnostic };
  } catch (erreur) {
    return { lecteurs: [], origine: 'aucune', message: messageDe(erreur), diagnostic: { raison: 'erreur', titres: [...titres], sources: [] } };
  }
}
