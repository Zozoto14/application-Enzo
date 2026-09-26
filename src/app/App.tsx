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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'react-native';
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
import { ErreurFusion, fusionnerDansBase } from '../sync/application';
import { resumerFusion } from '../sync/fusion';
import { creerGenerateurId, identifiantAppareil } from '../sync/identite';
import { chargerHistoriques, resumeHistorique } from '../cours/historique';
import {
  INDICE_DEFAUT,
  INDICES,
  indiceParId,
  plagePour,
  separerHistorique,
} from '../cours/indices';
import { rejouer, type EtatPortefeuille } from '../core/portfolio/engine';
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
import { objectifDepuisJson, type LigneCible } from '../ui/vues/objectifs';
import { preparerEpisode } from '../podcast/donnees';
import type { Episode } from '../podcast/episode';
import { chargerActualites } from '../fondamentaux/actualites';
import { construireComparateur } from '../ui/vues/comparateur';
import { Projection } from '../ui/ecrans/Projection';
import { Symboles } from '../ui/ecrans/Symboles';
import { Watchlist } from '../ui/ecrans/Watchlist';
import { Recherche } from '../ui/ecrans/Recherche';
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
import { Reglages } from '../ui/ecrans/Reglages';
import { Sauvegarde } from '../ui/ecrans/Sauvegarde';
import { Notifications, type SeuilAffiche } from '../ui/ecrans/Notifications';
import {
  planningDepuisJson,
  planningVersJson,
  prochainBriefing,
  type Planning,
} from '../notifications/planification';
import { executerReveil } from '../notifications/reveil';
import { rappelsDus, retenirRappels } from '../notifications/rappelVerrouille';
import { composerBriefing } from '../notifications/briefing';
import {
  alerteVariation,
  canalBureau,
  etatDepuisJson,
  seuilVariation,
  seuilsDepuisJson,
  variationSeance,
  type PontNotifications,
} from '../notifications/bureau';
import { chargerModule } from '../natif/modules';
import { gestionnaireDepuisFs } from '../maj/application';
import { systemeDepuisRnfs } from '../fichiers/systeme';
import { exporterDepuisBase, restaurerDansBase } from '../sauvegarde/depot';
import { ouvrirArchive } from '../sauvegarde/archive';
import {
  ecrireSauvegarde,
  lireSauvegarde,
  listerSauvegardes,
  supprimerSauvegarde,
  type SauvegardeSurDisque,
} from '../sauvegarde/fichiers';
import { SaisieOperation } from '../ui/ecrans/SaisieOperation';
import {
  PremierLancement,
  type SecretsInitiaux,
} from '../ui/ecrans/PremierLancement';
import { definirTheme, palettePour, stylesPartages, themeCourant } from '../ui/theme';

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
  | 'symboles'
  | 'comparateur'
  | 'fiche'
  | 'podcast'
  | 'objectifs';

/**
 * Lignes de l'écran Objectifs : une par valeur détenue (tous comptes),
 * avec sa cible enregistrée, ou son poids actuel à défaut.
 */
function lignesCibles(
  contenu: { etat: EtatPortefeuille; titres: readonly Titre[] },
  cours: ReadonlyMap<string, Decimal>,
  ciblesBrutes: string | undefined,
): LigneCible[] {
  let cibles: Record<string, string> = {};
  try {
    cibles = JSON.parse(ciblesBrutes ?? '{}');
  } catch {
    cibles = {};
  }
  const { valorisees } = valoriserPositions(contenu.etat.positions, cours);
  const parTitre = new Map<string, number>();
  for (const position of valorisees) {
    parTitre.set(position.titreId, (parTitre.get(position.titreId) ?? 0) + position.valeurMarche.toNumber());
  }
  const total = [...parTitre.values()].reduce((somme, valeur) => somme + valeur, 0);
  return [...parTitre.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([titreId, valeur]) => {
      const saisie = Number((cibles[titreId] ?? '').replace(',', '.'));
      return {
        titreId,
        nom: contenu.titres.find(titre => titre.id === titreId)?.nom ?? titreId,
        valeur,
        cible: cibles[titreId] !== undefined && Number.isFinite(saisie)
          ? saisie
          : total > 0 ? Math.round((valeur / total) * 1000) / 10 : 0,
        cours: cours.get(titreId)?.toNumber(),
      };
    });
}

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

/**
 * Dividendes encaisses sur douze mois glissants, par titre.
 * Le comparateur en a besoin pour rapporter un rendement au prix de revient.
 */
function dividendesParTitre(
  transactions: readonly Transaction[],
  aujourdhui: string,
): Map<string, Decimal> {
  const [annee, mois, jour] = aujourdhui.split('-');
  const debut = `${Number(annee) - 1}-${mois}-${jour}`;

  const cumuls = new Map<string, Decimal>();
  for (const transaction of transactions) {
    if (transaction.type !== 'DIVIDENDE' || transaction.date <= debut) {
      continue;
    }
    cumuls.set(
      transaction.titreId,
      (cumuls.get(transaction.titreId) ?? Decimal.ZERO).add(transaction.montantNet),
    );
  }
  return cumuls;
}

/** Copie du planning et rappels envoyés : hors du coffre, lisibles verrouillé. */
const CLE_PLANNING_LOCAL = 'applibourse.planningBriefings';
const CLE_RAPPELS_LOCAL = 'applibourse.rappelsBriefing';
type StockageLocal = { getItem(cle: string): string | null; setItem(cle: string, valeur: string): void };
function stockageLocal(): StockageLocal | undefined {
  try {
    return (globalThis as { localStorage?: StockageLocal }).localStorage;
  } catch {
    return undefined;
  }
}

export function App({ session, genererId, aujourdhui, chargementAutomatique = false }: AppProps) {
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
  const [sauvegardes, setSauvegardes] = useState<SauvegardeSurDisque[]>([]);
  const [messageSauvegarde, setMessageSauvegarde] = useState<string | undefined>();
  const [erreurSauvegarde, setErreurSauvegarde] = useState<string | undefined>();
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
  const [sauvegardeEnCours, setSauvegardeEnCours] = useState(false);
  const [messageNotifications, setMessageNotifications] = useState<string | undefined>();

  const rafraichir = useCallback(() => forcerRendu(n => n + 1), []);

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

  const creer = useCallback(
    (motDePasse: string) =>
      executer(() => setSecrets(session.initialiser({ motDePasse }))),
    [executer, session],
  );

  const deverrouiller = useCallback(
    (motDePasse: string, codeTotp: string) =>
      executer(() => session.deverrouiller({ motDePasse, codeTotp })),
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

  /**
   * Systeme de fichiers de l'appareil, absent sur un binaire compile sans
   * react-native-fs et dans les tests. L'ecran de sauvegarde le dit plutot que
   * d'echouer silencieusement.
   */
  const fichiers = systemeDepuisRnfs(
    chargerModule<unknown>('react-native-fs').module,
  );

  const rafraichirSauvegardes = useCallback(() => {
    if (!fichiers) {
      return;
    }
    listerSauvegardes(fichiers)
      .then(setSauvegardes)
      .catch(() => setSauvegardes([]));
  }, [fichiers]);

  const creerSauvegarde = useCallback(
    (motDePasse: string) => {
      if (!fichiers) {
        return;
      }
      setSauvegardeEnCours(true);
      setErreurSauvegarde(undefined);
      setMessageSauvegarde(undefined);

      apresRendu(() => {
        try {
          const archive = exporterDepuisBase(session.base(), {
            motDePasse,
            date: (aujourdhui ?? dateDuJour)(),
          });
          ecrireSauvegarde(fichiers, archive)
            .then(ecrite => {
              setMessageSauvegarde(`Sauvegarde créée : ${ecrite.nom}`);
              rafraichirSauvegardes();
            })
            .catch((e: unknown) =>
              setErreurSauvegarde(e instanceof Error ? e.message : String(e)),
            )
            .finally(() => setSauvegardeEnCours(false));
        } catch (e) {
          setErreurSauvegarde(e instanceof Error ? e.message : String(e));
          setSauvegardeEnCours(false);
        }
      });
    },
    [fichiers, session, aujourdhui, rafraichirSauvegardes],
  );

  const fusionnerSauvegarde = useCallback(
    (chemin: string, motDePasse: string) => {
      if (!fichiers) {
        return;
      }
      setSauvegardeEnCours(true);
      setErreurSauvegarde(undefined);
      setMessageSauvegarde(undefined);

      lireSauvegarde(fichiers, chemin)
        .then(archive => {
          const lecture = ouvrirArchive(archive, motDePasse);
          if (!lecture.ouverte) {
            setErreurSauvegarde(lecture.motif);
            return;
          }

          const fusion = fusionnerDansBase(session.base(), lecture.contenu);
          const resume = resumerFusion(fusion);
          const divergences =
            fusion.conflits.length === 0
              ? ''
              : ` ${fusion.conflits.length} divergence(s) : ${fusion.conflits
                  .map(conflit => `${conflit.nom} (${conflit.champs.join(', ')})`)
                  .join(' ; ')}. Votre version a été gardée.`;
          setMessageSauvegarde(`${resume.texte}${divergences}`);
        })
        .catch((e: unknown) =>
          setErreurSauvegarde(
            e instanceof ErreurFusion || e instanceof Error ? e.message : String(e),
          ),
        )
        .finally(() => {
          setSauvegardeEnCours(false);
          rafraichir();
        });
    },
    [fichiers, session, rafraichir],
  );

  const restaurerSauvegarde = useCallback(
    (chemin: string, motDePasse: string) => {
      if (!fichiers) {
        return;
      }
      setSauvegardeEnCours(true);
      setErreurSauvegarde(undefined);
      setMessageSauvegarde(undefined);

      lireSauvegarde(fichiers, chemin)
        .then(archive => {
          const lecture = ouvrirArchive(archive, motDePasse);
          if (!lecture.ouverte) {
            setErreurSauvegarde(lecture.motif);
            return;
          }
          const rapport = restaurerDansBase(session.base(), lecture.contenu);
          setMessageSauvegarde(
            `Restauration terminée : ${rapport.comptes} compte(s), ${rapport.transactions} opération(s).`,
          );
          setEcran('tableau');
          rafraichir();
        })
        .catch((e: unknown) =>
          setErreurSauvegarde(e instanceof Error ? e.message : String(e)),
        )
        .finally(() => setSauvegardeEnCours(false));
    },
    [fichiers, session, rafraichir],
  );

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
          isin: '',
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

  const enregistrerPlanning = useCallback(
    (planning: Planning) => {
      new DepotParametres(session.base()).ecrire(
        PARAMETRES.planningBriefings,
        planningVersJson(planning),
      );
      try {
        stockageLocal()?.setItem(CLE_PLANNING_LOCAL, planningVersJson(planning));
      } catch {
        // Rappel verrouillé indisponible : sans conséquence.
      }
      rafraichir();
    },
    [session, rafraichir],
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

  const deverrouille = statut === 'deverrouille' && !secrets;

  // Thème : lu à chaque rendu déverrouillé, appliqué avant de dessiner.
  const themeEnregistre = deverrouille
    ? new DepotParametres(session.base()).lire(PARAMETRES.theme)
    : undefined;
  if (deverrouille && (themeEnregistre ?? 'classique') !== themeCourant()) {
    definirTheme(themeEnregistre);
  }

  // Mode discret : lu avant de construire les vues, qui formatent les montants.
  const discret = deverrouille && new DepotParametres(session.base()).lire(PARAMETRES.discretion) === '1';
  definirDiscretion(discret);
  const basculerDiscretion = () => {
    new DepotParametres(session.base()).ecrire(PARAMETRES.discretion, discret ? '0' : '1');
    rafraichir();
  };

  // Notifications de l'ordinateur : le pont d'Electron les affiche. Absent
  // sur téléphone (le réveil en arrière-plan s'en charge) et dans les tests.
  const pontNotifications = (globalThis as { applibourse?: { systeme?: PontNotifications } }).applibourse
    ?.systeme;
  const pontDemarrage = (globalThis as { applibourse?: { systeme?: { demarrage?(activer?: boolean): Promise<boolean> } } })
    .applibourse?.systeme?.demarrage;
  const [demarrageAuto, setDemarrageAuto] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    pontDemarrage?.().then(setDemarrageAuto).catch(() => undefined);
  }, [pontDemarrage]);
  const verificationEnCours = useRef(false);
  const verifierNotifications = useCallback(async () => {
    if (!pontNotifications || verificationEnCours.current) {
      return;
    }
    verificationEnCours.current = true;
    try {
      const base = session.base();
      const parametres = new DepotParametres(base);
      const depot = new DepotCours(base);
      const canal = canalBureau(pontNotifications);
      await executerReveil({
        maintenant: new Date(),
        planning: planningDepuisJson(parametres.lire(PARAMETRES.planningBriefings)),
        seuils: seuilsDepuisJson(parametres.lire(PARAMETRES.seuilsAlertes)),
        etatPersiste: etatDepuisJson(parametres.lire(PARAMETRES.etatNotifications)),
        canal,
        lirePortefeuille: async () => {
          const contenuActuel = chargerEtat(base);
          return { etat: contenuActuel.etat, titres: contenuActuel.titres };
        },
        // Les cours viennent d'être actualisés par la boucle des cours en direct.
        rafraichirCours: async () => depot.derniersCours(),
        enregistrer: async etat => parametres.ecrire(PARAMETRES.etatNotifications, JSON.stringify(etat)),
        // Sur l'ordinateur, le briefing part à l'heure dite, même sans mouvement.
        toujoursParler: true,
      });
      try {
        stockageLocal()?.setItem(CLE_PLANNING_LOCAL, parametres.lire(PARAMETRES.planningBriefings) ?? '');
      } catch {
        // Sans stockage local, pas de rappel verrouillé : rien de plus.
      }

      // Forte séance : une fois par jour et par sens.
      const etat = etatDepuisJson(parametres.lire(PARAMETRES.etatNotifications));
      const date = (aujourdhui ?? dateDuJour)();
      const alerte = alerteVariation(
        variationSeance(chargerEtat(base).etat, depot.derniersCours(), separerHistorique(depot.historique()).titres),
        seuilVariation(parametres.lire(PARAMETRES.seuilVariation)),
        date,
        new Set(etat.briefingsEnvoyes),
      );
      if (alerte && seanceEnCours()) {
        await canal.afficher(alerte);
        parametres.ecrire(
          PARAMETRES.etatNotifications,
          JSON.stringify({ ...etat, briefingsEnvoyes: [...etat.briefingsEnvoyes, alerte.identifiant] }),
        );
      }
    } catch {
      // Une notification manquée ne doit jamais gêner l'application.
    } finally {
      verificationEnCours.current = false;
    }
  }, [pontNotifications, session, aujourdhui]);

  useEffect(() => {
    if (!deverrouille || !pontNotifications) {
      return;
    }
    const premiere = setTimeout(() => void verifierNotifications(), 15_000);
    const minuterie = setInterval(() => void verifierNotifications(), 60_000);
    return () => {
      clearTimeout(premiere);
      clearInterval(minuterie);
    };
  }, [deverrouille, pontNotifications, verifierNotifications]);

  // Verrouillée, l'application ne peut pas lire le portefeuille : à l'heure
  // d'un briefing, elle prévient seulement qu'il attend.
  useEffect(() => {
    if (deverrouille || !pontNotifications) {
      return;
    }
    const verifier = () => {
      const stockage = stockageLocal();
      if (!stockage) return;
      try {
        const deja: string[] = JSON.parse(stockage.getItem(CLE_RAPPELS_LOCAL) ?? '[]');
        const rappels = rappelsDus(stockage.getItem(CLE_PLANNING_LOCAL) ?? undefined, new Date(), deja);
        if (rappels.length === 0) return;
        stockage.setItem(CLE_RAPPELS_LOCAL, JSON.stringify(retenirRappels(deja, rappels.map(r => r.identifiant))));
        for (const rappel of rappels) {
          void pontNotifications.notifier(rappel.titre, rappel.corps).catch(() => undefined);
        }
      } catch {
        // Un rappel manqué ne doit jamais gêner l'écran de déverrouillage.
      }
    };
    const minuterie = setInterval(verifier, 60_000);
    return () => clearInterval(minuterie);
  }, [deverrouille, pontNotifications]);

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
          }),
          risque: construireRisque({
            etat: contenu.etat,
            titres: contenu.titres,
            cours: depotCours.derniersCours(),
            historique: historiques.titres,
          }),
          flux: construireFlux(contenu.transactions, contenu.comptes),
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
  const capitalActuel =
    contenuComplet && depotCours
      ? totaux(
          valoriserPositions(contenuComplet.etat.positions, depotCours.derniersCours())
            .valorisees,
          [...contenuComplet.etat.comptes.values()],
        ).valeurTotale
      : Decimal.ZERO;

  const verrou = statut === 'non-initialise' ? undefined : session.verrou();

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
    const pontMedias = (globalThis as { applibourse?: { medias?: { flux(url: string): Promise<string> } } })
      .applibourse?.medias;
    preparerEpisode(
      entrees,
      chargementAutomatique
        ? {
            valeur: symbole => chargerValeur(symbole),
            actualites: requete => chargerActualites(requete),
            flux: pontMedias ? url => pontMedias.flux(url) : undefined,
          }
        : { valeur: horsLigne, actualites: horsLigne },
      fichesEnCache.current,
      etape => setPodcast(precedent => ({ ...precedent, etape })),
      minutes,
    )
      .then(({ episode, manques }) => {
        if (automatique) {
          void pontNotifications
            ?.notifier('Votre podcast est prêt', `${episode.titre} · environ ${episode.duree} minutes.`)
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
    { cle: 'tableau', libelle: 'Portefeuille', glyphe: '▦' },
    { cle: 'saisie', libelle: 'Nouvelle opération', glyphe: '+' },
    { cle: 'import', libelle: 'Importer', glyphe: '↓' },
    { cle: 'recherche', libelle: 'Recherche', glyphe: '⌕' },
    // La fiche ouverte se range sous la Recherche, d'où on l'ouvre le plus souvent.
    ...(fiche ? [{ cle: 'fiche', libelle: fiche.vue?.entete.nom ?? fiche.symbole, glyphe: '◧', sous: true }] : []),
    { cle: 'watchlist', libelle: 'Watchlist', glyphe: '☆' },
    { cle: 'comparateur', libelle: 'Comparateur', glyphe: '⇄' },
    { cle: 'podcast', libelle: 'Podcast', glyphe: '♫' },
    { cle: 'objectifs', libelle: 'Objectifs', glyphe: '◎' },
    { cle: 'projection', libelle: 'Projection', glyphe: '↗' },
    { cle: 'sauvegarde', libelle: 'Sauvegarde', glyphe: '⇪' },
    { cle: 'notifications', libelle: 'Alertes', glyphe: '◉' },
    { cle: 'reglages', libelle: 'Paramètres', glyphe: '⚙\uFE0E' },
  ];
  const destinationActive =
    ecran === 'symboles' ? 'reglages' : ecran === 'titre' ? 'saisie' : ecran === 'compte' ? 'tableau' : ecran;
  const naviguer = (cle: string) => {
    if ((cle === 'saisie' || cle === 'import') && sansCompte) {
      // Sans compte, ni saisie ni import ne sont possibles : on commence par là.
      setCompteEdite(undefined);
      setEcran('compte');
      return;
    }
    if (cle === 'sauvegarde') {
      rafraichirSauvegardes();
    }
    if (cle === 'notifications') {
      setMessageNotifications(undefined);
    }
    if (cle === 'reglages') {
      setRecherche(undefined);
    }
    if (cle === 'podcast' && podcast.date !== (aujourdhui ?? dateDuJour)()) {
      genererPodcast();
    }
    setEcran(cle as Ecran);
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics ?? METRIQUES_DE_REPLI}>
      <SafeAreaView
        style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
        <StatusBar barStyle={palettePour().sombre === false ? 'dark-content' : 'light-content'} />

      <Coque
        destinations={deverrouille && contenuComplet && tableau ? destinations : []}
        actif={destinationActive}
        onNaviguer={naviguer}
        onVerrouiller={deverrouille && contenuComplet && tableau ? verrouiller : undefined}
        discret={discret}
        onBasculerDiscretion={deverrouille && contenuComplet && tableau ? basculerDiscretion : undefined}
        flottant={ecran !== 'podcast' ? <LecteurFlottant onOuvrir={() => setEcran('podcast')} /> : null}>
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
        <PremierLancement onCreer={creer} enCours={enCours} erreur={erreur} />
      ) : !contenu || !tableau ? (
        <Deverrouillage
          onDeverrouiller={deverrouiller}
          erreur={erreur}
          enCours={enCours}
          secondesAvantNouvelEssai={verrou?.verrouille ? verrou.secondesRestantes : 0}
        />
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
          comptes={contenuComplet!.comptes}
          titres={contenuComplet!.titres}
          positions={contenuComplet!.etat.positions}
          onEnregistrer={enregistrerOperation}
          onAnnuler={() => setEcran('tableau')}
          onCreerTitre={() => setEcran('titre')}
          genererId={() => identifiant('op')}
        />
      ) : ecran === 'notifications' ? (
        <Notifications
          notificationsDisponibles={
            Boolean(pontNotifications) || chargerModule('@notifee/react-native').etat === 'disponible'
          }
          reveilDisponible={
            Boolean(pontNotifications) ||
            chargerModule('react-native-background-fetch').etat === 'disponible'
          }
          surOrdinateur={Boolean(pontNotifications)}
          demarrageAuto={pontDemarrage ? demarrageAuto ?? false : undefined}
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
                      essai?.titre ?? '✅ AppliBourse',
                      essai?.corps ?? 'Les notifications fonctionnent. Vos briefings arriveront ici.',
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
          seuils={seuilsAffiches(session, contenu)}
          onChangerSeuil={enregistrerSeuil}
          onRetour={() => setEcran('tableau')}
          message={messageNotifications}
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
          onSurveiller={
            fiche.vue
              ? () => {
                  // Depuis la fiche, même une valeur inconnue du portefeuille se
                  // met en surveillance : elle est créée au besoin.
                  const donnees = fichesEnCache.current.get(fiche.symbole)?.fiche;
                  surveillerCandidat({
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
          heureAuto={new DepotParametres(session.base()).lire(PARAMETRES.podcastAuto) || undefined}
          onChangerHeureAuto={heure => {
            const parametres = new DepotParametres(session.base());
            if (heure) {
              parametres.ecrire(PARAMETRES.podcastAuto, heure);
            } else {
              parametres.supprimer(PARAMETRES.podcastAuto);
            }
            rafraichir();
          }}
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
          onRetour={() => setEcran('reglages')}
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
      ) : ecran === 'recherche' ? (
        <Recherche
          onRechercher={rechercherActions}
          surveilles={
            new Set(
              (() => {
                const titres = new Map((contenuComplet?.titres ?? []).map(titre => [titre.id, titre.ticker.toUpperCase()]));
                return new DepotWatchlist(session.base())
                  .lister()
                  .map(ligne => titres.get(ligne.titreId) ?? '')
                  .filter(Boolean);
              })(),
            )
          }
          onSurveiller={surveillerCandidat}
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
      ) : ecran === 'reglages' ? (
        <Reglages
          fournisseurs={FOURNISSEURS}
          fournisseurActuel={new DepotParametres(session.base()).lire(
            PARAMETRES.fournisseurCours,
          )}
          cleEnregistree={Boolean(
            new DepotParametres(session.base()).lire(PARAMETRES.cleApiCours),
          )}
          onEnregistrer={enregistrerReglages}
          onAnnuler={() => setEcran('tableau')}
          onSymboles={() => {
            setRecherche(undefined);
            setErreurSymboles(undefined);
            setEcran('symboles');
          }}
          sansSymbole={
            (contenuComplet?.etat.positions ?? []).filter(position => {
              const titre = contenuComplet?.titres.find(valeur => valeur.id === position.titreId);
              return !titre?.ticker?.trim();
            }).length
          }
          onChargerHistorique={lancerChargementHistorique}
          intervalleActualisation={intervalleS}
          theme={themeCourant()}
          onChoisirTheme={cle => {
            new DepotParametres(session.base()).ecrire(PARAMETRES.theme, cle);
            definirTheme(cle);
            rafraichir();
          }}
          onChoisirIntervalle={secondes => {
            new DepotParametres(session.base()).ecrire(PARAMETRES.intervalleActualisation, String(secondes));
            rafraichir();
          }}
          avecSymbole={(contenuComplet?.titres ?? []).filter(titre => titre.ticker?.trim()).length}
          chargementEnCours={histoEnCours}
          messageHistorique={messageHistorique}
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
          comparaison={onglets!.comparaison}
          onChoisirReference={choisirReference}
          anneesRapport={contenu ? anneesDisponibles(contenu.transactions) : []}
          onGenererRapport={genererRapport}
          messageRapport={messageRapport}
          dividendes={onglets!.dividendes}
          risque={onglets!.risque}
          flux={onglets!.flux}
          impots={onglets!.impots}
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
          onReglages={() => setEcran('reglages')}
          onSauvegarder={() => {
            rafraichirSauvegardes();
            setEcran('sauvegarde');
          }}
          onNotifications={() => {
            setMessageNotifications(undefined);
            setEcran('notifications');
          }}
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
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
