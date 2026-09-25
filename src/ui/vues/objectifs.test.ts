import { objectifDepuisJson, repartirVersement, suivreObjectif } from './objectifs';

describe('répartition d’un versement', () => {
  const lignes = [
    { titreId: 'cw8', nom: 'MSCI World', valeur: 6000, cible: 70, cours: 500 },
    { titreId: 'ai', nom: 'Air Liquide', valeur: 4000, cible: 30, cours: 170 },
  ];

  it('sert d’abord la ligne en retard sur sa cible', () => {
    // Après 1 000 € : 11 000 €. Cible MSCI 7 700 € (manque 1 700 €), Air Liquide 3 300 € (déjà au-dessus).
    const achats = repartirVersement(lignes, 1000);
    expect(achats.map(achat => achat.montant)).toEqual([1000, 0]);
    expect(achats[0].parts).toBe(2);
    expect(achats[0].poidsAvant).toBeCloseTo(60);
    expect(achats[0].poidsApres).toBeCloseTo(63.64, 1);
  });

  it('une fois les cibles rejointes, suit les cibles', () => {
    // Après 10 000 € : 20 000 €. Manques : 8 000 € et 2 000 €, exactement le versement.
    expect(repartirVersement(lignes, 10000).map(achat => achat.montant)).toEqual([8000, 2000]);
    // 20 000 € de plus : 30 000 €. Manques 15 000 et 5 000, reste 0.
    const achats = repartirVersement(lignes, 20000);
    expect(achats.map(achat => achat.montant)).toEqual([15000, 5000]);
    expect(achats[1].poidsApres).toBeCloseTo(30);
  });

  it('ramène des cibles qui ne font pas 100 %', () => {
    const achats = repartirVersement(
      [
        { titreId: 'a', nom: 'A', valeur: 0, cible: 1 },
        { titreId: 'b', nom: 'B', valeur: 0, cible: 1 },
      ],
      100,
    );
    expect(achats.map(achat => achat.montant)).toEqual([50, 50]);
    expect(achats[0].cible).toBe(50);
  });

  it('ne propose rien sans cible ni versement', () => {
    expect(repartirVersement(lignes, 0)).toEqual([]);
    expect(repartirVersement([{ ...lignes[0], cible: 0 }], 100)).toEqual([]);
  });
});

describe('objectif d’épargne', () => {
  it('calcule le versement mensuel nécessaire', () => {
    // 10 000 € aujourd'hui, 50 000 € dans 5 ans, sans rendement : 40 000 / 60 mois.
    const vue = suivreObjectif({ montant: 50000, date: '2031-09-25', rendement: 0 }, 10000, '2026-09-25');
    expect(vue.moisRestants).toBe(60);
    expect(vue.versementMensuel).toBe(667);
    expect(vue.progression).toBeCloseTo(0.2);
    expect(vue.trajectoire).toHaveLength(61);
    expect(vue.trajectoire[60].valeur).toBeGreaterThanOrEqual(50000);
  });

  it('tient compte du rendement supposé', () => {
    const sans = suivreObjectif({ montant: 50000, date: '2031-09-25', rendement: 0 }, 10000, '2026-09-25');
    const avec = suivreObjectif({ montant: 50000, date: '2031-09-25', rendement: 5 }, 10000, '2026-09-25');
    expect(avec.versementMensuel).toBeLessThan(sans.versementMensuel);
    expect(avec.valeurSansVersement).toBeCloseTo(10000 * 1.05 ** 5, 0);
  });

  it('dit quand l’objectif est atteint', () => {
    const vue = suivreObjectif({ montant: 5000, date: '2030-01-01', rendement: 5 }, 8000, '2026-09-25');
    expect(vue.atteint).toBe(true);
    expect(vue.versementMensuel).toBe(0);
  });

  it('relit un objectif enregistré', () => {
    expect(objectifDepuisJson('{"montant":50000,"date":"2031-01-01"}')).toEqual({
      montant: 50000,
      date: '2031-01-01',
      rendement: 5,
    });
    expect(objectifDepuisJson('{"montant":-1}')).toBeUndefined();
    expect(objectifDepuisJson(undefined)).toBeUndefined();
  });
});
