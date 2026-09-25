import { intervalleActualisation, libelleIntervalle, marcheOuvert, seanceEnCours } from './marche';

describe('ouverture du marché', () => {
  it('est ouvert un mardi à 11 h, heure de Paris', () => {
    expect(marcheOuvert(new Date('2026-09-22T09:00:00Z'))).toBe(true);
  });
  it('est fermé le soir et le week-end', () => {
    expect(marcheOuvert(new Date('2026-09-22T17:00:00Z'))).toBe(false);
    expect(marcheOuvert(new Date('2026-09-26T10:00:00Z'))).toBe(false);
  });
});

describe('actualisation réglable', () => {
  it('lit le réglage, dix secondes par défaut', () => {
    expect(intervalleActualisation(undefined)).toBe(10);
    expect(intervalleActualisation('30')).toBe(30);
    expect(intervalleActualisation('0')).toBe(0);
    expect(intervalleActualisation('7')).toBe(10);
    expect(libelleIntervalle(300)).toBe('5 min');
    expect(libelleIntervalle(0)).toBe('Jamais');
  });

  it('suit aussi la séance de New York', () => {
    // Mercredi 23 septembre 2026, 20 h à Paris : Paris fermée, New York ouverte.
    const soir = new Date('2026-09-23T18:00:00Z');
    expect(marcheOuvert(soir)).toBe(false);
    expect(seanceEnCours(soir)).toBe(true);
    // 23 h 30 à Paris : tout est fermé.
    expect(seanceEnCours(new Date('2026-09-23T21:30:00Z'))).toBe(false);
  });
});
