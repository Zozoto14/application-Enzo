import { rejouer } from '../portfolio/engine';
import { compte } from '../testing/fixtures';
import { importerCsv, type ContexteImport } from './import';
import {
  MODELE_BOURSOBANK,
  MODELE_BOURSOBANK_MOUVEMENTS,
  MODELE_GENERIQUE,
  modeleParId,
} from './modeles';

const contexte: ContexteImport = {
  compteId: 'pea',
  deviseParDefaut: 'EUR',
  resoudreTitre: ({ isin }) =>
    isin === 'FR0000120073' ? 'air-liquide' : undefined,
};

const RELEVE_GENERIQUE = [
  'date,operation,libelle,isin,ticker,quantite,prix_unitaire,montant,frais,devise',
  '2024-01-05,versement,Apport initial,,,,,10000,,EUR',
  '2024-01-10,achat,Air Liquide,FR0000120073,AI,10,100,1000,5,EUR',
  '2024-02-10,achat,Air Liquide,FR0000120073,AI,10,120,1200,5,EUR',
  '2024-06-10,vente,Air Liquide,FR0000120073,AI,5,130,650,5,EUR',
  '2024-07-01,dividende,Air Liquide,FR0000120073,AI,,,30,,EUR',
].join('\n');

describe('importerCsv', () => {
  it('convertit un relevé complet sans anomalie', () => {
    const resultat = importerCsv(RELEVE_GENERIQUE, MODELE_GENERIQUE, contexte);

    expect(resultat.anomalies).toEqual([]);
    expect(resultat.colonnesManquantes).toEqual([]);
    expect(resultat.transactions).toHaveLength(5);
    expect(resultat.lignesLues).toBe(5);
  });

  it('produit des transactions que le moteur sait rejouer', () => {
    // Le vrai test de l'import : les chiffres qui en sortent doivent tomber
    // juste une fois passés dans le moteur de portefeuille.
    const { transactions } = importerCsv(RELEVE_GENERIQUE, MODELE_GENERIQUE, contexte);
    const etat = rejouer([compte()], transactions);

    expect(etat.positions).toHaveLength(1);
    expect(etat.positions[0].quantite.toString()).toBe('15');
    expect(etat.positions[0].pru.toString()).toBe('110.5');
    expect(etat.cessions[0].plusValue.toString()).toBe('92.5');
    expect(etat.comptes.get('pea')!.cash.toString()).toBe('8465');
  });

  it('reprend le libellé du relevé comme note', () => {
    const { transactions } = importerCsv(RELEVE_GENERIQUE, MODELE_GENERIQUE, contexte);
    expect(transactions[1].note).toBe('Air Liquide');
  });

  describe('lignes problématiques', () => {
    const relevePartiel = [
      'date,operation,libelle,isin,quantite,prix_unitaire,montant,frais',
      '2024-01-10,achat,Air Liquide,FR0000120073,10,100,1000,5',
      '2024-01-11,rachat mysterieux,?,FR0000120073,1,10,10,0',
      '2024-01-12,achat,Inconnu au bataillon,XX0000000000,1,10,10,0',
      '32/01/2024,achat,Air Liquide,FR0000120073,1,10,10,0',
      '2024-01-14,achat,Air Liquide,FR0000120073,,,,0',
    ].join('\n');

    it('écarte les lignes fautives sans faire échouer l’import', () => {
      const resultat = importerCsv(relevePartiel, MODELE_GENERIQUE, contexte);

      expect(resultat.transactions).toHaveLength(1);
      expect(resultat.anomalies).toHaveLength(4);
    });

    it('situe chaque anomalie et explique la cause', () => {
      const resultat = importerCsv(relevePartiel, MODELE_GENERIQUE, contexte);
      const [operation, titre, date, quantite] = resultat.anomalies;

      expect(operation.ligne).toBe(3);
      expect(operation.message).toMatch(/Opération non reconnue/);

      expect(titre.ligne).toBe(4);
      expect(titre.message).toMatch(/Titre inconnu : XX0000000000/);

      expect(date.ligne).toBe(5);
      expect(date.message).toMatch(/Date/);

      expect(quantite.ligne).toBe(6);
      expect(quantite.message).toMatch(/Quantité/);
    });

    it('conserve la ligne brute pour permettre la correction', () => {
      const resultat = importerCsv(relevePartiel, MODELE_GENERIQUE, contexte);
      expect(resultat.anomalies[0].brut).toContain('rachat mysterieux');
    });
  });

  it('signale un fichier dont les colonnes ne correspondent pas au modèle', () => {
    const mauvaisFichier = 'jour,libelle,somme\n2024-01-10,Air Liquide,1000';
    const resultat = importerCsv(mauvaisFichier, MODELE_GENERIQUE, contexte);

    expect(resultat.colonnesManquantes).toEqual(['date', 'operation']);
    expect(resultat.transactions).toEqual([]);
  });

  it('déduit le prix unitaire du montant quand la colonne est vide', () => {
    const sansCours = [
      'date,operation,libelle,isin,quantite,prix_unitaire,montant,frais',
      '2024-01-10,achat,Air Liquide,FR0000120073,10,,1000,5',
    ].join('\n');

    const { transactions } = importerCsv(sansCours, MODELE_GENERIQUE, contexte);
    const achat = transactions[0];

    expect(achat.type).toBe('ACHAT');
    expect(achat.type === 'ACHAT' && achat.prixUnitaire.toString()).toBe('100');
  });

  it('ignore le signe des montants, porté par le type d’opération', () => {
    const avecSignes = [
      'date,operation,libelle,isin,quantite,prix_unitaire,montant,frais',
      '2024-01-10,achat,Air Liquide,FR0000120073,10,100,-1000,5',
    ].join('\n');

    const { transactions } = importerCsv(avecSignes, MODELE_GENERIQUE, contexte);
    const achat = transactions[0];
    expect(achat.type === 'ACHAT' && achat.quantite.toString()).toBe('10');
  });
});

describe('modèle BoursoBank', () => {
  it('est marqué provisoire tant qu’un export réel ne l’a pas validé', () => {
    expect(MODELE_BOURSOBANK.provisoire).toBe(true);
  });

  it('lit un relevé conforme à ses colonnes déclarées', () => {
    // Attention : ce fichier reproduit le format *supposé*. Il vérifie la
    // mécanique de l'import, pas l'exactitude du modèle face au vrai export.
    const releve = [
      'Date;Operation;Libelle;Code ISIN;Quantite;Cours;Montant;Frais;Devise',
      '10/01/2024;Achat comptant;AIR LIQUIDE;FR0000120073;10;100,00;1 000,00;5,00;EUR',
      '01/07/2024;Dividende;AIR LIQUIDE;FR0000120073;;;30,50;;EUR',
    ].join('\n');

    const resultat = importerCsv(releve, MODELE_BOURSOBANK, contexte);

    expect(resultat.anomalies).toEqual([]);
    expect(resultat.transactions).toHaveLength(2);

    const [achat, dividende] = resultat.transactions;
    expect(achat.date).toBe('2024-01-10');
    expect(achat.type === 'ACHAT' && achat.prixUnitaire.toString()).toBe('100');
    expect(achat.type === 'ACHAT' && achat.frais.toString()).toBe('5');
    expect(dividende.type === 'DIVIDENDE' && dividende.montantNet.toString()).toBe('30.5');
  });
});

describe('avis d’opéré réel (achat STELLANTIS du 03/08/2026)', () => {
  // Chiffres relevés sur un avis d'opéré BoursoBank authentique. Ce test vaut
  // plus que tous les précédents réunis : il confronte le calcul du prix de
  // revient au montant que la banque a réellement débité.
  const contexteStellantis: ContexteImport = {
    compteId: 'pea',
    deviseParDefaut: 'EUR',
    resoudreTitre: ({ isin }) => (isin === 'NL00150001Q9' ? 'stellantis' : undefined),
  };

  const ENTETE =
    'Date;Operation;Libelle;Code ISIN;Quantite;Cours;Montant;Commission;Frais;Devise';

  it('retrouve exactement le montant net débité par la banque', () => {
    const releve = [
      ENTETE,
      '03/08/2026;ACHAT COMPTANT;STELLANTIS;NL00150001Q9;20;5,094;101,88;0,51;;EUR',
    ].join('\n');

    const { transactions, anomalies } = importerCsv(
      releve,
      MODELE_BOURSOBANK,
      contexteStellantis,
    );
    expect(anomalies).toEqual([]);

    const etat = rejouer([compte()], transactions);
    const [position] = etat.positions;

    // Montant brut 101,88 + commission 0,51 = 102,39, le débit réel.
    expect(position.coutTotal.toString()).toBe('102.39');
    expect(position.quantite.toString()).toBe('20');
    expect(position.pru.toString()).toBe('5.1195');
  });

  it('additionne commission et taxe sur les transactions financières', () => {
    // La TTF ne s'appliquait pas ici, mais elle s'applique aux actions
    // françaises de grande capitalisation : n'en retenir qu'une des deux
    // lignes sous-estimerait le prix de revient.
    const releve = [
      ENTETE,
      '03/08/2026;ACHAT COMPTANT;STELLANTIS;NL00150001Q9;20;5,094;101,88;0,51;0,31;EUR',
    ].join('\n');

    const { transactions } = importerCsv(releve, MODELE_BOURSOBANK, contexteStellantis);
    const achat = transactions[0];

    expect(achat.type === 'ACHAT' && achat.frais.toString()).toBe('0.82');

    const etat = rejouer([compte()], transactions);
    expect(etat.positions[0].coutTotal.toString()).toBe('102.7');
  });

  it('lit un cours à trois décimales sans arrondir', () => {
    const releve = [
      ENTETE,
      '03/08/2026;ACHAT COMPTANT;STELLANTIS;NL00150001Q9;20;5,094;101,88;0,51;;EUR',
    ].join('\n');

    const { transactions } = importerCsv(releve, MODELE_BOURSOBANK, contexteStellantis);
    const achat = transactions[0];

    expect(achat.type === 'ACHAT' && achat.prixUnitaire.toString()).toBe('5.094');
    expect(achat.date).toBe('2026-08-03');
  });
});

describe('relevé de mouvements espèces (Débit / Crédit, sans colonne d’opération)', () => {
  const ENTETE = 'Date opération;Libellé;Valeur;Débit;Crédit';

  const contexteMouvements: ContexteImport = {
    compteId: 'pea',
    deviseParDefaut: 'EUR',
    resoudreTitre: ({ libelle }) =>
      libelle?.toUpperCase().includes('STELLANTIS') ? 'stellantis' : undefined,
  };

  const importer = (...lignes: string[]) =>
    importerCsv(
      [ENTETE, ...lignes].join('\n'),
      MODELE_BOURSOBANK_MOUVEMENTS,
      contexteMouvements,
    );

  it('déduit le type du libellé, faute de colonne dédiée', () => {
    const { transactions, anomalies } = importer(
      '05/01/2026;VIREMENT RECU;05/01/2026;;10000,00',
      '01/07/2026;DIVIDENDE STELLANTIS;01/07/2026;;30,50',
      '01/08/2026;DROITS DE GARDE;01/08/2026;12,00;',
    );

    expect(anomalies).toEqual([]);
    expect(transactions.map(t => t.type)).toEqual([
      'VERSEMENT',
      'DIVIDENDE',
      'FRAIS',
    ]);
  });

  it('tranche le sens d’un libellé ambigu par la colonne renseignée', () => {
    // « Virement » ne dit pas s'il entre ou sort : seule la colonne le dit.
    const { transactions } = importer(
      '05/01/2026;VIREMENT;05/01/2026;;10000,00',
      '06/01/2026;VIREMENT;06/01/2026;500,00;',
    );

    expect(transactions[0].type).toBe('VERSEMENT');
    expect(transactions[1].type).toBe('RETRAIT');
    expect(transactions[0].type === 'VERSEMENT' && transactions[0].montant.toString()).toBe(
      '10000',
    );
    expect(transactions[1].type === 'RETRAIT' && transactions[1].montant.toString()).toBe(
      '500',
    );
  });

  it('signale les achats sans prétendre les reconstituer', () => {
    // Le relevé ne porte aucune quantité : fabriquer une position à partir du
    // seul montant débité produirait un PRU faux et silencieux.
    const { transactions, anomalies } = importer(
      '03/08/2026;ACHAT COMPTANT STELLANTIS;03/08/2026;102,39;',
    );

    expect(transactions).toEqual([]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].message).toMatch(/avis d’opéré/);
  });

  it('n’associe pas la colonne « Valeur » à un titre', () => {
    // « Valeur » est la date de valeur. La mapper au titre rattacherait chaque
    // ligne à une valeur boursière inexistante.
    expect(MODELE_BOURSOBANK_MOUVEMENTS.colonnes.isin).toBeUndefined();
    expect(MODELE_BOURSOBANK_MOUVEMENTS.colonnes.ticker).toBeUndefined();
  });

  it('rapporte un libellé inconnu au lieu de l’ignorer', () => {
    const { anomalies } = importer('05/01/2026;OPERATION EXOTIQUE;05/01/2026;42,00;');

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].message).toMatch(/Libellé non reconnu/);
  });

  it('alimente correctement le cash du compte', () => {
    const { transactions } = importer(
      '05/01/2026;VIREMENT RECU;05/01/2026;;10000,00',
      '01/07/2026;DIVIDENDE STELLANTIS;01/07/2026;;30,50',
      '01/08/2026;DROITS DE GARDE;01/08/2026;12,00;',
      '02/08/2026;VIREMENT;02/08/2026;500,00;',
    );

    const etat = rejouer([compte()], transactions);
    // 10000 + 30,50 - 12 - 500
    expect(etat.comptes.get('pea')!.cash.toString()).toBe('9518.5');
  });
});

describe('modeleParId', () => {
  it('retrouve un modèle par son identifiant', () => {
    expect(modeleParId('boursobank')).toBe(MODELE_BOURSOBANK);
    expect(modeleParId('inexistant')).toBeUndefined();
  });
});
