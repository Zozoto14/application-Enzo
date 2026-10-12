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
import type { CibleTest } from '../moteur/assistant';
import { CLES } from '../plateforme/stockage';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';
import type { ServicesTsuzuku } from './services';
import { plagesNumeros } from './diagnosticTexte';

/** Pourquoi rien n'est lisible : chaque cas a son message et son action. */
export type RaisonEchec =
  | 'aucune-source'
  | 'site'
  | 'erreur'
  | 'bloquee'
  | 'non-configuree'
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
/** Des sources existent, mais aucune n'est activée (pour ce profil). */
const toutesDesactivees = (n: number) => `Vos ${n} source(s) sont désactivées : activez-en une (page Sources, ou Paramètres › Tsuzuku pour une source partagée avec vous).`;

export const MESSAGE_SITE_SOURCES = `Le navigateur ne peut pas lire lui-même les pages de vos sources (CORS). ${MESSAGE_SITE}`;

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
    case 'bloquee': {
      const bloquees = d.sources.filter(x => x.statut === 'bloquee');
      return `Le site bloque les requêtes automatiques : ${bloquees.map(x => `« ${x.source} »`).join(', ')} (protection anti-robot, captcha ou cookies exigés). Ce n’est pas « aucun résultat » : Tsuzuku ne contourne pas ces protections. Vérifiez le site dans votre navigateur, réessayez plus tard, ou collez un lien direct vers l’épisode.`;
    }
    case 'non-configuree':
      return `Vos sources activées ne sont pas configurées pour les animés (${d.sources.map(x => `« ${x.source} »${x.raison ? ` : ${x.raison}` : ''}`).join(', ')}). Complétez la section « Animés · recherche » de la source.`;
    case 'titre-introuvable': {
      const refuse = d.sources.find(x => x.refuse)?.refuse;
      return `${refuse ? `« ${refuse.title} » ressemble trop peu au titre (ressemblance ${refuse.score}, minimum 600) : rien n’a été lu. ` : ''}Essayez « Chercher avec un autre titre » (le titre tel que le site l’écrit).`;
    }
    case 'aucun-resultat': {
      const raison = d.sources.find(x => x.statut === 'aucun-resultat' && x.raison)?.raison;
      return `Titre non trouvé sur vos sources (${requetes.length} recherche(s), aucun résultat retenu).${raison ? ` ${raison}` : ''} Essayez « Chercher avec un autre titre », ou ouvrez « Détail du diagnostic ».`;
    }
    case 'aucun-episode':
      return `« ${premier?.serie?.title ?? 'La série'} » trouvé sur « ${premier?.source ?? 'la source'} », mais aucun épisode n’a été lu sur sa page${premier?.raison ? ` : ${premier.raison}` : ' (sélecteur d’épisode à revoir)'}.`;
    case 'episode-absent': {
      const nom = `« ${premier?.serie?.title ?? 'La série'} » trouvé sur « ${premier?.source ?? 'la source'} »`;
      const nums = premier?.lectureEpisodes?.numeros ?? [];
      if (!nums.length || numero == null) {
        return `${nom} (${premier?.episodes ?? 0} épisode(s)), mais pas l’épisode ${numero ?? ''}.`.replace(' .', '.');
      }
      const plages = plagesNumeros(nums);
      if (numero > Math.max(...nums)) {
        // Le catalogue annonce souvent plus d'épisodes que le site n'en a mis en ligne : ce n'est pas une panne.
        return `${nom} : la source n’a que ${nums.length === 1 ? 'l’épisode' : 'les épisodes'} ${plages}. L’épisode ${numero} n’y est pas (encore) en ligne.`;
      }
      return `${nom} : épisodes trouvés ${plages} (${nums.length}), mais pas l’épisode ${numero}. Ouvrez « Détail du diagnostic » pour voir le numéro lu sur chaque lien (liste incomplète sur la page de la série, ou numérotation propre au site).`;
    }
    case 'aucun-lecteur':
      return 'La page de l’épisode ne contient aucun lecteur reconnu.';
  }
}

/** Raison d'un échec, d'après les diagnostics des sources (la plus utile d'abord). */
function raisonDe(diags: readonly DiagnosticSource[]): RaisonEchec {
  const statuts = new Set(diags.map(d => d.statut));
  if (statuts.has('aucun-episode')) return 'aucun-episode';
  if (statuts.has('titre-introuvable')) return 'titre-introuvable';
  if (statuts.has('bloquee')) return 'bloquee';
  if (statuts.has('erreur')) return 'erreur';
  if (statuts.has('aucun-resultat')) return 'aucun-resultat';
  // Des sources activées, mais aucune ne cherche des animés : le dire (avant : rien n'était affiché).
  if (statuts.has('non-configuree')) return 'non-configuree';
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
/** Toute la définition des sources activées : une source modifiée (adresse, miroir, sélecteur) n'est jamais servie par le cache. */
const signature = (sources: readonly DefinitionSource[]) => JSON.stringify(sources.filter(x => x.enabled).map(({ createdAt: _c, ...x }) => x));

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
    const message = raison === 'aucune-source' && !s.lectureSources ? `${AUCUNE_SOURCE} ${MESSAGE_SITE}` : raison === 'aucune-source' && sources.length ? toutesDesactivees(sources.length) : messageEchec(diagnostic);
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
    const message = raison === 'aucune-source' && !s.lectureSources ? `${AUCUNE_SOURCE} ${MESSAGE_SITE}` : raison === 'aucune-source' && sources.length ? toutesDesactivees(sources.length) : messageEchec(diagnostic);
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

/**
 * « Tester sur un vrai titre du catalogue » : la fiche du catalogue la plus
 * proche de la saisie (ou la plus populaire), avec TOUS les titres que la fiche
 * chercherait et la préférence de doublage de l'utilisateur.
 */
export async function cibleDuCatalogue(s: ServicesTsuzuku, saisie: string, kind: 'anime' | 'movie' = 'anime'): Promise<{ libelle: string; cible: CibleTest }> {
  const langue = (await s.reglages()).langue;
  if (kind === 'movie') {
    const r = await s.catalogue.films.rechercher(saisie.trim() || 'a');
    const f = r.items[0];
    if (!f) throw new Error(`Aucun film du catalogue ne correspond à « ${saisie} ».`);
    return { libelle: f.title, cible: { titres: titresPourSources(f), langue, annee: f.year } };
  }
  const liste = saisie.trim() ? (await s.catalogue.animes.rechercher(saisie.trim(), 5)).data : (await s.catalogue.animes.populaires(5)).data;
  const premier = liste[0];
  if (!premier?.id) throw new Error(`Aucun animé du catalogue ne correspond à « ${saisie} ».`);
  // La fiche complète porte les titres alternatifs (comme à l'ouverture de la fiche).
  const fiche = await s.catalogue.animes.parId(premier.id).then(r => r.data, () => premier);
  return { libelle: fiche.title, cible: { titres: titresPourSources(fiche), langue } };
}
