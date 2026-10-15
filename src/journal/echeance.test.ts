/**
 * Échéance du soir et rattrapage à la première ouverture.
 */

import { MAX_RATTRAPAGE, echeanceDu, joursDus, libelleProchaine, prochaineEcheance } from './echeance';

const t = (jour: string, h: number, m = 0) => new Date(`${jour}T00:00:00`).getTime() + (h * 60 + m) * 60_000;
const reglages = (extra: Partial<{ actif: boolean; heure: number; depuis: string }> = {}) => ({ actif: true, heure: 21, depuis: '2026-10-10', ...extra });
const aucun: ReadonlySet<string> = new Set();

describe('échéance du soir', () => {
  it('la page du jour n’est pas due avant l’heure réglée, et l’est à partir de cette heure', () => {
    expect(joursDus(t('2026-10-13', 20, 59), reglages(), new Set(['2026-10-10', '2026-10-11', '2026-10-12']))).toEqual([]);
    expect(joursDus(t('2026-10-13', 21, 0), reglages(), new Set(['2026-10-10', '2026-10-11', '2026-10-12']))).toEqual(['2026-10-13']);
    expect(joursDus(t('2026-10-13', 23, 40), reglages(), new Set(['2026-10-10', '2026-10-11', '2026-10-12']))).toEqual(['2026-10-13']);
  });

  it('l’heure est réglable (21 h par défaut) et bornée entre 12 h et 23 h', () => {
    expect(joursDus(t('2026-10-13', 19, 0), reglages({ heure: 18, depuis: '2026-10-13' }), aucun)).toEqual(['2026-10-13']);
    expect(echeanceDu('2026-10-13', 3)).toBe(echeanceDu('2026-10-13', 12));
    expect(echeanceDu('2026-10-13', 30)).toBe(echeanceDu('2026-10-13', 23));
  });

  it('rattrapage : app fermée hier soir, la page d’hier est due à la première ouverture du lendemain', () => {
    const matin = t('2026-10-14', 8, 30);
    expect(joursDus(matin, reglages({ depuis: '2026-10-12' }), new Set(['2026-10-12']))).toEqual(['2026-10-13']);
  });

  it('rattrape plusieurs soirs manqués, du plus ancien au plus récent, sans refaire les pages existantes', () => {
    const lundi = t('2026-10-19', 9);
    expect(joursDus(lundi, reglages({ depuis: '2026-10-14' }), new Set(['2026-10-16']))).toEqual(['2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18']);
  });

  it('ne remonte pas avant le jour d’activation', () => {
    expect(joursDus(t('2026-10-20', 9), reglages({ depuis: '2026-10-19' }), aucun)).toEqual(['2026-10-19']);
    expect(joursDus(t('2026-10-20', 22), reglages({ depuis: '2026-10-20' }), aucun)).toEqual(['2026-10-20']);
  });

  it('une longue absence ne fabrique pas plus de 14 pages d’un coup', () => {
    const dus = joursDus(t('2026-12-31', 22), reglages({ depuis: '2026-01-01' }), aucun);
    expect(dus).toHaveLength(MAX_RATTRAPAGE);
    expect(dus[dus.length - 1]).toBe('2026-12-31');
    expect(dus[0]).toBe('2026-12-18');
  });

  it('désactivé : rien n’est dû ; horloge reculée avant l’activation : rien non plus', () => {
    expect(joursDus(t('2026-10-13', 22), reglages({ actif: false }), aucun)).toEqual([]);
    expect(joursDus(t('2026-10-01', 22), reglages({ depuis: '2026-10-10' }), aucun)).toEqual([]);
  });

  it('prochaine échéance : ce soir tant que la page du jour manque ou que l’heure n’est pas passée, sinon demain', () => {
    expect(prochaineEcheance(t('2026-10-13', 15), reglages(), aucun).jour).toBe('2026-10-13');
    expect(prochaineEcheance(t('2026-10-13', 22), reglages(), new Set(['2026-10-13'])).jour).toBe('2026-10-14');
    expect(libelleProchaine(t('2026-10-13', 15), reglages({ depuis: '2026-10-13' }), aucun)).toBe('Prochaine page ce soir à 21 h.');
    expect(libelleProchaine(t('2026-10-13', 22), reglages({ depuis: '2026-10-13' }), new Set(['2026-10-13']))).toBe('Prochaine page demain à 21 h.');
    expect(libelleProchaine(t('2026-10-14', 8), reglages({ depuis: '2026-10-13' }), aucun)).toBe('Une page est prête à être écrite.');
    expect(libelleProchaine(t('2026-10-14', 8), reglages({ actif: false }), aucun)).toMatch(/désactivée/);
  });
});
