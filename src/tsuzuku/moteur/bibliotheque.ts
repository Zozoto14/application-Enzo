/**
 * Bibliotheque de l'utilisateur : statuts, « vu ailleurs », historique
 * borne, deja vu, import/export JSON et migration des anciens fichiers
 * backend/data/libraries/{userId}.json de Tsuzuku.
 *
 * Modele versionne :
 *   v1 (historique) : { anime: [...], history: [...] }
 *   v2              : { version: 2, anime, movies, history, manualSources }
 *
 * La migration se fait en memoire a la lecture ; rien n'est perdu (les
 * champs inconnus d'une entree sont conserves). Les fonctions de ce module
 * MODIFIENT la `Bibliotheque` recue ; `DepotBibliotheque.modifier` en fournit
 * une copie fraiche et l'enregistre ensuite, via l'interface `Stockage`.
 */

import { adresseEnTexte, analyserAdresse } from './adresse';
import { echec } from './erreurs';
import { estampiller } from './fusionBibliotheque';
import { assurerLiens, type LiensManuels } from './liensManuels';
import { estObjet, genererIdentifiant, horlogeSysteme, instantDe, jourDe, normaliserTexte, type Horloge } from './outils';

export const VERSION_BIBLIOTHEQUE = 2;
export const TYPES = ['anime', 'movie'] as const;
export type Genre = (typeof TYPES)[number];
export const STATUTS = ['a_voir', 'en_cours', 'a_reprendre', 'vu', 'vu_ailleurs'] as const;
export type Statut = (typeof STATUTS)[number];
export const HISTORIQUE_MAX = 200;
export const ENTREES_MAX = 20000;

const VUS: ReadonlySet<string> = new Set(['vu', 'vu_ailleurs']);

export interface VuAilleurs {
  date: string | null;
  rating: number | null;
  comment: string | null;
  episodesWatched: number | null;
}

export interface Entree {
  id: string;
  kind: Genre;
  title: string;
  image: string | null;
  status: Statut;
  currentEpisode: number;
  totalEpisodes: number | null;
  runtime: number | null;
  year: number | null;
  rating: number | null;
  favorite: boolean;
  comment: string | null;
  watchedElsewhere: VuAilleurs | null;
  manual?: boolean;
  dateAdded: string | null;
  lastWatched: string | null;
  watchedAt?: string | null;
  [autre: string]: unknown;
}

export interface EvenementHistorique {
  kind: Genre;
  animeId: string;
  title: string;
  image: string | null;
  episode: number;
  watchedAt: string;
}

export interface Bibliotheque {
  version: number;
  anime: Entree[];
  movies: Entree[];
  history: EvenementHistorique[];
  manualSources: LiensManuels;
}

export interface ContexteBibliotheque {
  horloge?: Horloge;
  genererId?: () => string;
}

const jour = (c?: ContexteBibliotheque) => jourDe(c?.horloge ?? horlogeSysteme);

export function normaliserGenre(genre: unknown): Genre {
  return genre === 'movie' || genre === 'movies' || genre === 'film' ? 'movie' : 'anime';
}

// ---------------------------------------------------------------------------
// Adresses d'images (jamais autre chose que http(s))
// ---------------------------------------------------------------------------

function imageSure(brut: unknown): string | null {
  if (!brut) {
    return null;
  }
  const a = analyserAdresse(brut);
  return a && (a.schema === 'http' || a.schema === 'https') && a.hote && !a.identifiants ? adresseEnTexte(a) : null;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

function avecDefauts(entree: Record<string, unknown>, genre: Genre): Entree {
  return {
    ...entree,
    id: String(entree.id),
    kind: genre,
    watchedElsewhere: (entree.watchedElsewhere as VuAilleurs | null | undefined) ?? null,
    comment: (entree.comment as string | null | undefined) ?? null,
  } as Entree;
}

const entreesValides = (l: unknown): Record<string, unknown>[] =>
  Array.isArray(l) ? l.filter((e): e is Record<string, unknown> => estObjet(e) && e.id != null && e.id !== '') : [];

function evenementsValides(l: unknown): EvenementHistorique[] {
  return (Array.isArray(l) ? l : []).filter(estObjet).slice(0, HISTORIQUE_MAX) as unknown as EvenementHistorique[];
}

/** Remet une bibliotheque de n'importe quelle version (ou un objet quelconque) au format courant. */
export function migrerBibliotheque(brut: unknown): Bibliotheque {
  const src = estObjet(brut) ? brut : {};
  return {
    version: VERSION_BIBLIOTHEQUE,
    anime: entreesValides(src.anime).map(e => avecDefauts(e, 'anime')),
    movies: entreesValides(src.movies).map(e => avecDefauts(e, 'movie')),
    history: evenementsValides(src.history),
    manualSources: assurerLiens(src.manualSources),
  };
}

/**
 * Lit le texte d'un ancien fichier backend/data/libraries/{userId}.json.
 * Leve une erreur claire si le JSON est illisible (on ne remplace jamais
 * silencieusement par une bibliotheque vide).
 */
export function migrerFichierHerite(texte: string): Bibliotheque {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw echec('Bibliotheque illisible (JSON invalide)');
  }
  if (!estObjet(brut)) {
    throw echec('Bibliotheque illisible (objet attendu)');
  }
  return migrerBibliotheque(brut);
}

// ---------------------------------------------------------------------------
// Acces
// ---------------------------------------------------------------------------

export function collection(db: Bibliotheque, genre: unknown): Entree[] {
  return normaliserGenre(genre) === 'movie' ? db.movies : db.anime;
}

export function trouver(db: Bibliotheque, genre: unknown, id: string | number): Entree | null {
  return collection(db, genre).find(e => String(e.id) === String(id)) ?? null;
}

/** Date a laquelle le titre a ete vu, ou null s'il ne l'a pas ete. */
export function dateVu(entree: Entree | null | undefined): string | null {
  if (!entree || !VUS.has(entree.status)) {
    return null;
  }
  return entree.watchedElsewhere?.date || entree.watchedAt || entree.lastWatched || entree.dateAdded || null;
}

export interface DejaVu {
  vu: boolean;
  /** « vu » sur la plateforme, « vu_ailleurs » hors de celle-ci. */
  statut: Statut | null;
  date: string | null;
  entree: Entree | null;
}

/**
 * Ce titre est-il deja vu ? Par identifiant, sinon (saisie libre, autre
 * catalogue) par titre normalise, et par annee si les deux la connaissent.
 */
export function dejaVu(db: Bibliotheque, genre: unknown, cible: { id?: string | number | null; title?: string | null; year?: number | null }): DejaVu {
  let entree = cible.id != null && cible.id !== '' ? trouver(db, genre, cible.id) : null;
  if (!entree && cible.title) {
    const voulu = normaliserTexte(cible.title);
    entree =
      collection(db, genre).find(e => {
        if (!voulu || normaliserTexte(e.title) !== voulu) {
          return false;
        }
        return !(cible.year && e.year && Number(cible.year) !== Number(e.year));
      }) ?? null;
  }
  const date = dateVu(entree);
  return { vu: date !== null || (entree ? VUS.has(entree.status) : false), statut: entree?.status ?? null, date, entree };
}

// ---------------------------------------------------------------------------
// Validation de saisies
// ---------------------------------------------------------------------------

function dateNettoyee(valeur: unknown, c?: ContexteBibliotheque): string {
  if (!valeur) {
    return jour(c);
  }
  const t = String(valeur).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) {
    throw echec('Date invalide (AAAA-MM-JJ)');
  }
  return t;
}

export function noteNettoyee(valeur: unknown): number | null {
  if (valeur === undefined || valeur === null || valeur === '') {
    return null;
  }
  const n = Number(valeur);
  if (!Number.isFinite(n) || n < 0 || n > 10) {
    throw echec('La note doit etre comprise entre 0 et 10');
  }
  return Math.round(n * 10) / 10;
}

const texteNettoye = (v: unknown, max: number): string | null => (v == null || v === '' ? null : String(v).trim().slice(0, max) || null);

export function creerEntree(
  genre: unknown,
  o: { id: string | number; title: string; image?: unknown; totalEpisodes?: number | null; runtime?: number | null; year?: number | null; status?: Statut },
  c?: ContexteBibliotheque,
): Entree {
  return {
    id: String(o.id),
    kind: normaliserGenre(genre),
    title: String(o.title).trim().slice(0, 300),
    image: imageSure(o.image),
    status: o.status ?? 'a_voir',
    currentEpisode: 0,
    totalEpisodes: o.totalEpisodes ?? null,
    runtime: o.runtime ?? null,
    year: o.year ?? null,
    rating: null,
    favorite: false,
    comment: null,
    watchedElsewhere: null,
    dateAdded: jour(c),
    lastWatched: null,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Ajoute un titre (ou met a jour son statut s'il est deja la). */
export function ajouterOuMettreAJour(
  db: Bibliotheque,
  genre: unknown,
  o: { id: string | number; title: string; image?: unknown; totalEpisodes?: number | null; runtime?: number | null; year?: number | null; status?: Statut },
  c?: ContexteBibliotheque,
): Entree {
  const statut = o.status ?? 'a_voir';
  if (!STATUTS.includes(statut)) {
    throw echec('Statut invalide');
  }
  if (o.id == null || o.id === '' || !o.title) {
    throw echec('id et title sont requis');
  }
  const existante = trouver(db, genre, o.id);
  if (existante) {
    existante.status = statut;
    existante.title = String(o.title).trim().slice(0, 300);
    existante.image = imageSure(o.image) ?? existante.image;
    existante.totalEpisodes = o.totalEpisodes ?? existante.totalEpisodes;
    existante.runtime = o.runtime ?? existante.runtime ?? null;
    if (statut === 'vu' && !existante.watchedAt) {
      existante.watchedAt = jour(c);
    }
    if (statut !== 'vu_ailleurs') {
      existante.watchedElsewhere = null;
    }
    return existante;
  }
  const creee = creerEntree(genre, { ...o, status: statut }, c);
  if (statut === 'vu') {
    creee.watchedAt = jour(c);
  }
  collection(db, genre).push(creee);
  return creee;
}

export interface Modifications {
  status?: Statut;
  currentEpisode?: number;
  rating?: number | null;
  favorite?: boolean;
  totalEpisodes?: number | null;
  comment?: string | null;
}

export function ajouterHistorique(db: Bibliotheque, entree: Entree, episode: number, c?: ContexteBibliotheque) {
  db.history.unshift({
    kind: entree.kind,
    animeId: entree.id,
    title: entree.title,
    image: entree.image,
    episode,
    watchedAt: instantDe(c?.horloge ?? horlogeSysteme),
  });
  db.history = db.history.slice(0, HISTORIQUE_MAX);
}

export function modifierEntree(db: Bibliotheque, genre: unknown, id: string | number, m: Modifications, c?: ContexteBibliotheque): Entree | null {
  if (m.status && !STATUTS.includes(m.status)) {
    throw echec('Statut invalide');
  }
  if (m.rating !== undefined && m.rating !== null) {
    noteNettoyee(m.rating);
  }
  const e = trouver(db, genre, id);
  if (!e) {
    return null;
  }
  if (m.status) {
    e.status = m.status;
    if (m.status === 'vu' && !e.watchedAt) {
      e.watchedAt = jour(c);
    }
    // Quitter « vu ailleurs » efface le detail qui s'y rapportait.
    if (m.status !== 'vu_ailleurs') {
      e.watchedElsewhere = null;
    }
  }
  if (m.rating !== undefined) {
    e.rating = noteNettoyee(m.rating);
  }
  if (m.favorite !== undefined) {
    e.favorite = Boolean(m.favorite);
  }
  if (m.totalEpisodes !== undefined) {
    e.totalEpisodes = m.totalEpisodes;
  }
  if (m.comment !== undefined) {
    e.comment = m.comment ? String(m.comment).slice(0, 2000) : null;
  }
  if (m.currentEpisode !== undefined) {
    e.currentEpisode = Math.max(0, Math.floor(Number(m.currentEpisode)) || 0);
    e.lastWatched = jour(c);
    ajouterHistorique(db, e, e.currentEpisode, c);
  }
  return e;
}

/** Progression depuis le lecteur : episode pour un anime, film termine sinon. */
export function enregistrerProgression(db: Bibliotheque, genre: unknown, id: string | number, episode: number, c?: ContexteBibliotheque): Entree | null {
  const g = normaliserGenre(genre);
  const numero = g === 'movie' ? 1 : Number(episode);
  if (!Number.isInteger(numero) || numero < 1) {
    throw echec("Numero d'episode invalide");
  }
  const e = trouver(db, g, id);
  if (!e) {
    return null;
  }
  e.lastWatched = jour(c);
  if (g === 'movie') {
    e.status = 'vu';
    e.watchedAt = jour(c);
    e.watchedElsewhere = null;
  } else {
    if (numero > (e.currentEpisode || 0)) {
      e.currentEpisode = numero;
    }
    e.status = e.totalEpisodes && e.currentEpisode >= e.totalEpisodes ? 'vu' : 'en_cours';
    if (e.status === 'vu') {
      e.watchedAt = jour(c);
    }
  }
  ajouterHistorique(db, e, numero, c);
  return e;
}

export function supprimerEntree(db: Bibliotheque, genre: unknown, id: string | number): boolean {
  const liste = collection(db, genre);
  const i = liste.findIndex(e => String(e.id) === String(id));
  if (i === -1) {
    return false;
  }
  liste.splice(i, 1);
  return true;
}

export interface SaisieVuAilleurs {
  kind?: unknown;
  id?: string | number | null;
  title?: string;
  image?: unknown;
  date?: unknown;
  rating?: unknown;
  comment?: unknown;
  totalEpisodes?: number | null;
  runtime?: number | null;
  year?: number | null;
  episodesWatched?: unknown;
}

/**
 * Marque un titre comme vu hors de la plateforme. Cree l'entree au besoin
 * (y compris sans identifiant de catalogue : saisie libre, id `manuel-...`).
 */
export function marquerVuAilleurs(db: Bibliotheque, s: SaisieVuAilleurs = {}, c?: ContexteBibliotheque): Entree {
  const genre = normaliserGenre(s.kind);
  const titre = texteNettoye(s.title, 300);
  if (!titre) {
    throw echec('Le titre est requis');
  }
  const date = dateNettoyee(s.date, c);
  const note = noteNettoyee(s.rating);
  const commentaire = texteNettoye(s.comment, 2000);

  let id = s.id != null && s.id !== '' ? String(s.id).slice(0, 100) : null;
  if (!id) {
    id = `manuel-${(c?.genererId ?? genererIdentifiant)()}`;
  }
  const liste = collection(db, genre);
  let e = liste.find(x => String(x.id) === id);
  if (!e) {
    e = creerEntree(genre, { id, title: titre, image: s.image, totalEpisodes: s.totalEpisodes ?? null, runtime: s.runtime ?? null, year: s.year ?? null }, c);
    e.manual = id.startsWith('manuel-');
    liste.push(e);
  }

  let episodesVus: number | null = null;
  if (genre === 'anime') {
    const total = e.totalEpisodes ?? s.totalEpisodes ?? null;
    const brut = s.episodesWatched;
    if (brut === undefined || brut === null || brut === '') {
      episodesVus = total;
    } else {
      episodesVus = Math.max(0, Math.floor(Number(brut)) || 0);
      if (total) {
        episodesVus = Math.min(episodesVus, total);
      }
    }
    if (episodesVus != null) {
      e.currentEpisode = Math.max(e.currentEpisode || 0, episodesVus);
    }
  }
  e.status = 'vu_ailleurs';
  e.watchedElsewhere = { date, rating: note, comment: commentaire, episodesWatched: episodesVus };
  if (note != null) {
    e.rating = note;
  }
  if (commentaire) {
    e.comment = commentaire;
  }
  return e;
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

export function statistiques(db: Bibliotheque) {
  const bloc = (liste: Entree[]) => {
    const parStatut = Object.fromEntries(STATUTS.map(s => [s, 0])) as Record<Statut, number>;
    for (const e of liste) {
      if (parStatut[e.status] !== undefined) {
        parStatut[e.status] += 1;
      }
    }
    const notes = liste.filter(e => typeof e.rating === 'number') as (Entree & { rating: number })[];
    return {
      total: liste.length,
      byStatus: parStatut,
      seen: parStatut.vu + parStatut.vu_ailleurs,
      watchedElsewhere: parStatut.vu_ailleurs,
      favorites: liste.filter(e => e.favorite).length,
      averageRating: notes.length ? Math.round((notes.reduce((a, e) => a + e.rating, 0) / notes.length) * 10) / 10 : null,
    };
  };
  const anime = { ...bloc(db.anime), episodesWatched: db.anime.reduce((a, e) => a + (e.currentEpisode || 0), 0) };
  const movies = {
    ...bloc(db.movies),
    minutesWatched: db.movies.filter(e => VUS.has(e.status)).reduce((a, e) => a + (Number(e.runtime) || 0), 0),
  };
  return { anime, movies };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export interface Sauvegarde {
  app: 'tsuzuku';
  version: number;
  exportedAt: string;
  anime: Entree[];
  movies: Entree[];
  history: EvenementHistorique[];
  manualSources: LiensManuels;
}

export function exporterBibliotheque(db: Bibliotheque, c?: ContexteBibliotheque): Sauvegarde {
  return {
    app: 'tsuzuku',
    version: VERSION_BIBLIOTHEQUE,
    exportedAt: instantDe(c?.horloge ?? horlogeSysteme),
    anime: db.anime,
    movies: db.movies,
    history: db.history,
    manualSources: db.manualSources,
  };
}

export const exporterEnTexte = (db: Bibliotheque, c?: ContexteBibliotheque) => JSON.stringify(exporterBibliotheque(db, c), null, 2);

const nombreOuNull = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
const dateOuNull = (v: unknown): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const noteOuNull = (v: unknown): number | null => {
  try {
    return noteNettoyee(v);
  } catch {
    return null;
  }
};

/** Nettoie une entree importee : on ne fait confiance a rien. */
export function nettoyerEntreeImportee(brut: unknown, genre: Genre, c?: ContexteBibliotheque): Entree | null {
  if (!estObjet(brut)) {
    return null;
  }
  const id = brut.id != null ? String(brut.id).slice(0, 100) : '';
  const titre = texteNettoye(brut.title, 300);
  if (!id || !titre) {
    return null;
  }
  const ve = estObjet(brut.watchedElsewhere) ? brut.watchedElsewhere : null;
  return {
    id,
    kind: genre,
    title: titre,
    image: imageSure(brut.image),
    status: STATUTS.includes(brut.status as Statut) ? (brut.status as Statut) : 'a_voir',
    currentEpisode: Math.floor(nombreOuNull(brut.currentEpisode) || 0),
    totalEpisodes: nombreOuNull(brut.totalEpisodes),
    runtime: nombreOuNull(brut.runtime),
    year: nombreOuNull(brut.year),
    rating: noteOuNull(brut.rating),
    favorite: Boolean(brut.favorite),
    comment: texteNettoye(brut.comment, 2000),
    watchedElsewhere: ve
      ? { date: dateOuNull(ve.date), rating: noteOuNull(ve.rating), comment: texteNettoye(ve.comment, 2000), episodesWatched: nombreOuNull(ve.episodesWatched) }
      : null,
    manual: Boolean(brut.manual),
    dateAdded: dateOuNull(brut.dateAdded) || jour(c),
    lastWatched: dateOuNull(brut.lastWatched),
    watchedAt: dateOuNull(brut.watchedAt),
  };
}

export interface RapportImport {
  anime: number;
  movies: number;
  skipped: number;
}

/**
 * Importe une sauvegarde (objet). `fusion` (defaut) met a jour les titres
 * existants et ajoute les nouveaux ; `remplacement` remplace les deux listes.
 * Les liens manuels et l'historique du fichier sont fusionnes aussi.
 */
export function importerBibliotheque(db: Bibliotheque, donnees: unknown, mode: 'fusion' | 'remplacement' = 'fusion', c?: ContexteBibliotheque): RapportImport {
  if (!estObjet(donnees)) {
    throw echec('Fichier de sauvegarde invalide');
  }
  const rapport: RapportImport = { anime: 0, movies: 0, skipped: 0 };
  for (const genre of TYPES) {
    const cle = genre === 'movie' ? 'movies' : 'anime';
    const propres: Entree[] = [];
    const liste = Array.isArray(donnees[cle]) ? (donnees[cle] as unknown[]) : [];
    for (const brut of liste.slice(0, ENTREES_MAX)) {
      const e = nettoyerEntreeImportee(brut, genre, c);
      if (e) {
        propres.push(e);
      } else {
        rapport.skipped += 1;
      }
    }
    if (mode === 'remplacement') {
      db[cle] = propres;
    } else {
      for (const e of propres) {
        const i = db[cle].findIndex(x => String(x.id) === e.id);
        if (i === -1) {
          db[cle].push(e);
        } else {
          db[cle][i] = { ...db[cle][i], ...e };
        }
      }
    }
    rapport[cle] = propres.length;
  }
  if (estObjet(donnees.manualSources)) {
    const liens = assurerLiens(donnees.manualSources);
    db.manualSources =
      mode === 'remplacement'
        ? liens
        : { anime: { ...db.manualSources.anime, ...liens.anime }, movies: { ...db.manualSources.movies, ...liens.movies } };
  }
  if (Array.isArray(donnees.history)) {
    const importes = evenementsValides(donnees.history);
    const existants = mode === 'remplacement' ? [] : db.history;
    const vus = new Set(existants.map(h => `${h.kind}|${h.animeId}|${h.episode}|${h.watchedAt}`));
    const nouveaux = importes.filter(h => !vus.has(`${h.kind}|${h.animeId}|${h.episode}|${h.watchedAt}`));
    db.history = [...existants, ...nouveaux].sort((a, b) => String(b.watchedAt).localeCompare(String(a.watchedAt))).slice(0, HISTORIQUE_MAX);
  }
  return rapport;
}

// ---------------------------------------------------------------------------
// Stockage
// ---------------------------------------------------------------------------

/**
 * Persistance fournie par la plateforme (fichier Electron, AsyncStorage ou
 * SQLite sur iPhone, localStorage/IndexedDB en navigateur, puis le
 * stockage du hub). Cle -> texte.
 */
export interface Stockage {
  lire(cle: string): Promise<string | null>;
  ecrire(cle: string, valeur: string): Promise<void>;
  supprimer(cle: string): Promise<void>;
}

export function stockageMemoire(initial: Record<string, string> = {}): Stockage & { contenu: Map<string, string> } {
  const contenu = new Map<string, string>(Object.entries(initial));
  return {
    contenu,
    lire: async cle => contenu.get(cle) ?? null,
    ecrire: async (cle, valeur) => {
      contenu.set(cle, valeur);
    },
    supprimer: async cle => {
      contenu.delete(cle);
    },
  };
}

/** Bibliotheque persistee : lectures migrees, ecritures serialisees, ecriture atomique cote plateforme. */
export class DepotBibliotheque {
  private file: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly stockage: Stockage,
    private readonly cle = 'tsuzuku.bibliotheque',
    private readonly horloge: Horloge = horlogeSysteme,
  ) {}

  async lire(): Promise<Bibliotheque> {
    const texte = await this.stockage.lire(this.cle);
    if (texte === null) {
      return migrerBibliotheque({});
    }
    // Illisible : on leve plutot que d'ecraser une bibliotheque recuperable.
    return migrerFichierHerite(texte);
  }

  /**
   * Applique `fn` sur une copie fraiche, puis enregistre. Serialise les appels concurrents.
   * Chaque titre modifie recoit son estampille (`_sync`, fiche et progression datees) : c'est
   * elle qui departage deux appareils (voir fusionBibliotheque.ts).
   */
  modifier<T>(fn: (db: Bibliotheque) => T | Promise<T>): Promise<T> {
    const tache = this.file.then(async () => {
      const db = await this.lire();
      const avant = { anime: db.anime.map(e => ({ ...e })), movies: db.movies.map(e => ({ ...e })) };
      const resultat = await fn(db);
      estampiller(avant, db, instantDe(this.horloge));
      await this.stockage.ecrire(this.cle, JSON.stringify(db));
      return resultat;
    });
    this.file = tache.then(
      () => undefined,
      () => undefined,
    );
    return tache;
  }

  /** Importe le texte d'un ancien fichier libraries/{userId}.json (remplace la bibliotheque). */
  importerFichierHerite(texte: string): Promise<Bibliotheque> {
    const db = migrerFichierHerite(texte);
    return this.modifier(actuelle => {
      Object.assign(actuelle, db);
      return actuelle;
    });
  }
}
