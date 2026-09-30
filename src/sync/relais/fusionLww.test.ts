import { etatLwwVide, fusionner, noterLocal, type Fusions } from './fusionLww';
import { idEvenement, unionJournaux } from '../../hub/admin/journal';

const T1 = '2026-09-30T08:00:00.000Z';
const T2 = '2026-09-30T09:00:00.000Z';
const T3 = '2026-09-30T10:00:00.000Z';

describe('fusion dernier gagnant', () => {
  it('au premier tour, ce qui existe ailleurs l’emporte (appareil qu’on relie)', () => {
    const note = noterLocal(etatLwwVide(), { a: 1 }, T3);
    const r = fusionner({ a: 1 }, note, { v: 1, entites: { a: 2, b: 3 }, dates: { a: T1, b: T1 }, supprimes: {} });
    expect(r.entites).toEqual({ a: 2, b: 3 });
    expect(r.changeIci).toBe(true);
    expect(r.aPublier).toBe(false);
  });

  it('une suppression plus récente l’emporte sur une valeur ; une modification plus récente sur une suppression', () => {
    let etat = noterLocal(etatLwwVide(), { a: 1, b: 1 }, T1);
    etat = { ...etat, dates: { a: T1, b: T1 } };
    etat = noterLocal(etat, { a: 2, b: 1 }, T3); // a modifiée à T3
    const r = fusionner({ a: 2, b: 1 }, etat, { v: 1, entites: {}, dates: {}, supprimes: { a: T2, b: T2 } });
    expect(r.entites).toEqual({ a: 2 });
    expect(r.retirees).toEqual(['b']);
    expect(r.document.supprimes).toEqual({ b: T2 });
  });

  it('à date égale, les deux côtés choisissent la même valeur', () => {
    const gauche = fusionner({ a: 'x' }, { ...etatLwwVide(), dates: { a: T2 } }, { v: 1, entites: { a: 'y' }, dates: { a: T2 }, supprimes: {} });
    const droite = fusionner({ a: 'y' }, { ...etatLwwVide(), dates: { a: T2 } }, { v: 1, entites: { a: 'x' }, dates: { a: T2 }, supprimes: {} });
    expect(gauche.entites.a).toBe(droite.entites.a);
  });

  it('les clés « union » se réunissent, sans suppression', () => {
    const fusions: Fusions = { journal: (a, b) => [...new Set([...(a as string[]), ...(b as string[])])].sort() };
    const etat = noterLocal({ ...etatLwwVide(), connus: { journal: 'x' } }, { journal: ['a'] }, T2, fusions);
    const r = fusionner({ journal: ['a'] }, etat, { v: 1, entites: { journal: ['b'] }, dates: {}, supprimes: {} }, fusions);
    expect(r.entites.journal).toEqual(['a', 'b']);
  });

  it('journal : le même événement noté sur deux appareils n’est gardé qu’une fois', () => {
    const e = { date: T1, type: 'connexion' as const, action: 'Léa a ouvert son compte', cible: 'lea0000001' };
    const f = { date: T2, type: 'reglages' as const, action: 'Réglages modifiés' };
    expect(idEvenement(e)).toBe(idEvenement({ ...e }));
    expect(idEvenement(e)).not.toBe(idEvenement(f));
    expect(unionJournaux([e, f], [e]).map(x => x.action)).toEqual([e.action, f.action]);
  });
});
