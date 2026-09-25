import { marcheOuvert } from './marche';

describe('ouverture du marché', () => {
  it('est ouvert un mardi à 11 h, heure de Paris', () => {
    expect(marcheOuvert(new Date('2026-09-22T09:00:00Z'))).toBe(true);
  });
  it('est fermé le soir et le week-end', () => {
    expect(marcheOuvert(new Date('2026-09-22T17:00:00Z'))).toBe(false);
    expect(marcheOuvert(new Date('2026-09-26T10:00:00Z'))).toBe(false);
  });
});
