import { d } from '../../core/money/decimal';
import { rejouer } from '../../core/portfolio/engine';
import { importerPositions, transactionsDeReprise } from '../../core/import/positions';
import { MODELE_BOURSOBANK_POSITIONS } from '../../core/import/modeles';
import { compte, titre } from '../../core/testing/fixtures';
import { construireDashboard, type EntreesDashboard } from './dashboard';

const INSEC = ' ';
const FINE = ' ';

/** Le portefeuille réel, repris de l'export BoursoBank. */
const EXPORT_REEL = [
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation',
  '"AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC";LU1681043599;17,00;703,89;703,73;0,59;"11 963,41";-2,66;-0,02',
  'STELLANTIS;NL00150001Q9;20,00;5,12;4,22;-0,15;84,47;-17,92;-17,50',
].join('\n');

function portefeuilleReel(): EntreesDashboard {
  const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
  const transactions = transactionsDeReprise(positions, {
    compteId: 'pea',
    date: '2026-09-22',
    resoudreTitre: position => position.isin,
  });

  return {
    etat: rejouer([compte()], transactions),
    comptes: [compte()],
    titres: positions.map(position =>
      titre({ id: position.isin, isin: position.isin, nom: position.nom }),
    ),
    // Cours déduits de la valeur de marché : le dernier cours affiché par le
    // courtier est arrondi, la valeur de marché fait foi.
    cours: new Map(
      positions.map(position => [
        position.isin,
        position.valeurMarche!.div(position.quantite),
      ]),
    ),
  };
}

describe('construireDashboard', () => {
  it('affiche la valorisation du portefeuille réel', () => {
    const vue = construireDashboard(portefeuilleReel());

    // 11 963,41 + 84,47 = 12 047,88, sans liquidités dans ce scénario.
    expect(vue.valeurTitres).toBe(`12${FINE}047,88${INSEC}€`);
    expect(vue.valeurTotale).toBe(`12${FINE}047,88${INSEC}€`);
  });

  it('retrouve la moins-value latente annoncée par le courtier', () => {
    const vue = construireDashboard(portefeuilleReel());

    // -2,66 sur l'ETF et -17,92 sur STELLANTIS.
    expect(vue.plusValueLatente).toBe(`-20,58${INSEC}€`);
    expect(vue.tendance).toBe('baisse');
  });

  it('classe les positions de la plus lourde à la plus légère', () => {
    const vue = construireDashboard(portefeuilleReel());

    expect(vue.positions.map(p => p.nom)).toEqual([
      'AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC',
      'STELLANTIS',
    ]);
  });

  it('formate chaque ligne telle qu’elle sera lue', () => {
    const vue = construireDashboard(portefeuilleReel());
    const stellantis = vue.positions.find(p => p.nom === 'STELLANTIS')!;

    expect(stellantis.quantite).toBe('20');
    expect(stellantis.pru).toBe(`5,12${INSEC}€`);
    expect(stellantis.valeur).toBe(`84,47${INSEC}€`);
    expect(stellantis.plusValue).toBe(`-17,92${INSEC}€`);
    expect(stellantis.plusValuePct).toBe(`-17,50${INSEC}%`);
    expect(stellantis.tendance).toBe('baisse');
    expect(stellantis.compte).toBe('PEA Boursobank');
  });

  it('répartit par compte', () => {
    const vue = construireDashboard(portefeuilleReel());

    expect(vue.repartitionParCompte).toHaveLength(1);
    expect(vue.repartitionParCompte[0].pourcentage).toBe(`+100,0${INSEC}%`);
    expect(vue.repartitionParCompte[0].fraction).toBeCloseTo(1);
  });
});

describe('cas limites', () => {
  it('signale un portefeuille vide plutôt que d’afficher des zéros muets', () => {
    const vue = construireDashboard({
      etat: rejouer([compte()], []),
      comptes: [compte()],
      titres: [],
      cours: new Map(),
    });

    expect(vue.portefeuilleVide).toBe(true);
    expect(vue.positions).toEqual([]);
    expect(vue.plusValueLatentePct).toBe('—');
  });

  it('nomme les titres dont le cours est inconnu au lieu de les valoriser à zéro', () => {
    // Sans cela, l'écran afficherait un patrimoine amputé sans rien dire.
    const entrees = portefeuilleReel();
    const vue = construireDashboard({ ...entrees, cours: new Map() });

    expect(vue.positions).toEqual([]);
    expect(vue.titresSansCours).toHaveLength(2);
    expect(vue.titresSansCours).toContain('STELLANTIS');
  });

  it('compte les liquidités dans la valeur totale', () => {
    const entrees = portefeuilleReel();
    entrees.etat.comptes.get('pea')!.cash = d('1000');

    const vue = construireDashboard(entrees);
    expect(vue.cash).toBe(`1${FINE}000,00${INSEC}€`);
    expect(vue.valeurTotale).toBe(`13${FINE}047,88${INSEC}€`);
    expect(vue.portefeuilleVide).toBe(false);
  });

  it('retombe sur l’identifiant quand le titre n’est pas connu', () => {
    const entrees = portefeuilleReel();
    const vue = construireDashboard({ ...entrees, titres: [] });

    expect(vue.positions.map(p => p.nom)).toContain('NL00150001Q9');
  });
});
