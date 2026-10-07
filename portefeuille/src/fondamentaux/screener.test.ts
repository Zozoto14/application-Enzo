import { CATEGORIES, lireScreener, requeteScreener } from './screener';

describe('screener', () => {
  it('compose une requête : région, critères de la catégorie, page et tri', () => {
    const requete = requeteScreener('value', 'us', { page: 2 });
    expect(requete.offset).toBe(50);
    expect(requete.sortField).toBe('intradaymarketcap');
    const [pays, ...criteres] = requete.query.operands;
    expect(pays).toEqual({ operator: 'eq', operands: ['region', 'us'] });
    expect(criteres).toContainEqual({ operator: 'btwn', operands: ['peratio.lasttwelvemonths', 0, 15] });
  });

  it('impose la France et l’Europe aux catégories qui les supposent', () => {
    expect(requeteScreener('france', 'us').query.operands[0]).toEqual({ operator: 'eq', operands: ['region', 'fr'] });
    const pea = requeteScreener('pea', 'monde').query.operands[0] as { operands: Array<{ operands: string[] }> };
    const pays = pea.operands.map(condition => condition.operands[1]);
    expect(pays).toContain('fr');
    expect(pays).toContain('de');
    expect(pays).not.toContain('gb');
    expect(pays).not.toContain('us');
  });

  it('décrit chaque catégorie', () => {
    for (const categorie of CATEGORIES) {
      expect(categorie.description.length).toBeGreaterThan(20);
    }
  });

  it('lit la réponse, brute ou formatée', () => {
    const resultat = lireScreener({
      finance: {
        result: [
          {
            total: 312,
            quotes: [
              {
                symbol: 'NVDA',
                longName: 'NVIDIA Corporation',
                fullExchangeName: 'NasdaqGS',
                currency: 'USD',
                regularMarketPrice: 225.07,
                regularMarketChangePercent: 0.22,
                marketCap: 5.45e12,
                trailingPE: 52.1,
                priceToBook: 40.2,
                trailingAnnualDividendYield: 0.0002,
                region: 'US',
              },
              { symbol: 'AI.PA', shortName: 'AIR LIQUIDE', regularMarketPrice: { raw: 177, fmt: '177,00' }, dividendYield: 1.8 },
              { pasDeSymbole: true },
            ],
          },
        ],
      },
    });
    expect(resultat.total).toBe(312);
    expect(resultat.actions).toHaveLength(2);
    expect(resultat.actions[0]).toMatchObject({ nom: 'NVIDIA Corporation', per: 52.1, capitalisation: 5.45e12 });
    expect(resultat.actions[0].rendement).toBeCloseTo(0.02);
    expect(resultat.actions[1]).toMatchObject({ nom: 'AIR LIQUIDE', cours: 177, rendement: 1.8 });
  });

  it('survit à une réponse inattendue', () => {
    expect(lireScreener({ erreur: 'x' })).toEqual({ actions: [], total: 0 });
  });
});
