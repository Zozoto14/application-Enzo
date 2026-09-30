/**
 * Assemblage de l'application.
 *
 * Aiguille entre les écrans selon l'état de la session, et fait le lien entre
 * l'interface et les couches métier. Les dépendances sont injectées : les
 * tests montent l'application complète avec un SQLite de test, et l'appareil
 * y branchera op-sqlite sans que ce fichier change.
 *
 * Un détail d'exécution qui n'en est pas un : la dérivation Argon2id bloque le
 * fil JavaScript pendant près d'une seconde. Chaque appel est donc différé
 * d'un tour de boucle, le temps que l'indicateur d'attente s'affiche. Sans ce
 * report, l'écran resterait figé sans rien montrer, puis sauterait d'un coup
 * au tableau de bord.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Linking, StatusBar, Text, View } from 'react-native';
// SafeAreaView de react-native est deprecie ; celui de safe-area-context gere
// en plus l'encoche et la barre de geste, et etait deja une dependance.
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import type { Compte, Titre, Transaction } from '../core/domain/types';
import {
  transactionsDeReprise,
  type PositionImportee,
} from '../core/import/positions';
import {
  chargerEtat,
  DepotComptes,
  DepotCours,
  DepotParametres,
  DepotTitres,
  DepotTransactions,
  DepotWatchlist,
  PARAMETRES,
} from '../db/depots';
import { FOURNISSEURS, fournisseurParId } from '../cours/fournisseurs';
import { rafraichirCours, resumeRafraichissement } from '../cours/rafraichir';
import { ErreurDeverrouillage } from '../securite/coffre';
import { ErreurTemporisation, Session } from '../session/session';
import { construireDashboard, type VueDashboard } from '../ui/vues/dashboard';
import { anneesDisponibles, construireRapportAnnuel } from '../rapport/annuel';
import { ecrireRapport } from '../rapport/fichiers';
import { Decimal } from '../core/money/decimal';
import { totaux, valoriserPositions } from '../core/portfolio/valorisation';
import { creerGenerateurId, identifiantAppareil } from '../sync/identite';
import { chargerHistoriques, resumeHistorique } from '../cours/historique';
import {
  INDICE_DEFAUT,
  INDICES,
  PREFIXE_INDICE,
  indiceParId,
  plagePour,
  separerHistorique,
} from '../cours/indices';
import { rejouer } from '../core/portfolio/engine';
import { resoudreSymboles } from '../cours/resolution';
import { intervalleActualisation, seanceEnCours } from '../cours/marche';
import { construireResume } from '../ui/vues/resume';
import { chargerValeur, type DonneesValeur } from '../fondamentaux/yahoo';
import { construireFiche, type VueFiche } from '../ui/vues/fiche';
import { FicheValeur } from '../ui/ecrans/FicheValeur';
import { definirDiscretion } from '../ui/discretion';
import { Coque, type Destination } from '../ui/Navigation';
import type { OngletPortefeuille } from '../ui/ecrans/Portefeuille';
import { ComparateurFinancier } from '../ui/ecrans/ComparateurFinancier';
import { SOCIETES_MAXIMUM } from '../ui/vues/comparaisonFinanciere';
import { chercherSymboles, type CandidatSymbole } from '../cours/symboles';
import { Comparateur } from '../ui/ecrans/Comparateur';
import { Podcast } from '../ui/ecrans/Podcast';
import { LecteurFlottant } from '../ui/lecturePodcast';
import { lecturePartagee } from '../podcast/lecture';
import { Objectifs } from '../ui/ecrans/Objectifs';
import { objectifDepuisJson } from '../ui/vues/objectifs';
import { preparerEpisode } from '../podcast/donnees';
import type { Episode } from '../podcast/episode';
import { chargerActualites } from '../fondamentaux/actualites';
import { construireComparateur } from '../ui/vues/comparateur';
import { Projection } from '../ui/ecrans/Projection';
import { Symboles } from '../ui/ecrans/Symboles';
import { Watchlist } from '../ui/ecrans/Watchlist';
import { Recuperation } from '../ui/ecrans/Recuperation';
import { ACCUEIL_BAGGR } from '../ui/vues/liens';
import { Recherche } from '../ui/ecrans/Recherche';
import { Screener } from '../ui/ecrans/Screener';
import { Carnet } from '../ui/ecrans/Carnet';
import { Diagnostic } from '../ui/ecrans/Diagnostic';
import { Journal } from '../ui/ecrans/Journal';
import { construireJournal } from '../ui/vues/journal';
import { testsDuBureau } from '../diagnostic/testsBureau';
import { convertisseur, installerConvertisseur } from '../cours/change';
import { ETAPES_VISITE, VisiteGuidee, etapesNouvelles, marquerVues, type EtapeVisite } from '../ui/VisiteGuidee';
import { dateSaisie, reglageVersementDepuisJson } from '../ui/vues/versementMensuel';
import type { FormulaireOperation } from '../ui/vues/saisie';
import { CLE_PLANNING_LOCAL, stockageLocal, useNotificationsBureau } from './notificationsBureau';
import { useSauvegardes } from './sauvegardesApp';
import { nomParDefaut, useSynchro } from './synchroApp';
import { decoderLiaison, encoderLiaison } from '../sync/relais/liaison';
import { definirLiaisonEnAttente, liaisonEnAttente } from '../sync/relais/actif';
import { recupererCoffre } from '../sync/relais/synchroniser';
import type { Coffre } from '../securite/coffre';
import { CarteSynchro } from '../ui/ecrans/CarteSynchro';
import { CarteProfils, type ControleProfils } from '../ui/ecrans/CarteProfils';
import { Hub } from '../hub/Hub';
import { BarreApp, BarreAppContexte } from '../hub/BarreApp';
import { IndicateurSynchro, type SynchroHub } from '../hub/IndicateurSynchro';
import { PageParametres } from '../hub/PageParametres';
import { useMiseAJour } from '../hub/ParametresHub';
import {
  BandeauConfidentialite,
  BandeauRole,
  ReglageAdminPanel,
  ReglageCompte,
  ReglageCoffre,
  ReglageLangue,
  ReglageMiseAJour,
  ReglageNouveautes,
  ReglageTheme,
  ReglageTuiles,
  ReglageVersion,
  ReglagesAdministration,
} from '../hub/ReglagesHub';
import type { IdReglage, IdSection } from '../hub/recensement';
import { CLE_CACHE_AFFICHAGE, lireAffichageMemorise, memoriserAffichage, migrerThemeUnique, stockageLocalAppareil } from '../hub/themeUnique';
import { GardeErreur } from '../ui/GardeErreur';
import { appsVisibles, etatTuile, peutOuvrir } from '../hub/permissions';
import { niveauProfil } from '../hub/admin/comptes';
import { chargerPrefs, enregistrerPrefs, reinitialiser, CLE_THEME, type PrefsHub } from '../hub/personnalisation';
import { Devblog } from '../hub/devblog/Devblog';
import { CLE_DEVBLOG, lireEtat as lireEtatDevblog, decider as deciderDevblog, etapesVisite as etapesDevblog, marquerLues as marquerDevblogLu } from '../hub/devblog/logiqueDevblog';
import type { CibleEssai, EntreeDevblog } from '../hub/devblog/entrees';
import { ID_PORTEFEUILLE, REGISTRE } from '../hub/registre';
import { ReglageCleTmdb, ReglageLectureTsuzuku } from '../tsuzuku/app/ParametresTsuzuku';
import { resumerBibliotheque } from '../tsuzuku/app/resume';
import { CLES as CLES_TSUZUKU, type BasePrefs } from '../tsuzuku/plateforme/stockage';
import { themeHub, type IdThemeHub } from '../hub/themes';
import type { ContexteHub, ResumePortefeuille, ServicesAdmin } from '../hub/types';
import { ecouterTouche, octetsUtf8, telechargerWeb } from '../hub/web';
import { dividendesParTitre, lignesCibles, lignesVendables } from './calculs';
import { exporterExcel } from '../rapport/exportExcel';
import { carnetDepuisJson, construireCarnet } from '../ui/vues/carnet';
import { simulerToutSurIndice } from '../ui/vues/siIndice';
import { lireScreener, requeteScreener, type CleCategorie, type Region, type TriScreener } from '../fondamentaux/screener';
import { ajouterHistorique, historiqueDepuisJson } from '../ui/vues/historiqueRecherche';
import { chargerTheses, type ValeurCherchee } from '../fondamentaux/theses';
import { construireWatchlist } from '../ui/vues/watchlist';
import { construireComparaison } from '../ui/vues/comparaison';
import {
  CHAMPS_DEFAUT,
  construireProjection,
  type ChampsProjection,
} from '../ui/vues/projection';
import { construireDividendes } from '../ui/vues/dividendes';
import { construireRisque } from '../ui/vues/risque';
import {
  construireFlux,
  construireImpots,
  construirePerformance,
} from '../ui/vues/onglets';
import { serieValorisation } from '../core/performance/serie';
import { AUCUN_INDICE, Portefeuille, TOUS_LES_COMPTES } from '../ui/ecrans/Portefeuille';
import { CreationCompte } from '../ui/ecrans/CreationCompte';
import { CreationTitre } from '../ui/ecrans/CreationTitre';
import { Deverrouillage } from '../ui/ecrans/Deverrouillage';
import { ImportPositions } from '../ui/ecrans/ImportPositions';
import {
  ReglageCodes,
  ReglageDiscretion,
  ReglageExport,
  ReglageFournisseur,
  ReglageHistorique,
  ReglageIntervalle,
  ReglagePodcast,
  ReglageSymboles,
  ReglageVisite,
} from '../ui/ecrans/CartesReglages';
import { ReglageSauvegardeAuto, Sauvegarde } from '../ui/ecrans/Sauvegarde';
import { Notifications, type SeuilAffiche } from '../ui/ecrans/Notifications';
import {
  planningDepuisJson,
  planningVersJson,
  prochainBriefing,
  type Planning,
} from '../notifications/planification';
import { oublierBriefingsModifies } from '../notifications/reveil';
import { lireDestination } from '../notifications/destinations';
import { composerBriefing } from '../notifications/briefing';
import {
  etatDepuisJson,
  seuilVariation,
  type PontNotifications,
} from '../notifications/bureau';
import { chargerModule } from '../natif/modules';
import { gestionnaireDepuisFs } from '../maj/application';
import { supprimerSauvegarde } from '../sauvegarde/fichiers';
import { SaisieOperation } from '../ui/ecrans/SaisieOperation';
import {
  PremierLancement,
  type SecretsInitiaux,
} from '../ui/ecrans/PremierLancement';
import { cleLocale } from '../profils/espace';
import { ESPACEMENT, definirTheme, palettePour, stylesPartages, themeCourant } from '../ui/theme';
import { Bouton, Carte } from '../ui/composants';
import { formaterMontant } from '../ui/format';

export interface AppProps {
  session: Session;
  /** Injectable pour rendre les identifiants déterministes dans les tests. */
  genererId?(prefixe: string): string;
  /** Date du jour, injectable de même. */
  aujourdhui?(): string;
  /**
   * Charge l'historique des cours au déverrouillage, une fois par jour.
   * Désactivé par défaut : les tests ne doivent pas appeler le réseau.
   */
  chargementAutomatique?: boolean;
  /** Profils de l'appareil (bureau, site) : absent, un seul utilisateur. */
  profils?: ControleProfils;
  /**
   * Hub : après le déverrouillage, une grille d'apps au lieu d'ouvrir
   * directement le portefeuille. Désactivé par défaut (tests, appareil).
   */
  hub?: boolean;
}

type Ecran =
  | 'tableau'
  | 'compte'
  | 'titre'
  | 'saisie'
  | 'import'
  | 'reglages'
  | 'sauvegarde'
  | 'notifications'
  | 'projection'
  | 'watchlist'
  | 'recherche'
  | 'screener'
  | 'carnet'
  | 'diagnostic'
  | 'journal'
  | 'symboles'
  | 'comparateur'
  | 'fiche'
  | 'podcast'
  | 'objectifs';


/** Frais d'ETF saisis ; une saisie illisible est ignorée (le taux connu s'applique). */
function fraisEtfSaisis(brut: string | undefined): Record<string, number> {
  let saisis: Record<string, string> = {};
  try {
    saisis = JSON.parse(brut ?? '{}');
  } catch {
    return {};
  }
  const frais: Record<string, number> = {};
  for (const [titreId, texte] of Object.entries(saisis)) {
    const taux = Number(String(texte).replace(',', '.'));
    if (String(texte).trim() !== '' && Number.isFinite(taux) && taux >= 0 && taux < 5) {
      frais[titreId] = taux;
    }
  }
  return frais;
}

/** Laisse React peindre avant un calcul qui bloque le fil. */
function apresRendu(action: () => void): void {
  setTimeout(action, 0);
}

/**
 * Metriques de repli quand l'appareil n'en fournit pas encore.
 *
 * Sans elles, SafeAreaProvider ne rend rien tant qu'il n'a pas mesure l'ecran :
 * l'application resterait blanche au premier rendu, et les tests ne verraient
 * jamais le moindre ecran.
 */
const METRIQUES_DE_REPLI = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/**
 * Delai avant de considerer le demarrage comme abouti.
 * Assez long pour couvrir le montage complet de l'interface, assez court pour
 * que l'utilisateur n'ait pas le temps de fermer l'application avant.
 */
const DELAI_CONFIRMATION_DEMARRAGE = 4000;

/**
 * Seuils d'alerte des titres detenus, prets a afficher.
 * Les alertes ne portent que sur les positions ouvertes : surveiller une
 * valeur qu'on ne detient pas releve de la watchlist, pas des alertes.
 */
/** Seuils enregistres, tolerants a un reglage illisible. */
function lireSeuils(session: Session): Record<string, { haut?: string; bas?: string }> {
  try {
    return JSON.parse(
      new DepotParametres(session.base()).lire(PARAMETRES.seuilsAlertes) ?? '{}',
    );
  } catch {
    // Un reglage corrompu ne doit pas priver de l'ecran entier.
    return {};
  }
}

/**
 * Valeurs sur lesquelles une alerte de cours a un sens : celles qu'on detient,
 * et celles qu'on surveille sans les detenir. Surveiller une valeur qu'on n'a
 * pas est precisement le cas ou l'alerte sert le plus.
 */
function seuilsAffiches(
  session: Session,
  contenu: { titres: readonly { id: string; nom: string }[]; etat: { positions: readonly { titreId: string }[] } },
): SeuilAffiche[] {
  const enregistres = lireSeuils(session);
  const concernes = new Set(contenu.etat.positions.map(position => position.titreId));
  for (const ligne of new DepotWatchlist(session.base()).lister()) {
    concernes.add(ligne.titreId);
  }

  return contenu.titres
    .filter(titre => concernes.has(titre.id))
    .map(titre => ({
      titreId: titre.id,
      nom: titre.nom,
      haut: enregistres[titre.id]?.haut ?? '',
      bas: enregistres[titre.id]?.bas ?? '',
    }));
}

function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Etat vide, quand la base n'est pas encore lisible. */
const ETAT_VIDE = {
  positions: [],
  positionsSoldees: [],
  cessions: [],
  comptes: new Map(),
};




export function App({ session, genererId, aujourdhui, chargementAutomatique = false, profils, hub = false }: AppProps) {
  // Profil d'ami : ni synchronisation ni liaison, réservées à l'administrateur.
  const estAdmin = profils?.actuel.admin ?? true;
  // Gestionnaire : un ami à l'Administration limitée (jamais en session administrateur sur son compte).
  const estGestionnaire = !estAdmin && profils?.actuel.role === 'gestionnaire' && !profils.sessionAdmin;
  const [rendu, forcerRendu] = useState(0);
  const [compteFiltre, setCompteFiltre] = useState<string>(TOUS_LES_COMPTES);
  // Retenu ici : revenir au portefeuille rouvre l'onglet qu'on avait quitté.
  const [ongletPortefeuille, setOngletPortefeuille] = useState<OngletPortefeuille>('resume');
  const [fiche, setFiche] = useState<
    { symbole: string; titreId?: string; vue?: VueFiche; chargement: boolean; erreur?: string } | undefined
  >();
  // Une fiche déjà ouverte se rouvre sans nouvel appel réseau pendant la session.
  const fichesEnCache = useRef(new Map<string, DonneesValeur>());
  const [secrets, setSecrets] = useState<SecretsInitiaux | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [ecran, setEcran] = useState<Ecran>('tableau');
  const [messageCours, setMessageCours] = useState<string | undefined>();
  const [coursEnCours, setCoursEnCours] = useState(false);
  const [messageRapport, setMessageRapport] = useState<string | undefined>();
  const [recherche, setRecherche] = useState<
    | {
        titreId: string;
        candidats: readonly CandidatSymbole[];
        avertissement?: string;
        enCours?: boolean;
      }
    | undefined
  >();
  const [erreurSymboles, setErreurSymboles] = useState<string | undefined>();
  const [compares, setCompares] = useState<readonly string[]>([]);
  const [messageHistorique, setMessageHistorique] = useState<string | undefined>();
  const [histoEnCours, setHistoEnCours] = useState(false);
  const [champsProjection, setChampsProjection] =
    useState<ChampsProjection>(CHAMPS_DEFAUT);
  const [messageNotifications, setMessageNotifications] = useState<string | undefined>();

  const rafraichir = useCallback(() => forcerRendu(n => n + 1), []);
  // Après un tour de synchro qui a reçu des changements : le hub relit thème, tuiles et nouveautés vues.
  const [versionSynchro, setVersionSynchro] = useState(0);
  const apresReception = useCallback(() => setVersionSynchro(n => n + 1), []);
  // Thème unique de toute l'application. Au démarrage : le dernier thème appliqué, lu de façon
  // synchrone dans le cache de l'appareil (l'écran de connexion est déjà au bon thème, sans
  // flash). Après déverrouillage : réconcilié avec la valeur du profil (voir plus bas).
  const [themeHubId, setThemeHubId] = useState<IdThemeHub>(() => themeCourant());
  const [parametres, setParametres] = useState<{ section?: IdSection; n: number } | undefined>();
  const ouvrirParametres = useCallback((section?: IdSection) => setParametres(precedent => ({ section, n: (precedent?.n ?? 0) + 1 })), []);

  /**
   * Confirme au code natif que ce demarrage a abouti.
   *
   * Sans cet appel, le marqueur pose avant de charger une mise a jour ne
   * serait jamais efface, et chaque redemarrage annulerait la mise a jour :
   * le filet de securite se retournerait contre l'application, qui resterait
   * eternellement sur son paquet d'origine.
   *
   * Differe de quelques secondes : un plantage survenant pendant le montage
   * initial doit encore declencher le retour arriere.
   */
  useEffect(() => {
    const gestionnaire = gestionnaireDepuisFs(
      chargerModule<unknown>('react-native-fs').module,
    );
    if (!gestionnaire) {
      return undefined;
    }
    const minuterie = setTimeout(() => {
      gestionnaire.confirmerDemarrage().catch(() => {
        // Un echec ici laisse le marqueur en place : la mise a jour sera
        // ecartee au prochain demarrage, ce qui est le comportement sur.
      });
    }, DELAI_CONFIRMATION_DEMARRAGE);

    return () => clearTimeout(minuterie);
  }, []);
  /**
   * Generateur d'identifiants de cette installation, cree au premier besoin.
   *
   * Il porte l'identifiant de l'appareil, qui vit dans la base chiffree : on
   * ne peut donc le lire qu'une fois deverrouille, d'ou la creation paresseuse.
   * Sans ce prefixe, deux operations differentes saisies dans la meme
   * milliseconde sur l'iPhone et sur l'iPad porteraient le meme identifiant,
   * et la fusion en supprimerait une sans rien dire.
   */
  const generateurLocal = useRef<((prefixe: string) => string) | undefined>(undefined);
  const identifiant = useCallback(
    (prefixe: string) => {
      if (genererId) {
        return genererId(prefixe);
      }
      if (!generateurLocal.current) {
        const parametres = new DepotParametres(session.base());
        generateurLocal.current = creerGenerateurId(
          identifiantAppareil(parametres, PARAMETRES.identifiantAppareil),
        );
      }
      return generateurLocal.current(prefixe);
    },
    [genererId, session],
  );

  const statut = session.statut();
  const deverrouille = statut === 'deverrouille' && !secrets;

  // Chaque déverrouillage est noté dans la liste des profils (date, compteur) :
  // l'Administration s'en sert pour la dernière activité et les alertes.
  const connexionNotee = useRef(false);
  const noterConnexionProfil = profils?.onConnexion;
  useEffect(() => {
    if (!deverrouille) {
      connexionNotee.current = false;
      return;
    }
    if (!connexionNotee.current) {
      connexionNotee.current = true;
      noterConnexionProfil?.();
    }
  }, [deverrouille, noterConnexionProfil]);

  // Taux de change du jour, pour afficher en euros les cours cotés ailleurs
  // (Varsovie, New York, Londres…). Seulement quand le réseau est permis.
  useState(() => {
    if (chargementAutomatique) {
      installerConvertisseur(url => fetch(url));
    }
    return true;
  });

  const executer = useCallback(
    (action: () => void) => {
      setErreur(undefined);
      setEnCours(true);
      apresRendu(() => {
        try {
          action();
        } catch (e) {
          // Le message vient de la couche session, qui ne distingue pas quel
          // facteur a échoué. L'interface ne doit pas en dire davantage.
          setErreur(
            e instanceof ErreurDeverrouillage || e instanceof ErreurTemporisation
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e),
          );
        } finally {
          setEnCours(false);
          rafraichir();
        }
      });
    },
    [rafraichir],
  );

  // Coffre créé pendant cette ouverture : premier lancement du profil (pas de devblog).
  const coffreCreeIci = useRef(false);
  const creer = useCallback(
    (motDePasse: string) =>
      executer(() => {
        setSecrets(session.initialiser({ motDePasse }));
        coffreCreeIci.current = true;
      }),
    [executer, session],
  );

  const deverrouiller = useCallback(
    (motDePasse: string, codeTotp: string) =>
      executer(() => session.deverrouiller({ motDePasse, codeTotp })),
    [executer, session],
  );

  // Mot de passe oublié : un code de récupération rouvre la base, et un
  // nouveau mot de passe est enregistré dans la foulée.
  const [enRecuperation, setEnRecuperation] = useState(false);
  // Étapes de la visite en cours, figées à l'ouverture (undefined : pas de visite).
  const [etapesVisite, setEtapesVisite] = useState<readonly EtapeVisite[] | undefined>();
  const visiteDecidee = useRef(false);
  const [messageExport, setMessageExport] = useState<string | undefined>();
  /** Saisie pré-remplie : le versement du mois, depuis Objectifs. */
  const [saisieInitiale, setSaisieInitiale] = useState<Partial<FormulaireOperation> | undefined>();
  const [avisRecuperation, setAvisRecuperation] = useState<string | undefined>();
  const recuperer = useCallback(
    (codeRecuperation: string, nouveauMotDePasse: string) =>
      executer(() => {
        const { codesRestants } = session.recuperer({ codeRecuperation, nouveauMotDePasse });
        setEnRecuperation(false);
        setAvisRecuperation(
          `Accès retrouvé : votre nouveau mot de passe est enregistré. Il vous reste ${codesRestants} code${
            codesRestants > 1 ? 's' : ''
          } de récupération${codesRestants <= 2 ? ' — pensez à en regénérer dans Paramètres' : ''}.`,
        );
      }),
    [executer, session],
  );

  const verrouiller = useCallback(() => {
    // Le podcast parle de votre argent : il se tait quand on verrouille.
    lecturePartagee().arreter();
    session.verrouiller();
    setEcran('tableau');
    rafraichir();
  }, [session, rafraichir]);

  const enregistrerCompte = useCallback(
    (compte: Compte) => {
      new DepotComptes(session.base()).enregistrer(compte);
      setEcran('tableau');
      rafraichir();
    },
    [session, rafraichir],
  );

  const [compteEdite, setCompteEdite] = useState<string | undefined>();

  // Supprimer un compte efface aussi ses opérations : sans elles, il ne
  // resterait que des lignes orphelines qui fausseraient les totaux.
  const supprimerCompte = useCallback(
    (compteId: string) => {
      const base = session.base();
      const depotTransactions = new DepotTransactions(base);
      // Tout ou rien : un compte à moitié effacé serait pire que pas effacé.
      base.transaction(() => {
        for (const transaction of depotTransactions.parCompte(compteId)) {
          depotTransactions.supprimer(transaction.id);
        }
        new DepotComptes(base).supprimer(compteId);
      });
      setCompteEdite(undefined);
      setCompteFiltre(TOUS_LES_COMPTES);
      setEcran('tableau');
      rafraichir();
    },
    [session, rafraichir],
  );

  const enregistrerTitre = useCallback(
    (titre: Titre) => {
      new DepotTitres(session.base()).enregistrer(titre);
      // Retour a la saisie, d'ou l'on vient : creer une valeur n'est jamais
      // une fin en soi, c'est un detour pour pouvoir saisir une operation.
      setEcran('saisie');
      rafraichir();
    },
    [session, rafraichir],
  );

  const enregistrerOperation = useCallback(
    (transaction: Transaction) => {
      new DepotTransactions(session.base()).enregistrer(transaction);
      setEcran('tableau');
      rafraichir();
    },
    [session, rafraichir],
  );

  /**
   * Enregistre un import de positions.
   * Les titres absents sont créés au passage : sans eux, les transactions de
   * reprise violeraient la clé étrangère de la base.
   */
  const enregistrerImport = useCallback(
    (positions: PositionImportee[]) => {
      const base = session.base();
      const depotTitres = new DepotTitres(base);
      const compte = new DepotComptes(base).tous()[0];
      if (!compte) {
        return;
      }

      const idParIsin = new Map<string, string>();
      for (const position of positions) {
        const existant = depotTitres.parIsin(position.isin);
        const id = existant?.id ?? identifiant(`titre-${position.isin}`);
        idParIsin.set(position.isin, id);
        if (!existant) {
          depotTitres.enregistrer({
            id,
            isin: position.isin,
            nom: position.nom,
            // Pas de ticker : l'export n'en porte pas, et en fabriquer un a
            // partir du nom — « STELLANT » — donnerait un symbole plausible
            // qui n'existe sur aucun marche. Il echouerait en silence au
            // rafraichissement, et surtout il ferait croire la valeur
            // configuree. Vide, elle est comptee parmi celles a regler, et
            // l'ecran Symboles y mene.
            ticker: '',
            deviseCotation: compte.devise,
            // L'export ne dit rien de l'éligibilité au PEA. La présumer fausse
            // bloquerait des saisies légitimes sur un plan où ces titres sont
            // déjà logés ; à corriger à la main si besoin.
            eligiblePEA: true,
          });
        }
      }

      const date = (aujourdhui ?? dateDuJour)();

      new DepotTransactions(base).enregistrerLot(
        transactionsDeReprise(positions, {
          compteId: compte.id,
          date,
          devise: compte.devise,
          resoudreTitre: position => idParIsin.get(position.isin)!,
          genererId: position => identifiant(`reprise-${position.isin}`),
        }),
      );

      // Sans cours, le tableau de bord afficherait « cours inconnu » pour tout
      // juste après l'import. On retient le cours implicite — valeur de marché
      // divisée par la quantité — et non le dernier cours affiché, arrondi au
      // centime par le courtier.
      const depotCours = new DepotCours(base);
      for (const position of positions) {
        const cours = position.valeurMarche
          ? position.valeurMarche.div(position.quantite)
          : position.dernierCours;
        if (cours) {
          depotCours.enregistrer(idParIsin.get(position.isin)!, date, cours);
        }
      }

      setEcran('tableau');
      setImportsRecents(nombre => nombre + 1);
      rafraichir();
    },
    [session, rafraichir, identifiant, aujourdhui],
  );

  const enregistrerReglages = useCallback(
    (fournisseurId: string, cle?: string) => {
      const parametres = new DepotParametres(session.base());
      parametres.ecrire(PARAMETRES.fournisseurCours, fournisseurId);
      // Une cle vide signifie « ne pas changer » : on n'ecrase jamais une cle
      // existante par du vide, sous peine de la perdre sans le vouloir.
      if (cle) {
        parametres.ecrire(PARAMETRES.cleApiCours, cle);
      }
      setEcran('tableau');
      rafraichir();
    },
    [session, rafraichir],
  );

  // Déclarée plus bas ; la référence évite d'en dépendre ici.
  const actualiserCoursDuJourRef = useRef<((silencieux: boolean) => void) | undefined>(undefined);

  const lancerRafraichissement = useCallback(() => {
    const base = session.base();
    const parametres = new DepotParametres(base);
    const fournisseur = fournisseurParId(
      parametres.lire(PARAMETRES.fournisseurCours) ?? '',
    );

    if (!fournisseur) {
      if (chargementAutomatique) {
        // Sur le bureau, Yahoo répond sans configuration : on s'en sert.
        actualiserCoursDuJourRef.current?.(false);
        return;
      }
      setMessageCours(
        'Aucun fournisseur de cours configure. Ouvrez les reglages pour en choisir un.',
      );
      return;
    }

    setCoursEnCours(true);
    setMessageCours(undefined);
    rafraichirCours(base, {
      fournisseur,
      cle: parametres.lire(PARAMETRES.cleApiCours),
    })
      .then(rapport => setMessageCours(resumeRafraichissement(rapport)))
      .catch((erreur: unknown) =>
        setMessageCours(erreur instanceof Error ? erreur.message : String(erreur)),
      )
      .finally(() => {
        setCoursEnCours(false);
        rafraichir();
      });
  }, [session, rafraichir, chargementAutomatique]);

  const allerAuTableau = useCallback(() => setEcran('tableau'), []);
  const {
    fichiers,
    pontSauvegardes,
    dossierSauvegardes,
    sauvegardes,
    messageSauvegarde,
    erreurSauvegarde,
    sauvegardeEnCours,
    rafraichirSauvegardes,
    activerSauvegardeAuto,
    creerSauvegarde,
    fusionnerSauvegarde,
    restaurerSauvegarde,
  } = useSauvegardes({ session, aujourdhui, deverrouille, rafraichir, onRestaure: allerAuTableau });

  const {
    synchro,
    liaisonDuPc,
    plateforme: plateformeSynchro,
    relier: relierSynchro,
    delier: delierSynchro,
    oublier: oublierAppareilSynchro,
    synchroniserMaintenant,
  } = useSynchro({ session, deverrouille: deverrouille && estAdmin, rafraichir, apresReception });

  // « Lier à mon compte » : ce nouvel appareil adopte le compte du PC.
  const [messageDeverrouillage, setMessageDeverrouillage] = useState<string | undefined>();
  const codeLiaisonConnu = liaisonDuPc ? encoderLiaison(liaisonDuPc) : liaisonEnAttente();
  // Sur le site, l'hôte fournit son propre « Lier » (tous les comptes, remplacement d'un ancien coffre).
  const lier = profils?.lier ?? (!estAdmin ? undefined : {
    codeConnu: codeLiaisonConnu && decoderLiaison(codeLiaisonConnu) ? codeLiaisonConnu : undefined,
    onLier: async (code: string) => {
      const liaison = decoderLiaison(code);
      if (!liaison) {
        throw new Error('Code de liaison illisible : copiez-le depuis le PC (il commence par AB1.).');
      }
      const coffre = await recupererCoffre(liaison);
      session.adopterCoffre(coffre as Coffre);
      definirLiaisonEnAttente(encoderLiaison(liaison));
      setErreur(undefined);
      setMessageDeverrouillage(
        '✅ Compte du PC trouvé. Entrez le mot de passe et le code à six chiffres de votre PC : le portefeuille arrivera ensuite tout seul.',
      );
      rafraichir();
    },
  });

  const genererRapport = useCallback(
    (annee: number) => {
      if (!fichiers) {
        setMessageRapport(
          'Écriture de fichiers indisponible dans cette version de l’application.',
        );
        return;
      }

      const contenuActuel = chargerEtat(session.base());
      const rapport = construireRapportAnnuel({
        annee,
        etat: contenuActuel.etat,
        comptes: contenuActuel.comptes,
        titres: contenuActuel.titres,
        transactions: contenuActuel.transactions,
        cours: new DepotCours(session.base()).derniersCours(),
        aujourdhui: (aujourdhui ?? dateDuJour)(),
      });

      setMessageRapport(undefined);
      ecrireRapport(fichiers, rapport)
        .then(ecrit =>
          setMessageRapport(
            `Rapport ${annee} écrit : ${ecrit.nom}. Ouvrez-le depuis Fichiers, puis imprimez-le en PDF.`,
          ),
        )
        .catch((e: unknown) =>
          setMessageRapport(e instanceof Error ? e.message : String(e)),
        );
    },
    [fichiers, session, aujourdhui],
  );

  const surveiller = useCallback(
    (titreId: string) => {
      // Le cours du jour est fige a l'ajout : c'est le point de comparaison
      // du suivi, et l'historique peut tres bien ne rien contenir a cette date.
      const cours = new DepotCours(session.base()).derniersCours().get(titreId);
      new DepotWatchlist(session.base()).ajouter({
        titreId,
        ajouteLe: (aujourdhui ?? dateDuJour)(),
        coursAjout: cours,
      });
      rafraichir();
    },
    [session, aujourdhui, rafraichir],
  );

  const nePlusSurveiller = useCallback(
    (titreId: string) => {
      new DepotWatchlist(session.base()).retirer(titreId);
      rafraichir();
    },
    [session, rafraichir],
  );

  /** Indice retenu pour la courbe du Résumé, le S&P 500 par défaut. */
  const indiceChoisi = useCallback((): string => {
    const lu = new DepotParametres(session.base()).lire(PARAMETRES.indiceReference);
    return lu ?? INDICE_DEFAUT;
  }, [session]);

  const chargerHistoriqueConnu = useCallback(() => {
    const contenuActuel = chargerEtat(session.base());
    // Detenues et surveillees : une valeur qu'on surveille merite son
    // historique, c'est meme la qu'on le regarde avant d'acheter.
    const concernes = new Set(
      contenuActuel.etat.positions.map(position => position.titreId),
    );
    for (const ligne of new DepotWatchlist(session.base()).lister()) {
      concernes.add(ligne.titreId);
    }

    const demandes = contenuActuel.titres
      .filter(titre => concernes.has(titre.id) && titre.ticker?.trim())
      .map(titre => ({ titreId: titre.id, nom: titre.nom, symbole: titre.ticker!.trim() }));

    // L'indice de comparaison suit : sans lui, la courbe du Résumé resterait
    // seule, sans rien à quoi se mesurer.
    const indice = indiceParId(indiceChoisi());
    if (indice && demandes.length > 0) {
      demandes.push({ titreId: indice.id, nom: indice.nom, symbole: indice.symbole });
    }
    // Le MSCI World aussi, toujours : il sert à « Et si tout était sur le MSCI World ? ».
    const monde = indiceParId(`${PREFIXE_INDICE}msci-world`);
    if (monde && demandes.length > 0 && !demandes.some(demande => demande.titreId === monde.id)) {
      demandes.push({ titreId: monde.id, nom: monde.nom, symbole: monde.symbole });
    }

    if (demandes.length === 0) {
      setMessageHistorique(
        'Aucune valeur n’a de symbole : réglez-les avant de charger l’historique.',
      );
      return;
    }

    const premiere = contenuActuel.transactions
      .map(transaction => transaction.date)
      .sort()[0];
    const plage = plagePour(premiere, (aujourdhui ?? dateDuJour)());

    setHistoEnCours(true);
    setMessageHistorique(undefined);

    chargerHistoriques(session.base(), demandes, { plage })
      .then(rapport => {
        setMessageHistorique(resumeHistorique(rapport));
        new DepotParametres(session.base()).ecrire(
          PARAMETRES.historiqueChargeLe,
          (aujourdhui ?? dateDuJour)(),
        );
      })
      .catch((e: unknown) =>
        setMessageHistorique(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setHistoEnCours(false);
        rafraichir();
      });
  }, [session, rafraichir, indiceChoisi, aujourdhui]);


  /**
   * Charge l'historique, en cherchant d'abord les symboles qui manquent.
   *
   * Un import de courtier ne donne que l'ISIN : sans cette étape, il
   * faudrait régler chaque valeur à la main avant de voir une courbe. La
   * recherche n'a lieu que sur le bureau : les tests ne touchent pas au réseau.
   */
  const lancerChargementHistorique = useCallback(() => {
    if (!chargementAutomatique) {
      chargerHistoriqueConnu();
      return;
    }
    const contenuActuel = chargerEtat(session.base());
    const concernes = new Set(contenuActuel.etat.positions.map(position => position.titreId));
    for (const ligne of new DepotWatchlist(session.base()).lister()) {
      concernes.add(ligne.titreId);
    }
    const sansSymbole = contenuActuel.titres.filter(
      titre => concernes.has(titre.id) && !titre.ticker?.trim(),
    );
    if (sansSymbole.length === 0) {
      chargerHistoriqueConnu();
      return;
    }
    setHistoEnCours(true);
    setMessageHistorique('Recherche des symboles de vos valeurs…');
    resoudreSymboles(sansSymbole)
      .then(({ trouves }) => {
        const depot = new DepotTitres(session.base());
        for (const titre of depot.tous()) {
          const symbole = trouves.get(titre.id);
          if (symbole) {
            depot.enregistrer({ ...titre, ticker: symbole });
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        setHistoEnCours(false);
        chargerHistoriqueConnu();
      });
  }, [chargementAutomatique, session, chargerHistoriqueConnu]);

  /**
   * Cours du jour, sans fournisseur à configurer : les cinq dernières
   * séances de chaque valeur détenue, dont la dernière est le cours actuel.
   */
  // Une actualisation à la fois : à dix secondes d'intervalle, une réponse
  // lente de Yahoo ne doit pas empiler les requêtes.
  const actualisationEnVol = useRef(false);
  const [coursActualisesA, setCoursActualisesA] = useState<string | undefined>();

  const actualiserCoursDuJour = useCallback(
    (silencieux: boolean) => {
      if (actualisationEnVol.current) {
        return;
      }
      const contenuActuel = chargerEtat(session.base());
      const detenus = new Set(contenuActuel.etat.positions.map(position => position.titreId));
      const demandes = contenuActuel.titres
        .filter(titre => detenus.has(titre.id) && titre.ticker?.trim())
        .map(titre => ({ titreId: titre.id, nom: titre.nom, symbole: titre.ticker.trim() }));
      const indice = indiceParId(indiceChoisi());
      if (indice && demandes.length > 0) {
        demandes.push({ titreId: indice.id, nom: indice.nom, symbole: indice.symbole });
      }
      if (demandes.length === 0) {
        if (!silencieux) {
          setMessageCours('Aucune valeur détenue n’a de symbole : chargez l’historique pour les trouver.');
        }
        return;
      }
      if (!silencieux) {
        setCoursEnCours(true);
        setMessageCours(undefined);
      }
      actualisationEnVol.current = true;
      chargerHistoriques(session.base(), demandes, { plage: '5d' })
        .then(rapport => {
          if (rapport.echecs.length < demandes.length) {
            setCoursActualisesA(new Date().toLocaleTimeString('fr-FR'));
          }
          if (!silencieux) {
            setMessageCours(
              rapport.echecs.length > 0
                ? `Cours actualisés, sauf : ${rapport.echecs.map(echec => echec.nom).join(', ')}.`
                : `Cours actualisés à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
            );
          }
        })
        .catch((e: unknown) => {
          if (!silencieux) {
            setMessageCours(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => {
          actualisationEnVol.current = false;
          setCoursEnCours(false);
          rafraichir();
        });
    },
    [session, rafraichir, indiceChoisi],
  );

  // Après un import, sur le bureau : symboles puis historique, sans rien demander.
  const [importsRecents, setImportsRecents] = useState(0);
  useEffect(() => {
    if (chargementAutomatique && importsRecents > 0) {
      lancerChargementHistorique();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importsRecents]);

  const choisirIndice = useCallback(
    (indiceId: string) => {
      new DepotParametres(session.base()).ecrire(PARAMETRES.indiceReference, indiceId);
      rafraichir();

      const indice = indiceParId(indiceId);
      if (!indice) {
        return;
      }
      // Déjà chargé : rien à télécharger, la courbe se redessine aussitôt.
      if (new DepotCours(session.base()).historique().get(indice.id)?.length) {
        return;
      }
      const premiere = chargerEtat(session.base())
        .transactions.map(transaction => transaction.date)
        .sort()[0];
      setHistoEnCours(true);
      chargerHistoriques(
        session.base(),
        [{ titreId: indice.id, nom: indice.nom, symbole: indice.symbole }],
        { plage: plagePour(premiere, (aujourdhui ?? dateDuJour)()) },
      )
        .then(rapport => setMessageHistorique(resumeHistorique(rapport)))
        .catch((e: unknown) => setMessageHistorique(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          setHistoEnCours(false);
          rafraichir();
        });
    },
    [session, rafraichir, aujourdhui],
  );

  const ouvrirSymbole = useCallback((symbole: string, titreId?: string, recharger = false) => {
    setEcran('fiche');
    const enCache = recharger ? undefined : fichesEnCache.current.get(symbole);
    if (enCache) {
      setFiche({
        symbole,
        titreId,
        chargement: false,
        vue: construireFiche(enCache.fiche, enCache.comptes, enCache.historique, enCache.manques),
      });
      return;
    }
    setFiche({ symbole, titreId, chargement: true });
    chargerValeur(symbole)
      .then(donnees => {
        fichesEnCache.current.set(symbole, donnees);
        setFiche(precedente =>
          precedente?.symbole === symbole
            ? {
                ...precedente,
                chargement: false,
                erreur: undefined,
                vue: construireFiche(donnees.fiche, donnees.comptes, donnees.historique, donnees.manques),
              }
            : precedente,
        );
      })
      .catch((e: unknown) =>
        setFiche(precedente =>
          precedente?.symbole === symbole
            ? { ...precedente, chargement: false, erreur: e instanceof Error ? e.message : String(e) }
            : precedente,
        ),
      );
  }, []);

  const ouvrirTitre = useCallback(
    (titreId: string) => {
      const titre = new DepotTitres(session.base()).tous().find(candidat => candidat.id === titreId);
      const symbole = titre?.ticker?.trim();
      if (!symbole) {
        setEcran('fiche');
        setFiche({
          symbole: titre?.nom ?? titreId,
          titreId,
          chargement: false,
          erreur:
            'Cette valeur n’a pas de symbole boursier. Renseignez-le dans Paramètres, rubrique Symboles, pour ouvrir sa fiche.',
        });
        return;
      }
      ouvrirSymbole(symbole, titreId);
    },
    [session, ouvrirSymbole],
  );

  const rechercherActions = useCallback(
    async (texte: string) => (await chercherSymboles(texte)).candidats,
    [],
  );

  /** Vue de fiche d'un symbole, pour le panneau de la Watchlist (réseau requis). */
  const chargerVueFiche = useMemo(
    () =>
      chargementAutomatique
        ? async (symbole: string) => {
            const donnees = fichesEnCache.current.get(symbole) ?? (await chargerValeur(symbole));
            fichesEnCache.current.set(symbole, donnees);
            return construireFiche(donnees.fiche, donnees.comptes, donnees.historique, donnees.manques);
          }
        : undefined,
    [chargementAutomatique],
  );

  /** Screener de Yahoo, par le processus principal du bureau. */
  const pontScreener = (globalThis as { applibourse?: { yahoo?: { screener?(corps: unknown): Promise<unknown> } } })
    .applibourse?.yahoo?.screener;
  const chargerScreener = useMemo(
    () =>
      pontScreener
        ? async (categorie: CleCategorie, region: Region, page: number, tri: TriScreener) =>
            lireScreener(await pontScreener(requeteScreener(categorie, region, { page, tri })))
        : undefined,
    [pontScreener],
  );

  /** Thèses et actualités d'une valeur, par le processus principal du bureau. */
  const pontFlux = (globalThis as { applibourse?: { medias?: { flux(url: string): Promise<string> } } }).applibourse
    ?.medias;
  const chargerThesesValeur = useMemo(
    () =>
      pontFlux ? (valeur: ValeurCherchee) => chargerTheses(valeur, url => pontFlux.flux(url)) : undefined,
    [pontFlux],
  );

  /**
   * Surveiller une valeur trouvée par la recherche : on la crée si elle
   * n'existe pas encore, repérée par son symbole.
   */
  const surveillerCandidat = useCallback(
    (candidat: CandidatSymbole) => {
      const depot = new DepotTitres(session.base());
      const existant = depot.tous().find(titre => titre.ticker.trim().toUpperCase() === candidat.symbole.toUpperCase());
      let titreId = existant?.id;
      if (!titreId) {
        titreId = identifiant('titre');
        depot.enregistrer({
          id: titreId,
          // La recherche ne donne pas d'ISIN, et la base en exige un unique :
          // le symbole en tient lieu, sous une forme qu'aucun ISIN ne prend.
          isin: `SYMBOLE:${candidat.symbole.toUpperCase()}`,
          nom: candidat.nom,
          ticker: candidat.symbole,
          deviseCotation: candidat.devise ?? (candidat.paris ? 'EUR' : 'USD'),
          eligiblePEA: false,
        });
      }
      surveiller(titreId);
    },
    [session, identifiant, surveiller],
  );
  const [erreurAjout, setErreurAjout] = useState<string | undefined>();
  const surveillerCandidatSur = useCallback(
    (candidat: CandidatSymbole) => {
      try {
        setErreurAjout(undefined);
        surveillerCandidat(candidat);
      } catch (e) {
        setErreurAjout(
          `Impossible d’ajouter ${candidat.nom} à la watchlist : ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [surveillerCandidat],
  );

  /** Lignes du carnet : valeurs détenues puis suivies, sans doublon. */
  const lignesCarnet = useCallback(() => {
    const base = session.base();
    const contenuActuel = chargerEtat(base);
    const noms = new Map(contenuActuel.titres.map(titre => [titre.id, titre.nom]));
    const ids = [
      ...new Set([
        ...contenuActuel.etat.positions.map(position => position.titreId),
        ...new DepotWatchlist(base).lister().map(ligne => ligne.titreId),
      ]),
    ];
    return construireCarnet(
      ids.map(titreId => ({ titreId, nom: noms.get(titreId) ?? titreId })),
      carnetDepuisJson(new DepotParametres(base).lire(PARAMETRES.carnetTheses)),
      new DepotCours(base).derniersCours(),
    );
  }, [session]);

  /** Symboles des valeurs en watchlist, en majuscules. */
  const symbolesSurveilles = (): Set<string> => {
    const titres = new Map(new DepotTitres(session.base()).tous().map(titre => [titre.id, titre.ticker.toUpperCase()]));
    return new Set(
      new DepotWatchlist(session.base())
        .lister()
        .map(ligne => titres.get(ligne.titreId) ?? '')
        .filter(Boolean),
    );
  };

  /** La valeur de ce symbole est-elle déjà en surveillance ? */
  const symboleSurveille = (symbole: string): boolean => {
    const cible = symbole.trim().toUpperCase();
    const ids = new Set(
      new DepotTitres(session.base())
        .tous()
        .filter(titre => titre.ticker.trim().toUpperCase() === cible)
        .map(titre => titre.id),
    );
    return ids.size > 0 && new DepotWatchlist(session.base()).lister().some(ligne => ids.has(ligne.titreId));
  };

  const [podcast, setPodcast] = useState<{
    episode?: Episode;
    chargement: boolean;
    etape?: string;
    erreur?: string;
    date?: string;
    minutes: number;
  }>({ chargement: false, minutes: 10 });

  const [societesComparees, setSocietesComparees] = useState<string[]>([]);
  const erreursComparaison = useRef(new Map<string, string>());
  const ajouterSociete = useCallback(
    (symbole: string) => {
      setSocietesComparees(precedentes =>
        precedentes.includes(symbole) || precedentes.length >= SOCIETES_MAXIMUM
          ? precedentes
          : [...precedentes, symbole],
      );
      if (fichesEnCache.current.has(symbole)) {
        return;
      }
      erreursComparaison.current.delete(symbole);
      chargerValeur(symbole)
        .then(donnees => fichesEnCache.current.set(symbole, donnees))
        .catch((e: unknown) =>
          erreursComparaison.current.set(symbole, e instanceof Error ? e.message : String(e)),
        )
        .finally(rafraichir);
    },
    [rafraichir],
  );

  const basculerComparaison = useCallback((titreId: string) => {
    setCompares(precedent =>
      precedent.includes(titreId)
        ? precedent.filter(id => id !== titreId)
        : [...precedent, titreId],
    );
  }, []);

  const chercherSymbole = useCallback((titreId: string, requete: string) => {
    setErreurSymboles(undefined);
    setRecherche({ titreId, candidats: [], enCours: true });

    chercherSymboles(requete)
      .then(resultat =>
        setRecherche({
          titreId,
          candidats: resultat.candidats,
          avertissement: resultat.avertissement,
        }),
      )
      .catch((e: unknown) => {
        setRecherche(undefined);
        setErreurSymboles(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const retenirSymbole = useCallback(
    (titreId: string, symbole: string) => {
      const depot = new DepotTitres(session.base());
      const titre = depot.tous().find(candidat => candidat.id === titreId);
      if (!titre) {
        return;
      }
      depot.enregistrer({ ...titre, ticker: symbole });
      setRecherche(undefined);
      rafraichir();
    },
    [session, rafraichir],
  );

  const enregistrerLien = useCallback(
    (titreId: string, lien: string) => {
      const depot = new DepotTitres(session.base());
      const titre = depot.tous().find(candidat => candidat.id === titreId);
      if (!titre) {
        return;
      }
      depot.enregistrer({ ...titre, lienExterne: lien || undefined });
      rafraichir();
    },
    [session, rafraichir],
  );

  const effacerSymbole = useCallback(
    (titreId: string) => {
      const depot = new DepotTitres(session.base());
      const titre = depot.tous().find(candidat => candidat.id === titreId);
      if (!titre) {
        return;
      }
      depot.enregistrer({ ...titre, ticker: '' });
      rafraichir();
    },
    [session, rafraichir],
  );

  const choisirReference = useCallback(
    (titreId: string) => {
      const parametres = new DepotParametres(session.base());
      // Retoucher la meme valeur retire la reference : sans cela on ne
      // pourrait plus revenir a « aucune comparaison ».
      if (parametres.lire(PARAMETRES.titreReference) === titreId) {
        parametres.supprimer(PARAMETRES.titreReference);
      } else {
        parametres.ecrire(PARAMETRES.titreReference, titreId);
      }
      rafraichir();
    },
    [session, rafraichir],
  );

  // Notifications de l'ordinateur : le pont d'Electron les affiche. Absent
  // sur téléphone (le réveil en arrière-plan s'en charge) et dans les tests.
  const pontNotifications = (globalThis as { applibourse?: { systeme?: PontNotifications } }).applibourse
    ?.systeme;
  const pontEnregistrerSous = (
    globalThis as { applibourse?: { fichiers?: { enregistrerSous?(nom: string, contenu: Uint8Array): Promise<boolean> } } }
  ).applibourse?.fichiers?.enregistrerSous;
  const { journalNotifications, verifierNotificationsRef } = useNotificationsBureau({
    session,
    deverrouille,
    aujourdhui,
    chargementAutomatique,
    pontNotifications,
    fichesEnCache,
    lignesCarnet,
  });

  const enregistrerPlanning = useCallback(
    (planning: Planning) => {
      const parametres = new DepotParametres(session.base());
      const avant = planningDepuisJson(parametres.lire(PARAMETRES.planningBriefings));
      // Un horaire déplacé aujourd'hui doit pouvoir sonner aujourd'hui.
      parametres.ecrire(
        PARAMETRES.etatNotifications,
        JSON.stringify(
          oublierBriefingsModifies(
            etatDepuisJson(parametres.lire(PARAMETRES.etatNotifications)),
            avant,
            planning,
            new Date(),
          ),
        ),
      );
      parametres.ecrire(
        PARAMETRES.planningBriefings,
        planningVersJson(planning),
      );
      // Vérifié tout de suite plutôt qu'à la minute suivante.
      setTimeout(() => void verifierNotificationsRef.current(), 1_500);
      try {
        stockageLocal()?.setItem(CLE_PLANNING_LOCAL, planningVersJson(planning));
      } catch {
        // Rappel verrouillé indisponible : sans conséquence.
      }
      rafraichir();
    },
    [session, rafraichir, verifierNotificationsRef],
  );

  const enregistrerSeuil = useCallback(
    (titreId: string, champ: 'haut' | 'bas', valeur: string) => {
      const parametres = new DepotParametres(session.base());
      let seuils: Record<string, { haut?: string; bas?: string }> = {};
      try {
        seuils = JSON.parse(parametres.lire(PARAMETRES.seuilsAlertes) ?? '{}');
      } catch {
        // Un reglage illisible est remplace plutot que de bloquer la saisie.
        seuils = {};
      }

      const existant = seuils[titreId] ?? {};
      seuils[titreId] = { ...existant, [champ]: valeur.trim() || undefined };
      parametres.ecrire(PARAMETRES.seuilsAlertes, JSON.stringify(seuils));
      rafraichir();
    },
    [session, rafraichir],
  );


  // Thème unique : appliqué avant de dessiner. Verrouillé, c'est celui du cache de l'appareil ;
  // déverrouillé, celui du profil (réconcilié dès le déverrouillage, avant le premier affichage).
  const themeAffiche: IdThemeHub = deverrouille ? themeHubId : themeCourant();
  if (themeAffiche !== themeCourant()) {
    definirTheme(themeAffiche);
  }

  // Mode discret : lu avant de construire les vues, qui formatent les montants.
  const discret = deverrouille && new DepotParametres(session.base()).lire(PARAMETRES.discretion) === '1';
  definirDiscretion(discret);
  const basculerDiscretion = () => {
    new DepotParametres(session.base()).ecrire(PARAMETRES.discretion, discret ? '0' : '1');
    rafraichir();
  };

  const pontDemarrage = (globalThis as { applibourse?: { systeme?: { demarrage?(activer?: boolean): Promise<boolean> } } })
    .applibourse?.systeme?.demarrage;
  const [demarrageAuto, setDemarrageAuto] = useState<boolean | undefined>(undefined);
  const pontPlateau = (globalThis as { applibourse?: { systeme?: { plateau?(activer?: boolean): Promise<boolean> } } })
    .applibourse?.systeme?.plateau;
  const [resterPlateau, setResterPlateau] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    pontPlateau?.().then(setResterPlateau).catch(() => undefined);
  }, [pontPlateau]);
  useEffect(() => {
    pontDemarrage?.().then(setDemarrageAuto).catch(() => undefined);
  }, [pontDemarrage]);
  // Podcast prêt au réveil : à l'heure choisie, une fois par jour, fenêtre ouverte.
  // Rempli plus bas, une fois genererPodcast défini.
  const genererPodcastRef = useRef<(minutes?: number, automatique?: boolean) => void>(() => undefined);
  const podcastDuJourRef = useRef<string | undefined>(undefined);
  podcastDuJourRef.current = podcast.date;
  useEffect(() => {
    if (!deverrouille || !chargementAutomatique) {
      return;
    }
    const verifier = () => {
      const heure = new DepotParametres(session.base()).lire(PARAMETRES.podcastAuto);
      if (!heure) return;
      const maintenant = new Date();
      const actuelle = `${String(maintenant.getHours()).padStart(2, '0')}:${String(maintenant.getMinutes()).padStart(2, '0')}`;
      const jour = (aujourdhui ?? dateDuJour)();
      const dejaFait = new DepotParametres(session.base()).lire(PARAMETRES.podcastAutoFait) === jour;
      if (actuelle >= heure && podcastDuJourRef.current !== jour && !dejaFait) {
        new DepotParametres(session.base()).ecrire(PARAMETRES.podcastAutoFait, jour);
        genererPodcastRef.current(undefined, true);
      }
    };
    const minuterie = setInterval(verifier, 60_000);
    return () => clearInterval(minuterie);
  }, [deverrouille, chargementAutomatique, session, aujourdhui]);

  actualiserCoursDuJourRef.current = actualiserCoursDuJour;

  // Cours en direct, à l'intervalle choisi dans les paramètres (dix secondes
  // par défaut) : seulement fenêtre visible, et pendant la séance de Paris
  // ou de New York — hors séance, les cours ne bougent pas.
  const intervalleS = deverrouille
    ? intervalleActualisation(new DepotParametres(session.base()).lire(PARAMETRES.intervalleActualisation))
    : 0;
  useEffect(() => {
    if (!chargementAutomatique || !deverrouille || intervalleS === 0) {
      return;
    }
    const minuterie = setInterval(() => {
      // Fenêtre réduite ou cachée : on n'actualise pas (pas de DOM sur téléphone).
      const doc = (globalThis as { document?: { visibilityState?: string } }).document;
      const visible = doc?.visibilityState !== 'hidden';
      if (visible && seanceEnCours()) {
        actualiserCoursDuJourRef.current?.(true);
      }
    }, intervalleS * 1000);
    return () => clearInterval(minuterie);
  }, [chargementAutomatique, deverrouille, intervalleS]);

  // Au déverrouillage, une fois par jour : l'historique des cours, qui porte
  // aussi le dernier cours de chaque valeur. Les courbes sont à jour sans
  // qu'il faille penser à les rafraîchir.
  useEffect(() => {
    if (!chargementAutomatique || !deverrouille) {
      return;
    }
    const parametres = new DepotParametres(session.base());
    if (parametres.lire(PARAMETRES.historiqueChargeLe) === (aujourdhui ?? dateDuJour)()) {
      // Historique déjà chargé aujourd'hui : seulement les cours du moment.
      actualiserCoursDuJourRef.current?.(true);
      return;
    }
    lancerChargementHistorique();
    // Une seule fois par déverrouillage : le chargement lui-même ne doit pas
    // relancer l'effet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargementAutomatique, deverrouille]);

  // Reconstruit a chaque rendu, sans memo. La base est une source externe
  // mutable : memoriser sa lecture demanderait de lister toutes les raisons
  // qu'elle a de changer, et la premiere oubliee afficherait un portefeuille
  // perime. Rejouer un journal personnel coute quelques millisecondes.
  const contenuComplet = deverrouille ? chargerEtat(session.base()) : undefined;

  // Filtre par compte : les vues d'analyse ne voient que le compte choisi,
  // rejoué seul. Les écrans de saisie, eux, gardent tous les comptes.
  const compteVu =
    contenuComplet && compteFiltre !== TOUS_LES_COMPTES
      ? contenuComplet.comptes.find(compte => compte.id === compteFiltre)
      : undefined;
  const contenu =
    contenuComplet && compteVu
      ? (() => {
          const transactions = contenuComplet.transactions.filter(
            transaction => transaction.compteId === compteVu.id,
          );
          return {
            ...contenuComplet,
            comptes: [compteVu],
            transactions,
            etat: rejouer([compteVu], transactions),
          };
        })()
      : contenuComplet;

  const depotCours = contenu ? new DepotCours(session.base()) : undefined;
  const tableau: VueDashboard | undefined = contenu
    ? construireDashboard({
        etat: contenu.etat,
        comptes: contenu.comptes,
        titres: contenu.titres,
        cours: depotCours!.derniersCours(),
      })
    : undefined;

  const historiques = depotCours ? separerHistorique(depotCours.historique()) : undefined;
  const pointsValorisation =
    contenu && historiques
      ? serieValorisation({
          comptes: contenu.comptes,
          transactions: contenu.transactions,
          cours: historiques.titres,
        })
      : [];
  const indiceRetenu = deverrouille ? indiceChoisi() : AUCUN_INDICE;
  const indice = indiceParId(indiceRetenu);

  const capitalActuel =
    contenuComplet && depotCours
      ? totaux(
          valoriserPositions(contenuComplet.etat.positions, depotCours.derniersCours())
            .valorisees,
          [...contenuComplet.etat.comptes.values()],
        ).valeurTotale
      : Decimal.ZERO;

  const onglets =
    contenu && depotCours && historiques
      ? {
          resume: construireResume({
            etat: contenu.etat,
            comptes: contenu.comptes,
            titres: contenu.titres,
            transactions: contenu.transactions,
            cours: depotCours.derniersCours(),
            points: pointsValorisation,
            reference:
              indice && historiques.indices.get(indice.id)?.length
                ? { nom: indice.court, serie: historiques.indices.get(indice.id)! }
                : undefined,
            aujourdhui: (aujourdhui ?? dateDuJour)(),
          }),
          performance: construirePerformance({
            points: pointsValorisation,
            transactions: contenu.transactions,
          }),
          siIndice: simulerToutSurIndice({
            transactions: contenu.transactions,
            serie: historiques.indices.get(`${PREFIXE_INDICE}msci-world`) ?? [],
            valeurReelle: capitalActuel.toNumber(),
          }),
          comparaison: construireComparaison({
            points: pointsValorisation,
            titres: contenu.titres,
            historique: historiques.titres,
            referenceId: new DepotParametres(session.base()).lire(
              PARAMETRES.titreReference,
            ),
          }),
          dividendes: construireDividendes({
            etat: contenu.etat,
            transactions: contenu.transactions,
            comptes: contenu.comptes,
            titres: contenu.titres,
            cours: depotCours.derniersCours(),
            aujourdhui: (aujourdhui ?? dateDuJour)(),
            // Historique par action des fiches déjà chargées (alertes, podcast, fiche).
            parAction: new Map(
              contenu.titres.flatMap(titre => {
                const donnees = titre.ticker ? fichesEnCache.current.get(titre.ticker.trim()) : undefined;
                return donnees
                  ? [[titre.id, { devise: donnees.fiche.devise, versements: donnees.historique.dividendes }] as const]
                  : [];
              }),
            ),
            versEuros: (montant, devise) => convertisseur().enEuros(montant, devise),
            valeurPortefeuille: capitalActuel.toNumber(),
          }),
          risque: construireRisque({
            etat: contenu.etat,
            titres: contenu.titres,
            cours: depotCours.derniersCours(),
            historique: historiques.titres,
          }),
          flux: construireFlux(contenu.transactions, contenu.comptes),
          ventes: lignesVendables(contenu, depotCours.derniersCours()),
          impots: construireImpots({
            etat: contenu.etat,
            comptes: contenu.comptes,
            cessions: contenu.etat.cessions,
            aujourdhui: (aujourdhui ?? dateDuJour)(),
            cours: depotCours.derniersCours(),
          }),
        }
      : undefined;

  // Donnees des analyses avancees : frontiere efficiente, poids dans le temps,
  // rendements mensuels. Couteuses a recalculer, elles ne le sont que lorsque
  // le portefeuille a pu changer : chaque ecriture passe par rafraichir(), qui
  // incremente `rendu`.
  const analyse = useMemo(
    () =>
      contenu && depotCours && historiques
        ? {
            etat: contenu.etat,
            comptes: contenu.comptes,
            titres: contenu.titres,
            transactions: contenu.transactions,
            cours: depotCours.derniersCours(),
            historique: historiques.titres,
            points: pointsValorisation,
            indice:
              indice && historiques.indices.get(indice.id)?.length
                ? { nom: indice.court, serie: historiques.indices.get(indice.id)! }
                : undefined,
            aujourdhui: (aujourdhui ?? dateDuJour)(),
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rendu, compteFiltre, indiceRetenu, deverrouille, aujourdhui, discret],
  );

  // Valeur actuelle du portefeuille, proposee comme capital de depart de la
  // projection. Retaper ce montant serait une occasion de se tromper.

  const verrou = statut === 'non-initialise' ? undefined : session.verrou();


  // Infobulle de l'icône près de l'horloge : la valeur, sauf en mode discret
  // ou verrouillée — elle se lit par-dessus l'épaule.
  const pontSysteme = (globalThis as { applibourse?: { systeme?: { infobulle?(texte: string): Promise<boolean> } } })
    .applibourse?.systeme;
  const texteInfobulle = !deverrouille
    ? 'AppDashboard — verrouillée'
    : discret || capitalActuel.estZero()
      ? 'AppDashboard'
      : `AppDashboard — ${formaterMontant(capitalActuel, { decimales: 0 })}`;
  useEffect(() => {
    pontSysteme?.infobulle?.(texteInfobulle).catch(() => undefined);
  }, [pontSysteme, texteInfobulle]);

  // Podcast : écrit à l'ouverture de l'écran, une fois par jour, sur tout le
  // portefeuille (le filtre de compte ne s'applique pas).
  const genererPodcast = (minutes = podcast.minutes, automatique = false) => {
    if (!contenuComplet || podcast.chargement) {
      return;
    }
    const date = (aujourdhui ?? dateDuJour)();
    const complet = separerHistorique(new DepotCours(session.base()).historique());
    const entrees = {
      etat: contenuComplet.etat,
      titres: contenuComplet.titres,
      cours: new DepotCours(session.base()).derniersCours(),
      historique: complet.titres,
      indices: complet.indices,
      aujourdhui: date,
    };
    const horsLigne = () => Promise.reject(new Error('hors ligne'));
    setPodcast(precedent => ({ ...precedent, minutes, chargement: true, erreur: undefined, etape: undefined }));
    // Les flux RSS passent par le processus principal (liste fermée d'adresses).
    const pontMedias = (
      globalThis as {
        applibourse?: { medias?: { flux(url: string): Promise<string>; page?(url: string): Promise<string> } };
      }
    ).applibourse?.medias;
    preparerEpisode(
      entrees,
      chargementAutomatique
        ? {
            valeur: symbole => chargerValeur(symbole),
            actualites: requete => chargerActualites(requete),
            flux: pontMedias ? url => pontMedias.flux(url) : undefined,
            // L'essentiel des articles, lu sur leur page : pas seulement leurs titres.
            page: pontMedias?.page ? url => pontMedias.page!(url) : undefined,
          }
        : { valeur: horsLigne, actualites: horsLigne },
      fichesEnCache.current,
      etape => setPodcast(precedent => ({ ...precedent, etape })),
      minutes,
    )
      .then(({ episode, manques }) => {
        if (automatique) {
          void pontNotifications
            ?.notifier('🎙️ Votre podcast est prêt', `${episode.titre} · environ ${episode.duree} minutes.`, 'podcast')
            .catch(() => undefined);
        }
        setPodcast({
          episode,
          date,
          minutes,
          chargement: false,
          erreur:
            manques > 0
              ? 'Certaines actualités ou fiches n’ont pas pu être chargées : l’épisode raconte ce qui est disponible.'
              : undefined,
        });
      })
      .catch((e: unknown) =>
        setPodcast(precedent => ({
          ...precedent,
          chargement: false,
          erreur: e instanceof Error ? e.message : String(e),
        })),
      );
  };
  genererPodcastRef.current = genererPodcast;

  // Navigation latérale : chaque écran à un clic, où que l'on soit.
  const sansCompte = (contenuComplet?.comptes.length ?? 0) === 0;
  const destinations: Destination[] = [
    ...(hub ? [{ cle: 'hub', libelle: '← Hub', glyphe: '⌂' }] : []),
    { cle: 'tableau', libelle: 'Portefeuille', glyphe: '▦' },
    { cle: 'saisie', libelle: 'Nouvelle opération', glyphe: '+' },
    { cle: 'import', libelle: 'Importer', glyphe: '↓' },
    { cle: 'recherche', libelle: 'Recherche', glyphe: '⌕' },
    { cle: 'screener', libelle: 'Screener', glyphe: '▤' },
    // La fiche ouverte se range sous la Recherche, d'où on l'ouvre le plus souvent.
    ...(fiche ? [{ cle: 'fiche', libelle: fiche.vue?.entete.nom ?? fiche.symbole, glyphe: '◧', sous: true }] : []),
    { cle: 'watchlist', libelle: 'Watchlist', glyphe: '☆' },
    { cle: 'carnet', libelle: 'Mon carnet', glyphe: '✎' },
    { cle: 'journal', libelle: 'Journal des décisions', glyphe: '☰', sous: true },
    { cle: 'comparateur', libelle: 'Comparateur', glyphe: '⇄' },
    { cle: 'podcast', libelle: 'Podcast', glyphe: '♫' },
    { cle: 'objectifs', libelle: 'Objectifs', glyphe: '◎' },
    { cle: 'projection', libelle: 'Projection', glyphe: '↗' },
    { cle: 'sauvegarde', libelle: 'Sauvegarde', glyphe: '⇪' },
    { cle: 'reglages', libelle: 'Paramètres', glyphe: '⚙\uFE0E' },
    { cle: 'diagnostic', libelle: 'Diagnostic', glyphe: '✚', sous: true },
    // Baggr s'ouvre dans le navigateur : ce n'est pas un écran de l'application.
    { cle: 'baggr', libelle: 'Baggr ↗', glyphe: '◆' },
  ];
  const destinationActive =
    ecran === 'symboles' ? 'reglages' : ecran === 'titre' ? 'saisie' : ecran === 'compte' ? 'tableau' : ecran;
  const naviguer = (cle: string) => {
    if (cle === 'hub') {
      setAppHub(undefined);
      return;
    }
    // Les réglages (et les alertes, qui en font partie) sont dans la page Paramètres, unique.
    if (cle === 'reglages' || cle === 'notifications') {
      ouvrirParametres('portefeuille');
      return;
    }
    // Toute navigation vers un écran du portefeuille passe par le hub : elle
    // ouvre l'app Portefeuille, si le profil y a droit.
    if (hub) {
      if (!portefeuillePermis) {
        return;
      }
      setAppHub(ID_PORTEFEUILLE);
    }
    setSaisieInitiale(undefined);
    if (cle === 'baggr') {
      Linking.openURL(ACCUEIL_BAGGR).catch(() => undefined);
      return;
    }
    if ((cle === 'saisie' || cle === 'import') && sansCompte) {
      // Sans compte, ni saisie ni import ne sont possibles : on commence par là.
      setCompteEdite(undefined);
      setEcran('compte');
      return;
    }
    if (cle === 'sauvegarde') {
      rafraichirSauvegardes();
    }
    if (cle === 'podcast' && podcast.date !== (aujourdhui ?? dateDuJour)()) {
      genererPodcast();
    }
    setEcran(cle as Ecran);
  };

  // La visite ne s'ouvre que s'il reste des nouveautés jamais vues, et pas
  // pour un tout nouveau portefeuille (rien à montrer encore).
  const nombreComptes = contenuComplet?.comptes.length ?? 0;
  useEffect(() => {
    if (visiteDecidee.current || !deverrouille || nombreComptes === 0) {
      return;
    }
    visiteDecidee.current = true;
    const nouvelles = etapesNouvelles(ETAPES_VISITE, new DepotParametres(session.base()).lire(PARAMETRES.visiteVue));
    if (nouvelles.length > 0) {
      setEtapesVisite(nouvelles);
    }
  }, [deverrouille, nombreComptes, session]);

  // Clic sur une notification : la fenêtre s'ouvre sur la bonne page. Si
  // l'application est verrouillée, la page s'ouvre juste après le déverrouillage.
  const [destinationEnAttente, setDestinationEnAttente] = useState<string | undefined>();
  useEffect(() => {
    const systeme = (
      globalThis as { applibourse?: { systeme?: { surNotificationOuverte?(rappel: (destination: string) => void): () => void } } }
    ).applibourse?.systeme;
    return systeme?.surNotificationOuverte?.(setDestinationEnAttente);
  }, []);
  const naviguerRef = useRef(naviguer);
  naviguerRef.current = naviguer;
  const ecransRef = useRef<ReadonlySet<string>>(new Set());
  ecransRef.current = new Set(destinations.map(destination => destination.cle));
  useEffect(() => {
    if (!destinationEnAttente || !deverrouille || !contenuComplet || !tableau) return;
    setDestinationEnAttente(undefined);
    const cible = lireDestination(destinationEnAttente, ecransRef.current);
    if (cible.genre === 'titre') {
      ouvrirTitre(cible.titreId);
    } else if (cible.genre === 'symbole') {
      const connu = contenuComplet.titres.find(titre => titre.ticker.trim().toUpperCase() === cible.symbole.toUpperCase());
      ouvrirSymbole(cible.symbole, connu?.id);
    } else {
      naviguerRef.current(cible.cle);
    }
  }, [destinationEnAttente, deverrouille, contenuComplet, tableau, ouvrirTitre, ouvrirSymbole]);

  // --- Hub : quelle app est ouverte, thème et préférences du profil ------------
  const [appHub, setAppHub] = useState<string | undefined>();
  // Disposition et densité : dernières valeurs mémorisées sur l'appareil, pour que le hub s'affiche
  // dans sa forme définitive dès la première image (le reste vient du profil au déverrouillage).
  const prefsMemorisees = useCallback((): PrefsHub | undefined => {
    const memo = lireAffichageMemorise(stockageLocalAppareil(), cleLocale(CLE_CACHE_AFFICHAGE));
    return memo ? { ...reinitialiser(), ...memo } : undefined;
  }, []);
  const [prefsHub, setPrefsHub] = useState<PrefsHub | undefined>(() => (hub ? prefsMemorisees() : undefined));
  const appPortefeuille = REGISTRE.find(app => app.id === ID_PORTEFEUILLE)!;
  const portefeuillePermis =
    !hub ||
    (peutOuvrir(appPortefeuille, profils?.actuel) && etatTuile(appPortefeuille, { profil: profils?.actuel, profils }).ouvrable &&
      appsVisibles([appPortefeuille], { profil: profils?.actuel, profils }).length > 0);
  // Les préférences vivent dans la base chiffrée du profil : elles sont donc
  // propres à chaque profil, et ne demandent aucun nouveau fichier.
  const stockagePrefs = useMemo(
    () => ({
      lire: (cle: string) => new DepotParametres(session.base()).lire(cle),
      ecrire: (cle: string, valeur: string) => new DepotParametres(session.base()).ecrire(cle, valeur),
    }),
    [session],
  );
  // Réconciliation avec le profil, avant la première image (useLayoutEffect) : au déverrouillage,
  // et après chaque tour de synchro qui a reçu des changements. Migre au passage l'ancien thème
  // du portefeuille vers le thème unique (idempotent).
  useLayoutEffect(() => {
    if (!deverrouille) {
      // Reverrouillé : au prochain déverrouillage, on repart du hub, sans rien garder du profil.
      setAppHub(undefined);
      setParametres(undefined);
      if (hub) {
        setPrefsHub(prefsMemorisees());
      }
      return;
    }
    const { theme } = migrerThemeUnique(stockagePrefs);
    setThemeHubId(theme);
    if (hub) {
      const lues = chargerPrefs(stockagePrefs);
      setPrefsHub(lues);
      memoriserAffichage(stockageLocalAppareil(), cleLocale(CLE_CACHE_AFFICHAGE), lues);
    }
  }, [hub, deverrouille, stockagePrefs, versionSynchro, prefsMemorisees]);
  const choisirTheme = useCallback(
    (id: IdThemeHub) => {
      setThemeHubId(id);
      definirTheme(id);
      try {
        stockagePrefs.ecrire(CLE_THEME, id);
      } catch {
        // Non mémorisé : le thème reste appliqué jusqu'à la fermeture.
      }
    },
    [stockagePrefs],
  );
  const hubAffiche = hub && deverrouille && Boolean(contenuComplet && tableau);
  const surLeHub = hubAffiche && (appHub === undefined || (appHub === ID_PORTEFEUILLE && !portefeuillePermis));
  const surUneApp = hubAffiche && !surLeHub && appHub !== ID_PORTEFEUILLE;
  // « Échap » ramène au hub depuis n'importe quelle app.
  useEffect(() => {
    // La page Paramètres, ouverte par-dessus une app, garde Échap pour elle : elle se ferme, l'app reste.
    if (!hubAffiche || appHub === undefined || parametres) {
      return undefined;
    }
    return ecouterTouche('Escape', () => setAppHub(undefined), { ignorerChamps: true });
  }, [hubAffiche, appHub, parametres]);
  const resumeHub: ResumePortefeuille | undefined =
    hubAffiche && onglets
      ? {
          valeur: onglets.resume.valeurTotale,
          sansCompte,
          variation: onglets.resume.variationSeance
            ? {
                pourcentage: onglets.resume.variationSeance.pourcentage.texte,
                montant: onglets.resume.variationSeance.montant.texte,
                tendance: onglets.resume.variationSeance.pourcentage.tendance,
                date: onglets.resume.variationSeance.date,
              }
            : undefined,
        }
      : undefined;
  // Enregistrement d'un fichier : boîte « Enregistrer sous » du PC, sinon téléchargement du navigateur.
  const enregistrerFichierHote = useCallback(async (nom: string, contenu: string, type: string) => {
    const enregistrerSous = (
      globalThis as { applibourse?: { fichiers?: { enregistrerSous?(nom: string, contenu: Uint8Array): Promise<boolean> } } }
    ).applibourse?.fichiers?.enregistrerSous;
    if (enregistrerSous) {
      return enregistrerSous(nom, octetsUtf8(contenu));
    }
    return telechargerWeb(nom, contenu, type);
  }, []);
  // Services de l'Administration : seulement pour l'administrateur. Rien ici
  // ne rend un secret : on revérifie l'identité, on ne relit rien.
  const servicesAdmin = useMemo<ServicesAdmin | undefined>(
    () =>
      estAdmin || estGestionnaire
        ? {
            stockage: stockagePrefs,
            verifierIdentite: (motDePasse, codeTotp) => session.verifierIdentite({ motDePasse, codeTotp }),
            etatCoffre: () => session.etatCoffre(),
            // Pas d'export de fichier pour un gestionnaire (journal, récapitulatifs).
            enregistrerFichier: estGestionnaire ? undefined : enregistrerFichierHote,
          }
        : undefined,
    [estAdmin, estGestionnaire, session, stockagePrefs, enregistrerFichierHote],
  );
  // Tsuzuku : ses données sont des paramètres de la base chiffrée du profil OUVERT (une base par
  // profil : rien n'est partagé). La tuile du hub lit un résumé de sa bibliothèque.
  const baseProfil = useMemo<BasePrefs>(() => {
    const depot = () => new DepotParametres(session.base());
    return { lire: cle => depot().lire(cle), ecrire: (cle, valeur) => depot().ecrire(cle, valeur), supprimer: cle => depot().supprimer(cle) };
  }, [session]);
  const resumeTsuzuku = useMemo(
    () => {
      if (!hubAffiche) return undefined;
      try {
        return resumerBibliotheque(baseProfil.lire(CLES_TSUZUKU.bibliotheque) ?? '');
      } catch {
        return undefined;
      }
    },
    // Relu au retour sur le hub (appHub change) et après une synchro : la tuile est à jour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hubAffiche, baseProfil, appHub, versionSynchro],
  );
  const contexteHub: ContexteHub = { profil: profils?.actuel, profils, portefeuille: resumeHub, admin: servicesAdmin, baseProfil, tsuzuku: resumeTsuzuku, enregistrerFichier: enregistrerFichierHote };
  const themeDuHub = themeHub(themeAffiche);
  const appOuverte = surUneApp ? REGISTRE.find(app => app.id === appHub) : undefined;
  // --- Devblog « Quoi de neuf » : une fois par profil et par version -----------
  const [devblog, setDevblog] = useState<{ entree?: EntreeDevblog } | undefined>();
  const [demandeHub, setDemandeHub] = useState<{ genre: 'parametres' | 'personnaliser'; n: number } | undefined>();
  const devblogDecide = useRef(false);
  const nombreOperations = contenuComplet?.transactions.length ?? 0;
  useEffect(() => {
    if (!hub || !deverrouille || !tableau || profils?.sessionAdmin) {
      if (!deverrouille) {
        devblogDecide.current = false;
      }
      return;
    }
    if (devblogDecide.current || etapesVisite !== undefined) {
      return;
    }
    // Compte admin relié à un relais : on attend le premier tour de synchro, qui peut rapporter
    // les versions déjà vues sur un autre appareil (un profil qui les a vues n'est pas « neuf »).
    const liaisonAttendue = !synchro.configure && Boolean(liaisonDuPc || liaisonEnAttente());
    if (estAdmin && (synchro.configure || liaisonAttendue) && !synchro.premierTourFait) {
      return;
    }
    try {
      // La visite guidée passe d'abord ; le devblog attend qu'elle soit finie.
      const visite = nombreComptes > 0 && etapesNouvelles(ETAPES_VISITE, new DepotParametres(session.base()).lire(PARAMETRES.visiteVue)).length > 0;
      if (visite) {
        return;
      }
      devblogDecide.current = true;
      // Profil neuf : coffre créé à l'instant, ou toute première ouverture d'un
      // compte ami créé par l'administrateur (portefeuille encore vide).
      const premiereOuvertureAmi =
        !estAdmin && stockagePrefs.lire('compte.connexions') === '1' && nombreComptes === 0 && nombreOperations === 0;
      const decision = deciderDevblog(stockagePrefs.lire(CLE_DEVBLOG), { profilNeuf: coffreCreeIci.current || premiereOuvertureAmi, admin: estAdmin, gestionnaire: estGestionnaire });
      if (decision.genre === 'marquer') {
        stockagePrefs.ecrire(CLE_DEVBLOG, decision.valeur);
      } else if (decision.genre === 'afficher') {
        setDevblog({ entree: decision.entree });
      }
    } catch {
      // Préférence illisible : pas de devblog cette fois, rien ne casse.
    }
  }, [hub, deverrouille, tableau, profils?.sessionAdmin, etapesVisite, nombreComptes, nombreOperations, session, stockagePrefs, estAdmin, estGestionnaire, synchro.configure, synchro.premierTourFait, liaisonDuPc]);
  // Une autre appareil vient de rapporter que cette version a déjà été vue : plus de patch notes ici.
  useEffect(() => {
    const entree = devblog?.entree;
    if (!entree || versionSynchro === 0) {
      return;
    }
    try {
      if (lireEtatDevblog(stockagePrefs.lire(CLE_DEVBLOG))?.vues.includes(entree.version)) {
        setDevblog(undefined);
      }
    } catch {
      // Illisible : on laisse la fenêtre ouverte.
    }
  }, [versionSynchro, devblog, stockagePrefs]);
  const fermerDevblog = () => {
    const entree = devblog?.entree;
    if (entree) {
      try {
        stockagePrefs.ecrire(CLE_DEVBLOG, marquerDevblogLu(stockagePrefs.lire(CLE_DEVBLOG), [entree.version]));
      } catch {
        // Non mémorisé : il reviendra, c'est tout.
      }
    }
    setDevblog(undefined);
  };
  const essayer = (cible: CibleEssai) => {
    fermerDevblog();
    setParametres(undefined);
    if (cible.genre === 'app') {
      ouvrirApp(cible.app);
    } else {
      setAppHub(undefined);
      setDemandeHub(courante => ({ genre: cible.genre, n: (courante?.n ?? 0) + 1 }));
    }
  };

  const ouvrirApp = (id: string) => {
    const app = appsVisibles(REGISTRE, contexteHub).find(candidate => candidate.id === id);
    // Une app en maintenance ne s'ouvre pas pour un ami (sa tuile le dit).
    if (app && etatTuile(app, contexteHub).ouvrable) {
      setAppHub(app.id);
    }
  };

  // --- Paramètres : UNE page pour tout (voir src/hub/recensement.ts) ------------
  const maj = useMiseAJour();
  const synchroHub: SynchroHub | undefined =
    estAdmin && synchro.configure
      ? {
          vue: {
            enCours: synchro.enCours,
            derniere: synchro.derniere,
            enAttente: synchro.enAttente,
            erreur: synchro.erreur,
            enLigne: synchro.enLigne,
          },
          onSynchroniser: () => void synchroniserMaintenant(),
        }
      : undefined;
  const barreApp = <BarreApp theme={themeDuHub} synchro={synchroHub} onParametres={ouvrirParametres} />;
  const surParametres = Boolean(parametres) && deverrouille && Boolean(contenuComplet && tableau);
  const fermerParametres = useCallback(() => setParametres(undefined), []);
  const depuisParametres = (action: () => void) => () => {
    setParametres(undefined);
    action();
  };
  const administrationVisible = appsVisibles(REGISTRE, contexteHub).some(app => app.id === 'administration');
  const tsuzukuVisible = appsVisibles(REGISTRE, contexteHub).some(app => app.id === 'tsuzuku');
  const disponiblesParametres: IdReglage[] = [
    'theme',
    'langue',
    'compte',
    'securite-coffre',
    'codes-recuperation',
    'version',
    'mise-a-jour',
    ...(hub ? (['tuiles', 'nouveautes'] as const) : []),
    ...(portefeuillePermis ? (['visite', 'cours-intervalle', 'cours-fournisseur', 'symboles', 'historique-cours', 'discretion', 'notifications', 'podcast'] as const) : []),
    ...(portefeuillePermis && pontEnregistrerSous ? (['export-excel'] as const) : []),
    ...(synchroHub ? (['synchro-etat'] as const) : []),
    ...(estAdmin ? (['synchro-appareils'] as const) : []),
    ...(fichiers ? (['sauvegarde-auto', 'sauvegardes'] as const) : []),
    ...(profils?.transparence && !estAdmin ? (['confidentialite'] as const) : []),
    ...(hub && administrationVisible ? (['admin-panel'] as const) : []),
    ...(estAdmin && servicesAdmin ? (['admin-reglages'] as const) : []),
    ...(estAdmin && profils ? (['admin-comptes'] as const) : []),
    ...(estGestionnaire ? (['role-gestionnaire'] as const) : []),
    ...(hub && tsuzukuVisible ? (['tsuzuku-tmdb', 'tsuzuku-lecture'] as const) : []),
  ];
  const contenuNotifications = () => (
        <Notifications
          notificationsDisponibles={
            Boolean(pontNotifications) || chargerModule('@notifee/react-native').etat === 'disponible'
          }
          reveilDisponible={
            Boolean(pontNotifications) ||
            chargerModule('react-native-background-fetch').etat === 'disponible'
          }
          surOrdinateur={Boolean(pontNotifications)}
          journal={journalNotifications}
          evenementsActifs={new DepotParametres(session.base()).lire(PARAMETRES.evenementsActifs) !== '0'}
          onChangerEvenements={
            pontNotifications
              ? actifs => {
                  new DepotParametres(session.base()).ecrire(PARAMETRES.evenementsActifs, actifs ? '1' : '0');
                  rafraichir();
                }
              : undefined
          }
          demarrageAuto={pontDemarrage ? demarrageAuto ?? false : undefined}
          resterPlateau={pontPlateau ? resterPlateau ?? true : undefined}
          onChangerPlateau={
            pontPlateau
              ? activer => {
                  pontPlateau(activer).then(setResterPlateau).catch(() => undefined);
                }
              : undefined
          }
          onChangerDemarrage={
            pontDemarrage
              ? activer => {
                  pontDemarrage(activer).then(setDemarrageAuto).catch(() => undefined);
                }
              : undefined
          }
          seuilVariation={seuilVariation(new DepotParametres(session.base()).lire(PARAMETRES.seuilVariation))}
          onChangerSeuilVariation={valeur => {
            new DepotParametres(session.base()).ecrire(PARAMETRES.seuilVariation, valeur);
            rafraichir();
          }}
          onTester={
            pontNotifications
              ? () => {
                  // L'essai montre un vrai briefing, avec vos chiffres du moment.
                  const contenuActuel = chargerEtat(session.base());
                  const essai = composerBriefing({
                    moment: new Date().getHours() < 13 ? 'matin' : 'soir',
                    etat: contenuActuel.etat,
                    titres: contenuActuel.titres,
                    cours: new DepotCours(session.base()).derniersCours(),
                    date: (aujourdhui ?? dateDuJour)(),
                    toujours: true,
                  });
                  pontNotifications
                    .notifier(
                      essai?.titre ?? '✅ AppDashboard',
                      essai?.corps ?? 'Les notifications fonctionnent. Vos briefings arriveront ici.',
                      'tableau',
                    )
                    .then(affichee =>
                      setMessageNotifications(
                        affichee
                          ? 'Notification de test envoyée.'
                          : 'Windows a refusé la notification : vérifiez Paramètres › Système › Notifications.',
                      ),
                    )
                    .catch(() => setMessageNotifications('La notification de test a échoué.'));
                }
              : undefined
          }
          planning={planningDepuisJson(
            new DepotParametres(session.base()).lire(PARAMETRES.planningBriefings),
          )}
          onChangerPlanning={enregistrerPlanning}
          prochain={prochainBriefing(
            planningDepuisJson(
              new DepotParametres(session.base()).lire(PARAMETRES.planningBriefings),
            ),
            new Date(),
          )}
          seuils={contenu ? seuilsAffiches(session, contenu) : []}
          onChangerSeuil={enregistrerSeuil}
          integre
          message={messageNotifications}
        />
  );
  const renduParametres = (id: IdReglage): React.ReactNode => {
    const depot = () => new DepotParametres(session.base());
    switch (id) {
      case 'theme':
        return <ReglageTheme theme={themeDuHub} onTheme={choisirTheme} />;
      case 'tuiles':
        return (
          <ReglageTuiles
            theme={themeDuHub}
            prefs={prefsHub ?? reinitialiser()}
            onPrefs={suivant => {
              setPrefsHub(suivant);
              enregistrerPrefs(stockagePrefs, suivant);
              memoriserAffichage(stockageLocalAppareil(), cleLocale(CLE_CACHE_AFFICHAGE), suivant);
            }}
            onPersonnaliser={depuisParametres(() => {
              setAppHub(undefined);
              setDemandeHub(courante => ({ genre: 'personnaliser', n: (courante?.n ?? 0) + 1 }));
            })}
          />
        );
      case 'langue':
        return <ReglageLangue theme={themeDuHub} />;
      case 'compte':
        return (
          <ReglageCompte
            theme={themeDuHub}
            nomProfil={profils?.actuel.nom}
            onChangerProfil={profils && (profils.peutChanger ?? profils.tous.length > 1) ? depuisParametres(profils.onChanger) : undefined}
            onVerrouiller={depuisParametres(verrouiller)}
          />
        );
      case 'visite':
        return <ReglageVisite onRevoir={depuisParametres(() => setEtapesVisite(ETAPES_VISITE))} />;
      case 'synchro-etat':
        return synchroHub ? <IndicateurSynchro theme={themeDuHub} synchro={synchroHub} detaille /> : null;
      case 'synchro-appareils':
        return (
          <CarteSynchro
            synchro={synchro}
            liaisonDuPc={liaisonDuPc}
            nomParDefaut={nomParDefaut(plateformeSynchro)}
            onRelier={relierSynchro}
            onDelier={delierSynchro}
            onOublier={autre => void oublierAppareilSynchro(autre)}
          />
        );
      case 'securite-coffre':
        return <ReglageCoffre theme={themeDuHub} etat={session.etatCoffre()} />;
      case 'codes-recuperation':
        return <ReglageCodes onRenouveler={() => session.renouvelerCodesRecuperation()} />;
      case 'sauvegarde-auto':
        return (
          <ReglageSauvegardeAuto
            active={Boolean(depot().lire(PARAMETRES.sauvegardeAutoMotDePasse))}
            derniere={depot().lire(PARAMETRES.sauvegardeAutoDerniere)}
            aujourdhui={(aujourdhui ?? dateDuJour)()}
            onChanger={activerSauvegardeAuto}
          />
        );
      case 'sauvegardes':
        return (
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton
              titre="Ouvrir les sauvegardes"
              variante="discret"
              testID="ouvrir-sauvegardes"
              onPress={depuisParametres(() => naviguer('sauvegarde'))}
            />
          </View>
        );
      case 'tsuzuku-tmdb':
        return <ReglageCleTmdb theme={themeDuHub} base={baseProfil} />;
      case 'tsuzuku-lecture':
        return <ReglageLectureTsuzuku theme={themeDuHub} base={baseProfil} />;
      case 'confidentialite':
        return profils?.transparence ? <BandeauConfidentialite theme={themeDuHub} transparence={profils.transparence} /> : null;
      case 'cours-intervalle':
        return (
          <ReglageIntervalle
            intervalle={intervalleS}
            onChoisir={secondes => {
              depot().ecrire(PARAMETRES.intervalleActualisation, String(secondes));
              rafraichir();
            }}
          />
        );
      case 'cours-fournisseur':
        return (
          <ReglageFournisseur
            fournisseurs={FOURNISSEURS}
            fournisseurActuel={depot().lire(PARAMETRES.fournisseurCours)}
            cleEnregistree={Boolean(depot().lire(PARAMETRES.cleApiCours))}
            onEnregistrer={enregistrerReglages}
          />
        );
      case 'symboles':
        return (
          <ReglageSymboles
            sansSymbole={
              (contenuComplet?.etat.positions ?? []).filter(position => {
                const titre = contenuComplet?.titres.find(valeur => valeur.id === position.titreId);
                return !titre?.ticker?.trim();
              }).length
            }
            onSymboles={depuisParametres(() => {
              setAppHub(ID_PORTEFEUILLE);
              setRecherche(undefined);
              setErreurSymboles(undefined);
              setEcran('symboles');
            })}
          />
        );
      case 'historique-cours':
        return (
          <ReglageHistorique
            onCharger={lancerChargementHistorique}
            avecSymbole={(contenuComplet?.titres ?? []).filter(titre => titre.ticker?.trim()).length}
            enCours={histoEnCours}
            message={messageHistorique}
          />
        );
      case 'export-excel':
        return pontEnregistrerSous ? (
          <ReglageExport
            message={messageExport}
            onExporter={() => {
              const contenuActuel = chargerEtat(session.base());
              const octets = exporterExcel({
                etat: contenuActuel.etat,
                comptes: contenuActuel.comptes,
                titres: contenuActuel.titres,
                transactions: contenuActuel.transactions,
                cours: new DepotCours(session.base()).derniersCours(),
              });
              pontEnregistrerSous(`AppDashboard ${(aujourdhui ?? dateDuJour)()}.xlsx`, octets)
                .then(enregistre => setMessageExport(enregistre ? '✅ Fichier Excel enregistré.' : 'Export annulé.'))
                .catch((e: unknown) => setMessageExport(`L’export a échoué : ${e instanceof Error ? e.message : String(e)}`));
            }}
          />
        ) : null;
      case 'discretion':
        return <ReglageDiscretion discret={discret} onBasculer={basculerDiscretion} />;
      case 'notifications':
        return contenuNotifications();
      case 'podcast':
        return (
          <ReglagePodcast
            heureAuto={depot().lire(PARAMETRES.podcastAuto) || undefined}
            onChanger={heure => {
              if (heure) {
                depot().ecrire(PARAMETRES.podcastAuto, heure);
              } else {
                depot().supprimer(PARAMETRES.podcastAuto);
              }
              rafraichir();
            }}
          />
        );
      case 'admin-panel':
        return <ReglageAdminPanel theme={themeDuHub} onOuvrir={depuisParametres(() => ouvrirApp('administration'))} />;
      case 'admin-reglages':
        return servicesAdmin ? <ReglagesAdministration theme={themeDuHub} services={servicesAdmin} acteur={profils?.actuel} /> : null;
      case 'admin-comptes':
        return profils ? <CarteProfils controle={profils} /> : null;
      case 'role-gestionnaire':
        return <BandeauRole theme={themeDuHub} />;
      case 'nouveautes':
        return <ReglageNouveautes theme={themeDuHub} onOuvrir={() => setDevblog({})} />;
      case 'version':
        return <ReglageVersion theme={themeDuHub} />;
      case 'mise-a-jour':
        return <ReglageMiseAJour theme={themeDuHub} maj={maj} />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics ?? METRIQUES_DE_REPLI}>
      <SafeAreaView
        style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
        <StatusBar barStyle={palettePour().sombre === false ? 'dark-content' : 'light-content'} />

      <Coque
        destinations={deverrouille && contenuComplet && tableau && !surLeHub && !surUneApp && !surParametres ? destinations : []}
        enTete={barreApp}
        actif={destinationActive}
        onNaviguer={naviguer}
        onVerrouiller={deverrouille && contenuComplet && tableau && !surLeHub && !surUneApp && !surParametres ? verrouiller : undefined}
        discret={discret}
        onBasculerDiscretion={deverrouille && contenuComplet && tableau && !surLeHub && !surUneApp && !surParametres ? basculerDiscretion : undefined}
        flottant={ecran !== 'podcast' && !surLeHub && !surUneApp && !surParametres ? <LecteurFlottant onOuvrir={() => setEcran('podcast')} /> : null}>
      {deverrouille && contenuComplet && tableau ? (
        <VisiteGuidee
          visible={etapesVisite !== undefined}
          etapes={etapesVisite}
          onNaviguer={(cle, onglet) => {
            naviguer(cle);
            if (onglet) {
              setOngletPortefeuille(onglet as OngletPortefeuille);
            }
          }}
          onVue={id => {
            const depot = new DepotParametres(session.base());
            depot.ecrire(PARAMETRES.visiteVue, marquerVues(depot.lire(PARAMETRES.visiteVue), [id]));
          }}
          onTerminer={() => {
            // Passer la visite vaut aussi pour les étapes restantes : elles ne reviennent pas.
            const depot = new DepotParametres(session.base());
            depot.ecrire(
              PARAMETRES.visiteVue,
              marquerVues(depot.lire(PARAMETRES.visiteVue), (etapesVisite ?? []).map(etape => etape.id)),
            );
            setEtapesVisite(undefined);
          }}
        />
      ) : null}
      {avisRecuperation && deverrouille ? (
        <View style={{ padding: ESPACEMENT.m, paddingBottom: 0 }}>
          <Carte>
            <Text style={{ color: palettePour().texte }} testID="avis-recuperation">
              {avisRecuperation}
            </Text>
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton titre="Compris" variante="discret" onPress={() => setAvisRecuperation(undefined)} />
            </View>
          </Carte>
        </View>
      ) : null}
      {profils && (profils.peutChanger ?? profils.tous.length > 1) && !deverrouille && !secrets ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: ESPACEMENT.s, paddingTop: ESPACEMENT.m }}>
          <Text style={{ color: palettePour().texteSecondaire }} testID="profil-ouvert">
            Compte : {profils.actuel.nom}
          </Text>
          <Bouton titre="Changer de compte" variante="discret" onPress={profils.onChanger} testID="changer-profil-verrou" />
        </View>
      ) : null}
      {secrets ? (
        <PremierLancement
          onCreer={creer}
          secrets={secrets}
          onTermine={() => {
            setSecrets(undefined);
            rafraichir();
          }}
        />
      ) : statut === 'non-initialise' ? (
        <PremierLancement onCreer={creer} enCours={enCours} erreur={erreur} lier={lier} />
      ) : !contenu || !tableau ? (
        enRecuperation ? (
          <Recuperation
            onRecuperer={recuperer}
            onAnnuler={() => {
              setErreur(undefined);
              setEnRecuperation(false);
            }}
            erreur={erreur}
            enCours={enCours}
          />
        ) : (
          <Deverrouillage
            onDeverrouiller={deverrouiller}
            onRecuperer={() => {
              setErreur(undefined);
              setEnRecuperation(true);
            }}
            erreur={erreur}
            enCours={enCours}
            secondesAvantNouvelEssai={verrou?.verrouille ? verrou.secondesRestantes : 0}
            lier={lier}
            message={messageDeverrouillage}
            suggererAutreCoffre={Boolean(profils?.lier?.suggererAutreCoffre)}
          />
        )
      ) : surParametres ? (
        <GardeErreur quoi="les paramètres" onRevenir={fermerParametres}>
          <PageParametres
            theme={themeDuHub}
            section={parametres?.section}
            n={parametres?.n}
            disponibles={disponiblesParametres}
            rendu={renduParametres}
            synchro={synchroHub}
            actif={!devblog}
            onFermer={fermerParametres}
          />
        </GardeErreur>
      ) : surLeHub ? (
        <GardeErreur quoi="le hub" onRevenir={profils?.onChanger}>
        <Hub
          registre={REGISTRE}
          contexte={contexteHub}
          theme={themeDuHub}
          onTheme={choisirTheme}
          onOuvrir={ouvrirApp}
          prefs={prefsHub}
          onPrefs={suivant => {
            setPrefsHub(suivant);
            enregistrerPrefs(stockagePrefs, suivant);
            memoriserAffichage(stockageLocalAppareil(), cleLocale(CLE_CACHE_AFFICHAGE), suivant);
          }}
          onVerrouiller={verrouiller}
          onParametres={ouvrirParametres}
          synchro={synchroHub}
          demande={demandeHub}
          onChangerProfil={profils && (profils.peutChanger ?? profils.tous.length > 1) ? profils.onChanger : undefined}
        />
        </GardeErreur>
      ) : appOuverte?.Racine ? (
        <GardeErreur quoi={appOuverte.nom} onRevenir={profils?.onChanger}>
        <BarreAppContexte.Provider value={barreApp}>
        <appOuverte.Racine
          contexte={contexteHub}
          theme={themeDuHub}
          registre={REGISTRE}
          onRetour={() => setAppHub(undefined)}
          niveau={niveauProfil(profils?.actuel, appOuverte)}
          onTheme={choisirTheme}
          onParametres={ouvrirParametres}
        />
        </BarreAppContexte.Provider>
        </GardeErreur>
      ) : ecran === 'compte' ? (
        <CreationCompte
          key={compteEdite ?? 'nouveau'}
          comptesExistants={contenuComplet!.comptes}
          onCreer={enregistrerCompte}
          onAnnuler={contenuComplet!.comptes.length > 0 ? () => setEcran('tableau') : undefined}
          genererId={() => identifiant('compte')}
          compteAModifier={contenuComplet!.comptes.find(compte => compte.id === compteEdite)}
          nombreOperations={contenuComplet!.transactions.filter(transaction => transaction.compteId === compteEdite).length}
          onSupprimer={compteEdite ? () => supprimerCompte(compteEdite) : undefined}
        />
      ) : ecran === 'titre' ? (
        <CreationTitre
          titresExistants={contenuComplet!.titres}
          onCreer={enregistrerTitre}
          onAnnuler={() => setEcran('saisie')}
          genererId={() => identifiant('titre')}
        />
      ) : ecran === 'saisie' ? (
        <SaisieOperation
          key={saisieInitiale ? 'pre-rempli' : 'vide'}
          initial={saisieInitiale}
          comptes={contenuComplet!.comptes}
          titres={contenuComplet!.titres}
          positions={contenuComplet!.etat.positions}
          onEnregistrer={transaction => {
            // Après le versement du mois, on revient voir quoi acheter.
            const retour = saisieInitiale?.type === 'VERSEMENT';
            setSaisieInitiale(undefined);
            enregistrerOperation(transaction);
            if (retour) setEcran('objectifs');
          }}
          onAnnuler={() => {
            setSaisieInitiale(undefined);
            setEcran('tableau');
          }}
          onCreerTitre={() => setEcran('titre')}
          genererId={() => identifiant('op')}
        />
      ) : ecran === 'fiche' && fiche ? (
        <FicheValeur
          symbole={fiche.symbole}
          vue={fiche.vue}
          chargement={fiche.chargement}
          erreur={fiche.erreur}
          onRetour={() => setEcran('tableau')}
          onRecharger={
            fiche.erreur?.includes('symbole boursier')
              ? undefined
              : () => ouvrirSymbole(fiche.symbole, fiche.titreId, true)
          }
          chargerTheses={chargerThesesValeur}
          lienBaggr={
            (contenuComplet?.titres ?? []).find(titre => titre.id === fiche.titreId)?.lienExterne ?? ACCUEIL_BAGGR
          }
          onSurveiller={
            fiche.vue
              ? () => {
                  // Depuis la fiche, même une valeur inconnue du portefeuille se
                  // met en surveillance : elle est créée au besoin.
                  const donnees = fichesEnCache.current.get(fiche.symbole)?.fiche;
                  surveillerCandidatSur({
                    symbole: fiche.symbole,
                    nom: donnees?.nom ?? fiche.vue!.entete.nom,
                    place: donnees?.bourse ?? '',
                    devise: donnees?.devise,
                    paris: fiche.symbole.toUpperCase().endsWith('.PA'),
                  });
                }
              : undefined
          }
          surveillee={symboleSurveille(fiche.symbole)}
        />
      ) : ecran === 'objectifs' && contenuComplet && depotCours ? (
        <Objectifs
          objectif={objectifDepuisJson(new DepotParametres(session.base()).lire(PARAMETRES.objectif))}
          valeurActuelle={capitalActuel.toNumber()}
          aujourdhui={(aujourdhui ?? dateDuJour)()}
          onEnregistrerObjectif={objectif => {
            const parametres = new DepotParametres(session.base());
            if (objectif) {
              parametres.ecrire(PARAMETRES.objectif, JSON.stringify(objectif));
            } else {
              parametres.supprimer(PARAMETRES.objectif);
            }
            rafraichir();
          }}
          lignes={lignesCibles(contenuComplet, depotCours.derniersCours(), new DepotParametres(session.base()).lire(PARAMETRES.repartitionCible))}
          versementMensuel={reglageVersementDepuisJson(new DepotParametres(session.base()).lire(PARAMETRES.versementMensuel))}
          comptes={contenuComplet.comptes.map(compte => ({ id: compte.id, nom: compte.nom }))}
          onEnregistrerVersement={reglage => {
            new DepotParametres(session.base()).ecrire(PARAMETRES.versementMensuel, JSON.stringify(reglage));
            rafraichir();
          }}
          onSaisirVersement={() => {
            const reglage = reglageVersementDepuisJson(new DepotParametres(session.base()).lire(PARAMETRES.versementMensuel));
            setSaisieInitiale({
              type: 'VERSEMENT',
              compteId: reglage.compteId ?? contenuComplet.comptes[0]?.id ?? '',
              montant: String(reglage.montant).replace('.', ','),
              date: dateSaisie((aujourdhui ?? dateDuJour)()),
              note: 'Versement mensuel',
            });
            setEcran('saisie');
          }}
          onChangerCible={(titreId, cible) => {
            const parametres = new DepotParametres(session.base());
            let cibles: Record<string, string> = {};
            try {
              cibles = JSON.parse(parametres.lire(PARAMETRES.repartitionCible) ?? '{}');
            } catch {
              cibles = {};
            }
            cibles[titreId] = cible;
            parametres.ecrire(PARAMETRES.repartitionCible, JSON.stringify(cibles));
          }}
        />
      ) : ecran === 'podcast' ? (
        <Podcast
          episode={podcast.episode}
          chargement={podcast.chargement}
          etape={podcast.etape}
          erreur={podcast.erreur}
          minutes={podcast.minutes}
          onGenerer={minutes => genererPodcast(minutes)}
          onOuvrirParametres={() => ouvrirParametres('portefeuille')}
        />
      ) : ecran === 'comparateur' ? (
        <ComparateurFinancier
          societes={societesComparees.map(symbole => {
            const donnees = fichesEnCache.current.get(symbole);
            const erreurSociete = erreursComparaison.current.get(symbole);
            return {
              symbole,
              nom: donnees?.fiche.nom ?? symbole,
              comptes: donnees?.comptes,
              chargement: !donnees && !erreurSociete,
              erreur: erreurSociete,
            };
          })}
          suggestions={(contenuComplet?.titres ?? [])
            .filter(titre => titre.ticker?.trim())
            .map(titre => ({ symbole: titre.ticker.trim(), nom: titre.nom }))}
          onAjouter={ajouterSociete}
          onRetirer={symbole =>
            setSocietesComparees(precedentes => precedentes.filter(s => s !== symbole))
          }
          onRechercher={rechercherActions}
          onRetour={() => setEcran('tableau')}
          comparaisonCours={
            <Comparateur
          vue={construireComparateur({
            retenus: compares,
            titres: contenuComplet?.titres ?? [],
            etat: contenuComplet?.etat ?? ETAT_VIDE,
            cours: depotCours?.derniersCours() ?? new Map(),
            historique: depotCours?.historique() ?? new Map(),
            dividendesDouzeMois: dividendesParTitre(
              contenuComplet?.transactions ?? [],
              (aujourdhui ?? dateDuJour)(),
            ),
            surveilles: new Set(
              new DepotWatchlist(session.base()).lister().map(ligne => ligne.titreId),
            ),
          })}
          onBasculer={basculerComparaison}
          onRetour={() => setEcran('tableau')}
            />
          }
        />
      ) : ecran === 'symboles' ? (
        <Symboles
          titres={(contenuComplet?.titres ?? []).map(titre => ({
            titreId: titre.id,
            nom: titre.nom,
            isin: titre.isin,
            symbole: titre.ticker ?? '',
            detenue: (contenuComplet?.etat.positions ?? []).some(
              position => position.titreId === titre.id,
            ),
            lien: titre.lienExterne ?? '',
          }))}
          recherche={recherche}
          onChercher={chercherSymbole}
          onRetenir={retenirSymbole}
          onEffacer={effacerSymbole}
          onChangerLien={enregistrerLien}
          onRetour={() => {
            setEcran('tableau');
            ouvrirParametres('portefeuille');
          }}
          erreur={erreurSymboles}
        />
      ) : ecran === 'watchlist' ? (
        <Watchlist
          vue={construireWatchlist({
            watchlist: new DepotWatchlist(session.base()).lister(),
            titres: contenuComplet?.titres ?? [],
            cours: depotCours?.derniersCours() ?? new Map(),
            titresDetenus: new Set(
              (contenuComplet?.etat.positions ?? []).map(position => position.titreId),
            ),
            seuils: lireSeuils(session),
          })}
          onAjouter={surveiller}
          onRetirer={nePlusSurveiller}
          onChangerSeuil={enregistrerSeuil}
          onCreerTitre={() => setEcran('titre')}
          onRechercher={() => setEcran('recherche')}
          chargerTheses={chargerThesesValeur}
          chargerFiche={chargerVueFiche}
          onOuvrirFiche={symbole =>
            ouvrirSymbole(
              symbole,
              (contenuComplet?.titres ?? []).find(titre => titre.ticker.toUpperCase() === symbole.toUpperCase())?.id,
            )
          }
          onRetour={() => setEcran('tableau')}
        />
      ) : ecran === 'diagnostic' ? (
        <Diagnostic tests={testsDuBureau()} />
      ) : ecran === 'journal' ? (
        <Journal
          vue={construireJournal({
            transactions: contenuComplet?.transactions ?? [],
            titres: contenuComplet?.titres ?? [],
            cours: depotCours?.derniersCours() ?? new Map(),
            carnet: carnetDepuisJson(new DepotParametres(session.base()).lire(PARAMETRES.carnetTheses)),
          })}
          onNoter={(transactionId, note) => {
            const depot = new DepotTransactions(session.base());
            const transaction = depot.toutes().find(candidate => candidate.id === transactionId);
            if (!transaction) return;
            depot.enregistrer({ ...transaction, note: note || undefined });
            rafraichir();
          }}
        />
      ) : ecran === 'carnet' ? (
        <Carnet
          lignes={lignesCarnet()}
          aujourdhui={(aujourdhui ?? dateDuJour)()}
          onEnregistrer={(titreId, these) => {
            const parametres = new DepotParametres(session.base());
            const carnet = carnetDepuisJson(parametres.lire(PARAMETRES.carnetTheses));
            if (these) carnet[titreId] = these;
            else delete carnet[titreId];
            parametres.ecrire(PARAMETRES.carnetTheses, JSON.stringify(carnet));
            rafraichir();
          }}
        />
      ) : ecran === 'screener' ? (
        <Screener
          chargerScreener={chargerScreener}
          surveilles={symbolesSurveilles()}
          erreurAjout={erreurAjout}
          onSurveiller={action =>
            surveillerCandidatSur({
              symbole: action.symbole,
              nom: action.nom,
              place: action.place,
              devise: action.devise,
              paris: action.symbole.toUpperCase().endsWith('.PA'),
            })
          }
          onOuvrirFiche={symbole =>
            ouvrirSymbole(
              symbole,
              (contenuComplet?.titres ?? []).find(titre => titre.ticker.toUpperCase() === symbole.toUpperCase())?.id,
            )
          }
        />
      ) : ecran === 'recherche' ? (
        <Recherche
          onRechercher={rechercherActions}
          surveilles={symbolesSurveilles()}
          onSurveiller={surveillerCandidatSur}
          erreurAjout={erreurAjout}
          onOuvrirFiche={symbole =>
            ouvrirSymbole(
              symbole,
              (contenuComplet?.titres ?? []).find(titre => titre.ticker.toUpperCase() === symbole.toUpperCase())?.id,
            )
          }
          chargerTheses={chargerThesesValeur}
          historique={historiqueDepuisJson(new DepotParametres(session.base()).lire(PARAMETRES.historiqueRecherche))}
          onNoterHistorique={entree => {
            const parametres = new DepotParametres(session.base());
            parametres.ecrire(
              PARAMETRES.historiqueRecherche,
              JSON.stringify(
                ajouterHistorique(historiqueDepuisJson(parametres.lire(PARAMETRES.historiqueRecherche)), {
                  ...entree,
                  quand: (aujourdhui ?? dateDuJour)(),
                }),
              ),
            );
            rafraichir();
          }}
          onEffacerHistorique={() => {
            new DepotParametres(session.base()).supprimer(PARAMETRES.historiqueRecherche);
            rafraichir();
          }}
        />
      ) : ecran === 'projection' ? (
        <Projection
          champs={champsProjection}
          vue={construireProjection({ champs: champsProjection, capitalActuel })}
          capitalActuel={tableau?.valeurTotale ?? '0,00 €'}
          onChanger={(champ, valeur) =>
            setChampsProjection(precedent => ({ ...precedent, [champ]: valeur }))
          }
          onRetour={() => setEcran('tableau')}
        />
      ) : ecran === 'sauvegarde' ? (
        <Sauvegarde
          disponible={Boolean(fichiers)}
          emplacement={dossierSauvegardes}
          automatique={{
            active: Boolean(new DepotParametres(session.base()).lire(PARAMETRES.sauvegardeAutoMotDePasse)),
            derniere: new DepotParametres(session.base()).lire(PARAMETRES.sauvegardeAutoDerniere),
            aujourdhui: (aujourdhui ?? dateDuJour)(),
          }}
          onOuvrirParametres={() => ouvrirParametres('securite')}
          onOuvrirDossier={pontSauvegardes?.ouvrirDossier ? () => void pontSauvegardes.ouvrirDossier!() : undefined}
          sauvegardes={sauvegardes}
          onCreer={creerSauvegarde}
          onRestaurer={restaurerSauvegarde}
          onFusionner={fusionnerSauvegarde}
          onSupprimer={chemin => {
            if (fichiers) {
              supprimerSauvegarde(fichiers, chemin).then(rafraichirSauvegardes);
            }
          }}
          onRetour={() => setEcran('tableau')}
          message={messageSauvegarde}
          erreur={erreurSauvegarde}
          enCours={sauvegardeEnCours}
        />
      ) : ecran === 'import' ? (
        <ImportPositions
          onImporter={enregistrerImport}
          onAnnuler={() => setEcran('tableau')}
          operations={
            contenuComplet && contenuComplet.comptes[0]
              ? {
                  contexte: {
                    compteId: contenuComplet.comptes[0].id,
                    devise: contenuComplet.comptes[0].devise,
                    titres: contenuComplet.titres,
                    existantes: contenuComplet.transactions,
                    genererId: identifiant,
                  },
                  onImporter: (apercu, remplacerReprise) => {
                    const base = session.base();
                    const compte = contenuComplet.comptes[0];
                    const depotTitres = new DepotTitres(base);
                    for (const nouveau of apercu.nouveauxTitres) {
                      depotTitres.enregistrer({
                        id: nouveau.id,
                        isin: nouveau.isin,
                        nom: nouveau.nom,
                        ticker: '',
                        deviseCotation: compte.devise,
                        eligiblePEA: true,
                      });
                    }
                    const depot = new DepotTransactions(base);
                    if (remplacerReprise) {
                      for (const ancienne of apercu.reprise) {
                        depot.supprimer(ancienne.id);
                      }
                    }
                    depot.enregistrerLot(apercu.transactions);
                    setEcran('tableau');
                    setImportsRecents(nombre => nombre + 1);
                    rafraichir();
                  },
                }
              : undefined
          }
        />
      ) : (
        <Portefeuille
          dashboard={tableau}
          resume={onglets!.resume}
          analyse={analyse}
          onglet={ongletPortefeuille}
          onChangerOnglet={setOngletPortefeuille}
          aujourdhui={(aujourdhui ?? dateDuJour)()}
          optionsComptes={(contenuComplet?.comptes ?? []).map(compte => ({
            valeur: compte.id,
            libelle: compte.nom,
          }))}
          compteActif={compteVu ? compteVu.id : TOUS_LES_COMPTES}
          onChoisirCompte={setCompteFiltre}
          optionsIndices={INDICES.map(option => ({ valeur: option.id, libelle: option.nom }))}
          indiceActif={indiceRetenu}
          onChoisirIndice={choisirIndice}
          onChargerHistorique={lancerChargementHistorique}
          onOuvrirTitre={ouvrirTitre}
          onRechercher={rechercherActions}
          onOuvrirSymbole={symbole => ouvrirSymbole(symbole)}
          chargementHistorique={histoEnCours}
          messageHistorique={messageHistorique}
          performance={onglets!.performance}
          siIndice={onglets!.siIndice}
          comparaison={onglets!.comparaison}
          onChoisirReference={choisirReference}
          anneesRapport={contenu ? anneesDisponibles(contenu.transactions) : []}
          onGenererRapport={genererRapport}
          messageRapport={messageRapport}
          dividendes={onglets!.dividendes}
          risque={onglets!.risque}
          flux={onglets!.flux}
          impots={onglets!.impots}
          ventes={onglets!.ventes}
          onRecupererAppareils={synchro.configure ? undefined : () => ouvrirParametres('synchro')}
          onCreerCompte={() => {
            setCompteEdite(undefined);
            setEcran('compte');
          }}
          onModifierCompte={compteId => {
            setCompteEdite(compteId);
            setEcran('compte');
          }}
          onAjouterTransaction={() => setEcran('saisie')}
          onImporter={() => setEcran('import')}
          onReglages={() => ouvrirParametres('portefeuille')}
          onSauvegarder={() => {
            rafraichirSauvegardes();
            setEcran('sauvegarde');
          }}
          onNotifications={() => ouvrirParametres('portefeuille')}
          onProjection={() => setEcran('projection')}
          onWatchlist={() => setEcran('watchlist')}
          onComparer={() => setEcran('comparateur')}
          onRafraichirCours={lancerRafraichissement}
          messageCours={messageCours}
          coursActualisesA={coursActualisesA}
          fraisEtf={fraisEtfSaisis(new DepotParametres(session.base()).lire(PARAMETRES.fraisEtf))}
          onChangerFraisEtf={(titreId, taux) => {
            const parametres = new DepotParametres(session.base());
            let frais: Record<string, string> = {};
            try {
              frais = JSON.parse(parametres.lire(PARAMETRES.fraisEtf) ?? '{}');
            } catch {
              frais = {};
            }
            frais[titreId] = taux;
            parametres.ecrire(PARAMETRES.fraisEtf, JSON.stringify(frais));
          }}
          rafraichissementEnCours={coursEnCours}
          onVerrouiller={verrouiller}
        />
        )}
      </Coque>
      {devblog && deverrouille ? (
        <Devblog
          theme={themeDuHub}
          admin={estAdmin}
          gestionnaire={estGestionnaire}
          entree={devblog.entree}
          onFermer={fermerDevblog}
          onEssayer={essayer}
          onVisite={entree => {
            fermerDevblog();
            setEtapesVisite(etapesDevblog(entree, estAdmin, estGestionnaire));
          }}
          disponible={cible => cible.genre !== 'app' || appsVisibles(REGISTRE, contexteHub).some(app => app.id === cible.app)}
        />
      ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
