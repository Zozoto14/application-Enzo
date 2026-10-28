/**
 * Système visuel de l'Esport : un petit jeu de jetons et de briques, posé sur
 * les 8 thèmes du hub (couleurs, polices et rayons viennent de `ThemeHub`).
 *
 *  - espacements généreux (multiples de 4) ; typographie claire : titre de
 *    page, sous-titre, titre de carte, texte, légende, chiffres ;
 *  - cartes à rayon et ombre cohérents ; badges et pastilles de statut ;
 *  - en-tête de page standard (titre, sous-titre, action principale à droite,
 *    actions secondaires dans un menu « ⋯ ») ;
 *  - états vides illustrés (pictogramme, phrase d'aide, action principale) et
 *    squelettes de chargement ;
 *  - identité de team : couleur stable tirée de son identifiant, logo ou
 *    monogramme (encre noire ou blanche choisie pour le contraste AA) ;
 *  - sous-onglets, filtres repliables et volet latéral (formulaires longs).
 *
 * Accessibilité : cibles de 44 px, rôles et libellés, jamais la couleur seule.
 */

import React, { useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { tt } from '../../ui/mobile/jetons';
import { contraste, encreSur } from '../contraste';
import { tr } from '../i18n';

/** État d'un Pressable sur le web (survol et focus clavier en plus). */
export type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };

// ------------------------------------------------------------------ Jetons

export const ESP = { xxs: 4, xs: 8, s: 12, m: 16, l: 20, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Tailles de texte (px). Le téléphone ne descend jamais sous 13 px pour une légende. */
export const TYPO = {
  titrePage: 28,
  titrePageMobile: 24,
  sousTitre: 15,
  titreCarte: 17,
  texte: 15,
  legende: 13,
  chiffre: 30,
  chiffreMobile: 26,
} as const;

/** Largeur au-delà de laquelle la mise en page passe en « PC » (barre latérale). */
export const LARGEUR_PC = 900;
/** Largeur maximale du contenu d'une page. */
export const LARGEUR_CONTENU = 1240;

export const rayonCarte = (theme: ThemeHub): number => Math.min(theme.rayonGrand, 18);
export const rayonControle = (theme: ThemeHub): number => (theme.id === 'sauge' ? 999 : Math.min(theme.rayonMoyen, 12));

/** Ombre douce des cartes : discrète en clair, plus profonde en sombre (où la bordure fait l'essentiel). */
export function ombre(theme: ThemeHub, haute = false): ViewStyle {
  if (theme.id === 'terminal') return {};
  return {
    shadowColor: '#000000',
    shadowOpacity: theme.sombre ? (haute ? 0.45 : 0.28) : haute ? 0.12 : 0.06,
    shadowRadius: haute ? 24 : 12,
    shadowOffset: { width: 0, height: haute ? 10 : 3 },
    elevation: haute ? 8 : 2,
  };
}

/** Tailles de texte : jamais sous 15 px en mode téléphone (système du mode téléphone, `tt`). */
export const texte = (theme: ThemeHub, taille: number = TYPO.texte) => ({ color: theme.texte, fontSize: tt(taille), ...police(theme.policeTexte) });
export const attenue = (theme: ThemeHub, taille: number = TYPO.legende) => ({ color: theme.attenue, fontSize: tt(taille), ...police(theme.policeTexte) });
export const titre = (theme: ThemeHub, taille: number) => ({
  color: theme.texte,
  fontSize: taille,
  fontWeight: theme.poidsTitre === '400' ? ('500' as const) : theme.poidsTitre,
  textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
  ...police(theme.policeTitre),
});
export const chiffre = (theme: ThemeHub, taille: number = TYPO.chiffre) => ({ color: theme.texte, fontSize: taille, fontWeight: '700' as const, ...police(theme.policeChiffres) });

// ------------------------------------------------------------------ Identité des teams

/** Teintes des teams : moyennes, lisibles en clair comme en sombre (bandeaux, monogrammes). */
export const COULEURS_TEAM = ['#5B8CFF', '#22A879', '#E8893A', '#9B6BF2', '#E25C74', '#1BA6B8', '#C99A1E', '#6C7BEA'] as const;

/** Couleur stable d'une team (tirée de son slug, ou de son id). */
export function couleurTeam(cle: string): string {
  let h = 0;
  for (let i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) % 1_000_003;
  return COULEURS_TEAM[h % COULEURS_TEAM.length];
}

/** Initiales d'un nom (« Faucons Valorant » → « FV »). */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  const lettres = mots.length >= 2 ? mots[0][0] + mots[1][0] : (mots[0] ?? '?').slice(0, 2);
  return lettres.toUpperCase();
}

/** Encre d'un texte posé sur une couleur (noir ou blanc, le plus contrasté). */
export const encre = encreSur;

/** Couleur de texte lisible (AA) sur la surface : la couleur elle-même si elle passe, sinon le texte du thème. */
export function couleurLisible(couleur: string, theme: ThemeHub): string {
  return contraste(couleur, theme.surface) >= 4.5 && contraste(couleur, theme.fond) >= 4.5 ? couleur : theme.texte;
}

export function AvatarTeam({ theme, team, taille = 40, testID }: { theme: ThemeHub; team: { nom: string; slug: string; logoUrl?: string | null }; taille?: number; testID?: string }) {
  const couleur = couleurTeam(team.slug);
  const rayon = theme.id === 'terminal' ? 0 : Math.round(taille * 0.28);
  if (team.logoUrl && /^https:\/\//.test(team.logoUrl)) {
    return (
      <Image
        testID={testID}
        source={{ uri: team.logoUrl }}
        accessibilityIgnoresInvertColors
        accessibilityLabel={tr('design.logo_de', { nom: team.nom })}
        style={{ width: taille, height: taille, borderRadius: rayon, backgroundColor: couleur }}
      />
    );
  }
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: taille, height: taille, borderRadius: rayon, backgroundColor: couleur, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: encre(couleur), fontSize: Math.round(taille * 0.38), fontWeight: '800', ...police(theme.policeTexte) }}>{initiales(team.nom)}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ Cartes

export function Carte({
  theme,
  children,
  style,
  testID,
  accent,
  onPress,
  libelle,
  dense,
  desactive,
}: {
  theme: ThemeHub;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Liseré coloré en haut de la carte (couleur de team, type d'événement…). */
  accent?: string;
  onPress?(): void;
  /** Nom accessible d'une carte cliquable. */
  libelle?: string;
  dense?: boolean;
  desactive?: boolean;
}) {
  const base: ViewStyle = {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.ligne,
    borderRadius: rayonCarte(theme),
    padding: dense ? ESP.m : ESP.l,
    gap: dense ? ESP.s : ESP.m,
    minWidth: 0,
    overflow: 'hidden',
    ...ombre(theme),
  };
  const liseret = accent ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: accent }} /> : null;
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={libelle}
        disabled={desactive}
        onPress={onPress}
        style={(etat: EtatPresse) => [
          base,
          (etat.hovered || etat.focused) && { borderColor: theme.accent },
          etat.pressed && { opacity: 0.85 },
          desactive && { opacity: 0.5 },
          style,
        ]}>
        {liseret}
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[base, style]}>
      {liseret}
      {children}
    </View>
  );
}

/** Titre d'une carte, avec une action discrète à droite. */
export function TitreCarte({ theme, titre: t, sous, droite, testID }: { theme: ThemeHub; titre: string; sous?: string; droite?: React.ReactNode; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', justifyContent: 'space-between' }} testID={testID}>
      <View style={{ gap: 2, flexShrink: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" style={{ ...texte(theme, TYPO.titreCarte), fontWeight: '700' }}>
          {t}
        </Text>
        {sous ? <Text style={attenue(theme)}>{sous}</Text> : null}
      </View>
      {droite}
    </View>
  );
}

// ------------------------------------------------------------------ En-tête de page

export interface ActionSecondaire {
  titre: string;
  onPress(): void;
  testID?: string;
  danger?: boolean;
}

export function EnTetePage({
  theme,
  titre: t,
  sous,
  action,
  actions,
  large = true,
  avant,
  testID,
}: {
  theme: ThemeHub;
  titre: string;
  sous?: string;
  /** Action principale, à droite (bouton plein). */
  action?: React.ReactNode;
  /** Actions secondaires, rangées dans un menu « ⋯ ». */
  actions?: ReadonlyArray<ActionSecondaire | false | null | undefined>;
  large?: boolean;
  /** Petite ligne au-dessus du titre (fil d'Ariane, surtitre). */
  avant?: React.ReactNode;
  testID?: string;
}) {
  const secondaires = (actions ?? []).filter((a): a is ActionSecondaire => Boolean(a));
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      {avant}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <View style={{ gap: ESP.xxs, flexShrink: 1, minWidth: 0, flexBasis: large ? undefined : '100%' }}>
          <Text accessibilityRole="header" style={titre(theme, large ? TYPO.titrePage : TYPO.titrePageMobile)}>
            {t}
          </Text>
          {sous ? <Text style={attenue(theme, TYPO.sousTitre)}>{sous}</Text> : null}
        </View>
        {action || secondaires.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
            {action}
            {secondaires.length ? <MenuActions theme={theme} actions={secondaires} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Menu « ⋯ » des actions secondaires. Il s'ouvre par-dessus la page (couche à
 * part, aucun conflit d'empilement avec les cartes voisines), sous le bouton ;
 * le voile ou Échap le referment.
 */
export function MenuActions({ theme, actions: brutes, libelle = tr('design.plus_d_actions'), testID = 'esport-menu', titreBouton = '⋯' }: { theme: ThemeHub; actions: ReadonlyArray<ActionSecondaire | false | null | undefined | 0 | ''>; libelle?: string; testID?: string; titreBouton?: string }) {
  const actions = brutes.filter((a): a is ActionSecondaire => Boolean(a));
  const [position, setPosition] = useState<{ x: number; y: number; l: number } | undefined>();
  const bouton = React.useRef<React.ComponentRef<typeof Pressable>>(null);
  const { width } = useWindowDimensions();
  const ouvrir = () => {
    const n = bouton.current as unknown as { measureInWindow?(cb: (x: number, y: number, l: number, h: number) => void): void } | null;
    // Ouvert tout de suite (coin haut droit), puis placé sous le bouton dès qu'il est mesuré.
    setPosition({ x: width - 60, y: 60, l: 44 });
    n?.measureInWindow?.((x, y, l, h) => setPosition({ x, y: y + h + 6, l }));
  };
  const largeurMenu = Math.min(260, width - 32);
  if (!actions.length) return null;
  return (
    <View>
      <Pressable
        ref={bouton}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={libelle}
        accessibilityState={{ expanded: Boolean(position) }}
        onPress={ouvrir}
        style={(etat: EtatPresse) => ({
          minWidth: 44,
          minHeight: 44,
          paddingHorizontal: titreBouton === '⋯' ? 0 : ESP.s,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: etat.hovered || position ? theme.accent : theme.ligne,
          backgroundColor: theme.surface,
          borderRadius: rayonControle(theme),
        })}>
        <Text style={{ color: theme.texte, fontSize: titreBouton === '⋯' ? 18 : 15, fontWeight: titreBouton === '⋯' ? '800' : '600', lineHeight: 20, ...police(theme.policeTexte) }}>{titreBouton}</Text>
      </Pressable>
      {position ? (
        <Modal transparent visible animationType="none" onRequestClose={() => setPosition(undefined)}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('design.fermer_le_menu')} onPress={() => setPosition(undefined)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View
            accessibilityRole="menu"
            testID={`${testID}-liste`}
            style={{
              position: 'absolute',
              top: position.y,
              left: Math.max(16, Math.min(position.x + position.l - largeurMenu, width - largeurMenu - 16)),
              width: largeurMenu,
              padding: ESP.xxs,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.ligne,
              borderRadius: rayonControle(theme) === 999 ? 18 : rayonControle(theme),
              ...ombre(theme, true),
            }}>
            {actions.map(a => (
            <Pressable
              key={a.titre}
              testID={a.testID}
              accessibilityRole="menuitem"
              onPress={() => {
                setPosition(undefined);
                a.onPress();
              }}
              style={(etat: EtatPresse) => ({
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: ESP.s,
                borderRadius: rayonControle(theme) === 999 ? 14 : Math.max(0, rayonControle(theme) - 4),
                backgroundColor: etat.hovered || etat.focused ? teinteTransparente(theme.accent, 0.12) : 'transparent',
              })}>
              <Text style={{ ...texte(theme), color: a.danger ? theme.critique : theme.texte, fontWeight: '600' }}>{a.titre}</Text>
            </Pressable>
          ))}
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Badges

export type Ton = 'neutre' | 'accent' | 'ok' | 'alerte' | 'critique';

const couleurTon = (theme: ThemeHub, ton: Ton): string =>
  ton === 'ok' ? theme.ok : ton === 'alerte' ? theme.alerte : ton === 'critique' ? theme.critique : ton === 'accent' ? theme.accent : theme.attenue;

/** Pastille de statut : point de couleur + texte (jamais la couleur seule). */
export function Badge({ theme, texte: t, ton = 'neutre', couleur, testID }: { theme: ThemeHub; texte: string; ton?: Ton; couleur?: string; testID?: string }) {
  const c = couleur ?? couleurTon(theme, ton);
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: theme.rayonGrand ? 999 : 0,
        backgroundColor: teinteTransparente(c, theme.sombre ? 0.18 : 0.12),
        borderWidth: 1,
        borderColor: teinteTransparente(c, 0.45),
      }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ color: theme.texte, fontSize: TYPO.legende, fontWeight: '600', ...police(theme.policeTexte) }} numberOfLines={1}>
        {t}
      </Text>
    </View>
  );
}

/** Compteur rond (nombre de non lus…). */
export function Compteur({ theme, n, testID }: { theme: ThemeHub; n: number; testID?: string }) {
  if (!n) return null;
  return (
    <View testID={testID} style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.surAccent, fontSize: 12, fontWeight: '800', ...police(theme.policeChiffres) }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ Chiffres clés

export function ChiffreCle({
  theme,
  libelle,
  valeur,
  detail,
  ton = 'neutre',
  glyphe,
  onPress,
  testID,
  testIDValeur,
  large = true,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  detail?: string;
  ton?: Ton;
  glyphe?: string;
  onPress?(): void;
  testID?: string;
  testIDValeur?: string;
  large?: boolean;
}) {
  const c = couleurTon(theme, ton === 'neutre' ? 'accent' : ton);
  return (
    <Carte
      theme={theme}
      testID={testID}
      onPress={onPress}
      libelle={onPress ? `${libelle} : ${valeur}` : undefined}
      dense={!large}
      style={{ flexGrow: 1, flexBasis: large ? 200 : 150, gap: ESP.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
        {glyphe ? (
          <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(c, 0.16) }}>
            <Text style={{ color: couleurLisible(c, theme), fontSize: 15 }}>{glyphe}</Text>
          </View>
        ) : null}
        <Text style={{ ...attenue(theme), flexShrink: 1 }} numberOfLines={2}>
          {libelle}
        </Text>
      </View>
      <Text testID={testIDValeur} style={{ ...chiffre(theme, large ? TYPO.chiffre : TYPO.chiffreMobile), color: ton === 'neutre' || ton === 'accent' ? theme.texte : couleurLisible(c, theme) }}>{valeur}</Text>
      {detail ? <Text style={attenue(theme)}>{detail}</Text> : null}
    </Carte>
  );
}

// ------------------------------------------------------------------ États vides et chargement

export function EtatVide({
  theme,
  glyphe = '◇',
  titre: t,
  texte: phrase,
  action,
  testID,
}: {
  theme: ThemeHub;
  glyphe?: string;
  titre: string;
  texte?: string;
  action?: { titre: string; onPress(): void; testID?: string };
  testID?: string;
}) {
  return (
    <View testID={testID} style={{ alignItems: 'center', gap: ESP.s, paddingVertical: ESP.xxl, paddingHorizontal: ESP.m }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.accent, 0.12) }}>
        <Text style={{ color: couleurLisible(theme.accent, theme), fontSize: 24 }}>{glyphe}</Text>
      </View>
      <Text style={{ ...texte(theme, TYPO.titreCarte), fontWeight: '700', textAlign: 'center' }}>{t}</Text>
      {phrase ? <Text style={{ ...attenue(theme, TYPO.texte), textAlign: 'center', maxWidth: 460 }}>{phrase}</Text> : null}
      {action ? <BoutonHub theme={theme} titre={action.titre} variante="plein" onPress={action.onPress} testID={action.testID} /> : null}
    </View>
  );
}

/** Squelette de chargement : quelques barres pâles, annoncé « Chargement… ». */
export function Squelette({ theme, lignes = 3, testID, hauteur = 14 }: { theme: ThemeHub; lignes?: number; testID?: string; hauteur?: number }) {
  return (
    <View testID={testID} accessibilityLabel={tr('journal.chargement')} accessibilityRole="progressbar" style={{ gap: ESP.s }}>
      {Array.from({ length: lignes }, (_, i) => (
        <View key={i} style={{ height: hauteur, width: `${[92, 76, 84, 60, 70][i % 5]}%`, borderRadius: 6, backgroundColor: teinteTransparente(theme.attenue, theme.sombre ? 0.16 : 0.12) }} />
      ))}
    </View>
  );
}

export function SqueletteCartes({ theme, n = 3, large = true }: { theme: ThemeHub; n?: number; large?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.m }}>
      {Array.from({ length: n }, (_, i) => (
        <Carte key={i} theme={theme} style={{ flexGrow: 1, flexBasis: large ? 300 : '100%' }}>
          <Squelette theme={theme} lignes={3} />
        </Carte>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Grille

/** Grille de cartes qui passe à la ligne : `min` = largeur minimale d'une carte. */
export function Grille({ children, min = 300, gap = ESP.m, testID, style }: { children: React.ReactNode; min?: number; gap?: number; testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View testID={testID} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'stretch' }, style]}>
      {React.Children.map(children, c => (c ? <View style={{ flexGrow: 1, flexBasis: min, minWidth: 0, maxWidth: '100%' }}>{c}</View> : null))}
    </View>
  );
}

// ------------------------------------------------------------------ Sous-onglets

export interface EntreeOngletEsport {
  id: string;
  libelle: string;
  /** Nom accessible complet (le libellé visible peut être abrégé). */
  description?: string;
  bientot?: boolean;
}

/** Sous-onglets d'une section : soulignés, 44 px, rôle « tab ». Sur téléphone, parts égales. */
export function Onglets({
  theme,
  entrees,
  actif,
  onChoisir,
  testID,
  prefixe,
  pleineLargeur,
  defilant,
}: {
  theme: ThemeHub;
  entrees: readonly EntreeOngletEsport[];
  actif: string;
  onChoisir(id: string): void;
  testID?: string;
  /** testID de chaque onglet : `${prefixe}-${id}` (« : » remplacé par « - »). */
  prefixe: string;
  pleineLargeur?: boolean;
  /** Trop d'onglets pour la largeur (iPhone) : la rangée défile, les libellés restent entiers. */
  defilant?: boolean;
}) {
  const rangee = (
    // Sans défilement (PC), la rangée passe à la ligne plutôt que de couper les derniers onglets (l'espace CM en a 12).
    <View testID={testID} accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: defilant ? 'nowrap' : 'wrap', borderBottomWidth: 1, borderBottomColor: theme.ligne, gap: pleineLargeur ? 0 : ESP.xs, minWidth: '100%' }}>
      {entrees.map(e => {
        const choisi = e.id === actif;
        return (
          <Pressable
            key={e.id}
            testID={`${prefixe}-${e.id.replace(':', '-')}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: choisi }}
            aria-selected={choisi}
            accessibilityLabel={`${e.description ?? e.libelle}${e.bientot ? tr('design.bientot') : ''}`}
            onPress={() => onChoisir(e.id)}
            style={(etat: EtatPresse) => ({
              flexGrow: pleineLargeur ? 1 : 0,
              flexBasis: pleineLargeur ? 0 : undefined,
              minHeight: 44,
              paddingHorizontal: pleineLargeur ? ESP.xxs : ESP.s,
              alignItems: 'center',
              justifyContent: 'center',
              borderBottomWidth: 3,
              marginBottom: -1,
              borderBottomColor: choisi ? theme.accent : etat.hovered || etat.focused ? theme.ligne : 'transparent',
            })}>
            <Text
              numberOfLines={1}
              style={{ color: choisi ? theme.texte : theme.attenue, fontSize: 15, fontWeight: choisi ? '700' : '500', ...police(theme.policeTexte) }}>
              {e.libelle}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  return defilant ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      {rangee}
    </ScrollView>
  ) : (
    rangee
  );
}

// ------------------------------------------------------------------ Filtres repliables

/** Bloc repliable (filtres…) : un bouton « Filtres · 2 actifs » ouvre et ferme le contenu. */
export function Pliable({
  theme,
  titre: t,
  resume,
  ouvertParDefaut = false,
  children,
  testID,
}: {
  theme: ThemeHub;
  titre: string;
  /** Résumé affiché à côté du titre quand c'est fermé (« 2 actifs »). */
  resume?: string;
  ouvertParDefaut?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  return (
    <View style={{ gap: ESP.s }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: ouvert }}
        accessibilityLabel={`${t}${resume ? ` (${resume})` : ''}`}
        onPress={() => setOuvert(o => !o)}
        style={(etat: EtatPresse) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: ESP.xs,
          alignSelf: 'flex-start',
          minHeight: 44,
          paddingHorizontal: ESP.s,
          borderWidth: 1,
          borderColor: etat.hovered || ouvert ? theme.accent : theme.ligne,
          borderRadius: rayonControle(theme),
          backgroundColor: ouvert ? teinteTransparente(theme.accent, 0.1) : theme.surface,
        })}>
        <Text style={{ ...texte(theme), fontWeight: '600' }}>{t}</Text>
        {resume ? <Text style={attenue(theme)}>{`· ${resume}`}</Text> : null}
        <Text style={{ color: theme.attenue, fontSize: 12 }}>{ouvert ? '▲' : '▼'}</Text>
      </Pressable>
      {ouvert ? <View style={{ gap: ESP.s }}>{children}</View> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Volet latéral

/**
 * Volet latéral (formulaires longs, détail) : sur PC, une feuille à droite
 * par-dessus la page (Échap ou le voile la ferment) ; sur téléphone, le
 * contenu prend tout l'écran (l'appelant le rend à la place de la page).
 */
export function Volet({ theme, visible, titre: t, onFermer, children, testID, largeur = 560 }: { theme: ThemeHub; visible: boolean; titre: string; onFermer(): void; children: React.ReactNode; testID?: string; largeur?: number }) {
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onFermer}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('design.fermer_le_volet')} onPress={onFermer} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' }} />
        <View
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={t}
          style={{ width: largeur, maxWidth: '100%', backgroundColor: theme.fond, borderLeftWidth: 1, borderLeftColor: theme.ligne, ...ombre(theme, true) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESP.s, paddingHorizontal: ESP.xl, paddingVertical: ESP.m, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
            <Text accessibilityRole="header" style={titre(theme, 20)} numberOfLines={1}>
              {t}
            </Text>
            <Pressable
              testID={testID ? `${testID}-fermer` : undefined}
              accessibilityRole="button"
              accessibilityLabel={tr('discord.fermer')}
              onPress={onFermer}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.texte, fontSize: 22 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: ESP.xl, gap: ESP.m }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Surface web uniquement : vrai sur le site et l'app PC. */
export const surWeb = Platform.OS === 'web';
