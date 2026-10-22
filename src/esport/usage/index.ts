/**
 * Branchement du collecteur d'usage dans l'app Esport : un seul collecteur à la fois (celui de la session
 * Esport ouverte), relié à la visibilité de la page (web) ou à l'état de l'app (iPhone, iPad), aux erreurs
 * JS et aux appels réussis de l'API (actions clés). Voir collecteur.ts.
 */

import { AppState, Dimensions, Platform } from 'react-native';
import { ecouterAppels, type ClientEsport } from '../client';
import { langueCourante } from '../i18n';
import { actionDAppel, appareilDe, creerCollecteur, type Appareil, type Collecteur } from './collecteur';

export { actionDAppel, appareilDe, creerCollecteur } from './collecteur';
export type { Appareil, Collecteur, LotUsage } from './collecteur';

let actuel: Collecteur | null = null;

/** Type d'appareil de cet écran. */
export function appareilCourant(): Appareil {
  const g = globalThis as { navigator?: { userAgent?: string; maxTouchPoints?: number } };
  return appareilDe({
    os: Platform.OS,
    isPad: (Platform as { isPad?: boolean }).isPad,
    largeur: Dimensions.get('window')?.width,
    userAgent: g.navigator?.userAgent,
    maxTouchPoints: g.navigator?.maxTouchPoints,
    // L'app PC (Electron) s'annonce dans son agent utilisateur ; le site expose aussi `window.applibourse`.
    electron: /\bElectron\//.test(g.navigator?.userAgent ?? ''),
  });
}

/** Intervalle des lots : 45 s (les tests de bout en bout peuvent le raccourcir). */
const intervalle = (): number => {
  const v = Number((globalThis as { __ESPORT_USAGE_INTERVALLE__?: number }).__ESPORT_USAGE_INTERVALLE__);
  return Number.isFinite(v) && v >= 200 ? v : 45_000;
};

type Cible = { addEventListener(t: string, f: (e: unknown) => void): void; removeEventListener(t: string, f: (e: unknown) => void): void };

/** Démarre la collecte pour ce client (session Esport ouverte) ; rend la fonction d'arrêt. */
export function demarrerUsage(client: ClientEsport): () => void {
  arreterUsage();
  if (!client.envoyerUsage) return () => undefined;
  const c = creerCollecteur({
    envoyer: (lot, { keepalive }) => client.envoyerUsage!(lot, keepalive),
    appareil: appareilCourant(),
    langue: langueCourante,
    intervalleMs: intervalle(),
  });
  actuel = c;
  const arrets: Array<() => void> = [];
  arrets.push(ecouterAppels((methode, chemin) => {
    const a = actionDAppel(methode, chemin);
    if (a) c.action(a.action, a.team);
  }));
  const g = globalThis as { document?: Cible & { visibilityState?: string }; window?: Cible };
  if (Platform.OS === 'web' && g.document && g.window) {
    const doc = g.document;
    const win = g.window;
    const visibilite = () => (doc.visibilityState === 'hidden' ? c.masquer() : c.montrer());
    const depart = () => c.masquer();
    const erreur = (e: unknown) => c.erreur(String((e as { message?: string })?.message ?? (e as { error?: { message?: string } })?.error?.message ?? 'Error'));
    const rejet = (e: unknown) => {
      const r = (e as { reason?: { message?: string; name?: string } | string })?.reason;
      c.erreur(typeof r === 'string' ? r : `${r?.name ?? 'Error'}: ${r?.message ?? ''}`);
    };
    doc.addEventListener('visibilitychange', visibilite);
    win.addEventListener('pagehide', depart);
    win.addEventListener('error', erreur);
    win.addEventListener('unhandledrejection', rejet);
    arrets.push(() => {
      doc.removeEventListener('visibilitychange', visibilite);
      win.removeEventListener('pagehide', depart);
      win.removeEventListener('error', erreur);
      win.removeEventListener('unhandledrejection', rejet);
    });
  } else if (Platform.OS !== 'web') {
    const abonnement = AppState.addEventListener?.('change', etat => (etat === 'active' ? c.montrer() : c.masquer()));
    if (abonnement) arrets.push(() => abonnement.remove());
    // Exceptions non rattrapées (iPhone, iPad) : notées, puis le gestionnaire d'origine (inchangé) les traite.
    type Gestionnaire = (e: unknown, fatale?: boolean) => void;
    const eu = (globalThis as { ErrorUtils?: { getGlobalHandler?(): Gestionnaire; setGlobalHandler?(f: Gestionnaire): void } }).ErrorUtils;
    const avant = eu?.getGlobalHandler?.();
    if (eu?.setGlobalHandler && avant) {
      eu.setGlobalHandler((e, fatale) => {
        c.erreur(String((e as { message?: string })?.message ?? e));
        avant(e, fatale);
      });
      arrets.push(() => eu.setGlobalHandler?.(avant));
    }
  }
  return () => {
    for (const a of arrets) a();
    c.masquer();
    c.arreter();
    if (actuel === c) actuel = null;
  };
}

export function arreterUsage(): void {
  actuel?.arreter();
  actuel = null;
}

/** Page ou section ouverte (identifiant de route stable). */
export function noterPage(id: string, teamId?: string | null): void {
  actuel?.page(id, teamId);
}

/** Erreur d'affichage (attrapée par un écran) : message et page courante. */
export function noterErreur(message: string): void {
  actuel?.erreur(message);
}

/** Identifiant de route d'une section de team : « team.agenda.planning », « team.reglages.journal »… */
export function pageDeSection(groupe: string, section: string): string {
  return `team.${groupe}.${section.startsWith('module:') ? section.slice('module:'.length) : section}`;
}
