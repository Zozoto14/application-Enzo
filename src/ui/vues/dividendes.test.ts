import { d } from '../../core/money/decimal';
import type { Transaction } from '../../core/domain/types';
import { rejouer } from '../../core/portfolio/engine';
import { achat, compte, dividende, titre, vente, versement } from '../../core/testing/fixtures';
import { calendrierDividendes, construireDividendes, type EntreesDividendes } from './dividendes';

const pea = compte();
const airLiquide = titre();
const total = titre({ id: 'totalenergies', nom: 'TotalEnergies', ticker: 'TTE' });

const INSEC = ' ';

/** Deux lignes détenues, 1 000 € de revient chacune. */
const SOCLE: Transaction[] = [
  versement('2023-01-05', 10000),
  achat('2023-01-10', 10, 100, 0),
  achat('2023-01-10', 20, 50, 0, { titreId: 'totalenergies' }),
];

function entrees(partiel: Partial<EntreesDividendes> = {}): EntreesDividendes {
  const transactions = partiel.transactions ?? SOCLE;
  return {
    etat: rejouer([pea], [...transactions]),
    transactions,
    comptes: [pea],
    titres: [airLiquide, total],
    cours: new Map([
      ['air-liquide', d('120')],
      ['totalenergies', d('60')],
    ]),
    aujourdhui: '2026-09-23',
    ...partiel,
    // L'etat doit suivre les transactions passees, pas le socle.
    ...(partiel.transactions ? { etat: rejouer([pea], [...partiel.transactions]) } : {}),
  };
}

describe('construireDividendes', () => {
  it('dit qu’il n’y a rien plutôt que d’afficher des zéros muets', () => {
    const vue = construireDividendes(entrees());

    expect(vue.aucunDividende).toBe(true);
    expect(vue.messageHistorique).toBe('Aucun dividende encaissé.');
    expect(vue.rendementSurRevient.valeur).toBeNull();
  });

  it('cumule les dividendes encaissés', () => {
    const vue = construireDividendes(
      entrees({
        transactions: [...SOCLE, dividende('2025-05-15', 30), dividende('2026-05-15', 32)],
      }),
    );

    expect(vue.total).toBe(`62,00${INSEC}€`);
    expect(vue.aucunDividende).toBe(false);
  });

  it('isole les douze derniers mois', () => {
    const vue = construireDividendes(
      entrees({
        transactions: [
          ...SOCLE,
          dividende('2024-05-15', 30),
          dividende('2025-05-15', 31),
          dividende('2026-05-15', 32),
        ],
      }),
    );

    // Fenetre glissante depuis le 23/09/2025 : seul le dividende de mai 2026.
    expect(vue.douzeMois).toBe(`32,00${INSEC}€`);
    expect(vue.total).toBe(`93,00${INSEC}€`);
  });

  describe('rendements', () => {
    const transactions = [
      ...SOCLE,
      dividende('2024-05-15', 40),
      dividende('2026-05-15', 40, { titreId: 'air-liquide' }),
      dividende('2026-06-20', 20, { titreId: 'totalenergies' }),
    ];

    it('rapporte les dividendes au prix de revient', () => {
      // 60 € sur douze mois pour 2 000 € de prix de revient : 3 %.
      const vue = construireDividendes(entrees({ transactions }));

      expect(vue.rendementSurRevient.valeur).toBe(`3,00${INSEC}%`);
    });

    it('rapporte aussi les dividendes à la valeur actuelle', () => {
      // 10 × 120 + 20 × 60 = 2 400 € de valeur. 60 / 2 400 = 2,5 %.
      const vue = construireDividendes(entrees({ transactions }));

      expect(vue.rendementCourant.valeur).toBe(`2,50${INSEC}%`);
    });

    it('refuse de mesurer sur moins de douze mois d’historique', () => {
      // Sinon on compare une fenetre pleine a une fenetre trouee, et on
      // sous-estime systematiquement.
      const vue = construireDividendes(
        entrees({ transactions: [...SOCLE, dividende('2026-05-15', 40)] }),
      );

      expect(vue.rendementSurRevient.valeur).toBeNull();
      expect(vue.rendementSurRevient.motif).toMatch(/moins de douze mois/);
    });

    it('explique l’absence de rendement courant sans cours', () => {
      const vue = construireDividendes(
        entrees({
          transactions: [...SOCLE, dividende('2024-05-15', 40), dividende('2026-05-15', 40)],
          cours: new Map(),
        }),
      );

      expect(vue.rendementCourant.valeur).toBeNull();
      expect(vue.rendementCourant.motif).toMatch(/Rafraîchissez|rafraîchissez/);
    });

    it('ne rapporte qu’aux lignes encore détenues', () => {
      // La ligne vendue a verse des dividendes, mais elle n'a plus de prix de
      // revient auquel les rapporter.
      const transactionsSoldees: Transaction[] = [
        ...SOCLE,
        dividende('2024-05-15', 40),
        dividende('2026-05-15', 40, { titreId: 'air-liquide' }),
        vente('2026-07-01', 10, 120, 0, { titreId: 'air-liquide' }),
      ];
      const vue = construireDividendes(entrees({ transactions: transactionsSoldees }));

      // Reste TotalEnergies : 1 000 € de revient, 40 € sur douze mois.
      expect(vue.rendementSurRevient.valeur).toBe(`4,00${INSEC}%`);
    });
  });

  describe('par année', () => {
    it('trie du plus récent au plus ancien', () => {
      const vue = construireDividendes(
        entrees({
          transactions: [...SOCLE, dividende('2024-05-15', 30), dividende('2026-05-15', 45)],
        }),
      );

      expect(vue.parAnnee.map(ligne => ligne.annee)).toEqual(['2026', '2024']);
    });

    it('mesure l’écart avec l’année précédente disponible', () => {
      const vue = construireDividendes(
        entrees({
          transactions: [...SOCLE, dividende('2024-05-15', 30), dividende('2026-05-15', 45)],
        }),
      );

      expect(vue.parAnnee[0].evolution).toBe(`+15,00${INSEC}€`);
      expect(vue.parAnnee[0].tendance).toBe('hausse');
      // La plus ancienne n'a aucun point de comparaison : on ne l'invente pas.
      expect(vue.parAnnee[1].evolution).toBeUndefined();
    });

    it('donne à la meilleure année une barre pleine', () => {
      const vue = construireDividendes(
        entrees({
          transactions: [...SOCLE, dividende('2024-05-15', 30), dividende('2026-05-15', 60)],
        }),
      );

      expect(vue.parAnnee[0].fraction).toBe(1);
      expect(vue.parAnnee[1].fraction).toBeCloseTo(0.5);
    });
  });

  describe('calendrier mensuel', () => {
    it('couvre douze mois, finissant par le mois courant', () => {
      const vue = construireDividendes(entrees());

      expect(vue.parMois).toHaveLength(12);
      expect(vue.parMois[11].mois).toBe('sept.');
      expect(vue.parMois[0].mois).toBe('oct.');
    });

    it('marque les mois sans dividende plutôt que de les omettre', () => {
      // Un calendrier a trous se lit ; un calendrier ampute se mesestime.
      const vue = construireDividendes(
        entrees({ transactions: [...SOCLE, dividende('2026-05-15', 30)] }),
      );

      const mai = vue.parMois.find(ligne => ligne.mois === 'mai')!;
      expect(mai.vide).toBe(false);
      expect(vue.parMois.filter(ligne => ligne.vide)).toHaveLength(11);
    });

    it('ignore un dividende antérieur à la fenêtre', () => {
      const vue = construireDividendes(
        entrees({ transactions: [...SOCLE, dividende('2023-05-15', 30)] }),
      );

      expect(vue.parMois.every(ligne => ligne.vide)).toBe(true);
    });
  });

  describe('par titre', () => {
    const transactions = [
      ...SOCLE,
      dividende('2024-01-15', 10, { titreId: 'totalenergies' }),
      dividende('2026-05-15', 60, { titreId: 'air-liquide' }),
      dividende('2026-06-20', 20, { titreId: 'totalenergies' }),
    ];

    it('classe par montant décroissant', () => {
      const vue = construireDividendes(entrees({ transactions }));

      expect(vue.parTitre.map(ligne => ligne.nom)).toEqual(['Air Liquide', 'TotalEnergies']);
    });

    it('donne la part de chacun dans le total', () => {
      const vue = construireDividendes(entrees({ transactions }));

      // 60 sur 90 encaisses.
      expect(vue.parTitre[0].part).toBe(`66,7${INSEC}%`);
    });

    it('calcule un rendement par ligne', () => {
      const vue = construireDividendes(entrees({ transactions }));

      // Air Liquide : 60 € sur douze mois pour 1 000 € de revient.
      expect(vue.parTitre[0].rendementSurRevient).toBe(`6,00${INSEC}%`);
      // 10 × 120 = 1 200 € de valeur actuelle.
      expect(vue.parTitre[0].rendementCourant).toBe(`5,00${INSEC}%`);
    });

    it('explique une ligne soldée au lieu d’afficher un rendement absurde', () => {
      const soldees: Transaction[] = [
        ...transactions,
        vente('2026-07-01', 10, 120, 0, { titreId: 'air-liquide' }),
      ];
      const vue = construireDividendes(entrees({ transactions: soldees }));
      const ligne = vue.parTitre.find(l => l.titreId === 'air-liquide')!;

      expect(ligne.rendementSurRevient).toBeUndefined();
      expect(ligne.motifRendement).toMatch(/soldée/);
    });
  });

  describe('retenue à la source', () => {
    it('cumule l’écart entre brut et net', () => {
      const vue = construireDividendes(
        entrees({
          transactions: [...SOCLE, dividende('2026-05-15', 70, { montantBrut: 100 })],
        }),
      );

      expect(vue.retenueTotale).toBe(`30,00${INSEC}€`);
      expect(vue.derniers[0].retenue).toBe(`30,00${INSEC}€`);
    });

    it('se tait quand le brut n’est pas connu', () => {
      // Un zero affiche laisserait croire a une absence de retenue.
      const vue = construireDividendes(
        entrees({ transactions: [...SOCLE, dividende('2026-05-15', 70)] }),
      );

      expect(vue.retenueTotale).toBeUndefined();
      expect(vue.derniers[0].retenue).toBeUndefined();
    });
  });

  describe('historique', () => {
    it('liste les derniers encaissements, du plus récent au plus ancien', () => {
      const vue = construireDividendes(
        entrees({
          transactions: [...SOCLE, dividende('2024-05-15', 30), dividende('2026-05-15', 45)],
        }),
      );

      expect(vue.derniers[0].date).toBe('15/05/2026');
      expect(vue.derniers[0].titre).toBe('Air Liquide');
      expect(vue.derniers[0].compte).toBe('PEA Boursobank');
    });

    it('s’arrête à vingt lignes', () => {
      const nombreux = Array.from({ length: 30 }, (_, index) =>
        dividende(`2026-0${1 + (index % 9)}-1${index % 10}`, 5),
      );
      const vue = construireDividendes(entrees({ transactions: [...SOCLE, ...nombreux] }));

      expect(vue.derniers).toHaveLength(20);
    });
  });

  it('donne la moyenne mensuelle sur douze mois, pas sur l’historique entier', () => {
    const vue = construireDividendes(
      entrees({
        transactions: [...SOCLE, dividende('2023-05-15', 600), dividende('2026-05-15', 120)],
      }),
    );

    expect(vue.moyenneMensuelle).toBe(`10,00${INSEC}€`);
  });
});

describe('calendrierDividendes', () => {
  it('projette le dividende de l’an dernier sur la quantité détenue aujourd’hui', () => {
    // 10 actions en mai 2026 : 30 € reçus. On en a acheté 10 de plus depuis.
    const transactions: Transaction[] = [
      versement('2026-01-02', 5000),
      achat('2026-01-02', 10, 150, 0),
      dividende('2026-05-20', 30),
      achat('2026-07-01', 10, 160, 0),
    ];
    const etat = rejouer([compte()], transactions);
    const vue = calendrierDividendes({
      etat,
      transactions,
      titres: [titre()],
      aujourdhui: '2026-09-25',
    });
    expect(vue.mois.map(mois => mois.cle)[0]).toBe('2026-09');
    expect(vue.mois).toHaveLength(12);
    const mai = vue.mois.find(mois => mois.cle === '2027-05')!;
    expect(mai.valeur).toBeCloseTo(60);
    expect(mai.libelle).toBe('mai 2027');
    expect(mai.lignes[0]).toMatchObject({ nom: 'Air Liquide', date: 'vers le 20 mai' });
    expect(vue.valeurTotale).toBeCloseTo(60);
    expect(vue.vide).toBe(false);
  });

  it('sans dividende saisi, estime d’après l’historique par action, converti en euros', () => {
    // Portefeuille importé : 20 actions, aucun dividende enregistré.
    const transactions: Transaction[] = [versement('2026-01-02', 5000), achat('2026-01-02', 20, 150, 0)];
    const etat = rejouer([compte()], transactions);
    const vue = calendrierDividendes({
      etat,
      transactions,
      titres: [titre()],
      aujourdhui: '2026-09-25',
      parAction: new Map([
        ['air-liquide', { devise: 'USD', versements: [{ date: '2026-05-18', montant: 1.5 }, { date: '2024-05-18', montant: 1.2 }] }],
      ]),
      versEuros: (montant, devise) => (devise === 'USD' ? montant * 0.9 : undefined),
      valeurPortefeuille: 3000,
    });
    const mai = vue.mois.find(mois => mois.cle === '2027-05')!;
    // 20 actions × 1,50 $ × 0,9 = 27 €.
    expect(mai.valeur).toBeCloseTo(27);
    expect(mai.lignes[0].source).toBe('historique');
    expect(vue.depuisHistorique).toBe(true);
    expect(vue.valeurTotale).toBeCloseTo(27);
    expect(vue.parMoisMoyen).toMatch(/^2,25/);
    expect(vue.rendement).toMatch(/^0,90/);
  });

  it('ignore les valeurs vendues depuis', () => {
    const transactions: Transaction[] = [
      versement('2026-01-02', 5000),
      achat('2026-01-02', 10, 150, 0),
      dividende('2026-05-20', 30),
      vente('2026-06-01', 10, 160, 0),
    ];
    const vue = calendrierDividendes({
      etat: rejouer([compte()], transactions),
      transactions,
      titres: [titre()],
      aujourdhui: '2026-09-25',
    });
    expect(vue.vide).toBe(true);
  });
});
