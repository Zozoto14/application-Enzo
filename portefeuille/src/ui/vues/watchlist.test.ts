import { d } from '../../core/money/decimal';
import type { LigneWatchlist } from '../../db/depots';
import { titre } from '../../core/testing/fixtures';
import { construireWatchlist, type EntreesWatchlist } from './watchlist';

const INSEC = ' ';

const airLiquide = titre();
const monde = titre({ id: 'cw8', nom: 'Amundi MSCI World', ticker: 'CW8' });

function entrees(partiel: Partial<EntreesWatchlist> = {}): EntreesWatchlist {
  return {
    watchlist: [{ titreId: 'cw8', ajouteLe: '2026-03-12', coursAjout: d(42) }],
    titres: [airLiquide, monde],
    cours: new Map([
      ['cw8', d(51)],
      ['air-liquide', d(180)],
    ]),
    titresDetenus: new Set(['air-liquide']),
    seuils: {},
    ...partiel,
  };
}

describe('construireWatchlist', () => {
  it('liste les valeurs surveillées avec leur cours', () => {
    const vue = construireWatchlist(entrees());

    expect(vue.lignes).toHaveLength(1);
    expect(vue.lignes[0].nom).toBe('Amundi MSCI World');
    expect(vue.lignes[0].cours).toBe(`51,00${INSEC}€`);
  });

  describe('écart depuis l’ajout', () => {
    it('mesure le chemin parcouru depuis qu’on la regarde', () => {
      // « Je la regardais a 42 €, elle est a 51 » : c'est ce qui transforme
      // une liste de noms en observation utile.
      const vue = construireWatchlist(entrees());

      expect(vue.lignes[0].ecart).toBe(`+9,00${INSEC}€`);
      expect(vue.lignes[0].ecartPourcent).toBe(`+21,43${INSEC}%`);
      expect(vue.lignes[0].tendance).toBe('hausse');
    });

    it('situe le début du suivi', () => {
      const vue = construireWatchlist(entrees());

      expect(vue.lignes[0].depuis).toBe(`Suivie depuis le 12/03/2026, à 42,00${INSEC}€.`);
    });

    it('explique un cours actuel inconnu', () => {
      const vue = construireWatchlist(entrees({ cours: new Map() }));

      expect(vue.lignes[0].ecart).toBeUndefined();
      expect(vue.lignes[0].motifEcart).toMatch(/Rafraîchissez les cours/);
    });

    it('explique un cours inconnu au moment de l’ajout', () => {
      const sansCours: LigneWatchlist[] = [{ titreId: 'cw8', ajouteLe: '2026-03-12' }];
      const vue = construireWatchlist(entrees({ watchlist: sansCours }));

      expect(vue.lignes[0].ecart).toBeUndefined();
      expect(vue.lignes[0].motifEcart).toMatch(/rien à quoi comparer/);
      expect(vue.lignes[0].depuis).toBe('Suivie depuis le 12/03/2026.');
    });

    it('marque une baisse', () => {
      const vue = construireWatchlist(entrees({ cours: new Map([['cw8', d(38)]]) }));

      expect(vue.lignes[0].tendance).toBe('baisse');
      expect(vue.lignes[0].ecart).toBe(`-4,00${INSEC}€`);
    });
  });

  describe('distinction avec les positions', () => {
    it('signale une valeur à la fois suivie et détenue', () => {
      const vue = construireWatchlist(
        entrees({
          watchlist: [{ titreId: 'air-liquide', ajouteLe: '2026-01-01', coursAjout: d(150) }],
        }),
      );

      expect(vue.lignes[0].detenue).toBe(true);
    });

    it('ne marque pas détenue une valeur seulement surveillée', () => {
      expect(construireWatchlist(entrees()).lignes[0].detenue).toBe(false);
    });
  });

  describe('seuils', () => {
    it('signale un seuil haut franchi', () => {
      const vue = construireWatchlist(entrees({ seuils: { cw8: { haut: '50' } } }));

      expect(vue.lignes[0].seuilAtteint).toBe(true);
      expect(vue.lignes[0].seuilHaut).toBe('50');
    });

    it('signale un seuil bas franchi', () => {
      const vue = construireWatchlist(
        entrees({ cours: new Map([['cw8', d(30)]]), seuils: { cw8: { bas: '35' } } }),
      );

      expect(vue.lignes[0].seuilAtteint).toBe(true);
    });

    it('ne signale rien tant que le seuil tient', () => {
      const vue = construireWatchlist(entrees({ seuils: { cw8: { haut: '60' } } }));

      expect(vue.lignes[0].seuilAtteint).toBe(false);
    });

    it('accepte une virgule décimale dans le seuil saisi', () => {
      const vue = construireWatchlist(entrees({ seuils: { cw8: { haut: '50,5' } } }));

      expect(vue.lignes[0].seuilAtteint).toBe(true);
    });

    it('ignore un seuil illisible au lieu de faire échouer la liste', () => {
      const vue = construireWatchlist(entrees({ seuils: { cw8: { haut: 'cher' } } }));

      expect(vue.lignes[0].seuilAtteint).toBe(false);
      expect(vue.lignes).toHaveLength(1);
    });

    it('ignore un seuil vide', () => {
      const vue = construireWatchlist(entrees({ seuils: { cw8: { haut: '', bas: '  ' } } }));

      expect(vue.lignes[0].seuilAtteint).toBe(false);
    });
  });

  describe('candidats', () => {
    it('propose les valeurs pas encore surveillées', () => {
      const vue = construireWatchlist(entrees());

      expect(vue.candidats.map(c => c.titreId)).toEqual(['air-liquide']);
    });

    it('dit lesquelles sont déjà détenues, avant l’ajout', () => {
      const vue = construireWatchlist(entrees());

      expect(vue.candidats[0].detenue).toBe(true);
    });

    it('classe par nom', () => {
      const zeta = titre({ id: 'zeta', nom: 'Zeta', ticker: 'Z' });
      const alpha = titre({ id: 'alpha', nom: 'Alpha', ticker: 'A' });
      const vue = construireWatchlist(
        entrees({ titres: [zeta, alpha, monde], watchlist: [] }),
      );

      expect(vue.candidats.map(c => c.nom)).toEqual(['Alpha', 'Amundi MSCI World', 'Zeta']);
    });
  });

  describe('listes vides', () => {
    it('invite à surveiller quand la liste est vide', () => {
      const vue = construireWatchlist(entrees({ watchlist: [] }));

      expect(vue.aucuneSurveillance).toBe(true);
      expect(vue.message).toMatch(/sans avoir à l’acheter/);
    });

    it('renvoie vers la création quand aucune valeur n’existe', () => {
      const vue = construireWatchlist(entrees({ watchlist: [], titres: [] }));

      expect(vue.message).toMatch(/Aucune valeur enregistrée/);
      expect(vue.candidats).toEqual([]);
    });
  });

  it('survit à une valeur surveillée dont le titre a disparu', () => {
    const vue = construireWatchlist(entrees({ titres: [airLiquide] }));

    expect(vue.lignes[0].nom).toBe('cw8');
    expect(vue.lignes[0].ticker).toBe('');
  });
});
