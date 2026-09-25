import { expositionDe, impactPourVous, indiceDeLigne, tonalite } from './impacts';
import type { ArticleMedia } from './medias';

const article = (titre: string, resume = ''): ArticleMedia => ({
  titre,
  resume,
  source: 'Les Echos',
  date: '2026-09-25',
  langue: 'fr',
});

const portefeuille = expositionDe([
  { nom: 'AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC', poids: 60 },
  { nom: 'Air Liquide', poids: 40 },
]);

describe('ce que l’actualité change pour vous', () => {
  it('reconnaît l’indice d’un ETF', () => {
    expect(indiceDeLigne('AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC')).toBe('msci-world');
    expect(indiceDeLigne('Amundi S&P 500 UCITS ETF')).toBe('sp500');
    expect(indiceDeLigne('Lyxor Nasdaq-100')).toBe('nasdaq100');
    expect(indiceDeLigne('Amundi MSCI Emerging Markets')).toBe('emergents');
    expect(indiceDeLigne('Stellantis')).toBeUndefined();
  });

  it('relie une nouvelle d’Apple au MSCI World détenu, sans rien prédire', () => {
    const phrase = impactPourVous(article('Apple bondit après le lancement du nouvel iPhone'), portefeuille)!;
    expect(phrase).toContain('Apple pèse environ 4,5 pour cent du MSCI World');
    expect(phrase).toContain('via AMUNDI MSCI WORLD');
    expect(phrase).toContain('si le titre en profite');
    // 60 % × 4,5 % : 2,7 % des titres.
    expect(phrase).toContain('2,7 pour cent de vos titres');
    expect(phrase).not.toMatch(/va (sûrement|forcément) monter/);
  });

  it('parle d’abord de la ligne détenue en direct', () => {
    const phrase = impactPourVous(article('Air Liquide déçoit au troisième trimestre'), portefeuille)!;
    expect(phrase).toMatch(/^Pour vous : Vous détenez Air Liquide en direct, pour 40 pour cent de vos titres : une nouvelle qui peut peser/);
  });

  it('explique les grands thèmes : taux, dollar', () => {
    expect(impactPourVous(article('La BCE baisse ses taux directeurs'), portefeuille)).toMatch(/une baisse les soutient/);
    expect(impactPourVous(article('Le dollar au plus haut depuis un an'), portefeuille)).toMatch(/Environ 42 % de vos titres sont investis aux États-Unis/);
  });

  it('se tait quand rien ne vous relie à l’article', () => {
    expect(impactPourVous(article('Le Tour de France passe par Lyon'), portefeuille)).toBeUndefined();
  });

  it('devine le sens d’un titre', () => {
    expect(tonalite('Nvidia shares jump after earnings')).toBe('positive');
    expect(tonalite('Stellantis chute en Bourse')).toBe('negative');
    expect(tonalite('Réunion de la BCE jeudi')).toBe('neutre');
  });
});
