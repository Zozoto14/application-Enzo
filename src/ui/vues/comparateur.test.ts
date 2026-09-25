import { Decimal, d } from '../../core/money/decimal';
import type { Transaction } from '../../core/domain/types';
import { rejouer } from '../../core/portfolio/engine';
import type { CoursDate } from '../../core/performance/serie';
import { achat, compte, titre, versement } from '../../core/testing/fixtures';
import {
  VALEURS_MAXIMUM,
  construireComparateur,
  observationsCommunes,
  type EntreesComparateur,
} from './comparateur';

const INSEC = ' ';

const pea = compte();
const airLiquide = titre();
const total = titre({
  id: 'totalenergies',
  nom: 'TotalEnergies',
  ticker: 'TTE',
  secteur: 'Énergie',
});
const monde = titre({
  id: 'cw8',
  isin: 'LU1681043599',
  nom: 'MSCI World',
  ticker: 'CW8',
  secteur: 'Diversifié',
});

function jour(index: number): string {
  const date = new Date(2026, 0, 1 + index);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function serie(
  jours: number,
  depart: number,
  forme: (index: number) => number,
  decalage = 0,
): CoursDate[] {
  return Array.from({ length: jours }, (_, index) => ({
    date: jour(index + decalage),
    cloture: d((depart * (1 + forme(index))).toFixed(4)),
  }));
}

const TRANSACTIONS: Transaction[] = [
  versement('2026-01-01', 10000),
  achat('2026-01-02', 10, 100, 0),
  achat('2026-01-02', 20, 50, 0, { titreId: 'totalenergies' }),
];

function entrees(partiel: Partial<EntreesComparateur> = {}): EntreesComparateur {
  return {
    retenus: ['air-liquide', 'totalenergies'],
    titres: [airLiquide, total, monde],
    etat: rejouer([pea], TRANSACTIONS),
    cours: new Map([
      ['air-liquide', d('120')],
      ['totalenergies', d('60')],
    ]),
    historique: new Map<string, CoursDate[]>([
      ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
      ['totalenergies', serie(60, 50, index => Math.sin(index) / 20)],
    ]),
    dividendesDouzeMois: new Map([['air-liquide', d('40')]]),
    surveilles: new Set(['cw8']),
    ...partiel,
  };
}

describe('construireComparateur', () => {
  it('rend une colonne par valeur retenue', () => {
    const vue = construireComparateur(entrees());

    expect(vue.colonnes.map(c => c.nom)).toEqual(['Air Liquide', 'TotalEnergies']);
  });

  it('reprend le signalement des valeurs', () => {
    const vue = construireComparateur(entrees());

    expect(vue.colonnes[1]).toMatchObject({
      ticker: 'TTE',
      secteur: 'Énergie',
      eligiblePEA: true,
    });
  });

  describe('période commune', () => {
    it('la situe explicitement', () => {
      const vue = construireComparateur(entrees());

      expect(vue.periode).toMatch(/où toutes les valeurs comparées ont un historique/);
    });

    it('la borne sur la plus courte des deux', () => {
      // Comparer deux ans a trois semaines ne dit rien : on aligne.
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', serie(60, 100, () => 0.1)],
            ['totalenergies', serie(10, 50, () => 0.1, 30)],
          ]),
        }),
      );

      expect(vue.periode).toContain(formaterJour(30));
      expect(vue.periode).toContain(formaterJour(39));
    });

    it('dit ce qui manque quand il n’y a aucune période commune', () => {
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', serie(10, 100, () => 0.1)],
            ['totalenergies', serie(10, 50, () => 0.1, 200)],
          ]),
        }),
      );

      expect(vue.message).toMatch(/Aucune période commune/);
      expect(vue.colonnes[0].performance.valeur).toBeNull();
    });
  });

  describe('performance', () => {
    it('se calcule du premier au dernier point de la période commune', () => {
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', [
              { date: jour(0), cloture: d('100') },
              { date: jour(1), cloture: d('120') },
            ]],
            ['totalenergies', [
              { date: jour(0), cloture: d('50') },
              { date: jour(1), cloture: d('55') },
            ]],
          ]),
        }),
      );

      expect(vue.colonnes[0].performance.valeur).toBe(`+20,00${INSEC}%`);
      expect(vue.colonnes[1].performance.valeur).toBe(`+10,00${INSEC}%`);
      expect(vue.colonnes[0].tendancePerformance).toBe('hausse');
    });

    it('refuse sur un seul point', () => {
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', [{ date: jour(0), cloture: d('100') }]],
            ['totalenergies', [{ date: jour(0), cloture: d('50') }]],
          ]),
        }),
      );

      expect(vue.colonnes[0].performance.valeur).toBeNull();
      expect(vue.colonnes[0].performance.motif).toMatch(/Moins de deux relevés/);
    });
  });

  describe('volatilité', () => {
    it('la mesure quand l’historique suffit', () => {
      const vue = construireComparateur(entrees());

      expect(vue.colonnes[0].volatilite.valeur).toMatch(/%$/);
      // TotalEnergies bouge cinq fois plus dans les series de test.
      expect(vue.colonnes[1].volatilite.valeur).not.toBe(vue.colonnes[0].volatilite.valeur);
    });

    it('refuse en disant combien de relevés manquent', () => {
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', serie(6, 100, index => index / 100)],
            ['totalenergies', serie(6, 50, index => index / 100)],
          ]),
        }),
      );

      expect(vue.colonnes[0].volatilite.valeur).toBeNull();
      expect(vue.colonnes[0].volatilite.motif).toMatch(/5 relevé\(s\).*20 nécessaires/);
    });
  });

  describe('détenue ou seulement surveillée', () => {
    it('donne poids, PRU et plus-value pour une ligne détenue', () => {
      const vue = construireComparateur(entrees());

      expect(vue.colonnes[0].detenue).toBe(true);
      expect(vue.colonnes[0].pru).toBe(`100,00${INSEC}€`);
      // 10 x 120 = 1 200, revient 1 000.
      expect(vue.colonnes[0].plusValue).toBe(`+200,00${INSEC}€`);
      expect(vue.colonnes[0].tendancePlusValue).toBe('hausse');
      // 1 200 sur 1 200 + 1 200.
      expect(vue.colonnes[0].poids).toBe(`50,0${INSEC}%`);
    });

    it('les laisse absents pour une valeur seulement surveillée', () => {
      // Un tiret se prendrait pour un zero : mieux vaut ne rien afficher.
      const vue = construireComparateur(
        entrees({
          retenus: ['air-liquide', 'cw8'],
          historique: new Map([
            ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
            ['cw8', serie(60, 700, index => Math.sin(index) / 100)],
          ]),
          cours: new Map([
            ['air-liquide', d('120')],
            ['cw8', d('700')],
          ]),
        }),
      );

      expect(vue.colonnes[1].detenue).toBe(false);
      expect(vue.colonnes[1].pru).toBeUndefined();
      expect(vue.colonnes[1].plusValue).toBeUndefined();
      expect(vue.colonnes[1].rendementSurRevient).toBeUndefined();
    });

    it('rapporte les dividendes au prix de revient', () => {
      // 40 € sur douze mois pour 1 000 € de revient.
      const vue = construireComparateur(entrees());

      expect(vue.colonnes[0].rendementSurRevient!.valeur).toBe(`4,00${INSEC}%`);
      expect(vue.colonnes[1].dividendesDouzeMois).toBe(`0,00${INSEC}€`);
    });
  });

  describe('corrélations entre les valeurs comparées', () => {
    it('mesure chaque paire', () => {
      const vue = construireComparateur(entrees());

      expect(vue.paires).toHaveLength(1);
      expect(vue.paires[0].correlation.valeur).not.toBeNull();
    });

    it('commente une corrélation forte en termes d’arbitrage', () => {
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
            ['totalenergies', serie(60, 50, index => Math.sin(index) / 100)],
          ]),
        }),
      );

      expect(vue.paires[0].commentaire).toMatch(/Passer de l’une à l’autre diversifie moins/);
    });

    it('refuse sur un historique trop court', () => {
      const vue = construireComparateur(
        entrees({
          historique: new Map([
            ['air-liquide', serie(10, 100, index => index / 100)],
            ['totalenergies', serie(10, 50, index => index / 100)],
          ]),
        }),
      );

      expect(vue.paires[0].correlation.valeur).toBeNull();
      expect(vue.paires[0].correlation.motif).toMatch(/nécessaires/);
    });

    it('rend trois paires pour trois valeurs', () => {
      const vue = construireComparateur(
        entrees({
          retenus: ['air-liquide', 'totalenergies', 'cw8'],
          historique: new Map([
            ['air-liquide', serie(60, 100, index => Math.sin(index) / 100)],
            ['totalenergies', serie(60, 50, index => Math.sin(index) / 20)],
            ['cw8', serie(60, 700, index => Math.cos(index) / 100)],
          ]),
        }),
      );

      expect(vue.colonnes).toHaveLength(3);
      expect(vue.paires).toHaveLength(3);
      expect(vue.complet).toBe(true);
    });
  });

  describe('choix des valeurs', () => {
    it('demande deux valeurs avant de comparer quoi que ce soit', () => {
      const vue = construireComparateur(entrees({ retenus: ['air-liquide'] }));

      expect(vue.colonnes).toEqual([]);
      expect(vue.message).toMatch(/Choisissez deux valeurs/);
    });

    it('propose les valeurs détenues et surveillées, pas les autres', () => {
      const autre = titre({ id: 'inconnue', nom: 'Jamais vue' });
      const vue = construireComparateur(entrees({ titres: [airLiquide, total, monde, autre] }));

      expect(vue.candidats.map(c => c.titreId).sort()).toEqual([
        'air-liquide',
        'cw8',
        'totalenergies',
      ]);
    });

    it('marque celles déjà retenues', () => {
      const vue = construireComparateur(entrees());

      expect(vue.candidats.filter(c => c.retenu).map(c => c.titreId).sort()).toEqual([
        'air-liquide',
        'totalenergies',
      ]);
    });

    it('borne le nombre de valeurs comparées', () => {
      const vue = construireComparateur(
        entrees({ retenus: ['air-liquide', 'totalenergies', 'cw8', 'autre'] }),
      );

      expect(vue.colonnes).toHaveLength(VALEURS_MAXIMUM);
    });

    it('le dit quand il n’y a pas de quoi comparer', () => {
      const vue = construireComparateur(
        entrees({ retenus: [], titres: [airLiquide], surveilles: new Set() }),
      );

      expect(vue.message).toMatch(/au moins deux valeurs détenues ou surveillées/);
      expect(vue.candidats).toHaveLength(1);
    });

    it('ignore un identifiant inconnu', () => {
      const vue = construireComparateur(
        entrees({ retenus: ['air-liquide', 'totalenergies', 'fantome'] }),
      );

      expect(vue.colonnes).toHaveLength(2);
    });
  });

  it('signale un cours inconnu au lieu de le taire', () => {
    const vue = construireComparateur(entrees({ cours: new Map([['air-liquide', d('120')]]) }));

    expect(vue.colonnes[1].cours.valeur).toBeNull();
    expect(vue.colonnes[1].cours.motif).toMatch(/Rafraîchissez les cours/);
  });
});

describe('observationsCommunes', () => {
  it('compte les dates partagées', () => {
    expect(
      observationsCommunes(serie(10, 100, () => 0), serie(10, 50, () => 0, 5)),
    ).toBe(5);
  });

  it('rend zéro sans recouvrement', () => {
    expect(
      observationsCommunes(serie(5, 100, () => 0), serie(5, 50, () => 0, 50)),
    ).toBe(0);
  });
});

/** Date formatée comme l'affichage, pour les assertions de période. */
function formaterJour(index: number): string {
  const [annee, mois, j] = jour(index).split('-');
  return `${j}/${mois}/${annee}`;
}

/** Garde-fou : Decimal reste la base des montants comparés. */
describe('frontière montants / taux', () => {
  it('ne perd pas de centime sur un prix de revient', () => {
    const vue = construireComparateur(entrees());

    expect(vue.colonnes[0].pru).toBe(formaterMontantAttendu(d('100')));
  });
});

function formaterMontantAttendu(valeur: Decimal): string {
  return `${valeur.toFixed(2).replace('.', ',')}${INSEC}€`;
}
