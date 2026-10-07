/**
 * Point d'entrée de l'application.
 *
 * Le polyfill d'aléa doit être importé **avant tout le reste** : le moteur
 * JavaScript de React Native n'expose pas `crypto.getRandomValues`, dont
 * dépend toute la génération de clés. Un import placé plus bas serait évalué
 * trop tard.
 */

import 'react-native-get-random-values';

import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StatusBar, Text, useColorScheme } from 'react-native';
import { App as Application } from './src/app/App';
import { creerSessionAppareil } from './src/app/fabrique';
import { SousTitre, Titre } from './src/ui/composants';
import { ESPACEMENT, palettePour, stylesPartages } from './src/ui/theme';

export default function Racine() {
  const sombre = useColorScheme() === 'dark';

  const session = useMemo(() => {
    try {
      return { valeur: creerSessionAppareil() };
    } catch (erreur) {
      return { erreur: erreur instanceof Error ? erreur.message : String(erreur) };
    }
  }, []);

  if (session.valeur) {
    return <Application session={session.valeur} />;
  }

  // Écran de configuration plutôt qu'un écran rouge : le message dit ce qui
  // manque, et l'application reste lançable pendant le développement.
  return (
    <SafeAreaView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}>
      <StatusBar barStyle={sombre ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentContainerStyle={[
          stylesPartages.contenu,
          { paddingTop: ESPACEMENT.xl },
        ]}>
        <Titre>Configuration incomplète</Titre>
        <SousTitre>{session.erreur}</SousTitre>
        <Text />
        <SousTitre>
          Le cœur métier, la base, la sécurité et les écrans sont en place et
          testés. Seules les briques natives restent à brancher.
        </SousTitre>
      </ScrollView>
    </SafeAreaView>
  );
}
