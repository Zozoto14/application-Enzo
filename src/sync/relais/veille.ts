/**
 * Veille des avis du serveur (relais version 10, relais/avis.mjs) : savoir AU PLUS VITE qu'un autre
 * appareil du compte a écrit dans le coffre, sans attendre le tour périodique. Le serveur ne dit que
 * « révision N » ; c'est le tour de synchronisation qui tire ensuite les différences (chiffrées).
 *
 * Trois modes, du plus rapide au plus robuste. L'appareil descend seul l'échelle, et la remonte de
 * temps en temps :
 *
 *  1. `flux` : flux SSE lu par `fetch` en continu (pas `EventSource`, qui ne sait pas porter le jeton
 *     dans l'en-tête `Authorization`). Le serveur envoie la révision courante dès l'ouverture : si
 *     elle n'arrive pas en quelques secondes, un mandataire retient la réponse (tampon de
 *     LiteSpeed/Apache, ancien relais Cloudflare qui transmet) → mode suivant. Sans lecture en
 *     continu (`response.body.getReader`, absente de l'app iPhone) → mode suivant directement.
 *  2. `attente` : attente longue (`/attendre?rev=N`, 25 s au plus), reprise aussitôt.
 *  3. `sondage` : la révision toutes les 15 s (`/version`) ; aussi quand le serveur refuse une
 *     connexion de plus (429 : trop d'appareils ouverts sur ce compte). Retour à l'étage du dessus
 *     toutes les 5 min.
 *
 * Un seul canal à la fois par veilleur ; l'hôte n'en garde qu'un par compte et l'arrête quand la page
 * est masquée (économie de connexions sur un hébergement mutualisé).
 */

import type { Liaison } from './liaison';
import { minuteriesSysteme, type Minuteries } from './planificateur';
import { cheminCoffre } from './coffreServeur';

type Fetch = typeof fetch;

export type ModeVeille = 'flux' | 'attente' | 'sondage';

export const DELAI_PREMIER_AVIS_MS = 4_000;
/** Sans aucun octet (battement de cœur du serveur : 15 s) pendant ce délai, le flux est réputé mort. */
export const SILENCE_MAX_MS = 45_000;
export const ATTENTE_S = 25;
export const PAS_SONDAGE_MS = 15_000;
export const RETOUR_ETAGE_MS = 5 * 60_000;
export const PAUSES_ERREUR_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

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
  requete?: Fetch;
  minuteries?: Minuteries;
  maintenant?: () => number;
  modeInitial?: ModeVeille;
  delaiPremierAvisMs?: number;
  pasSondageMs?: number;
  attenteS?: number;
}

interface CorpsLisible {
  getReader?(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
}

export class Veilleur {
  private actif = false;
  private modeCourant: ModeVeille;
  private controle: AbortController | undefined;
  private minuterie: unknown;
  private garde: unknown;
  private erreurs = 0;
  private descenduLe = 0;
  private generation = 0;
  /** Plus haute révision déjà annoncée par le serveur à ce veilleur. */
  private vue = 0;
  private readonly minuteries: Minuteries;
  private readonly maintenant: () => number;

  constructor(private readonly o: OptionsVeille) {
    this.minuteries = o.minuteries ?? minuteriesSysteme;
    this.maintenant = o.maintenant ?? Date.now;
    const retenu = fluxRetenu.get(o.liaison.relais);
    const bloque = retenu !== undefined && this.maintenant() - retenu < RETOUR_ETAGE_MS;
    this.modeCourant = o.modeInitial ?? (bloque ? 'attente' : 'flux');
    this.descenduLe = this.modeCourant === 'flux' ? 0 : bloque ? retenu! : this.maintenant();
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
    if (mode === this.modeCourant) return;
    if ((mode === 'attente' && this.modeCourant === 'flux') || mode === 'sondage') this.descenduLe = this.maintenant();
    this.modeCourant = mode;
    this.erreurs = 0;
    this.o.surMode?.(mode);
  }

  private pauseErreur(): number {
    const pause = PAUSES_ERREUR_MS[Math.min(this.erreurs, PAUSES_ERREUR_MS.length - 1)];
    this.erreurs++;
    return pause;
  }

  private lancer(): void {
    if (!this.actif) return;
    this.generation++;
    const gen = this.generation;
    const tache = this.modeCourant === 'flux' ? this.flux(gen) : this.modeCourant === 'attente' ? this.attente(gen) : this.sondage(gen);
    void tache.catch(() => {
      if (this.actif && gen === this.generation) this.plusTard(this.pauseErreur(), () => this.lancer());
    });
  }

  /** Remonte d'un étage si on est descendu il y a longtemps (réseau ou mandataire revenus à la normale). */
  private remonterSiTemps(): boolean {
    if (this.modeCourant === 'flux' || this.maintenant() - this.descenduLe < RETOUR_ETAGE_MS) return false;
    const suivant: ModeVeille = this.modeCourant === 'sondage' ? 'attente' : 'flux';
    this.changerMode(suivant);
    if (suivant === 'flux') fluxRetenu.delete(this.o.liaison.relais);
    // Un étage à la fois : l'attente longue fait ses preuves avant de retenter le flux.
    else this.descenduLe = this.maintenant();
    this.lancer();
    return true;
  }

  // ------------------------------------------------------------------ 1. Flux SSE

  private async flux(gen: number): Promise<void> {
    const requete = this.o.requete ?? fetch;
    const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
    if (!controle) {
      this.changerMode('attente');
      this.lancer();
      return;
    }
    this.controle = controle;
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
      reponse = await requete(this.chemin('flux', `?rev=${this.o.revConnue()}`), { headers: { ...this.entetes(), Accept: 'text/event-stream' }, signal: controle.signal, cache: 'no-store' } as RequestInit);
    } catch {
      return this.finFlux(gen, premier);
    }
    const corps = (reponse as unknown as { body?: CorpsLisible | null }).body;
    const type = reponse.headers?.get?.('Content-Type') ?? '';
    if (reponse.status === 429 || reponse.status === 404 || reponse.status === 501) {
      controle.abort();
      return this.refus(gen, reponse.status);
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
            this.erreurs = 0;
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
    return this.finFlux(gen, premier);
  }

  private finFlux(gen: number, premier: boolean): void {
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
    if (premier) {
      // Fermeture normale (5 min) ou coupure après un flux qui marchait : on rouvre aussitôt.
      this.plusTard(250, () => this.lancer());
      return;
    }
    // Échec avant tout avis (réseau) : quelques essais espacés, puis l'attente longue.
    if (this.erreurs >= 3) {
      this.changerMode('attente');
      this.lancer();
      return;
    }
    this.plusTard(this.pauseErreur(), () => this.lancer());
  }

  private refus(gen: number, statut: number): void {
    if (gen !== this.generation) return;
    this.annulerMinuteries();
    // 429 : trop de connexions tenues sur ce compte ; 404/501 : le serveur ne connaît pas les avis.
    this.changerMode('sondage');
    if (statut !== 429) this.descenduLe = this.maintenant() + 24 * 3_600_000;
    this.lancer();
  }

  // ------------------------------------------------------------------ 2. Attente longue

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
    let reponse: Response;
    try {
      reponse = await requete(this.chemin('attendre', `?rev=${depuis}&delai=${attente}`), { headers: this.entetes(), signal: controle?.signal, cache: 'no-store' } as RequestInit);
    } finally {
      if (garde !== undefined) this.minuteries.clearTimeout(garde);
    }
    if (gen !== this.generation || !this.actif) return;
    if (reponse.status === 429 || reponse.status === 404 || reponse.status === 501) return this.refus(gen, reponse.status);
    if (!reponse.ok) throw new Error(`attente : ${reponse.status}`);
    const lu = (await reponse.json()) as { rev?: unknown };
    if (gen !== this.generation) return;
    this.erreurs = 0;
    this.annoncer(lu.rev);
    // Un mandataire qui coupe tôt ferait tourner en boucle : au moins une seconde entre deux attentes vides.
    const vide = !(typeof lu.rev === 'number' && lu.rev > depuis);
    const rapide = this.maintenant() - debut < 1_000;
    if (vide && rapide) this.plusTard(1_000, () => this.lancer());
    else this.lancer();
  }

  // ------------------------------------------------------------------ 3. Sondage

  private async sondage(gen: number): Promise<void> {
    if (this.remonterSiTemps()) return;
    const requete = this.o.requete ?? fetch;
    const reponse = await requete(this.chemin('version'), { headers: this.entetes(), cache: 'no-store' } as RequestInit);
    if (gen !== this.generation || !this.actif) return;
    if (reponse.ok) {
      this.erreurs = 0;
      this.annoncer(((await reponse.json()) as { rev?: unknown }).rev);
    } else if (reponse.status !== 429) {
      throw new Error(`sondage : ${reponse.status}`);
    }
    this.plusTard(this.o.pasSondageMs ?? PAS_SONDAGE_MS, () => this.lancer());
  }
}
