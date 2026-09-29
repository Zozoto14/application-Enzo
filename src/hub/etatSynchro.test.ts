import { ilYA, resumerSynchro } from './etatSynchro';

const T0 = Date.parse('2026-09-29T12:00:00Z');
const il = (min: number) => new Date(T0 - min * 60_000).toISOString();

describe('indicateur de synchronisation', () => {
  it('« il y a … »', () => {
    expect(ilYA(il(0), T0)).toBe('à l’instant');
    expect(ilYA(il(2), T0)).toBe('il y a 2 min');
    expect(ilYA(il(180), T0)).toBe('il y a 3 h');
    expect(ilYA(il(3 * 24 * 60), T0)).toBe('il y a 3 j');
    expect(ilYA(undefined, T0)).toBe('jamais');
  });

  it('à jour', () => {
    const r = resumerSynchro({ enCours: false, derniere: il(2) }, T0);
    expect(r).toMatchObject({ niveau: 'ok', icone: '✓', libelle: 'À jour · il y a 2 min' });
  });

  it('en cours', () => {
    expect(resumerSynchro({ enCours: true, derniere: il(2) }, T0)).toMatchObject({ niveau: 'encours', libelle: 'Synchronisation…' });
  });

  it('hors ligne avec éléments en attente', () => {
    const r = resumerSynchro({ enCours: false, enLigne: false, derniere: il(9), enAttente: { cles: ['a', 'b', 'c'], essais: 1 } }, T0);
    expect(r).toMatchObject({ niveau: 'attente', libelle: '3 éléments en attente (hors ligne)' });
    expect(resumerSynchro({ enCours: false, enLigne: false, enAttente: { cles: ['a'], essais: 0 } }, T0).libelle).toBe('1 élément en attente (hors ligne)');
    expect(resumerSynchro({ enCours: false, enLigne: false }, T0).libelle).toBe('Hors ligne');
  });

  it('erreur claire avec le motif', () => {
    const r = resumerSynchro({ enCours: false, erreur: 'Le relais refuse ce code de liaison.', enAttente: { cles: ['a'], essais: 2 } }, T0);
    expect(r.niveau).toBe('erreur');
    expect(r.libelle).toContain('1 élément en attente');
    expect(r.detail).toContain('Le relais refuse ce code');
  });

  it('en attente d’envoi (délai de regroupement)', () => {
    expect(resumerSynchro({ enCours: false, derniere: il(1), enAttente: { cles: ['a', 'b'], essais: 0 } }, T0)).toMatchObject({
      niveau: 'attente',
      libelle: '2 éléments à envoyer',
    });
  });

  it('jamais synchronisé', () => {
    expect(resumerSynchro({ enCours: false }, T0).libelle).toBe('Pas encore synchronisé');
  });

  it('chaque état a un pictogramme et un texte (pas la seule couleur)', () => {
    const etats = [
      { enCours: false, derniere: il(1) },
      { enCours: true },
      { enCours: false, enLigne: false },
      { enCours: false, erreur: 'x' },
      { enCours: false, enAttente: { cles: ['a'], essais: 0 } },
    ];
    for (const e of etats) {
      const r = resumerSynchro(e, T0);
      expect(r.icone.length).toBeGreaterThan(0);
      expect(r.libelle.length).toBeGreaterThan(3);
    }
  });
});
