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
  hauteur,
  lectureSeule,
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
  /** Hauteur minimale d'un champ multiligne (110 px par défaut). */
  hauteur?: number;
  /** Texte à lire et copier, pas à modifier. */
  lectureSeule?: boolean;
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
        editable={lectureSeule ? false : undefined}
        returnKeyType={onValider ? 'search' : undefined}
        onSubmitEditing={onValider}
        onKeyPress={onValider && !multiligne ? (e: { nativeEvent: { key: string } }) => (e.nativeEvent.key === 'Enter' ? onValider() : undefined) : undefined}
        style={[st.champ, { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) }, multiligne && { minHeight: hauteur ?? 110, textAlignVertical: 'top' }]}
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
export function Etat({ enCours, erreur, onRecharger, vide, children, squelette }: { enCours: boolean; erreur?: string; onRecharger?(): void; vide?: string; children?: React.ReactNode; squelette?: 'affiches' | 'heros' }) {
  const { theme } = useTsuzuku();
  if (erreur) {
    return (
      <View style={{ gap: 10 }} testID="etat-erreur">
        <Avis genre="critique" texte={erreur} />
        {onRecharger ? <Bouton titre="Réessayer" onPress={onRecharger} testID="etat-reessayer" style={{ alignSelf: 'flex-start' }} /> : null}
      </View>
    );
  }
  if (enCours && squelette) {
    return <SquelettesAffiches heros={squelette === 'heros'} />;
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

// ------------------------------------------------------------------ Titres de section, squelettes, états vides

/** Titre de section : filet d'accent + titre + action à droite (comme l'ancienne version). */
export function TitreSection({ children, action, testID }: { children: React.ReactNode; action?: React.ReactNode; testID?: string }) {
  const { theme } = useTsuzuku();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} testID={testID}>
      <View style={{ width: 4, height: 20, borderRadius: 999, backgroundColor: theme.accent }} />
      <Text accessibilityRole="header" style={[styleTitre(theme, 19), { flexShrink: 1 }]}>
        {children}
      </Text>
      {action ? <View style={{ marginLeft: 'auto' }}>{action}</View> : null}
    </View>
  );
}

/** Bloc gris pulsé (squelette de chargement). */
export function Squelette({ largeur, hauteur, rayon, style }: { largeur: number | `${number}%`; hauteur: number; rayon?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTsuzuku();
  return <View style={[{ width: largeur, height: hauteur, borderRadius: rayon ?? theme.rayonMoyen, backgroundColor: teinteTransparente(theme.texte, theme.sombre ? 0.08 : 0.07) }, style]} />;
}

/** Squelettes d'une rangée d'affiches (et du bandeau « à la une » si `heros`). */
export function SquelettesAffiches({ nombre = 6, heros = false }: { nombre?: number; heros?: boolean }) {
  const { large } = useTsuzuku();
  return (
    <View style={{ gap: 22 }} testID="etat-chargement" accessibilityLabel="Chargement" accessibilityLiveRegion="polite">
      {heros ? <Squelette largeur="100%" hauteur={large ? 360 : 300} rayon={16} /> : null}
      <Squelette largeur={180} hauteur={20} rayon={6} />
      <View style={{ flexDirection: 'row', gap: 12, overflow: 'hidden' }}>
        {Array.from({ length: nombre }, (_, i) => (
          <View key={i} style={{ gap: 8 }}>
            <Squelette largeur={LARGEUR_CARTE} hauteur={Math.round(LARGEUR_CARTE * 1.5)} />
            <Squelette largeur={LARGEUR_CARTE * 0.8} hauteur={11} rayon={4} />
            <Squelette largeur={LARGEUR_CARTE * 0.45} hauteur={11} rayon={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** État vide : pictogramme, titre, aide, action facultative. */
export function EtatVide({ icone = '◌', titre, children, action, testID = 'etat-vide' }: { icone?: string; titre: string; children?: React.ReactNode; action?: React.ReactNode; testID?: string }) {
  const { theme } = useTsuzuku();
  return (
    <View testID={testID} style={{ alignSelf: 'center', width: '100%', maxWidth: 460, alignItems: 'center', gap: 10, padding: 26, borderRadius: Math.max(theme.rayonGrand, 12), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
      <View style={{ width: 48, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.texte, 0.08) }}>
        <Text style={{ color: theme.attenue, fontSize: 22 }}>{icone}</Text>
      </View>
      <Text style={[styleTitre(theme, 17), { textAlign: 'center' }]}>{titre}</Text>
      {children ? <Text style={[styleAttenue(theme, 14), { textAlign: 'center', lineHeight: 20 }]}>{children}</Text> : null}
      {action}
    </View>
  );
}

// ------------------------------------------------------------------ Affiches

export interface ElementCarte {
  cle: string;
  titre: string;
  image?: string | null;
  sousTitre?: string;
  /** Pastille de statut (« En cours », « À voir »…) en haut à droite. */
  badge?: string;
  /** Statut dans la bibliothèque : décide de la pastille et du badge « Déjà vu » / « Vu ailleurs ». */
  statut?: Statut | null;
  /** Note du catalogue (sur 10). */
  score?: number | null;
  /** Note personnelle (sur 10). */
  note?: number | null;
  favori?: boolean;
  /** Progression 0–1 (barre en bas de l'affiche). */
  progression?: number;
  /** Ligne d'accent (« Épisode 5 / 12 »). */
  ligneAccent?: string;
  onPress(): void;
}

export const LIBELLE_STATUT: Record<Statut, string> = {
  a_voir: 'À voir',
  en_cours: 'En cours',
  a_reprendre: 'À reprendre',
  vu: 'Vu',
  vu_ailleurs: 'Vu ailleurs',
};

/** Couleurs des statuts, tirées du thème du hub (lisibles dans les 8 thèmes). */
export function couleurStatut(theme: ThemeHub, statut: Statut): string {
  switch (statut) {
    case 'en_cours':
      return theme.accent;
    case 'a_reprendre':
      return theme.alerte;
    case 'vu':
      return theme.ok;
    case 'vu_ailleurs':
      return theme.teintes.admin;
    default:
      return theme.teintes.anime === theme.accent ? theme.attenue : theme.teintes.anime;
  }
}

/** Pastille de statut (contour teinté), comme l'ancienne version. */
export function PastilleStatut({ statut, petite }: { statut: Statut; petite?: boolean }) {
  const { theme } = useTsuzuku();
  const c = couleurStatut(theme, statut);
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: petite ? 7 : 10, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: teinteTransparente(c, 0.55), backgroundColor: theme.sombre ? teinteTransparente(theme.fond, 0.85) : teinteTransparente(theme.surface, 0.92) }}>
      <Text style={{ color: c, fontSize: petite ? 10 : 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', ...police(theme.policeTexte) }}>{LIBELLE_STATUT[statut]}</Text>
    </View>
  );
}

/** Badge « ✓ Déjà vu » (vert) ou « ◉ Vu ailleurs » (violet). */
export function BadgeVu({ ailleurs, testID = 'badge-deja-vu' }: { ailleurs?: boolean; testID?: string }) {
  const { theme } = useTsuzuku();
  const fond = ailleurs ? theme.teintes.admin : theme.ok;
  return (
    <View testID={testID} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: fond }}>
      <Text style={{ color: texteLisibleSur(fond), fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', ...police(theme.policeTexte) }}>{ailleurs ? '◉ Vu ailleurs' : '✓ Déjà vu'}</Text>
    </View>
  );
}

function texteLisibleSur(hexa: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hexa);
  if (!m) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#0B0F17' : '#FFFFFF';
}

const LARGEUR_CARTE = 150;

export function Affiche({ e, largeur = LARGEUR_CARTE }: { e: ElementCarte; largeur?: number }) {
  const { theme } = useTsuzuku();
  const hauteur = Math.round(largeur * 1.5);
  const vu = e.statut === 'vu' || e.statut === 'vu_ailleurs';
  const rayon = Math.max(theme.rayonMoyen, 4);
  return (
    <Pressable
      testID={`carte-${e.cle}`}
      accessibilityRole="button"
      accessibilityLabel={`${e.titre}${e.badge ? `, ${e.badge}` : ''}${e.sousTitre ? `, ${e.sousTitre}` : ''}`}
      onPress={e.onPress}
      style={(p: EtatPresse) => [
        {
          width: largeur,
          borderRadius: rayon + 2,
          overflow: 'hidden',
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: p.hovered || p.focused ? theme.accent : theme.ligne,
          opacity: p.pressed ? 0.85 : 1,
          transform: [{ translateY: p.hovered ? -2 : 0 }],
        },
      ]}>
      <View style={{ width: largeur, height: hauteur, backgroundColor: teinteTransparente(theme.texte, 0.06), alignItems: 'center', justifyContent: 'center' }}>
        {e.image ? (
          <Image source={{ uri: e.image }} accessibilityIgnoresInvertColors style={{ width: largeur, height: hauteur }} resizeMode="cover" />
        ) : (
          <Text numberOfLines={3} style={[styleTitre(theme, 14), { color: theme.attenue, textAlign: 'center', paddingHorizontal: 10 }]}>{e.titre}</Text>
        )}
        {/* Fondu en bas de l'affiche : le badge « déjà vu » reste lisible. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, backgroundColor: 'rgba(0,0,0,0.18)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 12, backgroundColor: 'rgba(0,0,0,0.18)' }} />
        <View style={[st.coin, { left: 6, alignItems: 'flex-start' }]}>
          {e.score ? (
            <View style={[st.puceAffiche, { backgroundColor: teinteTransparente(theme.fond, 0.88) }]}>
              <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800' }}>☆ {e.score.toFixed(1)}</Text>
            </View>
          ) : null}
          {e.note ? (
            <View style={[st.puceAffiche, { backgroundColor: theme.accent }]}>
              <Text style={{ color: theme.surAccent, fontSize: 11, fontWeight: '800' }}>{e.note}/10</Text>
            </View>
          ) : null}
        </View>
        <View style={[st.coin, { right: 6, flexDirection: 'row', alignItems: 'center' }]}>
          {e.favori ? (
            <View accessibilityLabel="Favori" style={[st.puceAffiche, { backgroundColor: teinteTransparente(theme.fond, 0.88), paddingHorizontal: 5 }]}>
              <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800' }}>★</Text>
            </View>
          ) : null}
          {e.statut && !vu ? <PastilleStatut statut={e.statut} petite /> : null}
        </View>
        {vu ? (
          <View style={{ position: 'absolute', left: 6, bottom: 10 }}>
            <BadgeVu ailleurs={e.statut === 'vu_ailleurs'} />
          </View>
        ) : null}
        {e.progression && e.progression > 0 ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: teinteTransparente(theme.texte, 0.15) }}>
            <View style={{ width: `${Math.min(100, Math.round(e.progression * 100))}%`, height: 4, backgroundColor: theme.accent }} />
          </View>
        ) : null}
      </View>
      <View style={{ padding: 10, gap: 3 }}>
        <Text numberOfLines={2} style={[styleTexte(theme, 13), { fontWeight: '700', lineHeight: 17 }]}>
          {e.titre}
        </Text>
        {e.sousTitre ? (
          <Text numberOfLines={1} style={styleAttenue(theme, 12)}>
            {e.sousTitre}
          </Text>
        ) : null}
        {e.ligneAccent ? (
          <Text numberOfLines={1} style={{ color: theme.accent, fontSize: 12, fontWeight: '700', ...police(theme.policeTexte) }}>
            {e.ligneAccent}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Rangée défilante d'affiches, avec flèches sur grand écran. */
export function Rangee({ titre, elements, testID }: { titre: string; elements: ElementCarte[]; testID?: string }) {
  const { theme, large } = useTsuzuku();
  const defil = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const x = React.useRef(0);
  if (!elements.length) {
    return null;
  }
  const pousser = (sens: number) => {
    x.current = Math.max(0, x.current + sens * (LARGEUR_CARTE + 12) * 4);
    defil.current?.scrollTo({ x: x.current, animated: true });
  };
  const fleche = (sens: number, texte: string, libelle: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={libelle} onPress={() => pousser(sens)} style={{ width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
      <Text style={{ color: theme.texte, fontSize: 16, fontWeight: '700' }}>{texte}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }} testID={testID} accessibilityLabel={titre}>
      <TitreSection action={large && elements.length > 4 ? <View style={{ flexDirection: 'row', gap: 6 }}>{fleche(-1, '‹', 'Défiler vers la gauche')}{fleche(1, '›', 'Défiler vers la droite')}</View> : undefined}>{titre}</TitreSection>
      <ScrollView ref={defil} horizontal showsHorizontalScrollIndicator={false} onScroll={ev => (x.current = ev.nativeEvent.contentOffset.x)} scrollEventThrottle={64} contentContainerStyle={{ gap: 12, paddingRight: 16, paddingVertical: 2, alignItems: 'flex-start' }}>
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

/** Tuiles larges « Reprendre » : affiche, épisode suivant, progression, bouton de lecture. */
export function RangeeReprendre({ titre, entrees, onLire, testID = 'rangee-reprendre' }: { titre: string; entrees: Entree[]; onLire(e: Entree): void; testID?: string }) {
  const { theme } = useTsuzuku();
  if (!entrees.length) return null;
  return (
    <View style={{ gap: 12 }} testID={testID} accessibilityLabel={titre}>
      <TitreSection>{titre}</TitreSection>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {entrees.map(e => {
          const film = e.kind === 'movie';
          const suivant = (e.currentEpisode || 0) + 1;
          const pct = !film && e.totalEpisodes ? Math.min(1, (e.currentEpisode || 0) / e.totalEpisodes) : 0;
          return (
            <Pressable
              key={`${e.kind}-${e.id}`}
              testID={`reprendre-${e.kind}-${e.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${film ? 'Regarder' : 'Reprendre'} ${e.title}${film ? '' : `, épisode ${suivant}`}`}
              onPress={() => onLire(e)}
              style={(p: EtatPresse) => ({ width: 300, flexDirection: 'row', gap: 12, padding: 10, borderRadius: Math.max(theme.rayonMoyen, 6) + 4, borderWidth: 1, borderColor: p.hovered || p.focused ? theme.accent : theme.ligne, backgroundColor: theme.surface, opacity: p.pressed ? 0.85 : 1 })}>
              <View style={{ width: 76, height: 112, borderRadius: Math.max(theme.rayonMoyen, 4), overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.06) }}>
                {e.image ? <Image source={{ uri: e.image }} accessibilityIgnoresInvertColors style={{ width: 76, height: 112 }} resizeMode="cover" /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 2 }}>
                <Text numberOfLines={2} style={[styleTexte(theme, 14), { fontWeight: '700', lineHeight: 18 }]}>
                  {e.title}
                </Text>
                <Text style={{ marginTop: 4, color: theme.accent, fontSize: 12, fontWeight: '700', ...police(theme.policeTexte) }}>{film ? 'Prêt à regarder' : `Épisode ${suivant}${e.totalEpisodes ? ` / ${e.totalEpisodes}` : ''}`}</Text>
                {pct > 0 ? (
                  <View style={{ marginTop: 8, height: 4, borderRadius: 999, overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.12) }}>
                    <View style={{ width: `${Math.round(pct * 100)}%`, height: 4, backgroundColor: theme.accent }} />
                  </View>
                ) : null}
                <View style={{ marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent }}>
                    <Text style={{ color: theme.surAccent, fontSize: 10, fontWeight: '800' }}>▶</Text>
                  </View>
                  <Text style={[styleTexte(theme, 12), { fontWeight: '800' }]}>{film ? 'Regarder' : 'Reprendre'}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function elementDepuisEntree(e: Entree, aller: () => void): ElementCarte {
  const total = e.kind === 'anime' ? e.totalEpisodes : null;
  return {
    cle: `${e.kind}-${e.id}`,
    titre: e.title,
    image: e.image,
    sousTitre: [e.year, total ? `${total} ép.` : null, e.kind === 'movie' && e.runtime ? `${e.runtime} min` : null].filter(Boolean).join(' · ') || undefined,
    badge: LIBELLE_STATUT[e.status],
    statut: e.status,
    note: e.rating,
    favori: e.favorite,
    progression: total ? Math.min(1, (e.currentEpisode || 0) / total) : 0,
    ligneAccent: e.kind === 'anime' ? `Épisode ${e.currentEpisode || 0}${total ? ` / ${total}` : ''}` : undefined,
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
  coin: { position: 'absolute', top: 6, gap: 4 },
  puceAffiche: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
});
