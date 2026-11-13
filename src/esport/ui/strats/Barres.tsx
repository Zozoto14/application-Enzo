/**
 * Briques des barres de l'atelier de strats (React Native : site, app PC, testables sans canevas) :
 *  - `IconeAsset` : portrait d'un agent ou icône d'une capacité (image importée, puis CDN officiel, puis initiales) ;
 *  - `Pastille` : bouton rond ou arrondi (cible tactile de 44 px au moins) ;
 *  - rôles des agents, ordre des capacités (C, Q, E, X) ;
 *  - `Curseur` : temps dans l'étape (toucher ou glisser).
 * Les barres elles-mêmes (dock des joueurs, capacités et agents, rail d'outils, frise des étapes) sont dans
 * `atelier/`. Les icônes du jeu (portraits, capacités) sont des IMAGES ; celles de l'interface, des tracés monochromes.
 */

import React, { useState } from 'react';
import { Image, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { initiales, type AgentAsset, type CapaciteAsset } from '../../strats/assets';
import { useSourceImage } from './imagesJeu';

/**
 * Portrait ou icône d'un asset du jeu, rond. `url` : une adresse ou les sources dans l'ordre (`sourcesIcone` :
 * image importée, puis CDN officiel) ; la suivante si l'une ne charge pas ; initiales sur fond neutre à la fin.
 */
export function IconeAsset({ theme, url, nom, couleur, taille = 30, testID, onEchec }: { theme: ThemeHub; url: string | ReadonlyArray<string> | null | undefined; nom: string; couleur?: string; taille?: number; testID?: string; onEchec?(): void }) {
  const source = useSourceImage(url);
  if (source.url)
    return (
      <Image
        key={source.url}
        testID={testID ? `${testID}-image` : undefined}
        source={{ uri: source.url }}
        onError={() => {
          source.suivante();
          if (typeof url === 'string' || !url || source.url === url[url.length - 1]) onEchec?.();
        }}
        style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? '#111827' }}
        accessibilityLabel={nom}
      />
    );
  return (
    <View testID={testID ? `${testID}-initiales` : undefined} style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? teinteTransparente(theme.attenue, 0.4), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ffffff', fontSize: taille * 0.38, fontWeight: '800' }}>{initiales(nom)}</Text>
    </View>
  );
}

/** Bouton carré d'au moins 40 px (cible tactile), état choisi visible. */
export function Pastille({ theme, actif, onPress, libelle, testID, children, couleur, desactive }: { theme: ThemeHub; actif: boolean; onPress(): void; libelle: string; testID: string; children: React.ReactNode; couleur?: string; desactive?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: actif, disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={{
        minWidth: 40,
        minHeight: 40,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.min(theme.rayonMoyen, 10),
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? (couleur ?? theme.accent) : theme.ligne,
        backgroundColor: actif ? teinteTransparente(couleur ?? theme.accent, 0.22) : theme.surface,
        opacity: desactive ? 0.45 : 1,
      }}>
      {children}
    </Pressable>
  );
}

// ------------------------------------------------------------------ Agents

export const ROLES_AGENTS = ['duelliste', 'initiateur', 'controleur', 'sentinelle'] as const;
export type Camp = 'allie' | 'ennemi';
/** Couleur des pions et capacités ennemis. */
export const COULEUR_ENNEMI = '#ef4444';

/** Agents du rôle choisi (null : tous). */
export const agentsDuRole = (agents: AgentAsset[], role: string | null): AgentAsset[] => (role ? agents.filter(a => a.roleCle === role) : agents);

/** Ordre des capacités dans la barre (comme le jeu) : C, Q, E, X, puis les autres. */
const ORDRE_TOUCHES = ['C', 'Q', 'E', 'X'];
export const capacitesOrdonnees = (agent: AgentAsset): CapaciteAsset[] =>
  [...agent.capacites].sort((a, b) => {
    const ia = ORDRE_TOUCHES.indexOf(a.touche.toUpperCase());
    const ib = ORDRE_TOUCHES.indexOf(b.touche.toUpperCase());
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });

// ------------------------------------------------------------------ Étapes

/** Curseur horizontal (temps dans l'étape) : toucher ou glisser sur la piste. */
export function Curseur({ theme, valeur, max, onChanger, libelle, testID }: { theme: ThemeHub; valeur: number; max: number; onChanger(v: number): void; libelle: string; testID: string }) {
  const [largeur, setLargeur] = useState(0);
  const depuis = (e: GestureResponderEvent) => {
    if (largeur <= 0) return;
    const x = Math.max(0, Math.min(largeur, e.nativeEvent.locationX));
    onChanger(Math.round((x / largeur) * max * 10) / 10);
  };
  const f = max > 0 ? Math.max(0, Math.min(1, valeur / max)) : 0;
  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={libelle}
      accessibilityValue={{ min: 0, max, now: valeur }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onChanger(Math.max(0, Math.min(max, Math.round((valeur + (e.nativeEvent.actionName === 'increment' ? 0.5 : -0.5)) * 10) / 10)))}
      onLayout={(e: LayoutChangeEvent) => setLargeur(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={depuis}
      onResponderMove={depuis}
      style={{ height: 28, justifyContent: 'center', flex: 1, minWidth: 80 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: teinteTransparente(theme.attenue, 0.3) }} pointerEvents="none">
        <View style={{ width: `${f * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.accent }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${f * 100}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ffffff', borderWidth: 2, borderColor: theme.accent }} />
    </View>
  );
}
