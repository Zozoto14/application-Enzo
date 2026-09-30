/** Choix d'une capture d'écran sur iPhone et iPad (photothèque) ; voir `SelecteurCapture.web.tsx` pour le site et le PC. */

import React from 'react';
import { Pressable, Text } from 'react-native';
import { chargerModule } from '../natif/modules';
import { TAILLE_MAX_PIECE, TYPES_PIECE, type PieceJointe } from './tickets';
import type { PropsSelecteurCapture } from './SelecteurCapture.web';

interface Selecteur {
  launchImageLibrary(options: { mediaType: 'photo'; includeBase64: boolean; selectionLimit: number }): Promise<{
    didCancel?: boolean;
    assets?: Array<{ base64?: string; type?: string; fileName?: string; fileSize?: number }>;
  }>;
}

export function SelecteurCapture({ onChoisir, onErreur, couleur }: PropsSelecteurCapture): React.ReactElement | null {
  const module = chargerModule<Selecteur>('react-native-image-picker');
  if (module.etat !== 'disponible' || !module.module) {
    return null;
  }
  const choisir = () => {
    void module.module!
      .launchImageLibrary({ mediaType: 'photo', includeBase64: true, selectionLimit: 1 })
      .then(reponse => {
        const a = reponse.assets?.[0];
        if (!a || reponse.didCancel) return;
        const piece: PieceJointe = { nom: a.fileName ?? 'capture.jpg', type: a.type ?? 'image/jpeg', donnees: a.base64 ?? '' };
        if (!piece.donnees || !TYPES_PIECE.includes(piece.type)) onErreur('La capture doit être une image PNG, JPEG, GIF ou WebP.');
        else if ((a.fileSize ?? 0) > TAILLE_MAX_PIECE) onErreur('La capture est trop volumineuse (4 Mo au plus).');
        else onChoisir(piece);
      })
      .catch(() => onErreur('La photothèque n’a pas pu s’ouvrir.'));
  };
  return (
    <Pressable accessibilityRole="button" onPress={choisir} testID="support-capture">
      <Text style={{ color: couleur, textDecorationLine: 'underline' }}>Joindre une capture d’écran</Text>
    </Pressable>
  );
}
