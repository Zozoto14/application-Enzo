/**
 * Canal temps réel de l'Esport, côté app (serveur : esport/noyau/temps-reel/, docs/esport/temps-reel.md).
 *
 * UNE connexion longue par navigateur, partagée entre ses onglets (hébergement mutualisé : le pare-feu a déjà
 * banni l'adresse du Fondateur pour trop de connexions ouvertes) :
 *  - élection d'un onglet « meneur » par Web Locks (`MeneurOnglets`, comme la synchro du hub) : seul un onglet
 *    VISIBLE mène ; masqué, il rend la main (connexion fermée) ; un autre onglet visible prend la suite ;
 *  - le meneur relaie messages et état aux autres onglets (BroadcastChannel) ;
 *  - sans Web Locks (app iPhone, vieux navigateur) : l'onglet mène seul.
 *
 * Trois étages, du plus rapide au plus sobre ; le SERVEUR fixe le plus haut permis (`TEMPS_REEL`) :
 *  - `flux` : SSE lu par fetch (la session part dans Authorization), < 1 s de bout en bout ;
 *    « bonjour » absent en 4 s (mandataire qui retient le flux) ou pas de lecture en continu → attente ;
 *  - `attente` : attente longue (50 s au plus), reprise aussitôt ;
 *  - `sondage` : `/temps-reel/evenements` toutes les 15 s (page visible), aussi après un 429 « sondage ».
 * Erreurs : attente exponentielle avec une part au hasard (2 s → 5 min), `Retry-After` respecté, trois erreurs
 * de suite → étage du dessous, retour à l'étage du dessus au bout de 5 min. Jamais de reconnexion en boucle.
 * Reprise : chaque connexion donne le curseur `depuis` (dernier message vu) : rien n'est perdu.
 */

import { MeneurOnglets, canalDuNavigateur, verrousDuNavigateur, type CanalOnglets, type VerrousWeb } from '../../sync/relais/meneurOnglets';
import type { Minuteries } from '../../sync/relais/planificateur';
import { LimiteurRequetes, attenteExponentielle, retryAfterMs } from '../../sync/relais/sobriete';

type Fetch = typeof fetch;

/**
 * Minuteries du canal : `unref()` là où il existe (Node, tests) — une attente de reconnexion ne garde jamais un
 * processus en vie ; sans effet dans le navigateur.
 */
const sansAttache = <T>(id: T): T => {
  (id as { unref?: () => void } | undefined)?.unref?.();
  return id;
};
export const minuteriesCanal: Minuteries = {
  setTimeout: (a, ms) => sansAttache(setTimeout(a, ms)),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (a, ms) => sansAttache(setInterval(a, ms)),
  clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
};

export type ModeCanal = 'flux' | 'attente' | 'sondage';
/** Ce que voit l'utilisateur : « En direct », « Reconnexion… », sondage (lent), arrêté (page masquée), serveur sans temps réel. */
export type EtatCanal = 'direct' | 'reconnexion' | 'sondage' | 'arret' | 'indisponible';

export interface MessageTempsReel {
  type: 'maj' | 'presence';
  id?: number;
  sujet: string;
  cle?: string;
  version?: number;
  action?: 'cree' | 'modifie' | 'supprime';
  acteur?: string;
  pseudo?: string | null;
  le?: string;
  /** Instant de l'écriture (ms) : mesure de la latence. */
  t?: number;
  etat?: 'edition' | 'fin';
  jusqua?: string;
}

/** Lot reçu : messages, ou « tout recharger » (curseur trop ancien, ou rien su pendant la coupure). */
export interface LotTempsReel {
  messages: MessageTempsReel[];
  reinitialiser: boolean;
}

export const DELAI_BONJOUR_MS = 4_000;
export const SILENCE_MAX_MS = 50_000;
export const ATTENTE_S = 50;
export const PAS_SONDAGE_MS = 15_000;
export const RETOUR_ETAGE_MS = 5 * 60_000;
export const DUREE_MIN_FLUX_MS = 30_000;
export const DUREE_MIN_ATTENTE_MS = 5_000;
export const ERREURS_AVANT_REPLI = 3;

const RANG: Record<ModeCanal, number> = { sondage: 0, attente: 1, flux: 2 };
/**
 * Plafond des requêtes du canal pour tout l'onglet (20 par minute) : même si la page passe sans cesse de
 * masquée à visible, jamais de rafale de connexions (pare-feu de l'hébergeur).
 */
export const limiteurCanal = new LimiteurRequetes(20, 60_000);
const plafondDe = (mode: unknown): ModeCanal => (mode === 'sondage' ? 'sondage' : mode === 'attente' ? 'attente' : 'flux');

export interface SourceCanal {
  adresse: string;
  /** Session Esport (`forcer` : une nouvelle, après un 401). */
  jeton(forcer?: boolean): Promise<string>;
}

interface CorpsLisible {
  getReader?(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
}

export interface OptionsEcouteur {
  source: SourceCanal;
  /** Dernier message vu (curseur de reprise). */
  curseur(): number;
  surLot(lot: LotTempsReel, dernierId: number | undefined): void;
  surEtat(etat: EtatCanal, mode: ModeCanal): void;
  requete?: Fetch;
  minuteries?: Minuteries;
  maintenant?: () => number;
  alea?: () => number;
  appareil?: string;
  /** Plafond de requêtes (défaut : `limiteurCanal`, partagé ; null : aucun, tests). */
  limiteur?: LimiteurRequetes | null;
  modeInitial?: ModeCanal;
  delaiBonjourMs?: number;
  pasSondageMs?: number;
  attenteS?: number;
  dureeMinFluxMs?: number;
  dureeMinAttenteMs?: number;
}

/** Boucle réseau du meneur (un seul par navigateur). */
export class EcouteurEsport {
  private actif = false;
  private mode: ModeCanal;
  private plafond: ModeCanal = 'flux';
  private controle: AbortController | undefined;
  private minuterie: unknown;
  private garde: unknown;
  private erreurs = 0;
  private descenduLe = 0;
  private generation = 0;
  private pasSondage: number;
  private reessaiSession = false;
  private readonly minuteries: Minuteries;
  private readonly maintenant: () => number;

  constructor(private readonly o: OptionsEcouteur) {
    this.minuteries = o.minuteries ?? minuteriesCanal;
    this.maintenant = o.maintenant ?? Date.now;
    this.mode = o.modeInitial ?? 'flux';
    this.pasSondage = o.pasSondageMs ?? PAS_SONDAGE_MS;
  }

  get modeCourant(): ModeCanal {
    return this.mode;
  }

  demarrer(): void {
    if (this.actif) return;
    this.actif = true;
    this.erreurs = 0;
    this.o.surEtat('reconnexion', this.mode);
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

  private plusTard(ms: number, action: () => void): void {
    const gen = this.generation;
    if (this.minuterie !== undefined) this.minuteries.clearTimeout(this.minuterie);
    this.minuterie = this.minuteries.setTimeout(() => {
      this.minuterie = undefined;
      if (this.actif && gen === this.generation) action();
    }, ms);
  }

  private changerMode(mode: ModeCanal): void {
    if (RANG[mode] > RANG[this.plafond]) mode = this.plafond;
    if (mode === this.mode) return;
    if (RANG[mode] < RANG[this.mode]) this.descenduLe = this.maintenant();
    this.mode = mode;
    this.erreurs = 0;
  }

  private url(action: string, params: Record<string, string | number>): string {
    const q = Object.entries({ ...params, ...(this.o.appareil ? { appareil: this.o.appareil } : {}) })
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${this.o.source.adresse}/temps-reel/${action}${q ? `?${q}` : ''}`;
  }

  private async entetes(accept = 'application/json'): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.o.source.jeton()}`, Accept: accept };
  }

  private lancer(): void {
    if (!this.actif) return;
    const limiteur = this.o.limiteur === undefined ? limiteurCanal : this.o.limiteur;
    if (limiteur && !limiteur.prendre()) {
      this.plusTard(Math.max(500, limiteur.attente()), () => this.lancer());
      return;
    }
    this.generation++;
    const gen = this.generation;
    const tache = this.mode === 'flux' ? this.flux(gen) : this.mode === 'attente' ? this.attente(gen) : this.sondage(gen);
    void tache.catch(() => {
      if (this.actif && gen === this.generation) this.erreur();
    });
  }

  /** Erreur : pause croissante ; trop d'erreurs de suite dans un étage tenu → étage du dessous. */
  private erreur(minimum = 0): void {
    const descendre = this.mode !== 'sondage' && this.erreurs + 1 >= ERREURS_AVANT_REPLI;
    const pause = Math.max(attenteExponentielle(this.erreurs, { alea: this.o.alea }), minimum);
    this.erreurs++;
    if (descendre) this.changerMode(this.mode === 'flux' ? 'attente' : 'sondage');
    this.o.surEtat(this.mode === 'sondage' ? 'sondage' : 'reconnexion', this.mode);
    this.plusTard(pause, () => this.lancer());
  }

  /** Remonte d'un étage si on est descendu il y a longtemps (un étage à la fois). */
  private remonterSiTemps(): boolean {
    if (RANG[this.mode] >= RANG[this.plafond] || this.maintenant() - this.descenduLe < RETOUR_ETAGE_MS) return false;
    this.changerMode(this.mode === 'sondage' ? 'attente' : 'flux');
    this.descenduLe = this.maintenant();
    this.lancer();
    return true;
  }

  /** Réponse non 2xx : session (401, une fois), « utilise le sondage » (429), serveur sans temps réel (404). */
  private async refus(gen: number, r: Response): Promise<void> {
    if (gen !== this.generation) return;
    this.annulerMinuteries();
    let corps: { mode?: unknown; pas?: unknown; code?: unknown } = {};
    try {
      corps = ((await r.json()) ?? {}) as typeof corps;
    } catch {
      // Corps illisible.
    }
    if (gen !== this.generation || !this.actif) return;
    if (r.status === 401 && !this.reessaiSession) {
      this.reessaiSession = true;
      await this.o.source.jeton(true).catch(() => undefined);
      this.plusTard(500, () => this.lancer());
      return;
    }
    if (r.status === 404 || r.status === 501) {
      // Serveur sans temps réel : rien à écouter (les écrans gardent leur relecture périodique).
      this.o.surEtat('indisponible', this.mode);
      this.plusTard(RETOUR_ETAGE_MS * 6, () => this.lancer());
      return;
    }
    if (r.status === 429) {
      if (typeof corps.pas === 'number' && corps.pas > 0) this.pasSondage = Math.max(10_000, Math.min(60_000, corps.pas * 1000));
      // Mode du serveur plus bas que l'étage tenté : c'est le nouveau plafond.
      if (corps.code === 'mode-sondage') this.plafond = 'sondage';
      else if (corps.code === 'mode-attente') this.plafond = 'attente';
      const etage: ModeCanal = corps.code === 'mode-attente' ? 'attente' : 'sondage';
      this.changerMode(etage);
      this.o.surEtat(etage === 'sondage' ? 'sondage' : 'reconnexion', this.mode);
      this.plusTard(etage === 'attente' ? 1_000 : Math.max(this.pasSondage, retryAfterMs(r) ?? 0), () => this.lancer());
      return;
    }
    this.erreur(retryAfterMs(r) ?? 0);
  }

  // ------------------------------------------------------------------ Flux SSE

  private async flux(gen: number): Promise<void> {
    const requete = this.o.requete ?? (globalThis.fetch as Fetch);
    const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
    if (!controle) {
      this.changerMode('attente');
      this.lancer();
      return;
    }
    this.controle = controle;
    const debut = this.maintenant();
    let bonjour = false;
    let retenu = false;
    this.garde = this.minuteries.setTimeout(() => {
      this.garde = undefined;
      if (!bonjour && gen === this.generation) {
        retenu = true;
        controle.abort();
      }
    }, this.o.delaiBonjourMs ?? DELAI_BONJOUR_MS);
    let r: Response;
    try {
      r = await requete(this.url('flux', { depuis: this.o.curseur() }), { headers: await this.entetes('text/event-stream'), signal: controle.signal } as RequestInit);
    } catch {
      return this.finFlux(gen, bonjour, retenu, debut);
    }
    if (!r.ok) {
      await this.refus(gen, r);
      controle.abort();
      return;
    }
    const corps = (r as unknown as { body?: CorpsLisible | null }).body;
    const type = r.headers?.get?.('Content-Type') ?? '';
    if (!/text\/event-stream/i.test(type) || typeof corps?.getReader !== 'function') {
      // Pas de lecture en continu ici (app iPhone) ou réponse transformée en route : attente longue.
      controle.abort();
      if (gen !== this.generation) return;
      this.annulerMinuteries();
      this.changerMode('attente');
      this.lancer();
      return;
    }
    this.reessaiSession = false;
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
          const evenement = /^event:\s*(.*)$/m.exec(bloc)?.[1]?.trim();
          const donnee = /^data:\s*(.*)$/m.exec(bloc)?.[1];
          if (!evenement || donnee === undefined) continue;
          let d: Record<string, unknown>;
          try {
            d = JSON.parse(donnee) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (evenement === 'bonjour') {
            bonjour = true;
            if (this.garde !== undefined) this.minuteries.clearTimeout(this.garde);
            this.garde = undefined;
            this.erreurs = 0;
            if (typeof d.mode === 'string') this.plafond = plafondDe(d.mode === 'sse' ? 'flux' : d.mode);
            this.o.surEtat('direct', 'flux');
            this.o.surLot({ messages: [], reinitialiser: d.reinitialiser === true }, typeof d.dernierId === 'number' ? d.dernierId : undefined);
          } else if (evenement === 'maj' || evenement === 'presence') {
            this.o.surLot({ messages: [d as unknown as MessageTempsReel], reinitialiser: false }, typeof d.id === 'number' ? d.id : undefined);
          }
        }
      }
    } catch {
      // Coupé (réseau, garde, arrêt) : voir finFlux.
    } finally {
      if (silence !== undefined) this.minuteries.clearTimeout(silence);
      lecteur.cancel().catch(() => undefined);
    }
    return this.finFlux(gen, bonjour, retenu, debut);
  }

  private finFlux(gen: number, bonjour: boolean, retenu: boolean, debut: number): void {
    if (!this.actif || gen !== this.generation) return;
    if (this.garde !== undefined) this.minuteries.clearTimeout(this.garde);
    this.garde = undefined;
    if (retenu) {
      // Un mandataire retient le flux (rien en 4 s) : attente longue tout de suite, flux retenté dans 5 min.
      this.changerMode('attente');
      this.o.surEtat('reconnexion', this.mode);
      this.lancer();
      return;
    }
    if (bonjour && this.maintenant() - debut >= (this.o.dureeMinFluxMs ?? DUREE_MIN_FLUX_MS)) {
      // Fin normale (5 min) : on rouvre avec le curseur, sans se presser.
      this.erreurs = 0;
      this.o.surEtat('reconnexion', this.mode);
      this.plusTard(1_000, () => this.lancer());
      return;
    }
    this.erreur();
  }

  // ------------------------------------------------------------------ Attente longue

  private async attente(gen: number): Promise<void> {
    if (this.remonterSiTemps()) return;
    const requete = this.o.requete ?? (globalThis.fetch as Fetch);
    const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
    this.controle = controle;
    const s = this.o.attenteS ?? ATTENTE_S;
    const garde = controle ? this.minuteries.setTimeout(() => controle.abort(), (s + 15) * 1000) : undefined;
    // Gardée aussi par l'écouteur : `arreter()` l'annule même si la requête ne rend jamais la main.
    this.garde = garde;
    const debut = this.maintenant();
    const depuis = this.o.curseur();
    let lu: { evenements?: unknown; dernierId?: unknown; reinitialiser?: unknown; mode?: unknown } = {};
    try {
      const r = await requete(this.url('attendre', { depuis, delai: s }), { headers: await this.entetes(), signal: controle?.signal } as RequestInit);
      if (gen !== this.generation || !this.actif) return;
      if (!r.ok) return await this.refus(gen, r);
      lu = (await r.json()) as typeof lu;
    } finally {
      if (garde !== undefined) this.minuteries.clearTimeout(garde);
      if (this.garde === garde) this.garde = undefined;
    }
    if (gen !== this.generation || !this.actif) return;
    this.reessaiSession = false;
    if (lu.mode === 'attente' || lu.mode === 'sondage') this.plafond = plafondDe(lu.mode);
    const messages = Array.isArray(lu.evenements) ? (lu.evenements as MessageTempsReel[]) : [];
    this.o.surEtat('direct', 'attente');
    this.o.surLot({ messages, reinitialiser: lu.reinitialiser === true }, typeof lu.dernierId === 'number' ? lu.dernierId : undefined);
    // Première attente (sans curseur) : réponse immédiate avec le curseur ; ensuite, vide et trop rapide = mandataire qui coupe.
    if (depuis && !messages.length && this.maintenant() - debut < (this.o.dureeMinAttenteMs ?? DUREE_MIN_ATTENTE_MS)) {
      this.erreur();
      return;
    }
    this.erreurs = 0;
    this.lancer();
  }

  // ------------------------------------------------------------------ Sondage

  private async sondage(gen: number): Promise<void> {
    if (this.remonterSiTemps()) return;
    const requete = this.o.requete ?? (globalThis.fetch as Fetch);
    const r = await requete(this.url('evenements', { depuis: this.o.curseur() }), { headers: await this.entetes() } as RequestInit);
    if (gen !== this.generation || !this.actif) return;
    if (!r.ok) return this.refus(gen, r);
    this.reessaiSession = false;
    this.erreurs = 0;
    const lu = (await r.json()) as { evenements?: unknown; dernierId?: unknown; reinitialiser?: unknown; pas?: unknown };
    if (typeof lu.pas === 'number' && lu.pas > 0) this.pasSondage = Math.max(10_000, Math.min(60_000, lu.pas * 1000));
    this.o.surEtat('sondage', 'sondage');
    this.o.surLot({ messages: Array.isArray(lu.evenements) ? (lu.evenements as MessageTempsReel[]) : [], reinitialiser: lu.reinitialiser === true }, typeof lu.dernierId === 'number' ? lu.dernierId : undefined);
    this.plusTard(this.pasSondage, () => this.lancer());
  }
}

// ------------------------------------------------------------------ Coordination des onglets

type MessageCanal = { type: 'tr-lot'; lot: LotTempsReel; dernierId?: number } | { type: 'tr-etat'; etat: EtatCanal } | { type: 'tr-qui' };

export interface OptionsCanal {
  source: SourceCanal;
  /** Clé du canal (adresse et compte, sans secret) : nom du verrou et du BroadcastChannel. */
  cle: string;
  requete?: Fetch;
  minuteries?: Minuteries;
  verrous?: VerrousWeb | null;
  creerCanal?: ((nom: string) => CanalOnglets | undefined) | null;
  /** Visibilité de la page (défaut : `document.visibilityState`, toujours visible hors web). */
  visible?: () => boolean;
  /** Abonnement aux changements de visibilité (défaut : `visibilitychange` et `pagehide` du document). */
  surVisibilite?: (f: () => void) => () => void;
  appareil?: string;
  ecouteur?: Partial<OptionsEcouteur>;
}

type Document = { visibilityState?: string; addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void };
const documentWeb = (): Document | undefined => (globalThis as { document?: Document }).document;

/** Identifiant de ce navigateur (une connexion tenue du même appareil remplace l'ancienne côté serveur). */
export function appareilDuNavigateur(): string {
  const nom = 'appdashboard-esport-appareil';
  try {
    const stock = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
    const connu = stock?.getItem(nom);
    if (connu && /^[A-Za-z0-9_-]{6,64}$/.test(connu)) return connu;
    const nouveau = `nav-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    stock?.setItem(nom, nouveau);
    return nouveau;
  } catch {
    return `nav-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Canal d'un onglet : écouteurs locaux, meneur unique par navigateur, relais entre onglets. Démarré au premier
 * écouteur, arrêté (connexion rendue) quand il n'y en a plus ou que la page est masquée.
 */
export class CanalEsport {
  private readonly ecouteurs = new Set<(lot: LotTempsReel) => void>();
  private readonly suiveursEtat = new Set<(etat: EtatCanal) => void>();
  private readonly meneur: MeneurOnglets;
  private readonly canal: CanalOnglets | undefined;
  private ecouteur: EcouteurEsport | undefined;
  private etatCourant: EtatCanal = 'arret';
  private dernierId = 0;
  private demarre = false;
  private arreterVisibilite: (() => void) | undefined;

  private readonly appareil: string | undefined;

  constructor(private readonly o: OptionsCanal) {
    const verrous = o.verrous === undefined ? verrousDuNavigateur() : o.verrous;
    this.meneur = new MeneurOnglets({ nom: `esport-tr:${o.cle}`, surMessage: () => undefined, verrous, creerCanal: null });
    // Sans Web Locks, chaque onglet mène : un identifiant par onglet, sinon ils se remplaceraient l'un l'autre côté
    // serveur en boucle (la limite par compte et adresse reste la garde).
    this.appareil = o.appareil && !verrous ? `${o.appareil}-${Math.random().toString(36).slice(2, 6)}` : o.appareil;
    this.canal = o.creerCanal === null ? undefined : (o.creerCanal ?? canalDuNavigateur)(`appdashboard-esport-tr:${o.cle}`);
    if (this.canal) this.canal.onmessage = e => this.surMessageOnglet(e.data as MessageCanal);
  }

  get etat(): EtatCanal {
    return this.etatCourant;
  }

  get curseur(): number {
    return this.dernierId;
  }

  get estMeneur(): boolean {
    return this.meneur.estMeneur;
  }

  ecouter(f: (lot: LotTempsReel) => void): () => void {
    this.ecouteurs.add(f);
    this.demarrer();
    return () => {
      this.ecouteurs.delete(f);
      if (this.ecouteurs.size === 0) this.arreter();
    };
  }

  suivreEtat(f: (etat: EtatCanal) => void): () => void {
    this.suiveursEtat.add(f);
    return () => {
      this.suiveursEtat.delete(f);
    };
  }

  private visible(): boolean {
    if (this.o.visible) return this.o.visible();
    return documentWeb()?.visibilityState !== 'hidden';
  }

  private demarrer(): void {
    if (this.demarre) return;
    this.demarre = true;
    const surVisibilite =
      this.o.surVisibilite ??
      ((f: () => void) => {
        const doc = documentWeb();
        doc?.addEventListener?.('visibilitychange', f);
        doc?.addEventListener?.('pagehide', f);
        return () => {
          doc?.removeEventListener?.('visibilitychange', f);
          doc?.removeEventListener?.('pagehide', f);
        };
      });
    this.arreterVisibilite = surVisibilite(() => this.appliquerVisibilite());
    this.appliquerVisibilite();
    // Un onglet arrivé après le meneur demande l'état courant (indicateur « En direct »).
    this.diffuser({ type: 'tr-qui' });
  }

  private arreter(): void {
    if (!this.demarre) return;
    this.demarre = false;
    this.arreterVisibilite?.();
    this.arreterVisibilite = undefined;
    this.meneur.renoncer();
    this.changerEtat('arret');
  }

  /** Page visible : candidat au rôle de meneur ; masquée : connexion rendue (un autre onglet visible prend la suite). */
  private appliquerVisibilite(): void {
    if (!this.demarre) return;
    if (this.visible()) {
      if (!this.meneur.estCandidat) this.meneur.briguer(() => this.mener());
      if (!this.meneur.estMeneur && this.etatCourant === 'arret') this.changerEtat('reconnexion');
    } else {
      this.meneur.renoncer();
      this.changerEtat('arret');
    }
  }

  private mener(): () => void {
    const e = new EcouteurEsport({
      source: this.o.source,
      requete: this.o.requete,
      minuteries: this.o.minuteries,
      appareil: this.appareil,
      ...this.o.ecouteur,
      curseur: () => this.dernierId,
      surLot: (lot, dernierId) => {
        this.recevoir(lot, dernierId);
        this.diffuser({ type: 'tr-lot', lot, dernierId });
      },
      surEtat: etat => {
        this.changerEtat(etat);
        this.diffuser({ type: 'tr-etat', etat });
      },
    });
    this.ecouteur = e;
    e.demarrer();
    return () => {
      e.arreter();
      if (this.ecouteur === e) this.ecouteur = undefined;
      this.diffuser({ type: 'tr-etat', etat: 'reconnexion' });
    };
  }

  private surMessageOnglet(m: MessageCanal): void {
    if (!m || typeof m !== 'object' || !this.demarre) return;
    if (m.type === 'tr-lot' && m.lot && Array.isArray(m.lot.messages)) this.recevoir(m.lot, m.dernierId);
    else if (m.type === 'tr-etat' && typeof m.etat === 'string' && !this.meneur.estMeneur) this.changerEtat(m.etat);
    else if (m.type === 'tr-qui' && this.meneur.estMeneur) this.diffuser({ type: 'tr-etat', etat: this.etatCourant });
  }

  private diffuser(m: MessageCanal): void {
    try {
      this.canal?.postMessage(m);
    } catch {
      // Canal fermé.
    }
  }

  private changerEtat(etat: EtatCanal): void {
    if (etat === this.etatCourant) return;
    this.etatCourant = etat;
    for (const f of [...this.suiveursEtat]) {
      try {
        f(etat);
      } catch {
        // Un suiveur ne casse jamais le canal.
      }
    }
  }

  private recevoir(lot: LotTempsReel, dernierId: number | undefined): void {
    for (const m of lot.messages) if (typeof m.id === 'number') this.dernierId = Math.max(this.dernierId, m.id);
    if (typeof dernierId === 'number' && dernierId > 0) this.dernierId = lot.reinitialiser ? dernierId : Math.max(this.dernierId, dernierId);
    if (!lot.reinitialiser && lot.messages.length === 0) return;
    for (const f of [...this.ecouteurs]) {
      try {
        f(lot);
      } catch {
        // Un écran en panne ne gêne pas les autres.
      }
    }
  }

  fermer(): void {
    this.arreter();
    this.meneur.fermer();
    try {
      this.canal?.close();
    } catch {
      // Déjà fermé.
    }
  }
}
