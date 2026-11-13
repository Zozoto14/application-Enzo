/**
 * Carte tactique des lineups : la minimap de la map sur un fond sombre, ses callouts en étiquettes à halo, des pins
 * (un lineup, ou un groupe de lineups proches), la trajectoire d'un lineup (départ, arc en tirets, anneau d'arrivée),
 * et la pose d'un point au toucher (site, app PC, iPad).
 *
 * POINT D'ÉCHANGE : c'est le SEUL fichier par lequel les lineups (vue par map, mini-carte d'une fiche, pose des
 * points) et les plans de match dessinent une map. Le jour où le composant de carte commun de l'éditeur de strats
 * est livré, il suffit de le brancher ici (mêmes propriétés) : les écrans ne changent pas.
 *
 * Repère : carré de 1000 unités, le même que celui des strats (l'image est cadrée dans ce carré).
 */

import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { PointCarte } from '../../lineups/api';
import { REPERE, centreZone, pointDepuisToucher } from '../../lineups/logique';
import type { CarteAsset } from '../../strats/assets';
import { TraceTrajets, type TrajetCarte } from './TraceTrajets';

export type { TrajetCarte } from './TraceTrajets';

/** Jetons de la carte : toujours sombres, quel que soit le thème (une minimap se lit sur du noir). */
export const JETONS_CARTE = {
  fond: '#0B0F14',
  sol: '#121A24',
  bord: 'rgba(255, 255, 255, 0.12)',
  grille: 'rgba(255, 255, 255, 0.05)',
  etiquette: '#E8EEF6',
  etiquetteDouce: 'rgba(232, 238, 246, 0.72)',
  halo: '#05080C',
  puce: 'rgba(8, 12, 17, 0.94)',
  neutre: '#E8EEF6',
} as const;

export interface PinCarte {
  id: string;
  x: number;
  y: number;
  /** Couleur d'accent (rôle du personnage) : anneau du pin. */
  couleur: string;
  /** Icône de la capacité : un lien, ou ses sources dans l'ordre (la suivante si l'une ne charge pas) ; sinon les initiales. */
  icone?: string | readonly string[] | null;
  initiales: string;
  /** Nom accessible (« Smoke Heaven, Omen, Dark Cover »). */
  libelle: string;
  /** Groupe de lineups proches : leur nombre. */
  n?: number;
  actif?: boolean;
  estompe?: boolean;
}

export interface PropsCarteTactique {
  carte?: Pick<CarteAsset, 'minimap' | 'zones' | 'reperes'> | null;
  /** Nom de la map (repli sans image, nom accessible). */
  nom: string;
  pins?: readonly PinCarte[];
  trajets?: readonly TrajetCarte[];
  onPin?(id: string): void;
  /** Pose d'un point : la carte devient une zone à toucher. */
  onToucher?(p: PointCarte): void;
  /** Libellé accessible de la zone à toucher. */
  libelleToucher?: string;
  /** Callouts et sites de la map (défaut : oui, s'il y a la place). */
  etiquettes?: boolean;
  /** Mini-carte (fiche, carte de la grille) : pins plus petits, pas d'étiquettes. */
  compacte?: boolean;
  /** Largeur mesurée (pixels) : sert au regroupement des pins. */
  onLargeur?(px: number): void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const pourcent = (n: number) => `${Math.max(0, Math.min(100, (n / REPERE) * 100))}%` as const;

/** Halo des étiquettes : plusieurs ombres sur le web (contour net), une seule ailleurs. */
const halo = (): object =>
  Platform.OS === 'web'
    ? { textShadow: `0 0 2px ${JETONS_CARTE.halo}, 0 0 2px ${JETONS_CARTE.halo}, 0 0 5px ${JETONS_CARTE.halo}, 0 1px 3px ${JETONS_CARTE.halo}` }
    : { textShadowColor: JETONS_CARTE.halo, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } };

function Pin({ pin, taille, onPress, testID }: { pin: PinCarte; taille: number; onPress?(): void; testID?: string }) {
  const groupe = (pin.n ?? 1) > 1;
  const sources = typeof pin.icone === 'string' ? [pin.icone] : (pin.icone ?? []);
  const cleSources = sources.join('|');
  const [source, setSource] = useState(0);
  useEffect(() => setSource(0), [cleSources]);
  const icone = sources[source];
  const cote = pin.actif ? taille + 6 : taille;
  const contenu = (
    <View
      style={{
        width: cote,
        height: cote,
        borderRadius: cote / 2,
        backgroundColor: JETONS_CARTE.puce,
        borderWidth: pin.actif ? 3 : 2,
        borderColor: groupe ? JETONS_CARTE.neutre : pin.couleur,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pin.estompe ? 0.35 : 1,
        ...(Platform.OS === 'web' ? ({ boxShadow: pin.actif ? `0 0 0 4px ${pin.couleur}55, 0 2px 8px rgba(0,0,0,0.6)` : '0 2px 6px rgba(0,0,0,0.55)' } as object) : {}),
      }}>
      {groupe ? (
        <Text style={{ color: JETONS_CARTE.neutre, fontSize: Math.round(taille * 0.42), fontWeight: '800' }}>{pin.n}</Text>
      ) : icone ? (
        <Image source={{ uri: icone }} onError={() => setSource(i => i + 1)} accessibilityIgnoresInvertColors style={{ width: Math.round(cote * 0.58), height: Math.round(cote * 0.58) }} resizeMode="contain" />
      ) : (
        <Text style={{ color: JETONS_CARTE.etiquette, fontSize: Math.round(taille * 0.34), fontWeight: '800' }}>{pin.initiales}</Text>
      )}
    </View>
  );
  const position: ViewStyle = { position: 'absolute', left: pourcent(pin.x), top: pourcent(pin.y), width: cote, height: cote, marginLeft: -cote / 2, marginTop: -cote / 2, zIndex: pin.actif ? 3 : 2 };
  if (!onPress) return <View testID={testID} accessibilityLabel={pin.libelle} style={position}>{contenu}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={pin.libelle} accessibilityState={{ selected: Boolean(pin.actif) }} onPress={onPress} hitSlop={8} style={position}>
      {contenu}
    </Pressable>
  );
}

export function CarteTactique({ carte, nom, pins = [], trajets = [], onPin, onToucher, libelleToucher, etiquettes = true, compacte = false, onLargeur, style, testID = 'carte-tactique' }: PropsCarteTactique) {
  const [largeur, setLargeur] = useState(0);
  const [hauteur, setHauteur] = useState(0);
  const [echec, setEchec] = useState(false);
  const surLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - largeur) > 0.5) {
      setLargeur(width);
      onLargeur?.(width);
    }
    if (Math.abs(height - hauteur) > 0.5) setHauteur(height);
  };
  const image = carte?.minimap && !echec ? carte.minimap : null;
  const voirEtiquettes = etiquettes && !compacte && (largeur === 0 || largeur >= 380);
  const taillePin = compacte ? 22 : largeur > 0 && largeur < 420 ? 30 : 36;
  const policeEtiquette = largeur >= 620 ? 11 : 10;

  const toucher = (e: GestureResponderEvent) => {
    if (!onToucher) return;
    const ne = e.nativeEvent as unknown as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number; clientX?: number; clientY?: number };
    const cible = (e as unknown as { currentTarget?: { getBoundingClientRect?(): { left: number; top: number; width: number; height: number } } }).currentTarget;
    const boite = typeof cible?.getBoundingClientRect === 'function' ? cible.getBoundingClientRect() : undefined;
    let p: PointCarte | null = null;
    // Web : position du pointeur dans la boîte de la carte ; app : position du toucher dans la zone.
    if (boite && typeof ne.clientX === 'number' && typeof ne.clientY === 'number') p = pointDepuisToucher(ne.clientX - boite.left, ne.clientY - boite.top, boite.width, boite.height);
    else p = pointDepuisToucher(ne.locationX ?? ne.offsetX ?? NaN, ne.locationY ?? ne.offsetY ?? NaN, largeur, hauteur);
    if (p) onToucher(p);
  };

  return (
    <View
      testID={testID}
      onLayout={surLayout}
      accessibilityLabel={nom}
      style={[{ width: '100%', aspectRatio: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: JETONS_CARTE.fond, borderWidth: 1, borderColor: JETONS_CARTE.bord }, style]}>
      {image ? (
        <Image testID={`${testID}-image`} source={{ uri: image }} onError={() => setEchec(true)} accessibilityIgnoresInvertColors resizeMode="contain" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0.94 }} />
      ) : (
        <View testID={`${testID}-sans-image`} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: JETONS_CARTE.sol, alignItems: 'center', justifyContent: 'center' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
            <React.Fragment key={i}>
              <View style={{ position: 'absolute', left: `${i * 10}%`, top: 0, bottom: 0, width: 1, backgroundColor: JETONS_CARTE.grille }} />
              <View style={{ position: 'absolute', top: `${i * 10}%`, left: 0, right: 0, height: 1, backgroundColor: JETONS_CARTE.grille }} />
            </React.Fragment>
          ))}
          <Text numberOfLines={1} style={{ color: 'rgba(232, 238, 246, 0.16)', fontSize: compacte ? 18 : 40, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' }}>
            {nom}
          </Text>
        </View>
      )}
      <TraceTrajets trajets={trajets} largeur={largeur} compacte={compacte} testID={testID} />
      {voirEtiquettes
        ? (carte?.zones ?? []).map(z => {
            const c = centreZone(z.points);
            if (!c || !z.nom) return null;
            return (
              <View key={`z-${z.cle}`} pointerEvents="none" style={{ position: 'absolute', left: pourcent(c.x), top: pourcent(c.y), width: 150, marginLeft: -75, marginTop: -8, alignItems: 'center' }}>
                <Text numberOfLines={1} style={{ color: JETONS_CARTE.etiquetteDouce, fontSize: policeEtiquette, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', ...halo() }}>
                  {z.nom}
                </Text>
              </View>
            );
          })
        : null}
      {voirEtiquettes
        ? (carte?.reperes ?? [])
            .filter(r => r.type === 'site' || r.type === 'cashout')
            .map(r => (
              <View key={`r-${r.cle}`} pointerEvents="none" style={{ position: 'absolute', left: pourcent(r.x), top: pourcent(r.y), width: 120, marginLeft: -60, marginTop: -11, alignItems: 'center' }}>
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(8, 12, 17, 0.78)', borderWidth: 1, borderColor: 'rgba(232, 238, 246, 0.35)' }}>
                  <Text numberOfLines={1} style={{ color: JETONS_CARTE.etiquette, fontSize: policeEtiquette + 1, fontWeight: '800' }}>
                    {r.nom}
                  </Text>
                </View>
              </View>
            ))
        : null}
      {pins.map(p => (
        <Pin key={p.id} pin={p} taille={taillePin} onPress={onPin && !onToucher ? () => onPin(p.id) : undefined} testID={`${testID}-pin-${p.id}`} />
      ))}
      {onToucher ? (
        <Pressable
          testID={`${testID}-toucher`}
          accessibilityRole="button"
          accessibilityLabel={libelleToucher ?? nom}
          onPress={toucher}
          style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 5 }, Platform.OS === 'web' ? ({ cursor: 'crosshair' } as object) : null]}
        />
      ) : null}
    </View>
  );
}
