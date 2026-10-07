import { d } from '../../core/money/decimal';
import { carnetDepuisJson, construireCarnet, rappelsCarnet } from './carnet';

const these = {
  pourquoi: 'Leader mondial des gaz industriels, marges régulières, hydrogène en relais.',
  venteSi: 'la marge opérationnelle baisse deux années de suite',
  objectif: 200,
  revoirSous: 150,
  ecriteLe: '2026-01-10',
  coursEcriture: 160,
};

describe('carnet de thèses', () => {
  it('mesure le chemin vers l’objectif depuis l’écriture', () => {
    const [ligne] = construireCarnet([{ titreId: 'ai', nom: 'Air Liquide' }], { ai: these }, new Map([['ai', d('180')]]));
    expect(ligne.etat).toBe('en-cours');
    expect(ligne.progression).toBeCloseTo(0.5);
    expect(ligne.depuisEcriture).toBeCloseTo(12.5);
  });

  it('rappelle la thèse à l’objectif et sous le seuil, une seule fois', () => {
    const atteint = construireCarnet([{ titreId: 'ai', nom: 'Air Liquide' }], { ai: these }, new Map([['ai', d('205')]]));
    const [rappel] = rappelsCarnet(atteint, new Set());
    expect(rappel.titre).toBe('🎯 Air Liquide a atteint votre objectif de 200');
    expect(rappel.corps).toContain('Leader mondial des gaz industriels');
    expect(rappelsCarnet(atteint, new Set([rappel.identifiant]))).toEqual([]);

    const chute = construireCarnet([{ titreId: 'ai', nom: 'Air Liquide' }], { ai: these }, new Map([['ai', d('140')]]));
    expect(rappelsCarnet(chute, new Set())[0].corps).toContain('Vous vendriez si : la marge opérationnelle');
  });

  it('se passe d’une thèse absente ou d’un cours inconnu', () => {
    const lignes = construireCarnet([{ titreId: 'x', nom: 'X' }, { titreId: 'ai', nom: 'AI' }], { ai: these }, new Map());
    expect(lignes.map(ligne => ligne.etat)).toEqual(['sans-cours', 'sans-cours']);
    expect(rappelsCarnet(lignes, new Set())).toEqual([]);
    expect(carnetDepuisJson('pas du json')).toEqual({});
  });
});
