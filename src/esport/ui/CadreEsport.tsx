/**
 * Cadre de navigation de l'Esport.
 *
 *  - PC et iPad paysage (≥ 900 px) : barre latérale. En haut, l'Esport
 *    (Dashboard · Teams · Membres, et Statistiques pour le Fondateur) ; dans une team, en dessous, la team
 *    (logo, nom, sélecteur rapide) et ses sections.
 *  - iPhone et petites fenêtres : barre d'onglets en bas. Dashboard · Teams ·
 *    Membres au premier niveau ; les sections de la team dans une team.
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../hub/themes';
import { BarreOnglets } from '../../ui/mobile/BarreOnglets';
import { Compteur, ESP, attenue, rayonControle, texte, type EtatPresse } from './design';
import { tr } from '../i18n';
import { BandeauTranscriptions } from './medias/Transcription';

export type OngletEsport = 'dashboard' | 'teams' | 'membres' | 'statistiques' | 'jeux';

export const NAV_ESPORT: ReadonlyArray<{ cle: OngletEsport; libelle: string; glyphe: string; description: string }> = [
  { cle: 'dashboard', get libelle() {
      return tr('dashboard.dashboard');
    }, glyphe: '▦', get description() {
      return tr('cadreEsport.dashboard_toutes_vos_teams');
    } },
  { cle: 'teams', get libelle() {
      return tr('dashboard.teams');
    }, glyphe: '◆', get description() {
      return tr('cadreEsport.teams_la_liste_la');
    } },
  { cle: 'membres', get libelle() {
      return tr('dashboard.membres');
    }, glyphe: '☺', get description() {
      return tr('cadreEsport.membres_tous_les_comptes');
    } },
  // Profils de jeu (formats, score, maps, personnages…) : le Fondateur et les comptes à qui il confie « jeux.gerer ».
  { cle: 'jeux', get libelle() {
      return tr('jeux.nav');
    }, glyphe: '◈', get description() {
      return tr('jeux.nav_description');
    } },
  // Réservée au Fondateur : l'entrée n'apparaît que pour lui (et le serveur répond 404 à tout autre compte).
  { cle: 'statistiques', get libelle() {
      return tr('statistiques.titre');
    }, glyphe: '◔', get description() {
      return tr('statistiques.description_nav');
    } },
];

/** Entrées de premier niveau visibles : « Statistiques » pour le Fondateur seulement ; « Jeux » avec la permission jeux.gerer. */
export const navEsport = (fondateur?: boolean, gererJeux?: boolean) => NAV_ESPORT.filter(n => (n.cle !== 'statistiques' || fondateur) && (n.cle !== 'jeux' || Boolean(gererJeux)));

export const LARGEUR_BARRE_LATERALE = 252;

/** Entrée de la barre latérale (44 px au moins, état « sélectionné » annoncé). */
export function EntreeLaterale({
  theme,
  libelle,
  glyphe,
  choisi,
  onPress,
  testID,
  description,
  compteur,
  role = 'tab',
}: {
  theme: ThemeHub;
  libelle: string;
  glyphe?: string;
  choisi: boolean;
  onPress(): void;
  testID: string;
  description?: string;
  compteur?: number;
  role?: 'tab' | 'link' | 'button';
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityState={{ selected: choisi }}
      aria-selected={role === 'tab' ? choisi : undefined}
      aria-current={choisi && role !== 'tab' ? 'page' : undefined}
      accessibilityLabel={description ?? libelle}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: ESP.s,
        minHeight: 44,
        paddingHorizontal: ESP.s,
        borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme),
        backgroundColor: choisi ? teinteTransparente(theme.accent, theme.sombre ? 0.2 : 0.14) : etat.hovered || etat.focused ? teinteTransparente(theme.attenue, 0.1) : 'transparent',
      })}>
      {glyphe ? <Text style={{ width: 22, textAlign: 'center', fontSize: 16, color: choisi ? theme.texte : theme.attenue }}>{glyphe}</Text> : null}
      <Text style={{ flex: 1, ...texte(theme), fontWeight: choisi ? '700' : '500' }} numberOfLines={1}>
        {libelle}
      </Text>
      {compteur ? <Compteur theme={theme} n={compteur} /> : null}
    </Pressable>
  );
}

export function CadreEsport({
  theme,
  large,
  onglet,
  onOnglet,
  pseudo,
  compteurs,
  blocTeam,
  barreBasse,
  enTeteMobile,
  fondateur,
  gererJeux,
  children,
}: {
  theme: ThemeHub;
  large: boolean;
  /** Fondateur (super admin) : l'entrée « Statistiques » s'ajoute à Dashboard · Teams · Membres. */
  fondateur?: boolean;
  /** Permission globale « Gérer les profils de jeu » : l'entrée « Jeux ». */
  gererJeux?: boolean;
  /** Onglet de premier niveau actif (« teams » dans une team). */
  onglet: OngletEsport;
  onOnglet(o: OngletEsport): void;
  pseudo?: string;
  compteurs?: Partial<Record<OngletEsport, number>>;
  /** PC : la team ouverte (identité, sélecteur, sections), sous l'Esport. */
  blocTeam?: React.ReactNode;
  /** Téléphone : barre basse propre (sections d'une team) à la place de celle de l'Esport. */
  barreBasse?: React.ReactNode;
  /** Téléphone : en-tête propre (team ouverte). */
  enTeteMobile?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!large) {
    return (
      <View style={{ flex: 1 }}>
        {enTeteMobile}
        {/* Transcriptions en cours dans l'onglet : visibles sur tous les écrans de l'Esport. Même arbre que sur
            PC (position, profondeur) : passer de l'un à l'autre ne remonte pas l'écran ouvert (formulaires gardés). */}
        <View style={{ flex: 1 }}>
          <BandeauTranscriptions theme={theme} />
          <View style={{ flex: 1 }}>{children}</View>
        </View>
        {barreBasse ?? (
          <BarreOnglets
            theme={theme}
            testID="esport-nav"
            actif={onglet}
            onChoisir={c => onOnglet(c as OngletEsport)}
            entrees={navEsport(fondateur, gererJeux).map(n => ({ cle: n.cle, libelle: n.libelle, glyphe: n.glyphe, description: n.description, pastille: compteurs?.[n.cle] ? String(compteurs[n.cle]) : undefined }))}
          />
        )}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View
        style={{ width: LARGEUR_BARRE_LATERALE, borderRightWidth: 1, borderRightColor: theme.ligne, backgroundColor: theme.surface, paddingHorizontal: ESP.s, paddingVertical: ESP.m, gap: ESP.l }}
        accessibilityRole="navigation"
        aria-label={tr('cadreEsport.navigation_de_l_esport')}>
        <View style={{ gap: ESP.xxs }} testID="esport-nav" accessibilityRole="tablist" accessibilityLabel="Esport">
          <Text style={{ ...attenue(theme, 12), fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: ESP.s, paddingBottom: ESP.xxs }}>{tr('cadre.esport')}</Text>
          {navEsport(fondateur, gererJeux).map(n => (
            <EntreeLaterale
              key={n.cle}
              theme={theme}
              libelle={n.libelle}
              glyphe={n.glyphe}
              description={n.description}
              choisi={onglet === n.cle && !blocTeam}
              compteur={compteurs?.[n.cle]}
              onPress={() => onOnglet(n.cle)}
              testID={`esport-nav-${n.cle}`}
            />
          ))}
        </View>
        {blocTeam ? <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.m }}>{blocTeam}</View> : null}
        <View style={{ flex: 1 }} />
        {pseudo ? (
          <Text style={{ ...attenue(theme), paddingHorizontal: ESP.s }} numberOfLines={1}>
            {tr('cadreEsport.connecte', { pseudo })}
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <BandeauTranscriptions theme={theme} />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </View>
  );
}

/** Conteneur de page : défilement vertical, largeur bornée et centrée, marges généreuses. */
export function PageEsport({ children, large, testID, largeur = 1240 }: { children: React.ReactNode; large: boolean; testID?: string; largeur?: number }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.xl : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.xl : ESP.l, maxWidth: largeur + (large ? 2 * ESP.xxl : 2 * ESP.m), width: '100%', alignSelf: 'center' }} testID={testID}>
      {children}
    </ScrollView>
  );
}
