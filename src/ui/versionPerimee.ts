/**
 * Morceaux JS périmés : après un déploiement, un onglet resté ouvert garde l'ancien index.html, dont les
 * morceaux hachés (« assets/Discord-DrUzaNFZ.js ») peuvent ne plus exister. L'import() échoue alors
 * (« Failed to fetch dynamically imported module »). Ce module reconnaît ces erreurs, recharge la page
 * UNE fois (garde-fou en sessionStorage contre les boucles) et, si l'erreur revient, passe à l'état
 * « nouvelle-version » : l'écran propose alors « Recharger » au lieu du message technique.
 *
 * Données : la file de synchronisation est persistée sur disque et la page la vide à la fermeture
 * (`pagehide`, voir src/app/synchroApp.ts) : recharger ne perd rien.
 */

/** Messages d'échec d'un import() dynamique : Chrome/Edge, Safari, Firefox. */
const MOTIFS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
];

export function estErreurChunk(erreur: unknown): boolean {
  if (erreur == null) {
    return false;
  }
  const message = typeof erreur === 'string' ? erreur : typeof erreur === 'object' && 'message' in erreur ? String((erreur as { message: unknown }).message) : '';
  return MOTIFS.some(m => m.test(message));
}

export const CLE_GARDE = 'enzo:rechargement-chunk';
/** Une erreur qui revient moins de 30 s après le rechargement automatique n'en déclenche pas un second. */
export const FENETRE_MS = 30_000;

export type EtatVersion = 'ok' | 'rechargement' | 'nouvelle-version';

interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
}
/** Globales du navigateur, sans dépendre des types DOM (tsconfig de l'app native). */
const g = globalThis as unknown as { sessionStorage?: Stockage; location?: { reload(): void }; window?: CibleEvenements };

export interface EnvRechargement {
  /** sessionStorage (absent ou en erreur : pas de rechargement automatique, donc jamais de boucle). */
  stockage?: Stockage;
  maintenant: () => number;
  recharger: () => void;
}

function envNavigateur(): EnvRechargement {
  let stockage: Stockage | undefined;
  try {
    stockage = g.sessionStorage;
  } catch {
    stockage = undefined;
  }
  return { stockage, maintenant: () => Date.now(), recharger: () => g.location?.reload() };
}

let etat: EtatVersion = 'ok';
const abonnes = new Set<() => void>();
const poser = (e: EtatVersion) => {
  if (etat !== e) {
    etat = e;
    abonnes.forEach(a => a());
  }
};

export const etatVersion = (): EtatVersion => etat;
export function abonnerVersion(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}
/** Pour les tests. */
export function reinitialiserVersion(): void {
  etat = 'ok';
}

/**
 * Traite une erreur : recharge une seule fois (garde-fou), sinon passe à « nouvelle-version ».
 * Renvoie undefined si l'erreur n'est pas un morceau périmé.
 */
export function traiterErreurChunk(erreur: unknown, env: EnvRechargement = envNavigateur()): EtatVersion | undefined {
  if (!estErreurChunk(erreur)) {
    return undefined;
  }
  if (etat !== 'ok') {
    return etat;
  }
  try {
    const dernier = Number(env.stockage?.getItem(CLE_GARDE));
    const recent = Number.isFinite(dernier) && dernier > 0 && env.maintenant() - dernier < FENETRE_MS;
    if (!env.stockage || recent) {
      poser('nouvelle-version');
      return etat;
    }
    env.stockage.setItem(CLE_GARDE, String(env.maintenant()));
  } catch {
    poser('nouvelle-version');
    return etat;
  }
  poser('rechargement');
  env.recharger();
  return etat;
}

interface CibleEvenements {
  addEventListener(type: string, rappel: (e: any) => void): void;
}

/** Écoute vite:preloadError, les rejets de promesses et les erreurs globales (à appeler une fois au démarrage). */
export function installerEcouteursChunks(cible: CibleEvenements | undefined = g.window, env?: EnvRechargement): void {
  if (!cible) {
    return;
  }
  cible.addEventListener('vite:preloadError', e => {
    traiterErreurChunk(e?.payload, env);
  });
  cible.addEventListener('unhandledrejection', e => {
    traiterErreurChunk(e?.reason, env);
  });
  cible.addEventListener('error', e => {
    traiterErreurChunk(e?.error ?? e?.message, env);
  });
}

export function rechargerMaintenant(): void {
  g.location?.reload();
}
