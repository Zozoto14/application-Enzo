import { aleatoireDeterministe } from './aleatoire';
import {
  formatValide,
  genererCodeRecuperation,
  normaliserCode,
} from './codes-recuperation';

describe('genererCodeRecuperation', () => {
  it('produit quatre groupes de quatre caractères', () => {
    const code = genererCodeRecuperation(aleatoireDeterministe(1));
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('porte 80 bits d’entropie', () => {
    const code = genererCodeRecuperation(aleatoireDeterministe(1));
    // 16 caractères base32 = 16 x 5 bits.
    expect(normaliserCode(code)).toHaveLength(16);
  });

  it('n’emploie aucun caractère ambigu', () => {
    for (let graine = 1; graine <= 50; graine++) {
      expect(genererCodeRecuperation(aleatoireDeterministe(graine))).not.toMatch(
        /[ILOU]/,
      );
    }
  });

  it('produit des codes distincts', () => {
    const codes = Array.from({ length: 20 }, (_, i) =>
      genererCodeRecuperation(aleatoireDeterministe(i + 1)),
    );
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('normaliserCode', () => {
  it('rend équivalentes les lectures d’un même code', () => {
    const code = genererCodeRecuperation(aleatoireDeterministe(3));
    expect(normaliserCode(code.toLowerCase())).toBe(normaliserCode(code));
    expect(normaliserCode(code.replace(/-/g, ' '))).toBe(normaliserCode(code));
    expect(normaliserCode(` ${code} `)).toBe(normaliserCode(code));
  });
});

describe('formatValide', () => {
  it('accepte un code bien formé, quelle que soit sa présentation', () => {
    const code = genererCodeRecuperation(aleatoireDeterministe(4));
    expect(formatValide(code)).toBe(true);
    expect(formatValide(code.toLowerCase())).toBe(true);
    expect(formatValide(normaliserCode(code))).toBe(true);
  });

  it('rejette un code de mauvaise longueur', () => {
    expect(formatValide('ABCD-EFGH')).toBe(false);
    expect(formatValide('')).toBe(false);
  });
});
