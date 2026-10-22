/**
 * Quand lancer un tour de synchronisation.
 *
 * Données pures + minuteries injectables (tests avec de fausses minuteries) :
 *  - à l'ouverture (`demarrer`), après déverrouillage ;
 *  - au retour au premier plan, et quand le réseau revient ;
 *  - après une modification locale : micro-regroupement de `DELAI_MODIFICATION_MS` (150 ms) pour
 *    fusionner les frappes rapides, jamais plus de `PLAFOND_MODIFICATION_MS` après la première ;
 *  - à l'avis du serveur « nouvelle révision » (version 10, voir veille.ts) : tout de suite ;
 *  - tour complet périodique : toutes les 30 s sans avis (relais d'avant la version 10), toutes les
 *    3 min avec les avis (simple filet de sécurité) ;
 *  - après un échec : nouvel essai rapide, de plus en plus espacé
 *    (1 s, 3 s, 10 s, 30 s, 2 min, 5 min), au lieu d'attendre le tour suivant ; le retour du réseau
 *    (`online`) relance tout de suite.
 *
 * Un seul tour à la fois : une demande reçue pendant un tour est gardée et
 * déclenche un nouveau tour dès que le premier finit (rien n'est perdu).
 */

/** Tour complet sans avis du serveur (relais d'avant la version 10). */
export const INTERVALLE_SYNCHRO_MS = 30_000;
/** Tour complet quand les avis du serveur arrivent : simple filet de sécurité. */
export const INTERVALLE_AVEC_AVIS_MS = 3 * 60_000;
/** Micro-regroupement des modifications (frappes rapides) avant l'envoi. */
export const DELAI_MODIFICATION_MS = 150;
/** Une rafale continue de modifications part quand même au plus tard après ce délai. */
export const PLAFOND_MODIFICATION_MS = 1_000;
/** Attentes successives après un échec ; le dernier palier se répète. */
export const DELAIS_REESSAI_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000, 2 * 60_000, 5 * 60_000];

export type RaisonTour =
  | 'ouverture'
  | 'premier-plan'
  | 'en-ligne'
  | 'modification'
  | 'periodique'
  | 'reessai'
  | 'differe'
  | 'notification'
  | 'manuel';

/** Issue d'un tour : réussi ou non, avec éventuellement un dépôt à refaire dans quelques secondes. */
export type IssueTour = boolean | { ok: boolean; rappelerDans?: number };

/** Deux retours au premier plan / retours en ligne rapprochés ne font qu'un tour (économie de lectures du relais). */
export const ECART_MIN_TOURS_MS = 3_000;

export interface Minuteries {
  setTimeout(action: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(action: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export const minuteriesSysteme: Minuteries = {
  setTimeout: (a, ms) => setTimeout(a, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (a, ms) => setInterval(a, ms),
  clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
};

/** Attente avant le n-ième nouvel essai (n à partir de 0). */
export const delaiReessai = (essai: number): number =>
  DELAIS_REESSAI_MS[Math.min(Math.max(0, essai), DELAIS_REESSAI_MS.length - 1)];

export interface ReglagesPlanificateur {
  /** Micro-regroupement des modifications (défaut : `DELAI_MODIFICATION_MS`). */
  delaiModificationMs?: number;
  plafondModificationMs?: number;
  /** Tour périodique (défaut : `INTERVALLE_SYNCHRO_MS`) ; `definirIntervalle` le change en route. */
  intervalleMs?: number;
}

export class Planificateur {
  private actif = false;
  private premiereModification: number | undefined;
  private intervalleMs: number;
  private enCours = false;
  private relance = false;
  private echecs = 0;
  private minuterieModification: unknown;
  private minuterieReessai: unknown;
  private intervalleTour: unknown;

  constructor(
    /** Lance un tour ; vrai s'il a réussi, faux (ou exception) s'il a échoué. */
    private readonly lancer: (raison: RaisonTour) => Promise<IssueTour>,
    private readonly minuteries: Minuteries = minuteriesSysteme,
    private readonly maintenant: () => number = Date.now,
    private readonly reglages: ReglagesPlanificateur = {},
  ) {
    this.intervalleMs = reglages.intervalleMs ?? INTERVALLE_SYNCHRO_MS;
  }
  private finDernierTour = -Infinity;

  /** Intervalle du tour périodique en cours. */
  get intervalle(): number {
    return this.intervalleMs;
  }

  /** Change l'intervalle du tour périodique (avis du serveur disponibles ou non). */
  definirIntervalle(ms: number): void {
    if (ms === this.intervalleMs) return;
    this.intervalleMs = ms;
    if (this.actif && this.intervalleTour !== undefined) {
      this.minuteries.clearInterval(this.intervalleTour);
      this.intervalleTour = this.minuteries.setInterval(() => void this.demander('periodique'), ms);
    }
  }

  /** Échecs consécutifs (0 après un succès). */
  get echecsConsecutifs(): number {
    return this.echecs;
  }

  demarrer(): void {
    if (this.actif) {
      return;
    }
    this.actif = true;
    void this.demander('ouverture');
    this.intervalleTour = this.minuteries.setInterval(() => void this.demander('periodique'), this.intervalleMs);
  }

  arreter(): void {
    this.actif = false;
    this.relance = false;
    this.echecs = 0;
    this.effacer('minuterieModification');
    this.effacer('minuterieReessai');
    this.premiereModification = undefined;
    if (this.intervalleTour !== undefined) {
      this.minuteries.clearInterval(this.intervalleTour);
      this.intervalleTour = undefined;
    }
  }

  /** L'appli revient au premier plan (`visibilitychange` visible, AppState « active »). */
  retourPremierPlan(): void {
    void this.demander('premier-plan');
  }

  /** Le réseau est revenu (événement `online`). */
  enLigne(): void {
    // Le réseau est là : inutile d'attendre la fin du palier de réessai.
    void this.demander('en-ligne');
  }

  /**
   * Une donnée synchronisée a changé ici : envoi après un micro-regroupement (~150 ms, les frappes
   * rapides partent ensemble), au plus tard `PLAFOND_MODIFICATION_MS` après la première modification.
   */
  modification(): void {
    if (!this.actif) {
      return;
    }
    const maintenant = this.maintenant();
    this.premiereModification ??= maintenant;
    const plafond = this.reglages.plafondModificationMs ?? PLAFOND_MODIFICATION_MS;
    const delai = Math.max(0, Math.min(this.reglages.delaiModificationMs ?? DELAI_MODIFICATION_MS, this.premiereModification + plafond - maintenant));
    this.effacer('minuterieModification');
    this.minuterieModification = this.minuteries.setTimeout(() => {
      this.minuterieModification = undefined;
      this.premiereModification = undefined;
      void this.demander('modification');
    }, delai);
  }

  /** Avis du serveur : une révision plus récente existe (version 10). Tour tout de suite. */
  notification(): void {
    void this.demander('notification');
  }

  /** Bouton « Synchroniser maintenant ». */
  manuel(): Promise<void> {
    return this.demander('manuel');
  }

  async demander(raison: RaisonTour): Promise<void> {
    if (!this.actif) {
      return;
    }
    if (this.enCours) {
      this.relance = true;
      return;
    }
    if (raison === 'periodique' && this.echecs > 0) {
      return; // En échec, le palier de réessai décide du prochain essai (pas le tic périodique).
    }
    if ((raison === 'premier-plan' || raison === 'en-ligne') && this.maintenant() - this.finDernierTour < ECART_MIN_TOURS_MS && this.echecs === 0) {
      return;
    }
    this.enCours = true;
    this.effacer('minuterieReessai');
    let reussi = false;
    let rappelerDans: number | undefined;
    try {
      const issue = await this.lancer(raison);
      reussi = typeof issue === 'boolean' ? issue : issue.ok;
      rappelerDans = typeof issue === 'boolean' ? undefined : issue.rappelerDans;
    } catch {
      reussi = false;
    } finally {
      this.enCours = false;
      this.finDernierTour = this.maintenant();
    }
    if (!this.actif) {
      return;
    }
    if (reussi) {
      this.echecs = 0;
      if (rappelerDans !== undefined && rappelerDans > 0) {
        this.minuterieReessai = this.minuteries.setTimeout(() => {
          this.minuterieReessai = undefined;
          void this.demander('differe');
        }, rappelerDans + 500);
      }
    } else {
      const attente = delaiReessai(this.echecs);
      this.echecs++;
      this.minuterieReessai = this.minuteries.setTimeout(() => {
        this.minuterieReessai = undefined;
        void this.demander('reessai');
      }, attente);
    }
    if (this.relance) {
      this.relance = false;
      // Une demande est arrivée pendant le tour : on repart (le réessai devient inutile).
      void this.demander(reussi ? 'modification' : 'reessai');
    }
  }

  private effacer(nom: 'minuterieModification' | 'minuterieReessai'): void {
    if (this[nom] !== undefined) {
      this.minuteries.clearTimeout(this[nom]);
      this[nom] = undefined;
    }
  }
}
