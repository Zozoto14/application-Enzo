import { Decimal, d } from './decimal';

describe('Decimal', () => {
  describe('exactitude', () => {
    it('additionne sans erreur de flottant', () => {
      // 0.1 + 0.2 vaut 0.30000000000000004 en IEEE 754.
      expect(d('0.1').add('0.2').toString()).toBe('0.3');
      expect(d('0.1').add('0.2').eq('0.3')).toBe(true);
    });

    it('conserve la précision sur de gros montants', () => {
      expect(d('999999999999.99').add('0.01').toString()).toBe('1000000000000');
    });

    it('multiplie un prix par une quantité fractionnaire sans dérive', () => {
      expect(d('0.07').mul('3').toString()).toBe('0.21');
    });

    it('cumule 100 centimes jusqu’à l’euro exact', () => {
      let total = Decimal.ZERO;
      for (let i = 0; i < 100; i++) {
        total = total.add('0.01');
      }
      expect(total.toString()).toBe('1');
    });
  });

  describe('construction', () => {
    it('accepte chaînes, nombres, bigint et Decimal', () => {
      expect(d('12.5').toString()).toBe('12.5');
      expect(d(12.5).toString()).toBe('12.5');
      expect(d(125n).toString()).toBe('125');
      expect(d(d('12.5')).toString()).toBe('12.5');
    });

    it('arrondit au-delà de 8 décimales', () => {
      expect(d('1.123456789').toString()).toBe('1.12345679');
      expect(d('1.123456781').toString()).toBe('1.12345678');
    });

    it('gère les très petits nombres en notation exponentielle', () => {
      expect(d(1e-7).toString()).toBe('0.0000001');
    });

    it('rejette une valeur non numérique', () => {
      expect(() => d('douze')).toThrow(TypeError);
      expect(() => d('12,5')).toThrow(TypeError);
      expect(() => d(NaN)).toThrow(TypeError);
      expect(() => d(Infinity)).toThrow(TypeError);
    });
  });

  describe('division', () => {
    it('arrondit au 8e chiffre', () => {
      expect(d('1').div('3').toString()).toBe('0.33333333');
      expect(d('2').div('3').toString()).toBe('0.66666667');
    });

    it('refuse la division par zéro', () => {
      expect(() => d('1').div('0')).toThrow(RangeError);
    });

    it('calcule un PRU à partir du coût et de la quantité', () => {
      expect(d('2210').div('20').toString()).toBe('110.5');
    });
  });

  describe('arrondi', () => {
    it('arrondit les demis en s’éloignant de zéro', () => {
      expect(d('0.125').arrondiA(2).toString()).toBe('0.13');
      expect(d('-0.125').arrondiA(2).toString()).toBe('-0.13');
      expect(d('0.005').enCentimes().toString()).toBe('0.01');
    });

    it('formate un montant avec un nombre fixe de décimales', () => {
      expect(d('1234.5').toFixed(2)).toBe('1234.50');
      // Un montant qui s’arrondit à zéro ne doit pas afficher « -0.00 ».
      expect(d('-0.004').toFixed(2)).toBe('0.00');
      expect(d('1234.567').toFixed(0)).toBe('1235');
    });

    it('rejette une précision hors limites', () => {
      expect(() => d('1').arrondiA(-1)).toThrow(RangeError);
      expect(() => d('1').arrondiA(9)).toThrow(RangeError);
    });
  });

  describe('comparaison', () => {
    it('ordonne correctement', () => {
      expect(d('10').gt('9.99')).toBe(true);
      expect(d('-5').lt('0')).toBe(true);
      expect(d('3').lte('3')).toBe(true);
      expect(d('3').gte('3')).toBe(true);
      expect(d('0').estZero()).toBe(true);
      expect(d('-0.0001').estNegatif()).toBe(true);
    });

    it('expose min, max et somme', () => {
      expect(Decimal.min('3', '7').toString()).toBe('3');
      expect(Decimal.max('3', '7').toString()).toBe('7');
      expect(Decimal.somme(['1.10', '2.20', '3.30']).toString()).toBe('6.6');
      expect(Decimal.somme([]).toString()).toBe('0');
    });
  });

  it('sérialise en chaîne pour préserver la précision en JSON', () => {
    expect(JSON.stringify({ montant: d('110.5') })).toBe('{"montant":"110.5"}');
  });
});
