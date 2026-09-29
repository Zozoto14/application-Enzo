import { decider, etapesVisite, fonctionnalitesPour, lireEtat, marquerLues } from './devblog';
import { ENTREES, type EntreeDevblog } from './entrees';

const v2: EntreeDevblog = {
  version: '2026.10.01',
  date: '2026-10-01',
  titre: 'Suivante',
  resume: 'r',
  illustration: 'hub',
  fonctionnalites: [{ id: 'a', emoji: '*', titre: 'A', texte: 't' }],
};
const liste = [v2, ...ENTREES];

describe('devblog', () => {
  it('les entrées ont des versions uniques, datées, et au moins une nouveauté', () => {
    const versions = ENTREES.map(e => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    ENTREES.forEach(e => {
      expect(e.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
      expect(e.fonctionnalites.length).toBeGreaterThan(0);
    });
    expect(ENTREES[0].fonctionnalites.map(f => f.id)).toEqual(
      expect.arrayContaining(['admin-avance', 'isolation', 'acces-admin', 'maj-parametres', 'themes', 'personnalisation']),
    );
  });

  it('affiche la dernière version une seule fois par profil', () => {
    const premiere = decider(undefined, { profilNeuf: false, admin: true }, liste);
    expect(premiere).toEqual({ genre: 'afficher', entree: v2 });
    const lu = marquerLues(undefined, [v2.version]);
    expect(decider(lu, { profilNeuf: false, admin: true }, liste)).toEqual({ genre: 'rien' });
    // Un autre profil a son propre état : il la voit à son tour.
    expect(decider(undefined, { profilNeuf: false, admin: false }, liste).genre).toBe('afficher');
  });

  it('jamais pour un profil neuf : tout est marqué lu, rien d’ancien ne ressort', () => {
    const d = decider(undefined, { profilNeuf: true, admin: true }, liste);
    expect(d.genre).toBe('marquer');
    const valeur = d.genre === 'marquer' ? d.valeur : '';
    expect(lireEtat(valeur)?.vues.sort()).toEqual(liste.map(e => e.version).sort());
    expect(decider(valeur, { profilNeuf: false, admin: true }, liste)).toEqual({ genre: 'rien' });
  });

  it('seule la dernière entrée s’affiche d’office, jamais une ancienne', () => {
    const d = decider(marquerLues(undefined, [v2.version]), { profilNeuf: false, admin: true }, liste);
    expect(d.genre).toBe('rien');
  });

  it('jamais d’écran vide : une entrée sans nouveauté visible pour ce profil ne s’affiche pas', () => {
    const adminSeul: EntreeDevblog = { ...v2, fonctionnalites: [{ ...v2.fonctionnalites[0], adminSeulement: true }] };
    expect(decider(undefined, { profilNeuf: false, admin: false }, [adminSeul])).toEqual({ genre: 'rien' });
    expect(decider(undefined, { profilNeuf: false, admin: true }, [adminSeul]).genre).toBe('afficher');
  });

  it('un ami ne voit pas les nouveautés réservées à l’administrateur', () => {
    expect(fonctionnalitesPour(ENTREES[0], false).some(f => f.id === 'admin-avance')).toBe(false);
    expect(fonctionnalitesPour(ENTREES[0], true).some(f => f.id === 'admin-avance')).toBe(true);
  });

  it('marquer lu est idempotent et tolère un état corrompu', () => {
    expect(lireEtat('pas du json')).toEqual({ version: 1, vues: [] });
    const a = marquerLues('pas du json', ['x']);
    expect(marquerLues(a, ['x'])).toBe(a);
  });

  it('la visite guidée réutilise les nouveautés de l’entrée', () => {
    const etapes = etapesVisite(ENTREES[0], false);
    expect(etapes[0].titre).toBe(ENTREES[0].titre);
    expect(etapes.every(e => e.id.startsWith(`devblog-${ENTREES[0].version}`))).toBe(true);
    expect(etapes.some(e => e.id.endsWith('admin-avance'))).toBe(false);
  });
});
