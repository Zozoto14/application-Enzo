/**
 * Éléments de présentation des écrans d'analyse.
 *
 * Cartes à titre, pastilles de variation, sélecteurs : la grammaire visuelle
 * commune aux onglets du portefeuille, à la fiche valeur et au comparateur.
 * Aucun calcul ici — les valeurs arrivent formatées des modèles de vue.
 */

import React, { createContext, useContext, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { usePalette } from './composants';
import { Explication } from './indicateurs';
import { ESPACEMENT, RAYON } from './theme';
import type { Tendance } from './format';
import type { CleExplication } from './vues/explications';
import {
  Superposition,
  useSignalerOuverture,
  useSuperposition,
} from './superposition';

/** Largeur à partir de laquelle les cartes se rangent côte à côte. */
export const LARGEUR_COLONNES = 900;

export function useLarge(): boolean {
  return useWindowDimensions().width >= LARGEUR_COLONNES;
}

/**
 * Vrai pour une carte posée dans une rangée. Seule une carte en rangée
 * partage la largeur : empilée, une base nulle l'écraserait en hauteur.
 */
const DansRangee = createContext(false);

export interface CarteSectionProps {
  titre?: string;
  /** Pictogramme ou élément placé avant le titre. */
  avantTitre?: React.ReactNode;
  explication?: CleExplication;
  /** Commandes alignées à droite du titre : sélecteurs, boutons. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Part de la largeur de la rangée, en disposition large. */
  poids?: number;
  testID?: string;
}

export function CarteSection({
  titre,
  avantTitre,
  explication,
  actions,
  children,
  style,
  poids = 1,
  testID,
}: CarteSectionProps) {
  const palette = usePalette();
  const large = useLarge();
  const enRangee = useContext(DansRangee);
  const [dessus, signaler] = useSuperposition();
  return (
    <Superposition.Provider value={signaler}>
      <View
        testID={testID}
        style={[
          styles.carte,
          { backgroundColor: palette.surface, borderColor: palette.bordure },
          large && enRangee
            ? { flexGrow: poids, flexShrink: 1, flexBasis: 0, minWidth: 280 }
            : undefined,
          dessus ? styles.dessus : undefined,
          style,
        ]}
      >
        {titre || actions ? (
          <View style={styles.enTete}>
            <View style={styles.titreBloc}>
              {avantTitre}
              {titre ? (
                <Text
                  style={[styles.titre, { color: palette.texte }]}
                  accessibilityRole="header"
                >
                  {titre}
                </Text>
              ) : null}
              {explication ? <Explication cle={explication} /> : null}
            </View>
            {actions ? <View style={styles.actions}>{actions}</View> : null}
          </View>
        ) : null}
        {children}
      </View>
    </Superposition.Provider>
  );
}

/** Rangée de cartes : côte à côte en large, empilées sur téléphone. */
export function Rangee({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const large = useLarge();
  const [dessus, signaler] = useSuperposition();
  return (
    <DansRangee.Provider value>
      <Superposition.Provider value={signaler}>
        <View
          style={[
            large ? styles.rangee : styles.pile,
            dessus ? styles.dessus : undefined,
            style,
          ]}
        >
          {children}
        </View>
      </Superposition.Provider>
    </DansRangee.Provider>
  );
}

/** Colonne de cartes empilées, qui occupe une part de la rangée. */
export function Pile({ children, poids = 1 }: { children: React.ReactNode; poids?: number }) {
  const large = useLarge();
  return (
    <DansRangee.Provider value={false}>
      <View
        style={[
          styles.pile,
          large ? { flexGrow: poids, flexShrink: 1, flexBasis: 0, minWidth: 300 } : undefined,
        ]}>
        {children}
      </View>
    </DansRangee.Provider>
  );
}

/** Pastille teintée d'une variation : flèche, signe et couleur disent le sens. */
export function Pastille({
  texte,
  tendance,
  taille = 12,
}: {
  texte: string;
  tendance: Tendance;
  taille?: number;
}) {
  const palette = usePalette();
  const couleur =
    tendance === 'hausse'
      ? palette.hausse
      : tendance === 'baisse'
      ? palette.baisse
      : palette.accent;
  const fond =
    tendance === 'hausse'
      ? palette.hausseFond
      : tendance === 'baisse'
      ? palette.baisseFond
      : palette.accentFond;
  const fleche = tendance === 'hausse' ? '↗' : tendance === 'baisse' ? '↘' : '';
  return (
    <View style={[styles.pastille, { backgroundColor: fond }]}>
      <Text style={{ color: couleur, fontSize: taille, fontWeight: '700' }}>
        {fleche ? `${fleche} ` : ''}
        {texte}
      </Text>
    </View>
  );
}

/** Montant coloré selon son sens, sans pastille. */
export function Signe({
  texte,
  tendance,
  taille = 14,
  gras = true,
}: {
  texte: string;
  tendance: Tendance;
  taille?: number;
  gras?: boolean;
}) {
  const palette = usePalette();
  const couleur =
    tendance === 'hausse'
      ? palette.hausse
      : tendance === 'baisse'
      ? palette.baisse
      : palette.texte;
  return (
    <Text
      style={{
        color: couleur,
        fontSize: taille,
        fontWeight: gras ? '700' : '500',
      }}
    >
      {texte}
    </Text>
  );
}

/** Choix exclusif compact : YTD · 1A · 3A · MAX. */
export function Segments<T extends string>({
  options,
  actif,
  onChoisir,
  libelle,
  prefixeTest,
}: {
  options: readonly T[];
  actif: T;
  onChoisir(valeur: T): void;
  libelle?(valeur: T): string;
  prefixeTest?: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.segments} accessibilityRole="radiogroup">
      {options.map(option => {
        const selectionne = option === actif;
        return (
          <Pressable
            key={option}
            testID={prefixeTest ? `${prefixeTest}-${option}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectionne }}
            onPress={() => onChoisir(option)}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selectionne
                  ? palette.accentPlein
                  : palette.surfaceHaute,
                borderColor: selectionne
                  ? palette.accentPlein
                  : palette.bordure,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: selectionne
                  ? palette.surAccent
                  : palette.texteSecondaire,
                fontSize: 12,
                fontWeight: '700',
              }}
            >
              {libelle ? libelle(option) : option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface OptionSelecteur {
  valeur: string;
  libelle: string;
}

/**
 * Liste déroulante à étiquette flottante.
 *
 * La liste s'ouvre sous le champ, par-dessus le contenu ; choisir une option
 * la referme. Pas de sélecteur natif : il ne se stylise pas sur fond noir.
 */
export function Selecteur({
  etiquette,
  valeur,
  options,
  onChoisir,
  largeur = 170,
  testID,
}: {
  etiquette: string;
  valeur: string;
  options: readonly OptionSelecteur[];
  onChoisir(valeur: string): void;
  largeur?: number;
  testID?: string;
}) {
  const palette = usePalette();
  const [ouvert, setOuvert] = useState(false);
  useSignalerOuverture(ouvert);
  const courant = options.find(option => option.valeur === valeur);

  return (
    <View
      style={[styles.selecteur, { width: largeur, zIndex: ouvert ? 50 : 1 }]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${etiquette} : ${courant?.libelle ?? valeur}`}
        accessibilityState={{ expanded: ouvert }}
        onPress={() => setOuvert(precedent => !precedent)}
        style={[
          styles.champSelecteur,
          { borderColor: ouvert ? palette.accent : palette.bordure },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{ color: palette.texte, fontSize: 13, flex: 1 }}
        >
          {courant?.libelle ?? valeur}
        </Text>
        <Text style={{ color: palette.texteSecondaire, fontSize: 10 }}>
          {ouvert ? '▲' : '▼'}
        </Text>
      </Pressable>
      <Text
        style={[
          styles.etiquetteFlottante,
          { color: palette.texteSecondaire, backgroundColor: palette.surface },
        ]}
      >
        {etiquette}
      </Text>
      {ouvert ? (
        <View
          style={[
            styles.liste,
            {
              backgroundColor: palette.surfaceHaute,
              borderColor: palette.bordure,
            },
          ]}
        >
          {options.map(option => (
            <Pressable
              key={option.valeur}
              testID={testID ? `${testID}-${option.valeur}` : undefined}
              accessibilityRole="menuitem"
              onPress={() => {
                setOuvert(false);
                onChoisir(option.valeur);
              }}
              style={({ pressed }) => [
                styles.optionListe,
                {
                  backgroundColor:
                    option.valeur === valeur
                      ? palette.accentFond
                      : pressed
                      ? palette.surface
                      : 'transparent',
                },
              ]}
            >
              <Text
                style={{
                  color:
                    option.valeur === valeur ? palette.accent : palette.texte,
                  fontSize: 13,
                }}
              >
                {option.libelle}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Bouton discret d'une barre d'outils. */
export function BoutonOutil({
  titre,
  onPress,
  plein = false,
  desactive = false,
  testID,
}: {
  titre: string;
  onPress(): void;
  plein?: boolean;
  desactive?: boolean;
  testID?: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.outil,
        {
          backgroundColor: plein ? palette.accentPlein : palette.surfaceHaute,
          borderColor: plein ? palette.accentPlein : palette.bordure,
          opacity: desactive ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: plein ? palette.surAccent : palette.texte,
          fontSize: 13,
          fontWeight: '600',
        }}
      >
        {titre}
      </Text>
    </Pressable>
  );
}

/** Paire libellé / valeur des blocs de métriques clés. */
export function Metrique({
  libelle,
  valeur,
  tendance,
  detail,
}: {
  libelle: string;
  valeur: string;
  tendance?: Tendance;
  detail?: string;
}) {
  const palette = usePalette();
  const couleur =
    tendance === 'hausse'
      ? palette.hausse
      : tendance === 'baisse'
      ? palette.baisse
      : palette.texte;
  return (
    <View style={styles.metrique}>
      <Text
        style={[styles.libelleMetrique, { color: palette.texteSecondaire }]}
      >
        {libelle}
      </Text>
      <Text style={{ color: couleur, fontSize: 14, fontWeight: '700' }}>
        {valeur}
      </Text>
      {detail ? (
        <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** Texte d'état vide, dans une carte. */
export function Vide({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <Text
      style={{ color: palette.texteSecondaire, fontSize: 13, lineHeight: 19 }}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  carte: {
    borderRadius: RAYON.m,
    borderWidth: 1,
    padding: ESPACEMENT.m + 2,
    gap: ESPACEMENT.m,
  },
  enTete: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ESPACEMENT.s,
    zIndex: 10,
  },
  titreBloc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    flexShrink: 1,
  },
  titre: { fontSize: 16, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    // Sur une carte étroite, les contrôles passent à la ligne au lieu de
    // déborder hors du cadre.
    flexShrink: 1,
    maxWidth: '100%',
  },
  rangee: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ESPACEMENT.m,
    alignItems: 'stretch',
  },
  pile: { gap: ESPACEMENT.m },
  pastille: {
    alignSelf: 'flex-start',
    borderRadius: 7,
    paddingHorizontal: ESPACEMENT.s,
    paddingVertical: 3,
  },
  segments: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segment: {
    minWidth: 38,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selecteur: { position: 'relative', paddingTop: 7 },
  champSelecteur: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.m - 4,
    minHeight: 40,
  },
  etiquetteFlottante: {
    position: 'absolute',
    top: 0,
    left: 10,
    paddingHorizontal: 4,
    fontSize: 11,
  },
  liste: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingVertical: 4,
    zIndex: 60,
    elevation: 8,
  },
  optionListe: {
    paddingHorizontal: ESPACEMENT.m - 4,
    paddingVertical: ESPACEMENT.s + 2,
  },
  outil: {
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.m - 2,
    minHeight: 36,
    justifyContent: 'center',
  },
  metrique: { gap: 2, minWidth: 130, flexGrow: 1, flexBasis: 130 },
  dessus: { zIndex: 100 },
  libelleMetrique: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
