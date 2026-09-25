import { COMPTES_EXEMPLE, RESUME_EXEMPLE, historiqueExemple } from '../../fondamentaux/exemples';
import { lireComptes, lireCoursEtDividendes, lireFiche } from '../../fondamentaux/yahoo';
import { cagr, calculerPrixJuste, construireFiche, etatsFinanciers, formaterCompact } from './fiche';

function vue() {
  return construireFiche(
    lireFiche('EXA.PA', RESUME_EXEMPLE),
    lireComptes(COMPTES_EXEMPLE),
    lireCoursEtDividendes(historiqueExemple()),
  );
}

describe('fiche valeur', () => {
  it('met en forme l’en-tête et une note maison sur vingt', () => {
    const fiche = vue();
    expect(fiche.entete.nom).toBe('Exemple Industries SA');
    expect(fiche.entete.devise).toBe('€');
    expect(fiche.entete.variation?.tendance).toBe('hausse');
    expect(fiche.entete.note).toMatch(/^\d{1,2},\d\/20$/);
    expect(fiche.profil).toHaveLength(6);
  });

  it('écrit les grands nombres en abrégé', () => {
    expect(formaterCompact(48_000_000_000, '€')).toBe('48,0 Md €');
    expect(formaterCompact(1_250_000)).toBe('1,3 M');
    expect(formaterCompact(null)).toBe('—');
  });

  it('prépare graphiques annuels, dividendes et historique du PER', () => {
    const fiche = vue();
    expect(fiche.quantitatif.map(g => g.titre)).toContain('Chiffre d’affaires');
    expect(fiche.quantitatif.find(g => g.titre === 'Marge nette')?.unite).toBe('pourcentage');
    // Dividendes versés : montrés en positif.
    expect(fiche.quantitatif.find(g => g.titre === 'Dividendes versés')?.barres[0].valeur).toBeGreaterThan(0);
    expect(fiche.dividende.parAnnee.length).toBe(5);
    expect(fiche.dividende.croissance.length).toBe(4);
    expect(fiche.valorisation.per.length).toBeGreaterThan(0);
    expect(fiche.resultats.recommandations.map(r => r.libelle)).toEqual([
      'Achat fort',
      'Achat',
      'Conserver',
      'Vente',
    ]);
  });

  it('range les états financiers par exercice, avec la variation annuelle', () => {
    const { annees, etats } = etatsFinanciers(lireComptes(COMPTES_EXEMPLE));
    expect(annees[0]).toBe('FY19');
    const ca = etats[0].lignes.find(l => l.libelle === 'Chiffre d’affaires')!;
    expect(ca.valeurs[0]).toBe('19,0 Md');
    expect(ca.variations[0]).toBeNull();
    expect(ca.variations[1]?.tendance).toBe('baisse');
  });

  it('calcule une croissance annuelle moyenne', () => {
    expect(
      cagr([
        { date: '2020-12-31', valeur: 100 },
        { date: '2022-12-31', valeur: 121 },
      ]),
    ).toBeCloseTo(0.1, 2);
  });
});

describe('prix juste', () => {
  const base = { bpa: 1, croissance: 0, annees: 10, perSortie: 10, rendementExige: 0, distribution: 0, inclureDividendes: false };

  it('sans croissance ni actualisation, vaut BPA × PER', () => {
    expect(calculerPrixJuste(base, 10).prix).toBeCloseTo(10);
    expect(calculerPrixJuste(base, 10).margeSecurite).toBeCloseTo(0);
  });

  it('actualise le prix futur et y ajoute les dividendes', () => {
    const sans = calculerPrixJuste({ ...base, croissance: 10, rendementExige: 10 }, 10);
    // Croissance et actualisation au même taux : elles s’annulent.
    expect(sans.prix).toBeCloseTo(10);
    const avec = calculerPrixJuste({ ...base, croissance: 10, rendementExige: 10, distribution: 0.5, inclureDividendes: true }, 10);
    expect(avec.prix).toBeCloseTo(15);
    expect(avec.projection).toHaveLength(10);
  });
});
