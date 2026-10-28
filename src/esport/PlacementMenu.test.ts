import { HAUTEUR_ACTION, MARGE_MENU, placerMenu } from './ui/placementMenu';

const PC = { largeur: 1280, hauteur: 720 };

describe('placement du menu « ⋯ »', () => {
  it("s'ouvre sous le bouton quand il y a la place", () => {
    const p = placerMenu({ x: 900, y: 100, l: 44, h: 44 }, PC, 5);
    expect(p).toMatchObject({ mode: 'popover', cote: 'bas', top: 150 });
  });

  it("s'ouvre vers le haut en bas d'écran, ancré sur le bouton", () => {
    const p = placerMenu({ x: 900, y: 660, l: 44, h: 44 }, PC, 8);
    expect(p.mode).toBe('popover');
    if (p.mode !== 'popover') return;
    expect(p.cote).toBe('haut');
    expect(p.bottom).toBe(720 - 660 + 6);
    expect(p.top).toBeUndefined();
    expect(p.maxHeight).toBeLessThanOrEqual(660);
  });

  it('se décale pour rester dans la fenêtre à droite et à gauche', () => {
    const d = placerMenu({ x: 1270, y: 100, l: 44, h: 44 }, PC, 3);
    const g = placerMenu({ x: 0, y: 100, l: 44, h: 44 }, PC, 3);
    if (d.mode !== 'popover' || g.mode !== 'popover') throw new Error('popover attendu');
    expect(d.left + d.width).toBeLessThanOrEqual(PC.largeur - MARGE_MENU);
    expect(g.left).toBeGreaterThanOrEqual(MARGE_MENU);
  });

  it("limite la hauteur à l'espace disponible (défilement interne)", () => {
    const p = placerMenu({ x: 500, y: 300, l: 44, h: 44 }, { largeur: 1280, hauteur: 400 }, 20);
    if (p.mode !== 'popover') throw new Error('popover attendu');
    const haut = p.top !== undefined ? p.top : 400 - (p.bottom ?? 0) - p.maxHeight;
    const bas = p.top !== undefined ? p.top + p.maxHeight : 400 - (p.bottom ?? 0);
    expect(haut).toBeGreaterThanOrEqual(MARGE_MENU);
    expect(bas).toBeLessThanOrEqual(400 - MARGE_MENU + 6);
    expect(p.maxHeight).toBeGreaterThanOrEqual(HAUTEUR_ACTION * 2);
  });

  it('sur petite largeur : feuille du bas pleine largeur', () => {
    const p = placerMenu({ x: 300, y: 200, l: 44, h: 44 }, { largeur: 390, hauteur: 844 }, 6);
    expect(p).toEqual({ mode: 'feuille', maxHeight: Math.floor(844 * 0.8) });
  });
});
