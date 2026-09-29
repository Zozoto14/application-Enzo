import { ErreurFournisseur } from './fournisseur';
import { SUFFIXE_PARIS, chercherSymboles, symboleParis } from './symboles';

/** `fetch` de test, qui rend la charge fournie. */
function faussetFetch(charge: unknown, options: { statut?: number; panne?: boolean } = {}) {
  const appels: string[] = [];
  const fonction = (async (url: string) => {
    appels.push(url);
    if (options.panne) {
      throw new Error('réseau injoignable');
    }
    const statut = options.statut ?? 200;
    return { ok: statut < 400, status: statut, json: async () => charge };
  }) as unknown as typeof fetch;
  return { fonction, appels };
}

/** Réponse réelle du 24/09/2026 pour l'ISIN de l'ETF, réduite aux champs lus. */
const REPONSE_ETF = {
  quotes: [
    {
      symbol: 'CW8.PA',
      exchange: 'PAR',
      shortname: 'Amundi MSCI World Swap UCITS ET',
      quoteType: 'ETF',
    },
  ],
};

/** Réponse réelle pour l'ISIN de Stellantis : Paris n'y figure pas. */
const REPONSE_STELLANTIS = {
  quotes: [
    { symbol: 'STLAM.MI', exchange: 'MIL', shortname: 'STELLANTIS', quoteType: 'EQUITY' },
    {
      symbol: 'NL00150001Q9.SG',
      exchange: 'STU',
      shortname: 'Stellantis N.V.',
      quoteType: 'EQUITY',
    },
  ],
};

describe('chercherSymboles', () => {
  it('rend les candidats d’un ISIN', async () => {
    const { fonction, appels } = faussetFetch(REPONSE_ETF);

    const resultat = await chercherSymboles('LU1681043599', { recuperer: fonction });

    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.candidats[0]).toMatchObject({
      symbole: 'CW8.PA',
      place: 'PAR',
      type: 'ETF',
      paris: true,
    });
    expect(appels[0]).toContain('q=LU1681043599');
    expect(resultat.avertissement).toBeUndefined();
  });

  describe('le piège des places de cotation', () => {
    it('avertit quand aucun candidat ne cote à Paris', async () => {
      // Verifie sur l'ISIN reel de Stellantis : Yahoo rend Milan et
      // Stuttgart, mais pas Paris, alors que la ligne y est detenue.
      const { fonction } = faussetFetch(REPONSE_STELLANTIS);

      const resultat = await chercherSymboles('NL00150001Q9', { recuperer: fonction });

      expect(resultat.candidats.every(candidat => !candidat.paris)).toBe(true);
      expect(resultat.avertissement).toMatch(/Aucun résultat sur Euronext Paris/);
      expect(resultat.avertissement).toMatch(/un autre cours/);
    });

    it('ne choisit jamais à la place de l’utilisateur', async () => {
      // Le module propose, il ne resout pas : choisir seul aurait valorise
      // Stellantis sur Milan, avec un ecart invisible dans les totaux.
      const { fonction } = faussetFetch(REPONSE_STELLANTIS);

      const resultat = await chercherSymboles('NL00150001Q9', { recuperer: fonction });

      expect(resultat.candidats).toHaveLength(2);
      expect(resultat).not.toHaveProperty('retenu');
    });

    it('met Paris en tête quand il y figure', async () => {
      const { fonction } = faussetFetch({
        quotes: [
          { symbol: 'AI.DE', exchange: 'GER', shortname: 'Air Liquide' },
          { symbol: 'AI.PA', exchange: 'PAR', shortname: 'AIR LIQUIDE' },
        ],
      });

      const resultat = await chercherSymboles('Air Liquide', { recuperer: fonction });

      expect(resultat.candidats[0].symbole).toBe('AI.PA');
      expect(resultat.avertissement).toBeUndefined();
    });

    it('reconnaît Paris au suffixe même si la place est nommée autrement', async () => {
      const { fonction } = faussetFetch({
        quotes: [{ symbol: 'MC.PA', exchange: 'ENX', shortname: 'LVMH' }],
      });

      const resultat = await chercherSymboles('LVMH', { recuperer: fonction });

      expect(resultat.candidats[0].paris).toBe(true);
    });
  });

  describe('réponses sans résultat', () => {
    it('le dit et suggère quoi essayer', async () => {
      const { fonction } = faussetFetch({ quotes: [] });

      const resultat = await chercherSymboles('zzzz', { recuperer: fonction });

      expect(resultat.candidats).toEqual([]);
      expect(resultat.avertissement).toMatch(/Aucun résultat pour « zzzz »/);
      expect(resultat.avertissement).toContain(SUFFIXE_PARIS);
    });

    it('refuse une recherche vide sans appeler quoi que ce soit', async () => {
      const { fonction, appels } = faussetFetch({ quotes: [] });

      const resultat = await chercherSymboles('   ', { recuperer: fonction });

      expect(appels).toEqual([]);
      expect(resultat.avertissement).toMatch(/Saisissez un ISIN/);
    });

    it('ignore une entrée sans symbole exploitable', async () => {
      const { fonction } = faussetFetch({
        quotes: [{ exchange: 'PAR' }, null, 'texte', { symbol: '', exchange: 'PAR' }],
      });

      expect((await chercherSymboles('x', { recuperer: fonction })).candidats).toEqual([]);
    });

    it('survit à une réponse sans champ quotes', async () => {
      const { fonction } = faussetFetch({ autre: true });

      expect((await chercherSymboles('x', { recuperer: fonction })).candidats).toEqual([]);
    });
  });

  describe('pannes', () => {
    it('lève quand la source est injoignable', async () => {
      const { fonction } = faussetFetch({}, { panne: true });

      await expect(chercherSymboles('CW8', { recuperer: fonction })).rejects.toThrow(
        ErreurFournisseur,
      );
    });

    it('lève sur une réponse en erreur', async () => {
      const { fonction } = faussetFetch({}, { statut: 503 });

      await expect(chercherSymboles('CW8', { recuperer: fonction })).rejects.toThrow(/503/);
    });
  });

  it('se rabat sur le symbole quand le nom manque', async () => {
    const { fonction } = faussetFetch({ quotes: [{ symbol: 'CW8.PA', exchange: 'PAR' }] });

    expect((await chercherSymboles('CW8', { recuperer: fonction })).candidats[0].nom).toBe(
      'CW8.PA',
    );
  });
});

describe('symboleParis', () => {
  it('ajoute le suffixe de la place', () => {
    expect(symboleParis('cw8')).toBe('CW8.PA');
  });

  it('ne le double pas', () => {
    expect(symboleParis('STLAP.PA')).toBe('STLAP.PA');
  });

  it('rend une chaîne vide sur une saisie vide', () => {
    expect(symboleParis('  ')).toBe('');
  });
});
