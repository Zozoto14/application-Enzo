/**
 * QR code (invitation d'un ami, connexion d'un autre appareil).
 *
 * Il n'y a plus d'écran « Paramètres › Synchronisation › Appareils liés » (relais version 9 : les données
 * sont sur le serveur, chacun se connecte par identifiant + mot de passe) : ce module ne garde que le
 * dessin du QR code, utilisé par l'Administration et « Connecter un autre appareil ».
 */

import qrcode from 'qrcode-generator';
import React, { useMemo } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { ESPACEMENT, RAYON } from '../theme';
import { tt } from '../mobile/jetons';

/** Côté affiché du QR code, en points. */
const TAILLE_QR = 260;

/**
 * QR code en dessin vectoriel (SVG) : net à toute taille et à tout zoom
 * d'écran. Une image en pixels réduite à l'affichage devient floue, et
 * l'appareil photo ne la lit plus. Hors navigateur (iPhone), l'image en
 * pixels est gardée, à sa taille exacte.
 */
export function imageQr(texte: string, vectoriel = Platform.OS === 'web'): { uri: string; taille: number } {
  const qr = qrcode(0, 'M');
  qr.addData(texte);
  qr.make();
  if (vectoriel) {
    const svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    return { uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, taille: TAILLE_QR };
  }
  const case_ = 4;
  return { uri: qr.createDataURL(case_, 16), taille: (qr.getModuleCount() + 8) * case_ };
}

export function QrCode({ texte, legende, testID }: { texte: string; legende: string; testID: string }) {
  const { uri, taille } = useMemo(() => imageQr(texte), [texte]);
  return (
    <View style={styles.qr} testID={testID}>
      <Image source={{ uri }} style={{ width: taille, height: taille }} accessibilityLabel={legende} />
      <Text style={{ fontSize: tt(14), color: '#111', fontWeight: '600', textAlign: 'center', maxWidth: taille }}>{legende}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', gap: ESPACEMENT.xs, backgroundColor: '#fff', padding: ESPACEMENT.s, borderRadius: RAYON.m },
});
