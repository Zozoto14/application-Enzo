/**
 * « Ouvrir dans une nouvelle fenêtre » (application de bureau).
 *
 * Une fenêtre annexe montre UNE app du hub dans une vraie fenêtre du système,
 * sur la MÊME session que la fenêtre principale : rien à redéverrouiller, une
 * seule base en mémoire, un seul écrivain sur le disque (deux fenêtres qui
 * ouvriraient chacune le portefeuille s'écraseraient l'une l'autre).
 *
 * Comment :
 *
 *  1. la fenêtre principale ouvre `about:blank` sous un nom réservé
 *     (`appdashboard-annexe-<app>-<jeton>`), le seul que le processus principal
 *     d'Electron laisse s'ouvrir (voir `bureau/electron/fenetresAnnexes.mjs`) ;
 *     la fenêtre reçoit le même préchargement (le même pont limité) ;
 *  2. elle y écrit la page de l'interface (mêmes feuilles de style, même
 *     script) : l'interface y démarre dans son propre contexte (ses
 *     dimensions, son clavier, ses fenêtres modales) ;
 *  3. au démarrage, l'interface de l'annexe se rattache à la fenêtre
 *     principale (`rattacherAnnexe`) : elle reçoit la session déjà ouverte, le
 *     contrôle des profils, et rend compte de ses écritures et de l'activité
 *     de l'utilisateur. Le jeton n'est valable qu'une fois.
 *
 * Verrouiller (à la main, ou après inactivité dans N'IMPORTE QUELLE fenêtre)
 * ferme d'abord toutes les annexes. Fermer ou recharger la fenêtre principale
 * les ferme aussi. Une annexe ne synchronise pas, n'envoie ni notification ni
 * rappel : la fenêtre principale s'en charge ; chaque écriture faite d'un côté
 * fait relire l'autre.
 */

import { idValide } from './onglets';

export const PREFIXE_ANNEXE = 'appdashboard-annexe-';
const MOTIF_NOM = /^appdashboard-annexe-([a-z0-9][a-z0-9-]{0,39})-([a-z0-9]{10,24})$/;
/** Clé du globalThis de la fenêtre principale où l'annexe trouve son hôte. */
export const CLE_HOTE = '__appDashboardFenetres';
const DELAI_NOTIFICATION_MS = 250;

export function nomAnnexe(app: string, jeton: string): string {
  return `${PREFIXE_ANNEXE}${app}-${jeton}`;
}

export function lireNomAnnexe(nom: string | undefined | null): { app: string; jeton: string } | undefined {
  const trouve = MOTIF_NOM.exec(nom ?? '');
  return trouve && idValide(trouve[1]) ? { app: trouve[1], jeton: trouve[2] } : undefined;
}

function jetonAleatoire(): string {
  const g = globalThis as { crypto?: { getRandomValues?(t: Uint8Array): Uint8Array } };
  const octets = new Uint8Array(10);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(octets);
  } else {
    for (let i = 0; i < octets.length; i++) octets[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(octets, o => o.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

/** Ce que l'annexe reçoit de la fenêtre principale. */
export interface ContexteAnnexe {
  version: 1;
  app: string;
  /** La session ouverte de la fenêtre principale (objet partagé). */
  session: unknown;
  /** Contrôle des profils, toujours le plus récent. */
  profils(): unknown;
  /** Verrouille tout (la fenêtre principale ferme les annexes, puis se verrouille). */
  verrouiller(): void;
  /** L'utilisateur agit dans l'annexe : le verrouillage sur inactivité de l'application le compte. */
  activite(): void;
  /** Une lecture (film, épisode) commence ou s'arrête dans l'annexe. */
  lecture(enCours: boolean): void;
  /** Exécute une écriture de l'annexe dans la base partagée (la fenêtre principale saura qui a écrit). */
  ecrire<T>(action: () => T): T;
  /** Écritures faites ailleurs (fenêtre principale, autre annexe) : l'annexe relit. */
  ecouter(rappel: () => void): () => void;
  /** Revenir à la fenêtre principale (« ← Hub ») ; l'annexe se ferme. */
  revenir(): void;
  /** L'annexe se ferme. */
  fermee(): void;
}

interface FenetreOuverte {
  closed?: boolean;
  close(): void;
  focus?(): void;
  document?: { open(): void; write(html: string): void; close(): void; title?: string };
}

interface Hote {
  version: 1;
  rattacher(nom: string): ContexteAnnexe | undefined;
}

export interface ConfigurationHote {
  session: unknown;
  profils(): unknown;
  verrouiller(): void;
}

interface Annexe {
  nom: string;
  app: string;
  fenetre?: FenetreOuverte;
  ecouteurs: Set<() => void>;
  rattachee: boolean;
}

/**
 * Hôte des annexes, dans la fenêtre principale. Une seule instance par page
 * (voir `hoteFenetres`). Sans `configurer` (application verrouillée), aucune
 * annexe ne peut se rattacher.
 */
export class HoteFenetres {
  private configuration: ConfigurationHote | undefined;
  private readonly annexes = new Map<string, Annexe>();
  private readonly ecouteursPrincipal = new Set<() => void>();
  private readonly ecouteursActivite = new Set<() => void>();
  private readonly ecouteursListe = new Set<() => void>();
  private lecturesAnnexes = 0;
  private source: string | undefined;
  private sources = new Set<string>();
  private minuterie: ReturnType<typeof setTimeout> | undefined;
  private surveillance: ReturnType<typeof setInterval> | undefined;

  /** Pose (ou retire, avec `undefined`) la session ouverte. Retirer ferme toutes les annexes. */
  configurer(configuration: ConfigurationHote | undefined): void {
    this.configuration = configuration;
    if (!configuration) {
      this.fermerTout();
    }
  }

  configure(): boolean {
    return Boolean(this.configuration);
  }

  /** Apps ouvertes dans une annexe. */
  appsEnAnnexe(): string[] {
    return [...this.annexes.values()].map(a => a.app);
  }

  /** Met au premier plan l'annexe d'une app ; faux s'il n'y en a pas. */
  montrer(app: string): boolean {
    for (const annexe of this.annexes.values()) {
      if (annexe.app === app && annexe.fenetre && !annexe.fenetre.closed) {
        annexe.fenetre.focus?.();
        return true;
      }
    }
    return false;
  }

  /** Déclare une annexe sur le point d'être ouverte ; rend son nom. */
  preparer(app: string, jeton: string = jetonAleatoire()): string {
    const nom = nomAnnexe(app, jeton);
    this.annexes.set(nom, { nom, app, ecouteurs: new Set(), rattachee: false });
    return nom;
  }

  /** La fenêtre a été ouverte (ou non : l'annexe est oubliée). */
  ouverte(nom: string, fenetre: FenetreOuverte | null | undefined): void {
    const annexe = this.annexes.get(nom);
    if (!annexe) return;
    if (!fenetre) {
      this.annexes.delete(nom);
      return;
    }
    annexe.fenetre = fenetre;
    this.surveiller();
    this.signalerListe();
  }

  rattacher(nom: string): ContexteAnnexe | undefined {
    const config = this.configuration;
    const annexe = this.annexes.get(nom);
    // Le nom n'est valable qu'une fois, et seulement session ouverte.
    if (!config || !annexe || annexe.rattachee || !lireNomAnnexe(nom)) {
      return undefined;
    }
    annexe.rattachee = true;
    return {
      version: 1,
      app: annexe.app,
      session: config.session,
      profils: () => this.configuration?.profils(),
      verrouiller: () => this.configuration?.verrouiller(),
      activite: () => this.ecouteursActivite.forEach(rappel => rappel()),
      lecture: enCours => {
        this.lecturesAnnexes = Math.max(0, this.lecturesAnnexes + (enCours ? 1 : -1));
      },
      ecrire: action => this.ecrireDepuis(nom, action),
      ecouter: rappel => {
        annexe.ecouteurs.add(rappel);
        return () => annexe.ecouteurs.delete(rappel);
      },
      revenir: () => {
        this.fermer(nom);
        const g = globalThis as { focus?(): void };
        g.focus?.();
      },
      fermee: () => this.oublier(nom),
    };
  }

  /** Écriture dans la base partagée (appelée par la session, à chaque écriture). */
  ecritureLocale(): void {
    this.sources.add(this.source ?? 'principal');
    if (this.minuterie === undefined) {
      this.minuterie = setTimeout(() => this.notifier(), DELAI_NOTIFICATION_MS);
    }
  }

  ecouterPrincipal(rappel: () => void): () => void {
    this.ecouteursPrincipal.add(rappel);
    return () => this.ecouteursPrincipal.delete(rappel);
  }

  ecouterActivite(rappel: () => void): () => void {
    this.ecouteursActivite.add(rappel);
    return () => this.ecouteursActivite.delete(rappel);
  }

  /** Les annexes ouvertes changent (ouverture, fermeture). */
  ecouterListe(rappel: () => void): () => void {
    this.ecouteursListe.add(rappel);
    return () => this.ecouteursListe.delete(rappel);
  }

  lectures(): number {
    return this.lecturesAnnexes;
  }

  fermer(nom: string): void {
    const annexe = this.annexes.get(nom);
    if (!annexe) return;
    this.oublier(nom);
    try {
      annexe.fenetre?.close();
    } catch {
      // Déjà fermée.
    }
  }

  fermerTout(): void {
    for (const nom of [...this.annexes.keys()]) {
      this.fermer(nom);
    }
    this.lecturesAnnexes = 0;
  }

  private oublier(nom: string): void {
    if (this.annexes.delete(nom)) {
      this.signalerListe();
    }
    if (this.annexes.size === 0) {
      this.lecturesAnnexes = 0;
      if (this.surveillance !== undefined) {
        clearInterval(this.surveillance);
        this.surveillance = undefined;
      }
    }
  }

  private ecrireDepuis<T>(nom: string, action: () => T): T {
    const avant = this.source;
    this.source = nom;
    try {
      return action();
    } finally {
      this.source = avant;
    }
  }

  private notifier(): void {
    this.minuterie = undefined;
    const sources = this.sources;
    this.sources = new Set();
    const seule = sources.size === 1 ? [...sources][0] : undefined;
    if (seule !== 'principal') {
      this.ecouteursPrincipal.forEach(rappel => rappel());
    }
    for (const annexe of this.annexes.values()) {
      if (seule !== annexe.nom) {
        annexe.ecouteurs.forEach(rappel => {
          try {
            rappel();
          } catch {
            // Annexe en train de se fermer.
          }
        });
      }
    }
  }

  private signalerListe(): void {
    this.ecouteursListe.forEach(rappel => rappel());
  }

  /** Une annexe fermée par la croix du système est oubliée (vérifié toutes les 2 s tant qu'il y en a). */
  private surveiller(): void {
    if (this.surveillance !== undefined) return;
    this.surveillance = setInterval(() => {
      for (const annexe of [...this.annexes.values()]) {
        if (annexe.fenetre?.closed) {
          this.oublier(annexe.nom);
        }
      }
    }, 2000);
  }
}

let hote: HoteFenetres | undefined;

/** L'hôte des annexes de cette page (créé au premier appel, publié pour les annexes). */
export function hoteFenetres(): HoteFenetres {
  if (!hote) {
    hote = new HoteFenetres();
    const publie: Hote = { version: 1, rattacher: nom => hote?.rattacher(nom) };
    (globalThis as Record<string, unknown>)[CLE_HOTE] = publie;
  }
  return hote;
}

// ------------------------------------------------------------ ouverture (web)

interface DocumentSource {
  head?: { children: ArrayLike<{ tagName: string; id?: string; outerHTML: string; getAttribute(n: string): string | null }> };
  querySelectorAll?(selecteur: string): ArrayLike<{ outerHTML: string }>;
  baseURI?: string;
}

function echapperAttribut(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function echapperTexte(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * Page de l'annexe : les feuilles de style et les scripts de modules de la
 * page principale (rien d'autre : ni les styles posés à la volée par
 * react-native-web, que l'annexe refait, ni les scripts ordinaires).
 */
export function pageAnnexe(doc: DocumentSource, titre: string): string {
  const tete = Array.from(doc.head?.children ?? [])
    .filter(element => {
      const balise = element.tagName.toUpperCase();
      if (balise === 'TITLE' || balise === 'BASE') return false;
      if (balise === 'STYLE') return element.id !== 'react-native-stylesheet';
      if (balise === 'SCRIPT') return element.getAttribute('type') === 'module';
      if (balise === 'LINK') return /^(stylesheet|modulepreload|icon)$/i.test(element.getAttribute('rel') ?? '');
      return balise === 'META';
    })
    .map(element => element.outerHTML)
    .join('\n');
  const modulesCorps = Array.from(doc.querySelectorAll?.('body script[type="module"]') ?? [])
    .map(element => element.outerHTML)
    .join('\n');
  const base = doc.baseURI ? `<base href="${echapperAttribut(doc.baseURI.split('#')[0])}">` : '';
  return `<!doctype html><html lang="fr"><head>${base}<title>${echapperTexte(titre)} · AppDashboard</title>\n${tete}</head><body><div id="racine"></div>\n${modulesCorps}</body></html>`;
}

interface Ecran {
  availWidth?: number;
  availHeight?: number;
  availLeft?: number;
  availTop?: number;
}

export interface Bornes {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Taille et place d'une annexe : la dernière connue pour cette app, ramenée dans l'écran. */
export function bornesAnnexe(memoire: Partial<Bornes> | undefined, ecran: Ecran, rang = 0): Bornes {
  const largeurEcran = ecran.availWidth ?? 1440;
  const hauteurEcran = ecran.availHeight ?? 900;
  const gaucheEcran = ecran.availLeft ?? 0;
  const hautEcran = ecran.availTop ?? 0;
  const largeur = Math.round(Math.min(largeurEcran, Math.max(720, memoire?.largeur ?? Math.min(1200, largeurEcran * 0.75))));
  const hauteur = Math.round(Math.min(hauteurEcran, Math.max(560, memoire?.hauteur ?? Math.min(860, hauteurEcran * 0.85))));
  const decalage = 32 * rang;
  const xVoulu = memoire?.x ?? gaucheEcran + (largeurEcran - largeur) / 2 + decalage;
  const yVoulu = memoire?.y ?? hautEcran + (hauteurEcran - hauteur) / 2 + decalage;
  // Toujours au moins une bonne part de la fenêtre dans l'écran (écran débranché depuis…).
  const x = Math.round(Math.min(gaucheEcran + largeurEcran - 160, Math.max(gaucheEcran, xVoulu)));
  const y = Math.round(Math.min(hautEcran + hauteurEcran - 120, Math.max(hautEcran, yVoulu)));
  return { x, y, largeur, hauteur };
}

export function cleBornes(app: string): string {
  return `applibourse.fenetre.${app}`;
}

export function lireBornes(app: string): Partial<Bornes> | undefined {
  try {
    const brut = (globalThis as { localStorage?: { getItem(c: string): string | null } }).localStorage?.getItem(cleBornes(app));
    const valeur = brut ? (JSON.parse(brut) as Partial<Bornes>) : undefined;
    if (!valeur || typeof valeur !== 'object') return undefined;
    const nombre = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
    return { x: nombre(valeur.x), y: nombre(valeur.y), largeur: nombre(valeur.largeur), hauteur: nombre(valeur.hauteur) };
  } catch {
    return undefined;
  }
}

export function ecrireBornes(app: string, bornes: Bornes): void {
  try {
    (globalThis as { localStorage?: { setItem(c: string, v: string): void } }).localStorage?.setItem(cleBornes(app), JSON.stringify(bornes));
  } catch {
    // Stockage indisponible : la fenêtre s'ouvrira au centre la prochaine fois.
  }
}

/** L'application de bureau sait ouvrir des annexes (moteur assez récent). */
export function fenetresDisponibles(): boolean {
  const pont = (globalThis as { applibourse?: { bureau?: boolean; fenetres?: { version?: number } } }).applibourse;
  return Boolean(pont?.bureau && (pont.fenetres?.version ?? 0) >= 1);
}

/**
 * Ouvre une app dans une nouvelle fenêtre. Rend faux si la fenêtre n'a pas pu
 * s'ouvrir (moteur trop ancien, refus) : l'appelant le dit.
 */
export function ouvrirFenetreAnnexe(app: string, nomApp: string): boolean {
  const g = globalThis as {
    open?(url: string, nom: string, options: string): FenetreOuverte | null;
    document?: DocumentSource;
    screen?: Ecran;
  };
  const h = hoteFenetres();
  if (!g.open || !g.document || !h.configure() || !idValide(app)) {
    return false;
  }
  if (h.montrer(app)) {
    return true;
  }
  const bornes = bornesAnnexe(lireBornes(app), g.screen ?? {}, h.appsEnAnnexe().length);
  const nom = h.preparer(app);
  let fenetre: FenetreOuverte | null = null;
  try {
    fenetre = g.open('about:blank', nom, `width=${bornes.largeur},height=${bornes.hauteur},left=${bornes.x},top=${bornes.y}`);
  } catch {
    fenetre = null;
  }
  if (!fenetre?.document) {
    h.ouverte(nom, null);
    return false;
  }
  try {
    const page = pageAnnexe(g.document, nomApp);
    fenetre.document.open();
    fenetre.document.write(page);
    fenetre.document.close();
  } catch {
    try {
      fenetre.close();
    } catch {
      // Rien à fermer.
    }
    h.ouverte(nom, null);
    return false;
  }
  h.ouverte(nom, fenetre);
  return true;
}

// ------------------------------------------------------------ côté annexe

/**
 * Au démarrage d'une page : est-ce une annexe ? Si oui, son contexte (la
 * fenêtre principale l'attendait). Une page ordinaire, un nom inconnu ou une
 * fenêtre principale verrouillée : `undefined`.
 */
export function rattacherAnnexe(): ContexteAnnexe | undefined {
  const g = globalThis as { name?: string; opener?: Record<string, unknown> | null };
  const nom = g.name;
  if (!lireNomAnnexe(nom)) {
    return undefined;
  }
  try {
    const publie = g.opener?.[CLE_HOTE] as Hote | undefined;
    if (!publie || publie.version !== 1) {
      return undefined;
    }
    return publie.rattacher(nom!);
  } catch {
    // Fenêtre principale d'une autre origine, ou fermée.
    return undefined;
  }
}

interface PiloteMinimal {
  executer(sql: string, parametres?: readonly unknown[]): void;
  lire(sql: string, parametres?: readonly unknown[]): unknown[];
  transaction<T>(action: () => T): T;
  fermer(): void;
}

/**
 * La session de la fenêtre principale, vue de l'annexe : mêmes méthodes, mais
 * les écritures sont signées par l'annexe (la fenêtre principale relit), la
 * base partagée ne peut pas être fermée d'ici, et « verrouiller » verrouille
 * tout depuis la fenêtre principale.
 */
export function sessionPourAnnexe<S extends object>(session: S, contexte: Pick<ContexteAnnexe, 'ecrire' | 'verrouiller'>): S {
  const liees = new Map<PropertyKey, unknown>();
  const enveloppes = new WeakMap<object, PiloteMinimal>();
  const envelopper = (pilote: PiloteMinimal): PiloteMinimal => {
    let enveloppe = enveloppes.get(pilote);
    if (!enveloppe) {
      enveloppe = {
        executer: (sql, parametres) => contexte.ecrire(() => pilote.executer(sql, parametres)),
        lire: (sql, parametres) => pilote.lire(sql, parametres),
        transaction: action => contexte.ecrire(() => pilote.transaction(action)),
        // La base appartient à la fenêtre principale.
        fermer: () => undefined,
      };
      enveloppes.set(pilote, enveloppe);
    }
    return enveloppe;
  };
  return new Proxy(session, {
    get(cible, cle) {
      if (cle === 'base') {
        return () => envelopper((cible as unknown as { base(): PiloteMinimal }).base());
      }
      if (cle === 'verrouiller') {
        return () => contexte.verrouiller();
      }
      const valeur = Reflect.get(cible, cle, cible) as unknown;
      if (typeof valeur !== 'function') {
        return valeur;
      }
      if (!liees.has(cle)) {
        liees.set(cle, (valeur as (...a: unknown[]) => unknown).bind(cible));
      }
      return liees.get(cle);
    },
  });
}
