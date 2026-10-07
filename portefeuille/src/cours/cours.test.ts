import { d } from '../core/money/decimal';
import { achat, compte, titre } from '../core/testing/fixtures';
import { DepotComptes, DepotCours, DepotTitres, DepotTransactions } from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { lireChemin, versCours } from './fournisseur';
import { fournisseurConfigurable, type ConfigFournisseur } from './fournisseur-configurable';
import {
  CONFIG_ALPHA_VANTAGE,
  CONFIG_FINNHUB,
  CONFIG_YAHOO,
  CONFIGS,
  fournisseurParId,
} from './fournisseurs';
import { rafraichirCours, resumeRafraichissement } from './rafraichir';

/** `fetch` de test : rend la réponse associée à l'URL, ou une erreur. */
function faussetFetch(
  reponses: Record<string, unknown>,
  options: { statut?: number; erreurReseau?: boolean } = {},
) {
  const appels: string[] = [];
  const fonction = (async (url: string) => {
    appels.push(url);
    if (options.erreurReseau) {
      throw new Error('réseau injoignable');
    }
    const trouvee = Object.entries(reponses).find(([motif]) => url.includes(motif));
    if (!trouvee) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: (options.statut ?? 200) < 400,
      status: options.statut ?? 200,
      json: async () => trouvee[1],
    };
  }) as unknown as typeof fetch;
  return { fonction, appels };
}

describe('lireChemin', () => {
  it('descend dans les objets et les tableaux', () => {
    expect(lireChemin({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(lireChemin([{ price: 5 }], '0.price')).toBe(5);
    expect(lireChemin({ a: 1 }, '')).toEqual({ a: 1 });
  });

  it('accepte des segments explicites pour les noms contenant un point', () => {
    // Alpha Vantage nomme littéralement ses champs « 05. price ».
    const reponse = { 'Global Quote': { '05. price': '12.34' } };
    expect(lireChemin(reponse, ['Global Quote', '05. price'])).toBe('12.34');
    // La forme pointée échouerait ici, et c'est justement le piège.
    expect(lireChemin(reponse, 'Global Quote.05. price')).toBeUndefined();
  });

  it('renvoie undefined plutôt que de lever sur un maillon manquant', () => {
    expect(lireChemin({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(lireChemin(null, 'a')).toBeUndefined();
    expect(lireChemin([1, 2], 'x')).toBeUndefined();
  });
});

describe('versCours', () => {
  it('accepte nombres et chaînes', () => {
    expect(versCours(12.34)!.toString()).toBe('12.34');
    expect(versCours('703.89')!.toString()).toBe('703.89');
  });

  it('refuse ce qui n’est pas un cours exploitable', () => {
    // Un zéro ou un négatif signale une réponse vide, pas un titre à 0 €.
    expect(versCours(0)).toBeUndefined();
    expect(versCours(-5)).toBeUndefined();
    expect(versCours('indisponible')).toBeUndefined();
    expect(versCours(null)).toBeUndefined();
    expect(versCours(undefined)).toBeUndefined();
    expect(versCours(NaN)).toBeUndefined();
  });
});

describe('fournisseurConfigurable', () => {
  const config: ConfigFournisseur = {
    id: 'test',
    libelle: 'Fournisseur de test',
    cleRequise: true,
    urlGabarit: 'https://exemple.test/quote/{symboles}?apikey={cle}',
    symbolesParAppel: 2,
    separateurSymboles: ',',
    cheminListe: '',
    cheminCours: 'price',
    cheminSymbole: 'symbol',
  };

  it('interroge le fournisseur et rend les cours', async () => {
    const { fonction, appels } = faussetFetch({
      'quote/STLAP': [
        { symbol: 'STLAP', price: 4.2235 },
        { symbol: 'CW8', price: 703.73 },
      ],
    });

    const resultat = await fournisseurConfigurable(config).recuperer(
      [
        { titreId: 'stellantis', symbole: 'STLAP' },
        { titreId: 'amundi', symbole: 'CW8' },
      ],
      { cle: 'secrete', aujourdhui: '2026-09-22', recuperer: fonction },
    );

    expect(resultat.echecs).toEqual([]);
    expect(resultat.cours).toHaveLength(2);
    expect(resultat.cours[0].cours.toString()).toBe('4.2235');
    expect(resultat.cours[0].date).toBe('2026-09-22');
    expect(appels[0]).toContain('apikey=secrete');
  });

  it('regroupe les symboles par lot', async () => {
    const { fonction, appels } = faussetFetch({ 'exemple.test': [] });

    await fournisseurConfigurable(config).recuperer(
      [
        { titreId: 'a', symbole: 'A' },
        { titreId: 'b', symbole: 'B' },
        { titreId: 'c', symbole: 'C' },
      ],
      { cle: 'x', recuperer: fonction },
    );

    // Deux symboles par appel : deux appels pour trois titres.
    expect(appels).toHaveLength(2);
    expect(appels[0]).toContain('A,B');
    expect(appels[1]).toContain('C');
  });

  it('exige la clé quand le fournisseur en demande une', async () => {
    const { fonction } = faussetFetch({});
    await expect(
      fournisseurConfigurable(config).recuperer([{ titreId: 'a', symbole: 'A' }], {
        recuperer: fonction,
      }),
    ).rejects.toThrow(/clé d'API/);
  });

  describe('échecs', () => {
    it('signale un cours absent sans faire échouer les autres', async () => {
      const { fonction } = faussetFetch({
        'exemple.test': [
          { symbol: 'A', price: 10 },
          { symbol: 'B' }, // cours manquant
        ],
      });

      const resultat = await fournisseurConfigurable(config).recuperer(
        [
          { titreId: 'a', symbole: 'A' },
          { titreId: 'b', symbole: 'B' },
        ],
        { cle: 'x', recuperer: fonction },
      );

      expect(resultat.cours).toHaveLength(1);
      expect(resultat.echecs).toHaveLength(1);
      expect(resultat.echecs[0].raison).toMatch(/absent ou illisible/);
    });

    it('rapporte une réponse en erreur sans lever', async () => {
      const { fonction } = faussetFetch({ 'exemple.test': {} }, { statut: 429 });

      const resultat = await fournisseurConfigurable(config).recuperer(
        [{ titreId: 'a', symbole: 'A' }],
        { cle: 'x', recuperer: fonction },
      );

      expect(resultat.cours).toEqual([]);
      expect(resultat.echecs[0].raison).toMatch(/429/);
    });

    it('rapporte une coupure réseau', async () => {
      const { fonction } = faussetFetch({}, { erreurReseau: true });

      const resultat = await fournisseurConfigurable(config).recuperer(
        [{ titreId: 'a', symbole: 'A' }],
        { cle: 'x', recuperer: fonction },
      );

      expect(resultat.echecs[0].raison).toMatch(/réseau/);
    });

    it('continue les lots suivants après l’échec d’un lot', async () => {
      // Une coupure sur un lot ne doit pas priver de cours les titres des
      // autres lots.
      const { fonction } = faussetFetch({ 'quote/C': [{ symbol: 'C', price: 7 }] });

      const resultat = await fournisseurConfigurable(config).recuperer(
        [
          { titreId: 'a', symbole: 'A' },
          { titreId: 'b', symbole: 'B' },
          { titreId: 'c', symbole: 'C' },
        ],
        { cle: 'x', recuperer: fonction },
      );

      expect(resultat.cours).toHaveLength(1);
      expect(resultat.cours[0].titreId).toBe('c');
      expect(resultat.echecs).toHaveLength(2);
    });
  });

  describe('formats de réponse', () => {
    it('lit une réponse Finnhub, objet unique par symbole', async () => {
      const { fonction } = faussetFetch({ finnhub: { c: 4.2235, t: 1758499200 } });

      const resultat = await fournisseurConfigurable(CONFIG_FINNHUB).recuperer(
        [{ titreId: 'stellantis', symbole: 'STLAP.PA' }],
        { cle: 'x', aujourdhui: '2026-09-22', recuperer: fonction },
      );

      expect(resultat.cours[0].cours.toString()).toBe('4.2235');
      expect(resultat.cours[0].date).toBe('2025-09-22');
    });

    it('lit une réponse Yahoo, telle qu’observée sur Euronext Paris', async () => {
      // Extrait reel du 24/09/2026, reduit aux champs lus. C'est le seul
      // fournisseur dont le mapping vienne d'une reponse et non d'une doc.
      const { fonction } = faussetFetch({
        'query1.finance.yahoo.com': {
          chart: {
            result: [
              {
                meta: {
                  currency: 'EUR',
                  symbol: 'STLAP.PA',
                  fullExchangeName: 'Paris',
                  regularMarketPrice: 3.97,
                  regularMarketTime: 1790264392,
                },
              },
            ],
            error: null,
          },
        },
      });

      const resultat = await fournisseurConfigurable(CONFIG_YAHOO).recuperer(
        [{ titreId: 'stellantis', symbole: 'STLAP.PA' }],
        { recuperer: fonction },
      );

      expect(resultat.cours).toHaveLength(1);
      expect(resultat.cours[0].cours.toString()).toBe('3.97');
      expect(resultat.echecs).toEqual([]);
    });

    it('n’exige aucune clé pour Yahoo', async () => {
      const { fonction, appels } = faussetFetch({
        'query1.finance.yahoo.com': {
          chart: { result: [{ meta: { symbol: 'CW8.PA', regularMarketPrice: 698.18 } }] },
        },
      });

      const resultat = await fournisseurConfigurable(CONFIG_YAHOO).recuperer(
        [{ titreId: 'amundi', symbole: 'CW8.PA' }],
        { aujourdhui: '2026-09-24', recuperer: fonction },
      );

      expect(CONFIG_YAHOO.cleRequise).toBe(false);
      expect(resultat.cours[0].cours.toString()).toBe('698.18');
      // Faute d'horodatage, la cotation prend la date du jour.
      expect(resultat.cours[0].date).toBe('2026-09-24');
      expect(appels[0]).toContain('/chart/CW8.PA');
      expect(appels[0]).not.toContain('apikey');
    });

    it('lit une réponse Alpha Vantage, champs à noms pointés', async () => {
      const { fonction } = faussetFetch({
        alphavantage: {
          'Global Quote': { '05. price': '703.7300', '07. latest trading day': '2026-09-22' },
        },
      });

      const resultat = await fournisseurConfigurable(CONFIG_ALPHA_VANTAGE).recuperer(
        [{ titreId: 'amundi', symbole: 'CW8.PA' }],
        { cle: 'x', recuperer: fonction },
      );

      expect(resultat.cours[0].cours.toString()).toBe('703.73');
      expect(resultat.cours[0].date).toBe('2026-09-22');
    });
  });
});

describe('fournisseurs prédéfinis', () => {
  it('ne lève `provisoire` que sur ceux jamais confrontés à une réponse', () => {
    // Yahoo a ete verifie sur STLAP.PA et CW8.PA : son mapping vient d'un
    // vrai JSON. Les trois autres exigent une cle et n'ont pas pu l'etre.
    expect(CONFIG_YAHOO.provisoire).toBeUndefined();
    expect(
      CONFIGS.filter(config => config.id !== 'yahoo').every(config => config.provisoire),
    ).toBe(true);
  });

  it('propose Yahoo en premier, seul vérifié sur Euronext Paris', () => {
    expect(CONFIGS[0].id).toBe('yahoo');
  });

  it('se retrouvent par identifiant', () => {
    expect(fournisseurParId('finnhub')?.libelle).toBe('Finnhub');
    expect(fournisseurParId('inexistant')).toBeUndefined();
  });
});

describe('rafraichirCours', () => {
  let pilote: PiloteSqlite;

  beforeEach(() => {
    pilote = ouvrirBaseNode();
    migrer(pilote);
    new DepotComptes(pilote).enregistrer(compte());
    new DepotTitres(pilote).enregistrer(titre({ ticker: 'AI' }));
  });

  afterEach(() => pilote.fermer());

  const fournisseurFactice = (cours: Record<string, number>) => ({
    id: 'factice',
    libelle: 'Factice',
    cleRequise: false,
    recuperer: async (demandes: readonly { titreId: string; symbole: string }[]) => ({
      cours: demandes
        .filter(demande => cours[demande.symbole] !== undefined)
        .map(demande => ({
          titreId: demande.titreId,
          cours: d(cours[demande.symbole]),
          date: '2026-09-22',
        })),
      echecs: demandes
        .filter(demande => cours[demande.symbole] === undefined)
        .map(demande => ({
          titreId: demande.titreId,
          symbole: demande.symbole,
          raison: 'inconnu',
        })),
    }),
  });

  it('ne fait rien quand aucune position n’est détenue', async () => {
    const rapport = await rafraichirCours(pilote, {
      fournisseur: fournisseurFactice({ AI: 140 }),
    });

    expect(rapport.rienAFaire).toBe(true);
    expect(rapport.misAJour).toBe(0);
    expect(resumeRafraichissement(rapport)).toMatch(/Aucune position/);
  });

  it('met à jour le cours des titres détenus', async () => {
    new DepotTransactions(pilote).enregistrer(achat('2026-01-10', 10, 100, 0));

    const rapport = await rafraichirCours(pilote, {
      fournisseur: fournisseurFactice({ AI: 140 }),
    });

    expect(rapport.misAJour).toBe(1);
    expect(new DepotCours(pilote).derniersCours().get('air-liquide')!.toString()).toBe(
      '140',
    );
  });

  it('n’interroge pas les titres non détenus', async () => {
    // Une watchlist épuiserait le quota gratuit sans servir le portefeuille.
    new DepotTitres(pilote).enregistrer(
      titre({ id: 'lvmh', isin: 'FR0000121014', nom: 'LVMH', ticker: 'MC' }),
    );
    new DepotTransactions(pilote).enregistrer(achat('2026-01-10', 10, 100, 0));

    const interroges: string[] = [];
    await rafraichirCours(pilote, {
      fournisseur: {
        id: 'espion',
        libelle: 'Espion',
        cleRequise: false,
        recuperer: async demandes => {
          interroges.push(...demandes.map(demande => demande.symbole));
          return { cours: [], echecs: [] };
        },
      },
    });

    expect(interroges).toEqual(['AI']);
  });

  it('laisse en place un cours existant quand la mise à jour échoue', async () => {
    // Une API muette ne doit pas effacer la dernière valorisation connue.
    new DepotTransactions(pilote).enregistrer(achat('2026-01-10', 10, 100, 0));
    new DepotCours(pilote).enregistrer('air-liquide', '2026-09-21', d('135'));

    const rapport = await rafraichirCours(pilote, {
      fournisseur: fournisseurFactice({}),
    });

    expect(rapport.misAJour).toBe(0);
    expect(rapport.echecs).toHaveLength(1);
    expect(new DepotCours(pilote).derniersCours().get('air-liquide')!.toString()).toBe(
      '135',
    );
  });

  it('signale un titre détenu sans symbole', async () => {
    new DepotTitres(pilote).enregistrer(titre({ ticker: '  ' }));
    new DepotTransactions(pilote).enregistrer(achat('2026-01-10', 10, 100, 0));

    const rapport = await rafraichirCours(pilote, {
      fournisseur: fournisseurFactice({ AI: 140 }),
    });

    expect(rapport.sansSymbole).toEqual(['Air Liquide']);
    expect(resumeRafraichissement(rapport)).toMatch(/1 sans symbole/);
  });

  it('résume le rapport en clair', async () => {
    new DepotTransactions(pilote).enregistrer(achat('2026-01-10', 10, 100, 0));

    const rapport = await rafraichirCours(pilote, {
      fournisseur: fournisseurFactice({ AI: 140 }),
    });

    expect(resumeRafraichissement(rapport)).toBe('1 cours mis à jour.');
  });
});
