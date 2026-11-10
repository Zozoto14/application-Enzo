import {
  ajouterJours,
  ajouterMois,
  analyserDate,
  analyserHeure,
  aujourdhui,
  ecrireValeur,
  estJour,
  formaterLisible,
  formaterSaisie,
  grilleMois,
  jourPermis,
  jourRaccourci,
  lireInstantMural,
  lireValeur,
  periodeRaccourci,
  arrondirHeure,
} from './logique';

const REF = '2026-11-10'; // mardi

describe('saisie des dates', () => {
  it.each([
    ['09/11/2026', '2026-11-09'],
    ['9/11', '2026-11-09'],
    ['9/11/26', '2026-11-09'],
    ['9.11.2026', '2026-11-09'],
    ['9-11-2026', '2026-11-09'],
    ['9 11 2026', '2026-11-09'],
    ['09112026', '2026-11-09'],
    ['091126', '2026-11-09'],
    ['9 nov', '2026-11-09'],
    ['9 nov.', '2026-11-09'],
    ['9 novembre 2026', '2026-11-09'],
    ['lundi 9 novembre 2026', '2026-11-09'],
    ['Nov 9', '2026-11-09'],
    ['9th November 2027', '2027-11-09'],
    ['1er mai', '2026-05-01'],
    ['14 juillet', '2026-07-14'],
    ['3 août', '2026-08-03'],
    ['3 aout 2025', '2025-08-03'],
    ['2026-11-09', '2026-11-09'],
    ['2026-11-09T18:00:00.000Z', '2026-11-09'],
    ['2026/11/09', '2026-11-09'],
    ['demain', '2026-11-11'],
    ['hier', '2026-11-09'],
    ["aujourd'hui", REF],
    ['today', REF],
  ])('« %s » → %s', (texte, attendu) => {
    expect(analyserDate(texte, REF)).toBe(attendu);
  });

  it.each(['', '31/02/2026', '32/01', '2026-13-01', 'n’importe', '9', '9 zz', '29/02/2027'])('refuse « %s »', texte => {
    expect(analyserDate(texte, REF)).toBeUndefined();
  });

  it('29 février des années bissextiles', () => {
    expect(analyserDate('29/02/2028', REF)).toBe('2028-02-29');
    expect(estJour('2028-02-29')).toBe(true);
    expect(estJour('2027-02-29')).toBe(false);
  });

  it('formats d’échange', () => {
    expect(formaterSaisie('2026-11-09')).toBe('09/11/2026');
    expect(lireValeur('09/11/2026', 'fr')).toBe('2026-11-09');
    expect(lireValeur('2026-11-09', 'iso')).toBe('2026-11-09');
    expect(lireValeur('9/11', 'iso')).toBeUndefined();
    expect(ecrireValeur('2026-11-09', 'fr')).toBe('09/11/2026');
    expect(formaterLisible('2026-11-09', 'fr')).toBe('lun. 9 nov. 2026');
    expect(formaterLisible('2026-07-14', 'en')).toBe('Tue 14 Jul 2026');
  });
});

describe('arithmétique sans fuseau', () => {
  it('jours et mois, y compris aux changements d’heure', () => {
    expect(ajouterJours('2026-10-24', 1)).toBe('2026-10-25');
    expect(ajouterJours('2026-10-25', 1)).toBe('2026-10-26');
    expect(ajouterJours('2026-03-28', 2)).toBe('2026-03-30');
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28');
    expect(ajouterMois('2028-01-31', 1)).toBe('2028-02-29');
    expect(ajouterMois('2026-01-15', -2)).toBe('2025-11-15');
  });

  it('grille du lundi, 6 semaines', () => {
    const g = grilleMois(2026, 11);
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-10-26');
    expect(g).toContain('2026-11-30');
    const mars = grilleMois(2026, 3); // 1er mars 2026 : un dimanche
    expect(mars[6]).toBe('2026-03-01');
  });

  it('aujourd’hui dans le fuseau du club, autour du changement d’heure', () => {
    // 29 mars 2026, 0 h 30 UTC = 1 h 30 à Paris (avant le passage à l'heure d'été).
    expect(aujourdhui('Europe/Paris', Date.parse('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    // 25 octobre 2026, 22 h 30 UTC = 23 h 30 à Paris (heure d'hiver revenue).
    expect(aujourdhui('Europe/Paris', Date.parse('2026-10-25T22:30:00Z'))).toBe('2026-10-25');
    expect(aujourdhui('Europe/Paris', Date.parse('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
    expect(aujourdhui('America/New_York', Date.parse('2026-11-10T03:00:00Z'))).toBe('2026-11-09');
  });

  it('raccourcis', () => {
    expect(jourRaccourci('aujourdhui', REF)).toBe(REF);
    expect(jourRaccourci('demain', REF)).toBe('2026-11-11');
    expect(jourRaccourci('lundi', REF)).toBe('2026-11-16');
    expect(jourRaccourci('lundi', '2026-11-16')).toBe('2026-11-23');
    expect(jourRaccourci('semaine', REF)).toBe('2026-11-17');
    expect(jourRaccourci('semaine', REF, '2026-12-01')).toBe('2026-12-08');
    expect(periodeRaccourci('7j', REF)).toEqual({ du: '2026-11-04', au: REF });
    expect(periodeRaccourci('mois', REF)).toEqual({ du: '2026-11-01', au: '2026-11-30' });
    expect(periodeRaccourci('mois-precedent', '2026-01-15')).toEqual({ du: '2025-12-01', au: '2025-12-31' });
  });

  it('bornes et jours désactivés', () => {
    const bornes = { min: '2026-11-05', max: '2026-11-20', desactive: (j: string) => j === '2026-11-11' };
    expect(jourPermis('2026-11-04', bornes)).toBe(false);
    expect(jourPermis('2026-11-05', bornes)).toBe(true);
    expect(jourPermis('2026-11-11', bornes)).toBe(false);
    expect(jourPermis('2026-11-21', bornes)).toBe(false);
  });
});

describe('heures', () => {
  it.each([
    ['14:30', '14:30'],
    ['14h30', '14:30'],
    ['14h', '14:00'],
    ['14 h 30', '14:30'],
    ['1430', '14:30'],
    ['930', '09:30'],
    ['9', '09:00'],
    ['9:5', '09:50'],
    ['14.30', '14:30'],
    ['à 9h', '09:00'],
    ['2pm', '14:00'],
    ['2:30 pm', '14:30'],
    ['12am', '00:00'],
    ['midi', '12:00'],
    ['minuit', '00:00'],
  ])('« %s » → %s', (texte, attendu) => {
    expect(analyserHeure(texte)).toBe(attendu);
  });

  it.each(['', '24:00', '12:60', '13pm', 'zz'])('refuse « %s »', texte => {
    expect(analyserHeure(texte)).toBeUndefined();
  });

  it('instant mural et arrondi', () => {
    expect(lireInstantMural('2026-10-31 18:00')).toEqual({ date: '2026-10-31', heure: '18:00' });
    expect(lireInstantMural('2026-10-31T18:00')).toEqual({ date: '2026-10-31', heure: '18:00' });
    expect(lireInstantMural('31/10 18:00')).toBeUndefined();
    expect(arrondirHeure('14:07', 15)).toBe('14:00');
    expect(arrondirHeure('14:08', 15)).toBe('14:15');
    expect(arrondirHeure('23:58', 15)).toBe('23:45');
  });
});
