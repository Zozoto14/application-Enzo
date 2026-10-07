import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  ErreurEncodage,
  depuisBase32,
  depuisCrockford,
  egaliteConstante,
  normaliserCrockford,
  versBase32,
  versCrockford,
} from './encodage';

describe('base32 RFC 4648', () => {
  it('reproduit les vecteurs de test de la RFC', () => {
    const vecteurs: Array<[string, string]> = [
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];

    for (const [source, attendu] of vecteurs) {
      expect(versBase32(utf8ToBytes(source))).toBe(attendu);
    }
  });

  it('fait un aller-retour sans perte', () => {
    const octets = Uint8Array.from([0, 1, 127, 128, 255, 42]);
    expect(depuisBase32(versBase32(octets))).toEqual(octets);
  });

  it('tolère minuscules, espaces et remplissage', () => {
    expect(depuisBase32('mzxw6ytboi')).toEqual(utf8ToBytes('foobar'));
    expect(depuisBase32('MZXW 6YTB OI')).toEqual(utf8ToBytes('foobar'));
    expect(depuisBase32('MZXW6YTBOI======')).toEqual(utf8ToBytes('foobar'));
  });

  it('refuse un caractère hors alphabet', () => {
    expect(() => depuisBase32('MZXW0')).toThrow(ErreurEncodage);
  });

  it('gère la chaîne vide', () => {
    expect(versBase32(new Uint8Array(0))).toBe('');
    expect(depuisBase32('')).toEqual(new Uint8Array(0));
  });
});

describe('base32 Crockford', () => {
  it('fait un aller-retour sans perte', () => {
    const octets = Uint8Array.from([17, 200, 3, 99, 255, 0, 1, 2, 3, 4]);
    expect(depuisCrockford(versCrockford(octets))).toEqual(octets);
  });

  it('n’emploie jamais I, L, O ni U', () => {
    const encode = versCrockford(Uint8Array.from({ length: 64 }, (_, i) => i * 4));
    expect(encode).not.toMatch(/[ILOU]/);
  });

  describe('normalisation d’un code recopié à la main', () => {
    it('absorbe la casse et les séparateurs', () => {
      expect(normaliserCrockford('abcd-efgh 1234')).toBe('ABCDEFGH1234');
    });

    it('corrige les confusions de lecture usuelles', () => {
      // Sur un code noté au stylo puis relu des mois plus tard, ces quatre
      // substitutions font la différence entre récupérer et perdre ses données.
      expect(normaliserCrockford('OIL')).toBe('011');
      expect(normaliserCrockford('U')).toBe('V');
    });

    it('rend identiques deux lectures du même code', () => {
      expect(normaliserCrockford('0I2B-4S6T')).toBe(normaliserCrockford('oi2b 4s6t'));
    });
  });
});

describe('egaliteConstante', () => {
  it('compare correctement', () => {
    expect(egaliteConstante('123456', '123456')).toBe(true);
    expect(egaliteConstante('123456', '123457')).toBe(false);
    expect(egaliteConstante('123456', '12345')).toBe(false);
    expect(egaliteConstante('', '')).toBe(true);
  });
});
