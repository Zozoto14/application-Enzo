/**
 * Visite guidée des nouveautés.
 *
 * Beaucoup d'écrans sont arrivés d'un coup : sans présentation, la moitié
 * passerait inaperçue. La visite s'ouvre une fois par version, chaque étape
 * mène à son écran d'un clic, et elle se relance depuis Paramètres.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, usePalette } from './composants';
import { ESPACEMENT, RAYON, POLICE_TITRE } from './theme';

/** À augmenter quand de nouvelles étapes s'ajoutent : la visite se rouvre. */
export const VERSION_VISITE = '2026-09-27';

export interface EtapeVisite {
  emoji: string;
  titre: string;
  texte: string;
  /** Destination de la barre latérale à ouvrir. */
  destination?: string;
}

export const ETAPES_VISITE: readonly EtapeVisite[] = [
  {
    emoji: '👋',
    titre: 'Quoi de neuf dans AppliBourse',
    texte: 'Un petit tour des nouveautés, en une minute. « Voir » ouvre l’écran concerné ; vous pourrez revenir à la visite depuis Paramètres.',
  },
  {
    emoji: '▤',
    titre: 'Le Screener',
    texte: 'Des catégories prêtes comme sur Baggr — France, PEA, Qualité, Croissance, Value, Dividendes — et chaque action à un clic de votre Watchlist.',
    destination: 'screener',
  },
  {
    emoji: '☆',
    titre: 'La Watchlist',
    texte: 'Vos valeurs suivies avec graphique, prix juste et seuils d’alerte ; onglets Thèses et Actualités. Les cours étrangers sont convertis en euros.',
    destination: 'watchlist',
  },
  {
    emoji: '✎',
    titre: 'Mon carnet',
    texte: 'Écrivez pourquoi vous détenez chaque valeur, votre objectif et votre seuil. L’application vous relit votre thèse le moment venu.',
    destination: 'carnet',
  },
  {
    emoji: '🌍',
    titre: 'Et si tout était sur le MSCI World ?',
    texte: 'Dans Portefeuille › Performances : vos choix comparés, en euros, au même argent placé dans un ETF monde.',
    destination: 'tableau',
  },
  {
    emoji: '🧾',
    titre: 'Le simulateur de vente',
    texte: 'Dans Portefeuille › Impôts : l’impôt d’une vente sur compte-titres, et pourquoi vendre dans un PEA ne coûte rien.',
    destination: 'tableau',
  },
  {
    emoji: '🎙️',
    titre: 'Le podcast',
    texte: 'Un flash de deux minutes, la semaine en bref le vendredi, et chaque information dite avec sa vérification.',
    destination: 'podcast',
  },
  {
    emoji: '🔔',
    titre: 'Les alertes',
    texte: 'Résultats, dividendes, grosses actus recoupées. Fermer la fenêtre laisse AppliBourse près de l’horloge, pour qu’elles partent.',
    destination: 'notifications',
  },
  {
    emoji: '✚',
    titre: 'Le diagnostic',
    texte: 'Un bouton teste tout pour de vrai. Si quelque chose ne marche pas, copiez le rapport et envoyez-le.',
    destination: 'diagnostic',
  },
];

export function VisiteGuidee({
  visible,
  onNaviguer,
  onTerminer,
  etapes = ETAPES_VISITE,
}: {
  visible: boolean;
  onNaviguer(destination: string): void;
  onTerminer(): void;
  etapes?: readonly EtapeVisite[];
}) {
  const palette = usePalette();
  const [rang, setRang] = useState(0);
  const etape = etapes[rang];
  const derniere = rang === etapes.length - 1;
  const terminer = () => {
    setRang(0);
    onTerminer();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={terminer}>
      <View style={styles.voile}>
        <View style={[styles.boite, { backgroundColor: palette.surface, borderColor: palette.bordure }]} testID="visite-guidee">
          <Text style={styles.emoji}>{etape.emoji}</Text>
          <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]}>
            {etape.titre}
          </Text>
          <Text style={{ color: palette.texteSecondaire, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>{etape.texte}</Text>

          <View style={styles.points}>
            {etapes.map((_, index) => (
              <View key={index} style={[styles.point, { backgroundColor: index === rang ? palette.accent : palette.bordure }]} />
            ))}
          </View>

          <View style={styles.actions}>
            {etape.destination ? (
              <Bouton
                titre="Voir"
                variante="discret"
                onPress={() => {
                  onNaviguer(etape.destination!);
                  terminer();
                }}
                testID="visite-voir"
              />
            ) : null}
            <Bouton
              titre={derniere ? 'Terminer' : 'Suivant'}
              onPress={() => (derniere ? terminer() : setRang(rang + 1))}
              testID="visite-suivant"
            />
          </View>
          {!derniere ? (
            <Pressable accessibilityRole="button" onPress={terminer} testID="visite-passer">
              <Text style={{ color: palette.texteSecondaire, textDecorationLine: 'underline' }}>Passer la visite</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  voile: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: ESPACEMENT.m },
  boite: {
    width: '100%',
    maxWidth: 460,
    borderRadius: RAYON.l,
    borderWidth: 1,
    padding: ESPACEMENT.l,
    gap: ESPACEMENT.m,
    alignItems: 'center',
  },
  emoji: { fontSize: 44 },
  titre: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  points: { flexDirection: 'row', gap: 6 },
  point: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ESPACEMENT.s },
});
