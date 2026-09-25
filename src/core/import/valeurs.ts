/**
 * Conversion des valeurs textuelles d'un relevé vers les types du domaine.
 *
 * Les relevés français écrivent « 1 234,56 » avec une espace insécable comme
 * séparateur de milliers, parfois un signe après le nombre, parfois des
 * parenthèses pour le négatif. Decimal, lui, n'accepte qu'une forme stricte :
 * toute la tolérance est concentrée ici.
 */

import { Decimal } from '../money/decimal';

export type FormatNombre = 'FR' | 'EN';
export type FormatDate = 'JJ/MM/AAAA' | 'AAAA-MM-JJ' | 'JJ-MM-AAAA';

export class ErreurConversion extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurConversion';
  }
}

/** Espaces ordinaires, insécables et fines insécables. */
const ESPACES = /[\s  ]/g;

/**
 * Convertit un montant textuel en Decimal.
 * Renvoie zéro pour une cellule vide, ce qui évite d'exiger une colonne de
 * frais dans les relevés qui n'en ont pas.
 */
export function parseNombre(texte: string, format: FormatNombre = 'FR'): Decimal {
  const brut = texte.replace(ESPACES, '').replace(/[€$£]/g, '');
  if (brut === '' || brut === '-') {
    return Decimal.ZERO;
  }

  // Montant négatif noté entre parenthèses : (1 234,56)
  const entreParentheses = /^\((.*)\)$/.exec(brut);
  const sansParentheses = entreParentheses ? entreParentheses[1] : brut;

  // Signe placé après le nombre : 1234,56-
  const signeSuffixe = /^(.*?)([+-])$/.exec(sansParentheses);
  const corps = signeSuffixe ? signeSuffixe[1] : sansParentheses;
  const signe =
    (entreParentheses ? '-' : '') + (signeSuffixe?.[2] === '-' ? '-' : '');

  // En format FR, le point est un séparateur de milliers *seulement* si une
  // virgule décimale est présente. Sans virgule, « 1234.56 » reste un décimal :
  // certains exports bancaires mélangent les deux conventions d'un fichier à
  // l'autre, et supprimer le point à l'aveugle multiplierait le montant par 100.
  const normalise =
    format === 'FR'
      ? corps.includes(',')
        ? corps.replace(/\./g, '').replace(',', '.')
        : corps
      : corps.replace(/,/g, '');

  // Deux signes négatifs s'annulent, un seul subsiste.
  const negatif = (signe.match(/-/g)?.length ?? 0) % 2 === 1;
  const avecSigne = negatif ? `-${normalise.replace(/^[+-]/, '')}` : normalise;

  try {
    return Decimal.de(avecSigne);
  } catch {
    throw new ErreurConversion(`Montant illisible : "${texte}"`);
  }
}

const MOTIFS_DATE: Record<FormatDate, RegExp> = {
  'JJ/MM/AAAA': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'JJ-MM-AAAA': /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  'AAAA-MM-JJ': /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
};

/** Convertit une date de relevé en date ISO (AAAA-MM-JJ). */
export function parseDate(texte: string, format: FormatDate = 'JJ/MM/AAAA'): string {
  const brut = texte.trim();
  const correspondance = MOTIFS_DATE[format].exec(brut);
  if (!correspondance) {
    throw new ErreurConversion(`Date illisible : "${texte}" (format attendu ${format})`);
  }

  const [annee, mois, jour] =
    format === 'AAAA-MM-JJ'
      ? [correspondance[1], correspondance[2], correspondance[3]]
      : [correspondance[3], correspondance[2], correspondance[1]];

  const m = Number(mois);
  const j = Number(jour);
  if (m < 1 || m > 12 || j < 1 || j > 31) {
    throw new ErreurConversion(`Date invalide : "${texte}"`);
  }

  const iso = `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;
  // Contrôle final : le 31/02 passerait les bornes ci-dessus.
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== j) {
    throw new ErreurConversion(`Date inexistante : "${texte}"`);
  }
  return iso;
}

/** Normalise un libellé pour comparaison : sans accents, sans casse. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
