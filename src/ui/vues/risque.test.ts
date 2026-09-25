import { d } from '../../core/money/decimal';
import type { Transaction } from '../../core/domain/types';
import { rejouer } from '../../core/portfolio/engine';
import type { CoursDate, HistoriqueCours } from '../../core/performance/serie';
import { achat, compte, titre, versement } from '../../core/testing/fixtures';
import { construireRisque, type EntreesRisque } from './risque';

const pea = compte();
const airLiquide = titre();
const totalEnergies = titre({
  id: 'totalenergies',
  nom: 'TotalEnergies',
  ticker: 'TTE',
  secteur: 'Énergie',
  zoneGeographique: 'Europe',
});
const apple = titre({
  id: 'apple',
  nom: 'Apple',
  ticker: 'AAPL',
  secteur: 'Technologie',
  zoneGeographique: 'Amérique du Nord',
  eligiblePEA: false,
});

/**
 * Série de cours quotidienne.
 * `variation` façonne la forme : deux séries de même forme corrèlent à 1.
 */
function serie(
  jours: number,
  depart: number,
  variation: (index: number) => number,
): CoursDate[] {
  const points: CoursDate[] = [];
  for (let index = 0; index < jours; index++) {
    const date = new Date(2026, 0, 1 + index);
    points.push({
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`,
      cloture: d((depart * (1 + variation(index))).toFixed(4)),
    });
  }
  return points;
}

const TRANSACTIONS: Transaction[] = [
  versement('2026-01-01', 10000),
  achat('2026-01-02', 10, 100, 0),
  achat('2026-01-02', 20, 50, 0, { titreId: 'totalenergies' }),
];

function entrees(partiel: Partial<EntreesRisque> = {}): EntreesRisque {
  const etat = rejouer([pea], TRANSACTIONS);
  return {
    etat,
    titres: [airLiquide, totalEnergies, apple],
    cours: new Map([
      ['air-liquide', d('100')],
      ['totalenergies', d('50')],
    ]),
    historique: new Map<string, CoursDate[]>(),
    ...partiel,
  };
}

describe('construireRisque', () => {
  it('dit qu’il n’y a rien à mesurer sans position', () => {
    const vue = construireRisque(
      entrees({ etat: rejouer([pea], [versement('2026-01-01', 1000)]) }),
    );

    expect(vue.aucunePosition).toBe(true);
    expect(vue.concentration).toBeUndefined();
  });

  it('signale les lignes exclues faute de cours', () => {
    const vue = construireRisque(entrees({ cours: new Map([['air-liquide', d('100')]]) }));

    expect(vue.sansCours).toEqual(['TotalEnergies']);
  });

  describe('concentration', () => {
    it('mesure la concentration sans aucun historique', () => {
      // C'est la mesure la plus sure, et elle est disponible des le premier
      // jour : l'onglet doit dire quelque chose d'utile tout de suite.
      const vue = construireRisque(entrees());

      expect(vue.concentration!.nombreLignes).toBe(2);
      expect(vue.concentration!.lignesEquivalentes).toBe('2,0');
    });

    it('nomme la première ligne et sa part', () => {
      const vue = construireRisque(
        entrees({
          cours: new Map([
            ['air-liquide', d('300')],
            ['totalenergies', d('50')],
          ]),
        }),
      );

      // 10 × 300 = 3 000 contre 20 × 50 = 1 000 : 75 %.
      expect(vue.concentration!.premiereLigne).toBe('Air Liquide');
      expect(vue.concentration!.premierePart).toMatch(/^75,0/);
      expect(vue.concentration!.lignesPourMoitie).toBe(1);
    });

    it('démasque une diversification de façade', () => {
      const nombreuses: Transaction[] = [
        versement('2026-01-01', 100000),
        achat('2026-01-02', 80, 100, 0),
        achat('2026-01-02', 40, 50, 0, { titreId: 'totalenergies' }),
      ];
      const vue = construireRisque(
        entrees({
          etat: rejouer([pea], nombreuses),
          cours: new Map([
            ['air-liquide', d('100')],
            ['totalenergies', d('50')],
          ]),
        }),
      );

      // 8 000 contre 2 000 : deux lignes, mais 1,47 ligne equivalente.
      expect(vue.concentration!.nombreLignes).toBe(2);
      expect(Number(vue.concentration!.lignesEquivalentes.replace(',', '.'))).toBeLessThan(2);
      expect(vue.concentration!.verdict).toMatch(/concentré/i);
    });

    it('avertit franchement sur une ligne unique', () => {
      const vue = construireRisque(
        entrees({
          etat: rejouer([pea], [versement('2026-01-01', 10000), achat('2026-01-02', 10, 100, 0)]),
        }),
      );

      expect(vue.concentration!.verdict).toMatch(/une entreprise/);
    });

    it('regroupe une même valeur détenue sur deux comptes', () => {
      // Sinon la concentration paraitrait meilleure qu'elle n'est.
      const cto = compte({ id: 'cto', nom: 'CTO', type: 'CTO' });
      const surDeuxComptes: Transaction[] = [
        versement('2026-01-01', 10000),
        versement('2026-01-01', 10000, { compteId: 'cto' }),
        achat('2026-01-02', 10, 100, 0),
        achat('2026-01-02', 10, 100, 0, { compteId: 'cto' }),
        achat('2026-01-02', 20, 50, 0, { titreId: 'totalenergies' }),
      ];
      const vue = construireRisque(entrees({ etat: rejouer([pea, cto], surDeuxComptes) }));

      // Air Liquide compte pour une seule valeur, a 2 000 contre 1 000.
      expect(vue.concentration!.nombreLignes).toBe(2);
      expect(vue.concentration!.premiereLigne).toBe('Air Liquide');
    });
  });

  describe('répartitions', () => {
    it('ventile par secteur', () => {
      const vue = construireRisque(entrees());

      expect(vue.parSecteur.map(ligne => ligne.cle).sort()).toEqual([
        'Matériaux',
        'Énergie',
      ]);
    });

    it('ventile par zone géographique', () => {
      const vue = construireRisque(entrees());

      expect(vue.parZone).toHaveLength(1);
      expect(vue.parZone[0].cle).toBe('Europe');
      expect(vue.parZone[0].pourcentage).toMatch(/^100,0/);
    });

    it('affiche les parts sans signe, qui se lirait comme une hausse', () => {
      const vue = construireRisque(entrees());

      expect(vue.parSecteur[0].pourcentage).not.toMatch(/^\+/);
    });
  });

  describe('contributions au risque', () => {
    const historique: HistoriqueCours = new Map([
      ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
      ['totalenergies', serie(60, 50, index => Math.sin(index) / 20)],
    ]);

    it('montre qu’une ligne peut peser plus dans le risque que dans le capital', () => {
      const vue = construireRisque(entrees({ historique }));

      expect(vue.contributions).toHaveLength(2);
      const agitee = vue.contributions.find(ligne => ligne.nom === 'TotalEnergies')!;
      expect(agitee.disproportionnee).toBe(true);
    });

    it('classe la plus contributrice en tête', () => {
      const vue = construireRisque(entrees({ historique }));

      expect(vue.contributions[0].nom).toBe('TotalEnergies');
    });

    it('explique ce qui manque au lieu d’afficher un tableau vide', () => {
      const vue = construireRisque(entrees());

      expect(vue.contributions).toEqual([]);
      expect(vue.motifContributions).toMatch(/relevés de cours/);
    });

    it('compte les relevés réellement disponibles dans son explication', () => {
      const court: HistoriqueCours = new Map([
        ['air-liquide', serie(6, 100, index => index / 100)],
      ]);
      const vue = construireRisque(entrees({ historique: court }));

      // Six points donnent cinq rendements.
      expect(vue.motifContributions).toMatch(/en compte 5/);
    });
  });

  describe('corrélations', () => {
    it('refuse de mesurer sur un historique trop court', () => {
      const court: HistoriqueCours = new Map([
        ['air-liquide', serie(10, 100, index => index / 100)],
        ['totalenergies', serie(10, 50, index => index / 100)],
      ]);
      const vue = construireRisque(entrees({ historique: court }));

      expect(vue.correlations[0].valeur).toBeNull();
      expect(vue.motifCorrelations).toMatch(/par hasard/);
    });

    it('mesure quand l’historique suffit', () => {
      const long: HistoriqueCours = new Map([
        ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
        ['totalenergies', serie(60, 50, index => Math.sin(index) / 100)],
      ]);
      const vue = construireRisque(entrees({ historique: long }));

      expect(vue.correlations).toHaveLength(1);
      expect(vue.correlations[0].brute).toBeCloseTo(1);
      expect(vue.motifCorrelations).toBeUndefined();
    });

    it('commente une corrélation forte', () => {
      const long: HistoriqueCours = new Map([
        ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
        ['totalenergies', serie(60, 50, index => Math.sin(index) / 100)],
      ]);
      const vue = construireRisque(entrees({ historique: long }));

      expect(vue.correlations[0].commentaire).toMatch(/de concert/);
    });

    it('appuie le commentaire quand les deux valeurs partagent un secteur', () => {
      const memeSecteur = titre({
        id: 'engie',
        nom: 'Engie',
        secteur: 'Matériaux',
        zoneGeographique: 'Europe',
      });
      const long: HistoriqueCours = new Map([
        ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
        ['engie', serie(60, 20, index => Math.sin(index) / 100)],
      ]);
      const transactions: Transaction[] = [
        versement('2026-01-01', 10000),
        achat('2026-01-02', 10, 100, 0),
        achat('2026-01-02', 50, 20, 0, { titreId: 'engie' }),
      ];
      const vue = construireRisque(
        entrees({
          etat: rejouer([pea], transactions),
          titres: [airLiquide, memeSecteur],
          cours: new Map([
            ['air-liquide', d('100')],
            ['engie', d('20')],
          ]),
          historique: long,
        }),
      );

      expect(vue.correlations[0].commentaire).toMatch(/même secteur/);
    });

    it('dit qu’une seule valeur ne se corrèle à rien', () => {
      const vue = construireRisque(
        entrees({
          etat: rejouer([pea], [versement('2026-01-01', 10000), achat('2026-01-02', 10, 100, 0)]),
        }),
      );

      expect(vue.correlations).toEqual([]);
      expect(vue.motifCorrelations).toMatch(/au moins deux valeurs/);
    });

    it('borne le nombre de paires affichées', () => {
      // Dix valeurs font quarante-cinq paires : le tableau deviendrait
      // illisible bien avant d'etre informatif.
      const nombreuses = Array.from({ length: 10 }, (_, index) =>
        titre({ id: `titre-${index}`, nom: `Valeur ${index}` }),
      );
      const transactions: Transaction[] = [
        versement('2026-01-01', 100000),
        ...nombreuses.map((valeur, index) =>
          achat('2026-01-02', 10, 100 + index, 0, { titreId: valeur.id }),
        ),
      ];
      const vue = construireRisque(
        entrees({
          etat: rejouer([pea], transactions),
          titres: nombreuses,
          cours: new Map(nombreuses.map((valeur, index) => [valeur.id, d(100 + index)])),
        }),
      );

      expect(vue.correlations).toHaveLength(15);
    });
  });
});
