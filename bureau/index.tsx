/**
 * Point d'entrée de l'application de bureau.
 *
 * Trois choses à faire avant d'afficier quoi que ce soit, toutes asynchrones,
 * alors que l'application est synchrone : initialiser sql.js, lire le coffre,
 * lire le fichier scellé. D'où cet écran d'attente, puis le passage de relais.
 */

import React, { useEffect, useState } from 'react';
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
import { stockageCourant } from './stockage';

type Etat =
  | { phase: 'chargement' }
  | { phase: 'prete'; session: SessionBureau }
  | { phase: 'echec'; motif: string };

function Racine() {
  const sombre = useColorScheme() === 'dark';
  const palette = palettePour(sombre);
  useFondDocument(sombre);

  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });

  useEffect(() => {
    let vivant = true;

    void (async () => {
      try {
        const fabrique = await initSqlJs({ locateFile: () => urlWasm });
        const session = await ouvrirSessionBureau({
          fabrique: fabrique as never,
          stockage: stockageCourant(),
          surErreur: erreur => {
            // Une ecriture perdue en silence serait le pire defaut possible.
            console.error('Enregistrement impossible', erreur);
          },
        });
        if (vivant) {
          setEtat({ phase: 'prete', session });
        }
      } catch (erreur) {
        if (vivant) {
          setEtat({
            phase: 'echec',
            motif: erreur instanceof Error ? erreur.message : String(erreur),
          });
        }
      }
    })();

    return () => {
      vivant = false;
    };
  }, []);

  // Dernier filet : on force l'ecriture avant la fermeture de la fenetre.
  useEffect(() => {
    if (etat.phase !== 'prete') {
      return;
    }
    const avantFermeture = () => void etat.session.vider();
    window.addEventListener('beforeunload', avantFermeture);
    return () => window.removeEventListener('beforeunload', avantFermeture);
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

  return (
    <View style={[styles.pleinEcran, { backgroundColor: palette.fond }]}>
      <BandeauMiseAJour palette={palette} />
      <View style={styles.pleinEcran}>
        <App session={etat.session.session} chargementAutomatique />
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
