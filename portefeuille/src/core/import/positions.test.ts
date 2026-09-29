import { rejouer } from '../portfolio/engine';
import { valoriser } from '../portfolio/valorisation';
import { compte } from '../testing/fixtures';
import { MODELE_BOURSOBANK_POSITIONS } from './modeles';
import {
  importerPositions,
  transactionsDeReprise,
  type ModelePositions,
} from './positions';

/** Contenu exact d'un export « positions instantanées » BoursoBank réel. */
const EXPORT_REEL = [
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation',
  '"AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC";LU1681043599;17,00;703,89;703,73;0,59;"11 963,41";-2,66;-0,02',
  'STELLANTIS;NL00150001Q9;20,00;5,12;4,22;-0,15;84,47;-17,92;-17,50',
].join('\n');

describe('importerPositions', () => {
  it('lit un export réel sans anomalie', () => {
    const resultat = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);

    expect(resultat.anomalies).toEqual([]);
    expect(resultat.colonnesManquantes).toEqual([]);
    expect(resultat.positions).toHaveLength(2);
  });

  it('gère les en-têtes anglais et les nombres au format français', () => {
    // Le fichier mélange les deux conventions : « quantity » mais « 17,00 »,
    // et « 11 963,41 » avec une espace pour les milliers.
    const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
    const [amundi] = positions;

    expect(amundi.nom).toBe('AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC');
    expect(amundi.isin).toBe('LU1681043599');
    expect(amundi.quantite.toString()).toBe('17');
    expect(amundi.valeurMarche!.toString()).toBe('11963.41');
  });

  describe('coût de revient exact', () => {
    it('retrouve sur STELLANTIS le montant exact de l’avis d’opéré', () => {
      // valeur de marché 84,47 moins la moins-value latente 17,92 = 102,39,
      // soit très exactement le montant débité le 03/08/2026.
      const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
      const stellantis = positions.find(p => p.isin === 'NL00150001Q9')!;

      expect(stellantis.coutTotal.toString()).toBe('102.39');
      expect(stellantis.pru.toString()).toBe('5.1195');
      expect(stellantis.coutApproche).toBe(false);
    });

    it('récupère plus de décimales que le PRU affiché n’en porte', () => {
      const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
      const amundi = positions.find(p => p.isin === 'LU1681043599')!;

      expect(amundi.coutTotal.toString()).toBe('11966.07');
      expect(amundi.pru.toString()).toBe('703.88647059');
    });

    it('se rabat sur le PRU arrondi quand le fichier ne permet pas mieux', () => {
      // Sans « amount » ni « amountVariation », il ne reste que quantité x PRU
      // affiché — et l'arrondi au centime se paie.
      const modeleReduit: ModelePositions = {
        ...MODELE_BOURSOBANK_POSITIONS,
        colonnes: {
          nom: 'name',
          isin: 'isin',
          quantite: 'quantity',
          pru: 'buyingPrice',
        },
      };

      const { positions } = importerPositions(EXPORT_REEL, modeleReduit);
      const amundi = positions.find(p => p.isin === 'LU1681043599')!;

      expect(amundi.coutApproche).toBe(true);
      // 17 x 703,89 = 11 966,13, soit 6 centimes de trop.
      expect(amundi.coutTotal.toString()).toBe('11966.13');
      expect(amundi.coutTotal.sub('11966.07').toString()).toBe('0.06');
    });
  });

  describe('lignes invalides', () => {
    const entete = 'name;isin;quantity;buyingPrice';

    it('signale une ligne sans ISIN', () => {
      const { positions, anomalies } = importerPositions(
        [entete, 'SANS ISIN;;10,00;5,00'].join('\n'),
        MODELE_BOURSOBANK_POSITIONS,
      );
      expect(positions).toEqual([]);
      expect(anomalies[0].message).toMatch(/ISIN/);
    });

    it('signale une quantité nulle', () => {
      const { anomalies } = importerPositions(
        [entete, 'VIDE;FR0000000000;0,00;5,00'].join('\n'),
        MODELE_BOURSOBANK_POSITIONS,
      );
      expect(anomalies[0].message).toMatch(/Quantité/);
    });

    it('signale un fichier dont les colonnes ne correspondent pas', () => {
      const resultat = importerPositions(
        'valeur;code;nombre\nX;Y;1',
        MODELE_BOURSOBANK_POSITIONS,
      );
      expect(resultat.colonnesManquantes).toEqual([
        'name',
        'isin',
        'quantity',
        'buyingPrice',
      ]);
    });
  });
});

describe('transactionsDeReprise', () => {
  const reprendre = () => {
    const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
    return {
      positions,
      transactions: transactionsDeReprise(positions, {
        compteId: 'pea',
        date: '2026-09-22',
        resoudreTitre: position => position.isin,
      }),
    };
  };

  it('produit un achat par position, precede d’un versement d’equilibre', () => {
    const { transactions } = reprendre();

    expect(transactions).toHaveLength(3);
    expect(transactions.map(t => t.type)).toEqual(['VERSEMENT', 'ACHAT', 'ACHAT']);
    expect(transactions.every(t => t.date === '2026-09-22')).toBe(true);
  });

  it('ne facture aucun frais, déjà compris dans le prix de revient', () => {
    // Les rajouter compterait deux fois la commission de courtage.
    const { transactions } = reprendre();
    const achat = transactions.find(t => t.type === 'ACHAT')!;
    expect(achat.type === 'ACHAT' && achat.frais.estZero()).toBe(true);
  });

  describe('versement d’equilibre', () => {
    it('evite un solde especes negatif qui n’a jamais existe', () => {
      // Sans lui, les achats de reprise debiteraient un compte vide et
      // afficheraient -12 068,46 EUR de liquidites.
      const { transactions } = reprendre();
      const etat = rejouer([compte()], transactions);

      expect(etat.comptes.get('pea')!.cash.enCentimes().toString()).toBe('0');
    });

    it('couvre exactement le prix de revient total', () => {
      const { transactions } = reprendre();
      const versement = transactions[0];

      // 11 966,07 + 102,39
      expect(versement.type === 'VERSEMENT' && versement.montant.toString()).toBe(
        '12068.46',
      );
    });

    it('signale que le montant est approche pour le suivi du plafond', () => {
      // Le prix de revient actuel n'est pas la somme reellement versee au fil
      // des ans : les gains reinvestis en sont absents.
      const { transactions } = reprendre();
      expect(transactions[0].note).toMatch(/approch/);
    });

    it('peut etre desactive', () => {
      const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
      const transactions = transactionsDeReprise(positions, {
        compteId: 'pea',
        date: '2026-09-22',
        resoudreTitre: position => position.isin,
        equilibrerParVersement: false,
      });

      expect(transactions.every(t => t.type === 'ACHAT')).toBe(true);
    });

    it('ne produit rien pour un export vide', () => {
      expect(
        transactionsDeReprise([], {
          compteId: 'pea',
          date: '2026-09-22',
          resoudreTitre: () => 'x',
        }),
      ).toEqual([]);
    });
  });

  it('reproduit exactement les positions une fois rejouées', () => {
    // Le vrai critère : après un aller-retour par le journal, le portefeuille
    // doit être identique à celui du courtier, au centime près.
    const { transactions } = reprendre();
    const etat = rejouer([compte()], transactions);

    const stellantis = etat.positions.find(p => p.titreId === 'NL00150001Q9')!;
    expect(stellantis.quantite.toString()).toBe('20');
    expect(stellantis.coutTotal.toString()).toBe('102.39');
    expect(stellantis.pru.toString()).toBe('5.1195');

    const amundi = etat.positions.find(p => p.titreId === 'LU1681043599')!;
    expect(amundi.quantite.toString()).toBe('17');
    // 11 966,07 / 17 ne tombe pas juste : le rejeu reproduit le cout au
    // centime, avec un residu de l'ordre du cent-millionieme d'euro.
    expect(amundi.coutTotal.enCentimes().toString()).toBe('11966.07');
  });

  it('retrouve la plus-value latente annoncée par le courtier', () => {
    const { positions, transactions } = reprendre();
    const etat = rejouer([compte()], transactions);

    for (const position of positions) {
      const rejouee = etat.positions.find(p => p.titreId === position.isin)!;
      // On valorise avec la valeur de marché du relevé, pas avec le dernier
      // cours : voir le test suivant.
      const cours = position.valeurMarche!.div(position.quantite);
      const valorisee = valoriser(rejouee, cours);

      const attendue = position.valeurMarche!.sub(position.coutTotal);
      expect(valorisee.plusValueLatente.enCentimes().toString()).toBe(
        attendue.enCentimes().toString(),
      );
    }
  });

  it('montre pourquoi « lastPrice » ne doit pas servir à valoriser', () => {
    // lastPrice est arrondi au centime : 20 x 4,22 = 84,40, alors que le
    // courtier annonce 84,47. L'écart vient du cours réel, 4,2235.
    const { positions, transactions } = reprendre();
    const etat = rejouer([compte()], transactions);

    const stellantis = positions.find(p => p.isin === 'NL00150001Q9')!;
    const rejouee = etat.positions.find(p => p.titreId === 'NL00150001Q9')!;

    const selonDernierCours = valoriser(rejouee, stellantis.dernierCours!);
    expect(selonDernierCours.valeurMarche.toString()).toBe('84.4');
    expect(stellantis.valeurMarche!.toString()).toBe('84.47');
  });

  it('marque les reprises dont le prix de revient est approché', () => {
    const modeleReduit: ModelePositions = {
      ...MODELE_BOURSOBANK_POSITIONS,
      colonnes: { nom: 'name', isin: 'isin', quantite: 'quantity', pru: 'buyingPrice' },
    };
    const { positions } = importerPositions(EXPORT_REEL, modeleReduit);
    const transactions = transactionsDeReprise(positions, {
      compteId: 'pea',
      date: '2026-09-22',
      resoudreTitre: position => position.isin,
    });

    expect(transactions[0].note).toMatch(/approché/);
  });
});
