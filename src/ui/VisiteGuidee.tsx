/**
 * Visite guidée des nouveautés.
 *
 * Beaucoup d'écrans sont arrivés d'un coup : sans présentation, la moitié
 * passerait inaperçue. Chaque étape n'est montrée qu'une fois : la visite ne
 * se rouvre que pour des nouveautés jamais vues. « Ouvrir la page » emmène
 * sur l'écran et replie la visite en bandeau, qui la fait reprendre ensuite.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, usePalette } from './composants';
import { ESPACEMENT, RAYON, POLICE_TITRE } from './theme';

/** Ancienne valeur enregistrée : elle voulait dire « toutes les étapes d'alors vues ». */
export const VERSION_VISITE = '2026-09-27';
const ETAPES_DE_LA_VERSION_2026_09_27 = [
  'intro',
  'screener',
  'watchlist',
  'carnet',
  'msci-world',
  'simulateur-vente',
  'podcast',
  'alertes',
  'diagnostic',
];

export interface EtapeVisite {
  /** Identifiant stable : une étape vue n'est plus jamais reproposée. */
  id: string;
  emoji: string;
  titre: string;
  texte: string;
  /** Destination de la barre latérale à ouvrir. */
  destination?: string;
  /** Onglet du portefeuille à afficher, quand la destination est le tableau. */
  onglet?: string;
}

/** Lit les identifiants déjà vus (liste JSON, ou l'ancienne valeur de version). */
export function etapesDejaVues(brute: string | undefined | null): Set<string> {
  if (!brute) {
    return new Set();
  }
  if (brute === VERSION_VISITE) {
    return new Set(ETAPES_DE_LA_VERSION_2026_09_27);
  }
  try {
    const liste = JSON.parse(brute);
    return new Set(Array.isArray(liste) ? liste.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Les étapes jamais vues ; l'introduction seule ne justifie pas de rouvrir la visite. */
export function etapesNouvelles(etapes: readonly EtapeVisite[], brute: string | undefined | null): EtapeVisite[] {
  const vues = etapesDejaVues(brute);
  const nouvelles = etapes.filter(etape => !vues.has(etape.id));
  return nouvelles.some(etape => etape.destination) ? nouvelles : [];
}

/** Valeur à enregistrer après avoir vu `ids`. */
export function marquerVues(brute: string | undefined | null, ids: readonly string[]): string {
  const vues = etapesDejaVues(brute);
  ids.forEach(id => vues.add(id));
  return JSON.stringify([...vues].sort());
}

export const ETAPES_VISITE: readonly EtapeVisite[] = [
  {
    id: 'intro',
    emoji: '👋',
    titre: 'Quoi de neuf dans AppliBourse',
    texte: 'Un petit tour des nouveautés, en une minute. À chaque étape, « Ouvrir la page » vous y emmène pour voir à quoi ça ressemble, puis la visite reprend. Elle se relance depuis Paramètres.',
  },
  {
    id: 'screener',
    emoji: '▤',
    titre: 'Le Screener',
    texte: 'Des catégories prêtes comme sur Baggr — France, PEA, Qualité, Croissance, Value, Dividendes — et chaque action à un clic de votre Watchlist.',
    destination: 'screener',
  },
  {
    id: 'watchlist',
    emoji: '☆',
    titre: 'La Watchlist',
    texte: 'Vos valeurs suivies avec graphique, prix juste et seuils d’alerte ; onglets Thèses et Actualités. Les cours étrangers sont convertis en euros.',
    destination: 'watchlist',
  },
  {
    id: 'carnet',
    emoji: '✎',
    titre: 'Mon carnet',
    texte: 'Écrivez pourquoi vous détenez chaque valeur, votre objectif et votre seuil. L’application vous relit votre thèse le moment venu.',
    destination: 'carnet',
  },
  {
    id: 'msci-world',
    emoji: '🌍',
    titre: 'Et si tout était sur le MSCI World ?',
    texte: 'Dans Portefeuille › Performances : vos choix comparés, en euros, au même argent placé dans un ETF monde.',
    destination: 'tableau',
    onglet: 'performances',
  },
  {
    id: 'simulateur-vente',
    emoji: '🧾',
    titre: 'Le simulateur de vente',
    texte: 'Dans Portefeuille › Impôts : l’impôt d’une vente sur compte-titres, et pourquoi vendre dans un PEA ne coûte rien.',
    destination: 'tableau',
    onglet: 'impots',
  },
  {
    id: 'podcast',
    emoji: '🎙️',
    titre: 'Le podcast',
    texte: 'Un flash de deux minutes, la semaine en bref le vendredi, et chaque information dite avec sa vérification.',
    destination: 'podcast',
  },
  {
    id: 'alertes',
    emoji: '🔔',
    titre: 'Les alertes',
    texte: 'Résultats, dividendes, grosses actus recoupées. Fermer la fenêtre laisse AppliBourse près de l’horloge, pour qu’elles partent.',
    destination: 'notifications',
  },
  {
    id: 'diagnostic',
    emoji: '✚',
    titre: 'Le diagnostic',
    texte: 'Un bouton teste tout pour de vrai. Si quelque chose ne marche pas, copiez le rapport et envoyez-le.',
    destination: 'diagnostic',
  },
];

export function VisiteGuidee({
  visible,
  onNaviguer,
  onVue,
  onTerminer,
  etapes = ETAPES_VISITE,
}: {
  visible: boolean;
  onNaviguer(destination: string, onglet?: string): void;
  /** Appelé dès qu'une étape s'affiche : elle ne sera plus reproposée. */
  onVue?(id: string): void;
  onTerminer(): void;
  etapes?: readonly EtapeVisite[];
}) {
  const palette = usePalette();
  const [rang, setRang] = useState(0);
  // Page ouverte : la fenêtre se replie en bandeau pour laisser voir l'écran.
  const [replie, setReplie] = useState(false);
  const etape = etapes[Math.min(rang, etapes.length - 1)];
  const derniere = rang >= etapes.length - 1;
  const actif = visible && etape !== undefined;

  useEffect(() => {
    if (actif) {
      onVue?.(etape.id);
    }
    // onVue change à chaque rendu de l'appelant : seule l'étape compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, etape?.id]);

  if (!actif) {
    return null;
  }
  const terminer = () => {
    setRang(0);
    setReplie(false);
    onTerminer();
  };
  const suivante = () => {
    setReplie(false);
    if (derniere) {
      terminer();
    } else {
      setRang(rang + 1);
    }
  };

  if (replie) {
    return (
      <View style={styles.ancrage} pointerEvents="box-none">
        <View
          style={[styles.bandeau, { backgroundColor: palette.surface, borderColor: palette.accent }]}
          testID="visite-bandeau">
          <Text style={{ color: palette.texte, fontWeight: '700', flexShrink: 1 }} numberOfLines={2}>
            {etape.emoji} {etape.titre}
            <Text style={{ color: palette.texteSecondaire, fontWeight: '400' }}>
              {'  '}· étape {rang + 1}/{etapes.length}
            </Text>
          </Text>
          <View style={styles.actionsBandeau}>
            <Bouton
              titre={derniere ? 'Terminer la visite' : 'Continuer la visite'}
              onPress={suivante}
              testID="visite-continuer"
            />
            {!derniere ? (
              <Bouton titre="Arrêter" variante="discret" onPress={terminer} testID="visite-arreter" />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={terminer}>
      <View style={styles.voile}>
        <View style={[styles.boite, { backgroundColor: palette.surface, borderColor: palette.bordure }]} testID="visite-guidee">
          <Text style={styles.emoji}>{etape.emoji}</Text>
          <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]}>
            {etape.titre}
          </Text>
          <Text style={{ color: palette.texteSecondaire, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>{etape.texte}</Text>
          {etape.destination ? (
            <Text style={{ color: palette.texte, fontWeight: '600', textAlign: 'center' }}>
              Voulez-vous ouvrir la page pour voir à quoi ça ressemble ?
            </Text>
          ) : null}

          {etapes.length > 1 ? (
            <View style={styles.points}>
              {etapes.map((_, index) => (
                <View key={index} style={[styles.point, { backgroundColor: index === rang ? palette.accent : palette.bordure }]} />
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            {etape.destination ? (
              <Bouton
                titre="Ouvrir la page"
                onPress={() => {
                  onNaviguer(etape.destination!, etape.onglet);
                  setReplie(true);
                }}
                testID="visite-voir"
              />
            ) : null}
            <Bouton
              titre={derniere ? 'Terminer' : etape.destination ? 'Plus tard, suivant' : 'Commencer'}
              variante={etape.destination ? 'discret' : undefined}
              onPress={suivante}
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
  ancrage: { position: 'absolute', top: ESPACEMENT.m, left: 0, right: 0, alignItems: 'center', paddingHorizontal: ESPACEMENT.m, zIndex: 50 },
  bandeau: {
    width: '100%',
    maxWidth: 620,
    borderWidth: 2,
    borderRadius: RAYON.l,
    padding: ESPACEMENT.m,
    gap: ESPACEMENT.s,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  actionsBandeau: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ESPACEMENT.s },
});
