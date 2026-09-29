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
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import initSqlJs from 'sql.js';
// L'URL du binaire WebAssembly, resolue par le bundler : sans cela sql.js le
// cherche a cote de la page, ou il n'est pas.
import urlWasm from 'sql.js/dist/sql-wasm.wasm?url';
import { App } from '../src/app/App';
import { Titre } from '../src/ui/composants';
import { ESPACEMENT, palettePour } from '../src/ui/theme';
import { useFondDocument } from './Bureau';
import { BandeauMiseAJour } from './MiseAJour';
import { ouvrirSessionBureau, type SessionBureau } from './session';
import { pont, stockageCourant, type NomFichier, type Stockage } from './stockage';
import { ChoixProfil } from '../src/ui/ecrans/ChoixProfil';
import type { ControleProfils } from '../src/ui/ecrans/CarteProfils';
import {
  ID_PRINCIPAL,
  activerProfil,
  ajouterProfil,
  autoriserApps,
  ecrireProfils,
  fichiersDuProfil,
  lireProfils,
  motifFermeture,
  noterConnexion,
  nouvelIdentifiant,
  profilOuvrable,
  validerModification,
  renommerProfil,
  supprimerProfil,
  type Profil,
} from '../src/profils/profils';
import { creerAccesAmi, type IdentifiantsAmi } from '../src/profils/identifiants';
import { installerPontWeb } from './web';

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
  | { phase: 'chargement' }
  | { phase: 'choix'; profils: Profil[] }
  | { phase: 'prete'; session: SessionBureau; profils: Profil[]; profil: Profil }
  | { phase: 'echec'; motif: string };

const decodeur = new TextDecoder();
const encodeur = new TextEncoder();

async function lireListeProfils(stockage: Stockage): Promise<Profil[]> {
  const brut = await stockage.lire('profils');
  return lireProfils(brut && brut.length > 0 ? decodeur.decode(brut) : undefined);
}

function Racine() {
  const sombre = useColorScheme() === 'dark';
  const palette = palettePour(sombre);
  useFondDocument(sombre);

  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });
  const fabriqueRef = useRef<unknown>(undefined);
  const stockage = useMemo(() => stockageCourant(), []);

  const ouvrir = useCallback(
    async (profils: Profil[], id: string) => {
      setEtat({ phase: 'chargement' });
      try {
        fabriqueRef.current ??= await initSqlJs({ locateFile: () => urlWasm });
        const session = await ouvrirSessionBureau({
          fabrique: fabriqueRef.current as never,
          stockage,
          profil: id,
          surErreur: erreur => {
            // Une ecriture perdue en silence serait le pire defaut possible.
            console.error('Enregistrement impossible', erreur);
          },
        });
        const profil = profils.find(p => p.id === id) ?? profils[0];
        const motif = motifFermeture(profil);
        if (motif) {
          throw new Error(motif);
        }
        setEtat({ phase: 'prete', session, profils, profil });
      } catch (erreur) {
        setEtat({ phase: 'echec', motif: erreur instanceof Error ? erreur.message : String(erreur) });
      }
    },
    [stockage],
  );

  useEffect(() => {
    void lireListeProfils(stockage)
      .then(profils => (profils.filter(profilOuvrable).length > 1 ? setEtat({ phase: 'choix', profils }) : ouvrir(profils, ID_PRINCIPAL)))
      .catch(erreur => setEtat({ phase: 'echec', motif: erreur instanceof Error ? erreur.message : String(erreur) }));
  }, [stockage, ouvrir]);

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
          Ouverture du portefeuille…
        </Text>
      </View>
    );
  }

  if (etat.phase === 'echec') {
    return (
      <View style={[styles.centre, { backgroundColor: palette.fond }]}>
        <Titre>Impossible d’ouvrir</Titre>
        <Text style={[styles.motif, { color: palette.texte }]}>{etat.motif}</Text>
      </View>
    );
  }

  if (etat.phase === 'choix') {
    // Un profil désactivé n'est plus proposé (et `ouvrir` le refuserait de toute façon).
    return <ChoixProfil profils={etat.profils.filter(profilOuvrable)} onChoisir={id => void ouvrir(etat.profils, id)} />;
  }

  const { session, profils, profil } = etat;
  const enregistrer = async (liste: Profil[]) => {
    await stockage.ecrire('profils', encodeur.encode(ecrireProfils(liste)));
    setEtat({ phase: 'prete', session, profils: liste, profil: liste.find(p => p.id === profil.id) ?? profil });
  };
  const controle: ControleProfils = {
    actuel: profil,
    tous: profils,
    onChanger: () => {
      void session.vider().finally(() => {
        session.session.verrouiller();
        setEtat({ phase: 'choix', profils });
      });
    },
    onAjouter: async nom => {
      const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
      await enregistrer(ajouterProfil(profils, nom, id, new Date().toISOString().slice(0, 10)));
    },
    onSupprimer: async id => {
      const fichiers = fichiersDuProfil(id) as { coffre: NomFichier; portefeuille: NomFichier };
      await stockage.ecrire(fichiers.coffre, new Uint8Array(0));
      await stockage.ecrire(fichiers.portefeuille, new Uint8Array(0));
      await enregistrer(supprimerProfil(profils, id));
    },
    onRenommer: async (id, nom) => {
      await enregistrer(renommerProfil(profils, id, nom));
    },
    // Administration : réservée au profil administrateur, aussi côté données.
    onCreerCompte: async (nom, apps, options) => {
      exigerAdmin();
      const id = nouvelIdentifiant(n => crypto.getRandomValues(new Uint8Array(n)));
      // On valide le nom et l'identifiant avant de créer le moindre fichier.
      const suivante = ajouterProfil(profils, nom, id, new Date().toISOString().slice(0, 10), apps, options);
      const identifiants = await creerCoffreAmi(id, nom.trim());
      await enregistrer(suivante);
      return identifiants;
    },
    onRegenerer: async id => {
      exigerAdmin();
      const ami = profils.find(p => p.id === id);
      if (!ami || ami.admin) {
        throw new Error('Profil introuvable.');
      }
      const fichiers = fichiersDuProfil(id) as { coffre: NomFichier; portefeuille: NomFichier };
      await stockage.ecrire(fichiers.coffre, new Uint8Array(0));
      await stockage.ecrire(fichiers.portefeuille, new Uint8Array(0));
      return creerCoffreAmi(id, ami.nom);
    },
    onAutoriser: async (id, apps) => {
      exigerAdmin();
      await enregistrer(autoriserApps(profils, id, apps));
    },
    onActiver: async (id, actif) => {
      exigerAdmin();
      await enregistrer(activerProfil(profils, id, actif));
    },
    onModifierProfils: async suivants => {
      exigerAdmin();
      await enregistrer(validerModification(profils, suivants));
    },
    onConnexion: () => {
      // Date de la dernière ouverture, pour l'Administration ; jamais bloquant.
      void enregistrer(noterConnexion(profils, profil.id, new Date().toISOString())).catch(erreur =>
        console.warn('Connexion non notée :', erreur),
      );
    },
  };
  function exigerAdmin() {
    if (!profil.admin) {
      throw new Error('Réservé à l’administrateur.');
    }
  }
  /**
   * Crée le coffre d'un ami dans ses propres fichiers. Les écritures de la
   * session partent en arrière-plan : on les attend toutes avant de rendre
   * les identifiants, pour ne jamais montrer un mot de passe dont le coffre
   * n'est pas encore sur le disque. En cas d'échec, rien ne subsiste.
   */
  async function creerCoffreAmi(id: string, nom: string): Promise<IdentifiantsAmi> {
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
      const identifiants = creerAccesAmi(ami.session, nom);
      await Promise.all(ecritures);
      return identifiants;
    } catch (erreur) {
      await stockage.ecrire(fichiers.coffre, new Uint8Array(0)).catch(() => undefined);
      await stockage.ecrire(fichiers.portefeuille, new Uint8Array(0)).catch(() => undefined);
      throw erreur;
    }
  }

  return (
    <View style={[styles.pleinEcran, { backgroundColor: palette.fond }]}>
      <BandeauMiseAJour palette={palette} />
      <View style={styles.pleinEcran}>
        <App key={profil.id} session={session.session} chargementAutomatique profils={controle} hub />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pleinEcran: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: ESPACEMENT.xl },
  motif: { textAlign: 'center', maxWidth: 520, marginTop: ESPACEMENT.m, lineHeight: 22 },
});

createRoot(document.getElementById('racine')!).render(
  <SafeAreaProvider>
    <Racine />
  </SafeAreaProvider>,
);
