/**
 * Claude Office : la check-list « Mise en route » de l'onglet Bureau,
 * calculée sur l'état RÉEL (logique pure, testée). Chaque ligne qui n'est pas
 * verte propose UNE action claire : un bouton, ou une commande à copier.
 */

import { ilYA } from './logiqueBureau';
import type { DepotActivite } from './synchroHistorique';
import { COMMANDE_HOOKS } from './pont';

export type Niveau = 'ok' | 'info' | 'attention' | 'erreur';
export type GenreAction = 'installer-hook' | 'activer-copie' | 'activer-presence' | 'reessayer' | 'demo';

export interface Etape {
  id: 'hook' | 'evenement' | 'copie' | 'presence' | 'appareils' | 'relais';
  niveau: Niveau;
  titre: string;
  detail?: string;
  action?: { genre: GenreAction; titre: string };
  /** Commande à lancer sur le PC (avec un bouton « Copier »). */
  commande?: string;
}

export interface EntreeMiseEnRoute {
  maintenant: number;
  /** Sur le PC (pont Electron) ou ailleurs (site, téléphone). */
  surPc: boolean;
  /** PC : état du hook d'historique (inconnu tant qu'il n'est pas lu). */
  hook?: 'installes' | 'incomplet' | 'absents' | 'illisibles';
  /** Dernier événement connu, tous agents confondus (ms). */
  derniereActivite?: number;
  /** Première lecture terminée. */
  lu: boolean;
  /** Erreur de lecture (journal ou relais). */
  erreur?: string;
  /** Compte principal relié au relais (copie possible). */
  relais: boolean;
  /** PC : réglages de la copie chiffrée et de la présence rapide. */
  copie?: { active: boolean; derniere?: string; erreur?: string };
  presence?: { active: boolean; derniere?: string };
  /** Ailleurs : dépôts lus sur le relais. */
  depots?: readonly DepotActivite[];
}

/** Au-delà, une copie reçue est « ancienne » (le PC est sans doute éteint ou l'app fermée). */
export const COPIE_ANCIENNE_MS = 60 * 60_000;
/** Au-delà, le dernier événement est ancien (Claude Code n'a pas servi depuis un moment). */
export const EVENEMENT_ANCIEN_MS = 24 * 3_600_000;

const age = (iso: string | undefined, m: number) => (iso ? ilYA(Date.parse(iso), m) : undefined);

export function etapesMiseEnRoute(o: EntreeMiseEnRoute): Etape[] {
  const m = o.maintenant;
  const etapes: Etape[] = [];
  const evenement = (): Etape => {
    if (o.erreur) return { id: 'evenement', niveau: 'erreur', titre: o.surPc ? 'Journal illisible' : 'Relais injoignable', detail: o.erreur, action: { genre: 'reessayer', titre: 'Réessayer' } };
    if (!o.lu) return { id: 'evenement', niveau: 'info', titre: 'Lecture de l’activité…' };
    if (o.derniereActivite === undefined) {
      return {
        id: 'evenement', niveau: o.surPc ? 'erreur' : 'attention', titre: 'Aucun événement reçu',
        detail: o.surPc ? 'Lance (ou redémarre) Claude Code sur ce PC.' : 'Claude Code n’a pas encore travaillé sur le PC équipé.',
        action: { genre: 'demo', titre: 'Voir la démo' },
      };
    }
    const ancien = m - o.derniereActivite > EVENEMENT_ANCIEN_MS;
    return { id: 'evenement', niveau: ancien ? 'attention' : 'ok', titre: `Dernier événement reçu ${ilYA(o.derniereActivite, m)}`, ...(ancien ? { detail: 'Rien depuis plus d’un jour.' } : {}) };
  };

  if (o.surPc) {
    // 1. Le hook sur ce PC.
    if (o.hook === 'installes') etapes.push({ id: 'hook', niveau: 'ok', titre: 'Hook installé sur ce PC' });
    else if (o.hook === 'incomplet') {
      etapes.push({
        id: 'hook', niveau: 'attention', titre: 'Hook à mettre à jour',
        detail: 'Il manque « attend ta réponse » et la durée des outils. Mets-le à jour, puis redémarre Claude Code.',
        action: { genre: 'installer-hook', titre: 'Mettre à jour le hook…' }, commande: COMMANDE_HOOKS,
      });
    } else if (o.hook === 'absents') {
      etapes.push({
        id: 'hook', niveau: 'erreur', titre: 'Hook pas installé sur ce PC',
        detail: 'Sans lui, rien n’est noté. Installe-le, puis redémarre Claude Code.',
        action: { genre: 'installer-hook', titre: 'Installer le hook…' }, commande: COMMANDE_HOOKS,
      });
    } else if (o.hook === 'illisibles') {
      etapes.push({ id: 'hook', niveau: 'erreur', titre: 'Réglages de Claude Code illisibles', detail: 'settings.json n’est pas du JSON valide : corrige-le.', action: { genre: 'reessayer', titre: 'Réessayer' } });
    } else etapes.push({ id: 'hook', niveau: 'info', titre: 'Vérification du hook…' });
    etapes.push(evenement());
    // 3. Copie chiffrée (pour voir le bureau sur le site et le téléphone).
    if (!o.relais) {
      etapes.push({ id: 'copie', niveau: 'info', titre: 'Copie chiffrée indisponible', detail: 'Relie le compte principal au relais (Paramètres › Synchronisation).' });
    } else if (!o.copie?.active) {
      etapes.push({ id: 'copie', niveau: 'attention', titre: 'Copie chiffrée désactivée', detail: 'Le site et le téléphone ne voient rien de ce PC.', action: { genre: 'activer-copie', titre: 'Activer la copie' } });
    } else if (o.copie.erreur) {
      etapes.push({ id: 'copie', niveau: 'erreur', titre: 'Dernier dépôt en échec', detail: o.copie.erreur, action: { genre: 'reessayer', titre: 'Réessayer' } });
    } else {
      etapes.push({ id: 'copie', niveau: 'ok', titre: `Copie chiffrée activée · ${o.copie.derniere ? `dernier dépôt ${age(o.copie.derniere, m)}` : 'premier dépôt dans la minute'}` });
    }
    // 4. Présence rapide (facultative).
    if (o.relais && o.copie?.active) {
      etapes.push(o.presence?.active
        ? { id: 'presence', niveau: 'ok', titre: `Présence rapide activée${o.presence.derniere ? ` · ${age(o.presence.derniere, m)}` : ''}` }
        : { id: 'presence', niveau: 'info', titre: 'Présence rapide désactivée (facultatif)', detail: 'Retard à distance : 5 min au lieu de 15.', action: { genre: 'activer-presence', titre: 'Activer' } });
    }
    return etapes;
  }

  // Ailleurs (site, téléphone) : tout vient de la copie chiffrée du relais.
  if (!o.relais) {
    etapes.push({ id: 'relais', niveau: 'erreur', titre: 'Compte principal non relié', detail: 'Connecte-toi avec le compte principal relié au relais.' });
    return etapes;
  }
  const depots = o.depots ?? [];
  const historiques = depots.filter(d => d.genre === 'historique');
  const presences = depots.filter(d => d.genre === 'presence');
  const plusRecent = (liste: readonly DepotActivite[]) => liste.reduce<string | undefined>((a, d) => (!a || d.date > a ? d.date : a), undefined);
  if (o.erreur) etapes.push({ id: 'relais', niveau: 'erreur', titre: 'Relais injoignable', detail: o.erreur, action: { genre: 'reessayer', titre: 'Réessayer' } });
  if (!o.lu) etapes.push({ id: 'copie', niveau: 'info', titre: 'Lecture des copies…' });
  else if (!depots.length) {
    etapes.push({
      id: 'copie', niveau: 'erreur', titre: 'Aucune copie reçue du PC',
      detail: 'Sur le PC de Claude Code : installe le hook (commande ci-dessous), puis active « Déposer la copie chiffrée » (Claude Office › Bureau). Rien à installer ici.',
      commande: COMMANDE_HOOKS,
    });
  } else {
    const date = plusRecent(historiques.length ? historiques : depots)!;
    const ancienne = m - Date.parse(date) > COPIE_ANCIENNE_MS;
    etapes.push({
      id: 'copie', niveau: ancienne ? 'attention' : 'ok', titre: `Copie chiffrée reçue ${age(date, m)}`,
      ...(ancienne ? { detail: 'Le PC est peut-être éteint ou l’app fermée : état de ce moment-là.' } : {}),
    });
    const parAppareil = new Map<string, string>();
    for (const d of depots) {
      const nom = d.appareil ?? d.appareilId;
      if (!parAppareil.has(nom) || d.date > parAppareil.get(nom)!) parAppareil.set(nom, d.date);
    }
    etapes.push({ id: 'appareils', niveau: 'ok', titre: `Copie venant de : ${[...parAppareil].map(([nom, d]) => `${nom} (${age(d, m)})`).join(', ')}` });
  }
  if (o.lu && depots.length) {
    etapes.push(presences.length
      ? { id: 'presence', niveau: 'ok', titre: `Présence rapide reçue ${age(plusRecent(presences), m)}` }
      : { id: 'presence', niveau: 'info', titre: 'Présence rapide non activée sur le PC (facultatif)', detail: 'Sur le PC : « Présence rapide » (5 min de retard au lieu de 15).' });
    etapes.push(evenement());
  }
  return etapes;
}

/** Tout est en ordre : la check-list se réduit à une ligne. */
export const toutEstPret = (etapes: readonly Etape[]): boolean => etapes.every(e => e.niveau === 'ok' || e.niveau === 'info');

// ------------------------------------------------------------------ bandeau réductible

/** Les points à régler (rouge ou orange) : ceux qui empêchent « tout est prêt ». */
export const pointsARegler = (etapes: readonly Etape[]): string[] => etapes.filter(e => e.niveau === 'erreur' || e.niveau === 'attention').map(e => e.id);

/** Mémoire du bandeau sur l'appareil : réduit à la main, et les points à régler connus à ce moment-là. */
export interface MemoireMiseEnRoute {
  reduit: boolean;
  points: string[];
}

export const CLE_MEMOIRE_MISE_EN_ROUTE = 'claude-office-mise-en-route';

/**
 * Le bandeau est-il réduit ? Tout est prêt : réduit (sauf s'il a été rouvert).
 * Sinon : réduit seulement si on l'a réduit à la main ET qu'aucun NOUVEAU point
 * n'est passé au rouge depuis (un point déjà connu, toujours rouge — par
 * exemple « Aucun événement reçu » quand on travaille depuis des sessions
 * cloud — ne le rouvre pas à chaque chargement).
 */
export function bandeauReduit(etapes: readonly Etape[], memoire: MemoireMiseEnRoute | undefined): boolean {
  if (toutEstPret(etapes)) return memoire?.reduit !== false;
  if (!memoire?.reduit) return false;
  return pointsARegler(etapes).every(p => memoire.points.includes(p));
}

type Stockage = { getItem(c: string): string | null; setItem(c: string, v: string): void };
const stockage = (): Stockage | undefined => (globalThis as { localStorage?: Stockage }).localStorage;

export function lireMemoireMiseEnRoute(): MemoireMiseEnRoute | undefined {
  try {
    const brut = stockage()?.getItem(CLE_MEMOIRE_MISE_EN_ROUTE);
    if (!brut) return undefined;
    const m = JSON.parse(brut) as Partial<MemoireMiseEnRoute>;
    return { reduit: Boolean(m.reduit), points: Array.isArray(m.points) ? m.points.filter((p): p is string => typeof p === 'string').slice(0, 20) : [] };
  } catch {
    return undefined;
  }
}

export function ecrireMemoireMiseEnRoute(m: MemoireMiseEnRoute): void {
  try {
    stockage()?.setItem(CLE_MEMOIRE_MISE_EN_ROUTE, JSON.stringify(m));
  } catch {
    // stockage indisponible : le bandeau reste réductible le temps de la visite
  }
}
