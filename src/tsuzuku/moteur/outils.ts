/**
 * Petits outils partages, sans dependance a une plateforme.
 */

/** Source du temps, injectable pour les tests. */
export interface Horloge {
  maintenant(): number;
}

export const horlogeSysteme: Horloge = { maintenant: () => Date.now() };

/** Date du jour au format AAAA-MM-JJ (UTC, comme l'ancien serveur). */
export function jourDe(horloge: Horloge = horlogeSysteme): string {
  return new Date(horloge.maintenant()).toISOString().slice(0, 10);
}

export function instantDe(horloge: Horloge = horlogeSysteme): string {
  return new Date(horloge.maintenant()).toISOString();
}

export type Attente = (ms: number) => Promise<void>;
export const attendreVraiment: Attente = ms => new Promise(r => setTimeout(r, ms));

const ACCENTS = /[̀-ͯ]/g;

/** Minuscules, sans accents ni ponctuation : sert aux comparaisons de titres. */
export function normaliserTexte(valeur: unknown): string {
  let t = String(valeur ?? '');
  try {
    t = t.normalize('NFD');
  } catch {
    // Moteur JS sans normalize : les accents restent, la comparaison aussi.
  }
  return t
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Identifiant aleatoire au format UUID v4. Utilise crypto.randomUUID ou
 * getRandomValues quand la plateforme les fournit (navigateur, Electron,
 * React Native avec react-native-get-random-values).
 */
export function genererIdentifiant(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } })
    .crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  const octets = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(octets);
  } else {
    for (let i = 0; i < 16; i += 1) {
      octets[i] = Math.floor(Math.random() * 256);
    }
  }
  octets[6] = (octets[6] & 0x0f) | 0x40;
  octets[8] = (octets[8] & 0x3f) | 0x80;
  const hex = Array.from(octets, o => o.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Taille en octets UTF-8 d'une chaine, sans TextEncoder. */
export function octetsUtf8(texte: string): number {
  let n = 0;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else {
      n += 3;
    }
  }
  return n;
}

/** Journal injectable : silencieux par defaut. */
export type Journal = (message: string) => void;
export const journalMuet: Journal = () => {};

export const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
