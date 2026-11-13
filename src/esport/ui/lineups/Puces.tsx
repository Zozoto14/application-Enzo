/**
 * Pastilles des lineups : portrait du personnage (anneau à la couleur de son rôle), icône de la capacité dans une
 * puce sombre (les icônes des capacités sont claires), difficulté en trois points, étiquette de side.
 */

import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { trLu, type CleLu } from '../../i18n/lineups';
import { couleurPersonnage, initiales } from '../../lineups/logique';
import { sourcesIcone, type AgentAsset, type CapaciteAsset } from '../../strats/assets';
import { JETONS_CARTE } from './CarteTactique';

/**
 * Image d'un personnage ou d'une capacité : les sources dans l'ordre (image importée par le serveur, puis CDN
 * officiel : `sourcesIcone`), la suivante si l'une ne charge pas ; plus aucune : `uri` absent (initiales).
 */
export function useSourceIcone(asset: { icone?: string | null; iconeDoc?: string | null } | null | undefined): { uri: string | undefined; suivante(): void } {
  const sources = sourcesIcone(asset);
  const cle = sources.join('|');
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [cle]);
  return { uri: sources[i], suivante: () => setI(x => x + 1) };
}

/** Portrait rond du personnage ; sans image : ses initiales. */
export function PucePersonnage({ agent, nom, taille = 28, testID }: { agent?: AgentAsset; nom: string; taille?: number; testID?: string }) {
  const image = useSourceIcone(agent);
  const couleur = couleurPersonnage(agent, nom);
  return (
    <View testID={testID} accessibilityLabel={nom} style={{ width: taille, height: taille, borderRadius: taille / 2, borderWidth: 2, borderColor: couleur, backgroundColor: JETONS_CARTE.puce, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {image.uri ? (
        <Image source={{ uri: image.uri }} onError={image.suivante} accessibilityIgnoresInvertColors style={{ width: taille - 4, height: taille - 4, borderRadius: (taille - 4) / 2 }} resizeMode="cover" />
      ) : (
        <Text style={{ color: JETONS_CARTE.etiquette, fontSize: Math.round(taille * 0.36), fontWeight: '800' }}>{initiales(nom)}</Text>
      )}
    </View>
  );
}

/** Icône de la capacité dans une puce sombre ; sans icône : ses initiales. */
export function PuceCapacite({ capacite, nom, taille = 28, testID }: { capacite?: CapaciteAsset; nom: string; taille?: number; testID?: string }) {
  const image = useSourceIcone(capacite);
  return (
    <View testID={testID} accessibilityLabel={nom} style={{ width: taille, height: taille, borderRadius: Math.round(taille * 0.28), borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.22)', backgroundColor: JETONS_CARTE.puce, alignItems: 'center', justifyContent: 'center' }}>
      {image.uri ? (
        <Image source={{ uri: image.uri }} onError={image.suivante} accessibilityIgnoresInvertColors style={{ width: Math.round(taille * 0.64), height: Math.round(taille * 0.64) }} resizeMode="contain" />
      ) : (
        <Text style={{ color: JETONS_CARTE.etiquette, fontSize: Math.round(taille * 0.34), fontWeight: '800' }}>{initiales(nom)}</Text>
      )}
    </View>
  );
}

/** Difficulté : trois points, les premiers pleins (jamais la couleur seule : le nom est lu). */
export function Difficulte({ theme, n, avecNom = false }: { theme: ThemeHub; n: number; avecNom?: boolean }) {
  const nom = trLu(`difficulte.${Math.max(1, Math.min(3, n))}` as CleLu);
  const couleur = n >= 3 ? theme.critique : n === 2 ? theme.alerte : theme.ok;
  return (
    <View accessibilityLabel={trLu('difficulte.n', { n, nom })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3].map(i => (
        <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i <= n ? couleur : 'transparent', borderWidth: 1, borderColor: i <= n ? couleur : theme.attenue }} />
      ))}
      {avecNom ? <Text style={{ color: theme.texte, fontSize: 13, fontWeight: '600', marginLeft: 2, ...police(theme.policeTexte) }}>{nom}</Text> : null}
    </View>
  );
}

/** Nom affiché d'un side (attaque, défense, mode du jeu) ; une clé inconnue reste telle quelle. */
export function nomSide(side: string): string {
  if (!side) return trLu('partout');
  const cle = `side.${side}`;
  const traduit = trLu(cle as CleLu);
  return traduit === cle ? side : traduit;
}

/** Étiquette d'un side : rouge pour l'attaque, accent pour la défense, neutre pour un mode. */
export function EtiquetteSide({ theme, side }: { theme: ThemeHub; side: string }) {
  if (!side) return null;
  const c = side === 'attaque' ? theme.critique : side === 'defense' ? theme.accent : theme.attenue;
  return (
    <View style={{ borderWidth: 1, borderColor: teinteTransparente(c, 0.6), backgroundColor: teinteTransparente(c, 0.14), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ color: theme.texte, fontSize: 11, fontWeight: '700', ...police(theme.policeTexte) }}>{nomSide(side)}</Text>
    </View>
  );
}

/** Petite étiquette sombre posée sur une image (statut, « Vidéo »). */
export function EtiquetteImage({ texte, couleur }: { texte: string; couleur?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(8, 12, 17, 0.82)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
      {couleur ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: couleur }} /> : null}
      <Text style={{ color: JETONS_CARTE.etiquette, fontSize: 11, fontWeight: '700' }}>{texte}</Text>
    </View>
  );
}
