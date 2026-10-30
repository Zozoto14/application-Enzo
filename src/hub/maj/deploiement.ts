/**
 * État des mises à jour vu par le serveur Esport (GET /deploiement, Fondateur ou permission du club
 * deploiement.voir) : pastille « Mise à jour en cours… » de l'en-tête et page « Mises à jour ». docs/mises-a-jour.md.
 *
 * Un seul sondage partagé par toute l'app (pastille + page) : au démarrage, toutes les 3 minutes, au retour au premier
 * plan (au plus une fois par minute). Le serveur met GitHub en cache 2 minutes : le sondage reste léger. Un refus
 * (404 : pas le Fondateur, ou serveur pas encore à jour) arrête le sondage pour la session.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { ErreurEsport, trouverConfig, type ClientEsport } from '../../esport/client';
import { fabrique } from '../../esport/fabrique';
import { tm } from './textes';

export interface LigneJournal {
  date: string;
  texte: string;
}
export interface ExecutionGithub {
  statut: 'en-cours' | 'reussi' | 'echec' | 'annule';
  sha: string | null;
  message: string | null;
  debut: string | null;
  fin: string | null;
  numero: number | null;
  url: string | null;
}
export interface EtatDeploiement {
  etat: 'a-jour' | 'en-cours' | 'echec' | 'bloque' | 'inconnu';
  phase?: 'build' | 'publication';
  estimationMin: number | null;
  site: { id: string; commit: string | null; date: string | null } | null;
  serveur: { commit: string | null; demarreLe: string | null; redemarrageEnAttente: boolean };
  relais: { commit: string | null; redemarreLe: string | null };
  deploiement: {
    codeDeploye: string | null;
    dernierDeploiement: string | null;
    derniereVerification: string | null;
    derniereLigne: LigneJournal | null;
    echec: LigneJournal | null;
    journal: LigneJournal[];
    demandeEnAttente: boolean;
    demandeLe: string | null;
  };
  github: {
    main: { sha: string; message: string; date: string | null } | null;
    workflow: ExecutionGithub | null;
    majLe: string | null;
    erreur: null | 'limite' | 'injoignable' | 'reponse';
    reessaiLe?: string;
  };
  heure: string;
}

export type Ton = 'ok' | 'attente' | 'alerte';
export interface Pastille {
  texte: string;
  titre: string;
  ton: Ton;
}

/** Pastille de l'en-tête ; undefined quand il n'y a rien d'utile à dire (état inconnu). */
export function pastillePour(e: EtatDeploiement | undefined): Pastille | undefined {
  if (!e) return undefined;
  switch (e.etat) {
    case 'en-cours': {
      const n = e.estimationMin;
      return {
        texte: n ? tm('pastille.encours', { n }) : tm('pastille.encours_sans'),
        titre: tm('pastille.titre_encours', { n: n ?? '?' }),
        ton: 'attente',
      };
    }
    case 'echec':
      return { texte: tm('pastille.echec'), titre: tm('pastille.titre_echec'), ton: 'alerte' };
    case 'bloque':
      return { texte: tm('pastille.bloque'), titre: tm('pastille.titre_bloque'), ton: 'alerte' };
    case 'a-jour':
      return { texte: tm('pastille.ajour'), titre: tm('pastille.titre_ajour'), ton: 'ok' };
    default:
      return undefined;
  }
}

/** Phrase d'état détaillée (page Mises à jour). */
export function phraseEtat(e: EtatDeploiement): string {
  if (e.etat === 'en-cours') return tm(e.phase === 'build' ? 'page.etat.en-cours.build' : 'page.etat.en-cours.publication', { n: e.estimationMin ?? '?' });
  return tm(`page.etat.${e.etat}` as const);
}

export const court = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : '—');

// ------------------------------------------------------------------ Sondage partagé

export const INTERVALLE_DEPLOIEMENT_MS = 3 * 60_000;
const ECART_RETOUR_MS = 60_000;

export interface EtatSondage {
  etat?: EtatDeploiement;
  /** « indisponible » : refus (pas le droit, ou serveur pas encore à jour) ; « injoignable » : réseau. */
  erreur?: 'indisponible' | 'injoignable';
  chargement: boolean;
}

/** Accès au serveur Esport du compte courant ; `cle` change quand le compte (jeton du relais) change. */
export type FournisseurClient = () => Promise<{ cle: string; client: ClientEsport } | undefined>;

let clientEnCache: { jeton: string; client: ClientEsport } | undefined;
const clientParDefaut: FournisseurClient = async () => {
  const relais = fabrique.relais();
  if (!relais?.jeton) return undefined;
  if (clientEnCache?.jeton !== relais.jeton) {
    const { config } = await trouverConfig(relais);
    if (!config) return undefined;
    clientEnCache = { jeton: relais.jeton, client: fabrique.client(config) };
  }
  return { cle: relais.jeton, client: clientEnCache.client };
};

/** Sondeur (instanciable pour les tests ; l'app en partage un seul, `sondeur`). */
export function creerSondeur(obtenir: FournisseurClient = clientParDefaut, maintenant: () => number = Date.now) {
  let etat: EtatSondage = { chargement: false };
  let derniere = -Infinity;
  let cle: string | undefined;
  let refuse = false;
  let utilisateurs = 0;
  let minuterie: ReturnType<typeof setInterval> | undefined;
  const abonnes = new Set<() => void>();
  const poser = (e: Partial<EtatSondage>) => {
    etat = { ...etat, ...e };
    abonnes.forEach(f => f());
  };

  /** Client du compte courant ; un autre compte (autre jeton) repart de zéro (jamais l'état d'un autre). */
  async function acces(): Promise<ClientEsport | undefined> {
    const a = await obtenir();
    if (!a) {
      if (etat.etat || etat.erreur !== 'indisponible') poser({ etat: undefined, erreur: 'indisponible' });
      return undefined;
    }
    if (a.cle !== cle) {
      cle = a.cle;
      refuse = false;
      poser({ etat: undefined, erreur: undefined });
    }
    return a.client;
  }

  async function rafraichir(forcer = false): Promise<void> {
    if (etat.chargement || (!forcer && maintenant() - derniere < ECART_RETOUR_MS)) return;
    derniere = maintenant();
    const client = await acces().catch(() => undefined);
    // Refus (404 : pas le droit, ou serveur d'avant cette fonction) : on n'insiste pas pour ce compte.
    if (!client || refuse) return;
    poser({ chargement: true });
    try {
      const e = await client.requete<EtatDeploiement>('/deploiement');
      poser({ etat: e, erreur: undefined, chargement: false });
    } catch (e) {
      if (e instanceof ErreurEsport && (e.statut === 404 || e.statut === 403)) {
        refuse = true;
        poser({ chargement: false, erreur: 'indisponible', etat: undefined });
      } else {
        poser({ chargement: false, erreur: 'injoignable' });
      }
    }
  }

  async function verifierMaintenant(): Promise<{ ok: boolean; motif?: string }> {
    try {
      const client = await acces();
      if (!client) return { ok: false, motif: tm('page.indisponible') };
      await client.requete('/deploiement/verifier', 'POST', {});
      await rafraichir(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, motif: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    etat: () => etat,
    abonner(f: () => void) {
      abonnes.add(f);
      return () => {
        abonnes.delete(f);
      };
    },
    rafraichir,
    verifierMaintenant,
    /** Un composant actif utilise le sondage : il démarre au premier, s'arrête au dernier. */
    utiliser(): () => void {
      utilisateurs += 1;
      if (utilisateurs === 1) {
        void rafraichir(true);
        minuterie = setInterval(() => void rafraichir(true), INTERVALLE_DEPLOIEMENT_MS);
      }
      return () => {
        utilisateurs -= 1;
        if (utilisateurs === 0 && minuterie !== undefined) {
          clearInterval(minuterie);
          minuterie = undefined;
        }
      };
    },
    /** Pour les tests. */
    reinitialiser() {
      refuse = false;
      cle = undefined;
      derniere = -Infinity;
      etat = { chargement: false };
    },
  };
}

export const sondeur = creerSondeur();

/**
 * État des mises à jour pour un composant. `actif` faux (pas le Fondateur ni un compte qui pourrait avoir la
 * permission) : aucun appel.
 */
export function useEtatDeploiement(actif: boolean): EtatSondage {
  const etat = useSyncExternalStore(sondeur.abonner, sondeur.etat, sondeur.etat);
  useEffect(() => {
    if (!actif) return undefined;
    const liberer = sondeur.utiliser();
    const doc = (globalThis as { document?: { visibilityState?: string; addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void } }).document;
    const retour = () => {
      if (doc?.visibilityState !== 'hidden') void sondeur.rafraichir();
    };
    doc?.addEventListener?.('visibilitychange', retour);
    return () => {
      liberer();
      doc?.removeEventListener?.('visibilitychange', retour);
    };
  }, [actif]);
  return actif ? etat : { chargement: false };
}
