import { d } from '../money/decimal';
import { compte } from '../testing/fixtures';
import {
  TAUX_PFU,
  assietteRetraitPEA,
  impotSurGain,
  impotSurGainCTO,
  impotSurGainPEA,
  impotSurRetraitPEA,
} from './impots';

describe('impotSurGainCTO', () => {
  it('applique le PFU de 30 % par défaut', () => {
    const impot = impotSurGainCTO(d('1000'));

    expect(impot.impotRevenu.toString()).toBe('128');
    expect(impot.prelevementsSociaux.toString()).toBe('172');
    expect(impot.total.toString()).toBe('300');
    expect(impot.tauxEffectif!.toFixed(2)).toBe('30.00');
  });

  it('applique le taux marginal en cas d’option pour le barème', () => {
    const impot = impotSurGainCTO(d('1000'), {
      option: 'BAREME',
      tauxMarginal: d('0.41'),
    });

    expect(impot.impotRevenu.toString()).toBe('410');
    expect(impot.prelevementsSociaux.toString()).toBe('172');
    expect(impot.total.toString()).toBe('582');
  });

  it('exige le taux marginal pour le barème', () => {
    expect(() => impotSurGainCTO(d('1000'), { option: 'BAREME' })).toThrow(TypeError);
  });

  it('ne taxe pas une moins-value et rappelle son imputation', () => {
    const impot = impotSurGainCTO(d('-500'));

    expect(impot.total.estZero()).toBe(true);
    expect(impot.assiette.estZero()).toBe(true);
    expect(impot.tauxEffectif).toBeNull();
    expect(impot.explication).toMatch(/reportable 10 ans/);
  });

  it('constante TAUX_PFU cohérente avec ses deux composantes', () => {
    expect(TAUX_PFU.toString()).toBe('0.3');
  });
});

describe('impotSurGainPEA', () => {
  it('taxe à 30 % avant 5 ans', () => {
    const impot = impotSurGainPEA(d('1000'), false);

    expect(impot.total.toString()).toBe('300');
    expect(impot.explication).toMatch(/clôture du plan/);
  });

  it('ne laisse que les prélèvements sociaux après 5 ans', () => {
    const impot = impotSurGainPEA(d('1000'), true);

    expect(impot.impotRevenu.estZero()).toBe(true);
    expect(impot.prelevementsSociaux.toString()).toBe('172');
    expect(impot.total.toString()).toBe('172');
  });
});

describe('impotSurGain', () => {
  it('aiguille selon l’enveloppe et l’antériorité', () => {
    const pea = compte({ dateOuverture: '2019-03-15' });
    const cto = compte({ id: 'cto', type: 'CTO' });

    expect(impotSurGain(pea, d('1000'), '2024-03-15').total.toString()).toBe('172');
    expect(impotSurGain(pea, d('1000'), '2024-03-14').total.toString()).toBe('300');
    expect(impotSurGain(cto, d('1000'), '2024-03-15').total.toString()).toBe('300');
  });
});

describe('assietteRetraitPEA', () => {
  it('ne taxe qu’une quote-part du gain du plan, pas la plus-value du titre vendu', () => {
    // Plan valant 20 000 € pour 15 000 € versés : 25 % de la valeur est du gain.
    // Un retrait de 5 000 € porte donc sur 1 250 € de gain.
    const assiette = assietteRetraitPEA({
      valeurLiquidative: d('20000'),
      versementsNets: d('15000'),
      montantRetrait: d('5000'),
    });

    expect(assiette.toString()).toBe('1250');
  });

  it('ne taxe rien quand le plan est en moins-value', () => {
    const assiette = assietteRetraitPEA({
      valeurLiquidative: d('12000'),
      versementsNets: d('15000'),
      montantRetrait: d('5000'),
    });

    expect(assiette.estZero()).toBe(true);
  });

  it('plafonne le retrait à la valeur liquidative', () => {
    const assiette = assietteRetraitPEA({
      valeurLiquidative: d('20000'),
      versementsNets: d('15000'),
      montantRetrait: d('50000'),
    });

    expect(assiette.toString()).toBe('5000'); // la totalité du gain, pas davantage
  });

  it('gère un plan vide sans diviser par zéro', () => {
    expect(
      assietteRetraitPEA({
        valeurLiquidative: d('0'),
        versementsNets: d('0'),
        montantRetrait: d('100'),
      }).estZero(),
    ).toBe(true);
  });
});

describe('impotSurRetraitPEA', () => {
  it('combine quote-part de gain et antériorité du plan', () => {
    const pea = compte({ dateOuverture: '2019-03-15' });
    const retrait = {
      valeurLiquidative: d('20000'),
      versementsNets: d('15000'),
      montantRetrait: d('5000'),
    };

    // Plan de plus de 5 ans : 1 250 € x 17,2 %
    expect(impotSurRetraitPEA(pea, retrait, '2024-06-01').total.toString()).toBe('215');
    // Plan de moins de 5 ans : 1 250 € x 30 %
    expect(impotSurRetraitPEA(pea, retrait, '2024-03-01').total.toString()).toBe('375');
  });

  it('refuse un compte qui n’est pas un PEA', () => {
    expect(() =>
      impotSurRetraitPEA(
        compte({ id: 'cto', type: 'CTO' }),
        {
          valeurLiquidative: d('20000'),
          versementsNets: d('15000'),
          montantRetrait: d('5000'),
        },
        '2024-06-01',
      ),
    ).toThrow(TypeError);
  });
});
