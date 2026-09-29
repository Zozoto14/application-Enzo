import { Decimal } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, versement } from '../core/testing/fixtures';
import {
  alerteVariation,
  canalBureau,
  etatDepuisJson,
  seuilVariation,
  seuilsDepuisJson,
  variationSeance,
} from './bureau';

describe('notifications du bureau', () => {
  it('affiche par le pont, et échoue si le système refuse', async () => {
    const vues: string[] = [];
    const canal = canalBureau({ notifier: async titre => (vues.push(titre), true) });
    await canal.afficher({ identifiant: 'a', titre: 'Bonjour', corps: '…' });
    expect(vues).toEqual(['Bonjour']);
    await expect(
      canalBureau({ notifier: async () => false }).afficher({ identifiant: 'b', titre: 'x', corps: 'y' }),
    ).rejects.toThrow();
  });

  it('lit les seuils saisis, virgule comprise, et ignore le reste', () => {
    const seuils = seuilsDepuisJson(
      JSON.stringify({ cw8: { bas: '600,5', haut: '' }, ai: { haut: 'abc' }, x: {} }),
    );
    expect(seuils).toHaveLength(1);
    expect(seuils[0].titreId).toBe('cw8');
    expect(seuils[0].bas!.toString()).toBe('600.5');
    expect(seuilsDepuisJson('{illisible')).toEqual([]);
  });

  it('relit un état persisté abîmé comme un état vide', () => {
    expect(etatDepuisJson(undefined).briefingsEnvoyes).toEqual([]);
    expect(etatDepuisJson('{"briefingsEnvoyes":["x"]}').briefingsEnvoyes).toEqual(['x']);
  });

  it('mesure la séance et prévient une fois par jour et par sens', () => {
    const etat = rejouer([compte()], [versement('2026-09-01', 1000), achat('2026-09-01', 10, 100, 0)]);
    const historique = new Map([
      [
        'air-liquide',
        [
          { date: '2026-09-24', cloture: Decimal.de('100') },
          { date: '2026-09-25', cloture: Decimal.de('97') },
        ],
      ],
    ]);
    const variation = variationSeance(etat, new Map([['air-liquide', Decimal.de('97')]]), historique);
    expect(variation).toBeCloseTo(-3);

    const alerte = alerteVariation(variation, 2, '2026-09-25', new Set());
    expect(alerte).toMatchObject({ identifiant: 'variation-baisse-2026-09-25', titre: 'Séance difficile : -3 %' });
    expect(alerteVariation(variation, 2, '2026-09-25', new Set([alerte!.identifiant]))).toBeUndefined();
    expect(alerteVariation(variation, 5, '2026-09-25', new Set())).toBeUndefined();
    expect(alerteVariation(variation, 0, '2026-09-25', new Set())).toBeUndefined();
  });

  it('lit le seuil de variation : 2 % par défaut, 0 pour couper', () => {
    expect(seuilVariation(undefined)).toBe(2);
    expect(seuilVariation('1,5')).toBe(1.5);
    expect(seuilVariation('')).toBe(0);
  });
});
