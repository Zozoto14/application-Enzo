/**
 * Point d'entrée de l'application de bureau.
 *
 * Trois choses à faire avant d'afficier quoi que ce soit, toutes asynchrones,
 * alors que l'application est synchrone : initialiser sql.js, lire le coffre,
 * lire le fichier scellé. D'où cet écran d'attente, puis le passage de relais.
 */

import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/dm-serif-display/400.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import initSqlJs from 'sql.js';
// L'URL du binaire WebAssembly, resolue par le bundler : sans cela sql.js le
// cherche a cote de la page, ou il n'est pas.
import urlWasm from 'sql.js/dist/sql-wasm.wasm?url';
import { App } from '../src/app/App';
import { Bouton, Titre } from '../src/ui/composants';
import { ESPACEMENT, palettePour } from '../src/ui/theme';
import { useFondDocument } from './Bureau';
import { BandeauMiseAJour } from './MiseAJour';
import { ouvrirSessionBureau, type SessionBureau } from './session';
import { pont, stockageCourant, type NomFichier, type Stockage } from './stockage';
import { Connexion } from '../src/ui/ecrans/ChoixProfil';
import { GardeErreur } from '../src/ui/GardeErreur';
import type { ControleProfils } from '../src/ui/ecrans/CarteProfils';
import {
  ID_PRINCIPAL,
  activerProfil,
  ajouterProfil,
  autoriserApps,
  fichiersDuProfil,
  motifFermeture,
  nouvelIdentifiant,
  validerModification,
  renommerProfil,
  supprimerProfil,
  type OptionsNouveauProfil,
  type Profil,
} from '../src/profils/profils';
import {
  aDesAmis,
  adopterPrenomAdmin,
  appliquerProfilsAdmin,
  codeAcces,
  deposerSequestre,
  ecrireAnnuaire,
  lireAnnuaire,
  noterConnexionAmi,
  ouvrirSequestre,
  profilAdminVerrouille,
  profilAmi,
  regenererCodeAcces,
  retablirSequestre,
  revoquerSequestre,
  trouverCompte,
  type Annuaire,
  type ClesAdmin,
  type CompteTrouve,
  ajouterCompteGere,
  ajouterEvenementGestion,
  apercuAnonyme,
  appliquerAccesGeres,
  compteGere,
  roleDuCompte,
} from '../src/profils/annuaire';
import { changerDEspace } from '../src/profils/espace';
import {
  ajouterCompteParTitulaire,
  appliquerAccesParTitulaire,
  changerRang,
  codeAccesTitulaire,
  ouvrirAnnuaireAdmin,
  ouvrirAnnuaireTitulaire,
  ouvrirSequestreTitulaire,
  publiqueTitulaire,
  regenererCodeTitulaire,
  regenererSequestres,
  retablirSequestreTitulaire,
  revoquerSequestreTitulaire,
  supprimerCompteParTitulaire,
} from '../src/profils/rangs';
import { coffreLeurre } from '../src/profils/leurre';
import { hexToBytes } from '@noble/hashes/utils.js';
import { DepotParametres } from '../src/db/depots';
import { Session } from '../src/session/session';
import { stockageMemoire } from '../src/session/stockage-coffre';
import { creerAccesAmi, type IdentifiantsAmi } from '../src/profils/identifiants';
import { installerPontWeb } from './web';
import { LIBELLES_RANG, exiger, exigerRang, rangDe, type Rang } from '../src/hub/admin/roles';
import { avecEvenement, chargerDonnees, enregistrerDonnees } from '../src/hub/admin/donnees';
import { verifierModifications } from '../src/hub/admin/actions';
import { CLE_CARNET_GESTION, ajouterAuCarnet, ecrireCarnet, lireCarnet } from '../src/hub/admin/gestion';
import type { TypeEvenement } from '../src/hub/admin/journal';
import { CLE_DONNEES } from '../src/hub/admin/donnees';
import { AccueilSite, RemplacerDonnees } from './AccueilSite';
import {
  avantOuverture,
  coffreAdminEtranger,
  liaisonPourCompte,
  lireLiaisons,
  oublierSuivi,
  preparerLiaison,
  retenirLiaison,
  synchroniserAnnuaire,
  synchroniserCompteAmi,
  synchroniserComptesAdmin,
  type CompteRelie,
  type Memoire,
} from './synchroComptes';
import { decoderLiaison, encoderLiaison, lienSite, type Liaison } from '../src/sync/relais/liaison';
import { compteDeLiaison, estMaitre, liaisonPourProfil } from '../src/sync/relais/portees';
import { lireConfigRelais } from '../src/sync/relais/synchroniser';
import { versBase64 } from '../src/sync/relais/chiffrement';
import type { OptionsLier } from '../src/ui/ecrans/LierCompte';

/**
 * Les appels à Yahoo Finance passent par le processus principal.
 *
 * Depuis la fenêtre, le navigateur les bloquerait (appels entre origines,
 * cookie de session) ; le processus principal, lui, n'a pas ces limites.
 * Le reste du code continue d'appeler `fetch` sans rien savoir du détour.
 */
function relayerYahoo(): void {
  const yahoo = pont()?.yahoo;
  if (!yahoo) {
    return;
  }
  const natif = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (entree, init) => {
    const url =
      typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https:\/\/query[12]\.finance\.yahoo\.com\//.test(url)) {
      return natif(entree, init);
    }
    try {
      const json = await yahoo.json(url);
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (erreur) {
      return new Response(erreur instanceof Error ? erreur.message : String(erreur), { status: 502 });
    }
  };
}

relayerYahoo();
// Hors d'Electron (site de secours), Yahoo et les médias passent par le relais.
if (!pont()) {
  installerPontWeb();
  // Demande au navigateur de ne pas effacer les données du site pour faire de
  // la place (Safari le fait sinon au bout de quelques semaines sans visite).
  void navigator.storage?.persist?.().catch(() => undefined);
}

type Etat =
  | { phase: 'chargement'; message?: string }
  | { phase: 'connexion'; enCours?: boolean }
  | {
      phase: 'prete';
      session: SessionBureau;
      /** Le compte ouvert. */
      profil: Profil;
      /** Ce que ce compte a le droit de voir : tout pour l'administrateur déverrouillé, lui seul sinon. */
      profils: Profil[];
      /** Session d'un titulaire (Fondateur, Administrateur) sur le compte d'un rang inférieur (séquestre) : son prénom. */
      adminSur?: string;
      /** … et son rang (bandeau). */
      rangSur?: Rang;
      transparence?: { dernierAccesAdmin?: string; sequestreActif: boolean; par?: string; rangPar?: string };
      /** Administrateur historique sans prénom : celui saisi à la connexion, à lui donner une fois déverrouillé. */
      prenomAAdopter?: string;
      /** Le coffre d'ici n'est pas celui du compte relié (créé sur ce navigateur autrefois). */
      autreCoffre?: boolean;
    }
  | { phase: 'echec'; motif: string }
  /** Navigateur neuf : relier un compte existant (d'abord), ou créer un coffre. */
  | { phase: 'accueil'; code?: string; erreur?: string }
  /** Ce navigateur a déjà un coffre : remplacer ses données par celles du compte relié ? */
  | { phase: 'remplacer'; relie: CompteRelie };

const decodeur = new TextDecoder();
const encodeur = new TextEncoder();
/** Paramètres de la base d'un ami (sa propre base chiffrée). */
const PARAM_CONNEXIONS = 'compte.connexions';
const PARAM_ACCES_ADMIN = 'compte.accesAdmin';

/**
 * Écritures de l'annuaire par un gestionnaire, une à la fois : chacune relit le
 * fichier puis le réécrit, deux en parallèle s'écraseraient (action + journal).
 */
let fileGestion: Promise<unknown> = Promise.resolve();
function enFile<T>(action: () => Promise<T>): Promise<T> {
  const suite = fileGestion.then(action, action);
  fileGestion = suite.catch(() => undefined);
  return suite;
}

function erreurTexte(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

/** Stockage du navigateur, sans lever (navigation privée, stockage interdit). */
const memoireNavigateur: Memoire = {
  getItem: cle => {
    try {
      return globalThis.localStorage?.getItem(cle) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (cle, valeur) => {
    try {
      globalThis.localStorage?.setItem(cle, valeur);
    } catch {
      // Rien : la mémoire de la page suffit pour cette ouverture.
    }
  },
  removeItem: cle => {
    try {
      globalThis.localStorage?.removeItem(cle);
    } catch {
      // Rien.
    }
  },
};

/** Code apporté par un lien `…/#liaison=AB1.…` (site ouvert depuis un QR code). */
function codeDuLien(): string | undefined {
  try {
    const trouve = /AB1\.[A-Za-z0-9_-]+/.exec(decodeURIComponent(globalThis.location?.hash ?? ''));
    return trouve && decoderLiaison(trouve[0]) ? trouve[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Liaison de l'administrateur connue du processus principal (PC relié par le script). */
async function liaisonDuPont(): Promise<Liaison | undefined> {
  if (!pont()) {
    return undefined; // Site : le « pont » web ne fait que relire le lien (voir web.ts).
  }
  try {
    const relais = (globalThis as { applibourse?: { relais?: { config?(): Promise<Liaison | undefined> } } }).applibourse?.relais;
    const liaison = await relais?.config?.();
    return liaison && estMaitre(liaison) ? liaison : undefined;
  } catch {
    return undefined;
  }
}

/** Au plus `ms` : le réseau ne bloque jamais l'ouverture (hors ligne, on continue avec ce qu'on a). */
function auPlus<T>(promesse: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promesse.catch(() => undefined), new Promise<undefined>(ok => setTimeout(() => ok(undefined), ms))]);
}

/** Délai entre deux tours de synchronisation des comptes. */
const INTERVALLE_COMPTES_MS = 120_000;

/** Clés d'usage de l'administrateur, tirées de sa clé maîtresse (à effacer après usage). */
function clesAdminDe(session: SessionBureau): ClesAdmin {
  return { annuaire: hexToBytes(session.session.cleDerivee('annuaire')), sequestre: hexToBytes(session.session.cleDerivee('sequestre')) };
}

function effacer(cles: ClesAdmin): void {
  cles.annuaire.fill(0);
  cles.sequestre.fill(0);
}

/** Un accès au compte par séquestre : date, et (depuis les rangs) qui et de quel rang. */
interface AccesNote {
  date: string;
  par?: string;
  rang?: string;
}

/** Accès des titulaires à ce compte (lus dans la base du compte) ; les anciennes entrées ne sont que des dates. */
function accesAdminLus(session: SessionBureau): AccesNote[] {
  try {
    const brut = new DepotParametres(session.session.base()).lire(PARAM_ACCES_ADMIN);
    const liste: unknown = brut ? JSON.parse(brut) : [];
    if (!Array.isArray(liste)) return [];
    return liste.flatMap((d): AccesNote[] => {
      if (typeof d === 'string' && !Number.isNaN(Date.parse(d))) return [{ date: d }];
      if (d && typeof d === 'object' && typeof (d as AccesNote).date === 'string' && !Number.isNaN(Date.parse((d as AccesNote).date))) {
        const o = d as AccesNote;
        return [{ date: o.date, ...(typeof o.par === 'string' ? { par: o.par.slice(0, 30) } : {}), ...(typeof o.rang === 'string' ? { rang: o.rang.slice(0, 20) } : {}) }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/** Transparence d'un compte : dernier accès (date, titulaire, rang). */
function transparenceDe(acces: readonly AccesNote[], sequestreActif: boolean) {
  const dernier = acces[acces.length - 1];
  return { dernierAccesAdmin: dernier?.date, sequestreActif, ...(dernier?.par ? { par: dernier.par } : {}), ...(dernier?.rang ? { rangPar: dernier.rang } : {}) };
}

/** Rang d'administration (autre que le compte historique) : ouvre des comptes inférieurs par séquestre. */
const estTitulaireRole = (role: Profil['role']): role is 'administrateur' | 'fondateur' => role === 'administrateur' || role === 'fondateur';

function Racine() {
  const sombre = useColorScheme() === 'dark';
  const palette = palettePour(sombre);
  useFondDocument(sombre);

  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });
  const fabriqueRef = useRef<unknown>(undefined);
  const stockage = useMemo(() => stockageCourant(), []);
  // Dernier annuaire connu (lu ou écrit) : la seule source de vérité des comptes.
  const annuaireRef = useRef<Annuaire | undefined>(undefined);

  const lireAnnuaireDisque = useCallback(async () => {
    const brut = await stockage.lire('profils');
    const annuaire = lireAnnuaire(brut && brut.length > 0 ? decodeur.decode(brut) : undefined);
    annuaireRef.current = annuaire;
    return annuaire;
  }, [stockage]);

  // Synchronisation des comptes : un tour à demander après une modification de l'annuaire.
  const planComptes = useRef<{ demander(delai?: number): void; enTour: boolean } | undefined>(undefined);
  const [versionComptes, setVersionComptes] = useState(0);
  const ecrireAnnuaireDisque = useCallback(
    async (annuaire: Annuaire) => {
      await stockage.ecrire('profils', encodeur.encode(ecrireAnnuaire(annuaire)));
      annuaireRef.current = annuaire;
      if (planComptes.current && !planComptes.current.enTour) {
        planComptes.current.demander(2_000);
      }
    },
    [stockage],
  );

  /**
   * Ouvre un compte. Tout état du compte précédent est d'abord effacé
   * (`changerDEspace`) et la portée des fichiers passe à ce compte.
   * `cle` : clé maîtresse relue du séquestre (session administrateur).
   */
  const ouvrir = useCallback(
    async (compte: CompteTrouve, options: { cle?: Uint8Array; adminSur?: string; rangSur?: Rang; creation?: boolean } = {}) => {
      setEtat({ phase: 'chargement', message: options.adminSur ? `Ouverture du compte de ${compte.nom}…` : undefined });
      try {
        fabriqueRef.current ??= await initSqlJs({ locateFile: () => urlWasm });
        changerDEspace(compte.id);
        await pont()?.profil?.ouvrir(compte.id);
        const annuaire = annuaireRef.current ?? (await lireAnnuaireDisque());
        if (!options.adminSur) {
          // Le coffre de CE compte (et, pour un ami, son portefeuille) s'il est plus récent sur le relais.
          await auPlus(avantOuverture({ memoire: memoireNavigateur, fichiers: stockage as never, compte: compte.id, pontMaitre: await liaisonDuPont() }), 15_000);
          if (!compte.admin || (!pont() && !options.creation && lireLiaisons(memoireNavigateur).maitre)) {
            const coffre = await stockage.lire(fichiersDuProfil(compte.id).coffre as NomFichier);
            if ((!coffre || coffre.length === 0) && compte.admin) {
              // Code de l'administrateur connu, mais aucun coffre sur le relais : on le dit, sans créer en douce.
              setEtat({
                phase: 'accueil',
                erreur: 'Aucun coffre de l’administrateur n’a pu être récupéré avec le code retenu sur ce navigateur (relais injoignable, ou PC pas encore relié). Réessayez, saisissez un autre code, ou créez un nouveau coffre.',
              });
              return;
            }
            if (!coffre || coffre.length === 0) {
              throw new Error('Impossible de récupérer ce compte pour l’instant (relais injoignable, ou compte pas encore publié par l’administrateur). Vérifiez la connexion, puis réessayez.');
            }
          }
        }
        const session = await ouvrirSessionBureau({
          fabrique: fabriqueRef.current as never,
          stockage,
          profil: compte.id,
          surErreur: erreur => {
            // Une ecriture perdue en silence serait le pire defaut possible.
            console.error('Enregistrement impossible', erreur);
          },
          // Compte fermé : refusé seulement après un mot de passe et un code justes.
          verifierOuverture: compte.admin || options.adminSur
            ? undefined
            : () => {
                const motif = motifFermeture(profilAmi(annuaireRef.current ?? annuaire, compte.id, compte.nom));
                if (motif) {
                  throw new Error(motif);
                }
              },
        });
        const profil = compte.admin ? profilAdminVerrouille(compte.nom) : profilAmi(annuaire, compte.id, compte.nom);
        let transparence: { dernierAccesAdmin?: string; sequestreActif: boolean; par?: string; rangPar?: string } | undefined;
        if (options.cle) {
          session.session.ouvrirAvecCle(options.cle);
          // L'accès est noté dans la base du compte, avec le titulaire et son rang : il le verra dans ses Paramètres.
          const note: AccesNote = { date: new Date().toISOString(), ...(options.adminSur ? { par: options.adminSur } : {}), ...(options.rangSur ? { rang: LIBELLES_RANG[options.rangSur] } : {}) };
          const acces = [...accesAdminLus(session), note].slice(-20);
          new DepotParametres(session.session.base()).ecrire(PARAM_ACCES_ADMIN, JSON.stringify(acces));
          transparence = transparenceDe(acces, true);
        }
        const autreCoffre = compte.admin && !options.adminSur && !pont() ? await coffreAdminEtranger(memoireNavigateur, stockage as never) : false;
        setEtat({ phase: 'prete', session, profil, profils: [profil], adminSur: options.adminSur, rangSur: options.rangSur, transparence, prenomAAdopter: compte.prenomAAdopter, autreCoffre });
      } catch (erreur) {
        options.cle?.fill(0);
        setEtat({ phase: 'echec', motif: erreurTexte(erreur) });
      }
    },
    [stockage, lireAnnuaireDisque],
  );

  /** Prénom inconnu : même écran de déverrouillage, coffre qu'aucune clé n'ouvre. */
  const ouvrirLeurre = useCallback(async (prenom: string) => {
    setEtat({ phase: 'chargement' });
    // Même appel au relais qu'un vrai compte (voir avantOuverture) : rien ne trahit un prénom inconnu.
    await auPlus(avantOuverture({ memoire: memoireNavigateur, fichiers: stockage as never, compte: undefined, pontMaitre: await liaisonDuPont() }), 15_000);
    changerDEspace('leurre');
    const session = new Session({
      stockage: stockageMemoire(coffreLeurre()),
      ouvrirBase: () => {
        throw new Error('Mot de passe ou code incorrect');
      },
      profil: 'leurre',
    });
    const leurre: SessionBureau = { session, emplacement: '', surDisque: stockage.surDisque, vider: async () => undefined };
    const profil: Profil = { id: 'leurre', nom: prenom.trim().slice(0, 30), admin: false, creeLe: '', apps: [], actif: true };
    setEtat({ phase: 'prete', session: leurre, profil, profils: [profil] });
  }, [stockage]);

  /** Après le chargement (ou une liaison) : écran prénom, accueil du navigateur, ou compte unique. */
  const demarrer = useCallback(
    async (annuaire: Annuaire) => {
      if (aDesAmis(annuaire)) {
        setEtat({ phase: 'connexion' });
        return;
      }
      if (!pont()) {
        const coffre = await stockage.lire('coffre');
        if (!coffre || coffre.length === 0) {
          const liaisons = lireLiaisons(memoireNavigateur);
          // Navigateur neuf : relier d'abord. Un navigateur déjà relié (code de l'administrateur) ouvre son compte.
          if (!liaisons.maitre) {
            setEtat({ phase: 'accueil', code: codeDuLien() });
            return;
          }
        }
      }
      void ouvrir({ id: ID_PRINCIPAL, nom: annuaire.heritage?.[0]?.nom ?? 'Moi', admin: true });
    },
    [ouvrir, stockage],
  );

  useEffect(() => {
    void (async () => {
      let annuaire = await lireAnnuaireDisque();
      const lien = codeDuLien();
      const liaisons = lireLiaisons(memoireNavigateur);
      const connus = [liaisons.maitre, ...Object.values(liaisons.comptes)];
      if (!pont() && lien && !connus.includes(encoderLiaison(decoderLiaison(lien)!))) {
        // Lien de liaison nouveau pour ce navigateur : on propose de relier ce compte.
        setEtat({ phase: 'accueil', code: lien });
        return;
      }
      // Comptes ajoutés ou modifiés ailleurs : l'écran prénom les connaît avant la connexion.
      const maitre = liaisons.maitre ? decoderLiaison(liaisons.maitre) : await liaisonDuPont();
      if (maitre && !annuaire.restreint) {
        const resultat = await auPlus(
          synchroniserAnnuaire({ liaison: maitre, memoire: memoireNavigateur, lire: async () => annuaire, ecrire: ecrireAnnuaireDisque }),
          6_000,
        );
        if (resultat) annuaire = resultat.annuaire;
      } else if (annuaire.restreint && annuaire.comptes[0]) {
        const id = annuaire.comptes[0].id;
        const liaison = liaisonPourCompte(memoireNavigateur, id);
        if (liaison) {
          await auPlus(
            synchroniserCompteAmi({ liaison, id, memoire: memoireNavigateur, fichiers: stockage as never, lire: async () => annuaire, ecrire: ecrireAnnuaireDisque }),
            6_000,
          );
          annuaire = annuaireRef.current ?? annuaire;
        }
      }
      annuaireRef.current = annuaire;
      await demarrer(annuaire);
    })().catch(erreur => setEtat({ phase: 'echec', motif: erreurTexte(erreur) }));
  }, [lireAnnuaireDisque, ecrireAnnuaireDisque, demarrer, stockage]);

  // ------------------------------------------------ Relier ce navigateur à un compte

  /** Fichiers de ce navigateur (compte principal et comptes de l'annuaire d'ici). */
  const fichiersLocaux = useCallback(async (): Promise<NomFichier[]> => {
    const annuaire = await lireAnnuaireDisque();
    const ids = annuaire.heritage ? annuaire.heritage.map(p => p.id) : [ID_PRINCIPAL, ...annuaire.comptes.map(c => c.id)];
    return ['profils', ...[...new Set([ID_PRINCIPAL, ...ids])].flatMap(id => Object.values(fichiersDuProfil(id)) as NomFichier[])];
  }, [lireAnnuaireDisque]);

  /** Installe le compte relié : l'ancien contenu du navigateur est effacé, le code retenu. */
  const installerLiaison = useCallback(
    async (relie: CompteRelie) => {
      setEtat({ phase: 'chargement', message: 'Installation du compte…' });
      for (const nom of await fichiersLocaux()) {
        if (nom !== 'profils') await stockage.ecrire(nom, new Uint8Array(0));
      }
      oublierSuivi(memoireNavigateur);
      await ecrireAnnuaireDisque(relie.annuaire);
      retenirLiaison(memoireNavigateur, relie.liaison);
      // Page rechargée : plus rien de l'ancien contenu ni de l'ancienne session en mémoire.
      window.location.reload();
    },
    [fichiersLocaux, stockage, ecrireAnnuaireDisque],
  );

  /** « Relier » : vérifie le code, puis installe — ou demande d'abord s'il faut remplacer un ancien coffre. */
  const relier = useCallback(
    async (code: string) => {
      const relie = await preparerLiaison(code);
      const annuaire = await lireAnnuaireDisque();
      const coffre = await stockage.lire('coffre');
      const ancien = (coffre && coffre.length > 0) || aDesAmis(annuaire);
      if (ancien) {
        setEtat({ phase: 'remplacer', relie });
      } else {
        await installerLiaison(relie);
      }
    },
    [lireAnnuaireDisque, stockage, installerLiaison],
  );

  /** Sauvegarde de l'ancien contenu du navigateur, tel quel (chiffré), dans un fichier téléchargé. */
  const exporterAncien = useCallback(async () => {
    const fichiers: Record<string, string> = {};
    for (const nom of await fichiersLocaux()) {
      const octets = await stockage.lire(nom);
      if (octets && octets.length > 0) fichiers[nom] = versBase64(octets);
    }
    const contenu = JSON.stringify({ format: 'applibourse-ancien-navigateur', version: 1, date: new Date().toISOString(), fichiers }, null, 1);
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
    lien.download = `appdashboard-ancien-coffre-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    return true;
  }, [fichiersLocaux, stockage]);

  // Dernier filet : on force l'ecriture avant la fermeture de la fenetre.
  useEffect(() => {
    if (etat.phase !== 'prete') {
      return;
    }
    const avantFermeture = () => void etat.session.vider();
    // Sur iPhone, Safari n'envoie presque jamais « beforeunload » : une page
    // quittée ou mise en arrière-plan ne prévient que par « pagehide » et
    // « visibilitychange ». Sans eux, la configuration de la synchronisation
    // et les dernières opérations pouvaient ne jamais être enregistrées.
    const siCachee = () => {
      if (document.visibilityState === 'hidden') {
        avantFermeture();
      }
    };
    window.addEventListener('beforeunload', avantFermeture);
    window.addEventListener('pagehide', avantFermeture);
    document.addEventListener('visibilitychange', siCachee);
    return () => {
      window.removeEventListener('beforeunload', avantFermeture);
      window.removeEventListener('pagehide', avantFermeture);
      document.removeEventListener('visibilitychange', siCachee);
    };
  }, [etat]);

  // Tours de synchronisation des comptes, une fois le compte déverrouillé (voir synchroComptes.ts).
  const etatRef = useRef(etat);
  etatRef.current = etat;
  const sessionPrete = etat.phase === 'prete' && !etat.adminSur && etat.profil.id !== 'leurre' ? etat.session : undefined;
  useEffect(() => {
    const courant = etatRef.current;
    if (!sessionPrete || courant.phase !== 'prete') {
      return undefined;
    }
    const session = sessionPrete;
    const profil = courant.profil;
    let arrete = false;
    let dernier = 0;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const plan = { enTour: false, demander: (delai = 0) => undefined as void };
    const effacerDe = async (id: string) => {
      const noms = fichiersDuProfil(id) as { coffre: NomFichier; portefeuille: NomFichier };
      await stockage.ecrire(noms.coffre, new Uint8Array(0));
      await stockage.ecrire(noms.portefeuille, new Uint8Array(0));
    };
    const tour = async () => {
      if (arrete || plan.enTour || session.session.statut() !== 'deverrouille') {
        return;
      }
      plan.enTour = true;
      try {
        const pontMaitre = await liaisonDuPont();
        if (profil.admin) {
          const config = lireConfigRelais(session.session.base());
          const liaison: Liaison | undefined = config
            ? { relais: config.relais, jeton: config.jeton, ...(config.site ? { site: config.site } : {}) }
            : liaisonPourCompte(memoireNavigateur, ID_PRINCIPAL, pontMaitre);
          if (!liaison || !estMaitre(liaison)) {
            return;
          }
          // Retenu hors de la base : l'écran prénom de ce navigateur connaîtra les comptes avant la connexion.
          retenirLiaison(memoireNavigateur, liaison);
          const depot = new DepotParametres(session.session.base());
          const bilan = await synchroniserComptesAdmin({
            liaison,
            memoire: memoireNavigateur,
            fichiers: stockage as never,
            lire: lireAnnuaireDisque,
            ecrire: ecrireAnnuaireDisque,
            cles: () => clesAdminDe(session),
            effacerFichiers: effacerDe,
            donnees: { lire: () => depot.lire(CLE_DONNEES), ecrire: valeur => depot.ecrire(CLE_DONNEES, valeur), cleSynchro: session.session.cleDerivee('synchro') },
            // Tsuzuku : les sources partagées par le compte historique partent vers chaque bénéficiaire.
            tsuzuku: { base: { lire: cle => depot.lire(cle) } },
          });
          if (bilan.annuaireChange && annuaireRef.current) {
            const cles = clesAdminDe(session);
            try {
              const vue = ouvrirAnnuaireAdmin(annuaireRef.current, cles);
              setEtat(c => (c.phase === 'prete' && c.session === session ? { ...c, profil: vue.profils[0], profils: vue.profils } : c));
            } finally {
              effacer(cles);
            }
          }
          if (bilan.annuaireChange || bilan.donneesChangent) {
            setVersionComptes(v => v + 1);
          }
          if (bilan.erreurs.length > 0) {
            console.warn('Synchronisation des comptes :', bilan.erreurs[0]);
          }
        } else {
          const liaison = liaisonPourCompte(memoireNavigateur, profil.id, pontMaitre);
          if (!liaison) {
            return;
          }
          await session.vider();
          const baseAmi = new DepotParametres(session.session.base());
          const bilan = await synchroniserCompteAmi({
            liaison,
            id: profil.id,
            memoire: memoireNavigateur,
            fichiers: stockage as never,
            lire: lireAnnuaireDisque,
            ecrire: ecrireAnnuaireDisque,
            // Tsuzuku : ses sources partagées arrivent dans SA base (lecture seule).
            tsuzuku: { base: { lire: cle => baseAmi.lire(cle), ecrire: (cle, valeur) => baseAmi.ecrire(cle, valeur) } },
          });
          if (bilan.annuaireChange && annuaireRef.current) {
            const suivant = profilAmi(annuaireRef.current, profil.id, profil.nom);
            let profilsVus: Profil[] = [suivant];
            if (estTitulaireRole(suivant.role)) {
              // Titulaire : sa vue (comptes inférieurs), avec les dépôts reçus convertis.
              const cles = clesAdminDe(session);
              try {
                const vue = ouvrirAnnuaireTitulaire(annuaireRef.current, profil.id, profil.nom, cles);
                if (vue.modifie) await ecrireAnnuaireDisque(vue.annuaire);
                profilsVus = vue.profils;
              } catch (erreur) {
                console.warn('Rangs :', erreurTexte(erreur));
              } finally {
                effacer(cles);
              }
            }
            setEtat(c => (c.phase === 'prete' && c.session === session ? { ...c, profil: profilsVus[0], profils: profilsVus } : c));
          }
        }
      } catch (erreur) {
        console.warn('Synchronisation des comptes :', erreurTexte(erreur));
      } finally {
        plan.enTour = false;
        dernier = Date.now();
      }
    };
    plan.demander = (delai = 0) => {
      if (minuterie) clearTimeout(minuterie);
      minuterie = setTimeout(() => void tour(), delai);
    };
    planComptes.current = plan;
    const intervalle = setInterval(() => {
      if (session.session.statut() === 'deverrouille' && Date.now() - dernier > INTERVALLE_COMPTES_MS) {
        void tour();
      }
    }, 3_000);
    const ecoute = session.session.surEcriture?.(() => {
      if (!plan.enTour) plan.demander(5_000);
    });
    const visible = () => {
      if (document.visibilityState === 'visible') plan.demander(500);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      arrete = true;
      clearInterval(intervalle);
      if (minuterie) clearTimeout(minuterie);
      ecoute?.();
      document.removeEventListener('visibilitychange', visible);
      if (planComptes.current === plan) planComptes.current = undefined;
    };
  }, [sessionPrete, stockage, lireAnnuaireDisque, ecrireAnnuaireDisque]);

  if (etat.phase === 'chargement') {
    return (
      <View style={[styles.centre, { backgroundColor: palette.fond }]}>
        <ActivityIndicator color={palette.accent} />
        <Text style={{ color: palette.texteSecondaire, marginTop: ESPACEMENT.m }}>
          {etat.message ?? 'Ouverture du portefeuille…'}
        </Text>
      </View>
    );
  }

  if (etat.phase === 'echec') {
    return (
      <View style={[styles.centre, { backgroundColor: palette.fond }]}>
        <Titre>Impossible d’ouvrir</Titre>
        <Text style={[styles.motif, { color: palette.texte }]}>{etat.motif}</Text>
        <View style={{ marginTop: ESPACEMENT.m }}>
          <Bouton titre="Revenir à la connexion" variante="discret" onPress={() => quitterCompte(undefined)} testID="echec-revenir" />
        </View>
      </View>
    );
  }

  if (etat.phase === 'accueil') {
    return (
      <AccueilSite
        codeConnu={etat.code}
        erreur={etat.erreur}
        onRelier={relier}
        onCreer={() => {
          // Coffre neuf, indépendant : le code d'un autre compte retenu ici ne s'applique plus.
          for (const cle of ['applibourse.liaisons', 'applibourse.liaison']) memoireNavigateur.removeItem(cle);
          void ouvrir({ id: ID_PRINCIPAL, nom: 'Moi', admin: true }, { creation: true });
        }}
      />
    );
  }

  if (etat.phase === 'remplacer') {
    const ami = etat.relie.compte;
    return (
      <RemplacerDonnees
        compte={ami ? 'votre compte' : 'votre compte du PC'}
        onExporter={exporterAncien}
        onRemplacer={() => installerLiaison(etat.relie)}
        onAnnuler={() => window.location.reload()}
      />
    );
  }

  if (etat.phase === 'connexion') {
    // Aucun compte n'est listé : on retrouve le sien par son prénom.
    return (
      <Connexion
        enCours={etat.enCours}
        onContinuer={prenom => {
          const annuaire = annuaireRef.current;
          const trouve = annuaire ? trouverCompte(annuaire, prenom) : undefined;
          if (trouve) {
            void ouvrir(trouve);
          } else {
            void ouvrirLeurre(prenom);
          }
        }}
      />
    );
  }

  const { session, profil, profils, adminSur } = etat;
  const annuaireCourant = () => {
    if (!annuaireRef.current) {
      throw new Error('Liste des comptes indisponible.');
    }
    return annuaireRef.current;
  };
  // Administration : réservée à l'administrateur déverrouillé, sur son propre compte.
  const admin = profil.admin && !adminSur;
  function exigerAdmin() {
    if (!admin || session.session.statut() !== 'deverrouille') {
      throw new Error('Réservé à l’administrateur.');
    }
  }
  /** Relit l'annuaire pour l'administrateur (et l'enregistre s'il a changé). */
  const rafraichirAdmin = async (annuaire: Annuaire, forcer = false) => {
    const cles = clesAdminDe(session);
    try {
      const vue = ouvrirAnnuaireAdmin(annuaire, cles);
      if (vue.evenementsGestion.length > 0) {
        // Actions des gestionnaires : reportées au journal AVANT d'effacer la file de l'annuaire.
        const depot = new DepotParametres(session.session.base());
        let donnees = chargerDonnees(depot);
        for (const evenement of vue.evenementsGestion) {
          donnees = avecEvenement(donnees, evenement, Date.now());
        }
        enregistrerDonnees(depot, donnees);
      }
      if (vue.modifie || forcer) {
        await ecrireAnnuaireDisque(vue.annuaire);
      }
      annuaireRef.current = vue.annuaire;
      setEtat({ phase: 'prete', session, profil: vue.profils[0], profils: vue.profils });
      return vue;
    } finally {
      effacer(cles);
    }
  };
  /** Titulaire (Administrateur, Fondateur autre que le compte historique) : relit sa vue, enregistre ce qui a changé. */
  const rafraichirTitulaire = async (annuaire: Annuaire, forcer = false) => {
    const cles = clesAdminDe(session);
    try {
      const vue = ouvrirAnnuaireTitulaire(annuaire, profil.id, profil.nom, cles);
      if (vue.modifie || forcer) {
        await ecrireAnnuaireDisque(vue.annuaire);
      } else {
        annuaireRef.current = annuaire;
      }
      setEtat(c => (c.phase === 'prete' && c.session === session ? { ...c, profil: vue.profils[0], profils: vue.profils } : c));
      return vue;
    } finally {
      effacer(cles);
    }
  };
  const avecCles = async <T,>(action: (cles: ClesAdmin, annuaire: Annuaire) => Promise<T> | T): Promise<T> => {
    exigerAdmin();
    const cles = clesAdminDe(session);
    try {
      return await action(cles, annuaireCourant());
    } finally {
      effacer(cles);
    }
  };
  const enregistrer = (liste: readonly Profil[]) =>
    avecCles(async (cles, annuaire) => {
      await rafraichirAdmin(appliquerProfilsAdmin(annuaire, liste, cles), true);
    });

  function quitterCompte(courante: SessionBureau | undefined) {
    // Changer de compte : tout est écrit, la clé effacée, puis la page est
    // rechargée — plus rien du compte précédent ne reste en mémoire.
    void (courante?.vider() ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        courante?.session.verrouiller();
        changerDEspace(ID_PRINCIPAL);
        const fermer = pont()?.profil?.fermer;
        if (fermer) {
          void fermer().catch(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
  }

  /**
   * Crée le coffre d'un ami dans ses propres fichiers et dépose sa clé
   * maîtresse pour le séquestre de l'administrateur. Les écritures de la
   * session partent en arrière-plan : on les attend toutes avant de rendre
   * les identifiants. En cas d'échec, rien ne subsiste.
   */
  async function creerCoffreAmi(
    id: string,
    nom: string,
    publique: string,
    pourTitulaire?: (session: Session) => string,
  ): Promise<{ identifiants: IdentifiantsAmi; depot: string; depotTitulaire?: string }> {
    const ecritures: Array<Promise<void>> = [];
    const suivi: Stockage = {
      ...stockage,
      emplacement: () => stockage.emplacement(),
      lire: nomFichier => stockage.lire(nomFichier),
      ecrire: (nomFichier, octets) => {
        const promesse = stockage.ecrire(nomFichier, octets);
        ecritures.push(promesse);
        return promesse;
      },
    };
    const fichiers = fichiersDuProfil(id) as { coffre: NomFichier; portefeuille: NomFichier };
    try {
      const ami = await ouvrirSessionBureau({
        fabrique: fabriqueRef.current as never,
        stockage: suivi,
        profil: id,
        surErreur: erreur => console.error('Enregistrement impossible', erreur),
      });
      let depot = '';
      let depotTitulaire: string | undefined;
      const identifiants = creerAccesAmi(ami.session, nom, undefined, session => {
        depot = session.deposerPourSequestre(publique, id);
        depotTitulaire = pourTitulaire?.(session);
      });
      await Promise.all(ecritures);
      return { identifiants, depot, depotTitulaire };
    } catch (erreur) {
      await stockage.ecrire(fichiers.coffre, new Uint8Array(0)).catch(() => undefined);
      await stockage.ecrire(fichiers.portefeuille, new Uint8Array(0)).catch(() => undefined);
      throw erreur;
    }
  }
  const clePublique = () => {
    const publique = annuaireCourant().admin.cleSequestre;
    if (!publique) {
      throw new Error('Clé de séquestre absente : rouvrez votre compte administrateur.');
    }
    return publique;
  };
  /** Portée des fichiers d'un compte à créer ou régénérer, demandée au processus principal (PC). */
  const autoriserFichiers = async (id: string) => {
    await pont()?.profil?.etendre?.(id);
  };
  const effacerFichiers = async (id: string) => {
    const fichiers = fichiersDuProfil(id) as { coffre: NomFichier; portefeuille: NomFichier };
    await stockage.ecrire(fichiers.coffre, new Uint8Array(0));
    await stockage.ecrire(fichiers.portefeuille, new Uint8Array(0));
  };

  // Site : « Lier à mon compte » pour TOUS (administrateur avec le code du PC, ami avec le sien).
  const liaisonsIci = lireLiaisons(memoireNavigateur);
  const lierSite: ControleProfils['lier'] = pont()
    ? undefined
    : {
        codeConnu: liaisonsIci.comptes[profil.id] ?? liaisonsIci.maitre ?? Object.values(liaisonsIci.comptes)[0],
        onLier: relier,
        suggererAutreCoffre: Boolean(etat.autreCoffre),
      };
  const controle: ControleProfils = {
    actuel: profil,
    tous: profils,
    lier: adminSur ? undefined : lierSite,
    versionComptes,
    peutChanger: Boolean(adminSur) || (annuaireRef.current ? aDesAmis(annuaireRef.current) : false) || profil.id === 'leurre',
    politique: annuaireRef.current?.politique,
    sessionAdmin: adminSur ? { nomCompte: profil.nom, par: adminSur, ...(etat.rangSur ? { rang: LIBELLES_RANG[etat.rangSur] } : {}) } : undefined,
    // Un Fondateur n'est scellé pour personne : pas d'avertissement.
    transparence: profil.admin || profil.id === 'leurre' || rangDe(profil) === 'fondateur' ? undefined : etat.transparence ?? { sequestreActif: false },
    onChanger: () => quitterCompte(session),
    onAjouter: async nom => {
      exigerAdmin();
      const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
      await enregistrer(ajouterProfil(profils, nom, id, new Date().toISOString().slice(0, 10)));
    },
    onSupprimer: async id => {
      exigerAdmin();
      exiger(profil, 'supprimer-ami', profils.find(p => p.id === id));
      await effacerFichiers(id);
      await enregistrer(supprimerProfil(profils, id));
    },
    onRenommer: async (id, nom) => {
      exigerAdmin();
      if (id !== profil.id) exiger(profil, 'renommer-ami', profils.find(p => p.id === id));
      await enregistrer(renommerProfil(profils, id, nom));
    },
    onConnexion: () => {
      // Jamais bloquant : un échec ici n'empêche pas d'utiliser le compte.
      const noter = async () => {
        if (adminSur || profil.id === 'leurre') {
          return;
        }
        const maintenant = new Date().toISOString();
        if (profil.admin) {
          const annuaire = annuaireCourant();
          let suivant: Annuaire = { ...annuaire, admin: { ...annuaire.admin, derniereConnexion: maintenant } };
          if (etat.prenomAAdopter) {
            // Compte historique : le prénom saisi devient le sien (il ouvrira
            // désormais son compte comme les autres, et le leurre protège le reste).
            const cles = clesAdminDe(session);
            try {
              suivant = adopterPrenomAdmin(suivant, etat.prenomAAdopter, cles) ?? suivant;
            } finally {
              effacer(cles);
            }
          }
          await rafraichirAdmin(suivant, true);
          return;
        }
        const depot = new DepotParametres(session.session.base());
        const connexions = (Number(depot.lire(PARAM_CONNEXIONS)) || 0) + 1;
        depot.ecrire(PARAM_CONNEXIONS, String(connexions));
        const annuaire = await lireAnnuaireDisque();
        const suivant = noterConnexionAmi(annuaire, profil.id, maintenant, connexions, publique =>
          session.session.deposerPourSequestre(publique, profil.id),
        );
        if (!suivant.heritage) {
          await ecrireAnnuaireDisque(suivant);
        }
        const entree = suivant.comptes.find(c => c.id === profil.id);
        const acces = accesAdminLus(session);
        setEtat(courant =>
          courant.phase === 'prete' && courant.session === session
            ? { ...courant, transparence: transparenceDe(acces, entree ? entree.sequestre.etat !== 'revoque' || Boolean(entree.sequestres) : false) }
            : courant,
        );
        if (!suivant.heritage && estTitulaireRole(entree?.acces.role)) {
          // Administrateur ou Fondateur : sa paire (créée au besoin), ses dépôts convertis, sa vue des comptes inférieurs.
          await rafraichirTitulaire(suivant);
        }
      };
      void noter().catch(erreur => console.warn('Connexion non notée :', erreurTexte(erreur)));
    },
  };
  if (admin) {
    Object.assign(controle, {
      onCreerCompte: async (nom: string, apps: readonly string[], options?: OptionsNouveauProfil) => {
        exigerAdmin();
        const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
        // On valide le nom et l'identifiant avant de créer le moindre fichier.
        const suivante = ajouterProfil(profils, nom, id, new Date().toISOString().slice(0, 10), apps, options);
        const { identifiants, depot } = await creerCoffreAmi(id, nom.trim(), clePublique());
        await avecCles(async (cles, annuaire) => {
          await rafraichirAdmin(deposerSequestre(appliquerProfilsAdmin(annuaire, suivante, cles), id, depot), true);
        });
        return identifiants;
      },
      onRegenerer: async (id: string) => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id);
        if (!ami || ami.admin) {
          throw new Error('Profil introuvable.');
        }
        exiger(profil, 'regenerer-identifiants', ami);
        await effacerFichiers(id);
        const { identifiants, depot } = await creerCoffreAmi(id, ami.nom, clePublique());
        await rafraichirAdmin(deposerSequestre(annuaireCourant(), id, depot), true);
        return identifiants;
      },
      onAutoriser: async (id: string, apps: readonly string[]) => enregistrer(autoriserApps(profils, id, apps)),
      onActiver: async (id: string, actif: boolean) => enregistrer(activerProfil(profils, id, actif)),
      onModifierProfils: async (suivants: readonly Profil[]) => {
        // Règle des rangs : aucun compte de rang égal (un autre Fondateur) ne change par ce chemin.
        verifierModifications(profil, profils, suivants);
        await enregistrer(validerModification(profils, suivants));
      },
      onCodeAcces: async (id: string) => {
        exiger(profil, 'acces-sequestre', profils.find(p => p.id === id));
        return avecCles((cles, annuaire) => codeAcces(annuaire, id, cles));
      },
      onRegenererCode: async (id: string) =>
        avecCles(async (cles, annuaire) => {
          exiger(profil, 'acces-sequestre', profils.find(p => p.id === id));
          const { annuaire: suivant, code } = regenererCodeAcces(annuaire, id, cles);
          await rafraichirAdmin(suivant, true);
          return code;
        }),
      onRevoquerAcces: async (id: string) =>
        avecCles(async (cles, annuaire) => {
          exiger(profil, 'acces-sequestre', profils.find(p => p.id === id));
          await rafraichirAdmin(revoquerSequestre(annuaire, id, cles), true);
        }),
      onRetablirAcces: async (id: string) =>
        avecCles(async (_cles, annuaire) => {
          exiger(profil, 'acces-sequestre', profils.find(p => p.id === id));
          await rafraichirAdmin(retablirSequestre(annuaire, id), true);
        }),
      onCodeSite: async (id: string) => {
        exigerAdmin();
        if (!profils.some(p => p.id === id && !p.admin)) {
          throw new Error('Compte introuvable.');
        }
        exiger(profil, 'code-site', profils.find(p => p.id === id));
        const config = lireConfigRelais(session.session.base());
        const maitre: Liaison | undefined = config
          ? { relais: config.relais, jeton: config.jeton, ...(config.site ? { site: config.site } : {}) }
          : liaisonPourCompte(memoireNavigateur, ID_PRINCIPAL, await liaisonDuPont());
        if (!maitre || !estMaitre(maitre)) {
          throw new Error('Reliez d’abord cet appareil au relais (Paramètres › Synchronisation), puis réessayez.');
        }
        const liaison = liaisonPourProfil(maitre, id);
        // Son compte (projection, coffre, portefeuille) part tout de suite sur le relais.
        planComptes.current?.demander(300);
        return { code: encoderLiaison(liaison), lien: lienSite(liaison) };
      },
      onOuvrirCompte: async (id: string, code: string) => {
        const ami = profils.find(p => p.id === id && !p.admin);
        if (!ami) {
          throw new Error('Compte introuvable.');
        }
        exiger(profil, 'ouvrir-compte', ami);
        // La clé de l'ami est relue AVANT de fermer la session de l'administrateur.
        const cle = await avecCles((cles, annuaire) => ouvrirSequestre(annuaire, id, code, cles));
        await session.vider();
        session.session.verrouiller();
        await ouvrir({ id, nom: ami.nom, admin: false }, { cle, adminSur: profil.nom, rangSur: 'fondateur' });
      },
      onChangerRang: async (id: string, rang: Rang) => {
        exigerAdmin();
        // Règle des rangs d'abord (acteur et cible), puis registre, paire, re-scellement.
        exigerRang(profil, profils.find(p => p.id === id), rang);
        return avecCles(async (cles, annuaire) => {
          const r = changerRang(annuaire, ID_PRINCIPAL, cles, id, rang);
          await rafraichirAdmin(r.annuaire, true);
          return { enAttente: r.enAttente };
        });
      },
    } satisfies Partial<ControleProfils>);
  }

  // Gestionnaire : un ami à l'Administration limitée. Il agit sur la partie publique de
  // l'annuaire (règles d'accès), ne voit que les amis qu'il a créés (son carnet, dans sa
  // propre base) et n'a aucune clé de l'administrateur. Son rôle est relu dans l'annuaire à
  // CHAQUE action : une rétrogradation prend effet aussitôt.
  const estGestionnaire = profil.role === 'gestionnaire' && !profil.admin && !adminSur && profil.id !== 'leurre';
  if (estGestionnaire) {
    const depotGestion = () => new DepotParametres(session.session.base());
    const carnetCourant = () => lireCarnet(depotGestion().lire(CLE_CARNET_GESTION));
    const rafraichirGestion = () => setEtat(courant => (courant.phase === 'prete' ? { ...courant } : courant));
    const exigerGestionnaire = async (): Promise<Annuaire> => {
      if (session.session.statut() !== 'deverrouille') {
        throw new Error('Déverrouillez votre compte.');
      }
      const annuaire = await lireAnnuaireDisque();
      if (annuaire.restreint) {
        // Navigateur relié avec le code propre à ce compte : il ne connaît que lui.
        throw new Error('Sur ce navigateur, seul votre compte est connu : gérez vos amis depuis l’appareil de l’administrateur.');
      }
      if (roleDuCompte(annuaire, profil.id) !== 'gestionnaire') {
        throw new Error('Ce compte n’est plus gestionnaire.');
      }
      return annuaire;
    };
    // Vue calculée à la demande : le carnet est dans la base, illisible avant le déverrouillage.
    Object.defineProperty(controle, 'gestion', {
      enumerable: true,
      get: () => {
        try {
          const annuaire = annuaireRef.current;
          if (!annuaire || annuaire.heritage || annuaire.restreint || session.session.statut() !== 'deverrouille') {
            return undefined;
          }
          const comptes = carnetCourant()
            .filter(e => roleDuCompte(annuaire, e.id) === 'ami')
            .map(e => compteGere(annuaire, e.id, e.nom, profil.id))
            .filter((c): c is Profil => c !== undefined);
          return { comptes, apercu: apercuAnonyme(annuaire), autres: Math.max(0, annuaire.comptes.length - 1 - comptes.length) };
        } catch {
          return undefined;
        }
      },
    });
    Object.assign(controle, {
      onCreerCompte: async (nom: string, apps: readonly string[], options?: OptionsNouveauProfil) => {
        exiger(profil, 'creer-ami');
        const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
        const maintenant = new Date().toISOString();
        const nouveau = { id, nom, gestionnaireId: profil.id, apps, niveaux: options?.niveaux, invitationExpireLe: options?.invitationExpireLe, expireLe: options?.expireLe };
        // Validation (prénom libre, rôle, clé de séquestre) AVANT de créer le moindre fichier.
        const verifie = await exigerGestionnaire();
        ajouterCompteGere(verifie, nouveau, maintenant);
        const publique = verifie.admin.cleSequestre as string;
        await autoriserFichiers(id);
        const { identifiants, depot } = await creerCoffreAmi(id, nom.trim(), publique);
        try {
          await enFile(async () => {
            const frais = await exigerGestionnaire();
            await ecrireAnnuaireDisque(deposerSequestre(ajouterCompteGere(frais, nouveau, maintenant), id, depot));
          });
        } catch (erreur) {
          await effacerFichiers(id).catch(() => undefined);
          throw erreur;
        }
        depotGestion().ecrire(CLE_CARNET_GESTION, ecrireCarnet(ajouterAuCarnet(carnetCourant(), { id, nom: nom.trim().slice(0, 30), creeLe: maintenant.slice(0, 10) })));
        rafraichirGestion();
        return identifiants;
      },
      onRegenerer: async (id: string) => {
        const annuaire = await exigerGestionnaire();
        const entree = carnetCourant().find(e => e.id === id);
        // Seuls les amis créés par ce gestionnaire, et jamais un autre gestionnaire.
        exiger(profil, 'regenerer-identifiants', { id, admin: false, role: roleDuCompte(annuaire, id) === 'gestionnaire' ? 'gestionnaire' : 'ami', creePar: entree ? profil.id : undefined });
        if (!entree || !annuaire.admin.cleSequestre) {
          throw new Error('Profil introuvable.');
        }
        await autoriserFichiers(id);
        await effacerFichiers(id);
        const { identifiants, depot } = await creerCoffreAmi(id, entree.nom, annuaire.admin.cleSequestre);
        await enFile(async () => ecrireAnnuaireDisque(deposerSequestre(await exigerGestionnaire(), id, depot)));
        rafraichirGestion();
        return identifiants;
      },
      onModifierProfils: (suivants: readonly Profil[]) =>
        enFile(async () => {
          const annuaire = await exigerGestionnaire();
          const carnet = carnetCourant();
          const ids = new Set(carnet.map(e => e.id));
          for (const p of suivants) {
            if (!ids.has(p.id) || p.nom !== carnet.find(e => e.id === p.id)?.nom) {
              throw new Error('Ce compte ne fait pas partie de ceux que vous gérez.');
            }
          }
          await ecrireAnnuaireDisque(appliquerAccesGeres(annuaire, profil.id, suivants, ids));
          rafraichirGestion();
        }),
      onJournalGestion: (evenement: { type: string; action: string; cible?: string; nomCible?: string; app?: string }) => {
        const date = new Date().toISOString();
        return enFile(async () => {
          const annuaire = await exigerGestionnaire();
          await ecrireAnnuaireDisque(ajouterEvenementGestion(annuaire, profil.id, { ...evenement, type: evenement.type as TypeEvenement, date }));
        });
      },
    } satisfies Partial<ControleProfils>);
  }

  // Administrateur (ou Fondateur autre que le compte historique) : l'Administration complète sur
  // les rangs STRICTEMENT inférieurs, avec SA paire de séquestre et SES codes d'accès. Son rang est
  // relu dans l'annuaire à chaque action ; chaque fonction de `rangs.ts` revérifie la règle des rangs.
  const estTitulaireIci = estTitulaireRole(profil.role) && !profil.admin && !adminSur && profil.id !== 'leurre';
  if (estTitulaireIci) {
    const rangT = profil.role as 'administrateur' | 'fondateur';
    const restreintIci = Boolean(annuaireRef.current?.restreint);
    const exigerTitulaire = async (): Promise<Annuaire> => {
      if (session.session.statut() !== 'deverrouille') {
        throw new Error('Déverrouillez votre compte.');
      }
      const annuaire = await lireAnnuaireDisque();
      if (!estTitulaireRole(roleDuCompte(annuaire, profil.id))) {
        throw new Error('Ce compte n’est plus Administrateur ni Fondateur.');
      }
      return annuaire;
    };
    const avecClesT = async <T,>(action: (cles: ClesAdmin, annuaire: Annuaire) => Promise<T> | T): Promise<T> => {
      const annuaire = await exigerTitulaire();
      const cles = clesAdminDe(session);
      try {
        return await action(cles, annuaire);
      } finally {
        effacer(cles);
      }
    };
    const cibleVue = (id: string) => profils.find(p => p.id === id);
    const surPc = (quoi: string) => {
      if (restreintIci) {
        throw new Error(`${quoi} se fait depuis l’appareil qui a l’annuaire complet (le PC), pas depuis ce navigateur.`);
      }
    };
    const clesPubliques = (annuaire: Annuaire) => {
      const principal = annuaire.admin.cleSequestre;
      const mienne = publiqueTitulaire(annuaire, profil.id);
      if (!principal || !mienne) {
        throw new Error('Clé de séquestre absente : reconnectez-vous, puis réessayez.');
      }
      return { principal, mienne };
    };
    Object.assign(controle, {
      restreint: restreintIci,
      // Sur un navigateur relié (annuaire restreint), la création exige l'annuaire complet : refusée avec
      // un message clair (la fonction reste fournie : c'est elle qui rend l'Administration disponible ici).
      onCreerCompte: async (nom: string, apps: readonly string[], options?: OptionsNouveauProfil) => {
            surPc('Créer un compte');
            exiger(profil, 'creer-ami');
            const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
            const maintenant = new Date().toISOString();
            const nouveau = { id, nom, gestionnaireId: profil.id, apps, niveaux: options?.niveaux, invitationExpireLe: options?.invitationExpireLe, expireLe: options?.expireLe };
            // Validation (prénom libre, rang, clés) AVANT de créer le moindre fichier.
            const verifie = await exigerTitulaire();
            ajouterCompteGere(verifie, nouveau, maintenant);
            const { principal, mienne } = clesPubliques(verifie);
            await autoriserFichiers(id);
            const { identifiants, depot, depotTitulaire } = await creerCoffreAmi(id, nom.trim(), principal, ami =>
              ami.deposerPourTitulaire(mienne, profil.id, id, { nom: nom.trim().slice(0, 30), creeLe: maintenant.slice(0, 10) }),
            );
            try {
              await enFile(async () => {
                const frais = await exigerTitulaire();
                await rafraichirTitulaire(ajouterCompteParTitulaire(frais, nouveau, { principal: depot, titulaire: depotTitulaire! }, maintenant), true);
              });
            } catch (erreur) {
              await effacerFichiers(id).catch(() => undefined);
              throw erreur;
            }
            return identifiants;
          },
      onRegenerer: restreintIci
        ? undefined
        : async (id: string) => {
            const cible = cibleVue(id);
            exiger(profil, 'regenerer-identifiants', cible);
            const { principal, mienne } = clesPubliques(await exigerTitulaire());
            await autoriserFichiers(id);
            await effacerFichiers(id);
            const { identifiants, depot, depotTitulaire } = await creerCoffreAmi(id, cible!.nom, principal, ami =>
              ami.deposerPourTitulaire(mienne, profil.id, id, { nom: cible!.nom, ...(cible!.creeLe ? { creeLe: cible!.creeLe } : {}) }),
            );
            await enFile(async () => rafraichirTitulaire(regenererSequestres(await exigerTitulaire(), profil.id, id, { principal: depot, titulaire: depotTitulaire }), true));
            return identifiants;
          },
      onModifierProfils: (suivants: readonly Profil[]) =>
        enFile(async () => {
          const annuaire = await exigerTitulaire();
          let suivant = appliquerAccesParTitulaire(annuaire, profil.id, suivants);
          if (suivant.restreint) {
            // Sur ce navigateur : en attente, repris par un Fondateur au prochain tour (retour).
            const modifications = { ...(annuaire.modifications ?? {}) };
            for (const c of suivant.comptes) {
              const avant = annuaire.comptes.find(e => e.id === c.id);
              if (avant && JSON.stringify(avant.acces) !== JSON.stringify(c.acces)) modifications[c.id] = c.acces;
            }
            suivant = { ...suivant, modifications };
          }
          await rafraichirTitulaire(suivant, true);
        }),
      onSupprimer: async (id: string) => {
        surPc('Supprimer un compte');
        exiger(profil, 'supprimer-ami', cibleVue(id));
        await enFile(async () => {
          const suivant = supprimerCompteParTitulaire(await exigerTitulaire(), profil.id, id);
          await autoriserFichiers(id);
          await effacerFichiers(id);
          await rafraichirTitulaire(suivant, true);
        });
      },
      onCodeAcces: async (id: string) => {
        exiger(profil, 'acces-sequestre', cibleVue(id));
        return avecClesT((cles, annuaire) => codeAccesTitulaire(annuaire, profil.id, cles, id));
      },
      onRegenererCode: async (id: string) => {
        exiger(profil, 'acces-sequestre', cibleVue(id));
        return avecClesT(async (cles, annuaire) => {
          const { annuaire: suivant, code } = regenererCodeTitulaire(annuaire, profil.id, cles, id);
          await rafraichirTitulaire(suivant, true);
          return code;
        });
      },
      onRevoquerAcces: async (id: string) => {
        exiger(profil, 'acces-sequestre', cibleVue(id));
        await avecClesT(async (cles, annuaire) => rafraichirTitulaire(revoquerSequestreTitulaire(annuaire, profil.id, cles, id), true));
      },
      onRetablirAcces: async (id: string) => {
        exiger(profil, 'acces-sequestre', cibleVue(id));
        await avecClesT(async (_cles, annuaire) => rafraichirTitulaire(retablirSequestreTitulaire(annuaire, profil.id, id), true));
      },
      onOuvrirCompte: async (id: string, code: string) => {
        const cible = cibleVue(id);
        exiger(profil, 'ouvrir-compte', cible);
        if (restreintIci) {
          // Navigateur relié : le coffre et le portefeuille de ce compte arrivent par délégation.
          const liaison = liaisonPourCompte(memoireNavigateur, profil.id);
          if (liaison) {
            await auPlus(avantOuverture({ memoire: memoireNavigateur, fichiers: stockage as never, compte: id, liaison }), 15_000);
          }
        }
        await autoriserFichiers(id);
        // La clé est relue AVANT de fermer la session du titulaire.
        const cle = await avecClesT((cles, annuaire) => ouvrirSequestreTitulaire(annuaire, profil.id, cles, id, code));
        // Le journal de cet accès (scellé pour les Fondateurs) part AVANT de fermer la session.
        await enFile(async () => undefined);
        await session.vider();
        session.session.verrouiller();
        await ouvrir({ id, nom: cible!.nom, admin: false }, { cle, adminSur: profil.nom, rangSur: rangT });
      },
      onChangerRang: restreintIci
        ? undefined
        : async (id: string, rang: Rang) => {
            exigerRang(profil, cibleVue(id), rang);
            return avecClesT(async (cles, annuaire) => {
              const r = changerRang(annuaire, profil.id, cles, id, rang);
              await rafraichirTitulaire(r.annuaire, true);
              return { enAttente: r.enAttente };
            });
          },
      onPolitique:
        rangT === 'fondateur' && !restreintIci
          ? async (politique: NonNullable<Annuaire['politique']>) => {
              exiger(profil, 'politique-apps');
              await enFile(async () => rafraichirTitulaire({ ...(await exigerTitulaire()), politique }, true));
            }
          : undefined,
      onJournalGestion: (evenement: { type: string; action: string; cible?: string; nomCible?: string; app?: string }) => {
        const date = new Date().toISOString();
        return enFile(async () => {
          const annuaire = await exigerTitulaire();
          await ecrireAnnuaireDisque(ajouterEvenementGestion(annuaire, profil.id, { ...evenement, type: evenement.type as TypeEvenement, date }));
        });
      },
    } satisfies Partial<ControleProfils>);
  }

  const libelleRangSur = etat.rangSur ? LIBELLES_RANG[etat.rangSur] : 'Administrateur';
  return (
    <View style={[styles.pleinEcran, { backgroundColor: palette.fond }]}>
      <BandeauMiseAJour palette={palette} />
      {adminSur ? (
        <View style={[styles.bandeauAdmin, { backgroundColor: palette.danger }]} testID="bandeau-session-admin" accessibilityRole="alert">
          <Text style={{ color: '#fff', fontWeight: '700', flex: 1 }} testID="bandeau-session-texte">
            Session de {adminSur} ({libelleRangSur}) sur le compte de {profil.nom} — accès journalisé
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => quitterCompte(session)}
            testID="quitter-session-admin"
            style={({ pressed }) => [styles.boutonBandeau, { backgroundColor: pressed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)' }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Revenir à mon compte</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.pleinEcran}>
        <GardeErreur quoi="votre compte" onRevenir={() => quitterCompte(session)}>
          <App key={`${profil.id}-${adminSur ?? ''}`} session={session.session} chargementAutomatique profils={controle} hub />
        </GardeErreur>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pleinEcran: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: ESPACEMENT.xl },
  motif: { textAlign: 'center', maxWidth: 520, marginTop: ESPACEMENT.m, lineHeight: 22 },
  boutonBandeau: { borderWidth: 1, borderColor: '#fff', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  bandeauAdmin: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s, paddingVertical: ESPACEMENT.s, paddingHorizontal: ESPACEMENT.m, flexWrap: 'wrap' },
});

createRoot(document.getElementById('racine')!).render(
  <SafeAreaProvider>
    <Racine />
  </SafeAreaProvider>,
);
