/**
 * Du titre au lecteur : liens manuels d'abord, puis sources de l'administrateur.
 * Fonctions asynchrones sans interface, testées avec un faux réseau.
 */

import { lireAssociation, lireLienFilm, adresseEpisode } from '../moteur/liensManuels';
import { classerMedia } from '../moteur/garde';
import { messageDe } from '../moteur/erreurs';
import { variantesDeRecherche } from '../moteur/appariement';
import {
  episodesEnLangue,
  episodesSur,
  lecteursPourPage,
  resumerLangues,
  trouverEpisodes,
  trouverFilm,
  trouverLecteursDetail,
  type DiagnosticSource,
  type EpisodeSource,
  type Lecteur,
  type ResultatEpisodes,
} from '../moteur/resolution';
import { sourcePourUrl, sourcesActives, type DefinitionSource } from '../moteur/sources';
import type { DiagnosticLecteurs } from '../moteur/lecteursEpisode';
import { autreLangue, LANGUES_VERSION, LIBELLE_LANGUE_VERSION, type LangueVersion } from '../moteur/langues';
import type { CibleTest } from '../moteur/assistant';
import { CLES } from '../plateforme/stockage';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';
import type { ServicesTsuzuku } from './services';
import { plagesNumeros, type MesureLecture } from './diagnosticTexte';
import { empreinteTexte } from './cache';

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
  /** Temps par étape, et si le résultat vient du cache. */
  mesure?: MesureLecture;
  /** Page de l'épisode lue sans lecteur extractible : son adresse (« Ouvrir l'épisode sur le site »). */
  urlPage?: string;
  /** Ce qui a été essayé sur cette page (sélecteurs, iframes, data-src…). */
  lecteurs?: DiagnosticLecteurs;
}

export interface Lecture {
  lecteurs: Lecteur[];
  origine: 'manuel' | 'source' | 'aucune';
  /** Pourquoi rien n'est lisible, ou ce qu'il faut savoir (page seule, site refusant l'iframe…). */
  message?: string;
  diagnostic?: DiagnosticLecture;
  /** Langue de l'épisode joué (null : la source ne la distingue pas). */
  langue?: LangueVersion | null;
  /** Langues proposées pour CET épisode (sources seulement). */
  langues?: EtatLangues;
  /** La langue demandée n'est pas disponible : ce qui est joué à la place, et pourquoi. */
  avisLangue?: string;
  /** Temps par étape (épisodes, lecteur) et cache. */
  mesure?: MesureLecture;
  /** L'autre langue est encore en cours de vérification : l'état du sélecteur, une fois vérifiée. */
  languesAJour?: Promise<EtatLangues | undefined>;
}

/** Le lecteur attend au plus ce délai la vérification de l'autre langue avant de s'afficher. */
export const ATTENTE_VERIFICATION_MS = 150;

/** Une langue dans le sélecteur : disponible, non disponible (et pourquoi), ou à vérifier sur les autres sources. */
export interface OptionLangue {
  etat: 'disponible' | 'absente' | 'a-verifier';
  /** Pourquoi la langue manque (affiché et lu par le lecteur d'écran). */
  raison?: string;
  /** D'où vient la langue (« « (VF) » dans le titre », « onglet « VF » »…). */
  indice?: string;
  presumee?: boolean;
  /** Source qui la fournit (une autre que celle de la fiche, le cas échéant). */
  source?: string;
}

export interface EtatLangues {
  /** Langue des épisodes affichés ; null : inconnue. */
  courante: LangueVersion | null;
  /** La source ne distingue pas la langue : pas de sélecteur, « Langue inconnue ». */
  inconnue: boolean;
  options: Record<LangueVersion, OptionLangue>;
}

/** Une langue trouvée sur une AUTRE source que celle de la fiche (à la demande). */
interface Ailleurs {
  episodes: EpisodeSource[];
  source?: DefinitionSource;
  raison?: string;
}
const ailleursDe = new WeakMap<ResultatEpisodes, Partial<Record<LangueVersion, Ailleurs>>>();
/** Autres sources consultées au plus pour une langue absente de la source de la fiche. */
export const AUTRES_SOURCES_MAX = 2;
const L = (l: LangueVersion) => LIBELLE_LANGUE_VERSION[l];

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
      return `Lecteur introuvable sur cette page : aucun lecteur vidéo n’a pu en être extrait${d.lecteurs ? ` (${d.lecteurs.iframes} iframe(s), ${d.lecteurs.dataSrc} data-src, ${d.lecteurs.options} option(s) de lecteur)` : ''}.`;
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
  /** Temps de la recherche (par étape), ou âge du résultat servi par le cache. */
  mesure?: MesureLecture;
  /**
   * Résultat périmé servi tout de suite : la recherche fraîche, lancée en
   * arrière-plan, rend vrai si elle a changé quelque chose (l'écran se relit).
   */
  rafraichissement?: Promise<boolean>;
  /** Résultat PROVISOIRE (affichage progressif) : une source plus prioritaire cherche encore. */
  provisoire?: boolean;
}

/** Contexte qui relit toujours les sites (cache du relais seulement remis à jour) : « Réessayer », rafraîchissement. */
const contexteFrais = (s: Pick<ServicesTsuzuku, 'ctx'> & Partial<Pick<ServicesTsuzuku, 'ctxFrais'>>) => s.ctxFrais ?? s.ctx;

/** Résultat trouvé : servi tel quel pendant 30 min. */
export const EPISODES_FRAIS_MS = 30 * 60_000;
/** Jusqu'à 24 h : servi tout de suite, et rafraîchi en arrière-plan. */
export const EPISODES_PERIME_MAX_MS = 24 * 3_600_000;
/** Lecteurs d'un épisode (adresses parfois signées pour un temps) : 20 min. */
export const LECTEURS_FRAIS_MS = 20 * 60_000;

/** Une recherche finie reste rejointe ce délai (sans « forcer ») : voir `episodesDisponibles`. */
export const RECHERCHE_REJOINTE_MS = 15_000;
/** Recherches en cours (la fiche et son sélecteur de langue demandent la même) : une seule part. */
const enVol = new WeakMap<object, Map<string, Promise<ResultatEpisodes>>>();
/** Résultats provisoires d'une recherche en cours, et qui les attend (affichage progressif). */
const provisoires = new WeakMap<object, Map<string, { dernier?: Disponibilite; ecouteurs: Set<(d: Disponibilite) => void> }>>();
function provisoiresDe(s: object, cle: string) {
  const parCle = provisoires.get(s) ?? new Map<string, { dernier?: Disponibilite; ecouteurs: Set<(d: Disponibilite) => void> }>();
  provisoires.set(s, parCle);
  let e = parCle.get(cle);
  if (!e) {
    e = { ecouteurs: new Set() };
    parCle.set(cle, e);
  }
  return e;
}
/** Rafraîchissements en arrière-plan en cours (un seul par fiche). */
const enRafraichissement = new WeakMap<object, Set<string>>();
/** Clé de cache de chaque résultat (pour le réécrire après une lecture à la demande). */
const cleDeResultat = new WeakMap<ResultatEpisodes, string>();
/** Toute la définition des sources activées : une source modifiée (adresse, miroir, sélecteur) n'est jamais servie par le cache. */
const signature = (sources: readonly DefinitionSource[]) => JSON.stringify(sources.filter(x => x.enabled).map(({ createdAt: _c, ...x }) => x));

/** Un résultat relu du cache pointe vers la définition ACTUELLE de sa source (même contenu, garanti par la signature). */
function relier(r: ResultatEpisodes, sources: readonly DefinitionSource[]): ResultatEpisodes {
  const src = r.source ? sources.find(x => x.id === r.source!.id) : undefined;
  return src && src !== r.source ? Object.assign(r, { source: src }) : r;
}

/** Ce qui change pour l'écran : épisodes (numéros, adresses), source, langues lues. */
const empreinteResultat = (r: ResultatEpisodes) =>
  JSON.stringify([r.source?.id, r.episodes.map(e => [e.number, e.url]), r.langues ? Object.values(r.langues.variantes).map(v => v && [v.langue, v.url, v.episodes?.length]) : null]);

/**
 * Épisodes d'un animé sur les sources de l'utilisateur : la fiche (« Sur vos
 * sources ») et le lecteur passent par ici, donc par `trouverEpisodes`, comme
 * le test pas à pas de l'assistant. Un résultat trouvé est gardé (cache du
 * profil, sur l'appareil) : frais 30 min, puis servi aussitôt et rafraîchi en
 * arrière-plan jusqu'à 24 h. La clé tient compte de TOUTE la définition des
 * sources activées et du titre choisi à la main.
 */
export async function episodesDisponibles(
  s: ServicesTsuzuku,
  o: {
    id: string | number;
    titres: readonly string[];
    forcer?: boolean;
    langue?: LangueVersion | null;
    /** Affichage progressif : une source moins prioritaire a trouvé, les plus prioritaires cherchent encore. */
    surProvisoire?: (d: Disponibilite) => void;
    /** Recherche lancée d'avance (toucher de la carte) : une fois finie, la fiche la rejoint encore 15 s. */
    davance?: boolean;
  },
): Promise<Disponibilite> {
  const debut = Date.now();
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
  // La langue voulue oriente la PREMIÈRE recherche (la page lue d'abord) ; elle n'entre pas dans la clé :
  // changer de langue réutilise le résultat et ne lit que la page de l'autre langue.
  const langue = o.langue ?? (await s.reglages()).langue;
  const cle = `ep|${o.id}|${empreinteTexte(`${perso ?? ''}|${signature(sources)}`)}`;
  /** `garder` : rafraîchissement en arrière-plan ; un échec (hors ligne, site en panne) ne retire pas l'ancien résultat. */
  const chercher = (garder = false): Promise<ResultatEpisodes> => {
    const vols = enVol.get(s) ?? new Map<string, Promise<ResultatEpisodes>>();
    enVol.set(s, vols);
    const ecoute = provisoiresDe(s, cle);
    if (o.surProvisoire) {
      ecoute.ecouteurs.add(o.surProvisoire);
      // Rejoint une recherche déjà en cours : son résultat provisoire, s'il y en a un, tout de suite.
      if (ecoute.dernier) o.surProvisoire(ecoute.dernier);
    }
    const deja = o.forcer ? undefined : vols.get(cle);
    if (deja) return deja;
    ecoute.dernier = undefined;
    const surProvisoire = (r: ResultatEpisodes) => {
      const d: Disponibilite = {
        episodes: r.episodes,
        resultat: r,
        provisoire: true,
        diagnostic: { raison: 'aucune-source', titres: variantesDeRecherche(titres), sources: r.diagnostics },
        mesure: { etapes: [], totalMs: Date.now() - debut },
      };
      ecoute.dernier = d;
      for (const f of ecoute.ecouteurs) f(d);
    };
    const promesse = trouverEpisodes(garder || o.forcer ? contexteFrais(s) : s.ctx, sources, { titres, langue, surProvisoire }).then(r => {
      if (r.episodes.length) {
        s.cache.ecrire(cle, r);
        cleDeResultat.set(r, cle);
      } else if (!garder) {
        s.cache.supprimer(cle);
      }
      return r;
    });
    vols.set(cle, promesse);
    const liberer = () => {
      if (vols.get(cle) === promesse) {
        ecoute.dernier = undefined;
        ecoute.ecouteurs.clear();
        if (!o.davance) {
          vols.delete(cle);
          return;
        }
        // Lancée d'avance (toucher de la carte) et finie avant l'ouverture de la fiche : la fiche la
        // rejoint encore un instant au lieu de la refaire (site qui bloque, rien trouvé).
        const t = setTimeout(() => {
          if (vols.get(cle) === promesse) vols.delete(cle);
        }, RECHERCHE_REJOINTE_MS);
        (t as unknown as { unref?: () => void }).unref?.();
      }
    };
    promesse.then(liberer, liberer);
    return promesse;
  };
  const memo = o.forcer ? undefined : await s.cache.lire<ResultatEpisodes>(cle);
  const age = memo ? Date.now() - memo.a : Infinity;
  let r: ResultatEpisodes;
  let mesure: MesureLecture;
  let rafraichissement: Promise<boolean> | undefined;
  if (memo && memo.valeur?.episodes?.length && age < EPISODES_PERIME_MAX_MS) {
    r = relier(memo.valeur, sources);
    cleDeResultat.set(r, cle);
    mesure = { etapes: [], cache: { origine: memo.origine, ageMs: age }, totalMs: Date.now() - debut };
    const enCours = enRafraichissement.get(s) ?? new Set<string>();
    enRafraichissement.set(s, enCours);
    if (age >= EPISODES_FRAIS_MS && !enCours.has(cle)) {
      // Périmé : servi tout de suite, rafraîchi en arrière-plan (la prochaine lecture aura le neuf).
      enCours.add(cle);
      const avant = empreinteResultat(r);
      rafraichissement = chercher(true)
        .then(neuf => neuf.episodes.length > 0 && empreinteResultat(neuf) !== avant, () => false)
        .finally(() => enCours.delete(cle));
    }
  } else {
    r = await chercher();
    const premier = r.diagnostics.find(x => x.sourceId === r.source?.id)?.ms;
    mesure = { etapes: [...(premier?.recherche != null ? [{ nom: 'recherche', ms: premier.recherche }] : []), ...(premier?.episodes != null ? [{ nom: 'épisodes', ms: premier.episodes }] : [])], totalMs: Date.now() - debut };
  }
  // Langues relues à chaque appel : une page lue à la demande (autre langue) figure dans le diagnostic.
  const sourcesDiag = r.langues ? r.diagnostics.map(x => (x.sourceId === r.source?.id && x.langues ? { ...x, langues: resumerLangues(r.langues!) } : x)) : r.diagnostics;
  const diagnostic: DiagnosticLecture = { raison: r.episodes.length ? 'aucune-source' : raisonDe(r.diagnostics), titres: variantesDeRecherche(titres), sources: sourcesDiag, mesure };
  return { episodes: r.episodes, resultat: r, diagnostic, message: r.episodes.length ? undefined : messageEchec(diagnostic), mesure, rafraichissement };
}

/** Le résultat a été complété sur place (page d'une autre langue lue) : le cache le réécrit. */
function resultatComplete(s: ServicesTsuzuku, r: ResultatEpisodes) {
  const cle = cleDeResultat.get(r);
  if (cle) s.cache.toucher(cle);
}

/** Lectures d'une langue en cours, par résultat : la vérification du lecteur et un clic sur « VF » ne lisent la page qu'une fois. */
const languesEnVol = new WeakMap<ResultatEpisodes, Map<LangueVersion, ReturnType<typeof episodesEnLangue>>>();

/** Épisodes d'une série dans une langue sur la source de la fiche (une page de plus au plus), résultat gardé en cache. */
function lireLangue(s: ServicesTsuzuku, r: ResultatEpisodes, langue: LangueVersion, titres: readonly string[]): ReturnType<typeof episodesEnLangue> {
  const vols = languesEnVol.get(r) ?? new Map<LangueVersion, ReturnType<typeof episodesEnLangue>>();
  languesEnVol.set(r, vols);
  const deja = vols.get(langue);
  if (deja) return deja;
  const dejaLue = Boolean(r.langues?.variantes[langue]?.episodes);
  const p = episodesEnLangue(s.ctx, r.source!, r.langues!, langue, { titres }).then(x => {
    if (!dejaLue && r.langues?.variantes[langue]?.episodes) resultatComplete(s, r);
    return x;
  });
  vols.set(langue, p);
  const liberer = () => {
    if (vols.get(langue) === p) vols.delete(langue);
  };
  p.then(liberer, liberer);
  return p;
}

/**
 * Lecteurs d'une page d'épisode, gardés 20 min (cache du profil) : revenir à
 * un épisode, changer de langue ou passer à l'épisode suivant préchargé ne
 * relit pas la page. Une liste vide n'est jamais gardée.
 */
export async function lecteursDeLEpisode(
  s: ServicesTsuzuku,
  url: string,
  o: { forcer?: boolean } = {},
): Promise<{ lecteurs: Lecteur[]; ms: number; cache?: { origine: 'memoire' | 'appareil'; ageMs: number }; diagnostic?: DiagnosticLecteurs }> {
  const debut = Date.now();
  const sources = await s.sources();
  // « lec2 » : les listes gardées avant la correction pouvaient contenir la page de l'épisode elle-même.
  const cle = `lec2|${empreinteTexte(`${url}|${signature(sources)}`)}`;
  const memo = o.forcer ? undefined : await s.cache.lire<Lecteur[]>(cle);
  if (memo && Array.isArray(memo.valeur) && memo.valeur.length && Date.now() - memo.a < LECTEURS_FRAIS_MS) {
    return { lecteurs: memo.valeur, ms: Date.now() - debut, cache: { origine: memo.origine, ageMs: Date.now() - memo.a } };
  }
  const vols = lecteursEnVol.get(s) ?? new Map<string, Promise<{ lecteurs: Lecteur[]; diagnostic?: DiagnosticLecteurs }>>();
  lecteursEnVol.set(s, vols);
  let p = o.forcer ? undefined : vols.get(cle);
  if (!p) {
    const promesse = trouverLecteursDetail(o.forcer ? contexteFrais(s) : s.ctx, sources, url).then(r => {
      if (r.lecteurs.length) s.cache.ecrire(cle, r.lecteurs);
      return r;
    });
    vols.set(cle, promesse);
    const liberer = () => {
      if (vols.get(cle) === promesse) vols.delete(cle);
    };
    promesse.then(liberer, liberer);
    p = promesse;
  }
  const r = await p;
  return { lecteurs: r.lecteurs, diagnostic: r.diagnostic, ms: Date.now() - debut };
}

/** Pages d'épisode en cours de lecture (préchargement et clic simultanés : une seule requête). */
const lecteursEnVol = new WeakMap<object, Map<string, Promise<{ lecteurs: Lecteur[]; diagnostic?: DiagnosticLecteurs }>>>();

/**
 * Épisodes d'une série dans une langue : la source de la fiche d'abord (ce
 * qu'elle a déjà lu, sinon UNE page de plus), puis, à la demande seulement,
 * vos autres sources activées (deux au plus). Le résultat est gardé avec celui
 * de la fiche : changer de langue une seconde fois ne relance rien.
 */
export async function episodesDansLangue(
  s: ServicesTsuzuku,
  d: Disponibilite,
  langue: LangueVersion,
  titres: readonly string[],
  o: { autresSources?: boolean } = {},
): Promise<{ episodes: EpisodeSource[]; source?: DefinitionSource; raison?: string }> {
  const r = d.resultat;
  if (!r?.source || !r.langues) return { episodes: [], raison: 'la source ne distingue pas la langue' };
  if (r.langues.courante === langue) return { episodes: d.episodes, source: r.source };
  const ici = await lireLangue(s, r, langue, titres);
  if (ici.episodes.length) return { episodes: ici.episodes, source: r.source };
  const memo = ailleursDe.get(r) ?? {};
  ailleursDe.set(r, memo);
  if (memo[langue]) return memo[langue]!;
  const autres = sourcesActives(await s.sources()).filter(x => x.id !== r.source!.id).slice(0, AUTRES_SOURCES_MAX);
  if (!o.autresSources || !autres.length) return { episodes: [], raison: ici.raison };
  for (const src of autres) {
    try {
      const res = await episodesSur(s.ctx, src, { titres, langue });
      if (!res.episodes.length || !res.langues) continue;
      const eps = res.langues.courante === langue ? res.episodes : (await episodesEnLangue(s.ctx, src, res.langues, langue, { titres })).episodes;
      if (eps.length) {
        memo[langue] = { episodes: eps, source: src };
        return memo[langue]!;
      }
    } catch {
      // Source en erreur : la suivante.
    }
  }
  memo[langue] = { episodes: [], raison: `${ici.raison ?? `pas de ${L(langue)} sur « ${r.source.name} »`} ; ni ${autres.map(x => `« ${x.name} »`).join(', ni ')} n’ont ce titre en ${L(langue)}` };
  return memo[langue]!;
}

/** État du sélecteur VF | VOSTFR pour une fiche (sans numéro) ou un épisode (avec numéro). */
export function etatLangues(d: Disponibilite, numero?: number, autresSources = 0): EtatLangues | undefined {
  const r = d.resultat;
  const langues = r?.langues;
  if (!r || !langues || !d.episodes.length) return undefined;
  const memo = ailleursDe.get(r) ?? {};
  const options = {} as Record<LangueVersion, OptionLangue>;
  for (const l of LANGUES_VERSION) {
    const v = langues.variantes[l];
    const autre = memo[l];
    if (v && v.episodes) {
      if (!v.episodes.length) {
        options[l] = autre?.episodes.length ? { etat: 'disponible', source: autre.source?.name } : { etat: 'absente', raison: autre?.raison ?? v.echec ?? `aucun épisode ${L(l)} lu` };
      } else if (numero != null && !v.episodes.some(e => e.number === numero)) {
        options[l] = { etat: 'absente', raison: `l’épisode ${numero} n’est pas en ${L(l)} sur « ${r.source?.name ?? 'la source'} » (${L(l)} : épisodes ${plagesNumeros(v.episodes.map(e => e.number))})`, indice: v.indice };
      } else {
        options[l] = { etat: 'disponible', indice: v.indice, presumee: v.presumee };
      }
    } else if (v) {
      options[l] = { etat: 'disponible', indice: v.indice, presumee: v.presumee };
    } else if (autre) {
      options[l] = autre.episodes.length && (numero == null || autre.episodes.some(e => e.number === numero)) ? { etat: 'disponible', source: autre.source?.name } : { etat: 'absente', raison: autre.raison ?? `l’épisode ${numero} n’est pas en ${L(l)} sur vos sources` };
    } else if (langues.courante && autresSources > 0) {
      options[l] = { etat: 'a-verifier', raison: `pas sur « ${r.source?.name ?? 'la source'} » ; vos autres sources seront consultées si vous choisissez ${L(l)}` };
    } else {
      options[l] = { etat: 'absente', raison: langues.absentes[l] ?? `${L(l)} non trouvée` };
    }
  }
  return { courante: langues.courante, inconnue: !langues.courante && !LANGUES_VERSION.some(l => options[l].etat === 'disponible'), options };
}

/** Lien manuel → lecteurs. Sur le site (pas de lecture de pages) : le lien est affiché tel quel. */
async function depuisLien(s: ServicesTsuzuku, url: string, label: string, kind: 'anime' | 'movie'): Promise<Lecture> {
  const media = classerMedia(url);
  // Page d'une de vos sources : c'est un site complet, jamais affiché tel quel dans le lecteur.
  const pageDeSource = media === 'iframe' && Boolean(sourcePourUrl(await s.sources(), url));
  if (!s.lectureSources) {
    if (pageDeSource) {
      const diagnostic: DiagnosticLecture = { raison: 'site', titres: [], sources: [], urlPage: url };
      return { lecteurs: [], origine: 'aucune', message: `Lecteur introuvable : cette adresse est une page de votre source, pas un lecteur. ${MESSAGE_SITE}`, diagnostic };
    }
    return {
      lecteurs: [{ label: media === 'iframe' ? `${label} - page intégrée` : `${label} - fichier vidéo`, url, kind: media }],
      origine: 'manuel',
      message: media === 'iframe' ? `${MESSAGE_SITE} La page est affichée telle quelle (le site peut refuser l’intégration).` : undefined,
    };
  }
  const r = await lecteursPourPage(s.ctx, await s.sources(), url, { label, kind });
  if (!r.sources.length) {
    const diagnostic: DiagnosticLecture = { raison: 'aucun-lecteur', titres: [], sources: [], urlPage: url, lecteurs: r.diagnostic };
    return { lecteurs: [], origine: 'aucune', message: r.warning ?? messageEchec(diagnostic), diagnostic };
  }
  return { lecteurs: r.sources, origine: 'manuel', message: r.warning };
}

export async function lireAnime(
  s: ServicesTsuzuku,
  o: { id: string | number; titres: readonly string[]; numero: number; forcer?: boolean; langue?: LangueVersion | null },
): Promise<Lecture> {
  const debut = Date.now();
  const db = await s.depot.lire();
  const adresse = adresseEpisode(lireAssociation(db.manualSources, o.id), o.numero);
  if (adresse) {
    return depuisLien(s, adresse, `Épisode ${o.numero}`, 'anime');
  }
  try {
    let d = await episodesDisponibles(s, o);
    // Liste venue du cache sans cet épisode (sorti depuis ?) : une recherche fraîche avant de conclure.
    if (d.mesure?.cache && d.episodes.length && !d.episodes.some(e => e.number === o.numero) && !o.forcer) {
      d = await episodesDisponibles(s, { ...o, forcer: true });
    }
    if (!d.episodes.length) {
      return { lecteurs: [], origine: 'aucune', message: d.message, diagnostic: d.diagnostic };
    }
    const msEpisodes = Date.now() - debut;
    const langues = d.resultat?.langues;
    const autres = d.resultat?.source ? sourcesActives(await s.sources()).filter(x => x.id !== d.resultat!.source!.id).length : 0;
    let episodes = d.episodes;
    let joue: LangueVersion | null = langues?.courante ?? null;
    let avisLangue: string | undefined;
    if (o.langue && langues?.courante) {
      const r = await episodesDansLangue(s, d, o.langue, o.titres, { autresSources: true });
      if (r.episodes.some(e => e.number === o.numero)) {
        episodes = r.episodes;
        joue = o.langue;
      } else {
        // Pas dans la langue voulue : l'autre langue au même numéro, en le disant.
        const autre = autreLangue(o.langue);
        const r2 = await episodesDansLangue(s, d, autre, o.titres);
        if (r2.episodes.some(e => e.number === o.numero)) {
          episodes = r2.episodes;
          joue = autre;
          avisLangue = `${L(o.langue)} non disponible sur vos sources pour l’épisode ${o.numero}${r.raison ? ` (${r.raison})` : r.episodes.length ? ` (${L(o.langue)} : épisodes ${plagesNumeros(r.episodes.map(e => e.number))})` : ''} : lecture en ${L(autre)}.`;
        } else if (r.episodes.length) {
          episodes = r.episodes;
          joue = o.langue;
        }
      }
    }
    const ep: EpisodeSource | undefined = episodes.find(e => e.number === o.numero);
    if (!ep) {
      const diagnostic: DiagnosticLecture = { ...d.diagnostic, raison: 'episode-absent' };
      return { lecteurs: [], origine: 'aucune', message: messageEchec(diagnostic, o.numero), diagnostic, langue: joue, langues: etatLangues(d, o.numero, autres), avisLangue };
    }
    const msLangue = Date.now() - debut - msEpisodes;
    // En parallèle : la page de l'AUTRE langue sur la même source, pour griser le bouton si l'épisode n'y est
    // pas. Le lecteur ne l'attend pas (au plus un court instant) : le sélecteur se met à jour ensuite.
    const autre = joue ? langues?.variantes[autreLangue(joue)] : undefined;
    const verification: Promise<unknown> | undefined =
      autre && !autre.episodes && !autre.aChercher && d.resultat?.source ? lireLangue(s, d.resultat, autre.langue, o.titres).catch(() => undefined) : undefined;
    const trouves = await lecteursDeLEpisode(s, ep.url, { forcer: o.forcer });
    const verifiee = verification ? await Promise.race([verification.then(() => true), new Promise<boolean>(ok => setTimeout(() => ok(false), ATTENTE_VERIFICATION_MS))]) : true;
    const { lecteurs } = trouves;
    const mesure: MesureLecture = {
      etapes: [{ nom: 'épisodes', ms: msEpisodes }, ...(msLangue > 5 ? [{ nom: 'langue', ms: msLangue }] : []), { nom: 'lecteur', ms: trouves.ms }],
      cache: d.mesure?.cache && trouves.cache ? { origine: trouves.cache.origine, ageMs: Math.max(trouves.cache.ageMs, d.mesure.cache.ageMs) } : undefined,
      totalMs: Date.now() - debut,
    };
    const etatDesLangues = () => {
      const e = etatLangues(d, o.numero, autres);
      if (e && joue) e.courante = joue;
      return e;
    };
    const etat = etatDesLangues();
    const languesAJour = verifiee || !verification ? undefined : verification.then(etatDesLangues);
    if (lecteurs.length) return { lecteurs, origine: 'source', langue: joue, langues: etat, languesAJour, avisLangue, mesure };
    const diagnostic: DiagnosticLecture = { ...d.diagnostic, raison: 'aucun-lecteur', mesure, urlPage: ep.url, lecteurs: trouves.diagnostic };
    return { lecteurs, origine: 'aucune', message: messageEchec(diagnostic), diagnostic, langue: joue, langues: etat, languesAJour, avisLangue, mesure };
  } catch (erreur) {
    return { lecteurs: [], origine: 'aucune', message: messageDe(erreur), diagnostic: { raison: 'erreur', titres: [...o.titres], sources: [] } };
  }
}

/**
 * Prépare un épisode sans l'afficher (épisode suivant, autre langue) : la
 * liste d'épisodes vient du cache (celle que le lecteur vient d'utiliser),
 * seule la page de l'épisode est lue, et ses lecteurs gardés. Rien pour un
 * lien manuel ni pour une langue dont la liste n'est pas lue. Jamais d'erreur.
 */
export async function prechargerEpisode(s: ServicesTsuzuku, o: { id: string | number; titres: readonly string[]; numero: number; langue?: LangueVersion | null }): Promise<boolean> {
  try {
    if (!s.lectureSources) return false;
    const db = await s.depot.lire();
    if (adresseEpisode(lireAssociation(db.manualSources, o.id), o.numero)) return false;
    const d = await episodesDisponibles(s, o);
    if (!d.resultat?.source) return false;
    const langues = d.resultat.langues;
    // Autre langue : seulement si sa liste est déjà lue (jamais une page de série de plus pour précharger).
    const liste = !o.langue || !langues?.courante || o.langue === langues.courante ? d.episodes : langues.variantes[o.langue]?.episodes;
    const ep = liste?.find(e => e.number === o.numero);
    if (!ep) return false;
    return (await lecteursDeLEpisode(s, ep.url)).lecteurs.length > 0;
  } catch {
    return false;
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
    const debut = Date.now();
    const r = await trouverFilm(s.ctx, sources, { titres, annee: o.annee });
    if (r.sources.length) return { lecteurs: r.sources, origine: 'source', mesure: { etapes: [{ nom: 'recherche et lecteur', ms: Date.now() - debut }], totalMs: Date.now() - debut } };
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
