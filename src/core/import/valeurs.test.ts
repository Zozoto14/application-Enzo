import { ErreurConversion, normaliser, parseDate, parseNombre } from './valeurs';

describe('parseNombre', () => {
  describe('format français', () => {
    it('lit une virgule décimale et des milliers espacés', () => {
      expect(parseNombre('1 234,56').toString()).toBe('1234.56');
      expect(parseNombre('1 234,56').toString()).toBe('1234.56'); // espace insécable
      expect(parseNombre('1 234,56').toString()).toBe('1234.56'); // espace fine
    });

    it('lit un point comme séparateur de milliers quand une virgule est présente', () => {
      expect(parseNombre('1.234,56').toString()).toBe('1234.56');
    });

    it('traite le point comme décimal en l’absence de virgule', () => {
      // Sans cette règle, « 1234.56 » deviendrait 123456.
      expect(parseNombre('1234.56').toString()).toBe('1234.56');
    });

    it('accepte les symboles monétaires', () => {
      expect(parseNombre('1 005,00 €').toString()).toBe('1005');
    });
  });

  describe('signes', () => {
    it('lit un signe préfixé', () => {
      expect(parseNombre('-1 005,00').toString()).toBe('-1005');
    });

    it('lit un signe suffixé', () => {
      expect(parseNombre('1 005,00-').toString()).toBe('-1005');
    });

    it('lit un négatif noté entre parenthèses', () => {
      expect(parseNombre('(1 005,00)').toString()).toBe('-1005');
    });
  });

  it('renvoie zéro pour une cellule vide', () => {
    expect(parseNombre('').estZero()).toBe(true);
    expect(parseNombre('   ').estZero()).toBe(true);
    expect(parseNombre('-').estZero()).toBe(true);
  });

  it('lit le format anglo-saxon', () => {
    expect(parseNombre('1,234.56', 'EN').toString()).toBe('1234.56');
    expect(parseNombre('1234.56', 'EN').toString()).toBe('1234.56');
  });

  it('signale un montant illisible', () => {
    expect(() => parseNombre('mille euros')).toThrow(ErreurConversion);
  });
});

describe('parseDate', () => {
  it('convertit une date française en ISO', () => {
    expect(parseDate('15/03/2024')).toBe('2024-03-15');
    expect(parseDate('5/3/2024')).toBe('2024-03-05');
  });

  it('accepte les autres formats déclarés', () => {
    expect(parseDate('2024-03-15', 'AAAA-MM-JJ')).toBe('2024-03-15');
    expect(parseDate('15-03-2024', 'JJ-MM-AAAA')).toBe('2024-03-15');
  });

  it('rejette une date au mauvais format', () => {
    expect(() => parseDate('2024-03-15')).toThrow(/format attendu/);
  });

  it('rejette une date qui n’existe pas', () => {
    expect(() => parseDate('31/02/2024')).toThrow(ErreurConversion);
    expect(() => parseDate('15/13/2024')).toThrow(ErreurConversion);
  });

  it('accepte le 29 février d’une année bissextile', () => {
    expect(parseDate('29/02/2024')).toBe('2024-02-29');
    expect(() => parseDate('29/02/2023')).toThrow(ErreurConversion);
  });
});

describe('normaliser', () => {
  it('supprime accents et casse pour comparer des libellés', () => {
    expect(normaliser('Virement reçu')).toBe('virement recu');
    expect(normaliser('  ACHAT Comptant ')).toBe('achat comptant');
  });
});
