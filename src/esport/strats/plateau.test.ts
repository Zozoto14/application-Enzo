/**
 * Jetons de design du plateau de strats : thèmes de la map (contrastes vérifiés sur les quatre), couleurs,
 * genre graphique d'une capacité (fumée, zone de feu, mur, flash, reconnaissance, fil, piège, goo…), usages
 * des tracés, tailles à l'écran bornées, étiquettes des callouts.
 */

import { COULEURS_JOUEURS, type ObjetStrat, type Zone } from './document';
import {
  PLATEAU,
  THEMES_CARTE,
  alpha,
  assombrir,
  contourBlob,
  contraste,
  couleurAffichee,
  eclaircir,
  etiquettesVisibles,
  facteurEcran,
  idThemeCarte,
  luminance,
  melanger,
  opaciteEtiquette,
  rvb,
  segmentsMur,
  styleCapacite,
  themeCarte,
  tiretsUsage,
  usageTrace,
  zoomDepuisQuantifie,
  zoomQuantifie,
} from './plateau';

describe('couleurs', () => {
  it('composantes, transparence, mélange', () => {
    expect(rvb('#ff8000')).toEqual([255, 128, 0]);
    expect(rvb('pas une couleur')).toEqual([255, 255, 255]);
    expect(alpha('#ff8000', 0.5)).toBe('rgba(255,128,0,0.5)');
    expect(alpha('#000000', 3)).toBe('rgba(0,0,0,1)');
    expect(melanger('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(eclaircir('#000000', 1)).toBe('#ffffff');
    expect(assombrir('#336699', 0)).toBe('#336699');
  });

  it('luminance et rapport de contraste (WCAG)', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 3);
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 3);
    expect(contraste('#777777', '#777777')).toBe(1);
  });

  it('couleur d’une capacité : celle du joueur, ou l’accent de l’agent quand la strat le demande', () => {
    expect(couleurAffichee('#22c55e', undefined, '#AA00FF')).toBe('#22c55e');
    expect(couleurAffichee('#22c55e', 'joueur', '#aa00ff')).toBe('#22c55e');
    expect(couleurAffichee('#22c55e', 'agent', '#AA00FF')).toBe('#aa00ff');
    expect(couleurAffichee('#22c55e', 'agent', null)).toBe('#22c55e');
    expect(couleurAffichee('#22c55e', 'agent', 'rouge')).toBe('#22c55e');
  });
});

describe('thèmes de la map : lisibilité', () => {
  it('quatre thèmes ; identifiant inconnu : « Tactique sombre »', () => {
    expect(THEMES_CARTE).toEqual(['tactique', 'clair', 'contraste', 'origine']);
    expect(idThemeCarte('clair')).toBe('clair');
    expect(idThemeCarte('fluo')).toBe('tactique');
    expect(idThemeCarte(undefined)).toBe('tactique');
    expect(themeCarte('inconnu')).toBe(PLATEAU.themes.tactique);
  });

  it.each(THEMES_CARTE)('thème « %s » : textes, liseré et anneaux lisibles', id => {
    const t = themeCarte(id);
    // Étiquettes des callouts : texte sur son halo sombre.
    expect(contraste(t.etiquette, PLATEAU.halo)).toBeGreaterThanOrEqual(7);
    // Silhouette de la map : le liseré se détache du sol, le sol du fond (sauf « Image d'origine », non redessinée).
    if (t.detail < 1) {
      expect(contraste(t.contour, t.sol)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.contour, t.fond)).toBeGreaterThanOrEqual(3);
      expect(contraste(t.sol, t.fond)).toBeGreaterThanOrEqual(1.08);
    }
    // Anneau de sélection (blanc cerné de sombre), textes des puces : indépendants du thème.
    expect(contraste(PLATEAU.selection, PLATEAU.halo)).toBeGreaterThanOrEqual(15);
    expect(contraste(PLATEAU.encre, PLATEAU.puce)).toBeGreaterThanOrEqual(12);
    expect(contraste(PLATEAU.cote, PLATEAU.halo)).toBeGreaterThanOrEqual(10);
  });

  it('anneaux des joueurs et rouge ennemi : visibles sur le liseré sombre des jetons', () => {
    for (const c of [...COULEURS_JOUEURS, PLATEAU.ennemi]) expect(contraste(c, PLATEAU.halo)).toBeGreaterThanOrEqual(4.5);
  });

  it('une seule échelle typographique, croissante', () => {
    const { xs, s, m, l, xl } = PLATEAU.typo;
    expect([xs, s, m, l, xl]).toEqual([...[xs, s, m, l, xl]].sort((a, b) => a - b));
    expect(new Set([xs, s, m, l, xl]).size).toBe(5);
  });
});

describe('genre graphique d’une capacité', () => {
  const cercle = (rayon: number): Zone => ({ forme: 'cercle', rayon });
  const genre = (zone: Zone | null, nom: string, donnees?: Record<string, unknown>) => styleCapacite(zone, donnees as never, nom).genre;

  it('cercles : fumée, zone de feu (teinte chaude), piège, goo, grande aire', () => {
    expect(genre(cercle(4.1), 'Dark Cover')).toBe('fumee');
    expect(genre(cercle(4.1), 'Sky Smoke')).toBe('fumee');
    expect(styleCapacite(cercle(4.5), undefined, 'Incendiary')).toEqual({ genre: 'zone', ultime: false, chaud: true });
    expect(genre(cercle(3), 'Proximity Mine')).toBe('piege');
    expect(genre(cercle(3), 'Goo Grenade')).toBe('blob');
    expect(genre(cercle(15), 'Lockdown')).toBe('aire');
    // Sans nom parlant : la durée tranche (longue = fumée), sinon une zone simple.
    expect(genre(cercle(4), 'Orbe', { duree: 15 })).toBe('fumee');
    expect(styleCapacite(cercle(4), undefined, 'Orbe')).toEqual({ genre: 'zone', ultime: false, chaud: false });
  });

  it('autres formes : mur, flash ou cône de détection, reconnaissance, fil, bande ; sans zone : icône', () => {
    expect(genre({ forme: 'mur', longueur: 60, largeur: 1, courbure: 0, angle: 0 }, 'Toxic Screen')).toBe('mur');
    expect(styleCapacite({ forme: 'mur', longueur: 21, largeur: 1, courbure: 0, angle: 0 }, undefined, 'Blaze').chaud).toBe(true);
    expect(genre({ forme: 'cone', portee: 20, ouverture: 120, angle: 0 }, 'Flashpoint')).toBe('eclair');
    expect(genre({ forme: 'cone', portee: 30, ouverture: 100, angle: 0 }, 'Turret')).toBe('cone');
    expect(genre({ forme: 'trajet', dx: 30, dy: 10, rayon: 30 }, 'Recon Bolt')).toBe('recon');
    expect(genre({ forme: 'ligne', longueur: 10, angle: 0 }, 'Trapwire')).toBe('fil');
    expect(genre({ forme: 'rect', longueur: 10, largeur: 4, angle: 0 }, 'Fast Lane')).toBe('bande');
    expect(genre(null, 'Dark Cover')).toBe('icone');
  });

  it('ultime : par la catégorie ou la touche X', () => {
    expect(styleCapacite(cercle(9), { categorie: 'ultime' } as never, 'Viper’s Pit').ultime).toBe(true);
    expect(styleCapacite(cercle(9), { touche: 'x' } as never, 'Orbital Strike').ultime).toBe(true);
    expect(styleCapacite(cercle(9), { touche: 'E' } as never, 'Sky Smoke').ultime).toBe(false);
  });

  it('mur en blocs seulement si les données le disent', () => {
    expect(segmentsMur(undefined)).toBe(1);
    expect(segmentsMur({ segments: 4 } as never)).toBe(4);
    expect(segmentsMur({ segments: 99 } as never)).toBe(12);
  });
});

describe('tracés, tailles à l’écran, étiquettes', () => {
  it('usage d’un tracé : déplacement (plein), rotation (tirets), regard (pointillés) ; anciens documents : d’après « tirets »', () => {
    expect(usageTrace({ tirets: false })).toBe('deplacement');
    expect(usageTrace({ tirets: true })).toBe('rotation');
    expect(usageTrace({ tirets: true, usage: 'regard' })).toBe('regard');
    expect(tiretsUsage('deplacement', 5)).toBeUndefined();
    const rotation = tiretsUsage('rotation', 5) as number[];
    const regard = tiretsUsage('regard', 5) as number[];
    expect(rotation[0]).toBeGreaterThan(regard[0]);
    expect(regard[0]).toBeLessThan(regard[1]);
  });

  it('jetons : rayon à l’écran borné, quel que soit le zoom', () => {
    const { rayon, ecranMinPx, ecranMaxPx } = PLATEAU.pion;
    for (const px of [0.2, 0.35, 0.67, 1, 2.4, 5.5]) {
      const ecran = rayon * px * facteurEcran(rayon, px, ecranMinPx, ecranMaxPx);
      expect(ecran).toBeGreaterThanOrEqual(ecranMinPx - 1e-6);
      expect(ecran).toBeLessThanOrEqual(ecranMaxPx + 1e-6);
    }
    expect(facteurEcran(rayon, 1, ecranMinPx, ecranMaxPx)).toBe(1);
    // Cible tactile : le plus petit pion reste d'au moins 38 px de diamètre.
    expect(ecranMinPx * 2).toBeGreaterThanOrEqual(38);
  });

  it('zoom quantifié : même pas pour deux zooms voisins, aller-retour stable', () => {
    expect(zoomQuantifie(0.67)).toBe(zoomQuantifie(0.675));
    expect(zoomQuantifie(0.67)).not.toBe(zoomQuantifie(1.2));
    const q = zoomQuantifie(1.37);
    expect(zoomQuantifie(zoomDepuisQuantifie(q))).toBe(q);
  });

  it('étiquettes des callouts : cachées sous un seuil de zoom, atténuées sous un objet', () => {
    expect(etiquettesVisibles(PLATEAU.etiquette.seuilZoomPx - 0.01)).toBe(false);
    expect(etiquettesVisibles(PLATEAU.etiquette.seuilZoomPx)).toBe(true);
    const pion: ObjetStrat = { id: 'a', type: 'agent', x: 500, y: 500, agent: 'jett', nom: 'Jett', icone: null, joueur: 0, couleur: '#22c55e' };
    const fleche = { id: 'f', type: 'fleche', points: [490, 490, 510, 510], couleur: '#ffffff', epaisseur: 5, tirets: false } as ObjetStrat;
    expect(opaciteEtiquette(505, 498, [pion])).toBe(PLATEAU.etiquette.opaciteSousObjet);
    expect(opaciteEtiquette(700, 500, [pion])).toBe(1);
    expect(opaciteEtiquette(500, 500, [fleche])).toBe(1);
  });

  it('tache de goo : contour fermé, stable pour un même objet, différent d’un objet à l’autre', () => {
    const a = contourBlob(40, 'objet-1');
    expect(a).toHaveLength(24);
    expect(contourBlob(40, 'objet-1')).toEqual(a);
    expect(contourBlob(40, 'objet-2')).not.toEqual(a);
    for (let i = 0; i < a.length; i += 2) {
      const r = Math.hypot(a[i], a[i + 1]);
      expect(r).toBeGreaterThan(40 * 0.8);
      expect(r).toBeLessThan(40 * 1.15);
    }
  });
});
