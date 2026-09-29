import { apercuPositions } from './import';

const INSEC = ' ';
const FINE = ' ';

const EXPORT_REEL = [
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation',
  '"AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC";LU1681043599;17,00;703,89;703,73;0,59;"11 963,41";-2,66;-0,02',
  'STELLANTIS;NL00150001Q9;20,00;5,12;4,22;-0,15;84,47;-17,92;-17,50',
].join('\n');

describe('apercuPositions', () => {
  it('ne dit rien tant que rien n’est collé', () => {
    const apercu = apercuPositions('   ');

    expect(apercu.pret).toBe(false);
    expect(apercu.lignes).toEqual([]);
    expect(apercu.avertissements).toEqual([]);
  });

  it('détaille les positions d’un export réel', () => {
    const apercu = apercuPositions(EXPORT_REEL);

    expect(apercu.pret).toBe(true);
    expect(apercu.lignes).toHaveLength(2);
    expect(apercu.anomalies).toEqual([]);

    const stellantis = apercu.lignes.find(l => l.isin === 'NL00150001Q9')!;
    expect(stellantis.nom).toBe('STELLANTIS');
    expect(stellantis.quantite).toBe('20');
    expect(stellantis.coutTotal).toBe(`102,39${INSEC}€`);
    expect(stellantis.approche).toBe(false);
  });

  it('totalise le prix de revient', () => {
    // 11 966,07 + 102,39
    expect(apercuPositions(EXPORT_REEL).total).toBe(`12${FINE}068,46${INSEC}€`);
  });

  it('prévient que le versement d’équilibre sera ajouté', () => {
    // L'utilisateur doit savoir qu'une transaction qu'il n'a pas saisie va
    // apparaître dans son journal, et pourquoi.
    const apercu = apercuPositions(EXPORT_REEL);
    expect(apercu.avertissements.some(a => /versement d’équilibre/.test(a))).toBe(true);
  });

  it('signale un fichier qui ne correspond pas au modèle', () => {
    const apercu = apercuPositions('valeur;code;nombre\nX;Y;1');

    expect(apercu.pret).toBe(false);
    expect(apercu.colonnesManquantes).toContain('isin');
    expect(apercu.avertissements[0]).toMatch(/ne correspond pas au modèle/);
  });

  it('compte les lignes illisibles sans bloquer les autres', () => {
    const avecErreur = [
      'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation',
      'STELLANTIS;NL00150001Q9;20,00;5,12;4,22;-0,15;84,47;-17,92;-17,50',
      'SANS ISIN;;10,00;5,00;5,00;0;50,00;0;0',
    ].join('\n');

    const apercu = apercuPositions(avecErreur);

    expect(apercu.lignes).toHaveLength(1);
    expect(apercu.anomalies).toHaveLength(1);
    expect(apercu.anomalies[0].message).toMatch(/ISIN/);
    expect(apercu.avertissements.some(a => /1 ligne\(s\)/.test(a))).toBe(true);
  });

  it('avertit quand un prix de revient est approché', () => {
    const sansMontants = [
      'name;isin;quantity;buyingPrice',
      'STELLANTIS;NL00150001Q9;20,00;5,12',
    ].join('\n');

    const apercu = apercuPositions(sansMontants);

    expect(apercu.lignes[0].approche).toBe(true);
    expect(apercu.avertissements.some(a => /arrondi au centime/.test(a))).toBe(true);
  });

  it('transmet les positions brutes pour la reprise', () => {
    const apercu = apercuPositions(EXPORT_REEL);

    expect(apercu.positions).toHaveLength(2);
    expect(apercu.positions[0].coutTotal.toString()).toBe('11966.07');
  });
});
