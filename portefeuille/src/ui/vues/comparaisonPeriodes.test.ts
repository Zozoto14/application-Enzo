import { d } from '../../core/money/decimal';
import { achat, dividende, versement } from '../../core/testing/fixtures';
import { mesurerPeriode, periodesComparees } from './comparaisonPeriodes';

describe('comparer deux périodes', () => {
  it('compare l’année à la même période de l’an dernier', () => {
    const { actuelle, precedente } = periodesComparees('annee', '2026-09-26');
    expect(actuelle).toMatchObject({ debut: '2026-01-01', fin: '2026-09-26' });
    expect(precedente).toMatchObject({ debut: '2025-01-01', fin: '2025-09-26', libelle: '2025 (même période)' });
  });

  it('compare le mois aux mêmes jours du mois précédent, et le trimestre à même durée', () => {
    expect(periodesComparees('mois', '2026-03-31').precedente).toMatchObject({ debut: '2026-02-01', fin: '2026-02-28' });
    const trimestre = periodesComparees('trimestre', '2026-09-26');
    expect(trimestre.actuelle).toMatchObject({ debut: '2026-07-01', libelle: 'T3 2026' });
    expect(trimestre.precedente).toMatchObject({ debut: '2026-04-01', fin: '2026-06-27' });
    expect(periodesComparees('trimestre', '2026-02-10').precedente.libelle).toBe('T4 2025 (même durée)');
  });

  it('mesure performance, gain, dividendes et versements sur une période', () => {
    const points = [
      { date: '2025-12-31', valeurTotale: d('1000'), fluxExterne: d('0') },
      { date: '2026-03-31', valeurTotale: d('1600'), fluxExterne: d('500') },
      { date: '2026-09-26', valeurTotale: d('1760'), fluxExterne: d('0') },
    ];
    const transactions = [versement('2026-03-15', 500), achat('2026-03-16', 2, 100, 1), dividende('2026-05-20', 30), versement('2025-06-01', 999)];
    const mesures = mesurerPeriode({ debut: '2026-01-01', fin: '2026-09-26', libelle: '' }, points, transactions);
    // (1600 − 500) / 1000 = +10 %, puis 1760 / 1600 = +10 % : +21 %.
    expect(mesures.performance).toBeCloseTo(21);
    expect(mesures.gain).toBeCloseTo(260);
    expect(mesures.dividendes).toBe(30);
    expect(mesures.versementsNets).toBe(500);
    expect(mesures.achats).toBe(201);
    expect(mesures.operations).toBe(3);
  });

  it('ne donne pas de performance sans valorisations', () => {
    expect(mesurerPeriode({ debut: '2026-01-01', fin: '2026-09-26', libelle: '' }, [], []).performance).toBeNull();
  });
});
