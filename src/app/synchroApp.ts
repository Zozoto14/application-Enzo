/**
 * Synchronisation automatique par le relais. Un tour part :
 * à l'ouverture (après déverrouillage), au retour au premier plan, quand le
 * réseau revient, quelques secondes après une modification locale, toutes les
 * deux minutes, et à la fermeture de la page (envoi `keepalive`). Après un
 * échec, nouvel essai à 5 s, 30 s, 2 min puis 10 min (voir planificateur.ts).
 *
 * Sorti d'App.tsx pour qu'on puisse le lire d'un seul tenant.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { DepotParametres as _DepotParametres } from '../db/depots';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { expirationSignature, programmerRappelsExpiration } from '../natif/signature';
import type { Session } from '../session/session';
import { identifiantAppareil } from '../sync/identite';
import { decoderLiaison, type Liaison } from '../sync/relais/liaison';
import type { EnAttente, InfoAppareil } from '../sync/relais/moteur';
import { Planificateur, type IssueTour, type RaisonTour } from '../sync/relais/planificateur';
import {
  deposerAvantFermeture,
  ecrireConfigRelais,
  lireConfigRelais,
  lireEtatSynchro,
  oublierAppareil,
  synchroniser,
  testerLiaison,
} from '../sync/relais/synchroniser';
import { definirRelaisActif, liaisonEnAttente } from '../sync/relais/actif';
import { chargerModule } from '../natif/modules';
import { systemeDepuisRnfs } from '../fichiers/systeme';
import { GestionnaireMiseAJour } from '../maj/application';
import { telechargerMiseAJour } from '../maj/telechargement';

export { INTERVALLE_SYNCHRO_MS } from '../sync/relais/planificateur';
/** L'app iPhone regarde s'il y a une nouvelle version au plus toutes les 6 heures. */
const INTERVALLE_MAJ_MS = 6 * 3_600_000;

export interface EtatSynchroApp {
  configure: boolean;
  nom?: string;
  liaison?: Liaison;
  enCours: boolean;
  derniere?: string;
  message?: string;
  erreur?: string;
  appareils: Record<string, InfoAppareil>;
  moi: string;
  plateforme?: string;
  /** Expiration de la signature de cet appareil (iPhone AltStore). */
  expireLe?: string;
  /** Nouvelle version téléchargée, en attente de réouverture. */
  maj?: string;
  /** Changements locaux pas encore envoyés (file d'envoi). */
  enAttente?: EnAttente;
  /** Le réseau est-il disponible d'après l'appareil ? (web : `navigator.onLine`) */
  enLigne?: boolean;
  /** Un premier tour (réussi ou non) a eu lieu depuis le déverrouillage. */
  premierTourFait?: boolean;
  /** Nombre de tours reçus avec des changements (pour recharger l'affichage). */
  recus?: number;
}

type PontRelais = { relais?: { config?(): Promise<Liaison | undefined> } };

interface CibleEvenements {
  addEventListener?(nom: string, rappel: () => void): void;
  removeEventListener?(nom: string, rappel: () => void): void;
}

/** Fenêtre et document quand on tourne dans un navigateur (site, Electron) ; rien en natif. */
function navigateur(): { cible?: CibleEvenements; document?: CibleEvenements & { visibilityState?: string } } {
  const g = globalThis as { window?: CibleEvenements; document?: CibleEvenements & { visibilityState?: string } };
  return g.window && g.document ? { cible: g.window, document: g.document } : {};
}

/** Réseau disponible d'après l'appareil ; vrai quand on ne sait pas le dire. */
function reseauDisponible(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine !== false;
}

/** Plateforme lisible, pour la liste des appareils. */
export function plateformeActuelle(): string {
  if ((globalThis as { applibourse?: { bureau?: boolean } }).applibourse?.bureau) {
    return 'bureau';
  }
  return Platform.OS === 'web' ? 'site' : Platform.OS;
}

export function nomParDefaut(plateforme: string): string {
  return plateforme === 'bureau' ? 'PC' : plateforme === 'ios' ? 'iPhone' : plateforme === 'site' ? 'Site de secours' : 'Téléphone';
}

export function useSynchro({
  session,
  deverrouille,
  rafraichir,
  apresReception,
}: {
  session: Session;
  deverrouille: boolean;
  rafraichir(): void;
  /** Après un tour qui a reçu des changements : recharger thème, préférences du hub… */
  apresReception?(): void;
}) {
  const plateforme = plateformeActuelle();
  const [etat, setEtat] = useState<
    Omit<EtatSynchroApp, 'configure' | 'moi' | 'nom' | 'liaison' | 'appareils' | 'derniere' | 'enAttente' | 'enLigne'>
  >({
    enCours: false,
    premierTourFait: false,
    recus: 0,
  });
  const [enLigne, setEnLigne] = useState(reseauDisponible());
  const [version, setVersion] = useState(0);
  const [liaisonDuPc, setLiaisonDuPc] = useState<Liaison | undefined>();
  const enCours = useRef(false);
  const derniereVerificationMaj = useRef(0);
  const expireLe = useRef<string | undefined>(undefined);

  const base = deverrouille ? session.base() : undefined;
  const config = base ? lireConfigRelais(base) : undefined;
  const moi = base ? identifiantAppareil(new DepotParametres(base), PARAMETRES.identifiantAppareil) : '';

  // Le relais sert aussi de passerelle vers Yahoo pour le site de secours.
  useEffect(() => {
    definirRelaisActif(config ? { relais: config.relais, jeton: config.jeton } : undefined);
  }, [config?.relais, config?.jeton]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relais déjà connu : installé par le script sur le PC, ou apporté par le
  // QR code (lien du site, ou applibourse://liaison?code=… pour l'app iPhone).
  useEffect(() => {
    const pont = (globalThis as { applibourse?: PontRelais }).applibourse?.relais;
    let trouve = false;
    const chercher = () =>
      pont?.config?.()
        .then(liaison => {
          if (liaison) {
            trouve = true;
            setLiaisonDuPc(liaison);
          }
        })
        .catch(() => undefined);
    void chercher();
    // Relais installé pendant que l'application tourne : il apparaît seul.
    const minuterie = pont?.config ? setInterval(() => !trouve && void chercher(), 5_000) : undefined;
    const depuisLien = (url: string | null | undefined) => {
      const liaison = url ? decoderLiaison(url) : undefined;
      if (liaison) {
        setLiaisonDuPc(liaison);
      }
    };
    Linking.getInitialURL?.().then(depuisLien).catch(() => undefined);
    const abonnement = Linking.addEventListener?.('url', ({ url }) => depuisLien(url));
    return () => {
      abonnement?.remove?.();
      if (minuterie) {
        clearInterval(minuterie);
      }
    };
  }, []);

  // Sur l'iPhone : date d'expiration de la signature, et rappels programmés.
  useEffect(() => {
    void expirationSignature().then(date => {
      expireLe.current = date;
      if (date) {
        setEtat(courant => ({ ...courant, expireLe: date }));
        void programmerRappelsExpiration(date).catch(() => undefined);
      }
    });
  }, []);

  /**
   * Sur l'iPhone : nouvelle version JavaScript publiée avec le site ? Elle
   * est téléchargée, vérifiée, et s'appliquera à la prochaine ouverture.
   */
  const verifierMiseAJourDuSite = useCallback(async (): Promise<string | undefined> => {
    const site = lireConfigRelais(session.base())?.site;
    if (plateforme !== 'ios' || !site || Date.now() - derniereVerificationMaj.current < INTERVALLE_MAJ_MS) {
      return undefined;
    }
    derniereVerificationMaj.current = Date.now();
    const fichiers = systemeDepuisRnfs(chargerModule<unknown>('react-native-fs').module);
    if (!fichiers) {
      return undefined;
    }
    try {
      const resultat = await telechargerMiseAJour({ site, gestionnaire: new GestionnaireMiseAJour(fichiers), fichiers });
      return resultat.etat === 'installee'
        ? `🆕 Nouvelle version téléchargée${resultat.notes ? ` (${resultat.notes})` : ''} : fermez et rouvrez l’application pour l’avoir.`
        : undefined;
    } catch {
      return undefined;
    }
  }, [session, plateforme]);

  const tour = useCallback(async (raison?: RaisonTour): Promise<IssueTour> => {
    if (!deverrouille || enCours.current || !lireConfigRelais(session.base())) {
      return true;
    }
    enCours.current = true;
    setEtat(courant => ({ ...courant, enCours: true }));
    let reussi = false;
    let rappelerDans: number | undefined;
    try {
      const resultat = await synchroniser({
        force: raison === 'manuel',
        pilote: session.base(),
        appareil: identifiantAppareil(new DepotParametres(session.base()), PARAMETRES.identifiantAppareil),
        moi: { plateforme, expireLe: expireLe.current },
        // Déposé pour qu'un nouvel appareil puisse se « Lier » avec le même compte.
        coffre: session.coffreActuel(),
      });
      const changes = resultat.bilan.ajoutes + resultat.bilan.modifies + resultat.bilan.supprimes;
      if (changes > 0) {
        rafraichir();
        apresReceptionRef.current?.();
      }
      const nouvelleVersion = await verifierMiseAJourDuSite();
      reussi = true;
      rappelerDans = resultat.differeDans;
      setEtat(courant => ({
        ...courant,
        erreur: resultat.erreurs[0],
        maj: nouvelleVersion ?? courant.maj,
        recus: (courant.recus ?? 0) + (changes > 0 ? 1 : 0),
        message:
          changes > 0
            ? `${changes} changement${changes > 1 ? 's' : ''} reçu${changes > 1 ? 's' : ''} des autres appareils.`
            : courant.message,
      }));
    } catch (erreur) {
      setEtat(courant => ({ ...courant, erreur: erreur instanceof Error ? erreur.message : String(erreur) }));
    } finally {
      enCours.current = false;
      setEtat(courant => ({ ...courant, enCours: false, premierTourFait: true }));
      setVersion(v => v + 1);
    }
    return { ok: reussi, rappelerDans };
  }, [deverrouille, session, plateforme, rafraichir, verifierMiseAJourDuSite]);

  const tourRef = useRef(tour);
  tourRef.current = tour;
  const apresReceptionRef = useRef(apresReception);
  apresReceptionRef.current = apresReception;
  const planificateur = useRef<Planificateur | undefined>(undefined);

  useEffect(() => {
    if (!deverrouille || !config) {
      return;
    }
    const plan = new Planificateur(raison => tourRef.current(raison));
    planificateur.current = plan;
    plan.demarrer();
    // Sécurité : sans réponse rapide (relais lent), le devblog et le reste ne restent pas en attente.
    const garde = setTimeout(() => setEtat(courant => ({ ...courant, premierTourFait: true })), 8_000);

    // Retour au premier plan (natif) ; en quittant, on dépose tout de suite.
    const abonnement = AppState.addEventListener?.('change', statut => {
      if (statut === 'active') {
        plan.retourPremierPlan();
      } else {
        void plan.demander('premier-plan');
      }
    });
    // Toute écriture dans une donnée partagée planifie un tour (regroupées sur ~3 s).
    const ecoute = session.surEcriture?.(() => plan.modification());

    const { cible, document } = navigateur();
    const vidageFermeture = () => {
      deposerAvantFermeture({
        pilote: session.base(),
        appareil: identifiantAppareil(new DepotParametres(session.base()), PARAMETRES.identifiantAppareil),
        moi: { plateforme, expireLe: expireLe.current },
      });
    };
    const surVisibilite = () => {
      if (document?.visibilityState === 'visible') {
        plan.retourPremierPlan();
      } else {
        vidageFermeture();
      }
    };
    const surEnLigne = () => {
      setEnLigne(true);
      plan.enLigne();
    };
    const surHorsLigne = () => setEnLigne(false);
    cible?.addEventListener?.('online', surEnLigne);
    cible?.addEventListener?.('offline', surHorsLigne);
    cible?.addEventListener?.('pagehide', vidageFermeture);
    cible?.addEventListener?.('focus', surVisibilite);
    document?.addEventListener?.('visibilitychange', surVisibilite);
    return () => {
      clearTimeout(garde);
      setEtat(courant => ({ ...courant, premierTourFait: false }));
      plan.arreter();
      abonnement?.remove?.();
      ecoute?.();
      cible?.removeEventListener?.('online', surEnLigne);
      cible?.removeEventListener?.('offline', surHorsLigne);
      cible?.removeEventListener?.('pagehide', vidageFermeture);
      cible?.removeEventListener?.('focus', surVisibilite);
      document?.removeEventListener?.('visibilitychange', surVisibilite);
      if (planificateur.current === plan) {
        planificateur.current = undefined;
      }
    };
  }, [deverrouille, Boolean(config)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bouton « Synchroniser maintenant » : passe par le planificateur (un seul tour à la fois).
  const synchroniserMaintenant = useCallback(async () => {
    if (planificateur.current) {
      await planificateur.current.manuel();
    } else {
      await tourRef.current('manuel');
    }
  }, []);

  /**
   * Relie cet appareil : la clé de synchronisation est tirée de la clé
   * maîtresse du coffre, commune à tous les appareils liés — pas d'autre mot
   * de passe à retenir.
   */
  const relier = useCallback(
    async (code: string, nom: string) => {
      const liaison = decoderLiaison(code);
      if (!liaison) {
        throw new Error('Code de liaison illisible : recopiez-le depuis le PC (il commence par AB1.).');
      }
      await testerLiaison(liaison);
      ecrireConfigRelais(session.base(), {
        ...liaison,
        cle: session.cleDerivee('synchro'),
        nom: nom.trim() || nomParDefaut(plateforme),
      });
      setEtat(courant => ({ ...courant, message: 'Appareil relié.', erreur: undefined }));
      setVersion(v => v + 1);
    },
    [session, plateforme],
  );

  /**
   * À chaque ouverture : la clé suit le coffre (ancienne clé tirée d'un mot
   * de passe de synchronisation → remplacée), et un appareil qui connaît le
   * relais (script du PC, lien scanné, « Lier ») mais dont la configuration
   * s'est perdue se relie tout seul. C'est ce qui garde le téléphone relié.
   */
  useEffect(() => {
    if (!deverrouille) {
      return;
    }
    const pilote = session.base();
    const cle = session.cleDerivee('synchro');
    const actuelle = lireConfigRelais(pilote);
    if (actuelle && actuelle.cle !== cle) {
      ecrireConfigRelais(pilote, { ...actuelle, cle });
      const parametres = new DepotParametres(pilote);
      const suivi = lireEtatSynchro(pilote);
      parametres.ecrire(PARAMETRES.etatSynchro, JSON.stringify({ ...suivi, dernierEnvoi: undefined, lus: {} }));
      setVersion(v => v + 1);
      return;
    }
    const connue = liaisonDuPc ?? decoderLiaison(liaisonEnAttente() ?? '');
    if (!actuelle && connue) {
      ecrireConfigRelais(pilote, { ...connue, cle, nom: nomParDefaut(plateforme) });
      setEtat(courant => ({ ...courant, message: 'Appareil relié automatiquement.' }));
      setVersion(v => v + 1);
    }
  }, [deverrouille, session, liaisonDuPc, plateforme]);

  const delier = useCallback(() => {
    ecrireConfigRelais(session.base(), undefined);
    setEtat({ enCours: false, premierTourFait: true, recus: 0, message: 'Synchronisation désactivée sur cet appareil.' });
    setVersion(v => v + 1);
  }, [session]);

  const oublier = useCallback(
    async (autre: string) => {
      await oublierAppareil(session.base(), autre);
      setVersion(v => v + 1);
    },
    [session],
  );

  const suivi = base ? lireEtatSynchro(base) : undefined;
  const vue: EtatSynchroApp = {
    ...etat,
    configure: Boolean(config),
    nom: config?.nom,
    liaison: config ? { relais: config.relais, jeton: config.jeton, site: config.site } : undefined,
    derniere: suivi?.derniereSynchro,
    enAttente: suivi?.enAttente,
    enLigne,
    appareils: suivi?.appareils ?? {},
    moi,
    plateforme,
  };
  void version;

  return { synchro: vue, liaisonDuPc, plateforme, relier, delier, oublier, synchroniserMaintenant };
}
