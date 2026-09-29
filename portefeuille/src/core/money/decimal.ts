/**
 * Arithmétique décimale exacte, adossée à des BigInt.
 *
 * Aucun calcul financier ne doit passer par un `number` flottant : en IEEE 754,
 * 0.1 + 0.2 !== 0.3. Sur un PRU, l'erreur se propage à la plus-value, donc à
 * l'impôt estimé. Toutes les valeurs sont donc stockées en entier, à l'échelle
 * fixe SCALE, et ne sont converties en `number` qu'au moment de l'affichage.
 */

/** Nombre de décimales conservées en interne. */
const SCALE = 8;
const FACTEUR = 10n ** BigInt(SCALE);

const MOTIF_DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;

/** Division entière avec arrondi au plus proche, les demis s'éloignant de zéro. */
function diviserArrondi(numerateur: bigint, denominateur: bigint): bigint {
  if (denominateur === 0n) {
    throw new RangeError('Division par zéro');
  }
  const negatif = numerateur < 0n !== denominateur < 0n;
  const n = numerateur < 0n ? -numerateur : numerateur;
  const d = denominateur < 0n ? -denominateur : denominateur;
  const quotient = n / d;
  const reste = n % d;
  const arrondi = reste * 2n >= d ? quotient + 1n : quotient;
  return negatif ? -arrondi : arrondi;
}

/** Convertit une chaîne décimale en représentation interne. */
function depuisChaine(texte: string): bigint {
  const nettoye = texte.trim();
  if (!MOTIF_DECIMAL.test(nettoye)) {
    throw new TypeError(`Valeur décimale invalide : "${texte}"`);
  }
  const negatif = nettoye.startsWith('-');
  const sansSigne = nettoye.replace(/^[+-]/, '');
  const [entiere, decimales = ''] = sansSigne.split('.');

  // On garde SCALE décimales, en arrondissant la première décimale de trop.
  const tronquees = decimales.slice(0, SCALE).padEnd(SCALE, '0');
  let brut = BigInt(entiere) * FACTEUR + BigInt(tronquees || '0');
  if (decimales.length > SCALE && Number(decimales[SCALE]) >= 5) {
    brut += 1n;
  }
  return negatif ? -brut : brut;
}

export type ValeurDecimale = Decimal | string | number | bigint;

export class Decimal {
  /** Valeur réelle multipliée par 10^SCALE. */
  private constructor(readonly brut: bigint) {}

  static readonly ZERO = new Decimal(0n);
  static readonly UN = new Decimal(FACTEUR);

  static de(valeur: ValeurDecimale): Decimal {
    if (valeur instanceof Decimal) {
      return valeur;
    }
    if (typeof valeur === 'bigint') {
      return new Decimal(valeur * FACTEUR);
    }
    if (typeof valeur === 'number') {
      if (!Number.isFinite(valeur)) {
        throw new TypeError(`Valeur décimale non finie : ${valeur}`);
      }
      // toFixed évite la notation exponentielle (1e-7) que le motif rejetterait.
      return new Decimal(depuisChaine(valeur.toFixed(SCALE)));
    }
    return new Decimal(depuisChaine(valeur));
  }

  static somme(valeurs: readonly ValeurDecimale[]): Decimal {
    return valeurs.reduce<Decimal>((total, v) => total.add(Decimal.de(v)), Decimal.ZERO);
  }

  static min(a: ValeurDecimale, b: ValeurDecimale): Decimal {
    const da = Decimal.de(a);
    const db = Decimal.de(b);
    return da.lte(db) ? da : db;
  }

  static max(a: ValeurDecimale, b: ValeurDecimale): Decimal {
    const da = Decimal.de(a);
    const db = Decimal.de(b);
    return da.gte(db) ? da : db;
  }

  add(autre: ValeurDecimale): Decimal {
    return new Decimal(this.brut + Decimal.de(autre).brut);
  }

  sub(autre: ValeurDecimale): Decimal {
    return new Decimal(this.brut - Decimal.de(autre).brut);
  }

  mul(autre: ValeurDecimale): Decimal {
    return new Decimal(diviserArrondi(this.brut * Decimal.de(autre).brut, FACTEUR));
  }

  div(autre: ValeurDecimale): Decimal {
    return new Decimal(diviserArrondi(this.brut * FACTEUR, Decimal.de(autre).brut));
  }

  neg(): Decimal {
    return new Decimal(-this.brut);
  }

  abs(): Decimal {
    return this.brut < 0n ? this.neg() : this;
  }

  /** -1, 0 ou 1. */
  compare(autre: ValeurDecimale): -1 | 0 | 1 {
    const b = Decimal.de(autre).brut;
    if (this.brut < b) return -1;
    if (this.brut > b) return 1;
    return 0;
  }

  eq(autre: ValeurDecimale): boolean {
    return this.compare(autre) === 0;
  }
  lt(autre: ValeurDecimale): boolean {
    return this.compare(autre) < 0;
  }
  lte(autre: ValeurDecimale): boolean {
    return this.compare(autre) <= 0;
  }
  gt(autre: ValeurDecimale): boolean {
    return this.compare(autre) > 0;
  }
  gte(autre: ValeurDecimale): boolean {
    return this.compare(autre) >= 0;
  }

  estZero(): boolean {
    return this.brut === 0n;
  }
  estNegatif(): boolean {
    return this.brut < 0n;
  }
  estPositif(): boolean {
    return this.brut > 0n;
  }

  /** Arrondit à `decimales` chiffres après la virgule, demis éloignés de zéro. */
  arrondiA(decimales: number): Decimal {
    if (!Number.isInteger(decimales) || decimales < 0 || decimales > SCALE) {
      throw new RangeError(`Nombre de décimales hors limites : ${decimales}`);
    }
    const pas = 10n ** BigInt(SCALE - decimales);
    return new Decimal(diviserArrondi(this.brut, pas) * pas);
  }

  /** Arrondi monétaire au centime. */
  enCentimes(): Decimal {
    return this.arrondiA(2);
  }

  toFixed(decimales: number): string {
    const arrondi = this.arrondiA(decimales);
    const negatif = arrondi.brut < 0n;
    const absolu = negatif ? -arrondi.brut : arrondi.brut;
    const chiffres = absolu.toString().padStart(SCALE + 1, '0');
    const entiere = chiffres.slice(0, chiffres.length - SCALE);
    const partieDecimale = chiffres.slice(chiffres.length - SCALE).slice(0, decimales);
    const signe = negatif && (absolu !== 0n) ? '-' : '';
    return decimales === 0 ? `${signe}${entiere}` : `${signe}${entiere}.${partieDecimale}`;
  }

  toString(): string {
    const complet = this.toFixed(SCALE);
    return complet.includes('.') ? complet.replace(/\.?0+$/, '') : complet;
  }

  /** À n'utiliser que pour l'affichage ou les graphiques, jamais pour un calcul. */
  toNumber(): number {
    return Number(this.toString());
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Raccourci de lecture : `d('12.34')`. */
export const d = (valeur: ValeurDecimale): Decimal => Decimal.de(valeur);
