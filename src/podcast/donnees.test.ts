import { Decimal } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, titre, versement } from '../core/testing/fixtures';
import type { DonneesValeur } from '../fondamentaux/yahoo';
import { entreesEpisode, lignesDuPortefeuille, preparerEpisode } from './donnees';

function scenario() {
  const comptes = [compte()];
  const titres = [
    titre({ id: 'cw8', nom: 'Amundi MSCI World', ticker: 'CW8.PA' }),
    titre({ id: 'stla', nom: 'Stellantis', ticker: 'STLAP.PA' }),
  ];
  const transactions = [
    versement('2026-01-02', 1200),
    achat('2026-01-02', 1, 1000, 0, { titreId: 'cw8' }),
    achat('2026-01-02', 20, 10, 0, { titreId: 'stla' }),
  ];
  return {
    etat: rejouer(comptes, transactions),
    titres,
    cours: new Map([
      ['cw8', Decimal.de('1100')],
      ['stla', Decimal.de('8')],
    ]),
    historique: new Map([
      [
        'cw8',
        [
          { date: '2026-09-24', cloture: Decimal.de('1000') },
          { date: '2026-09-25', cloture: Decimal.de('1100') },
        ],
      ],
      [
        'stla',
        [
          { date: '2026-09-24', cloture: Decimal.de('10') },
          { date: '2026-09-25', cloture: Decimal.de('8') },
        ],
      ],
    ]),
    indices: new Map([
      [
        'indice:cac40',
        [
          { date: '2026-09-24', cloture: Decimal.de('8000') },
          { date: '2026-09-25', cloture: Decimal.de('8080') },
        ],
      ],
    ]),
    aujourdhui: '2026-09-25',
  };
}

const ficheCw8 = {
  fiche: {
    cours: 1100,
    devise: 'EUR',
    analystes: { recommandation: 'buy', objectifMoyen: 1200 },
    resultats: { prochaineDate: '2026-10-20' },
    dividende: {},
  },
} as unknown as DonneesValeur;

describe('données du podcast', () => {
  it('range les lignes de la plus grosse à la plus petite', () => {
    const lignes = lignesDuPortefeuille(scenario());
    expect(lignes.map(ligne => ligne.nom)).toEqual(['Amundi MSCI World', 'Stellantis']);
    expect(lignes[0].variationJour).toBeCloseTo(10);
    expect(lignes[1].variationJour).toBeCloseTo(-20);
    expect(lignes[0].poids).toBeCloseTo((1100 / 1260) * 100);
    expect(lignes[0].symbole).toBe('CW8.PA');
  });

  it('calcule la séance, les indices et reprend les fiches', () => {
    const entrees = entreesEpisode(
      scenario(),
      new Map([['CW8.PA', ficheCw8]]),
      new Map([['CW8.PA', [{ titre: 'World ETF inflows', source: 'Reuters', date: '2026-09-25', langue: 'en' as const }]]]),
      [],
    );
    // +100 € sur CW8, -40 € sur Stellantis, pour 1 200 € la veille.
    expect(entrees.seance?.montant).toBeCloseTo(60);
    expect(entrees.seance?.pourcentage).toBeCloseTo(5);
    expect(entrees.valeurTotale).toBeCloseTo(1260);
    expect(entrees.indices).toEqual([{ nom: 'CAC 40', seancePct: expect.closeTo(1) }]);
    expect(entrees.valeurs[0]).toMatchObject({
      nom: 'Amundi MSCI World',
      consensus: 'Achat',
      objectifMoyen: 1200,
      prochainsResultats: '2026-10-20',
    });
    expect(entrees.valeurs[0].actualites).toHaveLength(1);
    expect(entrees.valeurs[1].actualites).toEqual([]);
    expect(entrees.sujet?.titre).toBeTruthy();
  });

  it('écrit un épisode même quand le réseau ne répond pas', async () => {
    const horsLigne = () => Promise.reject(new Error('hors ligne'));
    const etapes: string[] = [];
    const { episode, manques } = await preparerEpisode(
      scenario(),
      { valeur: horsLigne, actualites: horsLigne },
      new Map(),
      etape => etapes.push(etape),
    );
    expect(manques).toBe(5);
    expect(episode.chapitres.length).toBeGreaterThan(2);
    expect(etapes.at(-1)).toBe('Écriture de l’épisode…');
  });

  it('réutilise les fiches déjà chargées', async () => {
    const valeur = jest.fn(() => Promise.reject(new Error('hors ligne')));
    const cache = new Map([['CW8.PA', ficheCw8]]);
    await preparerEpisode(scenario(), { valeur, actualites: async () => [] }, cache);
    expect(valeur).toHaveBeenCalledTimes(1);
    expect(valeur).toHaveBeenCalledWith('STLAP.PA');
  });
});
