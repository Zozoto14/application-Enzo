/**
 * Code de liaison : l'adresse du relais et son jeton, en une chaîne.
 *
 * Affiché par le PC (texte et QR code), saisi une fois sur chaque appareil.
 * Il ne contient **pas** le mot de passe de synchronisation : sans lui, le
 * code donne accès à la boîte, mais pas à ce qu'elle contient.
 */

export interface Liaison {
  /** Adresse du relais, sans barre finale. */
  relais: string;
  jeton: string;
  /** Adresse du site de secours, quand elle est connue. */
  site?: string;
}

import { utf8ToBytes } from '@noble/hashes/utils.js';
import { texteDepuisOctets } from '../../sauvegarde/archive';
import { depuisBase64, versBase64 } from './chiffrement';

const PREFIXE = 'AB1.';

// Sans TextEncoder ni btoa, absents de certains moteurs embarqués.
function base64Url(texte: string): string {
  return versBase64(utf8ToBytes(texte)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function depuisBase64Url(texte: string): string {
  return texteDepuisOctets(depuisBase64(texte.replace(/-/g, '+').replace(/_/g, '/')));
}

export function normaliserAdresse(adresse: string): string {
  return adresse.trim().replace(/\/+$/, '');
}

export function liaisonValide(liaison: Partial<Liaison> | undefined): liaison is Liaison {
  return (
    !!liaison &&
    typeof liaison.relais === 'string' &&
    /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(liaison.relais) &&
    typeof liaison.jeton === 'string' &&
    liaison.jeton.length >= 16 &&
    (liaison.site === undefined || /^https:\/\/\S+$/.test(liaison.site))
  );
}

export function encoderLiaison(liaison: Liaison): string {
  const { relais, jeton, site } = liaison;
  return PREFIXE + base64Url(JSON.stringify(site ? { r: relais, j: jeton, s: site } : { r: relais, j: jeton }));
}

/** Lit un code de liaison, ou un lien qui en porte un (`…#liaison=AB1.…`). */
export function decoderLiaison(texte: string): Liaison | undefined {
  const trouve = /AB1\.[A-Za-z0-9_-]+/.exec(texte.trim());
  if (!trouve) {
    return undefined;
  }
  try {
    const brut = JSON.parse(depuisBase64Url(trouve[0].slice(PREFIXE.length))) as { r?: string; j?: string; s?: string };
    const liaison = {
      relais: normaliserAdresse(String(brut.r ?? '')),
      jeton: String(brut.j ?? ''),
      site: brut.s ? normaliserAdresse(brut.s) : undefined,
    };
    return liaisonValide(liaison) ? liaison : undefined;
  } catch {
    return undefined;
  }
}

/** Lien à scanner avec l'appareil photo : ouvre le site de secours déjà relié. */
export function lienSite(liaison: Liaison): string | undefined {
  return liaison.site ? `${liaison.site}/#liaison=${encoderLiaison(liaison)}` : undefined;
}

/** Lien qui ouvre l'app iPhone (schéma applibourse://) déjà reliée. */
export function lienApp(liaison: Liaison): string {
  return `applibourse://liaison?code=${encoderLiaison(liaison)}`;
}
