import { creerConvertisseur, lireTaux, normaliserDevise } from './change';
import { libellesEnEuros } from '../ui/devises';

const reponse = (taux: number) => ({ ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: taux } }] } }) });
const attendre = () => new Promise<void>(resoudre => setTimeout(() => resoudre(), 0));

describe('conversion en euros', () => {
  it('convertit après avoir chargé le taux, une seule fois', async () => {
    const appels: string[] = [];
    const conv = creerConvertisseur(async url => (appels.push(url), reponse(0.2316)));
    let prevenu = 0;
    conv.abonner(() => (prevenu += 1));

    expect(conv.enEuros(865, 'PLN')).toBeUndefined();
    expect(conv.enEuros(865, 'PLN')).toBeUndefined();
    await attendre();
    await attendre();
    expect(conv.enEuros(865, 'PLN')).toBeCloseTo(200.33, 1);
    expect(appels).toEqual(['https://query2.finance.yahoo.com/v8/finance/chart/PLNEUR%3DX?range=5d&interval=1d']);
    expect(prevenu).toBe(1);
  });

  it('laisse l’euro tel quel et ramène les pence en livres', () => {
    const conv = creerConvertisseur(undefined);
    expect(conv.enEuros(12, 'EUR')).toBe(12);
    expect(normaliserDevise('GBp')).toEqual({ devise: 'GBP', facteur: 0.01 });
  });

  it('affiche les euros en principal et la devise d’origine à côté', async () => {
    const conv = creerConvertisseur(async () => reponse(0.2316));
    expect(libellesEnEuros(865, 'PLN', conv.enEuros)).toEqual({ principal: '865,00 PLN' });
    await attendre();
    await attendre();
    const libelles = libellesEnEuros(865, 'PLN', conv.enEuros);
    expect(libelles.origine).toBe('865,00 PLN');
    expect(libelles.principal).toMatch(/^200,3\d €$/);
    expect(libellesEnEuros(177, 'EUR', conv.enEuros)).toEqual({ principal: '177,00 €' });
  });

  it('refuse une réponse sans taux', () => {
    expect(lireTaux({ chart: { result: [{ meta: {} }] } })).toBeUndefined();
  });
});
