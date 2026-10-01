/**
 * États vides guidés quand aucune source n'est configurée (accueil,
 * catalogue, recherche, fiches, lecteur).
 *
 *  - Rang habilité (Fondateur) : « Ajouter une source avec l'assistant » (ouvre
 *    la page Sources, assistant lancé) et « Comment ça marche ? ».
 *  - Autres rangs : « Demande à l'administrateur d'ajouter des sources », sans
 *    aucun lien d'édition.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { useCharger, useTsuzuku } from './contexte';
import { Bouton, styleAttenue, styleTexte, styleTitre } from './ui';

/** Nombre de sources utilisables (activées) et configurées pour ce profil. */
export function useEtatSources() {
  const { s, version } = useTsuzuku();
  return useCharger(async () => {
    const toutes = await s.sources();
    return { total: toutes.length, actives: toutes.filter(x => x.enabled).length };
  }, [s, version]);
}

export const TEXTE_SANS_SOURCE = 'Tsuzuku a besoin d’au moins une source pour lire des épisodes et des films.';

export function CarteSansSource({ lieu }: { lieu: 'accueil' | 'catalogue' | 'recherche' | 'fiche' }) {
  const { s, theme, aller } = useTsuzuku();
  const etat = useEtatSources();
  const [explication, setExplication] = useState(false);
  if (!etat.donnees || etat.donnees.actives > 0) return null;
  const aucune = etat.donnees.total === 0;
  return (
    <View
      testID="tsuzuku-sans-source"
      accessibilityLabel={aucune ? 'Aucune source configurée' : 'Aucune source activée'}
      style={{ gap: 10, padding: 16, borderRadius: Math.max(theme.rayonMoyen, 10), borderWidth: 1, borderColor: theme.alerte, backgroundColor: teinteTransparente(theme.alerte, 0.1) }}>
      <Text accessibilityRole="header" style={styleTitre(theme, 17)}>
        {aucune ? 'Aucune source configurée' : 'Aucune source activée'}
      </Text>
      <Text style={[styleTexte(theme, 14), { lineHeight: 20 }]}>
        {TEXTE_SANS_SOURCE}
        {lieu === 'fiche' ? ' En attendant, vous pouvez coller un lien direct ci-dessous.' : ''}
      </Text>
      {s.estAdmin ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton titre={aucune ? 'Ajouter une source avec l’assistant' : 'Gérer les sources'} variante="plein" onPress={() => aller({ t: 'sources', ajout: aucune ? 'assistant' : undefined })} testID="sans-source-assistant" />
            <Bouton titre="Comment ça marche ?" onPress={() => setExplication(e => !e)} testID="sans-source-aide" />
          </View>
          {explication ? (
            <View style={{ gap: 2 }} testID="sans-source-explication">
              <Text style={styleAttenue(theme, 14)}>1. Collez l’adresse d’un site dont vous avez le droit d’utiliser le contenu.</Text>
              <Text style={styleAttenue(theme, 14)}>2. Copiez le prompt généré dans une IA, puis collez sa réponse (un JSON).</Text>
              <Text style={styleAttenue(theme, 14)}>3. Testez la source, puis enregistrez-la : elle sert aussitôt à la lecture.</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={[styleTexte(theme, 14), { fontWeight: '700' }]} testID="sans-source-demander">
          Demande à l’administrateur d’ajouter des sources.
        </Text>
      )}
    </View>
  );
}

/** Fiche ou lecteur : « Ajouter/modifier les sources » pour les rangs habilités seulement. */
export function LienGererSources({ testID = 'gerer-sources' }: { testID?: string }) {
  const { s, theme, aller } = useTsuzuku();
  if (!s.estAdmin) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <Text style={[styleAttenue(theme, 13), { flexShrink: 1 }]}>Aucune source ne trouve ce titre ?</Text>
      <Bouton titre="Ajouter/modifier les sources" onPress={() => aller({ t: 'sources' })} testID={testID} />
    </View>
  );
}
