/** Petits composants communs aux écrans de Tsuzuku (thème du hub, accent du mode). */

import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { Entree, Statut } from '../moteur/bibliotheque';
import { useTsuzuku } from './contexte';

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };

export function styleTitre(theme: ThemeHub, taille: number): TextStyle {
  return {
    color: theme.texte,
    fontSize: taille,
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? 'uppercase' : 'none',
    ...police(theme.policeTitre),
  };
}

export const styleTexte = (theme: ThemeHub, taille = 14): TextStyle => ({ color: theme.texte, fontSize: taille, ...police(theme.policeTexte) });
export const styleAttenue = (theme: ThemeHub, taille = 13): TextStyle => ({ color: theme.attenue, fontSize: taille, ...police(theme.policeTexte) });

export function Titre({ children, taille = 22, testID }: { children: React.ReactNode; taille?: number; testID?: string }) {
  const { theme } = useTsuzuku();
  return (
    <Text testID={testID} accessibilityRole="header" style={styleTitre(theme, taille)}>
      {children}
    </Text>
  );
}

export function Bouton({
  titre,
  onPress,
  variante = 'normal',
  desactive,
  testID,
  libelle,
  style,
}: {
  titre: string;
  onPress(): void;
  variante?: 'normal' | 'plein' | 'danger';
  desactive?: boolean;
  testID?: string;
  libelle?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTsuzuku();
  const plein = variante === 'plein';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle ?? titre}
      accessibilityState={{ disabled: Boolean(desactive) }}
      disabled={desactive}
      onPress={onPress}
      style={(e: EtatPresse) => [
        st.bouton,
        {
          borderRadius: Math.min(theme.rayonMoyen, 10),
          backgroundColor: plein ? theme.accent : theme.surface,
          borderColor: plein ? theme.accent : variante === 'danger' ? theme.critique : e.focused || e.hovered ? theme.accent : theme.ligne,
          opacity: desactive ? 0.45 : e.pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <Text style={{ color: plein ? theme.surAccent : variante === 'danger' ? theme.critique : theme.texte, fontWeight: '600', fontSize: 14, ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
}

export function Puce({ titre, actif, onPress, testID }: { titre: string; actif?: boolean; onPress(): void; testID?: string }) {
  const { theme } = useTsuzuku();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(actif) }}
      accessibilityLabel={titre}
      onPress={onPress}
      style={[st.puce, { borderRadius: theme.rayonGrand > 8 ? 999 : theme.rayonMoyen, backgroundColor: actif ? theme.accent : 'transparent', borderColor: actif ? theme.accent : theme.ligne }]}>
      <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
}

export function Champ({
  libelle,
  valeur,
  onChanger,
  testID,
  placeholder,
  multiligne,
  secret,
  onValider,
  style,
  cacherLibelle,
}: {
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID?: string;
  placeholder?: string;
  multiligne?: boolean;
  secret?: boolean;
  onValider?(): void;
  style?: StyleProp<ViewStyle>;
  cacherLibelle?: boolean;
}) {
  const { theme } = useTsuzuku();
  return (
    <View style={[{ gap: 4 }, style]}>
      {cacherLibelle ? null : <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelle}</Text>}
      <TextInput
        testID={testID}
        accessibilityLabel={libelle}
        value={valeur}
        onChangeText={onChanger}
        placeholder={placeholder}
        placeholderTextColor={theme.attenue}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secret}
        multiline={multiligne}
        returnKeyType={onValider ? 'search' : undefined}
        onSubmitEditing={onValider}
        onKeyPress={onValider && !multiligne ? (e: { nativeEvent: { key: string } }) => (e.nativeEvent.key === 'Enter' ? onValider() : undefined) : undefined}
        style={[st.champ, { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) }, multiligne && { minHeight: 110, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function Avis({ texte, genre = 'info', testID }: { texte: string; genre?: 'ok' | 'alerte' | 'critique' | 'info'; testID?: string }) {
  const { theme } = useTsuzuku();
  const couleur = genre === 'ok' ? theme.ok : genre === 'alerte' ? theme.alerte : genre === 'critique' ? theme.critique : theme.accent;
  return (
    <Text
      testID={testID}
      accessibilityLiveRegion="polite"
      accessibilityRole={genre === 'critique' ? 'alert' : undefined}
      style={[st.avis, { color: theme.texte, borderLeftColor: couleur, backgroundColor: teinteTransparente(couleur, 0.14), ...police(theme.policeTexte) }]}>
      {texte}
    </Text>
  );
}

/** Chargement, erreur (avec « Réessayer ») ou contenu. */
export function Etat({ enCours, erreur, onRecharger, vide, children }: { enCours: boolean; erreur?: string; onRecharger?(): void; vide?: string; children?: React.ReactNode }) {
  const { theme } = useTsuzuku();
  if (erreur) {
    return (
      <View style={{ gap: 10 }} testID="etat-erreur">
        <Avis genre="critique" texte={erreur} />
        {onRecharger ? <Bouton titre="Réessayer" onPress={onRecharger} testID="etat-reessayer" style={{ alignSelf: 'flex-start' }} /> : null}
      </View>
    );
  }
  if (enCours && !children) {
    return (
      <View style={st.centre} testID="etat-chargement" accessibilityLabel="Chargement" accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.accent} />
        <Text style={styleAttenue(theme)}>Chargement…</Text>
      </View>
    );
  }
  if (vide) {
    return <Text style={styleAttenue(theme, 14)}>{vide}</Text>;
  }
  return <>{children}</>;
}

// ------------------------------------------------------------------ Affiches

export interface ElementCarte {
  cle: string;
  titre: string;
  image?: string | null;
  sousTitre?: string;
  /** Pastille sur l'affiche (« Vu », « En cours »…). */
  badge?: string;
  onPress(): void;
}

export const LIBELLE_STATUT: Record<Statut, string> = {
  a_voir: 'À voir',
  en_cours: 'En cours',
  a_reprendre: 'À reprendre',
  vu: 'Vu',
  vu_ailleurs: 'Vu ailleurs',
};

const LARGEUR_CARTE = 132;

export function Affiche({ e, largeur = LARGEUR_CARTE }: { e: ElementCarte; largeur?: number }) {
  const { theme, mode } = useTsuzuku();
  const hauteur = Math.round(largeur * 1.45);
  return (
    <Pressable
      testID={`carte-${e.cle}`}
      accessibilityRole="button"
      accessibilityLabel={`${e.titre}${e.badge ? `, ${e.badge}` : ''}${e.sousTitre ? `, ${e.sousTitre}` : ''}`}
      onPress={e.onPress}
      style={(p: EtatPresse) => [{ width: largeur, opacity: p.pressed ? 0.8 : 1 }]}>
      <View
        style={{
          width: largeur,
          height: hauteur,
          borderRadius: theme.rayonMoyen,
          overflow: 'hidden',
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: mode === 'movie' ? theme.attenue : theme.ligne,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {e.image ? (
          <Image source={{ uri: e.image }} accessibilityIgnoresInvertColors style={{ width: largeur, height: hauteur }} resizeMode="cover" />
        ) : (
          <Text style={{ color: theme.attenue, fontSize: 34, fontWeight: '700' }}>{e.titre.slice(0, 1).toUpperCase()}</Text>
        )}
        {e.badge ? (
          <View style={[st.badge, { backgroundColor: theme.accent, borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
            <Text style={{ color: theme.surAccent, fontSize: 11, fontWeight: '700' }}>{e.badge}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[styleTexte(theme, 13), { fontWeight: '600', marginTop: 6 }]}>
        {e.titre}
      </Text>
      {e.sousTitre ? (
        <Text numberOfLines={1} style={styleAttenue(theme, 12)}>
          {e.sousTitre}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Rangee({ titre, elements, testID }: { titre: string; elements: ElementCarte[]; testID?: string }) {
  const { theme } = useTsuzuku();
  if (!elements.length) {
    return null;
  }
  return (
    <View style={{ gap: 10 }} testID={testID}>
      <Text accessibilityRole="header" style={styleTitre(theme, 18)}>
        {titre}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {elements.map(e => (
          <Affiche key={e.cle} e={e} />
        ))}
      </ScrollView>
    </View>
  );
}

/** Grille d'affiches, à 2 colonnes sur téléphone (390 px). */
export function Grille({ elements, testID }: { elements: ElementCarte[]; testID?: string }) {
  const { large } = useTsuzuku();
  return (
    <View style={[st.grille, { gap: 14 }]} testID={testID}>
      {elements.map(e => (
        <View key={e.cle} style={{ width: large ? LARGEUR_CARTE : '47%', flexGrow: large ? 0 : 1, maxWidth: large ? LARGEUR_CARTE : 200 }}>
          <Affiche e={e} largeur={large ? LARGEUR_CARTE : 158} />
        </View>
      ))}
    </View>
  );
}

export function elementDepuisEntree(e: Entree, aller: () => void): ElementCarte {
  return {
    cle: `${e.kind}-${e.id}`,
    titre: e.title,
    image: e.image,
    sousTitre: e.kind === 'anime' && e.currentEpisode ? `Ép. ${e.currentEpisode}${e.totalEpisodes ? ` / ${e.totalEpisodes}` : ''}` : e.year ? String(e.year) : undefined,
    badge: LIBELLE_STATUT[e.status],
    onPress: aller,
  };
}

const st = StyleSheet.create({
  bouton: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  puce: { minHeight: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  champ: { minHeight: 44, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  avis: { borderLeftWidth: 4, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  centre: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  grille: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 3 },
});
