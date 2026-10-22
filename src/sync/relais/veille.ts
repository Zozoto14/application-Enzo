/**
 * Veille des avis du serveur (relais version 10, relais/avis.mjs) : savoir qu'un autre appareil du
 * compte a écrit dans le coffre, sans attendre le tour périodique. Le serveur ne dit que
 * « révision N » ; c'est le tour de synchronisation qui tire ensuite les différences (chiffrées).
 *
 * Trois modes. Le SERVEUR fixe le plus haut permis (`/sante` → `tempsReel`, réglage
 * SYNCHRO_TEMPS_REEL de relais.env) ; la veille ne monte jamais au-dessus (`plafond`) :
 *
 *  - `sondage` (défaut du serveur, le plus sûr sur un mutualisé) : la révision toutes les 15 s
 *    (`/version`, une requête courte) ; aussi quand le serveur refuse une connexion tenue (429 :
 *    « utilise le sondage »).
 *  - `attente` : attente longue (`/attendre?rev=N`, 50 s au plus, battement du serveur), reprise
 *    aussitôt après une réponse.
 *  - `flux` (serveur en « sse » seulement) : flux SSE lu par `fetch` en continu. Si le premier avis
 *    n'arrive pas en quelques secondes (mandataire qui retient la réponse) ou sans lecture en continu
 *    (app iPhone) → attente longue.
 *
 * Sobriété (docs/o2switch.md) : une erreur (réseau, 429, 503, réponse coupée trop tôt) attend de plus
 * en plus longtemps (exponentiel avec une part au hasard, jamais de reconnexion rapide en boucle,
 * `Retry-After` respecté) ; un limiteur partagé plafonne les requêtes du client par minute. Un seul
 * veilleur par navigateur (meneurOnglets.ts) ; l'hôte l'arrête quand la page est masquée.
 */

import type { Liaison } from './liaison';
import { minuteriesSysteme, type Minuteries } from './planificateur';
import { cheminCoffre } from './coffreServeur';
import { attenteExponentielle, retryAfterMs, type LimiteurRequetes } from './sobriete';

type Fetch = typeof fetch;

export type ModeVeille = 'flux' | 'attente' | 'sondage';
/** Mode annoncé par le serveur (`/sante` → `tempsReel`). */
export type ModeTempsReel = 'sse' | 'attente' | 'sondage';

export const DELAI_PREMIER_AVIS_MS = 4_000;
/** Sans aucun octet (battement de cœur du serveur : 15 s) pendant ce délai, le flux est réputé mort. */
export const SILENCE_MAX_MS = 45_000;
export const ATTENTE_S = 50;
export const PAS_SONDAGE_MS = 15_000;
export const PAS_SONDAGE_MIN_MS = 10_000;
export const PAS_SONDAGE_MAX_MS = 60_000;
export const RETOUR_ETAGE_MS = 5 * 60_000;
/** Un flux qui se ferme avant ce délai compte comme une erreur (mandataire qui coupe : pas de boucle). */
export const DUREE_MIN_FLUX_MS = 30_000;
/** Une attente longue vide qui revient avant ce délai compte comme une erreur (mandataire qui coupe). */
export const DUREE_MIN_ATTENTE_MS = 5_000;
/** Erreurs de suite avant de descendre d'un étage. */
export const ERREURS_AVANT_REPLI = 3;

/** Le mode de veille le plus haut permis par le mode du serveur. */
export const plafondDe = (mode: ModeTempsReel | undefined): ModeVeille => (mode === 'sse' ? 'flux' : mode === 'attente' ? 'attente' : 'sondage');
const RANG: Record<ModeVeille, number> = { sondage: 0, attente: 1, flux: 2 };
const borner = (ms: number) => Math.max(PAS_SONDAGE_MIN_MS, Math.min(PAS_SONDAGE_MAX_MS, ms));

/** Relais dont le flux a été retenu par un mandataire : on n'y revient pas avant `RETOUR_ETAGE_MS`. */
const fluxRetenu = new Map<string, number>();
/** Tests. */
export const oublierFluxRetenus = (): void => fluxRetenu.clear();

export interface OptionsVeille {
  liaison: Liaison;
  compte: string;
  /** Dernière révision connue ici (lue à chaque fois : la synchro l'avance). */
  revConnue(): number;
  /** Une révision plus récente existe sur le serveur. */
  surVersion(rev: number): void;
  /** Le mode change (affichage, mesures). */
  surMode?(mode: ModeVeille): void;
  /** Mode le plus haut permis par le serveur (défaut : `sondage`). */
  plafond?: ModeVeille;
  requete?: Fetch;
  minuteries?: Minuteries;
  maintenant?: () => number;
  alea?: () => number;
  /** Plafond de requêtes du client (partagé avec la synchronisation). */
  limiteur?: LimiteurRequetes;
  /**
   * Identifiant stable de l'appareil (du navigateur) : une nouvelle connexion tenue remplace côté serveur
   * celle que ce même appareil aurait laissée ouverte (onglet masqué puis revenu, frontal qui ne signale
   * pas l'abandon).
   */
  appareil?: string;
  modeInitial?: ModeVeille;
  delaiPremierAvisMs?: number;
  pasSondageMs?: number;
  attenteS?: number;
  dureeMinFluxMs?: number;
  dureeMinAttenteMs?: number;
}

interface CorpsLisible {
  getReader?(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
}

export class Veilleur {
  private actif = false;
  private modeCourant: ModeVeille;
  private readonly plafond: ModeVeille;
  private controle: AbortController | undefined;
  private minuterie: unknown;
  private garde: unknown;
  private erreurs = 0;
  private descenduLe = 0;
  private generation = 0;
  private pasSondage: number;
  /** Plus haute révision déjà annoncée par le serveur à ce veilleur. */
  private vue = 0;
  private readonly minuteries: Minuteries;
  private readonly maintenant: () => number;

  constructor(private readonly o: OptionsVeille) {
    this.minuteries = o.minuteries ?? minuteriesSysteme;
    this.maintenant = o.maintenant ?? Date.now;
    this.plafond = o.plafond ?? 'sondage';
    this.pasSondage = o.pasSondageMs ?? PAS_SONDAGE_MS;
    const retenu = fluxRetenu.get(o.liaison.relais);
    const bloque = retenu !== undefined && this.maintenant() - retenu < RETOUR_ETAGE_MS;
    let initial = o.modeInitial ?? this.plafond;
    if (RANG[initial] > RANG[this.plafond]) initial = this.plafond;
    if (initial === 'flux' && bloque) initial = 'attente';
    this.modeCourant = initial;
    this.descenduLe = initial === this.plafond ? 0 : bloque ? retenu! : this.maintenant();
  }

  get mode(): ModeVeille {
    return this.modeCourant;
  }

  demarrer(): void {
    if (this.actif) return;
    this.actif = true;
    this.erreurs = 0;
    this.o.surMode?.(this.modeCourant);
    this.lancer();
  }

  /** Arrêt propre : minuteries annulées, connexion en cours fermée (onglet masqué, verrouillé). */
  arreter(): void {
    this.actif = false;
    this.generation++;
    this.annulerMinuteries();
    this.controle?.abort();
    this.controle = undefined;
  }

  private annulerMinuteries(): void {
    if (this.minuterie !== undefined) this.minuteries.clearTimeout(this.minuterie);
    if (this.garde !== undefined) this.minuteries.clearTimeout(this.garde);
    this.minuterie = undefined;
    this.garde = undefined;
  }

  private chemin(action: string, requete = ''): string {
    return `${this.o.liaison.relais}${cheminCoffre(this.o.compte, 10)}/${action}${requete}`;
  }

  private parametreAppareil(): string {
    return this.o.appareil ? `&appareil=${encodeURIComponent(this.o.appareil)}` : '';
  }

  private entetes(): Record<string, string> {
    return { Authorization: `Bearer ${this.o.liaison.jeton}` };
  }

  private annoncer(rev: unknown): void {
    if (typeof rev !== 'number' || !Number.isFinite(rev)) return;
    if (rev > this.o.revConnue() && rev > this.vue) this.o.surVersion(rev);
    this.vue = Math.max(this.vue, rev);
  }

  private plusTard(ms: number, action: () => void): void {
    const gen = this.generation;
    if (this.minuterie !== undefined) this.minuteries.clearTimeout(this.minuterie);
    this.minuterie = this.minuteries.setTimeout(() => {
      this.minuterie = undefined;
      if (this.actif && gen === this.generation) action();
    }, ms);
  }

  private changerMode(mode: ModeVeille): void {
    if (RANG[mode] > RANG[this.plafond]) mode = this.plafond;
    if (mode === this.modeCourant) return;
    if (RANG[mode] < RANG[this.modeCourant]) this.descenduLe = this.maintenant();
    this.modeCourant = mode;
    this.erreurs = 0;
    this.o.surMode?.(mode);
  }

  /** Attente après une erreur : exponentielle avec jitter, au moins `minimum` (Retry-After, pas du sondage). */
  private pauseErreur(minimum = 0): number {
    const pause = attenteExponentielle(this.erreurs, { alea: this.o.alea });
    this.erreurs++;
    return Math.max(pause, minimum);
  }

  private lancer(): void {
    if (!this.actif) return;
    // Plafond de requêtes du client : on attend son tour plutôt que d'insister.
    const limiteur = this.o.limiteur;
    if (limiteur && !limiteur.prendre()) {
      this.plusTard(Math.max(250, limiteur.attente()), () => this.lancer());
      return;
    }
    this.generation++;
    const gen = this.generation;
    const tache = this.modeCourant === 'flux' ? this.flux(gen) : this.modeCourant === 'attente' ? this.attente(gen) : this.sondage(gen);
    void tache.catch(() => {
      if (this.actif && gen === this.generation) this.erreurReseau();
    });
  }

  /** Erreur (réseau, 5xx…) : pause croissante ; trop d'erreurs de suite dans un mode tenu → étage du dessous. */
  private erreurReseau(minimum = 0): void {
    const descendre = this.modeCourant !== 'sondage' && this.erreurs + 1 >= ERREURS_AVANT_REPLI;
    const pause = this.pauseErreur(minimum);
    if (descendre) this.changerMode(this.modeCourant === 'flux' ? 'attente' : 'sondage');
    this.plusTard(pause, () => this.lancer());
  }

  /** Remonte d'un étage (sans dépasser le plafond) si on est descendu il y a longtemps. */
  private remonterSiTemps(): boolean {
    if (RANG[this.modeCourant] >= RANG[this.plafond] || this.maintenant() - this.descenduLe < RETOUR_ETAGE_MS) return false;
    const suivant: ModeVeille = this.modeCourant === 'sondage' ? 'attente' : 'flux';
    this.changerMode(suivant);
    if (suivant === 'flux') fluxRetenu.delete(this.o.liaison.relais);
    // Un étage à la fois : l'attente longue fait ses preuves avant de retenter le flux.
    else this.descenduLe = this.maintenant();
    this.lancer();
    return true;
  }

  /** Le serveur répond « utilise le sondage » (429) ou ne connaît pas les avis (404, 501). */
  private async refus(gen: number, reponse: Response): Promise<void> {
    if (gen !== this.generation) return;
    this.annulerMinuteries();
    const statut = reponse.status;
    let corps: { rev?: unknown; pas?: unknown } = {};
    try {
      corps = ((await reponse.json()) ?? {}) as typeof corps;
    } catch {
      // Corps illisible : sans importance.
    }
    if (gen !== this.generation || !this.actif) return;
    this.annoncer(corps.rev);
    if (typeof corps.pas === 'number' && corps.pas > 0) this.pasSondage = borner(corps.pas * 1000);
    this.changerMode('sondage');
    if (statut !== 429) this.descenduLe = this.maintenant() + 24 * 3_600_000;
    // Le sondage commence après une pause (la révision vient d'être donnée) : jamais en rafale.
    this.plusTard(Math.max(this.pasSondage, retryAfterMs(reponse) ?? 0), () => this.lancer());
  }

  private estRefus(statut: number): boolean {
    return statut === 429 || statut === 404 || statut === 501;
  }

  // ------------------------------------------------------------------ Flux SSE (serveur « sse »)

  private async flux(gen: number): Promise<void> {
    const requete = this.o.requete ?? fetch;
    const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
    if (!controle) {
      this.changerMode('attente');
      this.lancer();
      return;
    }
    this.controle = controle;
    const debut = this.maintenant();
    let premier = false;
    // Garde : le premier avis (révision courante, envoyé à l'ouverture) doit arriver vite.
    this.garde = this.minuteries.setTimeout(() => {
      this.garde = undefined;
      if (!premier && gen === this.generation) {
        fluxRetenu.set(this.o.liaison.relais, this.maintenant());
        controle.abort();
      }
    }, this.o.delaiPremierAvisMs ?? DELAI_PREMIER_AVIS_MS);
    let reponse: Response;
    try {
      reponse = await requete(this.chemin('flux', `?rev=${this.o.revConnue()}${this.parametreAppareil()}`), { headers: { ...this.entetes(), Accept: 'text/event-stream' }, signal: controle.signal } as RequestInit);
    } catch {
      return this.finFlux(gen, premier, debut);
    }
    const corps = (reponse as unknown as { body?: CorpsLisible | null }).body;
    const type = reponse.headers?.get?.('Content-Type') ?? '';
    if (this.estRefus(reponse.status)) {
      const r = this.refus(gen, reponse);
      await r;
      controle.abort();
      return;
    }
    if (reponse.status >= 500) {
      controle.abort();
      if (gen !== this.generation) return;
      this.annulerMinuteries();
      return this.erreurReseau(retryAfterMs(reponse));
    }
    if (!reponse.ok || !/text\/event-stream/i.test(type) || typeof corps?.getReader !== 'function') {
      // Pas de lecture en continu ici, ou réponse transformée en route : l'attente longue fera l'affaire.
      controle.abort();
      if (gen !== this.generation) return;
      this.annulerMinuteries();
      this.changerMode('attente');
      this.lancer();
      return;
    }
    const lecteur = corps.getReader();
    const decodeur = new (globalThis as unknown as { TextDecoder: new () => { decode(o?: Uint8Array, options?: { stream: boolean }): string } }).TextDecoder();
    let tampon = '';
    let silence: unknown;
    const surveiller = () => {
      if (silence !== undefined) this.minuteries.clearTimeout(silence);
      silence = this.minuteries.setTimeout(() => controle.abort(), SILENCE_MAX_MS);
    };
    surveiller();
    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done || gen !== this.generation) break;
        surveiller();
        tampon += decodeur.decode(value, { stream: true });
        let fin: number;
        while ((fin = tampon.search(/\r?\n\r?\n/)) >= 0) {
          const bloc = tampon.slice(0, fin);
          tampon = tampon.slice(fin).replace(/^\r?\n\r?\n/, '');
          const evenement = /^event:\s*(.*)$/m.exec(bloc)?.[1]?.trim() ?? 'message';
          const donnee = /^data:\s*(.*)$/m.exec(bloc)?.[1];
          if (evenement !== 'version' || donnee === undefined) continue;
          let rev: unknown;
          try {
            rev = (JSON.parse(donnee) as { rev?: unknown }).rev;
          } catch {
            continue;
          }
          if (!premier) {
            premier = true;
            if (this.garde !== undefined) this.minuteries.clearTimeout(this.garde);
            this.garde = undefined;
          }
          this.annoncer(rev);
        }
      }
    } catch {
      // Coupé (réseau, garde, arrêt) : voir finFlux.
    } finally {
      if (silence !== undefined) this.minuteries.clearTimeout(silence);
      lecteur.cancel().catch(() => undefined);
    }
    return this.finFlux(gen, premier, debut);
  }

  private finFlux(gen: number, premier: boolean, debut: number): void {
    if (!this.actif || gen !== this.generation) return;
    if (this.garde !== undefined) this.minuteries.clearTimeout(this.garde);
    this.garde = undefined;
    const retenu = fluxRetenu.get(this.o.liaison.relais);
    if (!premier && retenu !== undefined && this.maintenant() - retenu < 1_000) {
      // Le premier avis n'est jamais arrivé : un mandataire retient le flux. Attente longue.
      this.changerMode('attente');
      this.lancer();
      return;
    }
    if (premier && this.maintenant() - debut >= (this.o.dureeMinFluxMs ?? DUREE_MIN_FLUX_MS)) {
      // Fermeture normale (5 min) ou coupure après un long flux : on rouvre, sans se presser.
      this.erreurs = 0;
      this.plusTard(1_000, () => this.lancer());
      return;
    }
    // Échec avant tout avis, ou flux coupé trop tôt : pause croissante, puis l'étage du dessous.
    this.erreurReseau();
  }

  // ------------------------------------------------------------------ Attente longue (serveur « attente »)

  private async attente(gen: number): Promise<void> {
    if (this.remonterSiTemps()) return;
    const requete = this.o.requete ?? fetch;
    const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
    this.controle = controle;
    const attente = this.o.attenteS ?? ATTENTE_S;
    const garde = controle ? this.minuteries.setTimeout(() => controle.abort(), (attente + 15) * 1000) : undefined;
    const debut = this.maintenant();
    // Depuis la plus récente des deux : ce qu'a l'appareil, ou ce que le serveur a déjà annoncé (le tour
    // qui la tire peut être encore en route : on n'attend pas de le voir finir pour réécouter).
    const depuis = Math.max(this.o.revConnue(), this.vue);
    let lu: { rev?: unknown } = {};
    try {
      const reponse = await requete(this.chemin('attendre', `?rev=${depuis}&delai=${attente}${this.parametreAppareil()}`), { headers: this.entetes(), signal: controle?.signal } as RequestInit);
      if (gen !== this.generation || !this.actif) return;
      if (this.estRefus(reponse.status)) return await this.refus(gen, reponse);
      if (!reponse.ok) return this.erreurReseau(retryAfterMs(reponse));
      lu = (await reponse.json()) as { rev?: unknown };
    } finally {
      if (garde !== undefined) this.minuteries.clearTimeout(garde);
    }
    if (gen !== this.generation || !this.actif) return;
    this.annoncer(lu.rev);
    const nouvelle = typeof lu.rev === 'number' && lu.rev > depuis;
    if (!nouvelle && this.maintenant() - debut < (this.o.dureeMinAttenteMs ?? DUREE_MIN_ATTENTE_MS)) {
      // Attente vide revenue trop vite : un mandataire coupe. Pause croissante, puis le sondage.
      this.erreurReseau();
      return;
    }
    this.erreurs = 0;
    this.lancer();
  }

  // ------------------------------------------------------------------ Sondage (défaut)

  private async sondage(gen: number): Promise<void> {
    if (this.remonterSiTemps()) return;
    const requete = this.o.requete ?? fetch;
    const reponse = await requete(this.chemin('version'), { headers: this.entetes() } as RequestInit);
    if (gen !== this.generation || !this.actif) return;
    if (reponse.ok) {
      this.erreurs = 0;
      this.annoncer(((await reponse.json()) as { rev?: unknown }).rev);
      this.plusTard(this.pasSondage, () => this.lancer());
      return;
    }
    if (reponse.status === 404 || reponse.status === 501) {
      // Serveur sans avis : le tour périodique suffira ; on réessaie rarement.
      this.plusTard(RETOUR_ETAGE_MS, () => this.lancer());
      return;
    }
    // 429 (trop de requêtes), 503, autre : pause croissante, au moins le pas et le Retry-After.
    this.erreurReseau(Math.max(this.pasSondage, retryAfterMs(reponse) ?? 0));
  }
}
