/**
 * Cadre de navigation de l'Esport.
 *
 *  - PC et iPad paysage (≥ 900 px) : barre latérale. En haut, l'Esport
 *    (Dashboard · Teams · Membres, Jeux et Statistiques selon les droits) ; dans une team, en dessous, la team
 *    (logo, nom, sélecteur rapide) et ses sections.
 *  - iPhone et petites fenêtres : barre d'onglets en bas. Dashboard · Teams ·
 *    Membres au premier niveau ; les sections de la team dans une team.
 *
 * L'espace CM du club n'est pas une entrée de premier niveau : il est rangé dans Teams (carte « CM du club »
 * en tête de la page Teams ; l'entrée « Teams » reste surlignée dans l'espace CM). Voir RacineEsport.tsx.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../hub/themes';
import { BarreOnglets } from '../../ui/mobile/BarreOnglets';
import { Compteur, ESP, attenue, rayonControle, texte, useDensite, type EtatPresse } from './design';
import { tr } from '../i18n';
import { BandeauTranscriptions } from './medias/Transcription';
import { trNf } from '../i18n/notifications';

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

/**
 * Entrées de premier niveau visibles : « Statistiques » pour le Fondateur seulement ; « Jeux » avec la permission
 * jeux.gerer. Cinq au plus : elles tiennent toutes dans la barre du bas du téléphone. Le CM du club est dans Teams.
 */
export const navEsport = (fondateur?: boolean, gererJeux?: boolean) => NAV_ESPORT.filter(n => (n.cle !== 'statistiques' || fondateur) && (n.cle !== 'jeux' || Boolean(gererJeux)));

export const LARGEUR_BARRE_LATERALE = 252;
/** Barre latérale rangée : une fine colonne d'icônes. */
export const LARGEUR_BARRE_REDUITE = 68;
/** Sous cette largeur de fenêtre (tablette), la barre est réduite d'office tant que la personne n'a pas choisi. */
export const LARGEUR_REDUCTION_AUTO = 1100;
export const CLE_BARRE_REDUITE = 'esport.barre-laterale-reduite';

type Stockage = {
  getItem(c: string): string | null;
  setItem(c: string, v: string): void;
};
const stockage = (): Stockage | undefined => {
  try {
    return (globalThis as { localStorage?: Stockage }).localStorage;
  } catch {
    return undefined;
  }
};
/** Préférence d'affichage de cet appareil : true (réduite), false (étendue), undefined (pas encore choisie). */
export function lireBarreReduite(): boolean | undefined {
  try {
    const v = stockage()?.getItem(CLE_BARRE_REDUITE);
    return v === '1' ? true : v === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}
function ecrireBarreReduite(v: boolean) {
  try {
    stockage()?.setItem(CLE_BARRE_REDUITE, v ? '1' : '0');
  } catch {
    /* préférence d'affichage : sans stockage, elle vaut pour la session */
  }
}

/** Dit aux entrées de la barre si elle est réduite (libellés masqués, infobulle au survol). */
const ContexteBarre = createContext(false);
export const useBarreReduite = () => useContext(ContexteBarre);
/** N'affiche son contenu que si la barre est étendue (nom de la team, sélecteur…). */
export function SiBarreEtendue({ children }: { children: React.ReactNode }) {
  return useBarreReduite() ? null : <>{children}</>;
}

type EcouteurClavier = {
  addEventListener(t: string, f: (e: ToucheWeb) => void): void;
  removeEventListener(t: string, f: (e: ToucheWeb) => void): void;
};
type ToucheWeb = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: unknown;
  preventDefault(): void;
};

/** État de la barre : choix mémorisé, sinon réduite d'office sur une fenêtre étroite ; Ctrl+B (⌘B) la bascule. */
export function useBarreLaterale(actif: boolean): {
  reduite: boolean;
  basculer(): void;
} {
  const { width } = useWindowDimensions();
  const [choix, setChoix] = useState<boolean | undefined>(lireBarreReduite);
  const reduite = choix ?? width < LARGEUR_REDUCTION_AUTO;
  const basculer = useCallback(() => {
    const suivant = !reduite;
    setChoix(suivant);
    ecrireBarreReduite(suivant);
  }, [reduite]);
  useEffect(() => {
    const g = globalThis as unknown as Partial<EcouteurClavier>;
    if (!actif || typeof g.addEventListener !== 'function' || typeof g.removeEventListener !== 'function') return undefined;
    const surTouche = (e: ToucheWeb) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
      const cible = e.target as {
        tagName?: string;
        isContentEditable?: boolean;
      } | null;
      // Dans un champ de saisie, Ctrl+B reste celui de l'éditeur (gras).
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName ?? ''))) return;
      e.preventDefault();
      basculer();
    };
    g.addEventListener('keydown', surTouche);
    return () => g.removeEventListener?.('keydown', surTouche);
  }, [actif, basculer]);
  return { reduite, basculer };
}

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
  const reduite = useBarreReduite();
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
        justifyContent: reduite ? 'center' : 'flex-start',
        borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme),
        backgroundColor: choisi ? teinteTransparente(theme.accent, theme.sombre ? 0.2 : 0.14) : etat.hovered || etat.focused ? teinteTransparente(theme.attenue, 0.1) : 'transparent',
      })}
    >
      {(etat: EtatPresse) => (
        <>
          {glyphe ? (
            <Text
              style={{
                width: 22,
                textAlign: 'center',
                fontSize: 16,
                color: choisi ? theme.texte : theme.attenue,
              }}
            >
              {glyphe}
            </Text>
          ) : null}
          {reduite ? (
            <>
              {!glyphe ? <Text style={{ ...texte(theme), fontWeight: '700' }}>{libelle.slice(0, 2)}</Text> : null}
              {compteur ? (
                <View
                  testID={`${testID}-pastille`}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 8,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.accent,
                  }}
                />
              ) : null}
              {etat.hovered || etat.focused ? (
                <View
                  pointerEvents="none"
                  testID={`${testID}-infobulle`}
                  style={{
                    position: 'absolute',
                    left: '100%',
                    marginLeft: ESP.xs,
                    zIndex: 50,
                    paddingHorizontal: ESP.s,
                    paddingVertical: ESP.xxs,
                    borderRadius: 8,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.ligne,
                  }}
                >
                  <Text style={{ ...texte(theme, 13), fontWeight: '600' }} numberOfLines={1}>
                    {libelle}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Text
                style={{
                  flex: 1,
                  ...texte(theme),
                  fontWeight: choisi ? '700' : '500',
                }}
                numberOfLines={1}
              >
                {libelle}
              </Text>
              {compteur ? <Compteur theme={theme} n={compteur} /> : null}
            </>
          )}
        </>
      )}
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
  notifications,
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
  /**
   * PC : entrée « Notifications » (compteur des non lues) sous l'Esport. Téléphone : rien dans la barre du bas, la
   * cloche est dans l'en-tête (RacineEsport.tsx).
   */
  notifications?: { n: number; actif: boolean; onPress(): void };
  children: React.ReactNode;
}) {
  const { reduite, basculer } = useBarreLaterale(large);
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
            entrees={navEsport(fondateur, gererJeux).map(n => ({
              cle: n.cle,
              libelle: n.libelle,
              glyphe: n.glyphe,
              description: n.description,
              pastille: compteurs?.[n.cle] ? String(compteurs[n.cle]) : undefined,
            }))}
          />
        )}
      </View>
    );
  }
  return (
    <ContexteBarre.Provider value={reduite}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View
          testID="esport-barre-laterale"
          nativeID="esport-barre-laterale"
          style={
            {
              width: reduite ? LARGEUR_BARRE_REDUITE : LARGEUR_BARRE_LATERALE,
              borderRightWidth: 1,
              borderRightColor: theme.ligne,
              backgroundColor: theme.surface,
              paddingHorizontal: reduite ? ESP.xs : ESP.s,
              paddingVertical: ESP.m,
              gap: ESP.l,
              zIndex: 10,
              transitionProperty: 'width',
              transitionDuration: '180ms',
              transitionTimingFunction: 'ease',
            } as ViewStyle
          }
          accessibilityRole="navigation"
          aria-label={tr('cadreEsport.navigation_de_l_esport')}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: reduite ? 'center' : 'space-between',
              paddingHorizontal: reduite ? 0 : ESP.s,
            }}
          >
            {reduite ? null : (
              <Text
                style={{
                  ...attenue(theme, 12),
                  fontWeight: '700',
                  letterSpacing: 1.2,
                }}
              >
                {tr('cadre.esport')}
              </Text>
            )}
            <Pressable
              testID="esport-barre-bascule"
              accessibilityRole="button"
              accessibilityLabel={reduite ? tr('cadreEsport.etendre_barre') : tr('cadreEsport.reduire_barre')}
              accessibilityState={{ expanded: !reduite }}
            aria-expanded={!reduite}
              aria-controls="esport-barre-laterale"
              aria-keyshortcuts="Control+B Meta+B"
              onPress={basculer}
              style={(etat: EtatPresse) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                backgroundColor: etat.hovered || etat.focused ? teinteTransparente(theme.attenue, 0.14) : 'transparent',
                borderWidth: etat.focused ? 2 : 0,
                borderColor: theme.accent,
              })}
            >
              <Text style={{ color: theme.attenue, fontSize: 18 }}>{reduite ? '»' : '«'}</Text>
            </Pressable>
          </View>
          <View style={{ gap: ESP.xxs }} testID="esport-nav" accessibilityRole="tablist" accessibilityLabel="Esport">
            {navEsport(fondateur, gererJeux).map(n => (
              <EntreeLaterale
                key={n.cle}
                theme={theme}
                libelle={n.libelle}
                glyphe={n.glyphe}
                description={n.description}
                choisi={onglet === n.cle && !blocTeam && !notifications?.actif}
                compteur={compteurs?.[n.cle]}
                onPress={() => onOnglet(n.cle)}
                testID={`esport-nav-${n.cle}`}
              />
            ))}
            {notifications ? (
              <EntreeLaterale
                theme={theme}
                libelle={trNf('titre')}
                glyphe="🔔"
                description={trNf('sous')}
                choisi={notifications.actif && !blocTeam}
                compteur={notifications.n}
                onPress={notifications.onPress}
                testID="esport-nav-notifications"
                role="link"
              />
            ) : null}
          </View>
          {blocTeam ? (
            <View
              style={{
                gap: ESP.xs,
                borderTopWidth: 1,
                borderTopColor: theme.ligne,
                paddingTop: ESP.m,
              }}
            >
              {blocTeam}
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {pseudo && !reduite ? (
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
    </ContexteBarre.Provider>
  );
}

/** Conteneur de page : défilement vertical, largeur bornée et centrée, marges généreuses. */
export function PageEsport({ children, large, testID, largeur = 1240 }: { children: React.ReactNode; large: boolean; testID?: string; largeur?: number }) {
  // Marges, espacement et largeur suivent la fenêtre (densité compacte sur iPad / portable) ; contenu centré et borné au-delà.
  const { marge, compacte } = useDensite();
  const m = large ? marge : ESP.m;
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: m,
        paddingTop: large ? (compacte ? ESP.l : ESP.xl) : ESP.m,
        paddingBottom: ESP.xxxl,
        gap: large ? (compacte ? ESP.l : ESP.xl) : ESP.l,
        maxWidth: largeur + 2 * m,
        width: '100%',
        alignSelf: 'center',
      }}
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}
