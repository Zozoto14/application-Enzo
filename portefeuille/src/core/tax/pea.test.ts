import { d } from '../money/decimal';
import { compte } from '../testing/fixtures';
import {
  PLAFOND_PEA,
  ancienneteEnAnnees,
  estExonereImpotRevenu,
  etatPlafond,
  etatPlafondGlobal,
  plafondDe,
} from './pea';

describe('ancienneteEnAnnees', () => {
  it('ne compte que les années révolues', () => {
    expect(ancienneteEnAnnees('2019-03-15', '2024-03-14')).toBe(4);
    expect(ancienneteEnAnnees('2019-03-15', '2024-03-15')).toBe(5);
    expect(ancienneteEnAnnees('2019-03-15', '2024-03-16')).toBe(5);
  });

  it('gère le passage d’année', () => {
    expect(ancienneteEnAnnees('2019-12-31', '2024-01-01')).toBe(4);
    expect(ancienneteEnAnnees('2019-01-01', '2024-12-31')).toBe(5);
  });

  it('renvoie une valeur négative avant l’ouverture', () => {
    expect(ancienneteEnAnnees('2024-06-01', '2023-06-01')).toBe(-1);
  });

  it('rejette une date mal formée', () => {
    expect(() => ancienneteEnAnnees('15/03/2019', '2024-03-15')).toThrow(TypeError);
  });
});

describe('estExonereImpotRevenu', () => {
  const pea = compte({ dateOuverture: '2019-03-15' });

  it('exonère à partir de 5 ans révolus', () => {
    expect(estExonereImpotRevenu(pea, '2024-03-14')).toBe(false);
    expect(estExonereImpotRevenu(pea, '2024-03-15')).toBe(true);
  });

  it('ne s’applique jamais à un CTO', () => {
    const cto = compte({ id: 'cto', type: 'CTO', dateOuverture: '2010-01-01' });
    expect(estExonereImpotRevenu(cto, '2026-01-01')).toBe(false);
  });
});

describe('etatPlafond', () => {
  it('calcule la capacité de versement restante', () => {
    const etat = etatPlafond(compte(), d('140000'));

    expect(etat.plafond.eq(PLAFOND_PEA)).toBe(true);
    expect(etat.restant.toString()).toBe('10000');
    expect(etat.depassement.toString()).toBe('0');
    expect(etat.pourcentageUtilise.toFixed(2)).toBe('93.33');
  });

  it('signale un dépassement sans renvoyer de restant négatif', () => {
    const etat = etatPlafond(compte(), d('160000'));

    expect(etat.restant.toString()).toBe('0');
    expect(etat.depassement.toString()).toBe('10000');
  });

  it('applique 225 000 € au PEA-PME', () => {
    const etat = etatPlafond(compte({ id: 'pme', type: 'PEA_PME' }), d('100000'));
    expect(etat.plafond.toString()).toBe('225000');
    expect(etat.restant.toString()).toBe('125000');
  });

  it('refuse un compte sans plafond', () => {
    expect(() => etatPlafond(compte({ id: 'cto', type: 'CTO' }), d('1000'))).toThrow(
      TypeError,
    );
  });

  it('ne restaure pas de capacité après un retrait', () => {
    // Le suivi porte sur les versements cumulés : un retrait ne les efface pas.
    const etat = etatPlafond(compte(), d('150000'));
    expect(etat.restant.toString()).toBe('0');
  });
});

describe('plafondDe', () => {
  it('renvoie null pour un CTO, qui n’est pas plafonné', () => {
    expect(plafondDe('CTO')).toBeNull();
  });
});

describe('etatPlafondGlobal', () => {
  it('cumule PEA et PEA-PME sous un plafond commun de 225 000 €', () => {
    const etat = etatPlafondGlobal([
      { compte: compte(), versementsCumules: d('150000') },
      {
        compte: compte({ id: 'pme', type: 'PEA_PME' }),
        versementsCumules: d('100000'),
      },
    ]);

    expect(etat.verse.toString()).toBe('250000');
    expect(etat.depassement.toString()).toBe('25000');
    expect(etat.restant.toString()).toBe('0');
  });

  it('ignore les comptes-titres ordinaires', () => {
    const etat = etatPlafondGlobal([
      { compte: compte(), versementsCumules: d('50000') },
      {
        compte: compte({ id: 'cto', type: 'CTO' }),
        versementsCumules: d('300000'),
      },
    ]);

    expect(etat.verse.toString()).toBe('50000');
    expect(etat.restant.toString()).toBe('175000');
  });
});
