import { d } from '../../core/money/decimal';
import { achat, titre, vente } from '../../core/testing/fixtures';
import { construireJournal } from './journal';

describe('journal des décisions', () => {
  it('juge un achat au cours d’aujourd’hui, et une vente à l’envers', () => {
    const vue = construireJournal({
      transactions: [
        { ...achat('2026-01-02', 10, 150, 0), note: 'Leader des gaz industriels' },
        vente('2026-06-01', 4, 200, 0),
      ],
      titres: [titre()],
      cours: new Map([['air-liquide', d('180')]]),
      carnet: { 'air-liquide': { pourquoi: 'Marges régulières.', venteSi: '', ecriteLe: '2026-01-02' } },
    });
    const [venteRecente, premierAchat] = vue.lignes;
    expect(premierAchat.type).toBe('ACHAT');
    expect(premierAchat.verdict).toBe('bon');
    expect(premierAchat.effetEuros).toBe(300);
    expect(premierAchat.phrase).toBe('Depuis cet achat, +20 % : un gain de 300 € sur ces titres.');
    expect(premierAchat.note).toBe('Leader des gaz industriels');
    expect(premierAchat.these).toBe('Marges régulières.');

    expect(venteRecente.verdict).toBe('bon');
    expect(venteRecente.phrase).toBe('Depuis la vente, −10 % : vendre vous a évité 80 € de baisse.');
    expect(vue.tauxReussite).toBe(100);
  });

  it('dit quand la vente a fait manquer une hausse', () => {
    const vue = construireJournal({
      transactions: [vente('2026-06-01', 4, 100, 0)],
      titres: [titre()],
      cours: new Map([['air-liquide', d('150')]]),
    });
    expect(vue.lignes[0].verdict).toBe('mauvais');
    expect(vue.lignes[0].phrase).toBe('Depuis la vente, +50 % : la vente a fait manquer 200 € de hausse.');
    expect(vue.tauxReussite).toBe(0);
  });

  it('ne juge pas sans cours', () => {
    const vue = construireJournal({ transactions: [achat('2026-01-02', 1, 10, 0)], titres: [titre()], cours: new Map() });
    expect(vue.lignes[0].verdict).toBeUndefined();
    expect(vue.tauxReussite).toBeUndefined();
  });
});
