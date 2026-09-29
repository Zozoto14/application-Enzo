import { COMPTES_EXEMPLE } from '../../fondamentaux/exemples';
import { lireComptes } from '../../fondamentaux/yahoo';
import { formaterCellule, seriesComparees } from './comparaisonFinanciere';

const comptes = lireComptes(COMPTES_EXEMPLE);
const societes = [
  { symbole: 'EXA.PA', nom: 'Exemple Industries SA', comptes },
  { symbole: 'AUT.PA', nom: 'Autre', comptes },
  { symbole: 'VIDE', nom: 'En cours de chargement', chargement: true },
];

describe('comparateur financier', () => {
  it('fait une courbe par société et par poste', () => {
    const series = seriesComparees(societes, 'Compte de résultat', ['Chiffre d’affaires', 'Résultat net'], false);
    expect(series).toHaveLength(4);
    expect(series[0].nom).toBe('Exemple Industries SA · Chiffre d’affaires');
    expect(series[0].points[0]).toEqual({ date: '2019-12-31', valeur: 19e9 });
  });

  it('ramène chaque courbe à 100 en base 100', () => {
    const [serie] = seriesComparees(societes, 'Compte de résultat', ['Chiffre d’affaires'], true);
    expect(serie.nom).toBe('Exemple Industries SA');
    expect(serie.points[0].valeur).toBe(100);
    expect(serie.points[6].valeur).toBeCloseTo((25.3 / 19) * 100);
  });

  it('écrit les cellules dans l’unité choisie', () => {
    expect(formaterCellule(25_300_000_000, 'M', 0, false)).toBe('25 300');
    expect(formaterCellule(25_300_000_000, 'auto', 1, false)).toBe('25,3 Md');
    expect(formaterCellule(3.05, 'M', 0, true)).toBe('3,05');
    expect(formaterCellule(null, 'M', 0, false)).toBe('—');
  });
});
