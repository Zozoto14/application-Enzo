/**
 * Gestes de l'éditeur de strats : pose « cliquer-glisser » (appui = origine, glisser = direction et longueur),
 * poignées (tourner autour de l'origine, longueur bornée à la longueur réelle, Maj : 15°), murs (deux
 * extrémités, milieu courbable, tracé point par point de High Tide, mur double de Fast Lane).
 */

import type { CapaciteJeu } from '../jeux/api';
import type { ObjetCapacite, ObjetStrat, Zone } from './document';
import { angleAimante, decalerTrace, limiterTrace, longueurMax, longueurTrace, poignees, primitiveZone, simplifierTrace, tirerPoigneeObjet, zoneVisee } from './geometrie';
import { DISTANCE_REGARD, avecChamps, debuterVisee, estGlisse, poigneesObjet, poseCapacite, posePion, poseVision, suivreVisee, tirerPoigneeDe } from './pose';

const cap = (champs: Partial<CapaciteJeu>): CapaciteJeu => ({ cle: 'x', nom: 'X', touche: 'E', categorie: 'basique', forme: 'cercle', aVerifier: true, ...champs });
const VIPER: CapaciteJeu = cap({ nom: 'Toxic Screen', forme: 'mur', longueur: 60, largeur: 1 });
const HIGH_TIDE: CapaciteJeu = cap({ nom: 'High Tide', forme: 'mur', longueur: 60, largeur: 1.5, courbable: true });
const FLASH: CapaciteJeu = cap({ nom: 'Flashpoint', forme: 'cone', ouverture: 120, portee: 12 });
const mur = (champs: Partial<Extract<Zone, { forme: 'mur' }>> = {}): Extract<Zone, { forme: 'mur' }> => ({ forme: 'mur', angle: 0, longueur: 20, largeur: 1, courbure: 0, ...champs });
const capacite = (zone: Zone, champs: Partial<ObjetCapacite> = {}): ObjetCapacite => ({ id: 'c1', type: 'capacite', x: 100, y: 100, agent: 'viper', capacite: 'Ability2', nom: 'Toxic Screen', icone: null, joueur: 0, couleur: '#22c55e', zone, ...champs });

/** Geste complet : appui en a, passage par les points, relâché en b. */
function geste(a: { x: number; y: number }, b: { x: number; y: number }, passage: Array<{ x: number; y: number }> = []) {
  let v = debuterVisee(a);
  for (const p of [...passage, b]) v = suivreVisee(v, p, 1);
  return v;
}

describe('pose cliquer-glisser (drag-to-aim)', () => {
  it('un simple appui n’est pas un glisser ; au-delà du seuil, oui', () => {
    expect(estGlisse(geste({ x: 0, y: 0 }, { x: 3, y: 4 }), 8)).toBe(false);
    expect(estGlisse(geste({ x: 0, y: 0 }, { x: 30, y: 40 }), 8)).toBe(true);
  });

  it('cône (flash) : posé à l’appui, orienté vers le relâché, portée = distance bornée à la portée réelle', () => {
    const z: Zone = { forme: 'cone', angle: -90, ouverture: 120, portee: 12 };
    const court = poseCapacite(geste({ x: 100, y: 100 }, { x: 100, y: 150 }), z, 10, FLASH);
    expect(court).toEqual({ x: 100, y: 100, zone: { ...z, angle: 90, portee: 5 } });
    const loin = poseCapacite(geste({ x: 100, y: 100 }, { x: 900, y: 100 }), z, 10, FLASH);
    expect(loin.zone).toEqual({ ...z, angle: 0, portee: 12 });
  });

  it('mur droit (Viper) : de l’appui au relâché, longueur bornée à 60 m', () => {
    const r = poseCapacite(geste({ x: 0, y: 0 }, { x: 300, y: 400 }), mur({ longueur: 60 }), 10, VIPER);
    expect(r.x).toBe(0);
    expect(r.zone).toMatchObject({ forme: 'mur', longueur: 50, angle: 53.1 });
    const borne = poseCapacite(geste({ x: 0, y: 0 }, { x: 1000, y: 0 }), mur({ longueur: 60 }), 10, VIPER);
    expect(borne.zone).toMatchObject({ longueur: 60, angle: 0 });
    expect((borne.zone as { trace?: number[] }).trace).toBeUndefined();
  });

  it('mur courbable (High Tide) : suit le chemin parcouru (tracé simplifié, en mètres), coupé à la longueur réelle', () => {
    const passage = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: Math.round(Math.sin(i / 3) * 60) }));
    const r = poseCapacite(geste({ x: 0, y: 0 }, { x: 200, y: 0 }, passage), mur({ longueur: 60, largeur: 1.5 }), 10, HIGH_TIDE);
    const z = r.zone as Extract<Zone, { forme: 'mur' }>;
    expect(z.trace?.length).toBeGreaterThanOrEqual(4);
    expect(z.trace!.length / 2).toBeLessThanOrEqual(15);
    expect(z.longueur).toBeLessThanOrEqual(60);
    expect(Math.abs(longueurTrace([0, 0, ...z.trace!]) - z.longueur)).toBeLessThan(0.5);
    // Chemin presque droit : mur droit.
    const droit = poseCapacite(geste({ x: 0, y: 0 }, { x: 300, y: 0 }, [{ x: 100, y: 1 }, { x: 200, y: -1 }]), mur({ longueur: 60 }), 10, HIGH_TIDE);
    expect((droit.zone as { trace?: number[] }).trace).toBeUndefined();
  });

  it('trajet (recon, dard) : lancé depuis l’appui, posé au relâché ; cercle : posé au relâché', () => {
    expect(poseCapacite(geste({ x: 100, y: 100 }, { x: 400, y: 500 }), { forme: 'trajet', dx: 0, dy: 0, rayon: 30 }, 10, undefined)).toEqual({ x: 400, y: 500, zone: { forme: 'trajet', dx: -300, dy: -400, rayon: 30 } });
    expect(poseCapacite(geste({ x: 100, y: 100 }, { x: 140, y: 100 }), { forme: 'cercle', rayon: 4.1 }, 10, undefined)).toEqual({ x: 140, y: 100, zone: { forme: 'cercle', rayon: 4.1 } });
  });

  it('Maj : angle aimanté à 15°', () => {
    const v = geste({ x: 0, y: 0 }, { x: 100, y: 22 });
    expect(poseCapacite(v, { forme: 'ligne', angle: 0, longueur: 8 }, 10, undefined, true).zone).toMatchObject({ angle: 15 });
    expect(posePion(v, true)).toEqual({ x: 0, y: 0, angle: 15 });
    expect(angleAimante(-97)).toBe(-90);
  });

  it('cône de vision et regard d’un pion', () => {
    expect(poseVision(geste({ x: 0, y: 0 }, { x: 0, y: -300 }), 10)).toEqual({ x: 0, y: 0, angle: -90, portee: 30 });
    expect(posePion(geste({ x: 50, y: 50 }, { x: 150, y: 50 }))).toEqual({ x: 50, y: 50, angle: 0 });
  });
});

describe('poignées : rotation autour de l’origine, longueur bornée', () => {
  it('cône : la poignée tourne et allonge jusqu’à la portée réelle, pas au-delà', () => {
    const o = capacite({ forme: 'cone', angle: 0, ouverture: 120, portee: 5 }, { agent: 'breach', capacite: 'Ability1' });
    const tourne = tirerPoigneeDe(o, 'fin', { x: 100, y: 180 }, 10, FLASH);
    expect(tourne).toEqual({ zone: { forme: 'cone', angle: 90, ouverture: 120, portee: 8 } });
    const trop = tirerPoigneeDe(o, 'fin', { x: 100, y: 900 }, 10, FLASH);
    expect(trop).toEqual({ zone: { forme: 'cone', angle: 90, ouverture: 120, portee: 12 } });
    // La poignée replacée sur la forme bornée (elle colle au doigt sans dépasser).
    const h = poigneesObjet(avecChamps(o, trop), 10).find(x => x.cle === 'fin');
    expect(h?.y).toBeCloseTo(220);
  });

  it('mur : deux extrémités déplaçables ; la première bouge le point de pose, l’autre reste ; longueur bornée', () => {
    const o = capacite(mur({ longueur: 20 }));
    expect(poigneesObjet(o, 10).map(h => h.cle)).toEqual(['debut', 'fin', 'courbe']);
    const fin = tirerPoigneeDe(o, 'fin', { x: 100, y: 400 }, 10, VIPER);
    expect(fin).toEqual({ zone: { ...mur(), angle: 90, longueur: 30 } });
    const debut = tirerPoigneeDe(o, 'debut', { x: 0, y: 100 }, 10, VIPER) as { x: number; y: number; zone: Zone };
    expect(debut.x).toBe(0);
    expect(debut.zone).toMatchObject({ angle: 0, longueur: 30 });
    // L'autre extrémité n'a pas bougé : (300, 100).
    const p = primitiveZone(debut.x, debut.y, debut.zone, 10) as { points: number[] };
    expect(p.points.slice(-2)).toEqual([300, 100]);
    const borne = tirerPoigneeObjet(100, 100, mur({ longueur: 20 }), 'debut', -2000, 100, 10, { max: 60 });
    expect(borne.zone).toMatchObject({ longueur: 60 });
    expect(borne.x).toBe(-300);
  });

  it('mur courbable : la poignée du milieu courbe ; non courbable : elle ne fait rien', () => {
    const o = capacite(mur({ longueur: 20 }), { agent: 'phoenix' });
    expect(tirerPoigneeDe(o, 'courbe', { x: 200, y: 150 }, 10, cap({ forme: 'mur', longueur: 18, courbable: true }))).toEqual({ zone: { ...mur(), courbure: 0.5 } });
    expect(tirerPoigneeDe(o, 'courbe', { x: 200, y: 150 }, 10, VIPER)).toEqual({ zone: mur() });
  });

  it('mur tracé : une poignée par point, le point suit le doigt, tracé recoupé à la longueur réelle', () => {
    const z = mur({ longueur: 30, trace: [10, 0, 20, 0, 30, 0] });
    const o = capacite(z, { agent: 'harbor' });
    expect(poigneesObjet(o, 10).map(h => h.cle)).toEqual(['debut', 'p0', 'p1', 'p2']);
    const r = tirerPoigneeDe(o, 'p1', { x: 300, y: 200 }, 10, HIGH_TIDE) as { zone: Extract<Zone, { forme: 'mur' }> };
    expect(r.zone.trace?.slice(0, 4)).toEqual([10, 0, 20, 10]);
    expect(r.zone.longueur).toBeCloseTo(longueurTrace([0, 0, ...r.zone.trace!]), 0);
    const court = tirerPoigneeObjet(100, 100, z, 'p2', 2000, 100, 10, { max: 40 });
    expect((court.zone as { longueur: number }).longueur).toBeLessThanOrEqual(40);
    expect((court.zone as { trace: number[] }).trace).toHaveLength(6);
  });

  it('pion : la poignée de regard tourne autour du pion ; vision : angle et portée', () => {
    const pion: ObjetStrat = { id: 'a', type: 'agent', x: 0, y: 0, agent: 'jett', nom: 'Jett', icone: null, joueur: 0, couleur: '#fff' };
    expect(poigneesObjet(pion, 10)).toEqual([{ cle: 'regard', x: expect.closeTo(0) as unknown as number, y: -DISTANCE_REGARD }]);
    expect(tirerPoigneeDe(pion, 'regard', { x: -10, y: 0 }, 10)).toEqual({ angle: 180 });
    expect(tirerPoigneeDe(pion, 'regard', { x: 100, y: 27 }, 10, undefined, true)).toEqual({ angle: 15 });
    const vision: ObjetStrat = { id: 'v', type: 'vision', x: 0, y: 0, angle: 0, ouverture: 90, portee: 30, joueur: 0, couleur: '#fff' };
    expect(tirerPoigneeDe(vision, 'fin', { x: 0, y: 200 }, 10)).toEqual({ angle: 90, portee: 20 });
  });
});

describe('tracés et longueurs réelles', () => {
  it('longueur maximale d’après les caractéristiques', () => {
    expect(longueurMax(VIPER)).toBe(60);
    expect(longueurMax(FLASH)).toBe(12);
    expect(longueurMax(cap({ forme: 'cercle', rayon: 4.1 }))).toBe(4.1);
    expect(longueurMax(cap({ forme: 'trajet' }))).toBeUndefined();
    expect(longueurMax(undefined)).toBeUndefined();
  });
  it('limiter, simplifier, décaler un tracé', () => {
    expect(limiterTrace([0, 0, 10, 0, 20, 0], 15)).toEqual([0, 0, 10, 0, 15, 0]);
    expect(simplifierTrace([0, 0, 5, 0.1, 10, 0, 10, 10], 1)).toEqual([0, 0, 10, 0, 10, 10]);
    expect(decalerTrace([0, 0, 10, 0], 2)).toEqual([0, 2, 10, 2]);
  });
  it('mur double (Fast Lane) : deux lignes écartées de la largeur ; mur tracé : polyligne à l’échelle', () => {
    expect(primitiveZone(0, 0, mur({ largeur: 4.5, double: true }), 10)).toMatchObject({ type: 'trait', double: 45 });
    expect(primitiveZone(100, 100, mur({ trace: [10, 0, 10, 10] }), 10)).toMatchObject({ type: 'trait', points: [100, 100, 200, 100, 200, 200], courbe: true });
    expect(poignees(0, 0, mur({ trace: [1, 0] }), 10).map(h => h.cle)).toEqual(['debut', 'p0']);
    expect(zoneVisee(null, { x: 0, y: 0 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, zone: null });
  });
});
