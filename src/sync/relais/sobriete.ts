/**
 * Sobriété réseau de la synchronisation (hébergement mutualisé, docs/o2switch.md) : le pare-feu de
 * l'hébergeur (CSF/LFD) bannit une adresse qui ouvre trop de connexions ou en rouvre trop vite.
 *
 *  - `attenteExponentielle` : attente après la n-ième erreur, doublée à chaque fois, plafonnée, avec
 *    une part au hasard (jitter) pour que plusieurs appareils ne reviennent pas tous ensemble ;
 *  - `LimiteurRequetes` : au plus N requêtes par fenêtre glissante (30 par minute par défaut) pour
 *    un client ; au-delà, la requête attend son tour (rien n'est perdu, rien ne boucle) ;
 *  - `requeteLimitee` : un `fetch` qui passe par un limiteur ;
 *  - `retryAfterMs` : lit l'en-tête `Retry-After` (secondes) d'une réponse 429 ou 503.
 */

type Fetch = typeof fetch;

export const BASE_ATTENTE_MS = 2_000;
export const ATTENTE_MAX_MS = 5 * 60_000;
export const REQUETES_PAR_MINUTE = 30;

/**
 * Attente avant le nouvel essai qui suit la `essai`-ième erreur (0 = première) : base × 2^essai,
 * plafonnée à `maxMs`, puis tirée entre la moitié et la totalité de cette valeur (« equal jitter » :
 * jamais moins de la moitié, donc jamais de reconnexion rapide en boucle).
 */
export function attenteExponentielle(essai: number, { baseMs = BASE_ATTENTE_MS, maxMs = ATTENTE_MAX_MS, alea = Math.random }: { baseMs?: number; maxMs?: number; alea?: () => number } = {}): number {
  const plafond = Math.min(maxMs, baseMs * 2 ** Math.max(0, Math.min(30, essai)));
  return Math.round(plafond / 2 + (plafond / 2) * Math.max(0, Math.min(1, alea())));
}

/** `Retry-After` en millisecondes (secondes seulement ; une date HTTP est ignorée). */
export function retryAfterMs(reponse: { headers?: { get?(nom: string): string | null } } | undefined): number | undefined {
  const brut = reponse?.headers?.get?.('Retry-After');
  const s = brut === null || brut === undefined ? NaN : Number(brut);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, 10 * 60_000) : undefined;
}

export class LimiteurRequetes {
  private readonly passees: number[] = [];

  constructor(
    readonly max: number = REQUETES_PAR_MINUTE,
    readonly fenetreMs: number = 60_000,
    private readonly maintenant: () => number = Date.now,
  ) {}

  private purger(t: number): void {
    while (this.passees.length > 0 && t - this.passees[0] >= this.fenetreMs) this.passees.shift();
  }

  /** Attente nécessaire avant la prochaine requête (0 : tout de suite). */
  attente(): number {
    const t = this.maintenant();
    this.purger(t);
    return this.passees.length < this.max ? 0 : this.passees[0] + this.fenetreMs - t;
  }

  /** Prend une place si elle est libre ; faux sinon (voir `attente`). */
  prendre(): boolean {
    if (this.attente() > 0) return false;
    this.passees.push(this.maintenant());
    return true;
  }

  /** Requêtes passées dans la fenêtre courante. */
  get dansLaFenetre(): number {
    this.purger(this.maintenant());
    return this.passees.length;
  }
}

/** `fetch` qui attend son tour auprès du limiteur (les requêtes d'un client partagent le même). */
export function requeteLimitee(limiteur: LimiteurRequetes, requete: Fetch = (...a) => fetch(...a), dormir: (ms: number) => Promise<void> = ms => new Promise(ok => setTimeout(ok, ms))): Fetch {
  return (async (...args: Parameters<Fetch>) => {
    while (!limiteur.prendre()) await dormir(Math.max(50, limiteur.attente()));
    return requete(...args);
  }) as Fetch;
}
