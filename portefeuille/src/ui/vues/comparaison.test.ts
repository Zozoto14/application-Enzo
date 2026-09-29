import { d } from '../../core/money/decimal';
import type { PointValorisation } from '../../core/performance/rendements';
import type { CoursDate } from '../../core/performance/serie';
import { titre } from '../../core/testing/fixtures';
import { construireComparaison, type EntreesComparaison } from './comparaison';

const INSEC = ' ';

const monde = titre({ id: 'cw8', nom: 'Amundi MSCI World', ticker: 'CW8' });
const airLiquide = titre();

function jour(index: number): string {
  const date = new Date(2026, 0, 1 + index);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function points(valeurs: readonly number[]): PointValorisation[] {
  return valeurs.map((valeur, index) => ({
    date: jour(index),
    valeurTotale: d(valeur),
    fluxExterne: d(0),
  }));
}

function cours(valeurs: readonly number[], decalage = 0): CoursDate[] {
  return valeurs.map((valeur, index) => ({
    date: jour(index + decalage),
    cloture: d(valeur.toFixed(6)),
  }));
}

function entrees(partiel: Partial<EntreesComparaison> = {}): EntreesComparaison {
  return {
    points: points([100, 120]),
    titres: [monde, airLiquide],
    historique: new Map<string, CoursDate[]>([['cw8', cours([50, 55])]]),
    referenceId: 'cw8',
    ...partiel,
  };
}

describe('construireComparaison', () => {
  it('compare les deux performances et nomme l’écart', () => {
    const vue = construireComparaison(entrees());

    expect(vue.nom).toBe('Amundi MSCI World');
    expect(vue.portefeuille.valeur).toBe(`+20,00${INSEC}%`);
    expect(vue.reference.valeur).toBe(`+10,00${INSEC}%`);
    expect(vue.ecart.valeur).toBe(`+10,00${INSEC}%`);
    expect(vue.tendanceEcart).toBe('hausse');
  });

  it('situe la période réellement comparée', () => {
    // La reference est plus jeune que le portefeuille : il faut le dire,
    // sinon on croit comparer toute son histoire.
    const vue = construireComparaison(
      entrees({
        points: points([100, 110, 120, 132]),
        historique: new Map([['cw8', cours([50, 55], 2)]]),
      }),
    );

    expect(vue.periode).toMatch(/Du 03\/01\/2026 au 04\/01\/2026/);
    expect(vue.periode).toMatch(/se recouvrent/);
  });

  describe('verdict', () => {
    it('le dit quand vous faites mieux', () => {
      expect(construireComparaison(entrees()).verdict).toMatch(/mieux que Amundi MSCI World/);
    });

    it('le dit sans détour quand vous faites moins bien', () => {
      const vue = construireComparaison(
        entrees({ historique: new Map([['cw8', cours([50, 70])]]) }),
      );

      expect(vue.verdict).toMatch(/moins bien/);
      // Sans signe : « -20,00 % de moins » se lirait deux fois.
      expect(vue.verdict).not.toMatch(/-20/);
      expect(vue.verdict).toMatch(/la plupart des portefeuilles/);
    });

    it('parle de jeu égal sous un demi-point', () => {
      const vue = construireComparaison(
        entrees({ historique: new Map([['cw8', cours([50, 59.9])]]) }),
      );

      expect(vue.verdict).toMatch(/jeu égal/);
    });

    it('rappelle qu’un écart se juge sur des années', () => {
      expect(construireComparaison(entrees()).verdict).toMatch(/pas sur des semaines/);
    });
  });

  describe('choix de la référence', () => {
    it('invite à choisir plutôt que d’en imposer une', () => {
      const vue = construireComparaison(entrees({ referenceId: undefined }));

      expect(vue.nom).toBeUndefined();
      expect(vue.message).toMatch(/Choisissez une valeur de référence/);
      expect(vue.message).toMatch(/jamais sur une donnée téléchargée ailleurs/);
    });

    it('propose les valeurs, la mieux suivie en tête', () => {
      const vue = construireComparaison(
        entrees({
          referenceId: undefined,
          historique: new Map([
            ['air-liquide', cours([100, 101, 102])],
            ['cw8', cours([50, 55])],
          ]),
        }),
      );

      expect(vue.choix.map(c => c.nom)).toEqual(['Air Liquide', 'Amundi MSCI World']);
      expect(vue.choix[0].releves).toBe(3);
    });

    it('marque la référence retenue', () => {
      const vue = construireComparaison(entrees());

      expect(vue.choix.find(c => c.retenu)!.titreId).toBe('cw8');
    });

    it('propose les valeurs même quand la comparaison échoue', () => {
      const vue = construireComparaison(entrees({ historique: new Map() }));

      expect(vue.choix).toHaveLength(2);
      expect(vue.message).toMatch(/pas assez de cours/);
    });
  });

  describe('bêta, alpha, corrélation', () => {
    const serie = Array.from({ length: 60 }, (_, index) => 100 * (1 + Math.sin(index) / 50));

    it('affiche le bêta en coefficient, pas en pourcentage', () => {
      const vue = construireComparaison(
        entrees({
          points: points(serie),
          historique: new Map([['cw8', cours(serie)]]),
        }),
      );

      expect(vue.beta.valeur).toBe('1,00');
      expect(vue.correlation.valeur).toBe('1,00');
    });

    it('explique ce qui manque au lieu d’afficher un bêta de circonstance', () => {
      const vue = construireComparaison(entrees());

      expect(vue.beta.valeur).toBeNull();
      expect(vue.beta.motif).toMatch(/nécessaires/);
      expect(vue.alpha.valeur).toBeNull();
    });

    it('donne l’alpha dès que le bêta est disponible', () => {
      // L'alpha se lit sur la periode comparee, comme les deux performances
      // au-dessus : il ne doit pas attendre trois mois de plus.
      const vue = construireComparaison(
        entrees({
          points: points(serie),
          historique: new Map([['cw8', cours(serie)]]),
        }),
      );

      expect(vue.alpha.valeur).not.toBeNull();
    });
  });
});
