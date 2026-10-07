/**
 * Zone de dépôt de fichier du bureau : glisser l'export du courtier, ou
 * cliquer pour le choisir.
 *
 * Les exports de courtier sont souvent en Windows-1252 plutôt qu'en UTF-8 :
 * lu comme UTF-8, « Société » deviendrait « Soci�t� ». On tente UTF-8 strict,
 * puis Windows-1252.
 */

import React, { useRef, useState } from 'react';
import { usePalette } from './composants';
import type { DepotFichierProps } from './depotFichierTypes';

export type { DepotFichierProps };

async function lireTexte(fichier: File): Promise<string> {
  const octets = await fichier.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

export function DepotFichier({ onContenu }: DepotFichierProps) {
  const palette = usePalette();
  const [survol, setSurvol] = useState(false);
  const [nom, setNom] = useState<string | undefined>();
  const champ = useRef<HTMLInputElement>(null);

  const recevoir = async (fichiers: FileList | null) => {
    const fichier = fichiers?.[0];
    if (!fichier) {
      return;
    }
    setNom(fichier.name);
    onContenu(await lireTexte(fichier), fichier.name);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Déposer l’export du courtier, ou cliquer pour le choisir"
      onClick={() => champ.current?.click()}
      onKeyDown={evenement => {
        if (evenement.key === 'Enter' || evenement.key === ' ') {
          champ.current?.click();
        }
      }}
      onDragOver={evenement => {
        evenement.preventDefault();
        setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={evenement => {
        evenement.preventDefault();
        setSurvol(false);
        void recevoir(evenement.dataTransfer.files);
      }}
      style={{
        border: `2px dashed ${survol ? palette.accent : palette.bordure}`,
        background: survol ? palette.accentFond : palette.surface,
        borderRadius: 12,
        padding: '28px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        color: palette.texte,
        fontSize: 14,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
        {nom ? `Fichier chargé : ${nom}` : 'Glissez ici le fichier CSV de votre courtier'}
      </div>
      <div style={{ color: palette.texteSecondaire, fontSize: 13 }}>
        {nom ? 'Déposez-en un autre pour le remplacer.' : 'ou cliquez pour le choisir sur l’ordinateur'}
      </div>
      <input
        ref={champ}
        type="file"
        accept=".csv,.txt,text/csv"
        style={{ display: 'none' }}
        onChange={evenement => void recevoir(evenement.target.files)}
      />
    </div>
  );
}
