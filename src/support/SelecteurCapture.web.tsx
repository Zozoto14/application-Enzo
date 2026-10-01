/** Choix d'une capture d'écran sur le site et sur PC : lue en base 64, rien ne part avant l'envoi du ticket. */

import React from 'react';
import { TAILLE_MAX_PIECE, TYPES_PIECE, type PieceJointe } from './tickets';

function versBase64(octets: Uint8Array): string {
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) {
    binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  }
  return (globalThis as unknown as { btoa(s: string): string }).btoa(binaire);
}

export interface PropsSelecteurCapture {
  onChoisir(piece: PieceJointe | undefined): void;
  onErreur(message: string): void;
  couleur?: string;
  /** Téléphone : contrôle de 48 px, texte de 16 px. */
  grand?: boolean;
}

export function SelecteurCapture({ onChoisir, onErreur, couleur, grand = false }: PropsSelecteurCapture): React.ReactElement {
  return React.createElement('input', {
    type: 'file',
    accept: TYPES_PIECE.join(','),
    'aria-label': 'Joindre une capture d’écran (facultatif)',
    'data-testid': 'support-capture',
    style: grand ? { fontSize: 16, color: couleur, minHeight: 48, width: '100%', boxSizing: 'border-box', padding: '10px 0' } : { fontSize: 14, color: couleur },
    onChange: (e: { target: { files?: ArrayLike<{ name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }> } }) => {
      const f = e.target.files?.[0];
      if (!f) {
        onChoisir(undefined);
        return;
      }
      if (!TYPES_PIECE.includes(f.type)) {
        onErreur('La capture doit être une image PNG, JPEG, GIF ou WebP.');
        return;
      }
      if (f.size > TAILLE_MAX_PIECE) {
        onErreur('La capture est trop volumineuse (4 Mo au plus).');
        return;
      }
      void f
        .arrayBuffer()
        .then(contenu => onChoisir({ nom: f.name, type: f.type, donnees: versBase64(new Uint8Array(contenu)) }))
        .catch(() => onErreur('Cette capture n’a pas pu être lue.'));
    },
  });
}
