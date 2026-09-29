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
  ouvrirAnnuaireAdmin,
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
import { coffreLeurre } from '../src/profils/leurre';
import { hexToBytes } from '@noble/hashes/utils.js';
import { DepotParametres } from '../src/db/depots';
import { Session } from '../src/session/session';
import { stockageMemoire } from '../src/session/stockage-coffre';
import { creerAccesAmi, type IdentifiantsAmi } from '../src/profils/identifiants';
import { installerPontWeb } from './web';
import { exiger } from '../src/hub/admin/roles';
import { avecEvenement, chargerDonnees, enregistrerDonnees } from '../src/hub/admin/donnees';
import { CLE_CARNET_GESTION, ajouterAuCarnet, ecrireCarnet, lireCarnet } from '../src/hub/admin/gestion';
import type { TypeEvenement } from '../src/hub/admin/journal';

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
      /** Session de l'administrateur sur le compte d'un ami (accès par séquestre). */
      adminSur?: string;
      transparence?: { dernierAccesAdmin?: string; sequestreActif: boolean };
      /** Administrateur historique sans prénom : celui saisi à la connexion, à lui donner une fois déverrouillé. */
      prenomAAdopter?: string;
    }
  | { phase: 'echec'; motif: string };

const decodeur = new TextDecoder();
const encodeur = new TextEncoder();
/** Paramètres de la base d'un ami (sa propre base chiffrée). */
const PARAM_CONNEXIONS = 'compte.connexions';
const PARAM_ACCES_ADMIN = 'compte.accesAdmin';

function erreurTexte(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

/** Clés d'usage de l'administrateur, tirées de sa clé maîtresse (à effacer après usage). */
function clesAdminDe(session: SessionBureau): ClesAdmin {
  return { annuaire: hexToBytes(session.session.cleDerivee('annuaire')), sequestre: hexToBytes(session.session.cleDerivee('sequestre')) };
}

function effacer(cles: ClesAdmin): void {
  cles.annuaire.fill(0);
  cles.sequestre.fill(0);
}

/** Dates des accès de l'administrateur à ce compte (lues dans la base de l'ami). */
function accesAdminLus(session: SessionBureau): string[] {
  try {
    const brut = new DepotParametres(session.session.base()).lire(PARAM_ACCES_ADMIN);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste.filter((d): d is string => typeof d === 'string' && !Number.isNaN(Date.parse(d))) : [];
  } catch {
    return [];
  }
}

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

  const ecrireAnnuaireDisque = useCallback(
    async (annuaire: Annuaire) => {
      await stockage.ecrire('profils', encodeur.encode(ecrireAnnuaire(annuaire)));
      annuaireRef.current = annuaire;
    },
    [stockage],
  );

  /**
   * Ouvre un compte. Tout état du compte précédent est d'abord effacé
   * (`changerDEspace`) et la portée des fichiers passe à ce compte.
   * `cle` : clé maîtresse relue du séquestre (session administrateur).
   */
  const ouvrir = useCallback(
    async (compte: CompteTrouve, options: { cle?: Uint8Array; adminSur?: string } = {}) => {
      setEtat({ phase: 'chargement', message: options.adminSur ? `Ouverture du compte de ${compte.nom}…` : undefined });
      try {
        fabriqueRef.current ??= await initSqlJs({ locateFile: () => urlWasm });
        changerDEspace(compte.id);
        await pont()?.profil?.ouvrir(compte.id);
        const annuaire = annuaireRef.current ?? (await lireAnnuaireDisque());
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
        let transparence: { dernierAccesAdmin?: string; sequestreActif: boolean } | undefined;
        if (options.cle) {
          session.session.ouvrirAvecCle(options.cle);
          // L'accès est noté dans la base de l'ami : il le verra dans ses Paramètres.
          const acces = [...accesAdminLus(session), new Date().toISOString()].slice(-20);
          new DepotParametres(session.session.base()).ecrire(PARAM_ACCES_ADMIN, JSON.stringify(acces));
          transparence = { dernierAccesAdmin: acces[acces.length - 1], sequestreActif: true };
        }
        setEtat({ phase: 'prete', session, profil, profils: [profil], adminSur: options.adminSur, transparence, prenomAAdopter: compte.prenomAAdopter });
      } catch (erreur) {
        options.cle?.fill(0);
        setEtat({ phase: 'echec', motif: erreurTexte(erreur) });
      }
    },
    [stockage, lireAnnuaireDisque],
  );

  /** Prénom inconnu : même écran de déverrouillage, coffre qu'aucune clé n'ouvre. */
  const ouvrirLeurre = useCallback((prenom: string) => {
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

  useEffect(() => {
    void lireAnnuaireDisque()
      .then(annuaire => {
        if (aDesAmis(annuaire)) {
          setEtat({ phase: 'connexion' });
        } else {
          void ouvrir({ id: ID_PRINCIPAL, nom: annuaire.heritage?.[0]?.nom ?? 'Moi', admin: true });
        }
      })
      .catch(erreur => setEtat({ phase: 'echec', motif: erreurTexte(erreur) }));
  }, [lireAnnuaireDisque, ouvrir]);

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
            ouvrirLeurre(prenom);
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
  async function creerCoffreAmi(id: string, nom: string, publique: string): Promise<{ identifiants: IdentifiantsAmi; depot: string }> {
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
      const identifiants = creerAccesAmi(ami.session, nom, undefined, session => {
        depot = session.deposerPourSequestre(publique, id);
      });
      await Promise.all(ecritures);
      return { identifiants, depot };
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

  const controle: ControleProfils = {
    actuel: profil,
    tous: profils,
    peutChanger: Boolean(adminSur) || (annuaireRef.current ? aDesAmis(annuaireRef.current) : false) || profil.id === 'leurre',
    politique: annuaireRef.current?.politique,
    sessionAdmin: adminSur ? { nomCompte: profil.nom } : undefined,
    transparence: profil.admin || profil.id === 'leurre' ? undefined : etat.transparence ?? { sequestreActif: false },
    onChanger: () => quitterCompte(session),
    onAjouter: async nom => {
      exigerAdmin();
      const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
      await enregistrer(ajouterProfil(profils, nom, id, new Date().toISOString().slice(0, 10)));
    },
    onSupprimer: async id => {
      exigerAdmin();
      await effacerFichiers(id);
      await enregistrer(supprimerProfil(profils, id));
    },
    onRenommer: async (id, nom) => {
      exigerAdmin();
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
            ? { ...courant, transparence: { dernierAccesAdmin: acces[acces.length - 1], sequestreActif: entree ? entree.sequestre.etat !== 'revoque' : false } }
            : courant,
        );
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
        await effacerFichiers(id);
        const { identifiants, depot } = await creerCoffreAmi(id, ami.nom, clePublique());
        await rafraichirAdmin(deposerSequestre(annuaireCourant(), id, depot), true);
        return identifiants;
      },
      onAutoriser: async (id: string, apps: readonly string[]) => enregistrer(autoriserApps(profils, id, apps)),
      onActiver: async (id: string, actif: boolean) => enregistrer(activerProfil(profils, id, actif)),
      onModifierProfils: async (suivants: readonly Profil[]) => enregistrer(validerModification(profils, suivants)),
      onCodeAcces: async (id: string) => avecCles((cles, annuaire) => codeAcces(annuaire, id, cles)),
      onRegenererCode: async (id: string) =>
        avecCles(async (cles, annuaire) => {
          const { annuaire: suivant, code } = regenererCodeAcces(annuaire, id, cles);
          await rafraichirAdmin(suivant, true);
          return code;
        }),
      onRevoquerAcces: async (id: string) =>
        avecCles(async (cles, annuaire) => {
          await rafraichirAdmin(revoquerSequestre(annuaire, id, cles), true);
        }),
      onRetablirAcces: async (id: string) =>
        avecCles(async (_cles, annuaire) => {
          await rafraichirAdmin(retablirSequestre(annuaire, id), true);
        }),
      onOuvrirCompte: async (id: string, code: string) => {
        const ami = profils.find(p => p.id === id && !p.admin);
        if (!ami) {
          throw new Error('Compte introuvable.');
        }
        // La clé de l'ami est relue AVANT de fermer la session de l'administrateur.
        const cle = await avecCles((cles, annuaire) => ouvrirSequestre(annuaire, id, code, cles));
        await session.vider();
        session.session.verrouiller();
        await ouvrir({ id, nom: ami.nom, admin: false }, { cle, adminSur: profil.nom });
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
          if (!annuaire || annuaire.heritage || session.session.statut() !== 'deverrouille') {
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
          const frais = await exigerGestionnaire();
          await ecrireAnnuaireDisque(deposerSequestre(ajouterCompteGere(frais, nouveau, maintenant), id, depot));
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
        await ecrireAnnuaireDisque(deposerSequestre(await exigerGestionnaire(), id, depot));
        rafraichirGestion();
        return identifiants;
      },
      onModifierProfils: async (suivants: readonly Profil[]) => {
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
      },
      onJournalGestion: async (evenement: { type: string; action: string; cible?: string; nomCible?: string; app?: string }) => {
        const annuaire = await exigerGestionnaire();
        await ecrireAnnuaireDisque(ajouterEvenementGestion(annuaire, profil.id, { ...evenement, type: evenement.type as TypeEvenement, date: new Date().toISOString() }));
      },
    } satisfies Partial<ControleProfils>);
  }

  return (
    <View style={[styles.pleinEcran, { backgroundColor: palette.fond }]}>
      <BandeauMiseAJour palette={palette} />
      {adminSur ? (
        <View style={[styles.bandeauAdmin, { backgroundColor: palette.danger }]} testID="bandeau-session-admin" accessibilityRole="alert">
          <Text style={{ color: '#fff', fontWeight: '700', flex: 1 }}>
            Session administrateur sur le compte de {profil.nom}
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
