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
  /** Téléphone : contrôle de 48 px, texte de 17 px. */
  grand?: boolean;
  /** Téléphone : couleur du contour du bouton. */
  bordure?: string;
  /** Téléphone : rayon du bouton (celui des contrôles du thème). */
  rayon?: number;
}

export function SelecteurCapture({ onChoisir, onErreur, couleur, grand = false, bordure, rayon = 12 }: PropsSelecteurCapture): React.ReactElement {
  const champ = React.createElement('input', {
    type: 'file',
    accept: TYPES_PIECE.join(','),
    'aria-label': 'Joindre une capture d’écran (facultatif)',
    'data-testid': 'support-capture',
    // Téléphone : le champ natif (« Choose File », en anglais, minuscule) est invisible et couvre tout
    // le bouton dessiné par-dessus : le toucher atteint directement le champ (exigé par iOS).
    style: grand ? { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 17 } : { fontSize: 14, color: couleur },
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
  if (!grand) {
    return champ;
  }
  return React.createElement(
    'label',
    {
      style: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 48,
        boxSizing: 'border-box',
        padding: '0 16px',
        border: `1px solid ${bordure ?? couleur ?? 'currentColor'}`,
        borderRadius: rayon,
        color: couleur,
        fontSize: 17,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      },
    },
    React.createElement('span', { 'aria-hidden': true }, '📎 Choisir une image…'),
    champ,
  );
}
