/**
 * Graphiques du téléphone et des tests.
 *
 * Même contrat que `Graphiques.web.tsx`, rendu en simples vues : pas de
 * module natif de dessin à compiler pour l'iPhone, et des tests qui lisent
 * des textes plutôt que des tracés. Le bureau, lui, charge la version SVG.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../mobile/adaptatif';
import { usePalette } from '../composants';
import { formaterDate } from '../format';
import { ESPACEMENT, RAYON } from '../theme';
import type {
  ProprietesBarres,
  ProprietesDonut,
  ProprietesLignes,
  ProprietesNuage,
  ProprietesRadar,
  ProprietesTreemap,
} from './types';

export type * from './types';

function Legende({ elements }: { elements?: readonly { couleur: string; texte: string }[] }) {
  const palette = usePalette();
  if (!elements || elements.length === 0) {
    return null;
  }
  return (
    <View style={styles.legende}>
      {elements.map((element, index) => (
        <View key={index} style={styles.elementLegende}>
          <View style={[styles.pastille, { backgroundColor: element.couleur }]} />
          <Text style={{ color: palette.texte, fontSize: 12 }}>{element.texte}</Text>
        </View>
      ))}
    </View>
  );
}

export function GraphiqueLignes({ series, formater, hauteur = 160, legende, testID }: ProprietesLignes) {
  const palette = usePalette();
  const principale = series.find(serie => serie.points.length > 0);
  if (!principale) {
    return (
      <Text testID={testID} style={{ color: palette.texteSecondaire }}>
        Aucune donnée à afficher
      </Text>
    );
  }

  // Au plus soixante barres : au-delà, elles ne mesurent plus un pixel.
  const pas = Math.max(1, Math.ceil(principale.points.length / 60));
  const echantillon = principale.points.filter((_, index) => index % pas === 0);
  const valeurs = echantillon.map(point => point.valeur);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const amplitude = max - min;
  const dernier = principale.points[principale.points.length - 1];

  return (
    <View testID={testID} style={{ gap: ESPACEMENT.s }}>
      <View style={[styles.barres, { height: Math.min(hauteur, 120) }]}>
        {echantillon.map((point, index) => (
          <View
            key={`${point.date}-${index}`}
            style={[
              styles.barre,
              {
                backgroundColor: principale.couleur,
                height: `${8 + (amplitude === 0 ? 0.5 : (point.valeur - min) / amplitude) * 92}%`,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.ligne}>
        <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
          {formaterDate(principale.points[0].date)}
        </Text>
        <Text style={{ color: palette.texte, fontSize: 12, fontWeight: '600' }}>
          {formaterDate(dernier.date)} · {formater(dernier.valeur)}
        </Text>
      </View>
      <Legende elements={legende} />
    </View>
  );
}

export function Donut({ parts, formater, testID }: ProprietesDonut) {
  const palette = usePalette();
  const visibles = parts.filter(part => part.valeur > 0);
  const total = visibles.reduce((somme, part) => somme + part.valeur, 0);
  if (total <= 0) {
    return (
      <Text testID={testID} style={{ color: palette.texteSecondaire }}>
        Aucune donnée à afficher
      </Text>
    );
  }

  return (
    <View testID={testID} style={{ gap: ESPACEMENT.s }}>
      <View style={[styles.empilement, { backgroundColor: palette.bordure }]}>
        {visibles.map((part, index) => (
          <View
            key={part.libelle}
            style={{
              flex: part.valeur / total,
              backgroundColor: part.couleur ?? palette.series[index % palette.series.length],
            }}
          />
        ))}
      </View>
      {visibles.map((part, index) => (
        <View key={part.libelle} style={styles.ligne}>
          <View style={styles.elementLegende}>
            <View
              style={[
                styles.pastille,
                { backgroundColor: part.couleur ?? palette.series[index % palette.series.length] },
              ]}
            />
            <Text style={{ color: palette.texte }}>{part.libelle}</Text>
          </View>
          <Text style={{ color: palette.texteSecondaire }}>
            {formater(part.valeur)} · {((part.valeur / total) * 100).toFixed(1).replace('.', ',')} %
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Barres({ barres, formater, hauteur = 140, legende, testID }: ProprietesBarres) {
  const palette = usePalette();
  const max = Math.max(0, ...barres.map(barre => Math.max(barre.valeur, barre.negatif ?? 0, -barre.valeur)));

  return (
    <View testID={testID} style={{ gap: ESPACEMENT.s }}>
      <View style={[styles.barres, { height: Math.min(hauteur, 140) }]}>
        {barres.map((barre, index) => (
          <View
            key={`${barre.libelle}-${index}`}
            accessibilityLabel={`${barre.libelle} : ${formater(barre.valeur)}`}
            style={[
              styles.barre,
              {
                height: `${Math.max(2, max > 0 ? (Math.abs(barre.valeur) / max) * 100 : 0)}%`,
                backgroundColor:
                  barre.valeur === 0
                    ? palette.bordure
                    : barre.couleur ?? (barre.valeur < 0 ? palette.baisse : palette.accent),
              },
            ]}
          />
        ))}
      </View>
      {barres.length > 0 ? (
        <View style={styles.ligne}>
          <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{barres[0].libelle}</Text>
          <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
            {barres[barres.length - 1].libelle}
          </Text>
        </View>
      ) : null}
      <Legende elements={legende} />
    </View>
  );
}

export function Nuage({ points, formaterX, formaterY, legende, testID }: ProprietesNuage) {
  const palette = usePalette();
  return (
    <View testID={testID} style={{ gap: ESPACEMENT.xs }}>
      {points.map((point, index) => (
        <View key={`${point.libelle}-${index}`} style={styles.ligne}>
          <View style={styles.elementLegende}>
            <View style={[styles.pastille, { backgroundColor: point.couleur }]} />
            <Text style={{ color: palette.texte }}>{point.libelle ?? '—'}</Text>
          </View>
          <Text style={{ color: palette.texteSecondaire }}>
            {formaterX(point.x)} · {formaterY(point.y)}
          </Text>
        </View>
      ))}
      <Legende elements={legende} />
    </View>
  );
}

export function Treemap({ tuiles, testID }: ProprietesTreemap) {
  const palette = usePalette();
  const total = tuiles.reduce((somme, tuile) => somme + Math.max(0, tuile.valeur), 0);
  return (
    <View testID={testID} style={{ gap: ESPACEMENT.s }}>
      {tuiles.map(tuile => (
        <View key={tuile.libelle} style={{ gap: 2 }}>
          <View style={styles.ligne}>
            <Text style={{ color: palette.texte, fontWeight: '600' }}>{tuile.libelle}</Text>
            <Text style={{ color: palette.texteSecondaire }}>{(tuile.lignes ?? []).join(' · ')}</Text>
          </View>
          <View style={[styles.jauge, { backgroundColor: palette.bordure }]}>
            <View
              style={{
                flex: total > 0 ? Math.max(0, tuile.valeur) / total : 0,
                backgroundColor: tuile.couleur,
              }}
            />
            <View style={{ flex: total > 0 ? 1 - Math.max(0, tuile.valeur) / total : 1 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function Radar({ axes, couleur, testID }: ProprietesRadar) {
  const palette = usePalette();
  return (
    <View testID={testID} style={{ gap: ESPACEMENT.s }}>
      {axes.map(axe => (
        <View key={axe.libelle} style={{ gap: 2 }}>
          <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{axe.libelle}</Text>
          <View style={[styles.jauge, { backgroundColor: palette.bordure }]}>
            <View style={{ flex: Math.max(0, Math.min(1, axe.valeur)), backgroundColor: couleur }} />
            <View style={{ flex: 1 - Math.max(0, Math.min(1, axe.valeur)) }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  barres: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barre: { flex: 1, borderRadius: 2, minWidth: 2 },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ESPACEMENT.s },
  legende: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m, justifyContent: 'center' },
  elementLegende: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.xs },
  pastille: { width: 9, height: 9, borderRadius: 5 },
  empilement: { flexDirection: 'row', height: 12, borderRadius: RAYON.s, overflow: 'hidden' },
  jauge: { flexDirection: 'row', height: 6, borderRadius: RAYON.s, overflow: 'hidden' },
});
