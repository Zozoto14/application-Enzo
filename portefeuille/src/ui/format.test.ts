import { d } from '../core/money/decimal';
import {
  formaterDate,
  formaterMontant,
  formaterPourcentage,
  formaterQuantite,
  formaterTypeCompte,
  tendance,
} from './format';

const FINE = ' ';
const INSEC = ' ';

describe('formaterMontant', () => {
  it('groupe les milliers et pose la virgule décimale', () => {
    expect(formaterMontant(d('11966.07'))).toBe(`11${FINE}966,07${INSEC}€`);
  });

  it('gère les montants sans millier', () => {
    expect(formaterMontant(d('102.39'))).toBe(`102,39${INSEC}€`);
  });

  it('groupe les millions', () => {
    expect(formaterMontant(d('1234567.89'))).toBe(`1${FINE}234${FINE}567,89${INSEC}€`);
  });

  it('place le signe avant le nombre, pas avant le symbole', () => {
    expect(formaterMontant(d('-17.92'))).toBe(`-17,92${INSEC}€`);
  });

  it('force le signe quand on le demande', () => {
    expect(formaterMontant(d('17.92'), { signeExplicite: true })).toBe(
      `+17,92${INSEC}€`,
    );
    // Un négatif ne doit pas se retrouver avec deux signes.
    expect(formaterMontant(d('-17.92'), { signeExplicite: true })).toBe(
      `-17,92${INSEC}€`,
    );
  });

  it('arrondit à la demande sans toucher à la valeur', () => {
    expect(formaterMontant(d('5.1195'))).toBe(`5,12${INSEC}€`);
    expect(formaterMontant(d('5.1195'), { decimales: 4 })).toBe(`5,1195${INSEC}€`);
    expect(formaterMontant(d('5.1195'), { decimales: 0 })).toBe(`5${INSEC}€`);
  });

  it('peut omettre la devise', () => {
    expect(formaterMontant(d('20'), { devise: null })).toBe('20,00');
  });

  it('affiche zéro sans signe', () => {
    expect(formaterMontant(d('0'), { signeExplicite: true })).toBe(`0,00${INSEC}€`);
  });
});

describe('formaterPourcentage', () => {
  it('rend le signe toujours explicite', () => {
    // Un gain et une perte doivent se distinguer sans recourir à la couleur.
    expect(formaterPourcentage(d('2.4'))).toBe(`+2,40${INSEC}%`);
    expect(formaterPourcentage(d('-17.5'))).toBe(`-17,50${INSEC}%`);
  });

  it('affiche un tiret quand le pourcentage n’a pas de sens', () => {
    expect(formaterPourcentage(null)).toBe('—');
  });
});

describe('formaterQuantite', () => {
  it('supprime les décimales inutiles', () => {
    expect(formaterQuantite(d('20'))).toBe('20');
    expect(formaterQuantite(d('17.00'))).toBe('17');
  });

  it('conserve une fraction de part', () => {
    expect(formaterQuantite(d('0.5'))).toBe('0,5');
    expect(formaterQuantite(d('1.2345'))).toBe('1,2345');
  });
});

describe('formaterDate', () => {
  it('passe de l’ISO au format français', () => {
    expect(formaterDate('2026-08-03')).toBe('03/08/2026');
  });

  it('laisse intacte une chaîne qui n’est pas une date ISO', () => {
    expect(formaterDate('hier')).toBe('hier');
  });
});

describe('tendance', () => {
  it('classe les variations', () => {
    expect(tendance(d('1'))).toBe('hausse');
    expect(tendance(d('-1'))).toBe('baisse');
    expect(tendance(d('0'))).toBe('neutre');
    expect(tendance(null)).toBe('neutre');
  });
});

describe('formaterTypeCompte', () => {
  it('donne des libellés lisibles', () => {
    expect(formaterTypeCompte('PEA')).toBe('PEA');
    expect(formaterTypeCompte('PEA_PME')).toBe('PEA-PME');
    expect(formaterTypeCompte('CTO')).toBe('Compte-titres');
  });

  it('retombe sur la valeur brute pour un type inconnu', () => {
    expect(formaterTypeCompte('LIVRET')).toBe('LIVRET');
  });
});
