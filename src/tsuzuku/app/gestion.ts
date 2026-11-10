/**
 * Sources de Tsuzuku : droits par rang, partage entre utilisateurs, réglages
 * techniques (clés d'API, options avancées du moteur). Données pures : aucune
 * entrée/sortie, aucune horloge ; `services.ts` et la synchronisation s'en
 * servent, les écrans ne font que les consulter.
 *
 * DROITS (vérifiés ici, pas seulement dans l'interface) :
 *
 *  - seuls les FONDATEURS ajoutent, modifient, suppriment et partagent une
 *    source, et règlent les clés d'API et les options avancées. C'est l'option
 *    la plus protectrice : une source décide du contenu que tous les comptes
 *    verront, au même titre que les « apps globales », que les règles de rang
 *    réservent déjà aux Fondateurs (`ACTIONS_REFUSEES_ADMINISTRATEUR`,
 *    `src/hub/admin/roles.ts`). Administrateurs, Gestionnaires et Amis
 *    n'utilisent que les sources qui leur sont partagées ;
 *  - chaque utilisateur active ou désactive, POUR LUI SEUL, une source qui lui
 *    est partagée (`choix`), sans jamais la modifier.
 *
 * PARTAGE : pour chaque source, le Fondateur choisit « personne » (lui seul,
 * par défaut), « tous les utilisateurs autorisés à Tsuzuku » ou une sélection
 * de comptes. `publicationsParCompte` calcule ce que reçoit CHAQUE compte :
 * ses sources seulement, sans la liste des bénéficiaires (aucun autre compte
 * n'y apparaît) et sans aucune clé d'API (les sources n'en contiennent pas).
 */

import type { Rang } from '../../hub/admin/roles';
import { echec } from '../moteur/erreurs';
import { importerSources, supporteAnimes, supporteFilms, type DefinitionSource, type Langue } from '../moteur/sources';

// ------------------------------------------------------------------ Droits

/** Rangs habilités à gérer les sources et les réglages techniques de Tsuzuku. */
export const RANGS_GESTION_SOURCES: readonly Rang[] = ['fondateur'];

export const peutGererSources = (rang: Rang | undefined): boolean => rang !== undefined && RANGS_GESTION_SOURCES.includes(rang);

/** Lève une erreur 403 si le rang n'est pas habilité. */
export function exigerGestionSources(rang: Rang | undefined, quoi = 'Les sources'): void {
  if (!peutGererSources(rang)) {
    throw echec(`${quoi} de Tsuzuku sont réservé(e)s aux Fondateurs.`, 'configuration', 403);
  }
}

// ------------------------------------------------------------------ Lecture tolérante

const MOTIF_COMPTE = /^[a-z0-9]{6,16}$/;
const ID_PRINCIPAL = 'principal';
const MAX_SOURCES = 200;

function json(texte: string | null | undefined): unknown {
  if (!texte) return undefined;
  try {
    return JSON.parse(texte);
  } catch {
    return undefined;
  }
}

/** Liste de sources rangée dans la base (tableau ou `{ sources }`) ; illisible = vide. */
export function lireListeSources(texte: string | null | undefined): DefinitionSource[] {
  const brut = json(texte);
  return brut === undefined ? [] : importerSources(brut).sources;
}

// ------------------------------------------------------------------ Partage

export type ModePartage = 'personne' | 'tous' | 'selection';
export const MODES_PARTAGE: readonly ModePartage[] = ['personne', 'tous', 'selection'];

export interface PartageSource {
  mode: ModePartage;
  /** Comptes choisis (mode « selection ») ; ignorés sinon. */
  comptes: string[];
}

/** Par identifiant de source. Une source absente n'est partagée avec personne. */
export type Partages = Record<string, PartageSource>;

export const PARTAGE_DEFAUT: PartageSource = Object.freeze({ mode: 'personne', comptes: [] }) as PartageSource;

export function lirePartages(texte: string | null | undefined): Partages {
  const brut = json(texte);
  const sortie: Partages = {};
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return sortie;
  for (const [id, valeur] of Object.entries(brut as Record<string, unknown>).slice(0, MAX_SOURCES)) {
    const v = valeur as { mode?: unknown; comptes?: unknown } | null;
    if (!v || typeof id !== 'string' || id.length > 100) continue;
    const mode = MODES_PARTAGE.includes(v.mode as ModePartage) ? (v.mode as ModePartage) : 'personne';
    const comptes = Array.isArray(v.comptes)
      ? [...new Set(v.comptes.filter((c): c is string => typeof c === 'string' && MOTIF_COMPTE.test(c) && c !== ID_PRINCIPAL))].sort().slice(0, 500)
      : [];
    sortie[id] = { mode, comptes };
  }
  return sortie;
}

export const ecrirePartages = (p: Partages): string => JSON.stringify(lirePartages(JSON.stringify(p)));

export const partageDe = (partages: Partages, id: string): PartageSource => partages[id] ?? PARTAGE_DEFAUT;

/** Ce que la synchronisation sait d'un compte (lu dans l'annuaire). */
export interface CompteBeneficiaire {
  id: string;
  apps: readonly string[];
  actif: boolean;
}

/** Un compte peut recevoir des sources : actif, autorisé à Tsuzuku, autre que le compte historique. */
export const peutRecevoir = (c: CompteBeneficiaire): boolean => c.id !== ID_PRINCIPAL && c.actif && c.apps.includes('tsuzuku');

/** Comptes qui reçoivent cette source (identifiants triés). */
export function beneficiaires(partage: PartageSource, comptes: readonly CompteBeneficiaire[]): string[] {
  const eligibles = comptes.filter(peutRecevoir);
  switch (partage.mode) {
    case 'tous':
      return eligibles.map(c => c.id).sort();
    case 'selection':
      return eligibles.filter(c => partage.comptes.includes(c.id)).map(c => c.id).sort();
    default:
      return [];
  }
}

/** Forme publiée d'une source : la définition seule, activée (l'ami choisit ensuite pour lui). */
export function sourcePubliee(src: DefinitionSource): DefinitionSource {
  const copie: DefinitionSource = JSON.parse(JSON.stringify(src));
  copie.enabled = true;
  return copie;
}

/**
 * Ce que chaque compte doit recevoir : une entrée PAR COMPTE connu (liste vide
 * quand rien ne lui est partagé : c'est ainsi que le retrait se propage). Une
 * source désactivée par le Fondateur n'est plus publiée.
 */
export function publicationsParCompte(
  sources: readonly DefinitionSource[],
  partages: Partages,
  comptes: readonly CompteBeneficiaire[],
): Record<string, DefinitionSource[]> {
  const sortie: Record<string, DefinitionSource[]> = {};
  for (const c of comptes) {
    if (c.id !== ID_PRINCIPAL) sortie[c.id] = [];
  }
  for (const src of sources) {
    if (!src.enabled) continue;
    for (const id of beneficiaires(partageDe(partages, src.id), comptes)) {
      sortie[id].push(sourcePubliee(src));
    }
  }
  return sortie;
}

/** Retire des partages les sources supprimées (après une suppression). */
export function nettoyerPartages(partages: Partages, sources: readonly DefinitionSource[]): Partages {
  const ids = new Set(sources.map(s => s.id));
  return Object.fromEntries(Object.entries(partages).filter(([id]) => ids.has(id)));
}

// ------------------------------------------------------------------ Côté bénéficiaire

/** Sources reçues (copie en lecture seule, rangée dans la base du bénéficiaire). */
export interface SourcesRecues {
  v: 1;
  /** Date de la publication reçue. */
  date: string;
  sources: DefinitionSource[];
}

export function lireRecues(texte: string | null | undefined): SourcesRecues {
  const brut = json(texte) as { date?: unknown; sources?: unknown } | undefined;
  return {
    v: 1,
    date: typeof brut?.date === 'string' ? brut.date.slice(0, 40) : '',
    sources: brut && Array.isArray(brut.sources) ? importerSources(brut.sources.slice(0, MAX_SOURCES)).sources.map(sourcePubliee) : [],
  };
}

export const ecrireRecues = (r: { date: string; sources: readonly DefinitionSource[] }): string => JSON.stringify(lireRecues(JSON.stringify(r)));

/** Choix personnels : source partagée activée (vrai, défaut) ou désactivée pour soi. */
export type ChoixSources = Record<string, boolean>;

export function lireChoix(texte: string | null | undefined): ChoixSources {
  const brut = json(texte);
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  return Object.fromEntries(
    Object.entries(brut as Record<string, unknown>)
      .filter(([id, v]) => id.length <= 100 && typeof v === 'boolean')
      .slice(0, MAX_SOURCES),
  ) as ChoixSources;
}

/** Ce qu'un utilisateur voit d'une source partagée : nom, type, état. Jamais l'adresse d'un autre compte. */
export interface VueSourcePartagee {
  id: string;
  nom: string;
  animes: boolean;
  films: boolean;
  langue: Langue;
  actif: boolean;
}

export function vueSourcesPartagees(recues: SourcesRecues, choix: ChoixSources): VueSourcePartagee[] {
  return recues.sources.map(s => ({ id: s.id, nom: s.name, animes: supporteAnimes(s), films: supporteFilms(s), langue: s.language, actif: choix[s.id] ?? true }));
}

/**
 * Sources utilisables par le moteur : les siennes (Fondateur), puis celles
 * qui lui sont partagées, activées selon SON choix. Une source reçue qui
 * porte l'identifiant d'une des siennes est ignorée.
 */
export function sourcesUtilisables(propres: readonly DefinitionSource[], recues: SourcesRecues, choix: ChoixSources): DefinitionSource[] {
  const ids = new Set(propres.map(s => s.id));
  return [...propres, ...recues.sources.filter(s => !ids.has(s.id)).map(s => ({ ...s, enabled: choix[s.id] ?? true }))];
}

// ------------------------------------------------------------------ Réglages techniques

/** Clés d'API et options avancées du moteur (Administration › Tsuzuku). */
export interface ReglagesAvances {
  /** Clé TMDB (v3 ou jeton « Bearer »), facultative. */
  cleTmdb: string;
  /** Délai maximal d'une requête vers une source, en secondes. */
  delaiS: number;
  /** Taille maximale d'une page lue, en Mo. */
  tailleMaxMo: number;
}

export const AVANCES_DEFAUT: ReglagesAvances = Object.freeze({ cleTmdb: '', delaiS: 15, tailleMaxMo: 8 }) as ReglagesAvances;
export const BORNES_AVANCES = { delaiS: [5, 60], tailleMaxMo: [1, 16] } as const;

const borne = (v: unknown, [min, max]: readonly [number, number], defaut: number): number => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut;
};

/**
 * Lecture tolérante. `ancienneCle` : la clé TMDB rangée autrefois dans les
 * réglages de confort (`tsuzuku.reglages`), reprise tant qu'aucune n'est
 * enregistrée ici.
 */
export function lireAvances(texte: string | null | undefined, ancienneCle = ''): ReglagesAvances {
  const o = (json(texte) ?? {}) as Record<string, unknown>;
  const cle = typeof o.cleTmdb === 'string' ? o.cleTmdb.trim().slice(0, 600) : '';
  return {
    cleTmdb: cle || ancienneCle.trim().slice(0, 600),
    delaiS: borne(o.delaiS, BORNES_AVANCES.delaiS, AVANCES_DEFAUT.delaiS),
    tailleMaxMo: borne(o.tailleMaxMo, BORNES_AVANCES.tailleMaxMo, AVANCES_DEFAUT.tailleMaxMo),
  };
}

export const ecrireAvances = (a: ReglagesAvances): string => JSON.stringify(lireAvances(JSON.stringify(a)));

/**
 * Une clé n'est jamais réaffichée en entier après sa saisie : seulement ses
 * quatre derniers caractères, et encore, pour une clé assez longue.
 */
export function masquerCle(cle: string): string {
  const c = cle.trim();
  if (!c) return '';
  return c.length >= 16 ? `••••••••${c.slice(-4)}` : '••••••••';
}

// ------------------------------------------------------------------ Comptes bénéficiaires

/** Ce qu'il faut savoir d'un profil pour lui partager une source. */
export interface ProfilPartage {
  id: string;
  nom: string;
  actif?: boolean;
  apps?: readonly string[];
}

/** Comptes à qui une source peut être partagée : actifs, autorisés à Tsuzuku, autres que le compte historique. */
export function comptesPourPartage(tous: readonly ProfilPartage[] | undefined): Array<{ id: string; nom: string }> {
  return (tous ?? []).filter(p => p.id !== ID_PRINCIPAL && p.actif !== false && (p.apps ?? []).includes('tsuzuku')).map(p => ({ id: p.id, nom: p.nom }));
}

/**
 * « Qui reçoit quoi » : pour chaque compte, les sources (activées) qui lui
 * sont partagées. Les comptes donnés sont déjà les bénéficiaires possibles.
 */
export function quiRecoitQuoi(sources: readonly DefinitionSource[], partages: Partages, comptes: ReadonlyArray<{ id: string; nom: string }>): Array<{ id: string; nom: string; sources: string[] }> {
  return comptes.map(c => ({
    id: c.id,
    nom: c.nom,
    sources: sources
      .filter(s => s.enabled)
      .filter(s => {
        const p = partageDe(partages, s.id);
        return p.mode === 'tous' || (p.mode === 'selection' && p.comptes.includes(c.id));
      })
      .map(s => s.name),
  }));
}

// ------------------------------------------------------------------ Dernier test de chaque source

export interface ResultatTestSource {
  ok: boolean;
  /** Date ISO du test. */
  date: string;
  detail: string;
}

export type TestsSources = Record<string, ResultatTestSource>;

export function lireTests(texte: string | null | undefined): TestsSources {
  const brut = json(texte);
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const sortie: TestsSources = {};
  for (const [id, v] of Object.entries(brut as Record<string, unknown>).slice(0, MAX_SOURCES)) {
    const r = v as { ok?: unknown; date?: unknown; detail?: unknown } | null;
    if (!r || id.length > 100 || typeof r.ok !== 'boolean') continue;
    sortie[id] = { ok: r.ok, date: typeof r.date === 'string' ? r.date.slice(0, 40) : '', detail: typeof r.detail === 'string' ? r.detail.slice(0, 300) : '' };
  }
  return sortie;
}

export const ecrireTests = (t: TestsSources): string => JSON.stringify(lireTests(JSON.stringify(t)));

// ------------------------------------------------------------------ Export / import manuel (sauvegarde, autre appareil)

export const FORMAT_EXPORT_SOURCES = 'tsuzuku-sources';

/**
 * Fichier d'export des sources : leurs définitions SEULES. Jamais de clé
 * d'API (elles n'y sont pas), ni de partage (qui dépend des comptes de cet
 * appareil), ni d'en-tête « userAgent » propre à l'appareil.
 */
export function exporterSources(sources: readonly DefinitionSource[], date: string): string {
  const propres = sources.map(s => {
    const copie = JSON.parse(JSON.stringify(s)) as DefinitionSource & Record<string, unknown>;
    delete copie.userAgent;
    for (const cle of Object.keys(copie)) {
      if (/cle|key|token|secret|tmdb/i.test(cle)) delete copie[cle];
    }
    return copie;
  });
  return JSON.stringify({ format: FORMAT_EXPORT_SOURCES, v: 1, date, sources: propres }, null, 2);
}

// Import d'un export de sources : importSources.ts (il compile les sélecteurs CSS, donc charge l'analyseur HTML ;
// gestion.ts est lu au démarrage par la synchro et ne doit pas l'embarquer).
