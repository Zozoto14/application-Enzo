import { construireTransparence, coutSurVingtAns } from './transparence';

const lignes = [
  { titreId: 'cw8', nom: 'AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC', isin: 'LU1681043599', valeur: 6000 },
  { titreId: 'ai', nom: 'Air Liquide', valeur: 4000, secteur: 'Matériaux', zone: 'France' },
];

describe('transparence', () => {
  const vue = construireTransparence(lignes);

  it('décompose l’ETF et additionne les actions en direct', () => {
    expect(vue.entreprises[0]).toMatchObject({ nom: 'Autres entreprises du MSCI World' });
    const airLiquide = vue.entreprises.find(part => part.nom === 'Air Liquide')!;
    expect(airLiquide.poids).toBeCloseTo(40);
    // 60 % × 5 % : Nvidia pèse 3 % de vos titres.
    expect(vue.entreprises.find(part => part.nom === 'Nvidia')!.poids).toBeCloseTo(3);
    expect(vue.partEtf).toBeCloseTo(60);
  });

  it('additionne les pays : la France vient de l’ETF et de l’action', () => {
    const france = vue.pays.find(part => part.nom === 'France')!;
    // 40 % en direct + 60 % × 2,7 %.
    expect(france.poids).toBeCloseTo(41.62);
    expect(france.via).toEqual(['AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC', 'Air Liquide']);
    expect(vue.pays[0].nom).toBe('États-Unis');
    expect(vue.pays[0].poids).toBeCloseTo(43.2);
  });

  it('chiffre les frais : ISIN connu, sinon typique, sinon votre saisie', () => {
    expect(vue.frais).toHaveLength(1);
    expect(vue.frais[0]).toMatchObject({ taux: 0.38, connu: true, annuel: 22.8 });
    expect(vue.fraisMoyens).toBeCloseTo(0.228);

    const inconnu = construireTransparence([{ titreId: 'x', nom: 'Lyxor Nasdaq-100', valeur: 1000 }]);
    expect(inconnu.frais[0]).toMatchObject({ taux: 0.25, connu: false });
    expect(construireTransparence([{ titreId: 'x', nom: 'Lyxor Nasdaq-100', valeur: 1000 }], { x: 0.1 }).frais[0]).toMatchObject({ taux: 0.1, connu: true });
  });

  it('mesure le coût des frais sur vingt ans', () => {
    // 10 000 € à 5 % : 26 533 € brut ; à 4,62 % : environ 24 674 €.
    expect(coutSurVingtAns(10000, 0.38)).toBeCloseTo(1860, -1);
    expect(coutSurVingtAns(10000, 0)).toBe(0);
  });
});
