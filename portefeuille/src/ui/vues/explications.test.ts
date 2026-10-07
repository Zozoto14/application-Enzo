import { EXPLICATIONS, explication, type CleExplication } from './explications';

const cles = Object.keys(EXPLICATIONS) as CleExplication[];

describe('catalogue des explications', () => {
  it('couvre les indicateurs affichés', () => {
    // Si un indicateur du tableau de bord disparaît de cette liste, c'est
    // qu'il s'affiche sans explication.
    for (const attendue of [
      'valeurTotale',
      'plusValueLatente',
      'plusValueRealisee',
      'pru',
      'twr',
      'tri',
      'drawdown',
      'plafondPEA',
      'impotPEA',
      'pfu',
    ] as CleExplication[]) {
      expect(cles).toContain(attendue);
    }
  });

  it('donne un titre et une phrase courte à chaque entrée', () => {
    for (const cle of cles) {
      const entree = explication(cle);
      expect(entree.titre.length).toBeGreaterThan(2);
      expect(entree.court.length).toBeGreaterThan(20);
      expect(entree.detail.length).toBeGreaterThan(entree.court.length);
    }
  });

  it('garde la phrase courte réellement courte', () => {
    // Elle s'affiche sous le chiffre : au-delà, elle ne se lit plus d'un coup.
    for (const cle of cles) {
      expect(explication(cle).court.length).toBeLessThanOrEqual(110);
    }
  });

  it('termine chaque texte par une ponctuation', () => {
    // Le guillemet fermant francais suit le point, precede d'une espace
    // insecable : « ... ? »
    for (const cle of cles) {
      const entree = explication(cle);
      expect(entree.court.trimEnd()).toMatch(/[.!?][\s  ]*[»"’]?$/);
      expect(entree.detail.trimEnd()).toMatch(/[.!?][\s  ]*[»"’]?$/);
      if (entree.piege) {
        expect(entree.piege.trimEnd()).toMatch(/[.!?][\s  ]*[»"’]?$/);
      }
    }
  });
});

describe('pièges signalés', () => {
  it('avertit que le PEA n’est pas imposé à la vente', () => {
    // C'est la confusion la plus coûteuse pour un détenteur de PEA.
    expect(explication('impotPEA').piege).toMatch(/aucune ne l/);
    expect(explication('impotPEA').court).toMatch(/retrait/);
  });

  it('avertit que l’exonération PEA ne couvre pas les prélèvements sociaux', () => {
    expect(explication('anterioritePEA').piege).toMatch(/17,2/);
  });

  it('avertit qu’une plus-value latente n’est pas imposée', () => {
    expect(explication('plusValueLatente').piege).toMatch(/jamais imposée/);
  });

  it('explique pourquoi un rendement annualisé court est refusé', () => {
    expect(explication('cagr').piege).toMatch(/période courte|Annualiser/);
    expect(explication('tri').piege).toMatch(/trois mois/);
  });

  it('explique le refus d’afficher un TWR aberrant', () => {
    expect(explication('twr').piege).toMatch(/refuse/);
  });

  it('rappelle que le PRU français est en moyenne pondérée', () => {
    expect(explication('pru').detail).toMatch(/moyenne pondérée/);
    expect(explication('pru').piege).toMatch(/FIFO/);
  });

  it('rappelle que le plafond PEA porte sur les versements', () => {
    expect(explication('plafondPEA').detail).toMatch(/versements/);
  });
});
