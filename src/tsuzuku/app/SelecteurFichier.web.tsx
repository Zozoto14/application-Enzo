/** Choix d'un fichier .json sur le site et sur PC : son contenu remplit le champ. */

import React from 'react';

export function SelecteurFichier({ onTexte, mobile }: { onTexte(texte: string): void; mobile?: boolean }): React.ReactElement {
  return React.createElement('input', {
    type: 'file',
    accept: '.json,application/json',
    'aria-label': 'Choisir un fichier JSON',
    'data-testid': 'import-fichier',
    style: mobile ? { fontSize: 16, minHeight: 48, width: '100%', boxSizing: 'border-box', padding: 8 } : { fontSize: 14 },
    onChange: (e: { target: { files?: ArrayLike<{ size: number; text(): Promise<string> }> } }) => {
      const f = e.target.files?.[0];
      // 20 Mo : largement de quoi contenir 20 000 entrées.
      if (f && f.size <= 20 * 1024 * 1024) void f.text().then(onTexte);
    },
  });
}
