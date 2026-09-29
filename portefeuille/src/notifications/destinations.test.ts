import { destinationDe, lireDestination } from './destinations';

describe('destination d’une notification', () => {
  it('déduit la page de l’identifiant', () => {
    expect(destinationDe('briefing-2026-09-26-matin')).toBe('tableau');
    expect(destinationDe('alerte-air-liquide-haut-2026-09-26')).toBe('titre:air-liquide');
    expect(destinationDe('variation-baisse-2026-09-26')).toBe('tableau');
    expect(destinationDe('carnet-objectif-ai-200')).toBe('carnet');
    expect(destinationDe('versement-2026-10')).toBe('objectifs');
    expect(destinationDe('rappel-briefing-2026-09-26-matin')).toBe('tableau');
  });

  it('lit une destination reçue, et se replie sur le portefeuille', () => {
    const ecrans = new Set(['tableau', 'objectifs', 'podcast']);
    expect(lireDestination('objectifs', ecrans)).toEqual({ genre: 'ecran', cle: 'objectifs' });
    expect(lireDestination('symbole:NVDA', ecrans)).toEqual({ genre: 'symbole', symbole: 'NVDA' });
    expect(lireDestination('titre:ai', ecrans)).toEqual({ genre: 'titre', titreId: 'ai' });
    expect(lireDestination('inconnu', ecrans)).toEqual({ genre: 'ecran', cle: 'tableau' });
    expect(lireDestination(42, ecrans)).toEqual({ genre: 'ecran', cle: 'tableau' });
  });
});
