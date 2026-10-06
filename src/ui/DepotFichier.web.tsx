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
import { useMobile } from './mobile/useMobile';

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
  const mobile = useMobile();
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
        padding: mobile ? '14px 16px' : '28px 16px',
        minHeight: mobile ? 56 : undefined,
        boxSizing: 'border-box',
        textAlign: 'center',
        cursor: 'pointer',
        color: palette.texte,
        fontSize: mobile ? 17 : 14,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}>
      <div style={{ fontSize: mobile ? 17 : 16, fontWeight: 700, marginBottom: mobile ? 2 : 6 }}>
        {nom ? `Fichier chargé : ${nom}` : mobile ? 'Choisir un fichier CSV' : 'Glissez ici le fichier CSV de votre courtier'}
      </div>
      <div style={{ color: palette.texteSecondaire, fontSize: mobile ? 15 : 13 }}>
        {nom ? (mobile ? 'Touchez pour en choisir un autre.' : 'Déposez-en un autre pour le remplacer.') : mobile ? 'ou collez son contenu ci-dessous' : 'ou cliquez pour le choisir sur l’ordinateur'}
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
