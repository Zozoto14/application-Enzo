import {
  arcAnneau,
  cheminCourbe,
  cheminLigne,
  echelle,
  graduations,
  indicesEtiquettes,
  moisAnnee,
  plusProche,
  treemap,
} from './geometrie';

describe('echelle', () => {
  it('projette un domaine sur une plage, y compris inversée', () => {
    const y = echelle([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(25)).toBe(150);
  });

  it('centre un domaine plat au lieu de diviser par zéro', () => {
    expect(echelle([5, 5], [0, 100])(5)).toBe(50);
  });
});

describe('graduations', () => {
  it('produit des nombres ronds qui encadrent les données', () => {
    const { valeurs, domaine } = graduations(-3.2, 17.9, 5);
    expect(valeurs).toEqual([-5, 0, 5, 10, 15, 20]);
    expect(domaine).toEqual([-5, 20]);
  });

  it('ne laisse pas traîner d’erreur d’arrondi flottant', () => {
    const { valeurs } = graduations(0.1, 0.7, 4);
    for (const valeur of valeurs) {
      expect(String(valeur).length).toBeLessThan(6);
    }
  });

  it('ouvre une fenêtre autour d’une série plate', () => {
    const { domaine } = graduations(100, 100);
    expect(domaine[0]).toBeLessThan(100);
    expect(domaine[1]).toBeGreaterThan(100);
  });
});

describe('tracés', () => {
  const points = [
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 5 },
  ];

  it('relie les points en segments', () => {
    expect(cheminLigne(points)).toBe('M0,10L10,0L20,5');
  });

  it('lisse en passant par chaque point', () => {
    const chemin = cheminCourbe(points);
    expect(chemin.startsWith('M0,10')).toBe(true);
    expect(chemin).toContain(' 10,0');
    expect(chemin.endsWith(' 20,5')).toBe(true);
  });

  it('ne crée pas de creux sous un palier', () => {
    // Deux points égaux : une spline ordinaire plongerait entre eux.
    const chemin = cheminCourbe([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 5 },
      { x: 30, y: 10 },
    ]);
    const ordonnees = [...chemin.matchAll(/[ ,](-?\d+(?:\.\d+)?)(?=[ C]|$)/g)].map(m => Number(m[1]));
    expect(Math.max(...ordonnees)).toBeLessThanOrEqual(30);
  });
});

describe('arcAnneau', () => {
  it('trace un secteur fermé', () => {
    const chemin = arcAnneau(50, 50, 40, 20, 0, Math.PI / 2);
    expect(chemin.startsWith('M50,10')).toBe(true);
    expect(chemin.endsWith('Z')).toBe(true);
  });

  it('dessine un anneau complet sans que ses extrémités se confondent', () => {
    const chemin = arcAnneau(50, 50, 40, 20, 0, Math.PI * 2);
    expect(chemin).toContain('0 1 1');
  });
});

describe('treemap', () => {
  const cadre = { x: 0, y: 0, largeur: 400, hauteur: 200 };

  it('attribue à chaque élément une aire proportionnelle à sa valeur', () => {
    const rectangles = treemap([{ valeur: 3 }, { valeur: 1 }], cadre);
    const aires = rectangles.map(r => r.largeur * r.hauteur);
    expect(aires[0]).toBeCloseTo(60_000);
    expect(aires[1]).toBeCloseTo(20_000);
  });

  it('rend les rectangles dans l’ordre d’entrée et sans débordement', () => {
    const rectangles = treemap(
      [{ valeur: 1 }, { valeur: 5 }, { valeur: 2 }, { valeur: 2 }],
      cadre,
    );
    for (const r of rectangles) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.largeur).toBeLessThanOrEqual(400 + 1e-6);
      expect(r.y + r.hauteur).toBeLessThanOrEqual(200 + 1e-6);
    }
    expect(rectangles[1].largeur * rectangles[1].hauteur).toBeCloseTo(40_000);
  });

  it('ignore les valeurs nulles ou négatives', () => {
    const rectangles = treemap([{ valeur: 0 }, { valeur: -2 }, { valeur: 4 }], cadre);
    expect(rectangles[0].largeur).toBe(0);
    expect(rectangles[1].largeur).toBe(0);
    expect(rectangles[2].largeur * rectangles[2].hauteur).toBeCloseTo(80_000);
  });
});

describe('axes', () => {
  it('nomme un mois à la française', () => {
    expect(moisAnnee('2026-08-03')).toBe('Août 2026');
    expect(moisAnnee('2025-01-15')).toBe('Janv. 2025');
  });

  it('répartit les étiquettes, premier et dernier compris', () => {
    expect(indicesEtiquettes(100, 5)).toEqual([0, 25, 50, 74, 99]);
    expect(indicesEtiquettes(3, 5)).toEqual([0, 1, 2]);
  });

  it('trouve le point survolé', () => {
    expect(plusProche([0, 10, 20, 30], 14)).toBe(1);
    expect(plusProche([0, 10, 20, 30], 26)).toBe(3);
  });
});
