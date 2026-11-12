/**
 * Géométrie de l'éditeur de strats : formes des capacités à l'échelle de la map, poignées (orienter,
 * allonger, courber), zone initiale d'après les caractéristiques du profil, cadrage d'image, lecture animée.
 */

import type { CapaciteJeu } from '../jeux/api';
import type { Etape } from './document';
import { aimanter, cadreImage, centre, dansPolygone, dimensionFixe, etatLecture, momentObjet, pointSurTrace, poignees, primitiveZone, tirerPoignee, tracePartiel, zoneDepuisCapacite } from './geometrie';
import { ECHELLE_DEFAUT, calibrer, metresVersUnites, unitesVersMetres } from './modeles';

const cap = (champs: Partial<CapaciteJeu>): CapaciteJeu => ({ cle: 'x', nom: 'X', touche: 'E', categorie: 'basique', forme: 'cercle', aVerifier: true, ...champs });

describe('échelle et formes des capacités', () => {
  it('une smoke de 4,1 m fait 41 unités sur une map à 10 unités par mètre, 32,8 à l’échelle par défaut', () => {
    expect(primitiveZone(500, 500, { forme: 'cercle', rayon: 4.1 }, 10)).toEqual({ type: 'cercle', x: 500, y: 500, r: 41 });
    expect(primitiveZone(0, 0, { forme: 'cercle', rayon: 4.1 }, null)).toMatchObject({ r: 4.1 * ECHELLE_DEFAUT });
    expect(metresVersUnites(5, 10)).toBe(50);
    expect(unitesVersMetres(50, 10)).toBe(5);
    expect(calibrer([0, 0, 0, 300], 30)).toBe(10);
    expect(calibrer([0, 0, 1, 0], 30)).toBeNull();
  });

  it('mur : longueur à l’échelle, orienté, courbé par un point milieu décalé', () => {
    const droit = primitiveZone(100, 100, { forme: 'mur', angle: 0, longueur: 18, largeur: 1, courbure: 0 }, 10);
    expect(droit).toEqual({ type: 'trait', points: [100, 100, 280, 100], epaisseur: 10, courbe: false, tirets: false });
    const courbe = primitiveZone(100, 100, { forme: 'mur', angle: 0, longueur: 20, largeur: 1, courbure: 0.5 }, 10);
    expect(courbe).toMatchObject({ type: 'trait', courbe: true });
    expect((courbe as { points: number[] }).points).toEqual([100, 100, 200, 150, 300, 100]);
  });

  it('cône, ligne, rectangle et trajet', () => {
    expect(primitiveZone(0, 0, { forme: 'cone', angle: -90, ouverture: 60, portee: 15 }, 10)).toEqual({ type: 'secteur', x: 0, y: 0, r: 150, angle: -90, ouverture: 60 });
    const ligne = primitiveZone(0, 0, { forme: 'ligne', angle: 90, longueur: 15 }, 10) as { points: number[]; tirets: boolean };
    expect(ligne.points[3]).toBeCloseTo(150);
    expect(ligne.tirets).toBe(true);
    expect(primitiveZone(0, 0, { forme: 'rect', angle: 0, longueur: 66, largeur: 2.5 }, 10)).toMatchObject({ longueur: 660, largeur: 25 });
    expect(primitiveZone(400, 400, { forme: 'trajet', dx: -100, dy: 50, rayon: 30 }, 10)).toEqual({ type: 'trajet', points: [300, 450, 400, 400], r: 300 });
  });

  it('poignées : orienter un cône à portée fixe, allonger une ligne libre, courber un mur courbable', () => {
    const cone = { forme: 'cone' as const, angle: 0, ouverture: 60, portee: 15 };
    expect(poignees(0, 0, cone, 10)).toEqual([{ cle: 'fin', x: 150, y: 0 }]);
    const oriente = tirerPoignee(0, 0, cone, 'fin', 0, 400, 10, { fixe: true });
    expect(oriente).toEqual({ ...cone, angle: 90 });
    const ligne = tirerPoignee(0, 0, { forme: 'ligne', angle: 0, longueur: 5 }, 'fin', 300, 0, 10);
    expect(ligne).toEqual({ forme: 'ligne', angle: 0, longueur: 30 });
    const mur = { forme: 'mur' as const, angle: 0, longueur: 20, largeur: 1, courbure: 0 };
    expect(poignees(0, 0, mur, 10).map(h => h.cle)).toEqual(['fin', 'courbe']);
    expect(tirerPoignee(0, 0, mur, 'courbe', 100, 50, 10, { courbable: true })).toEqual({ ...mur, courbure: 0.5 });
    expect(tirerPoignee(0, 0, mur, 'courbe', 100, 50, 10, { courbable: false })).toBe(mur);
    expect(tirerPoignee(0, 0, { forme: 'cercle', rayon: 4 }, 'bord', 60, 0, 10)).toEqual({ forme: 'cercle', rayon: 6 });
    expect(tirerPoignee(10, 10, { forme: 'trajet', dx: 0, dy: 0, rayon: 30 }, 'fin', -90, 60, 10)).toEqual({ forme: 'trajet', dx: -100, dy: 50, rayon: 30 });
  });

  it('zone initiale d’après les caractéristiques du profil ; dimension fixée ou libre', () => {
    expect(zoneDepuisCapacite(cap({ forme: 'cercle', rayon: 4.1 }))).toEqual({ forme: 'cercle', rayon: 4.1 });
    expect(zoneDepuisCapacite(cap({ forme: 'mur', longueur: 60, largeur: 1.5 }))).toEqual({ forme: 'mur', angle: 0, longueur: 60, largeur: 1.5, courbure: 0 });
    expect(zoneDepuisCapacite(cap({ forme: 'cone', ouverture: 120, portee: 12 }))).toEqual({ forme: 'cone', angle: -90, ouverture: 120, portee: 12 });
    expect(zoneDepuisCapacite(cap({ forme: 'trajet', rayon: 30 }))).toMatchObject({ forme: 'trajet', rayon: 30 });
    expect(zoneDepuisCapacite(cap({ forme: 'point' }))).toBeNull();
    expect(zoneDepuisCapacite(undefined)).toBeNull();
    expect(dimensionFixe(cap({ forme: 'cone', portee: 12 }))).toBe(true);
    expect(dimensionFixe(cap({ forme: 'ligne' }))).toBe(false);
  });
});

describe('cadrage, aimantation, polygones', () => {
  it('image cadrée dans le carré de 1000 sans déformation', () => {
    expect(cadreImage(2000, 1000)).toEqual({ x: 0, y: 250, l: 1000, h: 500 });
    expect(cadreImage(500, 1000)).toEqual({ x: 250, y: 0, l: 500, h: 1000 });
    expect(cadreImage(undefined, undefined)).toEqual({ x: 0, y: 0, l: 1000, h: 1000 });
  });
  it('aimantation, centre et appartenance à un callout', () => {
    expect(aimanter(23, 10)).toBe(20);
    expect(aimanter(23, 0)).toBe(23);
    const carre = [0, 0, 100, 0, 100, 100, 0, 100];
    expect(centre(carre)).toEqual({ x: 50, y: 50 });
    expect(dansPolygone(50, 50, carre)).toBe(true);
    expect(dansPolygone(150, 50, carre)).toBe(false);
  });
});

describe('lecture animée', () => {
  const etape: Etape = {
    id: 'e1',
    titre: 'Exec',
    note: '',
    duree: 10,
    objets: [
      { id: 'a', type: 'agent', x: 0, y: 0, agent: 'omen', nom: 'Omen', icone: null, joueur: 0, couleur: '#ef4444' },
      { id: 'f', type: 'fleche', points: [0, 0, 100, 0], couleur: '#ef4444', epaisseur: 4, tirets: false, joueur: 0, t0: 2, t1: 6 },
      { id: 's', type: 'capacite', x: 50, y: 0, agent: 'omen', capacite: 'Ability2', nom: 'Smoke', icone: null, joueur: 0, couleur: '#ef4444', zone: null, t: 4 },
      { id: 'o1', type: 'capacite', x: 50, y: 0, agent: 'omen', capacite: 'Ability1', nom: 'A', icone: null, joueur: 0, couleur: '#ef4444', zone: null, ordre: 1 },
      { id: 'o2', type: 'capacite', x: 50, y: 0, agent: 'omen', capacite: 'Ability1', nom: 'B', icone: null, joueur: 0, couleur: '#ef4444', zone: null, ordre: 2 },
    ],
  };
  it('les utilitaires apparaissent à leur minutage (ou selon leur ordre), le pion suit son trajet', () => {
    expect(momentObjet(etape.objets[2], etape)).toBe(4);
    expect(momentObjet(etape.objets[3], etape)).toBe(0);
    expect(momentObjet(etape.objets[4], etape)).toBe(4);
    let e = etatLecture(etape, 1);
    expect([...e.visibles].sort()).toEqual(['a', 'o1']);
    e = etatLecture(etape, 4);
    expect(e.visibles.has('s')).toBe(true);
    expect(e.progression.get('f')).toBeCloseTo(0.5);
    expect(e.positions.get(0)).toEqual({ x: 50, y: 0 });
    expect(etatLecture(etape, 9).positions.get(0)).toEqual({ x: 100, y: 0 });
  });
  it('point sur un tracé et tracé partiel', () => {
    expect(pointSurTrace([0, 0, 100, 0, 100, 100], 0.75)).toEqual({ x: 100, y: 50 });
    expect(tracePartiel([0, 0, 100, 0, 100, 100], 0.25)).toEqual([0, 0, 50, 0]);
    expect(tracePartiel([0, 0, 100, 0], 1)).toEqual([0, 0, 100, 0]);
  });
});
