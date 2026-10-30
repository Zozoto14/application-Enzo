/**
 * Détection d'une nouvelle version du site (hub entier, sur le web) : docs/mises-a-jour.md.
 *
 * Le build publie `version.json` ({ id, commit, date }, servi sans cache) et grave la même chose dans la page
 * (`__BUILD_ID__`, `__BUILD_COMMIT__`, `__BUILD_DATE__`). L'app relit le fichier du serveur au démarrage, au retour
 * au premier plan (au plus une fois toutes les 30 s) et toutes les 3 minutes. Une version plus récente en ligne :
 *
 *  - le bandeau « Nouvelle version disponible — Mettre à jour » s'affiche (un clic recharge proprement) ;
 *  - si « Mettre à jour automatiquement » est activé (Paramètres › À propos, oui par défaut), l'app se recharge
 *    d'elle-même quand elle est inactive ou en arrière-plan ET qu'aucune saisie n'est en cours (champ actif, texte
 *    tapé et pas encore envoyé, saisie signalée par `marquerSaisie`, vidéo ou son en lecture). Jamais de perte de
 *    formulaire : dans le doute, on attend et le bandeau reste.
 *
 * Un garde-fou (sessionStorage) empêche de recharger en boucle si, après un rechargement, le serveur sert encore
 * l'ancienne page (cache intermédiaire) : un seul rechargement automatique par version et par 10 minutes.
 *
 * Données pures + un contrôleur à environnement injecté : tout se teste sans navigateur (version.test.ts).
 */

declare const __BUILD_ID__: string | undefined;
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export interface VersionBuild {
  id: string;
  commit?: string | null;
  date?: string | null;
}

export const INTERVALLE_VERIFICATION_MS = 3 * 60_000;
/** Retour au premier plan, focus, retour du réseau : pas plus d'une vérification par 30 s. */
export const ECART_MIN_MS = 30_000;
/** Une version disponible : les conditions du rechargement automatique sont réévaluées toutes les 30 s. */
export const PAS_AUTO_MS = 30_000;
export const CLE_AUTO = 'appdashboard:maj-auto';
export const CLE_RECHARGEMENT = 'appdashboard:maj-rechargee';
export const ANTI_BOUCLE_MS = 10 * 60_000;

/** Seuils du rechargement automatique (session ouverte : il faudra la déverrouiller à nouveau, on attend plus). */
export const SEUILS = {
  verrouille: { cache: 30_000, inactif: 2 * 60_000 },
  ouverte: { cache: 10 * 60_000, inactif: 20 * 60_000 },
} as const;

/** Version gravée dans la page (build Vite) ; undefined ailleurs (Metro, Jest, développement sans build). */
export function versionLocale(): VersionBuild | undefined {
  try {
    if (typeof __BUILD_ID__ !== 'string' || !__BUILD_ID__) return undefined;
    return {
      id: __BUILD_ID__,
      commit: typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : null,
      date: typeof __BUILD_DATE__ === 'string' && __BUILD_DATE__ ? __BUILD_DATE__ : null,
    };
  } catch {
    return undefined;
  }
}

/** version.json → VersionBuild (tolérant : ancien format { id } seulement). */
export function lireVersion(json: unknown): VersionBuild | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const o = json as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return undefined;
  return { id: o.id, commit: typeof o.commit === 'string' ? o.commit : null, date: typeof o.date === 'string' ? o.date : null };
}

/** Date d'un build : `date`, sinon celle codée en base 36 à la fin de l'id (« abc1234-lzx9q2 »). */
export function dateDuBuild(v: VersionBuild): number | undefined {
  const d = v.date ? Date.parse(v.date) : NaN;
  if (Number.isFinite(d)) return d;
  const fin = v.id.split('-').pop() ?? '';
  const n = /^[0-9a-z]+$/.test(fin) ? parseInt(fin, 36) : NaN;
  return Number.isFinite(n) && n > 1e12 && n < 1e13 ? n : undefined;
}

/**
 * La version du serveur est-elle PLUS RÉCENTE que celle de la page ? Même id ou même commit (simple reconstruction) :
 * non. Dates connues des deux côtés : la plus récente gagne (jamais de « mise à jour » vers un build plus ancien).
 * Sinon (formats incomplets) : un id différent suffit.
 */
export function estPlusRecente(locale: VersionBuild | undefined, distante: VersionBuild | undefined): boolean {
  if (!locale || !distante) return false;
  if (locale.id === distante.id) return false;
  if (locale.commit && distante.commit && memeCommit(locale.commit, distante.commit)) return false;
  const dl = dateDuBuild(locale);
  const dd = dateDuBuild(distante);
  if (dl !== undefined && dd !== undefined) return dd > dl;
  return true;
}

export function memeCommit(a: string, b: string): boolean {
  if (a.length < 7 || b.length < 7) return false;
  return a.startsWith(b) || b.startsWith(a);
}

// ------------------------------------------------------------------ Saisie en cours

interface ElementLike {
  tagName?: string;
  type?: string;
  value?: unknown;
  isContentEditable?: boolean;
  textContent?: string | null;
  isConnected?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  paused?: boolean;
  ended?: boolean;
}
export interface DocumentLike {
  activeElement?: ElementLike | null;
  visibilityState?: string;
  querySelectorAll?(selecteur: string): ArrayLike<ElementLike>;
}

const TYPES_NON_SAISIE = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden']);

/** Champ où l'on tape du texte (input texte, textarea, zone éditable). */
export function estChampSaisie(e: ElementLike | null | undefined): boolean {
  if (!e) return false;
  if (e.isContentEditable) return true;
  const tag = (e.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return !e.readOnly && !e.disabled;
  if (tag === 'INPUT') return !TYPES_NON_SAISIE.has((e.type ?? 'text').toLowerCase()) && !e.readOnly && !e.disabled;
  return false;
}

function contenu(e: ElementLike): string {
  if (e.isContentEditable) return e.textContent ?? '';
  return typeof e.value === 'string' ? e.value : '';
}

/** Saisies signalées explicitement par un écran (formulaire modifié, envoi en cours…). */
const marques = new Set<string>();
export function marquerSaisie(cle: string, enCours: boolean): void {
  if (enCours) marques.add(cle);
  else marques.delete(cle);
}

/**
 * Une saisie est-elle en cours ? Champ de saisie actif ; champ dans lequel on a tapé et qui contient encore du texte
 * (formulaire pas encore envoyé : il disparaît ou se vide après l'envoi) ; saisie signalée ; média en lecture.
 */
export function saisieEnCours(doc: DocumentLike | undefined, touches: Iterable<ElementLike> = []): boolean {
  if (marques.size > 0) return true;
  if (!doc) return false;
  if (estChampSaisie(doc.activeElement)) return true;
  for (const e of touches) {
    if (e.isConnected !== false && estChampSaisie(e) && contenu(e).trim() !== '') return true;
  }
  try {
    const medias = doc.querySelectorAll?.('video, audio');
    if (medias) {
      for (let i = 0; i < medias.length; i++) {
        const m = medias[i];
        if (m && m.paused === false && m.ended !== true) return true;
      }
    }
  } catch {
    // Pas de DOM : rien.
  }
  return false;
}

// ------------------------------------------------------------------ Décision

export type Decision = 'recharger' | 'attendre' | 'proposer';

/**
 * Rechargement automatique ? `proposer` : option désactivée (bandeau seulement) ; `attendre` : saisie en cours ou
 * app encore utilisée ; `recharger` : inactive ou en arrière-plan assez longtemps, sans saisie.
 */
export function decisionAuto({
  auto,
  saisie,
  cacheDepuisMs,
  inactifDepuisMs,
  sessionOuverte,
}: {
  auto: boolean;
  saisie: boolean;
  /** Durée depuis le passage en arrière-plan (undefined : au premier plan). */
  cacheDepuisMs?: number;
  inactifDepuisMs: number;
  sessionOuverte: boolean;
}): Decision {
  if (!auto) return 'proposer';
  if (saisie) return 'attendre';
  const s = sessionOuverte ? SEUILS.ouverte : SEUILS.verrouille;
  if ((cacheDepuisMs !== undefined && cacheDepuisMs >= s.cache) || inactifDepuisMs >= s.inactif) return 'recharger';
  return 'attendre';
}

// ------------------------------------------------------------------ Préférence et anti-boucle

interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
}
const g = globalThis as unknown as {
  localStorage?: Stockage;
  sessionStorage?: Stockage;
  document?: DocumentLike & { baseURI?: string; location?: { protocol?: string } };
  location?: { reload(): void; protocol?: string };
  fetch?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

function stockage(nom: 'localStorage' | 'sessionStorage'): Stockage | undefined {
  try {
    return g[nom];
  } catch {
    return undefined;
  }
}

const abonnesAuto = new Set<() => void>();
/** « Mettre à jour automatiquement » (cet appareil) : activé par défaut. */
export function majAutoActive(s: Stockage | undefined = stockage('localStorage')): boolean {
  try {
    return s?.getItem(CLE_AUTO) !== '0';
  } catch {
    return true;
  }
}
export function definirMajAuto(actif: boolean, s: Stockage | undefined = stockage('localStorage')): void {
  try {
    s?.setItem(CLE_AUTO, actif ? '1' : '0');
  } catch {
    // Stockage indisponible (navigation privée) : réglage pour cette page seulement.
  }
  abonnesAuto.forEach(f => f());
}
export function abonnerMajAuto(f: () => void): () => void {
  abonnesAuto.add(f);
  return () => {
    abonnesAuto.delete(f);
  };
}

/** Un rechargement automatique vers cette version a-t-il déjà eu lieu il y a peu (anti-boucle) ? */
export function dejaRechargePour(id: string, maintenant: number, s: Stockage | undefined = stockage('sessionStorage')): boolean {
  try {
    const [cible, quand] = (s?.getItem(CLE_RECHARGEMENT) ?? '').split('|');
    return cible === id && maintenant - Number(quand) < ANTI_BOUCLE_MS;
  } catch {
    return true;
  }
}
export function noterRechargement(id: string, maintenant: number, s: Stockage | undefined = stockage('sessionStorage')): void {
  try {
    s?.setItem(CLE_RECHARGEMENT, `${id}|${maintenant}`);
  } catch {
    // Sans sessionStorage : pas d'anti-boucle possible, `dejaRechargePour` répond « oui » (aucun automatique).
  }
}

// ------------------------------------------------------------------ Lecture du serveur et rechargement propre

/** version.json du site (undefined : hors ligne, fichier absent, app Electron en file://). */
export async function lireVersionServeur(): Promise<VersionBuild | undefined> {
  try {
    const doc = g.document;
    if (!doc?.location?.protocol || !/^https?:$/.test(doc.location.protocol) || !g.fetch) return undefined;
    const url = new URL(`version.json?t=${Date.now()}`, doc.baseURI).href;
    const r = await g.fetch(url, { cache: 'no-store' });
    return r.ok ? lireVersion(await r.json()) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recharge proprement : service worker en attente activé puis désinscrit (skipWaiting), caches vidés, page
 * redemandée au serveur (cache HTTP contourné), puis rechargement. Les morceaux JS sont hachés : la nouvelle page
 * charge les nouveaux, l'ancien cache ne sert plus.
 */
export async function rechargerProprement(): Promise<boolean> {
  const n = globalThis as unknown as {
    navigator?: { serviceWorker?: { getRegistrations?(): Promise<Array<{ waiting?: { postMessage(m: unknown): void } | null; unregister(): Promise<boolean> }>> } };
    caches?: { keys(): Promise<string[]>; delete(cle: string): Promise<boolean> };
  };
  if (!g.location) return false;
  try {
    const inscriptions = (await n.navigator?.serviceWorker?.getRegistrations?.()) ?? [];
    for (const i of inscriptions) i.waiting?.postMessage({ type: 'SKIP_WAITING' });
    await Promise.all(inscriptions.map(i => i.unregister()));
  } catch {
    // Pas de service worker (cas actuel du site) : rien à faire.
  }
  try {
    if (n.caches) {
      const cles = await n.caches.keys();
      await Promise.all(cles.map(c => n.caches!.delete(c)));
    }
  } catch {
    // Caches indisponibles : le rechargement suffit.
  }
  try {
    const base = g.document?.baseURI;
    if (base && /^https?:/.test(base) && g.fetch) await g.fetch(base, { cache: 'reload' });
  } catch {
    // Hors ligne : on recharge quand même (la page en cache reste utilisable).
  }
  g.location.reload();
  return true;
}

// ------------------------------------------------------------------ Contrôleur

export interface CibleEvenements {
  addEventListener(type: string, rappel: (e: { target?: unknown }) => void, options?: unknown): void;
  removeEventListener(type: string, rappel: (e: { target?: unknown }) => void, options?: unknown): void;
}

export interface EnvSurveillance {
  locale: VersionBuild | undefined;
  lire(): Promise<VersionBuild | undefined>;
  maintenant(): number;
  document?: DocumentLike & CibleEvenements;
  fenetre?: CibleEvenements;
  minuterie: { setInterval(f: () => void, ms: number): unknown; clearInterval(id: unknown): void };
  recharger(): Promise<unknown> | void;
  auto(): boolean;
  sessionOuverte(): boolean;
  dejaRecharge(id: string): boolean;
  noterRechargement(id: string): void;
}

export interface EtatSurveillance {
  disponible?: VersionBuild;
  rechargement: boolean;
}

const ACTIVITE = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'];

/** Démarre la surveillance ; rend { etat, abonner, verifier, mettreAJour, evaluer, arreter }. */
export function surveillerVersion(env: EnvSurveillance) {
  let etat: EtatSurveillance = { rechargement: false };
  const abonnes = new Set<() => void>();
  const touches = new Set<ElementLike>();
  let derniereVerification = -Infinity;
  let derniereActivite = env.maintenant();
  let cacheDepuis: number | undefined = env.document?.visibilityState === 'hidden' ? env.maintenant() : undefined;
  let enCours = false;
  const poser = (e: Partial<EtatSurveillance>) => {
    etat = { ...etat, ...e };
    abonnes.forEach(f => f());
  };

  async function mettreAJour(): Promise<void> {
    if (etat.rechargement) return;
    poser({ rechargement: true });
    try {
      await env.recharger();
    } catch {
      poser({ rechargement: false });
    }
  }

  function evaluer(): Decision | undefined {
    const v = etat.disponible;
    if (!v || etat.rechargement) return undefined;
    const t = env.maintenant();
    for (const e of [...touches]) if (e.isConnected === false) touches.delete(e);
    const d = decisionAuto({
      auto: env.auto(),
      saisie: saisieEnCours(env.document, touches),
      cacheDepuisMs: cacheDepuis === undefined ? undefined : t - cacheDepuis,
      inactifDepuisMs: t - derniereActivite,
      sessionOuverte: env.sessionOuverte(),
    });
    if (d === 'recharger' && !env.dejaRecharge(v.id)) {
      env.noterRechargement(v.id);
      void mettreAJour();
    }
    return d;
  }

  async function verifier(forcer = false): Promise<void> {
    const t = env.maintenant();
    if (enCours || (!forcer && t - derniereVerification < ECART_MIN_MS)) return;
    enCours = true;
    derniereVerification = t;
    try {
      const distante = await env.lire();
      if (distante && estPlusRecente(env.locale, distante) && distante.id !== etat.disponible?.id) poser({ disponible: distante });
    } finally {
      enCours = false;
    }
    evaluer();
  }

  const surActivite = () => {
    derniereActivite = env.maintenant();
  };
  const surSaisie = (e: { target?: unknown }) => {
    derniereActivite = env.maintenant();
    if (e?.target && estChampSaisie(e.target as ElementLike)) touches.add(e.target as ElementLike);
  };
  const surVisibilite = () => {
    if (env.document?.visibilityState === 'hidden') {
      cacheDepuis = env.maintenant();
      evaluer();
    } else {
      cacheDepuis = undefined;
      derniereActivite = env.maintenant();
      void verifier();
    }
  };
  const surRetour = () => void verifier();

  if (env.locale) {
    env.document?.addEventListener('visibilitychange', surVisibilite);
    env.document?.addEventListener('input', surSaisie, true);
    for (const type of ACTIVITE) env.document?.addEventListener(type, surActivite, { passive: true, capture: true });
    env.fenetre?.addEventListener('focus', surRetour);
    env.fenetre?.addEventListener('online', surRetour);
  }
  const minuteries = env.locale
    ? [env.minuterie.setInterval(() => void verifier(true), INTERVALLE_VERIFICATION_MS), env.minuterie.setInterval(() => evaluer(), PAS_AUTO_MS)]
    : [];
  if (env.locale) void verifier(true);

  return {
    etat: () => etat,
    abonner(f: () => void) {
      abonnes.add(f);
      return () => {
        abonnes.delete(f);
      };
    },
    verifier,
    mettreAJour,
    evaluer,
    arreter() {
      minuteries.forEach(m => env.minuterie.clearInterval(m));
      env.document?.removeEventListener('visibilitychange', surVisibilite);
      env.document?.removeEventListener('input', surSaisie, true);
      for (const type of ACTIVITE) env.document?.removeEventListener(type, surActivite, { passive: true, capture: true });
      env.fenetre?.removeEventListener('focus', surRetour);
      env.fenetre?.removeEventListener('online', surRetour);
    },
  };
}

export type Surveillance = ReturnType<typeof surveillerVersion>;

/** « Mettre à jour automatiquement » a un sens ici : page du site (pas l'app PC en file://, ni l'app native). */
export function majAutoDisponible(): boolean {
  const protocole = g.document?.location?.protocol;
  return Boolean(versionLocale() && protocole && /^https?:$/.test(protocole));
}

let unique: Surveillance | undefined;
let sessionOuverte = false;

/** L'hôte signale qu'un compte est ouvert (le recharger demandera de le déverrouiller à nouveau). */
export function noterSessionOuverte(ouverte: boolean): void {
  sessionOuverte = ouverte;
}

/** Surveillance du site, démarrée une fois (bureau/index.tsx) ; undefined hors build web. */
export function surveillanceSite(): Surveillance | undefined {
  if (unique) return unique;
  const locale = versionLocale();
  const protocole = g.document?.location?.protocol;
  if (!locale || !protocole || !/^https?:$/.test(protocole)) return undefined;
  const doc = g.document as unknown as DocumentLike & CibleEvenements;
  unique = surveillerVersion({
    locale,
    lire: lireVersionServeur,
    maintenant: () => Date.now(),
    document: doc,
    fenetre: globalThis as unknown as CibleEvenements,
    minuterie: { setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>) },
    recharger: rechargerProprement,
    auto: () => majAutoActive(),
    sessionOuverte: () => sessionOuverte,
    dejaRecharge: id => dejaRechargePour(id, Date.now()),
    noterRechargement: id => noterRechargement(id, Date.now()),
  });
  return unique;
}
