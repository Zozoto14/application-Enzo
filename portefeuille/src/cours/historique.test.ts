import { d } from '../core/money/decimal';
import { DepotCours, DepotTitres } from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { titre } from '../core/testing/fixtures';
import { ErreurFournisseur } from './fournisseur';
import {
  PLAGE_DEFAUT,
  chargerHistorique,
  chargerHistoriques,
  resumeHistorique,
  type PointHistorique,
} from './historique';

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

/** Forme réelle de la réponse Yahoo, réduite aux champs lus. */
function reponse(
  horodatages: readonly (number | null)[],
  clotures: readonly (number | null)[],
) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: 'STLAP.PA', currency: 'EUR' },
          timestamp: horodatages,
          indicators: {
            quote: [{ close: clotures }],
            // Presente dans la vraie reponse, et deliberement ignoree.
            adjclose: [{ adjclose: clotures.map(c => (c === null ? null : c * 0.9)) }],
          },
        },
      ],
      error: null,
    },
  };
}

/** 2026-09-21, 22 et 23 à midi UTC. */
const LUNDI = 1789732800;
const MARDI = LUNDI + 86400;
const MERCREDI = LUNDI + 2 * 86400;

describe('chargerHistorique', () => {
  it('lit les séances d’une réponse Yahoo', async () => {
    const { fonction, appels } = faussetFetch(
      reponse([LUNDI, MARDI, MERCREDI], [4.2, 4.14, 3.97]),
    );

    const points = await chargerHistorique('STLAP.PA', { recuperer: fonction });

    expect(points).toHaveLength(3);
    expect(points[0].cloture.toString()).toBe('4.2');
    expect(points[2].cloture.toString()).toBe('3.97');
    expect(appels[0]).toContain('/chart/STLAP.PA');
    expect(appels[0]).toContain(`range=${PLAGE_DEFAUT}`);
  });

  it('retient la clôture brute, jamais l’ajustée', async () => {
    // L'application compte deja les dividendes comme des operations : une
    // serie ajustee les compterait une seconde fois et gonflerait la
    // performance d'autant.
    const { fonction } = faussetFetch(reponse([LUNDI], [100]));

    const points = await chargerHistorique('X', { recuperer: fonction });

    expect(points[0].cloture.toString()).toBe('100');
    expect(points[0].cloture.toString()).not.toBe('90');
  });

  it('saute une séance sans cotation au lieu d’inventer un cours', async () => {
    const { fonction } = faussetFetch(reponse([LUNDI, MARDI, MERCREDI], [4.2, null, 3.97]));

    const points = await chargerHistorique('X', { recuperer: fonction });

    expect(points).toHaveLength(2);
    expect(points.map(p => p.cloture.toString())).toEqual(['4.2', '3.97']);
  });

  it('rend les dates croissantes et sans doublon', async () => {
    const { fonction } = faussetFetch(reponse([MARDI, LUNDI, MARDI], [4.14, 4.2, 4.15]));

    const points = await chargerHistorique('X', { recuperer: fonction });

    expect(points).toHaveLength(2);
    expect(points[0].date < points[1].date).toBe(true);
  });

  it('accepte une plage personnalisée', async () => {
    const { fonction, appels } = faussetFetch(reponse([LUNDI], [4.2]));

    await chargerHistorique('X', { plage: '5y', recuperer: fonction });

    expect(appels[0]).toContain('range=5y');
  });

  describe('réponses sans série', () => {
    it('rend une liste vide plutôt que de lever', async () => {
      // Un symbole inconnu ou une valeur trop recente est une reponse, pas
      // une panne.
      const { fonction } = faussetFetch({ chart: { result: [], error: null } });

      expect(await chargerHistorique('ZZZZ', { recuperer: fonction })).toEqual([]);
    });

    it('survit à une réponse sans indicateurs', async () => {
      const { fonction } = faussetFetch({
        chart: { result: [{ meta: { symbol: 'X' }, timestamp: [LUNDI] }] },
      });

      expect(await chargerHistorique('X', { recuperer: fonction })).toEqual([]);
    });
  });

  describe('pannes', () => {
    it('lève quand la source est injoignable', async () => {
      const { fonction } = faussetFetch({}, { panne: true });

      await expect(chargerHistorique('X', { recuperer: fonction })).rejects.toThrow(
        ErreurFournisseur,
      );
    });

    it('nomme le symbole dans l’erreur', async () => {
      const { fonction } = faussetFetch({}, { statut: 404 });

      await expect(chargerHistorique('ZZZZ.PA', { recuperer: fonction })).rejects.toThrow(
        /ZZZZ\.PA/,
      );
    });
  });
});

describe('chargerHistoriques', () => {
  let pilote: PiloteSqlite;

  beforeEach(() => {
    pilote = ouvrirBaseNode();
    migrer(pilote);
    const titres = new DepotTitres(pilote);
    titres.enregistrer(titre());
    titres.enregistrer(titre({ id: 'cw8', isin: 'LU1681043599', nom: 'MSCI World' }));
  });

  afterEach(() => {
    pilote.fermer();
  });

  /** Chargeur de test, par symbole. */
  function chargeur(par: Record<string, PointHistorique[] | 'panne'>) {
    return (async (symbole: string) => {
      const reponse = par[symbole];
      if (reponse === 'panne') {
        throw new ErreurFournisseur('injoignable');
      }
      return reponse ?? [];
    }) as typeof chargerHistorique;
  }

  it('écrit l’historique de chaque valeur', async () => {
    const rapport = await chargerHistoriques(
      pilote,
      [
        { titreId: 'air-liquide', nom: 'Air Liquide', symbole: 'AI.PA' },
        { titreId: 'cw8', nom: 'MSCI World', symbole: 'CW8.PA' },
      ],
      {
        charger: chargeur({
          'AI.PA': [
            { date: '2026-09-21', cloture: d('180') },
            { date: '2026-09-22', cloture: d('182.5') },
          ],
          'CW8.PA': [{ date: '2026-09-22', cloture: d('698.18') }],
        }),
      },
    );

    expect(rapport.points).toBe(3);
    const historique = new DepotCours(pilote).historique();
    expect(historique.get('air-liquide')).toHaveLength(2);
    expect(historique.get('cw8')![0].cloture.eq(d('698.18'))).toBe(true);
  });

  it('rend les cours utilisables par la valorisation', async () => {
    await chargerHistoriques(
      pilote,
      [{ titreId: 'air-liquide', nom: 'Air Liquide', symbole: 'AI.PA' }],
      {
        charger: chargeur({
          'AI.PA': [
            { date: '2026-09-21', cloture: d('180') },
            { date: '2026-09-22', cloture: d('182.5') },
          ],
        }),
      },
    );

    // Le dernier cours devient celui qui valorise le portefeuille.
    expect(new DepotCours(pilote).derniersCours().get('air-liquide')!.eq(d('182.5'))).toBe(
      true,
    );
  });

  it('garde ce qui a été chargé quand une valeur échoue', async () => {
    // Meme regle que le rafraichissement : mieux vaut une valeur sur deux
    // que rien du tout.
    const rapport = await chargerHistoriques(
      pilote,
      [
        { titreId: 'air-liquide', nom: 'Air Liquide', symbole: 'AI.PA' },
        { titreId: 'cw8', nom: 'MSCI World', symbole: 'CW8.PA' },
      ],
      {
        charger: chargeur({
          'AI.PA': [{ date: '2026-09-22', cloture: d('182.5') }],
          'CW8.PA': 'panne',
        }),
      },
    );

    expect(rapport.points).toBe(1);
    expect(rapport.echecs).toEqual([{ nom: 'MSCI World', raison: 'injoignable' }]);
    expect(new DepotCours(pilote).historique().get('air-liquide')).toHaveLength(1);
  });

  it('distingue une valeur sans historique d’un échec', async () => {
    const rapport = await chargerHistoriques(
      pilote,
      [{ titreId: 'cw8', nom: 'MSCI World', symbole: 'MAUVAIS' }],
      { charger: chargeur({}) },
    );

    expect(rapport.vides).toEqual(['MSCI World']);
    expect(rapport.echecs).toEqual([]);
    expect(rapport.points).toBe(0);
  });

  it('remplace un cours déjà connu à la même date', async () => {
    new DepotCours(pilote).enregistrer('air-liquide', '2026-09-22', d('1'));

    await chargerHistoriques(
      pilote,
      [{ titreId: 'air-liquide', nom: 'Air Liquide', symbole: 'AI.PA' }],
      { charger: chargeur({ 'AI.PA': [{ date: '2026-09-22', cloture: d('182.5') }] }) },
    );

    expect(new DepotCours(pilote).historique().get('air-liquide')).toHaveLength(1);
    expect(
      new DepotCours(pilote).derniersCours().get('air-liquide')!.eq(d('182.5')),
    ).toBe(true);
  });
});

describe('resumeHistorique', () => {
  it('annonce ce qui a été chargé et depuis quand', () => {
    const resume = resumeHistorique({
      points: 502,
      charges: [
        { nom: 'Air Liquide', points: 251, depuis: '2024-09-23' },
        { nom: 'MSCI World', points: 251, depuis: '2024-10-01' },
      ],
      vides: [],
      echecs: [],
    });

    expect(resume).toContain('502 cotation(s) chargée(s) sur 2 valeur(s)');
    expect(resume).toContain('depuis le 23/09/2024');
  });

  it('renvoie vers les symboles quand une valeur n’a rien rendu', () => {
    const resume = resumeHistorique({
      points: 0,
      charges: [],
      vides: ['STELLANTIS'],
      echecs: [],
    });

    expect(resume).toContain('Aucune cotation chargée.');
    expect(resume).toMatch(/Vérifiez le symbole dans Réglages → Symboles/);
  });

  it('nomme les échecs et leur raison', () => {
    const resume = resumeHistorique({
      points: 0,
      charges: [],
      vides: [],
      echecs: [{ nom: 'Air Liquide', raison: 'réponse 429' }],
    });

    expect(resume).toContain('Air Liquide (réponse 429)');
  });
});
