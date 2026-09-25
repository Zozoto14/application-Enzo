/**
 * Affichage d'un indicateur, avec son explication.
 *
 * Le « ? » n'est pas un ornement. Un portefeuille se pilote avec des mesures
 * qui se ressemblent et disent des choses différentes : confondre TWR et TRI,
 * ou plus-value latente et réalisée, conduit à de mauvaises décisions. Le
 * texte est donc disponible à côté du chiffre, pas dans une documentation.
 *
 * Une mesure indisponible affiche son motif plutôt qu'un tiret muet : savoir
 * *pourquoi* un chiffre manque vaut mieux que constater qu'il manque.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SousTitre, usePalette, Variation } from './composants';
import { ESPACEMENT, RAYON, couleurTendance } from './theme';
import type { Tendance } from './format';
import { explication, type CleExplication } from './vues/explications';
import type { MesureAffichee } from './vues/onglets';

export function Explication({ cle }: { cle: CleExplication }) {
  const [ouvert, setOuvert] = useState(false);
  const palette = usePalette();
  const contenu = explication(cle);

  return (
    <View style={styles.bloc}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Expliquer : ${contenu.titre}`}
        accessibilityState={{ expanded: ouvert }}
        testID={`explication-${cle}`}
        onPress={() => setOuvert(precedent => !precedent)}
        style={[styles.pastille, { borderColor: palette.bordure }]}>
        <Text style={{ color: palette.texteSecondaire, fontWeight: '700' }}>?</Text>
      </Pressable>

      {ouvert ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.panneau,
            { backgroundColor: palette.fond, borderColor: palette.bordure },
          ]}>
          <Text style={[styles.titre, { color: palette.texte }]}>{contenu.titre}</Text>
          <Text style={{ color: palette.texte }}>{contenu.court}</Text>
          <SousTitre>{contenu.detail}</SousTitre>
          {contenu.piege ? (
            <View style={[styles.piege, { borderLeftColor: palette.danger }]}>
              <Text style={{ color: palette.texteSecondaire }}>{contenu.piege}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface IndicateurProps {
  etiquette: string;
  valeur: string;
  explication?: CleExplication;
  tendance?: Tendance;
  /** Affiché sous la valeur, en petit. */
  precision?: string;
  grand?: boolean;
}

export function Indicateur({
  etiquette,
  valeur,
  explication: cle,
  tendance,
  precision,
  grand = false,
}: IndicateurProps) {
  const palette = usePalette();

  return (
    <View style={styles.indicateur}>
      <View style={styles.ligneEtiquette}>
        <SousTitre>{etiquette}</SousTitre>
        {cle ? <Explication cle={cle} /> : null}
      </View>

      {tendance ? (
        <Variation valeur={valeur} tendance={tendance} taille={grand ? 28 : 18} />
      ) : (
        <Text
          style={{
            color: palette.texte,
            fontSize: grand ? 28 : 18,
            fontWeight: '700',
          }}>
          {valeur}
        </Text>
      )}

      {precision ? <SousTitre>{precision}</SousTitre> : null}
    </View>
  );
}

/**
 * Indicateur dont la valeur peut manquer.
 * Le motif remplace le chiffre : c'est l'information utile quand le chiffre
 * n'existe pas.
 */
export function IndicateurMesure({
  etiquette,
  mesure,
  explication: cle,
  tendance,
}: {
  etiquette: string;
  mesure: MesureAffichee;
  explication?: CleExplication;
  tendance?: Tendance;
}) {
  const palette = usePalette();

  if (mesure.valeur === null) {
    return (
      <View style={styles.indicateur}>
        <View style={styles.ligneEtiquette}>
          <SousTitre>{etiquette}</SousTitre>
          {cle ? <Explication cle={cle} /> : null}
        </View>
        <Text style={{ color: palette.texteSecondaire, fontSize: 18 }}>—</Text>
        {mesure.motif ? <SousTitre>{mesure.motif}</SousTitre> : null}
      </View>
    );
  }

  return (
    <Indicateur
      etiquette={etiquette}
      valeur={mesure.valeur}
      explication={cle}
      tendance={tendance}
    />
  );
}

/** Barre de progression horizontale, de 0 à 1. */
export function Jauge({ fraction, tendance }: { fraction: number; tendance?: Tendance }) {
  const palette = usePalette();
  const part = Math.min(1, Math.max(0, fraction));
  const couleur = tendance ? couleurTendance(palette, tendance) : palette.accent;

  return (
    <View style={[styles.jauge, { backgroundColor: palette.bordure }]}>
      <View style={[styles.jaugeRemplie, { backgroundColor: couleur, flex: part }]} />
      <View style={{ flex: 1 - part }} />
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: ESPACEMENT.s },
  pastille: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panneau: {
    borderRadius: RAYON.s,
    borderWidth: StyleSheet.hairlineWidth,
    padding: ESPACEMENT.m - 4,
    gap: ESPACEMENT.s,
  },
  titre: { fontSize: 15, fontWeight: '700' },
  piege: {
    borderLeftWidth: 3,
    paddingLeft: ESPACEMENT.s,
  },
  indicateur: { gap: ESPACEMENT.xs, flex: 1, minWidth: 140 },
  ligneEtiquette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
  },
  jauge: {
    flexDirection: 'row',
    height: 6,
    borderRadius: RAYON.s,
    overflow: 'hidden',
  },
  jaugeRemplie: { height: 6 },
});
