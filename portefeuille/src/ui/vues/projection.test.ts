import { Decimal, d } from '../../core/money/decimal';
import {
  CHAMPS_DEFAUT,
  construireProjection,
  nombreSaisi,
  type ChampsProjection,
  type EntreesProjection,
} from './projection';

function entrees(
  champs: Partial<ChampsProjection> = {},
  capitalActuel = d(10000),
): EntreesProjection {
  return { champs: { ...CHAMPS_DEFAUT, ...champs }, capitalActuel };
}

describe('nombreSaisi', () => {
  it('accepte la virgule décimale française', () => {
    expect(nombreSaisi('7,5')).toBe(7.5);
  });

  it('ignore les espaces de groupement', () => {
    expect(nombreSaisi('1 000')).toBe(1000);
    expect(nombreSaisi('1 000,50')).toBe(1000.5);
  });

  it('rend undefined sur une saisie vide ou illisible', () => {
    expect(nombreSaisi('')).toBeUndefined();
    expect(nombreSaisi('beaucoup')).toBeUndefined();
  });
});

describe('construireProjection', () => {
  it('reprend la valeur du portefeuille quand le capital est laissé vide', () => {
    // Le cas courant : retaper le montant serait une occasion de se tromper.
    const petit = construireProjection(entrees({ capital: '' }, d(10000)));
    const gros = construireProjection(entrees({ capital: '' }, d(50000)));

    expect(petit.calculable).toBe(true);
    expect(gros.centralReel).not.toBe(petit.centralReel);
  });

  it('accepte un capital saisi à la place de celui du portefeuille', () => {
    const repris = construireProjection(entrees({ capital: '' }, d(10000)));
    const saisi = construireProjection(entrees({ capital: '50 000' }, d(10000)));

    expect(saisi.centralReel).not.toBe(repris.centralReel);
    // Le meme montant saisi redonne le meme resultat que la reprise.
    expect(construireProjection(entrees({ capital: '10 000' }, d(10000))).centralReel).toBe(
      repris.centralReel,
    );
  });

  describe('fourchette', () => {
    it('ne rend jamais un chiffre seul', () => {
      const vue = construireProjection(entrees());

      expect(vue.centralReel).toMatch(/€/);
      expect(vue.fourchette).toMatch(/^de .+ à .+$/);
    });

    it('distingue les euros d’aujourd’hui des euros courants', () => {
      const vue = construireProjection(entrees());

      expect(vue.centralReel).not.toBe(vue.centralNominal);
    });

    it('confond les deux quand l’inflation est nulle', () => {
      const vue = construireProjection(entrees({ inflation: '0' }));

      expect(vue.centralReel).toBe(vue.centralNominal);
    });
  });

  describe('intérêts', () => {
    it('dit quelle part du capital vient des intérêts', () => {
      const vue = construireProjection(entrees({ annees: '30' }));

      expect(vue.commentaireInterets).toMatch(
        /Les intérêts représentent \d+ % du capital final/,
      );
      expect(vue.commentaireInterets).toMatch(/Le reste, vous l’avez versé/);
    });

    it('annonce l’année de bascule quand elle arrive', () => {
      const vue = construireProjection(entrees({ annees: '40' }));

      expect(vue.anneeBascule).toMatch(/les intérêts dépassent ce que vous avez versé/);
    });

    it('n’en invente pas quand elle n’arrive pas', () => {
      const vue = construireProjection(
        entrees({ annees: '5', rendementAnnuel: '1', fraisAnnuels: '0' }),
      );

      expect(vue.anneeBascule).toBeUndefined();
    });
  });

  it('retranche les frais du rendement affiché', () => {
    const vue = construireProjection(entrees({ rendementAnnuel: '7', fraisAnnuels: '0,5' }));

    expect(vue.rendementNet).toMatch(/^6,50/);
  });

  describe('courbe', () => {
    it('rend un point par année, plus l’année zéro', () => {
      expect(construireProjection(entrees({ annees: '20' })).courbe).toHaveLength(21);
    });

    it('encadre le central entre le prudent et le favorable', () => {
      const vue = construireProjection(entrees());
      const dernier = vue.courbe[vue.courbe.length - 1];

      expect(dernier.fractionBasse).toBeLessThan(dernier.fraction);
      expect(dernier.fraction).toBeLessThan(dernier.fractionHaute);
      expect(dernier.fractionHaute).toBeCloseTo(1);
    });
  });

  describe('objectif d’indépendance', () => {
    it('reste absent tant qu’aucune dépense n’est saisie', () => {
      expect(construireProjection(entrees()).objectif).toBeUndefined();
    });

    it('calcule le capital nécessaire au taux retenu', () => {
      const vue = construireProjection(
        entrees({ depensesAnnuelles: '24 000', tauxRetrait: '4' }),
      );

      expect(vue.objectif!.capitalNecessaire).toMatch(/600/);
    });

    it('dit en combien d’années il est atteint', () => {
      const vue = construireProjection(
        entrees({ depensesAnnuelles: '6 000', annees: '40' }),
      );

      expect(vue.objectif!.resume).toMatch(/Atteint au bout de \d+ an\(s\), en euros d’aujourd’hui/);
      expect(vue.objectif!.fraction).toBe(1);
    });

    it('explique au lieu de promettre quand l’horizon ne suffit pas', () => {
      const vue = construireProjection(
        entrees({ depensesAnnuelles: '200 000', annees: '10' }),
      );

      expect(vue.objectif!.resume).toMatch(/n’est pas atteint/);
      expect(vue.objectif!.fraction).toBeLessThan(1);
    });

    it('signale un objectif déjà atteint', () => {
      const vue = construireProjection(
        entrees({ depensesAnnuelles: '100', capital: '100 000' }),
      );

      expect(vue.objectif!.resume).toMatch(/déjà atteint aujourd’hui/);
    });
  });

  describe('saisies invalides', () => {
    it('refuse de calculer plutôt que d’afficher un résultat faux', () => {
      const vue = construireProjection(entrees({ rendementAnnuel: 'beaucoup' }));

      expect(vue.calculable).toBe(false);
      expect(vue.centralReel).toBe('—');
      expect(vue.commentaireInterets).toMatch(/Complétez les hypothèses/);
    });

    it('nomme le champ fautif', () => {
      const vue = construireProjection(entrees({ annees: '200' }));

      expect(vue.erreurs.annees).toBe('Au maximum 50.');
    });

    it('refuse un versement négatif', () => {
      const vue = construireProjection(entrees({ versementMensuel: '-100' }));

      expect(vue.erreurs.versementMensuel).toBe('Au minimum 0.');
    });

    it('refuse un horizon nul, qui ne projette rien', () => {
      expect(construireProjection(entrees({ annees: '0' })).calculable).toBe(false);
    });

    it('accepte un capital de départ nul', () => {
      const vue = construireProjection(entrees({ capital: '0' }, Decimal.ZERO));

      expect(vue.calculable).toBe(true);
      expect(vue.erreurs.capital).toBeUndefined();
    });
  });
});
