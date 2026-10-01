/**
 * Barre de navigation latérale, présente sur tous les écrans une fois
 * l'application déverrouillée.
 *
 * Sur un grand écran, chaque destination est à un clic, où que l'on soit :
 * plus besoin de revenir au portefeuille pour aller ailleurs. Sur un
 * téléphone, la place manque : la barre disparaît et chaque écran garde son
 * bouton de retour.
 */

import React, { createContext, useContext, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { usePalette } from './composants';
import { ESPACEMENT, POLICE_TITRE, RAYON } from './theme';
import { BarreOnglets, type EntreeOnglet } from './mobile/BarreOnglets';
import { EnTeteMobile } from './mobile/EnTeteMobile';
import { FeuilleBasse } from './mobile/FeuilleBasse';
import { themeActif } from './mobile/jetons';
import { Cellule, GroupeCellules } from './mobile/ListeCellules';
import { useMobile } from './mobile/useMobile';

export interface Destination {
  cle: string;
  libelle: string;
  /** Pictogramme simple : aucune police d'icônes à embarquer. */
  glyphe: string;
  /** Sous-catégorie de la destination qui la précède : affichée en retrait. */
  sous?: boolean;
  /** Téléphone : entrée de la barre basse (4 au plus) ; les autres vont dans « Plus ». */
  principale?: boolean;
  /** Libellé court de la barre basse (« Opération »). */
  libelleCourt?: string;
}

/** En dessous, pas de barre latérale : la place manque. */
export const LARGEUR_NAVIGATION = 900;
/** Au-dessus, la barre affiche les libellés à côté des pictogrammes. */
const LARGEUR_LIBELLES = 1180;

/** Vrai sous une Coque qui affiche la navigation (barre latérale ou bandeau). */
const NavigationPresente = createContext(false);

/**
 * Vrai quand la navigation de la Coque est affichée : les écrans n'ont alors
 * pas à répéter ses destinations dans leur propre barre d'outils.
 */
export function useNavigationLaterale(): boolean {
  return useContext(NavigationPresente);
}

function lienDiscretion(discret: boolean): Destination {
  return { cle: 'discretion', libelle: discret ? 'Afficher les €' : 'Masquer les €', glyphe: discret ? '◉' : '◌' };
}

export function Coque({
  destinations,
  actif,
  onNaviguer,
  onVerrouiller,
  discret = false,
  onBasculerDiscretion,
  flottant,
  enTete,
  children,
}: {
  destinations: readonly Destination[];
  actif: string;
  onNaviguer(cle: string): void;
  onVerrouiller?(): void;
  /** Mode discret : montants masqués. */
  discret?: boolean;
  onBasculerDiscretion?(): void;
  /** Élément posé par-dessus le contenu (le lecteur du podcast). */
  flottant?: React.ReactNode;
  /** Barre commune à toutes les pages d'app : pastille de synchro et bouton Paramètres. */
  enTete?: React.ReactNode;
  children: React.ReactNode;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const mobile = useMobile();
  const contenu = (
    <>
      {enTete ? (
        <View style={[styles.enTete, { backgroundColor: palette.fond }]} testID="entete-app">
          {enTete}
        </View>
      ) : null}
      <View style={styles.contenu}>{children}</View>
    </>
  );
  if (destinations.length === 0) {
    return <>{children}</>;
  }
  if (mobile) {
    return (
      <NavigationPresente.Provider value>
        <CoqueTelephone
          destinations={destinations}
          actif={actif}
          onNaviguer={onNaviguer}
          onVerrouiller={onVerrouiller}
          discret={discret}
          onBasculerDiscretion={onBasculerDiscretion}
          enTete={enTete}
          flottant={flottant}>
          {children}
        </CoqueTelephone>
      </NavigationPresente.Provider>
    );
  }
  if (width < LARGEUR_NAVIGATION) {
    // Tablette, téléphone, petite fenêtre : la barre latérale n'a pas la
    // place. Les mêmes destinations passent en bandeau défilant, en haut.
    return (
      <NavigationPresente.Provider value>
      <View style={[styles.colonne, { backgroundColor: palette.fond }]}>
        <View style={[styles.bandeau, { backgroundColor: palette.navigation ?? palette.surface, borderBottomColor: palette.bordure }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.liensBandeau}>
            {destinations.map(destination => (
              <Lien
                key={destination.cle}
                destination={destination}
                actif={actif}
                libelles
                compact
                onPress={() => onNaviguer(destination.cle)}
              />
            ))}
            {onBasculerDiscretion ? (
              <Lien
                destination={lienDiscretion(discret)}
                actif={discret ? 'discretion' : actif}
                libelles
                compact
                onPress={onBasculerDiscretion}
              />
            ) : null}
            {onVerrouiller ? (
              <Lien
                destination={{ cle: 'verrouiller', libelle: 'Verrouiller', glyphe: '⏻' }}
                actif={actif}
                libelles
                compact
                onPress={onVerrouiller}
              />
            ) : null}
          </ScrollView>
        </View>
        <View style={styles.contenu}>
          {contenu}
          {flottant}
        </View>
      </View>
      </NavigationPresente.Provider>
    );
  }
  const libelles = width >= LARGEUR_LIBELLES;

  return (
    <NavigationPresente.Provider value>
    <View style={[styles.rangee, { backgroundColor: palette.fond }]}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.barre,
          {
            width: libelles ? 216 : 92,
            backgroundColor: palette.navigation ?? palette.surface,
            borderRightColor: palette.bordure,
          },
        ]}
      >
        <Text
          {...POLICE_TITRE}
          style={[
            styles.marque,
            { color: palette.texte },
            !libelles && { textAlign: 'center' },
          ]}
        >
          {libelles ? (
            <>
              Appli<Text style={{ color: palette.accent }}>Bourse</Text>
            </>
          ) : (
            <Text style={{ color: palette.accent }}>AB</Text>
          )}
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.liens}
        >
          {destinations.map(destination => (
            <Lien
              key={destination.cle}
              destination={destination}
              actif={actif}
              libelles={libelles}
              onPress={() => onNaviguer(destination.cle)}
            />
          ))}
        </ScrollView>
        {onVerrouiller || onBasculerDiscretion ? (
          <View style={[styles.pied, { borderTopColor: palette.bordure }]}>
            {onBasculerDiscretion ? (
              <Lien
                destination={lienDiscretion(discret)}
                actif={discret ? 'discretion' : actif}
                libelles={libelles}
                onPress={onBasculerDiscretion}
              />
            ) : null}
            {onVerrouiller ? (
              <Lien
                destination={{
                  cle: 'verrouiller',
                  libelle: 'Verrouiller',
                  glyphe: '⏻',
                }}
                actif={actif}
                libelles={libelles}
                onPress={onVerrouiller}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.contenu}>
          {contenu}
          {flottant}
        </View>
    </View>
    </NavigationPresente.Provider>
  );
}

/** Entrées de la barre basse d'une app (pure, testée) : les principales (4 au plus), puis « Plus ». */
export function entreesBarreApp(destinations: readonly Destination[]): { principales: Destination[]; autres: Destination[] } {
  const candidates = destinations.filter(d => d.cle !== 'hub');
  const marquees = candidates.filter(d => d.principale);
  const principales = (marquees.length > 0 ? marquees : candidates.filter(d => !d.sous)).slice(0, 4);
  return { principales, autres: candidates.filter(d => !principales.includes(d)) };
}

/**
 * Coque d'une app sur téléphone : en-tête compact (‹ Accueil, titre de l'écran, synchro, réglages),
 * contenu, barre basse (4 sections principales + « Plus » : feuille basse avec le reste, le mode
 * discret et le verrouillage).
 */
function CoqueTelephone({
  destinations,
  actif,
  onNaviguer,
  onVerrouiller,
  discret,
  onBasculerDiscretion,
  enTete,
  flottant,
  children,
}: {
  destinations: readonly Destination[];
  actif: string;
  onNaviguer(cle: string): void;
  onVerrouiller?(): void;
  discret: boolean;
  onBasculerDiscretion?(): void;
  enTete?: React.ReactNode;
  flottant?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = themeActif();
  const [plus, setPlus] = useState(false);
  const { principales, autres } = entreesBarreApp(destinations);
  const versHub = destinations.some(d => d.cle === 'hub');
  const courante = destinations.find(d => d.cle === actif);
  const entrees: EntreeOnglet[] = [
    ...principales.map(d => ({ cle: d.cle, libelle: d.libelleCourt ?? d.libelle, glyphe: d.glyphe, description: d.libelle })),
    { cle: 'plus', libelle: 'Plus', glyphe: '☰', description: 'Plus : autres sections, mode discret, verrouillage' },
  ];
  const choisir = (cle: string) => {
    setPlus(false);
    onNaviguer(cle);
  };
  return (
    <View style={[styles.colonne, { backgroundColor: theme.fond }]} testID="coque-telephone">
      <EnTeteMobile
        theme={theme}
        titre={courante?.libelle ?? ''}
        onRetour={versHub ? () => onNaviguer('hub') : undefined}
        libelleRetour="Accueil"
        testIDRetour="nav-hub"
        droite={enTete}
        testID="entete-app"
      />
      <View style={styles.contenu}>
        {children}
        {flottant}
      </View>
      <BarreOnglets
        theme={theme}
        entrees={entrees}
        actif={plus ? 'plus' : principales.some(d => d.cle === actif) ? actif : 'plus'}
        onChoisir={cle => (cle === 'plus' ? setPlus(true) : choisir(cle))}
        testID="barre-basse-app"
      />
      <FeuilleBasse theme={theme} visible={plus} titre="Plus" onFermer={() => setPlus(false)} testID="feuille-plus">
        <GroupeCellules theme={theme}>
          {autres.map(d => (
            <Cellule key={d.cle} theme={theme} glyphe={d.glyphe} titre={d.libelle} chevron coche={d.cle === actif ? true : undefined} onPress={() => choisir(d.cle)} testID={`nav-${d.cle}`} />
          ))}
        </GroupeCellules>
        {onBasculerDiscretion || onVerrouiller ? (
          <GroupeCellules theme={theme}>
            {onBasculerDiscretion ? (
              <Cellule theme={theme} glyphe={discret ? '◉' : '◌'} titre="Masquer les montants" interrupteur={{ valeur: discret, onChanger: () => onBasculerDiscretion() }} testID="nav-discretion" />
            ) : null}
            {onVerrouiller ? (
              <Cellule
                theme={theme}
                glyphe="⏻"
                teinte={theme.critique}
                danger
                titre="Verrouiller"
                onPress={() => {
                  setPlus(false);
                  onVerrouiller();
                }}
                testID="nav-verrouiller"
              />
            ) : null}
          </GroupeCellules>
        ) : null}
      </FeuilleBasse>
    </View>
  );
}

function Lien({
  destination,
  onPress,
  actif,
  libelles,
  compact = false,
}: {
  destination: Destination;
  onPress(): void;
  actif: string;
  libelles: boolean;
  /** Pastille du bandeau horizontal. */
  compact?: boolean;
}) {
  const palette = usePalette();
  const selectionne = destination.cle === actif;
  return (
    <Pressable
      testID={`nav-${destination.cle}`}
      accessibilityRole="tab"
      accessibilityLabel={destination.libelle}
      accessibilityState={{ selected: selectionne }}
      onPress={onPress}
      style={({
        pressed,
        hovered,
      }: {
        pressed: boolean;
        hovered?: boolean;
      }) => [
        styles.lien,
        libelles ? styles.lienLarge : styles.lienEtroit,
        compact && styles.lienCompact,
        destination.sous && !compact && (libelles ? styles.sousLarge : styles.sousEtroit),
        {
          backgroundColor: selectionne
            ? palette.accentFond
            : pressed || hovered
            ? palette.surfaceHaute
            : 'transparent',
        },
      ]}
    >
      {destination.sous && libelles && !compact ? (
        <View style={[styles.filet, { borderColor: palette.bordure }]} />
      ) : null}
      <Text
        style={[
          styles.glyphe,
          destination.sous && styles.glypheSous,
          { color: selectionne ? palette.accent : palette.texteSecondaire },
        ]}
      >
        {destination.sous && compact ? '↳' : destination.glyphe}
      </Text>
      {libelles ? (
        <Text
          numberOfLines={1}
          style={{
            color: selectionne ? palette.accent : palette.texte,
            fontWeight: selectionne ? '700' : '500',
            fontSize: destination.sous ? 13 : 14,
            flexShrink: 1,
          }}
        >
          {destination.libelle}
        </Text>
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.petitLibelle,
            { color: selectionne ? palette.accent : palette.texteSecondaire },
          ]}
        >
          {destination.libelle}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rangee: { flex: 1, flexDirection: 'row' },
  barre: {
    borderRightWidth: 1,
    paddingVertical: ESPACEMENT.m,
    paddingHorizontal: ESPACEMENT.s,
    gap: ESPACEMENT.m,
  },
  marque: { fontSize: 19, fontWeight: '800', paddingHorizontal: ESPACEMENT.s },
  liens: { gap: 2 },
  lien: { borderRadius: RAYON.s, minHeight: 44 },
  lienLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.m - 4,
    paddingHorizontal: ESPACEMENT.m - 4,
  },
  lienEtroit: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  glyphe: { fontSize: 18, width: 22, textAlign: 'center' },
  glypheSous: { fontSize: 14, width: 16 },
  sousLarge: { marginLeft: 22, minHeight: 36, paddingHorizontal: ESPACEMENT.s },
  sousEtroit: { minHeight: 36, transform: [{ scale: 0.9 }] },
  filet: { width: 8, height: 14, borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: 4, marginTop: -10 },
  petitLibelle: { fontSize: 10.5 },
  pied: { borderTopWidth: 1, paddingTop: ESPACEMENT.s },
  contenu: { flex: 1 },
  enTete: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: ESPACEMENT.m, paddingTop: ESPACEMENT.s },
  colonne: { flex: 1 },
  bandeau: { borderBottomWidth: 1, paddingVertical: 6 },
  liensBandeau: { paddingHorizontal: ESPACEMENT.s, gap: 4, alignItems: 'center' },
  lienCompact: { minHeight: 38, paddingHorizontal: ESPACEMENT.s + 2, gap: 6 },
});
