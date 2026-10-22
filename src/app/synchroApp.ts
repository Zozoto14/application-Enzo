/**
 * Synchronisation automatique avec le serveur. Relais version 9 : le COFFRE
 * SERVEUR du compte est la référence (src/sync/relais/coffreServeur.ts), pour
 * le Fondateur comme pour chaque ami ; relais plus ancien : l'ancienne boîte
 * par appareil (Fondateur seulement). Un tour part : à l'ouverture (après
 * déverrouillage), au retour au premier plan, quand le réseau revient, ~150 ms
 * après une modification locale (envoi seul, une requête), dès que le serveur
 * annonce une révision plus récente (version 10 : flux SSE, attente longue ou
 * sondage, voir sync/relais/veille.ts), et en filet toutes les 3 min (30 s sans
 * avis). À la fermeture de la page, la file part en `fetch` keepalive. Après un
 * échec, nouvel essai à 1 s, 3 s, 10 s, 30 s, 2 min puis 5 min.
 *
 * Sorti d'App.tsx pour qu'on puisse le lire d'un seul tenant.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { expirationSignature, programmerRappelsExpiration } from '../natif/signature';
import type { Session } from '../session/session';
import { identifiantAppareil } from '../sync/identite';
import { decoderLiaison, type Liaison } from '../sync/relais/liaison';
import { estMaitre } from '../sync/relais/portees';
import type { EnAttente, InfoAppareil } from '../sync/relais/moteur';
import { INTERVALLE_AVEC_AVIS_MS, INTERVALLE_SYNCHRO_MS, Planificateur, type IssueTour, type RaisonTour } from '../sync/relais/planificateur';
import { Veilleur, type ModeVeille } from '../sync/relais/veille';
import {
  deposerAvantFermeture,
  ecrireConfigRelais,
  lireConfigRelais,
  lireEtatSynchro,
  oublierAppareil,
  synchroniser,
  testerLiaison,
} from '../sync/relais/synchroniser';
import { definirRelaisActif, liaisonEnAttente, relaisDuCompte } from '../sync/relais/actif';
import { capacitesCoffre, capacitesConnues, envoyerAvantFermeture, synchroniserServeur, type EtatServeur } from '../sync/relais/coffreServeur';
import { deposerCoffreSiChange } from '../sync/relais/synchroniser';
import { compteDeLiaison } from '../sync/relais/portees';
import { chargerModule } from '../natif/modules';
import { cachesSynchro } from '../sync/relais/caches';
import {
  PROFIL_DEMARRAGE,
  integrerEntrant,
  modeServeur,
  noterEtatDemarrage,
  noterModeServeur,
  noterLus,
  preparerSortant,
  signalerDeverrouillage,
} from '../sync/relais/prechargement';
import { profilCourant } from '../profils/espace';
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
  /** Comment cet appareil apprend les changements des autres (version 10) ; absent : tour périodique seul. */
  veille?: ModeVeille;
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
  admin = true,
}: {
  session: Session;
  deverrouille: boolean;
  rafraichir(): void;
  /** Après un tour qui a reçu des changements : recharger thème, préférences du hub… */
  apresReception?(): void;
  /** Compte qui synchronise (l'administrateur) : fusion du cache `entrant` au déverrouillage. */
  admin?: boolean;
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
    // App iPhone native : lien applibourse://liaison?code=… (ancien parcours, gardé tant que l'app native n'a pas
    // l'écran de connexion). Sur le site et le PC (version 9) : plus de code de liaison lu dans l'adresse.
    const natif = Platform.OS !== 'web';
    if (natif) Linking.getInitialURL?.().then(depuisLien).catch(() => undefined);
    const abonnement = natif ? Linking.addEventListener?.('url', ({ url }) => depuisLien(url)) : undefined;
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
      const pilote = session.base();
      const config = lireConfigRelais(pilote)!;
      const compte = profilCourant();
      const appareil = identifiantAppareil(new DepotParametres(pilote), PARAMETRES.identifiantAppareil);
      let resultat: { bilan: { ajoutes: number; modifies: number; supprimes: number }; erreurs: string[]; differeDans?: number; recus?: number };
      const capacites = await capacitesCoffre(config);
      if (capacites.coffre) {
        // Le serveur est la référence. Après une modification ici : la file part d'abord (une requête) ;
        // sinon (ouverture, avis d'un autre appareil, filet) : tirer les différences, puis pousser.
        resultat = await synchroniserServeur({
          pilote,
          liaison: config,
          cle: config.cle,
          compte,
          appareil,
          api: capacites.v10 ? 10 : 9,
          pousserDabord: raison === 'modification',
          revConnue: revAnnoncee.current,
        });
        noterModeServeur();
        avisDisponibles.current = capacites.avis;
        if (compte === 'principal') {
          // Le coffre (enveloppes du mot de passe) reste publié : un navigateur neuf s'y connecte.
          await deposerCoffreSiChange(pilote, config, session.coffreActuel()).catch(() => undefined);
        }
      } else if (compte === 'principal') {
        resultat = await synchroniser({
          force: raison === 'manuel',
          pilote,
          appareil,
          moi: { plateforme, expireLe: expireLe.current },
          // Déposé pour qu'un nouvel appareil puisse se « Lier » avec le même compte.
          coffre: session.coffreActuel(),
        });
      } else {
        return true;
      }
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
            ? `${changes} changement${changes > 1 ? 's' : ''} reçu${changes > 1 ? 's' : ''} du serveur.`
            : courant.message,
      }));
    } catch (erreur) {
      setEtat(courant => ({ ...courant, erreur: erreur instanceof Error ? erreur.message : String(erreur) }));
    } finally {
      enCours.current = false;
      setEtat(courant => ({ ...courant, enCours: false, premierTourFait: true }));
      setVersion(v => v + 1);
      // Ce qui n'a pas pu partir est scellé dans `sortant` : le prochain démarrage le poussera sans clé.
      apresTourRef.current(reussi);
    }
    return { ok: reussi, rappelerDans };
  }, [deverrouille, session, plateforme, rafraichir, verifierMiseAJourDuSite]);

  const tourRef = useRef(tour);
  tourRef.current = tour;
  /** Dernière révision annoncée par le serveur (avis), et le serveur sait-il en envoyer ? */
  const revAnnoncee = useRef<number | undefined>(undefined);
  const avisDisponibles = useRef(false);

  /** Caches du démarrage (voir sync/relais/prechargement.ts) : `sortant` prêt, `lus` recopiés. */
  const preparerCaches = useCallback(() => {
    try {
      const pilote = session.base();
      if (!lireConfigRelais(pilote)) {
        return;
      }
      const appareil = identifiantAppareil(new DepotParametres(pilote), PARAMETRES.identifiantAppareil);
      const profil = profilCourant();
      void preparerSortant({ pilote, appareil, profil, moi: { plateforme, expireLe: expireLe.current } }).catch(() => undefined);
      void noterLus({ pilote, appareil, profil }).catch(() => undefined);
    } catch {
      // Session déjà verrouillée.
    }
  }, [session, plateforme]);
  const apresTourRef = useRef((reussi: boolean) => {
    void reussi;
  });
  apresTourRef.current = (reussi: boolean) => {
    preparerCaches();
    if (reussi && profilCourant() === PROFIL_DEMARRAGE) {
      noterEtatDemarrage({ le: new Date().toISOString() });
    }
  };
  const adminRef = useRef(admin);
  adminRef.current = admin;

  /**
   * Au déverrouillage, AVANT la première image : les dépôts reçus pendant que
   * l'appareil était verrouillé (cache `entrant`, chiffré) sont ouverts et
   * fusionnés tout de suite ; le tour réseau habituel suit. Au verrouillage,
   * ce qui n'est pas parti est scellé dans `sortant`.
   */
  useEffect(() => {
    const integrer = (): number => {
      const pilote = session.base();
      const appareil = identifiantAppareil(new DepotParametres(pilote), PARAMETRES.identifiantAppareil);
      const resultat = integrerEntrant({ pilote, appareil, profil: profilCourant() });
      const changes = resultat.bilan.ajoutes + resultat.bilan.modifies + resultat.bilan.supprimes;
      if (changes > 0) {
        setEtat(courant => ({
          ...courant,
          recus: (courant.recus ?? 0) + 1,
          message: `${changes} changement${changes > 1 ? 's' : ''} reçu${changes > 1 ? 's' : ''} des autres appareils.`,
        }));
      }
      return changes;
    };
    const desabonner = session.surOuverture?.(() => {
      signalerDeverrouillage(true);
      if (!adminRef.current || !lireConfigRelais(session.base())) {
        return;
      }
      const profil = profilCourant();
      if (cachesSynchro().charge(profil)) {
        integrer();
        return;
      }
      // Caches pas encore lus du disque : fusion dès qu'ils le sont, puis l'affichage se recharge.
      void cachesSynchro()
        .charger(profil)
        .then(() => {
          if (session.statut() === 'deverrouille' && integrer() > 0) {
            rafraichir();
            apresReceptionRef.current?.();
          }
        })
        .catch(() => undefined);
    });
    const desabonnerFermeture = session.surFermeture?.(() => {
      if (adminRef.current) {
        preparerCaches();
      }
      signalerDeverrouillage(false);
    });
    return () => {
      desabonner?.();
      desabonnerFermeture?.();
    };
  }, [session, rafraichir, preparerCaches]);
  const apresReceptionRef = useRef(apresReception);
  apresReceptionRef.current = apresReception;
  const planificateur = useRef<Planificateur | undefined>(undefined);

  useEffect(() => {
    if (!deverrouille || !config) {
      return;
    }
    // Veille des avis du serveur (version 10) : démarrée après le premier tour qui confirme les avis,
    // seulement page visible (une connexion tenue de moins quand l'onglet est masqué).
    let veille: Veilleur | undefined;
    const pageVisible = () => (navigateur().document?.visibilityState ?? 'visible') !== 'hidden';
    const arreterVeille = () => {
      veille?.arreter();
      veille = undefined;
    };
    const demarrerVeille = () => {
      if (veille || !avisDisponibles.current || !pageVisible()) return;
      let conf: ReturnType<typeof lireConfigRelais>;
      try {
        conf = lireConfigRelais(session.base());
      } catch {
        return;
      }
      if (!conf) return;
      const v = new Veilleur({
        liaison: { relais: conf.relais, jeton: conf.jeton },
        compte: profilCourant(),
        revConnue: () => {
          try {
            return Math.max((lireEtatSynchro(session.base()) as EtatServeur).serveur?.rev ?? 0, revAnnoncee.current ?? 0);
          } catch {
            return Number.MAX_SAFE_INTEGER; // Verrouillé : rien à tirer.
          }
        },
        surVersion: rev => {
          revAnnoncee.current = Math.max(revAnnoncee.current ?? 0, rev);
          plan.notification();
        },
        surMode: mode => setEtat(courant => (courant.veille === mode ? courant : { ...courant, veille: mode })),
      });
      veille = v;
      v.demarrer();
    };
    const plan = new Planificateur(async raison => {
      const issue = await tourRef.current(raison);
      // Avis du serveur disponibles : le tour périodique n'est plus qu'un filet (3 min).
      plan.definirIntervalle(avisDisponibles.current ? INTERVALLE_AVEC_AVIS_MS : INTERVALLE_SYNCHRO_MS);
      if (avisDisponibles.current) demarrerVeille();
      return issue;
    });
    planificateur.current = plan;
    plan.demarrer();
    // Sécurité : sans réponse rapide (relais lent), le devblog et le reste ne restent pas en attente.
    const garde = setTimeout(() => setEtat(courant => ({ ...courant, premierTourFait: true })), 8_000);

    // Retour au premier plan (natif) ; en quittant, on dépose tout de suite.
    const abonnement = AppState.addEventListener?.('change', statut => {
      if (statut === 'active') {
        plan.retourPremierPlan();
        demarrerVeille();
      } else {
        arreterVeille();
        void plan.demander('premier-plan');
      }
    });
    // Toute écriture dans une donnée partagée planifie un tour (regroupées sur ~3 s),
    // et l'enveloppe `sortant` est rescellée peu après (hors ligne, elle attendra le prochain démarrage).
    let minuterieSortant: ReturnType<typeof setTimeout> | undefined;
    const ecoute = session.surEcriture?.(() => {
      plan.modification();
      if (minuterieSortant) clearTimeout(minuterieSortant);
      minuterieSortant = setTimeout(() => preparerCaches(), 2_000);
    });

    const { cible, document } = navigateur();
    const vidageFermeture = () => {
      preparerCaches();
      // Coffre serveur : la file reste dans la base (elle repartira au prochain tour) ET part tout de
      // suite en `fetch` keepalive, qui survit à la fermeture de l'onglet.
      if (modeServeur()) {
        try {
          const pilote = session.base();
          const conf = lireConfigRelais(pilote);
          const caps = conf ? capacitesConnues(conf.relais) : undefined;
          if (conf && caps?.coffre) envoyerAvantFermeture({ pilote, liaison: conf, cle: conf.cle, compte: profilCourant(), api: caps.v10 ? 10 : 9 });
        } catch {
          // Session déjà verrouillée.
        }
        return;
      }
      deposerAvantFermeture({
        pilote: session.base(),
        appareil: identifiantAppareil(new DepotParametres(session.base()), PARAMETRES.identifiantAppareil),
        moi: { plateforme, expireLe: expireLe.current },
      });
    };
    const surVisibilite = () => {
      if (document?.visibilityState === 'visible') {
        plan.retourPremierPlan();
        demarrerVeille();
      } else {
        arreterVeille();
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
      if (minuterieSortant) clearTimeout(minuterieSortant);
      setEtat(courant => ({ ...courant, premierTourFait: false, veille: undefined }));
      arreterVeille();
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
      if (!estMaitre(liaison)) {
        throw new Error('Ce code est celui d’un compte d’ami : il ne relie que ce compte (écran de connexion), pas la synchronisation de l’administrateur.');
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
    const compte = profilCourant();
    // Fondateur : liaison du PC (jeton maître) ou du navigateur (session ouverte par son mot de passe).
    // Ami (version 9) : la liaison de SON compte (jeton de profil), gardée par le navigateur.
    const duCompte = relaisDuCompte();
    const connue =
      compte === 'principal'
        ? liaisonDuPc ?? decoderLiaison(liaisonEnAttente() ?? '')
        : duCompte && (compteDeLiaison(duCompte) === compte || estMaitre(duCompte))
          ? duCompte
          : undefined;
    const valable = connue && (compte === 'principal' ? estMaitre(connue) : true);
    if (!actuelle && valable) {
      ecrireConfigRelais(pilote, { ...connue, cle, nom: nomParDefaut(plateforme) });
      setEtat(courant => ({ ...courant, message: 'Connecté au serveur.' }));
      setVersion(v => v + 1);
    } else if (actuelle && valable && !liaisonDuPc && connue.relais === actuelle.relais && connue.jeton !== actuelle.jeton) {
      // Nouvelle connexion sur ce navigateur (nouvelle session) : le jeton retenu suit.
      ecrireConfigRelais(pilote, { ...actuelle, jeton: connue.jeton });
      setVersion(v => v + 1);
    }
  }, [deverrouille, session, liaisonDuPc, plateforme]);

  const delier = useCallback(() => {
    ecrireConfigRelais(session.base(), undefined);
    // Plus de relais : les enveloppes en attente ne concernent plus cet appareil.
    void cachesSynchro().vider(profilCourant());
    if (profilCourant() === PROFIL_DEMARRAGE) {
      noterEtatDemarrage({ le: undefined, recus: 0, aEnvoyer: 0 });
    }
    setEtat({ enCours: false, premierTourFait: true, recus: 0, message: 'Synchronisation désactivée sur cet appareil.' });
    setVersion(v => v + 1);
  }, [session]);

  const oublier = useCallback(
    async (autre: string) => {
      await oublierAppareil(session.base(), autre);
      // Appareil oublié : son enveloppe en attente (cache `entrant`) part aussi.
      const caches = cachesSynchro();
      const profil = profilCourant();
      await caches.charger(profil);
      const entrant = caches.entrant(profil);
      if (autre in entrant.elements) {
        const elements = { ...entrant.elements };
        delete elements[autre];
        await caches.ecrireEntrant(profil, { ...entrant, elements });
      }
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
