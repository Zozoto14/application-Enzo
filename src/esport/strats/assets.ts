/**
 * Assets de l'éditeur de strats (cartes, agents, capacités de Valorant).
 *
 * Décision du Fondateur : images Riot DIRECTES, sous la politique Riot
 * « Legal Jibber Jabber » (contenu de fan, gratuit et non commercial), avec la
 * mention obligatoire (MENTION_RIOT) affichée dans l'éditeur et la doc. Aucun
 * lot d'images n'est versionné : données et images viennent, à l'exécution,
 * de l'API publique valorant-api.com (CDN media.valorant-api.com).
 *
 * Ordre de chargement (`chargerAssets`) :
 *  1. dossier d'assets REMPLAÇABLE livré avec le site : `esport-assets/
 *     manifeste.json` (absent par défaut ; voir manifeste.exemple.json) ;
 *  2. cache local frais (7 jours) ;
 *  3. valorant-api.com (cartes jouables avec minimap, agents jouables et
 *     leurs capacités, en français) ;
 *  4. cache local périmé ;
 *  5. repli générique intégré (noms seulement : formes et initiales).
 * Le champ `jeu` garde la structure prête pour d'autres jeux.
 */

export const URL_API_VALORANT = 'https://valorant-api.com/v1';
export const ORIGINES_ASSETS = ['https://valorant-api.com', 'https://media.valorant-api.com'];
export const CHEMIN_MANIFESTE_LOCAL = 'esport-assets/manifeste.json';
export const CLE_CACHE = 'esport.assets.valorant.v1';
export const DUREE_CACHE_MS = 7 * 86_400_000;
export const MENTION_RIOT =
  'AppDashboard was created under Riot Games\' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';

export interface CapaciteAsset {
  /** Emplacement stable (Ability1, Ability2, Grenade, Ultimate). */
  cle: string;
  nom: string;
  icone: string | null;
  /** Touche par défaut du jeu (C, Q, E, X). */
  touche: string;
}
export interface AgentAsset {
  cle: string;
  nom: string;
  role: string | null;
  icone: string | null;
  capacites: CapaciteAsset[];
}
export interface CarteAsset {
  cle: string;
  nom: string;
  /** Minimap (fond de l'éditeur). */
  minimap: string | null;
  /** Vignette (listes). */
  vignette: string | null;
}
export interface Assets {
  jeu: 'valorant';
  source: 'local' | 'cache' | 'api' | 'cache-perime' | 'repli';
  cartes: CarteAsset[];
  agents: AgentAsset[];
  majLe: number;
}

/** Stockage de clés-valeurs (localStorage sur le web ; rien sur iOS). */
export interface StockageAssets {
  lire(cle: string): string | null;
  ecrire(cle: string, valeur: string): void;
}

type ReponseMin = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchAssets = (url: string, init?: { signal?: AbortSignal }) => Promise<ReponseMin>;

const TOUCHES: Record<string, string> = { Ability1: 'Q', Ability2: 'E', Grenade: 'C', Ultimate: 'X' };
const ORDRE_SLOTS = ['Grenade', 'Ability1', 'Ability2', 'Ultimate'];

/** Clé stable d'un nom (« KAY/O » → « kay-o », « Abyss » → « abyss »). */
export function cleDe(nom: string): string {
  return (
    String(nom ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'inconnu'
  );
}

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/media\.valorant-api\.com\/[A-Za-z0-9/_.-]+$/.test(v) ? v : null);
const relatif = (v: unknown): string | null => (typeof v === 'string' && /^esport-assets\/[a-z0-9/_.-]+$/.test(v) && !v.includes('..') ? v : null);

// ------------------------------------------------------------------ Repli générique (sans réseau)

const CARTES_REPLI = ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset'];
const AGENTS_REPLI: Array<[string, string]> = [
  ['Astra', 'Contrôleur'], ['Breach', 'Initiateur'], ['Brimstone', 'Contrôleur'], ['Chamber', 'Sentinelle'], ['Clove', 'Contrôleur'], ['Cypher', 'Sentinelle'],
  ['Deadlock', 'Sentinelle'], ['Fade', 'Initiateur'], ['Gekko', 'Initiateur'], ['Harbor', 'Contrôleur'], ['Iso', 'Duelliste'], ['Jett', 'Duelliste'],
  ['KAY/O', 'Initiateur'], ['Killjoy', 'Sentinelle'], ['Neon', 'Duelliste'], ['Omen', 'Contrôleur'], ['Phoenix', 'Duelliste'], ['Raze', 'Duelliste'],
  ['Reyna', 'Duelliste'], ['Sage', 'Sentinelle'], ['Skye', 'Initiateur'], ['Sova', 'Initiateur'], ['Tejo', 'Initiateur'], ['Viper', 'Contrôleur'],
  ['Vyse', 'Sentinelle'], ['Waylay', 'Duelliste'], ['Yoru', 'Duelliste'],
];

export function assetsRepli(maintenant = Date.now()): Assets {
  return {
    jeu: 'valorant',
    source: 'repli',
    majLe: maintenant,
    cartes: CARTES_REPLI.map(nom => ({ cle: cleDe(nom), nom, minimap: null, vignette: null })),
    agents: AGENTS_REPLI.map(([nom, role]) => ({
      cle: cleDe(nom),
      nom,
      role,
      icone: null,
      capacites: ORDRE_SLOTS.map(cle => ({ cle, nom: `Capacité ${TOUCHES[cle]}`, icone: null, touche: TOUCHES[cle] })),
    })),
  };
}

// ------------------------------------------------------------------ valorant-api.com → assets

interface CarteApi {
  displayName?: string;
  displayIcon?: string | null;
  listViewIcon?: string | null;
  splash?: string | null;
  tacticalDescription?: string | null;
}
interface AgentApi {
  displayName?: string;
  displayIcon?: string | null;
  isPlayableCharacter?: boolean;
  role?: { displayName?: string } | null;
  abilities?: Array<{ slot?: string; displayName?: string; displayIcon?: string | null }>;
}

/**
 * Transforme les réponses de valorant-api.com : cartes de compétition (celles
 * qui ont une minimap ET une description tactique « A/B Sites… »), agents
 * jouables et leurs quatre capacités (la passive est ignorée).
 */
export function depuisApi(cartesJson: unknown, agentsJson: unknown, maintenant = Date.now()): Assets {
  const donnees = (j: unknown) => ((j as { data?: unknown })?.data && Array.isArray((j as { data: unknown[] }).data) ? (j as { data: unknown[] }).data : null);
  const cartes = donnees(cartesJson) as CarteApi[] | null;
  const agents = donnees(agentsJson) as AgentApi[] | null;
  if (!cartes || !agents) throw new Error('Réponse de valorant-api.com illisible.');
  const vues = new Set<string>();
  const sortieCartes = cartes
    .filter(c => typeof c.displayName === 'string' && https(c.displayIcon) && c.tacticalDescription)
    .map(c => ({ cle: cleDe(c.displayName as string), nom: c.displayName as string, minimap: https(c.displayIcon), vignette: https(c.listViewIcon) ?? https(c.splash) }))
    .filter(c => (vues.has(c.cle) ? false : (vues.add(c.cle), true)))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  const sortieAgents = agents
    .filter(a => a.isPlayableCharacter !== false && typeof a.displayName === 'string')
    .map(a => ({
      cle: cleDe(a.displayName as string),
      nom: a.displayName as string,
      role: a.role?.displayName ?? null,
      icone: https(a.displayIcon),
      capacites: (a.abilities ?? [])
        .filter(c => typeof c.slot === 'string' && c.slot in TOUCHES)
        .sort((x, y) => ORDRE_SLOTS.indexOf(x.slot as string) - ORDRE_SLOTS.indexOf(y.slot as string))
        .map(c => ({ cle: c.slot as string, nom: c.displayName ?? (c.slot as string), icone: https(c.displayIcon), touche: TOUCHES[c.slot as string] })),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  if (sortieCartes.length === 0 || sortieAgents.length === 0) throw new Error('valorant-api.com : aucune carte ou aucun agent.');
  return { jeu: 'valorant', source: 'api', cartes: sortieCartes, agents: sortieAgents, majLe: maintenant };
}

/** Manifeste du dossier remplaçable (`esport-assets/manifeste.json`), même forme que `Assets`. */
export function depuisManifeste(json: unknown, maintenant = Date.now()): Assets {
  const m = json as { jeu?: string; cartes?: unknown; agents?: unknown };
  if (!m || m.jeu !== 'valorant' || !Array.isArray(m.cartes) || !Array.isArray(m.agents) || m.cartes.length === 0) throw new Error('Manifeste d’assets illisible.');
  const image = (v: unknown) => https(v) ?? relatif(v);
  return {
    jeu: 'valorant',
    source: 'local',
    majLe: maintenant,
    cartes: (m.cartes as CarteAsset[]).filter(c => typeof c?.nom === 'string').map(c => ({ cle: cleDe(c.cle || c.nom), nom: c.nom, minimap: image(c.minimap), vignette: image(c.vignette) })),
    agents: (m.agents as AgentAsset[])
      .filter(a => typeof a?.nom === 'string')
      .map(a => ({
        cle: cleDe(a.cle || a.nom),
        nom: a.nom,
        role: a.role ?? null,
        icone: image(a.icone),
        capacites: (Array.isArray(a.capacites) ? a.capacites : []).map(c => ({ cle: String(c.cle), nom: String(c.nom ?? c.cle), icone: image(c.icone), touche: String(c.touche ?? TOUCHES[c.cle] ?? '') })),
      })),
  };
}

async function json(fetchA: FetchAssets, url: string, delai: number): Promise<unknown> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined;
  const minuteur = setTimeout(() => ctrl?.abort(), delai);
  try {
    const r = await fetchA(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(minuteur);
  }
}

function lireCache(stockage: StockageAssets | undefined): Assets | undefined {
  try {
    const brut = stockage?.lire(CLE_CACHE);
    if (!brut) return undefined;
    const a = JSON.parse(brut) as Assets;
    return Array.isArray(a.cartes) && Array.isArray(a.agents) && typeof a.majLe === 'number' ? a : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Charge les assets (voir l'ordre en tête de fichier). Ne lève jamais : au
 * pire, le repli générique. `fetch` est injecté (tests : réseau simulé).
 */
export async function chargerAssets({
  fetch: fetchA,
  stockage,
  maintenant = Date.now(),
  manifeste = CHEMIN_MANIFESTE_LOCAL,
  delai = 8000,
}: {
  fetch?: FetchAssets;
  stockage?: StockageAssets;
  maintenant?: number;
  /** Adresse du manifeste local (null : ne pas le chercher, ex. iOS). */
  manifeste?: string | null;
  delai?: number;
}): Promise<Assets> {
  if (fetchA && manifeste) {
    try {
      return depuisManifeste(await json(fetchA, manifeste, 3000), maintenant);
    } catch {
      // Pas de dossier d'assets local : la suite.
    }
  }
  const cache = lireCache(stockage);
  if (cache && maintenant - cache.majLe < DUREE_CACHE_MS) return { ...cache, source: 'cache' };
  if (fetchA) {
    try {
      const [cartes, agents] = await Promise.all([
        json(fetchA, `${URL_API_VALORANT}/maps?language=fr-FR`, delai),
        json(fetchA, `${URL_API_VALORANT}/agents?isPlayableCharacter=true&language=fr-FR`, delai),
      ]);
      const a = depuisApi(cartes, agents, maintenant);
      try {
        stockage?.ecrire(CLE_CACHE, JSON.stringify(a));
      } catch {
        // Stockage plein : tant pis, le réseau resservira.
      }
      return a;
    } catch {
      // Réseau ou API indisponible : cache périmé, sinon repli.
    }
  }
  if (cache) return { ...cache, source: 'cache-perime' };
  return assetsRepli(maintenant);
}

export const trouverCarte = (a: Assets | undefined, cle: string): CarteAsset | undefined => a?.cartes.find(c => c.cle === cle);
export const trouverAgent = (a: Assets | undefined, cle: string): AgentAsset | undefined => a?.agents.find(x => x.cle === cle);

/** Initiales d'un nom (repli d'icône) : « KAY/O » → « KO », « Dark Cover » → « DC ». */
export function initiales(nom: string): string {
  return (
    String(nom ?? '?')
      .split(/[\s/_-]+/)
      .filter(Boolean)
      .map(m => m[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

// ------------------------------------------------------------------ Images (web) : cache local et repli

export interface CacheImages {
  /** Adresse affichable (blob: local) de l'image, ou null (repli : formes et initiales). */
  obtenir(url: string | null): Promise<string | null>;
}

type ReponseImage = { ok: boolean; blob(): Promise<Blob>; clone?(): ReponseImage };
type CacheStorageMin = { open(nom: string): Promise<{ match(url: string): Promise<ReponseImage | undefined>; put(url: string, r: unknown): Promise<void> }> };

/**
 * Cache des images : Cache Storage du navigateur quand il existe (les images
 * restent hors ligne), sinon mémoire. Les images passent par `fetch` (CORS)
 * puis une URL `blob:` locale : le canevas n'est jamais « contaminé » et
 * l'export PNG reste possible. Échec : null (repli générique).
 */
export function creerCacheImages({
  fetch: fetchI,
  caches: cachesI,
  creerUrl,
}: {
  fetch: (url: string, init?: { mode?: string }) => Promise<ReponseImage>;
  caches?: CacheStorageMin;
  creerUrl: (b: Blob) => string;
}): CacheImages {
  const memoire = new Map<string, Promise<string | null>>();
  async function charger(url: string): Promise<string | null> {
    try {
      const boite = cachesI ? await cachesI.open('esport-assets-v1').catch(() => undefined) : undefined;
      const deja = boite ? await boite.match(url).catch(() => undefined) : undefined;
      if (deja?.ok) return creerUrl(await deja.blob());
      const r = await fetchI(url, { mode: 'cors' });
      if (!r.ok) return null;
      if (boite && r.clone) await boite.put(url, r.clone()).catch(() => undefined);
      return creerUrl(await r.blob());
    } catch {
      return null;
    }
  }
  return {
    obtenir(url) {
      if (!url) return Promise.resolve(null);
      if (!memoire.has(url)) memoire.set(url, charger(url));
      return memoire.get(url) as Promise<string | null>;
    },
  };
}
