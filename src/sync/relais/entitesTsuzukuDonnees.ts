/**
 * Données PERSONNELLES de Tsuzuku dans le coffre serveur du compte (en plus
 * des sources, voir entitesTsuzuku.ts). Une entité par élément, pour que deux
 * appareils qui modifient deux titres différents gardent les deux :
 *
 *  - `tsuzuku:titre:<anime|movie>:<id>` → un titre de la bibliothèque (statut,
 *    favori, note, commentaire, épisode courant, dates). FUSIONNÉ (jamais l'un
 *    à la place de l'autre) : fiche à la plus récente, progression au maximum
 *    (voir tsuzuku/moteur/fusionBibliotheque.ts) ;
 *  - `tsuzuku:historique` → les épisodes vus, réunis (union, 200 au plus) ;
 *  - `tsuzuku:liens:<anime|movies>:<id>` → lien manuel d'un titre (dernier gagnant) ;
 *  - `tsuzuku:langue:<série>` → VF / VOSTFR choisi pour une série (dernier gagnant) ;
 *  - `tsuzuku:choix:<source>` → source partagée activée ou non pour soi (dernier gagnant) ;
 *  - `tsuzuku:fiabilite:<source>` → lecteurs qui marchent sur une source, FUSIONNÉ
 *    lecteur par lecteur (le résultat le plus récent gagne) ;
 *  - `tsuzuku:position:<titre>` → position dans l'épisode en cours, FUSIONNÉE
 *    (la plus récente gagne).
 *
 * Les valeurs sont émises sous forme canonique (clés triées) : deux appareils
 * qui ont la même chose produisent exactement la même empreinte, ce qui évite
 * tout aller-retour inutile après une fusion.
 *
 * Avant cette version, la bibliothèque voyageait d'un seul bloc
 * (`kv:tsuzuku.bibliotheque`, le dernier gagnant écrasait tout). Ce bloc,
 * encore envoyé par un appareil pas à jour ou déjà sur le serveur, est lu et
 * FUSIONNÉ titre par titre (`fusionnerBibliothequeRecue`), jamais émis.
 */

import { lireChoix } from '../../tsuzuku/app/gestion';
import { lirePreferencesLangue } from '../../tsuzuku/app/langues';
import { bornerPositions, lirePositions, positionValide, type PositionLecture } from '../../tsuzuku/app/positions';
import { fiabiliteValide, LECTEURS_PAR_SOURCE_MAX, type FiabiliteLecteur } from '../../tsuzuku/moteur/basculeLecteurs';
import { migrerBibliotheque, STATUTS, type Bibliotheque, type Entree, type EvenementHistorique, type Genre } from '../../tsuzuku/moteur/bibliotheque';
import { estampille, fusionnerEntrees, fusionnerHistoriques, jsonStable } from '../../tsuzuku/moteur/fusionBibliotheque';
import { assurerLiens } from '../../tsuzuku/moteur/liensManuels';
import { LANGUES_VERSION, type LangueVersion } from '../../tsuzuku/moteur/langues';
import { CLES } from '../../tsuzuku/plateforme/stockage';

export interface Acces {
  lire(cle: string): string | undefined | null;
  ecrire(cle: string, valeur: string): void;
}

/** Clés de la base portées par ces entités (une écriture déclenche un envoi). */
export const CLES_DONNEES_TSUZUKU: readonly string[] = [CLES.bibliotheque, CLES.languesSeries, CLES.choixSources, CLES.fiabiliteLecteurs, CLES.positions];

/** Préfixes (après `tsuzuku:`) des entités fusionnées plutôt que remplacées. */
export const QUOI_FUSIONNES: readonly string[] = ['titre', 'historique', 'fiabilite', 'position'];
/** Préfixes (après `tsuzuku:`) de ces entités. */
export const QUOI_DONNEES: readonly string[] = ['titre', 'historique', 'liens', 'langue', 'choix', 'fiabilite', 'position'];

const TAILLE_MAX_ENTITE = 200_000;
const canonique = <T>(v: T): T => JSON.parse(jsonStable(v)) as T;
const genreDe = (kind: string): Genre | undefined => (kind === 'anime' ? 'anime' : kind === 'movie' ? 'movie' : undefined);
const collectionDe = (g: Genre): 'anime' | 'movies' => (g === 'movie' ? 'movies' : 'anime');

/**
 * Bibliothèque de la base. `undefined` : illisible (rien n'est émis, et RIEN n'est supprimé
 * ailleurs : voir `ENTITES_INDISPONIBLES`) ; une bibliothèque reçue la remplacera.
 */
export function lireBibliotheque(lire: Acces['lire']): Bibliotheque | undefined {
  const texte = lire(CLES.bibliotheque);
  if (!texte) return migrerBibliotheque({});
  try {
    const brut = JSON.parse(texte) as unknown;
    return brut && typeof brut === 'object' && !Array.isArray(brut) ? migrerBibliotheque(brut) : undefined;
  } catch {
    return undefined;
  }
}

/** Entités des données personnelles de Tsuzuku. `illisibles` : préfixes d'entités à ne pas croire supprimées. */
export function entitesDonneesTsuzuku(lire: Acces['lire']): { entites: Record<string, unknown>; illisibles: string[] } {
  const entites: Record<string, unknown> = {};
  const illisibles: string[] = [];
  const db = lireBibliotheque(lire);
  if (db) {
    for (const e of db.anime) entites[`tsuzuku:titre:anime:${e.id}`] = canonique(e);
    for (const e of db.movies) entites[`tsuzuku:titre:movie:${e.id}`] = canonique(e);
    if (db.history.length) entites['tsuzuku:historique'] = canonique(fusionnerHistoriques(db.history, []));
    for (const [id, a] of Object.entries(db.manualSources.anime)) entites[`tsuzuku:liens:anime:${id}`] = canonique(a);
    for (const [id, f] of Object.entries(db.manualSources.movies)) entites[`tsuzuku:liens:movies:${id}`] = canonique(f);
  } else {
    illisibles.push('tsuzuku:titre:', 'tsuzuku:liens:', 'tsuzuku:historique');
  }
  for (const [cle, l] of Object.entries(lirePreferencesLangue(lire(CLES.languesSeries)))) entites[`tsuzuku:langue:${cle}`] = l;
  for (const [id, actif] of Object.entries(lireChoix(lire(CLES.choixSources)))) entites[`tsuzuku:choix:${id}`] = actif;
  for (const [source, lecteurs] of Object.entries(lireFiabilite(lire))) entites[`tsuzuku:fiabilite:${source}`] = canonique(lecteurs);
  for (const [cle, p] of Object.entries(lirePositions(lire(CLES.positions)))) entites[`tsuzuku:position:${cle}`] = canonique(p);
  return { entites, illisibles };
}

const lireFiabilite = (lire: Acces['lire']) => {
  try {
    const texte = lire(CLES.fiabiliteLecteurs);
    return texte ? fiabiliteValide(JSON.parse(texte)) : {};
  } catch {
    return {};
  }
};

const nombreOuNull = (v: unknown, max: number): boolean => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max);
const texteOuNull = (v: unknown, max: number): boolean => v === null || v === undefined || (typeof v === 'string' && v.length <= max);

/**
 * Titre reçu : vérifié champ par champ SANS le réécrire (une valeur valide revient identique, sinon
 * la fusion repartirait sans fin) ; une valeur invalide est refusée. L'affiche doit être en http(s).
 */
export function titreRecuValide(brut: unknown, genre: Genre, id: string): Entree | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  if (JSON.stringify(brut).length > TAILLE_MAX_ENTITE) return undefined;
  const e = brut as Record<string, unknown>;
  if (String(e.id) !== id || (e.kind !== undefined && e.kind !== genre)) return undefined;
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 300) return undefined;
  if (!STATUTS.includes(e.status as never)) return undefined;
  if (e.image !== null && e.image !== undefined && (typeof e.image !== 'string' || !/^https?:\/\/[^\s/?#]+/i.test(e.image) || e.image.length > 2000)) return undefined;
  if (!nombreOuNull(e.currentEpisode, 100_000) || !nombreOuNull(e.totalEpisodes, 100_000) || !nombreOuNull(e.runtime, 100_000) || !nombreOuNull(e.year, 10_000) || !nombreOuNull(e.rating, 10)) return undefined;
  if (!texteOuNull(e.comment, 2000) || !texteOuNull(e.dateAdded, 40) || !texteOuNull(e.lastWatched, 40) || !texteOuNull(e.watchedAt, 40)) return undefined;
  if (e.watchedElsewhere !== null && e.watchedElsewhere !== undefined && (typeof e.watchedElsewhere !== 'object' || Array.isArray(e.watchedElsewhere))) return undefined;
  const sortie = canonique({ ...e, id, kind: genre }) as Entree;
  if (e._sync !== undefined) sortie._sync = estampille(sortie);
  return canonique(sortie);
}

function evenementsRecus(brut: unknown): EvenementHistorique[] | undefined {
  if (!Array.isArray(brut)) return undefined;
  return brut
    .filter(
      (h): h is EvenementHistorique =>
        !!h &&
        typeof h === 'object' &&
        (h.kind === 'anime' || h.kind === 'movie') &&
        typeof h.animeId === 'string' &&
        typeof h.title === 'string' &&
        h.title.length <= 300 &&
        Number.isFinite(h.episode) &&
        typeof h.watchedAt === 'string' &&
        h.watchedAt.length <= 40,
    )
    .slice(0, 400);
}

/** Fusion de la fiabilité d'une source : par lecteur, le résultat le plus récent gagne ; 20 lecteurs au plus. */
export function fusionnerFiabilite(a: Record<string, FiabiliteLecteur>, b: Record<string, FiabiliteLecteur>): Record<string, FiabiliteLecteur> {
  const sortie: Record<string, FiabiliteLecteur> = { ...a };
  for (const [cle, f] of Object.entries(b)) {
    const g = sortie[cle];
    if (!g || f.a > g.a || (f.a === g.a && jsonStable(f) > jsonStable(g))) sortie[cle] = f;
  }
  const gardes = Object.entries(sortie)
    .sort(([ca, x], [cb, y]) => y.a - x.a || (ca < cb ? -1 : 1))
    .slice(0, LECTEURS_PAR_SOURCE_MAX);
  return Object.fromEntries(gardes.sort(([ca], [cb]) => (ca < cb ? -1 : 1)));
}

/** Fusion de deux positions d'un même titre : la plus récente gagne. */
export function fusionnerPositions(a: PositionLecture, b: PositionLecture): PositionLecture {
  return a.a > b.a || (a.a === b.a && jsonStable(a) >= jsonStable(b)) ? a : b;
}

function ecrireBibliotheque(base: Acces, modifier: (db: Bibliotheque) => void): void {
  // Illisible ici : la version reçue la remplace (réparation par le serveur).
  const db = lireBibliotheque(base.lire) ?? migrerBibliotheque({});
  modifier(db);
  base.ecrire(CLES.bibliotheque, JSON.stringify(db));
}

/** Range un titre (fusionné avec celui d'ici s'il existe). */
function rangerTitre(db: Bibliotheque, recu: Entree): void {
  const liste = db[collectionDe(recu.kind)];
  const i = liste.findIndex(x => String(x.id) === String(recu.id));
  if (i < 0) liste.push(recu);
  else liste[i] = fusionnerEntrees(liste[i], recu);
}

/** Écrit une entité reçue ; `false` si elle est inconnue ou invalide (rien n'est écrit). */
export function ecrireEntiteDonnees(base: Acces, quoi: string, cle: string, valeur: unknown): boolean {
  switch (quoi) {
    case 'titre': {
      const i = cle.indexOf(':');
      const genre = genreDe(cle.slice(0, i));
      const id = cle.slice(i + 1);
      const recu = genre && id ? titreRecuValide(valeur, genre, id) : undefined;
      if (!recu) return false;
      ecrireBibliotheque(base, db => rangerTitre(db, recu));
      return true;
    }
    case 'historique': {
      const recus = evenementsRecus(valeur);
      if (!recus) return false;
      ecrireBibliotheque(base, db => {
        db.history = fusionnerHistoriques(db.history, recus);
      });
      return true;
    }
    case 'liens': {
      const i = cle.indexOf(':');
      const collection = cle.slice(0, i);
      const id = cle.slice(i + 1);
      if ((collection !== 'anime' && collection !== 'movies') || !id || id.length > 100) return false;
      if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur) || JSON.stringify(valeur).length > TAILLE_MAX_ENTITE) return false;
      ecrireBibliotheque(base, db => {
        db.manualSources = assurerLiens({ ...db.manualSources, [collection]: { ...db.manualSources[collection], [id]: valeur } });
      });
      return true;
    }
    case 'langue': {
      if (!LANGUES_VERSION.includes(valeur as LangueVersion) || cle.length > 120) return false;
      base.ecrire(CLES.languesSeries, JSON.stringify({ ...lirePreferencesLangue(base.lire(CLES.languesSeries)), [cle]: valeur }));
      return true;
    }
    case 'choix': {
      if (typeof valeur !== 'boolean' || cle.length > 100) return false;
      base.ecrire(CLES.choixSources, JSON.stringify({ ...lireChoix(base.lire(CLES.choixSources)), [cle]: valeur }));
      return true;
    }
    case 'fiabilite': {
      const recue = fiabiliteValide({ [cle]: valeur })[cle];
      if (!recue || cle.length > 200) return false;
      const toutes = lireFiabilite(base.lire);
      toutes[cle] = fusionnerFiabilite(toutes[cle] ?? {}, recue);
      base.ecrire(CLES.fiabiliteLecteurs, JSON.stringify(toutes));
      return true;
    }
    case 'position': {
      const recue = positionValide(valeur);
      if (!recue || cle.length > 120) return false;
      const toutes = lirePositions(base.lire(CLES.positions));
      toutes[cle] = toutes[cle] ? fusionnerPositions(toutes[cle], recue) : recue;
      base.ecrire(CLES.positions, JSON.stringify(bornerPositions(toutes)));
      return true;
    }
    default:
      return false;
  }
}

/** Suppression venue d'un autre appareil. L'historique ne se supprime jamais (union). */
export function supprimerEntiteDonnees(base: Acces, quoi: string, cle: string): void {
  const retirerDe = (parametre: string, lireCarte: (t: string | null | undefined) => Record<string, unknown>) => {
    const carte = lireCarte(base.lire(parametre));
    if (cle in carte) {
      delete carte[cle];
      base.ecrire(parametre, JSON.stringify(carte));
    }
  };
  switch (quoi) {
    case 'titre': {
      const i = cle.indexOf(':');
      const genre = genreDe(cle.slice(0, i));
      const id = cle.slice(i + 1);
      const db = lireBibliotheque(base.lire);
      if (!genre || !db) return;
      const liste = db[collectionDe(genre)];
      if (!liste.some(e => String(e.id) === id)) return;
      db[collectionDe(genre)] = liste.filter(e => String(e.id) !== id);
      base.ecrire(CLES.bibliotheque, JSON.stringify(db));
      return;
    }
    case 'liens': {
      const i = cle.indexOf(':');
      const collection = cle.slice(0, i) as 'anime' | 'movies';
      const id = cle.slice(i + 1);
      const db = lireBibliotheque(base.lire);
      if (!db || (collection !== 'anime' && collection !== 'movies') || !(id in db.manualSources[collection])) return;
      delete db.manualSources[collection][id];
      base.ecrire(CLES.bibliotheque, JSON.stringify(db));
      return;
    }
    case 'langue':
      retirerDe(CLES.languesSeries, lirePreferencesLangue);
      return;
    case 'choix':
      retirerDe(CLES.choixSources, lireChoix);
      return;
    case 'fiabilite':
      retirerDe(CLES.fiabiliteLecteurs, t => {
        try {
          return t ? fiabiliteValide(JSON.parse(t)) : {};
        } catch {
          return {};
        }
      });
      return;
    case 'position':
      retirerDe(CLES.positions, lirePositions);
      return;
    default:
      // `historique` : union, jamais supprimé.
      return;
  }
}

/**
 * Ancien bloc `kv:tsuzuku.bibliotheque` reçu (appareil pas encore à jour, ou déjà sur le serveur) :
 * fusionné titre par titre avec la bibliothèque d'ici. Rien n'est perdu ni doublé : même titre =
 * même identifiant ; historique réuni ; lien manuel le plus récent gardé.
 */
export function fusionnerBibliothequeRecue(base: Acces, valeur: unknown): boolean {
  let brut: unknown;
  try {
    brut = typeof valeur === 'string' ? JSON.parse(valeur) : valeur;
  } catch {
    return false;
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return false;
  const recue = migrerBibliotheque(brut);
  ecrireBibliotheque(base, db => {
    for (const genre of ['anime', 'movie'] as const) {
      for (const e of recue[collectionDe(genre)]) {
        const propre = titreRecuValide(canonique(e), genre, String(e.id));
        if (propre) rangerTitre(db, propre);
      }
    }
    db.history = fusionnerHistoriques(db.history, evenementsRecus(recue.history) ?? []);
    const date = (v: unknown) => {
      const o = (v ?? {}) as { updatedAt?: unknown; savedAt?: unknown };
      return String(o.updatedAt ?? o.savedAt ?? '');
    };
    for (const collection of ['anime', 'movies'] as const) {
      const ici = { ...db.manualSources[collection] } as Record<string, unknown>;
      for (const [id, lien] of Object.entries(recue.manualSources[collection])) {
        if (!(id in ici) || date(lien) > date(ici[id])) ici[id] = lien;
      }
      db.manualSources = assurerLiens({ ...db.manualSources, [collection]: ici });
    }
  });
  return true;
}
