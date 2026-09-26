import { alertesEvenements, retenirEvenements } from './evenements';

const article = (titre: string, source: string, date = '2026-09-26') => ({ titre, resume: '', source, date, langue: 'fr' as const });

describe('alertes d’événements', () => {
  const aujourdhui = '2026-09-26';

  it('prévient la veille et le jour des résultats et du détachement', () => {
    const veille = alertesEvenements([{ nom: 'Air Liquide', prochainsResultats: '2026-09-27', detachement: '2026-09-27' }], aujourdhui, new Set());
    expect(veille.map(a => a.titre)).toEqual([
      '📊 Air Liquide publie ses résultats demain',
      '💶 Dividende d’Air Liquide détaché demain',
    ]);
    const jour = alertesEvenements([{ nom: 'Air Liquide', detachement: '2026-09-26' }], aujourdhui, new Set());
    expect(jour[0].titre).toBe('💶 Dividende d’Air Liquide détaché aujourd’hui');
    expect(alertesEvenements([{ nom: 'X', prochainsResultats: '2026-10-10' }], aujourdhui, new Set())).toEqual([]);
  });

  it('ne répète pas une alerte déjà envoyée', () => {
    const [alerte] = alertesEvenements([{ nom: 'Air Liquide', prochainsResultats: '2026-09-27' }], aujourdhui, new Set());
    expect(alertesEvenements([{ nom: 'Air Liquide', prochainsResultats: '2026-09-27' }], aujourdhui, new Set([alerte.identifiant]))).toEqual([]);
  });

  it('signale une grosse actualité recoupée par trois médias, pas une rumeur isolée', () => {
    const recoupee = alertesEvenements(
      [
        {
          nom: 'Nvidia',
          articles: [
            article('Nvidia rachète une startup de puces pour 5 milliards', 'Les Echos'),
            article('Nvidia rachète une startup de puces pour 5 milliards de dollars', 'BFM Bourse'),
            article('Rachat à 5 milliards : Nvidia rachète une startup de puces', 'Reuters'),
            article('Nvidia va exploser selon un blogueur', 'blog-bourse.net'),
          ],
        },
      ],
      aujourdhui,
      new Set(),
    );
    expect(recoupee).toHaveLength(1);
    expect(recoupee[0].titre).toMatch(/^📰 Nvidia : Nvidia rachète une startup/);
    expect(recoupee[0].corps).toBe('✅ Information recoupée par Les Echos, BFM Bourse et Reuters.');

    const isolee = alertesEvenements([{ nom: 'Nvidia', articles: [article('Nvidia va exploser', 'blog-bourse.net')] }], aujourdhui, new Set());
    expect(isolee).toEqual([]);
  });

  it('ignore les vieilles nouvelles', () => {
    const vieilles = ['Les Echos', 'BFM Bourse', 'Reuters'].map(source => article('Nvidia rachète une startup de puces', source, '2026-09-20'));
    expect(alertesEvenements([{ nom: 'Nvidia', articles: vieilles }], aujourdhui, new Set())).toEqual([]);
  });

  it('garde un nombre borné d’identifiants', () => {
    expect(retenirEvenements(Array.from({ length: 5 }, (_, i) => `a${i}`), ['b'], 3)).toEqual(['a3', 'a4', 'b']);
  });
});
