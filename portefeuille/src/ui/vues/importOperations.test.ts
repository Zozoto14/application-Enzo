import { rejouer } from '../../core/portfolio/engine';
import { importerPositions, transactionsDeReprise } from '../../core/import/positions';
import { MODELE_BOURSOBANK_POSITIONS } from '../../core/import/modeles';
import { compte, titre } from '../../core/testing/fixtures';
import { apercuOperations, estReprise } from './importOperations';

const GENERIQUE = [
  'date,operation,libelle,isin,ticker,quantite,prix_unitaire,montant,frais,devise',
  '2024-10-01,versement,Virement,,,,,20000,,EUR',
  '2024-10-02,achat,Air Liquide,FR0000120073,AI,42,157.22,,0,EUR',
  '2024-10-02,achat,Amundi MSCI World,LU1681043599,CW8,17,620.29,,0,EUR',
  '2025-05-15,dividende,Air Liquide,FR0000120073,AI,,,198.40,,EUR',
].join('\n');

function contexte(existantes = [] as ReturnType<typeof transactionsDeReprise>) {
  let compteur = 0;
  return {
    compteId: 'pea',
    devise: 'EUR',
    titres: [titre({ id: 'air-liquide', isin: 'FR0000120073', nom: 'Air Liquide', ticker: 'AI.PA' })],
    existantes,
    genererId: (prefixe: string) => `${prefixe}-${++compteur}`,
  };
}

describe('aperçu d’un import d’opérations', () => {
  it('reconnaît le modèle et compte les opérations par type', () => {
    const apercu = apercuOperations(GENERIQUE, contexte());
    expect(apercu.modele?.id).toBe('generique');
    expect(apercu.parType).toEqual({ VERSEMENT: 1, ACHAT: 2, DIVIDENDE: 1 });
    expect(apercu.periode).toEqual({ debut: '2024-10-01', fin: '2025-05-15' });
    expect(apercu.anomalies).toEqual([]);
  });

  it('rattache les valeurs connues et crée les inconnues par leur ISIN', () => {
    const apercu = apercuOperations(GENERIQUE, contexte());
    expect(apercu.nouveauxTitres).toEqual([
      { id: expect.stringContaining('titre-LU1681043599'), isin: 'LU1681043599', nom: 'Amundi MSCI World', ticker: '' },
    ]);
    const achatAir = apercu.transactions.find(t => t.type === 'ACHAT' && 'titreId' in t && t.titreId === 'air-liquide');
    expect(achatAir).toBeDefined();
  });

  it('écarte les opérations déjà présentes', () => {
    const premier = apercuOperations(GENERIQUE, contexte());
    const second = apercuOperations(GENERIQUE, { ...contexte(premier.transactions), titres: contexte().titres });
    // Les achats de la valeur connue et les flux d'espèces sont reconnus comme doublons.
    expect(second.doublons).toBeGreaterThanOrEqual(3);
  });

  it('propose de remplacer la reprise de positions quand l’historique porte des achats', () => {
    const { positions } = importerPositions(
      'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation\nAIR LIQUIDE;FR0000120073;42,00;157,22;177,00;0,5;7434,00;830,80;12,58',
      MODELE_BOURSOBANK_POSITIONS,
    );
    const reprise = transactionsDeReprise(positions, {
      compteId: 'pea',
      date: '2026-09-22',
      resoudreTitre: () => 'air-liquide',
    });
    expect(reprise.every(estReprise)).toBe(true);
    rejouer([compte()], reprise);
    const apercu = apercuOperations(GENERIQUE, contexte(reprise));
    expect(apercu.reprise).toHaveLength(reprise.length);
  });

  it('dit quelles colonnes manquent quand aucun modèle ne convient', () => {
    const apercu = apercuOperations('foo;bar\n1;2', contexte());
    expect(apercu.modele).toBeUndefined();
    expect(apercu.colonnesManquantes.length).toBeGreaterThan(0);
  });
});
