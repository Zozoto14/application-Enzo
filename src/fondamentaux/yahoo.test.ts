import { COMPTES_EXEMPLE, RESUME_EXEMPLE, historiqueExemple } from './exemples';
import { chargerValeur, lireComptes, lireCoursEtDividendes, lireFiche, nombre, type Recuperer } from './yahoo';

describe('lecture des réponses Yahoo', () => {
  it('lit les champs { raw } comme des nombres nus', () => {
    expect(nombre({ raw: 1.5, fmt: '1.50' })).toBe(1.5);
    expect(nombre(2)).toBe(2);
    expect(nombre({})).toBeNull();
    expect(nombre('3')).toBeNull();
  });

  it('extrait profil, ratios et consensus', () => {
    const fiche = lireFiche('EXA.PA', RESUME_EXEMPLE);
    expect(fiche.nom).toBe('Exemple Industries SA');
    expect(fiche.cours).toBe(52.4);
    expect(fiche.variationPct).toBeCloseTo(1.25);
    expect(fiche.valorisation.per).toBe(18.2);
    expect(fiche.dividende.rendementMoyen5Ans).toBe(2.8);
    expect(fiche.analystes.tendance?.achat).toBe(9);
    expect(fiche.actionnaires.principaux[0].nom).toBe('Fonds A');
    expect(fiche.transactionsInities[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fiche.resultats.estimations[1].periode).toBe('+1y');
  });

  it('refuse une réponse vide avec un motif lisible', () => {
    expect(() => lireFiche('XXX', { quoteSummary: { result: null, error: { description: 'Quote not found for symbol: XXX' } } })).toThrow(
      'Quote not found',
    );
  });

  it('range les comptes annuels par poste et par date', () => {
    const comptes = lireComptes(COMPTES_EXEMPLE);
    expect(comptes.TotalRevenue).toHaveLength(7);
    expect(comptes.TotalRevenue?.[0]).toEqual({ date: '2019-12-31', valeur: 19e9 });
    expect(comptes.CashDividendsPaid?.[6].valeur).toBe(-1.5e9);
  });

  it('lit cours hebdomadaires et dividendes', () => {
    const { cours, dividendes } = lireCoursEtDividendes(historiqueExemple());
    expect(cours).toHaveLength(300);
    expect(dividendes).toHaveLength(5);
    expect(dividendes[0].montant).toBe(1.2);
  });
});

describe('chargerValeur', () => {
  const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps });

  it('affiche le résumé même si les comptes manquent', async () => {
    const recuperer: Recuperer = async url =>
      url.includes('quoteSummary')
        ? reponse(RESUME_EXEMPLE)
        : url.includes('timeseries')
          ? reponse({}, 500)
          : reponse(historiqueExemple());
    const donnees = await chargerValeur('EXA.PA', recuperer);
    expect(donnees.fiche.nom).toBe('Exemple Industries SA');
    expect(donnees.manques).toEqual(['Comptes annuels : Yahoo Finance a répondu 500.']);
    expect(donnees.historique.cours.length).toBeGreaterThan(0);
  });

  it('échoue franchement si le résumé est inaccessible', async () => {
    const recuperer: Recuperer = async () => {
      throw new Error('hors ligne');
    };
    await expect(chargerValeur('EXA.PA', recuperer)).rejects.toThrow('injoignable');
  });
});
