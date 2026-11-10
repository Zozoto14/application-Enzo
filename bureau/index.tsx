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
import { ESPACEMENT, assurerThemeDocument, palettePour } from '../src/ui/theme';
import { useFondDocument } from './Bureau';
import { BandeauMiseAJour } from './MiseAJour';
import { BandeauNouvelleVersion } from './NouvelleVersion';
import { installerEcouteursChunks } from '../src/ui/versionPerimee';
import { preparerLangue } from '../src/esport/i18n';
import { noterSessionOuverte, surveillanceSite } from '../src/hub/maj/version';
import { ouvrirSessionBureau, type SessionBureau } from './session';
import { pont, stockageCachesBureau, stockageCourant, type NomFichier, type Stockage } from './stockage';
import { definirStockageCaches, cachesSynchro } from '../src/sync/relais/caches';
import { Prechargeur, definirPrechargeur, noterEtatDemarrage } from '../src/sync/relais/prechargement';
import { Connexion } from '../src/ui/ecrans/ChoixProfil';
import { GardeErreur } from '../src/ui/GardeErreur';
import type { ControleProfils, OptionsInvitationHote } from '../src/ui/ecrans/CarteProfils';
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
  reparerNomsAdmin,
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
import { Session, coffreValide } from '../src/session/session';
import { stockageMemoire } from '../src/session/stockage-coffre';
import { creerAccesAmi, type IdentifiantsAmi } from '../src/profils/identifiants';
import { installerPontWeb } from './web';
import { RacineAnnexe } from './annexe';
import { rattacherAnnexe } from '../src/hub/multi/fenetres';
import { LIBELLES_RANG, exiger, exigerRang, rangDe, type Rang } from '../src/hub/admin/roles';
import { avecEvenement, chargerDonnees, enregistrerDonnees } from '../src/hub/admin/donnees';
import { verifierModifications } from '../src/hub/admin/actions';
import { CLE_CARNET_GESTION, ajouterAuCarnet, ecrireCarnet, lireCarnet } from '../src/hub/admin/gestion';
import type { TypeEvenement } from '../src/hub/admin/journal';
import { CLE_DONNEES } from '../src/hub/admin/donnees';
import { AccueilSite, RemplacerDonnees } from './AccueilSite';
import { ab1TemporaireOuvert, CLE_AB1_TERMINE, codeAb1DuLien, connexionParIdentifiantActive, liaisonsAEssayer } from './liaisonTemporaire';
import {
  avantOuverture,
  coffreAdminEtranger,
  memeCoffre,
  liaisonPourCompte,
  lireLiaisons,
  garderPourMemeCompte,
  oublierSuivi,
  preparerLiaison,
  CLES_MEMOIRE,
  retenirLiaison,
  synchroniserAnnuaire,
  lireAbonnementAmi,
  synchroniserCompteAmi,
  synchroniserComptesAdmin,
  type CompteRelie,
  type Memoire,
} from './synchroComptes';
import { decoderLiaison, encoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { estMaitre } from '../src/sync/relais/portees';
import { definirLiaisonCompte } from '../src/sync/relais/actif';
import { lireConfigRelais, mesurerEcartHorloge, recupererCoffre } from '../src/sync/relais/synchroniser';
import { formaterDiagnostic, lireEnvironnement } from '../src/diagnostic/deverrouillage';
import { empreinte as empreinteCanonique } from '../src/sync/relais/fusionLww';
import { versionApp } from '../src/hub/version';
import { versBase64 } from '../src/sync/relais/chiffrement';
import { EcranInvitation } from './Invitation';
import {
  accepterInvitation,
  chargerCodeCourt,
  chargerInvitation,
  coffreReinitialise,
  relaisActuel,
  connecterParIdentifiant,
  connecterParSecours,
  creerInvitation,
  nettoyerCompteRelais,
  publierAccesFondateur,
  type ConnexionIdentifiant,
  siteDesLiens,
  type InvitationChargee,
} from './connexionAmis';
import { EcranConnexionFondateur, type ResultatMigration } from './ConnexionFondateur';
import { genererCodeRecuperation } from '../src/securite/codes-recuperation';
import { aleatoireParDefaut } from '../src/securite/aleatoire';
import { apercuTheme } from '../src/ui/theme';
import { lireThemeAppareil } from '../src/hub/themeAppareil';
import { deposerCoffreSiChange } from '../src/sync/relais/synchroniser';
import { viderCoffreServeur } from '../src/sync/relais/coffreServeur';
import {
  ErreurInvitation,
  decoderInvitation,
  empreinteIdentifiant,
  lienConnexion,
  normaliserCodeCourt,
  politiqueDeContenu,
  relaisDuLien,
  type LienInvitation,
  type PolitiqueMdp,
} from '../src/profils/invitation';
import { activerA2f, compteRevoque, debloquerConnexions, desactiverA2f, diagnosticConnexions, etatA2f, lireThemePublic, publierThemePublic, revoquerCompte, supprimerAcces, versionRelais } from '../src/sync/relais/connexionAmis';
import { genererSecretTotp, uriOtpauth } from '../src/securite/totp';
import type { ServicesA2f } from '../src/hub/ReglageA2f';
import { espacesDuRelais } from '../src/sync/relais/espaces';
import { empreinteOctets } from '../src/sync/relais/fichiers';
import type { Coffre } from '../src/securite/coffre';
import { genererMotDePasse, type InvitationAffichee } from '../src/profils/identifiants';

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

// Fenêtre annexe (« Ouvrir dans une nouvelle fenêtre ») : elle se rattache à la fenêtre principale,
// qui lui prête sa session ouverte. Rien d'autre ne démarre ici (ni préchargement, ni synchronisation).
const contexteAnnexe = rattacherAnnexe();

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
  | { phase: 'connexion'; enCours?: boolean; erreur?: string }
  /** Lien d'invitation ouvert (ou collé) : l'ami choisit son mot de passe. */
  | { phase: 'invitation'; chargee?: InvitationChargee; erreur?: string; autreCompteIci?: boolean }
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
  /** Navigateur neuf : se connecter (identifiant + mot de passe), ouvrir une invitation, ou créer un coffre. */
  | { phase: 'accueil'; erreur?: string; /** TEMPORAIRE : code AB1 apporté par un lien `#liaison=` (liaisonTemporaire.ts). */ codeAb1?: string }
  /** Ce navigateur a déjà un coffre : remplacer ses données par celles du compte relié ? */
  | { phase: 'remplacer'; relie: CompteRelie };

const decodeur = new TextDecoder();
const encodeur = new TextEncoder();
/** Paramètres de la base d'un ami (sa propre base chiffrée). */
const PARAM_CONNEXIONS = 'compte.connexions';
const PARAM_ACCES_ADMIN = 'compte.accesAdmin';
const PARAM_APPAREILS = 'compte.appareils';
/** Identifiant de connexion du Fondateur (relais version 9), dans sa base : synchronisé avec ses données. */
const PARAM_IDENTIFIANT = 'compte.identifiant';
/** Thème publié pour l'écran de connexion (empreinte d'identifiant | thème), pour ne le republier qu'au changement. */
const CLE_THEME_PUBLIE = 'applibourse.theme.publie';

/** Nom lisible de cet appareil (« iPhone · Safari », « Windows · Chrome », « PC (application) »). */
export function nomAppareil(ua: string, application: boolean): string {
  const systeme = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  if (application) return `${systeme === 'Appareil' ? 'PC' : systeme} (application)`;
  const navigateur = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
  return `${systeme} · ${navigateur}`;
}

/** Note cet appareil dans la liste des appareils de l'ami (sa base) ; rend la liste à sceller pour l'administrateur. */
function noterAppareil(depot: DepotParametres, maintenant: string): Array<{ nom: string; vu: string }> {
  let id = memoireNavigateur.getItem('applibourse.appareil');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), o => o.toString(16).padStart(2, '0')).join('');
    memoireNavigateur.setItem('applibourse.appareil', id);
  }
  let liste: Array<{ id: string; nom: string; vu: string }> = [];
  try {
    const lu = JSON.parse(depot.lire(PARAM_APPAREILS) ?? '[]') as unknown;
    if (Array.isArray(lu)) liste = lu.filter(a => a && typeof a.id === 'string' && typeof a.nom === 'string' && typeof a.vu === 'string');
  } catch {
    liste = [];
  }
  const nom = nomAppareil(globalThis.navigator?.userAgent ?? '', Boolean(pont()));
  liste = [{ id, nom, vu: maintenant }, ...liste.filter(a => a.id !== id)].slice(0, 8);
  depot.ecrire(PARAM_APPAREILS, JSON.stringify(liste));
  return liste.map(({ nom: n, vu }) => ({ nom: n, vu }));
}

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

/**
 * Ancien lien `…/#liaison=AB1.…` (QR code d'avant la version 9) : il n'ouvre plus rien (plus de
 * code de liaison) ; il est seulement retiré de l'adresse. On se connecte par identifiant.
 */
function lienDeLiaisonPerime(): boolean {
  return /liaison=AB1\./.test(globalThis.location?.hash ?? '');
}

/** TEMPORAIRE (liaisonTemporaire.ts) : le code AB1 de l'administrateur est-il encore accepté sur ce site ? */
function ab1Accepte(): boolean {
  return !pont() && ab1TemporaireOuvert(new Date(), Boolean(memoireNavigateur.getItem(CLE_AB1_TERMINE)));
}

/** Dernier identifiant (prénom) d'un ami connecté sur ce navigateur, et adresse du relais connue ici. */
const CLE_IDENTIFIANT = 'applibourse.identifiant';
const CLE_RELAIS_CONNU = 'applibourse.relaisConnu';

/** Invitation apportée par un lien `…/#invitation=AI1.…`. */
function invitationDuLien(): LienInvitation | undefined {
  const fragment = globalThis.location?.hash ?? '';
  return /invitation=/.test(fragment) ? decoderInvitation(fragment) ?? undefined : undefined;
}

/** Un lien `#invitation=` illisible (coupé par une messagerie) : à signaler, pas à ignorer. */
function invitationAbimee(): boolean {
  const fragment = globalThis.location?.hash ?? '';
  return /invitation=/.test(fragment) && !decoderInvitation(fragment);
}

/** Langue demandée par le lien d'invitation (`?lang=en` ou `?lang=fr`) ; absente : celle du compte, puis de l'appareil. */
function langueDuLien(): 'fr' | 'en' | undefined {
  try {
    const m = /[?&]lang=(fr|en)(?:[&#]|$)/i.exec(window.location.search);
    return m ? (m[1].toLowerCase() as 'fr' | 'en') : undefined;
  } catch {
    return undefined;
  }
}

/** Fragment retiré de l'adresse : un rechargement ne rejoue ni l'invitation, ni le code. */
function effacerFragment(): void {
  try {
    globalThis.history?.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`);
  } catch {
    // Rien.
  }
}

/**
 * Adresse du relais connue de ce navigateur, pour la connexion par identifiant
 * d'un appareil neuf : lien `#relais=`, mémoire du navigateur, codes de liaison
 * retenus, ou fichier `relais.json` publié avec le site (rien de secret).
 */
async function relaisConnu(): Promise<string | undefined> {
  // Ancienne adresse connue (Worker Cloudflare supprimé) : le relais du site la remplace (relais.json lu seulement alors).
  const actuel = async (adresse: string) => (/\.workers\.dev\/*$/i.test(adresse) ? relaisActuel(adresse, await relaisDuSite()) : adresse);
  const duLien = relaisDuLien(globalThis.location?.hash ?? '');
  if (duLien) {
    const adresse = await actuel(duLien);
    memoireNavigateur.setItem(CLE_RELAIS_CONNU, adresse);
    return adresse;
  }
  const retenu = memoireNavigateur.getItem(CLE_RELAIS_CONNU);
  if (retenu && /^https:\/\//.test(retenu)) return actuel(retenu);
  const liaisons = lireLiaisons(memoireNavigateur);
  const code = liaisons.maitre ?? Object.values(liaisons.comptes)[0];
  const liaison = code ? decoderLiaison(code) : undefined;
  if (liaison) return actuel(liaison.relais);
  // Pas de fichier : le lien de connexion reçu avec l'invitation le donnera.
  return relaisDuSite();
}

/** Relais annoncé par le site lui-même (`relais.json`, publié avec lui), ou rien. */
async function relaisDuSite(): Promise<string | undefined> {
  try {
    const reponse = await auPlus(fetch('relais.json', { cache: 'no-store' }), 4_000);
    const lu = reponse?.ok ? ((await reponse.json()) as { relais?: unknown }) : undefined;
    if (typeof lu?.relais === 'string' && /^https:\/\/[^\s/]+/.test(lu.relais)) return lu.relais.replace(/\/+$/, '');
  } catch {
    // Pas de fichier.
  }
  return undefined;
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

/** Liaison MAÎTRE du compte du Fondateur sur cet appareil : configuration du relais (base), code retenu, ou PC. */
async function liaisonMaitreDe(session: SessionBureau): Promise<Liaison | undefined> {
  const config = session.session.statut() === 'deverrouille' ? lireConfigRelais(session.session.base()) : undefined;
  const maitre: Liaison | undefined = config
    ? { relais: config.relais, jeton: config.jeton, ...(config.site ? { site: config.site } : {}) }
    : liaisonPourCompte(memoireNavigateur, ID_PRINCIPAL, await liaisonDuPont());
  return maitre && estMaitre(maitre) ? maitre : undefined;
}

/**
 * Validation en deux étapes du compte ouvert (Paramètres › Sécurité, relais version 10) : le secret est
 * confié au serveur, qui vérifie le code à chaque connexion par identifiant. Le Fondateur reprend le
 * secret de son coffre (même application d'authentification) ; un ami en reçoit un nouveau.
 */
function servicesA2f(session: SessionBureau, profil: Profil, identifiant: string | undefined): ServicesA2f {
  const compte = profil.admin ? ID_PRINCIPAL : profil.id;
  const liaison = async (): Promise<Liaison> => {
    const config = session.session.statut() === 'deverrouille' ? lireConfigRelais(session.session.base()) : undefined;
    const l = profil.admin ? await liaisonMaitreDe(session) : config ? { relais: config.relais, jeton: config.jeton } : undefined;
    if (!l) throw new Error('Cet appareil ne connaît pas encore le serveur : réessayez après la synchronisation.');
    return l;
  };
  return {
    lire: async () => etatA2f(await liaison(), compte),
    preparer: () => {
      const existant = profil.admin ? session.session.secretTotp() : undefined;
      const secret = existant ?? genererSecretTotp(aleatoireParDefaut);
      return { secret, uri: uriOtpauth({ secret, compte: identifiant ?? profil.nom }), reprend: Boolean(existant) };
    },
    activer: async (secret, code) => activerA2f(await liaison(), compte, secret, code),
    desactiver: async code => {
      await desactiverA2f(await liaison(), compte, code);
      // Plus de code nulle part : le coffre de cet appareil cesse aussi de le demander (republié au tour suivant).
      if (session.session.etatCoffre()?.codeDemande) {
        session.session.exempterCodeLocal();
        await session.vider();
      }
    },
  };
}

/** Au plus `ms` : le réseau ne bloque jamais l'ouverture (hors ligne, on continue avec ce qu'on a). */
function auPlus<T>(promesse: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promesse.catch(() => undefined), new Promise<undefined>(ok => setTimeout(() => ok(undefined), ms))]);
}

/** Délai entre deux tours de synchronisation des comptes (serveur PostgreSQL : plus de quota d'écritures). */
const INTERVALLE_COMPTES_MS = 30_000;

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

// ------------------------------------------------ Synchronisation dès le démarrage
//
// Avant tout choix de compte ou déverrouillage : la liaison de l'administrateur déjà connue
// (code retenu par ce navigateur, ou relais-local.json du PC) suffit pour télécharger les
// dépôts chiffrés des autres appareils et pousser l'enveloppe restée en attente. Rien ne
// s'ouvre sans la clé : la fusion se fait au déverrouillage (voir src/sync/relais/prechargement.ts).
const cachesDemarrage = definirStockageCaches(stockageCachesBureau(stockageCourant()));
cachesDemarrage.surChangement(profil => {
  if (profil === ID_PRINCIPAL) {
    noterEtatDemarrage({
      recus: Object.keys(cachesDemarrage.entrant(profil).elements).length,
      aEnvoyer: cachesDemarrage.sortant(profil).elements.length,
    });
  }
});
const prechargeur = new Prechargeur({
  liaison: async () => {
    const maitre = lireLiaisons(memoireNavigateur).maitre;
    return (maitre ? decoderLiaison(maitre) : undefined) ?? (await liaisonDuPont());
  },
  surBilan: bilan => noterEtatDemarrage({ ...(bilan.reussi ? { le: new Date().toISOString() } : {}), recus: bilan.enAttente, aEnvoyer: bilan.aEnvoyer }),
});
definirPrechargeur(prechargeur);
if (!contexteAnnexe) {
  globalThis.addEventListener?.('online', () => prechargeur.enLigne());
  prechargeur.demarrer();
}

const CLE_COFFRE_VU = 'applibourse.diagnostic.coffreVu';

/** Note quand CE coffre a été vu la première fois sur ce navigateur (diagnostic : ancienneté). */
function noterCoffreVu(coffre: unknown): void {
  if (!coffre) return;
  try {
    const vu = JSON.parse(memoireNavigateur.getItem(CLE_COFFRE_VU) ?? 'null') as { e?: string } | null;
    const e = empreinteCanonique(coffre);
    if (vu?.e !== e) memoireNavigateur.setItem(CLE_COFFRE_VU, JSON.stringify({ e, le: new Date().toISOString() }));
  } catch {
    // Stockage refusé (navigation privée) : ancienneté inconnue.
  }
}

/** Ancienneté (jours) du coffre d'ici, si elle a été notée. */
function ageCoffreVu(coffre: unknown): number | undefined {
  try {
    const vu = JSON.parse(memoireNavigateur.getItem(CLE_COFFRE_VU) ?? 'null') as { e?: string; le?: string } | null;
    if (!coffre || !vu?.le || vu.e !== empreinteCanonique(coffre)) return undefined;
    return Math.max(0, Math.floor((Date.now() - Date.parse(vu.le)) / 86_400_000));
  } catch {
    return undefined;
  }
}

/** Rang d'administration (autre que le compte historique) : ouvre des comptes inférieurs par séquestre. */
const estTitulaireRole = (role: Profil['role']): role is 'administrateur' | 'fondateur' => role === 'administrateur' || role === 'fondateur';

function Racine() {
  const sombre = useColorScheme() === 'dark';
  const palette = palettePour(sombre);
  useFondDocument(sombre);
  // Accueil du site, création du coffre, connexion : déjà aux polices et à la couleur du thème.
  assurerThemeDocument();

  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });
  // Mise à jour automatique (src/hub/maj/version.ts) : un compte ouvert attend plus longtemps (il faudra le rouvrir).
  useEffect(() => noterSessionOuverte(etat.phase === 'prete'), [etat.phase]);
  const fabriqueRef = useRef<unknown>(undefined);
  /** Migration du Fondateur vers la connexion par identifiant : proposée, ouverte depuis les Paramètres, ou codes à noter. */
  const [ecranFondateur, setEcranFondateur] = useState<undefined | { mode: 'proposer' | 'modifier' } | { mode: 'codes'; resultat: ResultatMigration }>(undefined);
  const fondateurReporte = useRef(false);
  /** Style de l'écran de connexion : le thème du compte dont on tape l'identifiant (aperçu, rien n'est retenu). */
  const [, setVersionStyle] = useState(0);
  const minuterieStyle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Pour le diagnostic du déverrouillage : coffre publié sur le relais lu à l'ouverture (jamais affiché). */
  const diagnosticOuverture = useRef<{ coffreRelais?: unknown; compteAdmin?: boolean }>({});
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
  const planComptes = useRef<{ demander(delai?: number): void; enTour: boolean; maintenant?(): Promise<void> } | undefined>(undefined);
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
    async (
      compte: CompteTrouve,
      options: {
        cle?: Uint8Array;
        adminSur?: string;
        rangSur?: Rang;
        creation?: boolean;
        motDePasse?: string;
        /** Code à six chiffres déjà saisi à la connexion (validation en deux étapes). */
        codeTotp?: string;
        /** « Mot de passe oublié » : code de récupération et nouveau mot de passe. */
        recuperation?: { code: string; nouveau: string };
        /** Après un déverrouillage réussi (republier l'accès, montrer les codes…). */
        apres?(session: SessionBureau): Promise<void>;
      } = {},
    ) => {
      setEtat({ phase: 'chargement', message: options.adminSur ? `Ouverture du compte de ${compte.nom}…` : undefined });
      try {
        fabriqueRef.current ??= await initSqlJs({ locateFile: () => urlWasm });
        changerDEspace(compte.id);
        await pont()?.profil?.ouvrir(compte.id);
        const annuaire = annuaireRef.current ?? (await lireAnnuaireDisque());
        let coffreRelais: unknown;
        let portefeuilleRelais: Uint8Array | undefined;
        if (!options.adminSur) {
          // Le coffre de CE compte (et, pour un ami, son portefeuille) s'il est plus récent sur le relais.
          await auPlus(
            avantOuverture({
              memoire: memoireNavigateur,
              fichiers: stockage as never,
              compte: compte.id,
              pontMaitre: await liaisonDuPont(),
              surCoffreRelais: publie => {
                coffreRelais = publie;
              },
              surPortefeuilleRelais: octets => {
                portefeuilleRelais = octets;
              },
            }),
            15_000,
          );
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
        let coffreAccepte = false;
        if (!compte.admin) {
          try {
            const brutCoffre = await stockage.lire(fichiersDuProfil(compte.id).coffre as NomFichier);
            coffreAccepte = Boolean(brutCoffre && brutCoffre.length > 0 && (JSON.parse(decodeur.decode(brutCoffre)) as Coffre).sansTotp);
          } catch {
            coffreAccepte = false;
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
          // Mot de passe changé sur le PC : le coffre qu'il a publié est essayé si celui d'ici refuse.
          coffresAlternatifs: compte.admin && !options.adminSur ? () => (coffreValide(coffreRelais) ? [coffreRelais] : []) : undefined,
          // Base d'ici scellée par une autre clé que le coffre (compte recréé) : la copie du relais est essayée.
          portefeuillesAlternatifs: () => (portefeuilleRelais ? [portefeuilleRelais] : []),
          // Compte fermé : refusé seulement après un mot de passe et un code justes.
          verifierOuverture: compte.admin || options.adminSur
            ? undefined
            : () => {
                const vu = profilAmi(annuaireRef.current ?? annuaire, compte.id, compte.nom);
                // Coffre déjà accepté par invitation (mot de passe choisi) : l'invitation a servi à temps,
                // même si la projection d'ici ne le sait pas encore (appareil du Fondateur éteint depuis).
                if (coffreAccepte) delete vu.invitationExpireLe;
                const motif = motifFermeture(vu);
                if (motif) {
                  throw new Error(motif);
                }
              },
        });
        const profil = compte.admin ? profilAdminVerrouille(compte.nom) : profilAmi(annuaire, compte.id, compte.nom);
        if (options.motDePasse && !options.cle) {
          // Juste après l'invitation (ou la connexion par identifiant) : le mot de passe vient d'être saisi.
          try {
            session.session.deverrouiller({ motDePasse: options.motDePasse, codeTotp: options.codeTotp ?? '' });
          } catch {
            // L'écran de déverrouillage s'affiche, avec son message.
          }
        }
        if (options.recuperation && !options.cle) {
          // Mot de passe oublié : le code de récupération ouvre le coffre, le nouveau mot de passe le remplace.
          session.session.recuperer({ codeRecuperation: options.recuperation.code, nouveauMotDePasse: options.recuperation.nouveau });
          await session.vider();
        }
        if (options.apres && session.session.statut() === 'deverrouille') {
          await options.apres(session);
        }
        let transparence: { dernierAccesAdmin?: string; sequestreActif: boolean; par?: string; rangPar?: string } | undefined;
        if (options.cle) {
          session.session.ouvrirAvecCle(options.cle);
          // L'accès est noté dans la base du compte, avec le titulaire et son rang : il le verra dans ses Paramètres.
          const note: AccesNote = { date: new Date().toISOString(), ...(options.adminSur ? { par: options.adminSur } : {}), ...(options.rangSur ? { rang: LIBELLES_RANG[options.rangSur] } : {}) };
          const acces = [...accesAdminLus(session), note].slice(-20);
          new DepotParametres(session.session.base()).ecrire(PARAM_ACCES_ADMIN, JSON.stringify(acces));
          transparence = transparenceDe(acces, true);
        }
        const autreCoffre = compte.admin && !options.adminSur && !pont() ? await coffreAdminEtranger(memoireNavigateur, stockage as never, coffreRelais) : false;
        diagnosticOuverture.current = { coffreRelais, compteAdmin: compte.admin };
        if (compte.admin) noterCoffreVu(session.session.coffreActuel());
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
    // Pas de coffre alternatif : un vrai compte n'en essaie un que dans le cas
    // rare d'un mot de passe changé sur le PC ; le cas courant fait une seule série de dérivations, comme ici.
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
          // Navigateur neuf : se connecter. Un navigateur déjà connecté au compte du Fondateur l'ouvre.
          if (!liaisons.maitre) {
            setEtat({ phase: 'accueil' });
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
      // Lien `#relais=` : l'adresse est retenue pour la connexion par identifiant.
      if (relaisDuLien(globalThis.location?.hash ?? '')) await relaisConnu();
      const invitation = invitationDuLien();
      if (invitation) {
        void ouvrirInvitation(invitation);
        return;
      }
      if (invitationAbimee()) {
        setEtat({ phase: 'invitation', erreur: new ErreurInvitation('lien-illisible').message });
        return;
      }
      // Ancien lien de liaison (QR code d'avant) : retiré de l'adresse, on se connecte par identifiant.
      // TEMPORAIRE : un code AB1 administrateur nouveau pour ce navigateur est proposé sur l'accueil.
      const codeAb1 = lienDeLiaisonPerime() && ab1Accepte() ? codeAb1DuLien(globalThis.location?.hash ?? '') : undefined;
      if (lienDeLiaisonPerime()) effacerFragment();
      const liaisons = lireLiaisons(memoireNavigateur);
      if (codeAb1 && decoderLiaison(codeAb1)?.jeton !== (liaisons.maitre ? decoderLiaison(liaisons.maitre)?.jeton : undefined)) {
        setEtat({ phase: 'accueil', codeAb1 });
        return;
      }
      // Navigateur déjà relié au compte d'un ami (avant la version 9) dont la liste des comptes manque ici :
      // sa projection est relue sur le serveur (même chose qu'à la connexion), sans rien demander.
      const seuleLiaison = Object.values(liaisons.comptes);
      if (!pont() && !liaisons.maitre && seuleLiaison.length === 1 && !annuaire.restreint && !aDesAmis(annuaire)) {
        const relie = await auPlus(preparerLiaison(seuleLiaison[0]), 15_000);
        if (relie?.compte) {
          await ecrireAnnuaireDisque(relie.annuaire);
          annuaire = relie.annuaire;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lireAnnuaireDisque, ecrireAnnuaireDisque, demarrer, stockage]);

  // ------------------------------------------------ Relier ce navigateur à un compte

  /** Fichiers de ce navigateur (compte principal et comptes de l'annuaire d'ici). */
  const fichiersLocaux = useCallback(async (): Promise<NomFichier[]> => {
    const annuaire = await lireAnnuaireDisque();
    const ids = annuaire.heritage ? annuaire.heritage.map(p => p.id) : [ID_PRINCIPAL, ...annuaire.comptes.map(c => c.id)];
    // Avec la copie mise de côté (base scellée par une autre clé) : elle part avec le compte.
    return ['profils', ...[...new Set([ID_PRINCIPAL, ...ids])].flatMap(id => [...Object.values(fichiersDuProfil(id)), `ecarte-${fichiersDuProfil(id).portefeuille}`] as NomFichier[])];
  }, [lireAnnuaireDisque]);

  /** Installe le compte relié : l'ancien contenu du navigateur est effacé, le code retenu. */
  const installerLiaison = useCallback(
    async (relie: CompteRelie) => {
      setEtat({ phase: 'chargement', message: 'Installation du compte…' });
      for (const nom of await fichiersLocaux()) {
        if (nom !== 'profils') await stockage.ecrire(nom, new Uint8Array(0));
      }
      // Autre compte, autre relais : les enveloppes en attente de l'ancien partent aussi.
      await cachesSynchro().vider(ID_PRINCIPAL);
      noterEtatDemarrage({ le: undefined, recus: 0, aEnvoyer: 0 });
      oublierSuivi(memoireNavigateur);
      await ecrireAnnuaireDisque(relie.annuaire);
      retenirLiaison(memoireNavigateur, relie.liaison);
      // Page rechargée : plus rien de l'ancien contenu ni de l'ancienne session en mémoire.
      window.location.reload();
    },
    [fichiersLocaux, stockage, ecrireAnnuaireDisque],
  );

  /**
   * TEMPORAIRE (liaisonTemporaire.ts) : « Relier ce navigateur » avec le code AB1 de l'administrateur.
   * Code lisible, jeton maître, relais connu ; refusé si la connexion par identifiant est déjà active
   * (constaté sur le coffre lu AVEC ce jeton). Puis comme avant la version 9 : installer (ou proposer
   * de remplacer un ancien coffre d'ici), recharger, déverrouiller (mot de passe + code à six chiffres).
   */
  const relierTemporaire = useCallback(
    async (code: string) => {
      if (!ab1Accepte()) throw new Error('Le code de liaison n’est plus accepté : connectez-vous avec votre identifiant et votre mot de passe.');
      const candidats = liaisonsAEssayer(code, await relaisConnu());
      let derniere: unknown;
      for (const liaison of candidats) {
        let coffre: unknown;
        try {
          coffre = await recupererCoffre(liaison);
        } catch (e) {
          derniere = e;
          continue;
        }
        if (connexionParIdentifiantActive(coffre)) {
          memoireNavigateur.setItem(CLE_AB1_TERMINE, new Date().toISOString());
          throw new Error(
            'Ta connexion par identifiant est déjà active : connecte-toi avec ton identifiant, ton mot de passe et ton code à six chiffres (ou « Mot de passe oublié ? »). Le code de liaison ne sert plus.',
          );
        }
        const relie = await preparerLiaison(encoderLiaison(liaison));
        const annuaire = await lireAnnuaireDisque();
        const local = await stockage.lire('coffre');
        if ((local && local.length > 0) || aDesAmis(annuaire)) {
          setEtat({ phase: 'remplacer', relie });
        } else {
          await installerLiaison(relie);
        }
        return;
      }
      throw derniere instanceof Error ? derniere : new Error('Serveur injoignable : réessayez dans un instant.');
    },
    [installerLiaison, lireAnnuaireDisque, stockage],
  );

  /** Ce navigateur contient-il déjà un autre compte que `id` (coffre de l'administrateur, autres comptes) ? */
  const autreCompteIci = useCallback(
    async (id?: string) => {
      const annuaire = await lireAnnuaireDisque();
      const coffre = await stockage.lire('coffre');
      if (coffre && coffre.length > 0) return true;
      return annuaire.comptes.some(c => c.id !== id) || Boolean(annuaire.heritage && annuaire.heritage.length > 1);
    },
    [lireAnnuaireDisque, stockage],
  );

  /**
   * Installe le compte d'un ami (invitation acceptée, ou connexion par
   * identifiant) SANS recharger la page : l'ancien contenu du navigateur est
   * effacé, la liaison retenue, et le coffre déjà publié écrit tel quel (suivi
   * noté : il ne repartira pas et ne sera pas retiré du relais).
   */
  const installerCompteAmi = useCallback(
    async (relie: CompteRelie, prenom: string, coffre?: { octets: Uint8Array; date: string }) => {
      setEtat({ phase: 'chargement', message: 'Installation de ton compte…' });
      // Même compte déjà ici (lien de réinitialisation ouvert sur son appareil) : sa base est gardée,
      // avec ce qui n'est pas encore parti (la réinitialisation garde la clé du compte).
      const garder = garderPourMemeCompte(memoireNavigateur, relie.compte, relie.liaison.relais);
      for (const nom of await fichiersLocaux()) {
        if (nom !== 'profils' && !garder.fichiers.includes(nom)) await stockage.ecrire(nom, new Uint8Array(0));
      }
      await cachesSynchro().vider(ID_PRINCIPAL);
      noterEtatDemarrage({ le: undefined, recus: 0, aEnvoyer: 0 });
      oublierSuivi(memoireNavigateur);
      garder.restaurer();
      memoireNavigateur.removeItem(CLES_MEMOIRE.liaisons);
      memoireNavigateur.removeItem(CLES_MEMOIRE.liaisonHistorique);
      await ecrireAnnuaireDisque(relie.annuaire);
      retenirLiaison(memoireNavigateur, relie.liaison);
      memoireNavigateur.setItem(CLE_RELAIS_CONNU, relie.liaison.relais);
      memoireNavigateur.setItem(CLE_IDENTIFIANT, prenom);
      // Fondateur (session ouverte par son mot de passe) : son compte est le compte principal.
      const id = relie.compte ?? ID_PRINCIPAL;
      if (coffre) {
        const nom = fichiersDuProfil(id).coffre as NomFichier;
        await stockage.ecrire(nom, coffre.octets);
        let etatFichiers: Record<string, unknown> = {};
        try {
          etatFichiers = JSON.parse(memoireNavigateur.getItem(CLES_MEMOIRE.fichiers) ?? '{}') as Record<string, unknown>;
        } catch {
          etatFichiers = {};
        }
        memoireNavigateur.setItem(CLES_MEMOIRE.fichiers, JSON.stringify({ ...etatFichiers, [nom]: { h: empreinteOctets(coffre.octets), date: coffre.date } }));
      }
      effacerFragment();
      return id;
    },
    [fichiersLocaux, stockage, ecrireAnnuaireDisque],
  );

  /** Lien d'invitation ouvert : vérifie qu'il est encore bon, puis montre l'écran du mot de passe. */
  const ouvrirInvitation = useCallback(
    async (lien: LienInvitation) => {
      setEtat({ phase: 'invitation' });
      try {
        // Invitation d'avant la fin de Cloudflare : le relais du site remplace l'ancienne adresse.
        const ancienne = /\.workers\.dev/i.test(lien.relais) || (lien.mode === 'lien' && /\.workers\.dev/i.test(lien.contenu.relais));
        const chargee = await chargerInvitation(lien, undefined, undefined, ancienne ? await relaisDuSite() : undefined);
        setEtat({ phase: 'invitation', chargee, autreCompteIci: await autreCompteIci(chargee.contenu.compte) });
      } catch (erreur) {
        setEtat({ phase: 'invitation', erreur: erreurTexte(erreur) });
      }
    },
    [autreCompteIci],
  );

  /** Invitation collée sur l'accueil : un lien complet, ou un code court (relais connu ici). */
  const ouvrirInvitationSaisie = useCallback(
    async (texte: string) => {
      const lien = decoderInvitation(texte);
      if (lien) {
        await ouvrirInvitation(lien);
        return;
      }
      if (!normaliserCodeCourt(texte)) throw new ErreurInvitation(/AI1|invitation/i.test(texte) ? 'lien-illisible' : 'code-court-illisible');
      const relais = await relaisConnu();
      if (!relais) throw new ErreurInvitation('relais-inconnu');
      const chargee = await chargerCodeCourt(relais, texte);
      setEtat({ phase: 'invitation', chargee, autreCompteIci: await autreCompteIci(chargee.contenu.compte) });
    },
    [ouvrirInvitation, autreCompteIci],
  );

  /** L'ami a choisi son mot de passe : coffre rescellé et publié, invitation consommée, compte ouvert. */
  const accepter = useCallback(
    async (chargee: InvitationChargee, motDePasse: string) => {
      const acceptee = await accepterInvitation({ invitation: chargee, motDePasse });
      for (const avertissement of acceptee.avertissements) console.warn('Invitation :', avertissement);
      const id = await installerCompteAmi(acceptee.relie, acceptee.contenu.prenom, { octets: acceptee.octets, date: acceptee.date });
      annuaireRef.current = acceptee.relie.annuaire;
      await ouvrir({ id, nom: acceptee.contenu.prenom, admin: false }, { motDePasse });
    },
    [installerCompteAmi, ouvrir],
  );

  /**
   * Installe sur ce navigateur le compte ouvert par identifiant. Fondateur : un navigateur qui garde
   * déjà SON compte (même serveur) n'est pas vidé (sa copie hors ligne et sa file d'envoi restent) ;
   * un coffre étranger créé ici autrefois passe par l'écran « Remplacer » (sauvegarde proposée).
   */
  const installerConnexion = useCallback(
    async (c: ConnexionIdentifiant): Promise<'ouvrir' | 'remplacer'> => {
      if (c.fondateur) {
        const dejaIci = lireLiaisons(memoireNavigateur).maitre;
        const memeServeur = dejaIci ? decoderLiaison(dejaIci)?.relais === c.relie.liaison.relais : false;
        const coffre = await stockage.lire('coffre');
        if (memeServeur && coffre && coffre.length > 0) {
          retenirLiaison(memoireNavigateur, c.relie.liaison);
          memoireNavigateur.setItem(CLE_IDENTIFIANT, c.acces.prenom);
          effacerFragment();
          return 'ouvrir';
        }
        if (coffre && coffre.length > 0) {
          setEtat({ phase: 'remplacer', relie: c.relie });
          return 'remplacer';
        }
      }
      await installerCompteAmi(c.relie, c.acces.prenom);
      annuaireRef.current = c.relie.annuaire;
      return 'ouvrir';
    },
    [installerCompteAmi, stockage],
  );

  /** Appareil neuf : identifiant + mot de passe, POUR TOUS (Fondateur compris, relais version 9). */
  const connecterIdentifiant = useCallback(
    async (identifiant: string, motDePasse: string, code?: string) => {
      const relais = await relaisConnu();
      if (!relais) throw new ErreurInvitation('relais-inconnu');
      // Validation en deux étapes : le serveur vérifie le code avant de rendre quoi que ce soit ; le même code
      // ouvre ensuite le coffre ici s'il l'exige encore (coffre du Fondateur avec code à six chiffres).
      const c = await connecterParIdentifiant(relais, identifiant, motDePasse, undefined, code);
      if ((await installerConnexion(c)) === 'remplacer') return;
      await ouvrir({ id: c.fondateur ? ID_PRINCIPAL : (c.relie.compte as string), nom: c.acces.prenom, admin: c.fondateur }, { motDePasse, ...(code ? { codeTotp: code } : {}) });
    },
    [installerConnexion, ouvrir],
  );

  /**
   * « Mot de passe oublié » du Fondateur : identifiant + code de récupération. Le coffre s'ouvre par
   * le code, le nouveau mot de passe le remplace, dix nouveaux codes sont tirés (à noter) et l'accès
   * par identifiant est republié avec eux (l'ancien mot de passe et les anciens codes ne valent plus).
   */
  const connecterSecours = useCallback(
    async (identifiant: string, code: string, nouveau: string) => {
      const relais = await relaisConnu();
      if (!relais) throw new ErreurInvitation('relais-inconnu');
      const c = await connecterParSecours(relais, identifiant, code);
      if ((await installerConnexion(c)) === 'remplacer') return;
      await ouvrir(
        { id: ID_PRINCIPAL, nom: c.acces.prenom, admin: true },
        {
          recuperation: { code, nouveau },
          apres: async session => {
            const codes = session.session.renouvelerCodesRecuperation();
            await session.vider();
            await publierAccesFondateur({ maitre: c.relie.liaison, identifiant: c.acces.prenom, motDePasse: nouveau, codes });
            await deposerCoffreSiChange(session.session.base(), c.relie.liaison, session.session.coffreActuel()).catch(() => undefined);
            setEcranFondateur({ mode: 'codes', resultat: { identifiant: c.acces.prenom, codes } });
          },
        },
      );
    },
    [installerConnexion, ouvrir],
  );

  /**
   * L'identifiant tapé change : le style (nom du thème) de ce compte s'applique à l'écran, en aperçu.
   * Ordre : le style propre à CET appareil, sinon celui du compte (serveur, réponse neutre si
   * l'identifiant n'existe pas). Rien n'est retenu.
   */
  const appliquerStyleIdentifiant = useCallback((identifiant: string) => {
    if (minuterieStyle.current) clearTimeout(minuterieStyle.current);
    minuterieStyle.current = setTimeout(() => {
      void (async () => {
        if (identifiant.trim().length < 2) return;
        const annuaire = annuaireRef.current;
        const trouve = annuaire && !annuaire.restreint ? trouverCompte(annuaire, identifiant) : undefined;
        const local = trouve ? lireThemeAppareil(trouve.id) : undefined;
        const relais = local ? undefined : await relaisConnu();
        const theme = local ?? (relais ? await lireThemePublic(relais, empreinteIdentifiant(identifiant)) : undefined);
        if (theme && apercuTheme(theme)) setVersionStyle(v => v + 1);
      })();
    }, 350);
  }, []);

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

  // ------------------------------------------------ Connexion par identifiant du Fondateur (migration)
  const sessionFondateur = etat.phase === 'prete' && etat.profil.admin && !etat.adminSur ? etat.session : undefined;
  useEffect(() => {
    if (!sessionFondateur) return undefined;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const verifier = async () => {
      if (fondateurReporte.current || sessionFondateur.session.statut() !== 'deverrouille') return;
      // L'identifiant voyage avec les données (coffre serveur) : un appareil qui vient d'ouvrir attend son premier tour.
      if (new DepotParametres(sessionFondateur.session.base()).lire(PARAM_IDENTIFIANT)) return;
      const maitre = await liaisonMaitreDe(sessionFondateur);
      if (!maitre) return;
      const version = await versionRelais(maitre);
      if (!version?.fonctions.includes('acces-fondateur')) return;
      if (new DepotParametres(sessionFondateur.session.base()).lire(PARAM_IDENTIFIANT)) return;
      setEcranFondateur(courant => courant ?? { mode: 'proposer' });
    };
    const planifier = () => {
      if (minuterie) clearTimeout(minuterie);
      minuterie = setTimeout(() => void verifier().catch(() => undefined), 6_000);
    };
    planifier();
    const desabonner = sessionFondateur.session.surOuverture(planifier);
    // Verrouillé : l'écran de migration se retire (il revient à la prochaine ouverture) ; les codes à noter restent.
    const desabonnerFermeture = sessionFondateur.session.surFermeture(() => {
      if (minuterie) clearTimeout(minuterie);
      setEcranFondateur(courant => (courant && courant.mode !== 'codes' ? undefined : courant));
    });
    return () => {
      if (minuterie) clearTimeout(minuterie);
      desabonner();
      desabonnerFermeture();
    };
  }, [sessionFondateur]);

  /**
   * Le Fondateur choisit son identifiant et son mot de passe : identité revérifiée, codes de
   * récupération tirés, accès (et secours) publié AVANT de toucher au coffre (un identifiant déjà
   * pris ne change rien), puis coffre rescellé, enregistré et téléversé, thème publié.
   */
  const configurerConnexionFondateur = useCallback(
    async (o: { identifiant: string; motDePasseActuel: string; codeTotp: string; nouveau: string }): Promise<ResultatMigration> => {
      const courant = etatRef.current;
      if (courant.phase !== 'prete' || !courant.profil.admin || courant.adminSur) throw new Error('Réservé au Fondateur, sur son compte.');
      const session = courant.session;
      const maitre = await liaisonMaitreDe(session);
      if (!maitre) throw new Error('Cet appareil ne connaît pas le serveur : ouvrez AppDashboard sur votre PC (déjà relié), puis réessayez.');
      session.session.verifierIdentite({ motDePasse: o.motDePasseActuel, codeTotp: o.codeTotp });
      // Validation en deux étapes gardée (relais version 10) : le secret TOTP du coffre (la même application
      // d'authentification) est confié au serveur AVANT de publier l'accès — jamais d'accès sans le code.
      const secret = session.session.etatCoffre()?.codeDemande ? session.session.secretTotp() : undefined;
      if (secret) {
        const version = await versionRelais(maitre);
        if (!version?.fonctions.includes('a2f')) {
          throw new Error('Le serveur n’est pas encore à jour pour garder ton code à six chiffres : réessaie dans quelques minutes (il se met à jour seul).');
        }
        await activerA2f(maitre, ID_PRINCIPAL, secret, o.codeTotp);
      }
      const codes = Array.from({ length: 10 }, () => genererCodeRecuperation(aleatoireParDefaut));
      const depot = new DepotParametres(session.session.base());
      const ancien = depot.lire(PARAM_IDENTIFIANT);
      const h = await publierAccesFondateur({ maitre, identifiant: o.identifiant, motDePasse: o.nouveau, codes });
      if (ancien && empreinteIdentifiant(ancien) !== h) await supprimerAcces(maitre, empreinteIdentifiant(ancien)).catch(() => undefined);
      const { coffre } = session.session.passerAConnexionParIdentifiant({ motDePasseActuel: o.motDePasseActuel, codeTotp: o.codeTotp, nouveauMotDePasse: o.nouveau, codes, garderCode: Boolean(secret) });
      depot.ecrire(PARAM_IDENTIFIANT, o.identifiant.trim().slice(0, 30));
      await session.vider();
      await deposerCoffreSiChange(session.session.base(), maitre, coffre).catch(e => console.warn('Coffre :', erreurTexte(e)));
      const theme = depot.lire('hub.theme');
      if (theme) {
        await publierThemePublic(maitre, h, theme)
          .then(() => memoireNavigateur.setItem(CLE_THEME_PUBLIE, `${h}|${theme}`))
          .catch(() => undefined);
      }
      memoireNavigateur.setItem(CLE_IDENTIFIANT, o.identifiant.trim());
      return { identifiant: o.identifiant.trim(), codes, a2f: Boolean(secret) };
    },
    [],
  );

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
    const plan: { enTour: boolean; demander(delai?: number): void; maintenant?(): Promise<void> } = { enTour: false, demander: () => undefined };
    /** Nom du thème du compte, publié pour l'écran de connexion quand il change (rien d'autre). */
    const publierTheme = async (liaison: Liaison, identifiant: string | undefined) => {
      if (!identifiant || session.session.statut() !== 'deverrouille') return;
      const theme = new DepotParametres(session.session.base()).lire('hub.theme');
      if (!theme) return;
      const h = empreinteIdentifiant(identifiant);
      const cle = profil.id === ID_PRINCIPAL ? CLE_THEME_PUBLIE : `${CLE_THEME_PUBLIE}@${profil.id}`;
      if (memoireNavigateur.getItem(cle) === `${h}|${theme}`) return;
      await publierThemePublic(liaison, h, theme);
      memoireNavigateur.setItem(cle, `${h}|${theme}`);
    };
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
            // Tâches : ses appareils et l'ami choisi (projets partagés, scellés pour lui).
            taches: { base: { lire: cle => depot.lire(cle), ecrire: (cle, valeur) => depot.ecrire(cle, valeur) }, cleSynchro: session.session.cleDerivee('synchro'), nomFondateur: profil.nom && profil.nom !== 'Moi' ? profil.nom : undefined },
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
          if (bilan.annuaireChange || bilan.donneesChangent || bilan.tachesChange) {
            setVersionComptes(v => v + 1);
          }
          if (bilan.erreurs.length > 0) {
            console.warn('Synchronisation des comptes :', bilan.erreurs[0]);
          }
          await publierTheme(liaison, depot.lire(PARAM_IDENTIFIANT)).catch(() => undefined);
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
            // Tâches : projets partagés avec lui (copie dans SA base), ses modifications repartent.
            taches: { base: { lire: cle => baseAmi.lire(cle), ecrire: (cle, valeur) => baseAmi.ecrire(cle, valeur) } },
          });
          if (bilan.abonnementChange || bilan.tachesChange) {
            setVersionComptes(v => v + 1);
          }
          await publierTheme(liaison, profil.nom).catch(() => undefined);
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
    // Un tour complet tout de suite (après celui en cours) : publier le compte d'un ami invité.
    plan.maintenant = async () => {
      for (let i = 0; i < 150 && plan.enTour; i++) await new Promise(fin => setTimeout(fin, 200));
      await tour();
    };
    planComptes.current = plan;
    const intervalle = setInterval(() => {
      if (session.session.statut() === 'deverrouille' && Date.now() - dernier > INTERVALLE_COMPTES_MS) {
        void tour();
      }
    }, 3_000);
    const ecoute = session.session.surEcriture?.(() => {
      if (!plan.enTour) plan.demander(2_000);
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
        erreur={etat.erreur}
        liaisonTemporaire={ab1Accepte() ? { codeConnu: etat.codeAb1, onRelier: relierTemporaire } : undefined}
        connexion={{
          relaisConnu: Boolean(memoireNavigateur.getItem(CLE_RELAIS_CONNU) || lireLiaisons(memoireNavigateur).maitre),
          identifiantInitial: memoireNavigateur.getItem(CLE_IDENTIFIANT) ?? undefined,
          onConnexion: connecterIdentifiant,
          onInvitation: ouvrirInvitationSaisie,
          onSecours: connecterSecours,
          onIdentifiant: appliquerStyleIdentifiant,
        }}
        onCreer={() => {
          // Coffre neuf, indépendant : le compte d'un autre retenu ici ne s'applique plus.
          for (const cle of ['applibourse.liaisons', 'applibourse.liaison']) memoireNavigateur.removeItem(cle);
          void ouvrir({ id: ID_PRINCIPAL, nom: 'Moi', admin: true }, { creation: true });
        }}
      />
    );
  }

  if (etat.phase === 'invitation') {
    const contenu = etat.chargee?.contenu;
    return (
      <EcranInvitation
        infos={contenu ? { prenom: contenu.prenom, fondateur: contenu.fondateur, expire: contenu.expire, politique: politiqueDeContenu(contenu), langue: langueDuLien() } : undefined}
        chargement={!etat.chargee && !etat.erreur}
        erreur={etat.erreur}
        autreCompteIci={etat.autreCompteIci}
        onAccepter={motDePasse => accepter(etat.chargee!, motDePasse)}
        onAccueil={() => {
          effacerFragment();
          window.location.reload();
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
        erreur={etat.erreur}
        prenomInitial={annuaireRef.current?.restreint ? memoireNavigateur.getItem(CLE_IDENTIFIANT) ?? undefined : undefined}
        onPrenom={appliquerStyleIdentifiant}
        onContinuer={prenom => {
          const annuaire = annuaireRef.current;
          const trouve = annuaire ? trouverCompte(annuaire, prenom) : undefined;
          if (trouve) {
            void ouvrir(trouve);
          } else if (annuaire?.restreint) {
            // Navigateur d'un ami (un seul compte) : rien à cacher, la cause est dite.
            const retenu = memoireNavigateur.getItem(CLE_IDENTIFIANT);
            setEtat({
              phase: 'connexion',
              erreur: `Identifiant inconnu sur ce navigateur${retenu ? ` : il est relié au compte « ${retenu} »` : ''}. Majuscules, accents et espaces ne comptent pas ; vérifie l’orthographe.`,
            });
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
    await stockage.ecrire(`ecarte-${fichiers.portefeuille}` as NomFichier, new Uint8Array(0));
  };

  // Plus de « Lier à mon compte (code de liaison) » : chacun se connecte par identifiant + mot de passe.
  const liaisonsIci = lireLiaisons(memoireNavigateur);
  /** Liaison employée par ce compte (le leurre : la même qu'à l'ouverture, voir avantOuverture). */
  const liaisonIci = () => {
    const propre = profil.id === 'leurre' ? undefined : liaisonPourCompte(memoireNavigateur, profil.id);
    const premier = Object.values(liaisonsIci.comptes)[0];
    return propre ?? (liaisonsIci.maitre ? decoderLiaison(liaisonsIci.maitre) : undefined) ?? (premier ? decoderLiaison(premier) : undefined);
  };
  // Esport (et autres services du compte) : la liaison du compte ouvert, jeton de profil d'un ami compris.
  definirLiaisonCompte(profil.id === 'leurre' ? undefined : liaisonIci());
  const ecartHorloge = async () => {
    const liaison = liaisonIci() ?? (await liaisonDuPont());
    return liaison ? mesurerEcartHorloge(liaison) : undefined;
  };
  const deverrouillageSite: ControleProfils['deverrouillage'] = {
    ecartHorloge,
    diagnostic: async () => {
      const ecart = await ecartHorloge().catch(() => undefined);
      // Écran prénom (plusieurs comptes) : rien qui distingue un vrai compte du leurre.
      const prive = annuaireRef.current ? aDesAmis(annuaireRef.current) : false;
      const coffre = session.session.coffreActuel();
      const { coffreRelais, compteAdmin } = diagnosticOuverture.current;
      return formaterDiagnostic({
        version: versionApp(),
        ...lireEnvironnement(),
        ...(ecart === undefined ? {} : { ecartHorlogeS: Math.round(ecart / 1000) }),
        liaisonRelais: Boolean(liaisonIci() ?? (await liaisonDuPont())),
        coffreLocal: prive || Boolean(coffre),
        ...(prive ? {} : { coffreAgeJours: ageCoffreVu(coffre) }),
        ...(!prive && compteAdmin && coffre && coffreRelais !== undefined ? { coffreIdentiqueAuRelais: memeCoffre(coffre, coffreRelais) } : {}),
      });
    },
  };
  const controle: ControleProfils = {
    deverrouillage: adminSur ? undefined : deverrouillageSite,
    actuel: profil,
    tous: profils,
    versionComptes,
    abonnement: profil.admin || adminSur || profil.id === 'leurre' ? undefined : lireAbonnementAmi(memoireNavigateur, profil.id),
    peutChanger: Boolean(adminSur) || (annuaireRef.current ? aDesAmis(annuaireRef.current) : false) || profil.id === 'leurre',
    // Ami : connecter un autre appareil (lien du site avec l'adresse du serveur, rien de secret ; identifiant et mot de passe ensuite).
    autreAppareil: (() => {
      if (profil.admin || adminSur || profil.id === 'leurre') return undefined;
      const code = liaisonsIci.comptes[profil.id];
      const liaison = code ? decoderLiaison(code) : undefined;
      if (!liaison) return undefined;
      return { lien: lienConnexion(siteDesLiens(liaison.site), liaison.relais) };
    })(),
    // Fondateur : identifiant et mot de passe de connexion (Paramètres › Sécurité).
    connexionServeur:
      profil.admin && !adminSur && session.session.statut() === 'deverrouille'
        ? { identifiant: new DepotParametres(session.session.base()).lire(PARAM_IDENTIFIANT), onConfigurer: () => setEcranFondateur({ mode: 'modifier' }) }
        : undefined,
    a2f:
      !adminSur && profil.id !== 'leurre' && session.session.statut() === 'deverrouille'
        ? servicesA2f(session, profil, profil.admin ? new DepotParametres(session.session.base()).lire(PARAM_IDENTIFIANT) : profil.nom)
        : undefined,
    politique: annuaireRef.current?.politique,
    juridique: annuaireRef.current?.juridique,
    // Textes légaux : seul un Fondateur, et seulement là où l'annuaire complet est disponible (pas sur un navigateur relié).
    onJuridique:
      rangDe(profil) === 'fondateur' && !adminSur && profil.id !== 'leurre' && !annuaireRef.current?.restreint
        ? async (docs: NonNullable<Annuaire['juridique']>) => {
            if (session.session.statut() !== 'deverrouille') throw new Error('Déverrouillez votre compte.');
            await enFile(async () => ecrireAnnuaireDisque({ ...(await lireAnnuaireDisque()), juridique: docs }));
            setVersionComptes(v => v + 1);
          }
        : undefined,
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
        const appareils = noterAppareil(depot, maintenant);
        const annuaire = await lireAnnuaireDisque();
        const suivant = noterConnexionAmi(
          annuaire,
          profil.id,
          maintenant,
          connexions,
          publique => session.session.deposerPourSequestre(publique, profil.id),
          undefined,
          appareils,
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
  /** Liaison MAÎTRE de cet appareil (configuration du relais, ou code retenu) : seule à pouvoir inviter. */
  const liaisonMaitre = async (): Promise<Liaison | undefined> => {
    const config = session.session.statut() === 'deverrouille' ? lireConfigRelais(session.session.base()) : undefined;
    const maitre: Liaison | undefined = config
      ? { relais: config.relais, jeton: config.jeton, ...(config.site ? { site: config.site } : {}) }
      : liaisonPourCompte(memoireNavigateur, ID_PRINCIPAL, await liaisonDuPont());
    return maitre && estMaitre(maitre) ? maitre : undefined;
  };
  /** Publie tout de suite le compte de l'ami (projection, coffre, portefeuille), et dit s'il est bien sur le relais. */
  const publierCompteAmi = async (maitre: Liaison, id: string): Promise<boolean> => {
    await auPlus(planComptes.current?.maintenant?.() ?? Promise.resolve(), 40_000);
    try {
      const objets = await espacesDuRelais(maitre).lister(id);
      return Boolean(objets.coffre && objets.annuaire);
    } catch {
      return false;
    }
  };
  /** Invitation d'un ami dont on connaît le mot de passe temporaire (création, réinitialisation). */
  const inviter = async (id: string, prenom: string, motDePasse: string, jours: number, politique?: PolitiqueMdp): Promise<InvitationAffichee> => {
    const maitre = await liaisonMaitre();
    if (!maitre) {
      return { erreur: 'Invitation impossible depuis cet appareil : il ne connaît pas encore le serveur (ouvrez AppDashboard sur le PC, ou connectez-vous avec votre identifiant). En attendant, transmettez les identifiants ci-dessous.' };
    }
    try {
      const invitation = await creerInvitation({ maitre, compte: id, prenom, motDePasse, fondateur: profil.nom, jours, politique });
      const publie = await publierCompteAmi(maitre, id);
      return { ...invitation, publie };
    } catch (erreur) {
      return { erreur: `Invitation impossible pour l’instant : ${erreurTexte(erreur)}` };
    }
  };
  const joursAvant = (iso: string | undefined) => (iso ? Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 86_400_000)) : 7);

  if (admin) {
    Object.assign(controle, {
      onCreerCompte: async (nom: string, apps: readonly string[], options?: OptionsNouveauProfil, envoi?: OptionsInvitationHote) => {
        exigerAdmin();
        const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
        // On valide le nom et l'identifiant avant de créer le moindre fichier.
        const suivante = ajouterProfil(profils, nom, id, new Date().toISOString().slice(0, 10), apps, options);
        const { identifiants, depot } = await creerCoffreAmi(id, nom.trim(), clePublique());
        await avecCles(async (cles, annuaire) => {
          await rafraichirAdmin(deposerSequestre(appliquerProfilsAdmin(annuaire, suivante, cles), id, depot), true);
        });
        // L'invitation : un lien à usage unique, plus de mot de passe brut à transmettre.
        const invitation = await inviter(id, nom.trim(), identifiants.motDePasse, joursAvant(options?.invitationExpireLe), envoi?.politique);
        return { ...identifiants, invitation, id };
      },
      onInvitation: async (id: string, jours: number, envoi?: OptionsInvitationHote): Promise<InvitationAffichee> => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id && !p.admin);
        if (!ami) throw new Error('Compte introuvable.');
        exiger(profil, 'regenerer-identifiants', ami);
        // Son identifiant de connexion EST son prénom : jamais d'invitation au nom du texte de remplacement.
        if (ami.nomInconnu) throw new Error('Le prénom de ce compte est à réparer d’abord (bouton « Réparer les prénoms » en haut de la liste).');
        const maitre = await liaisonMaitre();
        if (!maitre) throw new Error('Cet appareil ne connaît pas encore le serveur (connectez-vous avec votre identifiant) : l’invitation passe par lui.');
        // Le coffre le plus récent de l'ami (s'il a changé de mot de passe ailleurs) avant de le réinitialiser.
        await auPlus(planComptes.current?.maintenant?.() ?? Promise.resolve(), 30_000);
        const nomCoffre = fichiersDuProfil(id).coffre as NomFichier;
        const brut = await stockage.lire(nomCoffre);
        let coffre: Coffre | undefined;
        try {
          coffre = brut && brut.length > 0 ? (JSON.parse(decodeur.decode(brut)) as Coffre) : undefined;
        } catch {
          coffre = undefined;
        }
        if (!coffre || !coffreValide(coffre)) throw new Error(`Le coffre de ${ami.nom} est absent de cet appareil : utilisez « Régénérer les identifiants ».`);
        const temporaire = genererMotDePasse();
        await avecCles(async (cles, annuaire) => {
          const code = codeAcces(annuaire, id, cles);
          if (!code) {
            throw new Error(`Accès par séquestre indisponible pour ${ami.nom} (état : ${ami.sequestre ?? 'absent'}) : utilisez « Régénérer les identifiants » (son portefeuille sera effacé).`);
          }
          const cle = ouvrirSequestre(annuaire, id, code.code, cles);
          try {
            // Nouveau mot de passe temporaire : l'ancien mot de passe (et toute ancienne invitation) cesse de marcher.
            // Clé du séquestre éprouvée contre le coffre : un séquestre périmé publierait un coffre qui ouvre une autre clé.
            const suivant = coffreReinitialise(coffre!, cle, temporaire);
            await stockage.ecrire(nomCoffre, encodeur.encode(JSON.stringify(suivant)));
          } finally {
            cle.fill(0);
          }
        });
        const expire = new Date(Date.now() + jours * 86_400_000).toISOString();
        await enregistrer(profils.map(p => (p.id === id ? { ...p, invitationExpireLe: expire } : p)));
        // L'ancien accès par identifiant ne correspond plus au mot de passe : retiré (relais à jour).
        await supprimerAcces(maitre, empreinteIdentifiant(ami.nom)).catch(() => undefined);
        return inviter(id, ami.nom, temporaire, jours, envoi?.politique);
      },
      onSupprimerAvecRelais: async (id: string) => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id && !p.admin);
        exiger(profil, 'supprimer-ami', ami);
        const maitre = await liaisonMaitre();
        await effacerFichiers(id);
        await enregistrer(supprimerProfil(profils, id));
        if (!maitre) return { objets: 0, acces: false, revoque: false, restes: ['appareil non relié au relais avec le code maître : copies non effacées'] };
        return nettoyerCompteRelais(maitre, id, ami!.nom);
      },
      onRevoquerConnexion: async (id: string, revoque: boolean) => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id && !p.admin);
        if (!ami) throw new Error('Compte introuvable.');
        exiger(profil, 'etat-ami', ami);
        const maitre = await liaisonMaitre();
        if (!maitre) throw new Error('Reliez d’abord cet appareil au relais (Paramètres › Synchronisation).');
        // L'accès par identifiant est gardé : le relais répond « accès révoqué » (message précis) tant que dure la révocation.
        await revoquerCompte(maitre, id, revoque);
      },
      etatConnexion: async (id: string) => {
        const maitre = await liaisonMaitre();
        return maitre ? { revoque: await compteRevoque(maitre, id) } : {};
      },
      diagnosticConnexion: async (id: string) => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id && !p.admin);
        if (!ami) throw new Error('Compte introuvable.');
        const maitre = await liaisonMaitre();
        if (!maitre) throw new Error('Cet appareil ne connaît pas encore le serveur (connectez-vous avec votre identifiant).');
        return diagnosticConnexions(maitre, id, ami.nomInconnu ? undefined : empreinteIdentifiant(ami.nom));
      },
      onDebloquerConnexion: async (id: string) => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id && !p.admin);
        if (!ami) throw new Error('Compte introuvable.');
        exiger(profil, 'etat-ami', ami);
        const maitre = await liaisonMaitre();
        if (!maitre) throw new Error('Cet appareil ne connaît pas encore le serveur (connectez-vous avec votre identifiant).');
        return debloquerConnexions(maitre, id, ami.nomInconnu ? undefined : empreinteIdentifiant(ami.nom));
      },
      onReparerNoms: async (candidats: Readonly<Record<string, readonly string[]>>) => {
        exigerAdmin();
        return avecCles(async (cles, annuaire) => {
          const bilan = reparerNomsAdmin(annuaire, cles, candidats);
          if (Object.keys(bilan.repares).length > 0) await rafraichirAdmin(bilan.annuaire, true);
          return { repares: bilan.repares, restants: bilan.restants };
        });
      },
      onRegenerer: async (id: string) => {
        exigerAdmin();
        const ami = profils.find(p => p.id === id);
        if (!ami || ami.admin) {
          throw new Error('Profil introuvable.');
        }
        exiger(profil, 'regenerer-identifiants', ami);
        if (ami.nomInconnu) throw new Error('Le prénom de ce compte est à réparer d’abord (bouton « Réparer les prénoms » en haut de la liste).');
        await effacerFichiers(id);
        // Nouvelle clé maîtresse : l'ancien coffre serveur de ce compte ne s'ouvrirait plus, il est effacé.
        const maitreRegen = await liaisonMaitre();
        if (maitreRegen) await viderCoffreServeur(maitreRegen, id).catch(e => console.warn('Coffre serveur :', erreurTexte(e)));
        const { identifiants, depot } = await creerCoffreAmi(id, ami.nom, clePublique());
        await rafraichirAdmin(deposerSequestre(annuaireCourant(), id, depot), true);
        return { ...identifiants, invitation: await inviter(id, ami.nom, identifiants.motDePasse, 7) };
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
      // Plus de « code de connexion au site » (AB1) : l'ami se connecte par identifiant + mot de passe (invitation).
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
        return { ...identifiants, id };
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
            return { ...identifiants, id };
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
      <BandeauNouvelleVersion palette={palette} />
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
      {ecranFondateur && profil.admin && !adminSur && (ecranFondateur.mode === 'codes' || session.session.statut() === 'deverrouille') ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.fond, zIndex: 50 }]}>
          <EcranConnexionFondateur
            identifiantInitial={profil.nom && profil.nom !== 'Moi' ? profil.nom : undefined}
            dejaFait={ecranFondateur.mode === 'modifier' ? controle.connexionServeur?.identifiant : undefined}
            codeDemande={Boolean(session.session.etatCoffre()?.codeDemande)}
            resultat={ecranFondateur.mode === 'codes' ? ecranFondateur.resultat : undefined}
            onValider={configurerConnexionFondateur}
            onPlusTard={() => {
              fondateurReporte.current = true;
              setEcranFondateur(undefined);
              setVersionComptes(v => v + 1);
            }}
          />
        </View>
      ) : null}
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

// Morceaux JS périmés après un déploiement (site et app Electron) : un seul rechargement automatique.
installerEcouteursChunks();
// Nouvelle version du site : vérifiée au démarrage, au retour au premier plan et toutes les 3 minutes (fenêtre principale).
if (!contexteAnnexe) surveillanceSite();

// Appareil en anglais : le dictionnaire anglais (chargé à la demande sur le web) est attendu avant le premier
// affichage, 4 s au plus (sans réseau, l'app démarre en français et passe à l'anglais dès qu'il arrive).
void Promise.race([preparerLangue(), new Promise<void>(ok => setTimeout(ok, 4_000))]).then(() => {
  createRoot(document.getElementById('racine')!).render(
    <SafeAreaProvider>{contexteAnnexe ? <RacineAnnexe contexte={contexteAnnexe} /> : <Racine />}</SafeAreaProvider>,
  );
});
