/**
 * Site et app PC : le générateur de QR code (qrcode-generator) n'est chargé qu'à l'affichage d'un QR code, pas avec
 * le fichier principal (docs/performance.md). Version directe : qrDiffere.tsx.
 */

import type React from 'react';
import { differe } from '../differe';

export const QrCode = differe<React.ComponentProps<typeof import('./CarteSynchro').QrCode>>(async () => (await import('./CarteSynchro')).QrCode, { attente: null });
