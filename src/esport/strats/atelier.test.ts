/**
 * Logique pure de l'atelier de strats : actions de lot (sélection multiple), verrou d'objet, ordre de dessin,
 * copie vers une autre étape, reprise d'une étape (pions à leur dernière position), cadrage de la map dans le
 * canevas, lecture enchaînée (les pions glissent d'une étape à la suivante), vie d'une capacité, sélection au
 * cadre, aligner / répartir, tracés lissés.
 */

import { appliquer, documentVide, lireDocument, pionsFinaux, serialiser, type DocumentStrat, type ObjetAgent, type ObjetStrat } from './document';
import { SANS_MARGE, aligner, ancre, boiteObjet, cadrage, departsDepuis, etatLecture, interpoler, jalons, lisserTrace, objetsDansRectangle, rectangle, repartir, rubanEffile, sensFinal } from './geometrie';

const ASCENT = { cle: 'ascent', nom: 'Ascent', image: null };
const pion = (id: string, x: number, y: number, joueur: number | null = 0, plus: Partial<ObjetAgent> = {}): ObjetAgent => ({ id, type: 'agent', x, y, agent: 'jett', nom: 'Jett', icone: null, joueur, couleur: '#22c55e', ...plus });
const fumee = (id: string, x: number, y: number, plus: Record<string, unknown> = {}): ObjetStrat => ({ id, type: 'capacite', x, y, agent: 'omen', capacite: 'Ability2', nom: 'Dark Cover', icone: null, joueur: 1, couleur: '#3b82f6', zone: { forme: 'cercle', rayon: 4.1 }, ...plus }) as ObjetStrat;
const fleche = (id: string, points: number[], joueur: number | null = 0, plus: Record<string, unknown> = {}): ObjetStrat => ({ id, type: 'fleche', points, couleur: '#22c55e', epaisseur: 5, tirets: false, joueur, ...plus }) as ObjetStrat;

function documentAvec(...objets: ObjetStrat[]): DocumentStrat {
  let d = documentVide(ASCENT, 'attaque', 'valorant', 'valorant');
  for (const objet of objets) d = appliquer(d, { type: 'ajouter', etape: 0, objet });
  return d;
}
const ids = (d: DocumentStrat, etape = 0) => d.etapes[etape].objets.map(o => o.id);
const positions = (d: DocumentStrat, etape = 0) => Object.fromEntries(d.etapes[etape].objets.map(o => [o.id, 'x' in o ? [o.x, o.y] : o.points]));

describe('actions de lot (sélection multiple)', () => {
  it('supprimer, déplacer et modifier plusieurs objets : une seule action, les objets figés restent', () => {
    let d = documentAvec(pion('a', 100, 100), pion('b', 200, 100, 1), fumee('c', 300, 300));
    d = appliquer(d, { type: 'verrouiller', etape: 0, ids: ['b'], verrou: true });
    expect(d.etapes[0].objets[1]).toMatchObject({ id: 'b', verrou: true });
    const bouge = appliquer(d, { type: 'deplacerLot', etape: 0, ids: ['a', 'b', 'c'], dx: 10, dy: -5 });
    expect(positions(bouge)).toEqual({ a: [110, 95], b: [200, 100], c: [310, 295] });
    const modifie = appliquer(d, { type: 'modifierLot', etape: 0, ids: ['a', 'b', 'c'], champs: { niveau: 2 } });
    expect(modifie.etapes[0].objets.map(o => o.niveau)).toEqual([2, undefined, 2]);
    const supprime = appliquer(d, { type: 'supprimerLot', etape: 0, ids: ['a', 'b', 'c'] });
    expect(ids(supprime)).toEqual(['b']);
    // Rien à faire : le MÊME document (pas d'entrée vide dans l'historique).
    expect(appliquer(d, { type: 'supprimerLot', etape: 0, ids: ['b', 'zzz'] })).toBe(d);
    expect(appliquer(d, { type: 'deplacerLot', etape: 0, ids: ['a'], dx: 0, dy: 0 })).toBe(d);
    expect(appliquer(d, { type: 'modifierLot', etape: 0, ids: ['a'], champs: {} })).toBe(d);
  });

  it('décaler chaque objet de son propre vecteur (aligner, répartir)', () => {
    const d = documentAvec(pion('a', 100, 100), pion('b', 200, 140, 1), fleche('f', [0, 0, 50, 50], null));
    const r = appliquer(d, { type: 'decaler', etape: 0, deplacements: [{ id: 'a', dx: 5, dy: 0 }, { id: 'f', dx: 0, dy: 10 }, { id: 'b', dx: 0, dy: 0 }] });
    expect(positions(r)).toEqual({ a: [105, 100], b: [200, 140], f: [0, 10, 50, 60] });
  });

  it('verrou d’objet : posé puis retiré ; un objet verrouillé ne se supprime ni ne se déplace', () => {
    let d = documentAvec(pion('a', 100, 100));
    d = appliquer(d, { type: 'verrouiller', etape: 0, ids: ['a'], verrou: true });
    expect(appliquer(d, { type: 'verrouiller', etape: 0, ids: ['a'], verrou: true })).toBe(d);
    expect(appliquer(d, { type: 'supprimer', etape: 0, id: 'a' })).toBe(d);
    expect(appliquer(d, { type: 'deplacer', etape: 0, id: 'a', dx: 4, dy: 4 })).toBe(d);
    expect(ids(appliquer(d, { type: 'vider', etape: 0 }))).toEqual(['a']);
    d = appliquer(d, { type: 'verrouiller', etape: 0, ids: ['a'], verrou: false });
    expect('verrou' in d.etapes[0].objets[0]).toBe(false);
    expect(ids(appliquer(d, { type: 'supprimer', etape: 0, id: 'a' }))).toEqual([]);
  });

  it('premier plan / arrière-plan : ordre de dessin', () => {
    const d = documentAvec(pion('a', 1, 1), pion('b', 2, 2, 1), pion('c', 3, 3, 2));
    expect(ids(appliquer(d, { type: 'ordonner', etape: 0, ids: ['a'], vers: 'avant' }))).toEqual(['b', 'c', 'a']);
    expect(ids(appliquer(d, { type: 'ordonner', etape: 0, ids: ['c', 'b'], vers: 'arriere' }))).toEqual(['b', 'c', 'a']);
    expect(appliquer(d, { type: 'ordonner', etape: 0, ids: ['c'], vers: 'avant' })).toBe(d);
    expect(appliquer(d, { type: 'ordonner', etape: 0, ids: ['a', 'b', 'c'], vers: 'avant' })).toBe(d);
  });

  it('copier vers l’étape suivante : même place, nouveaux identifiants, sans le verrou', () => {
    let d = documentAvec(pion('a', 100, 100), fumee('c', 300, 300));
    d = appliquer(d, { type: 'verrouiller', etape: 0, ids: ['c'], verrou: true });
    d = appliquer(d, { type: 'ajouterEtape', apres: 0 });
    const r = appliquer(d, { type: 'copierVers', de: 0, vers: 1, ids: ['c'] });
    expect(r.etapes[1].objets).toHaveLength(1);
    const copie = r.etapes[1].objets[0];
    expect(copie).toMatchObject({ type: 'capacite', x: 300, y: 300 });
    expect(copie.id).not.toBe('c');
    expect(copie.verrou).toBeUndefined();
    expect(appliquer(d, { type: 'copierVers', de: 0, vers: 0, ids: ['c'] })).toBe(d);
    expect(appliquer(d, { type: 'copierVers', de: 0, vers: 1, ids: ['zzz'] })).toBe(d);
  });

  it('couleurs des capacités : par joueur (défaut, non écrit) ou par agent ; champs nouveaux gardés à la relecture', () => {
    let d = documentAvec(fumee('c', 300, 300, { creux: true }), fleche('f', [0, 0, 10, 10], 0, { usage: 'regard' }));
    expect(appliquer(d, { type: 'couleurs', couleurs: 'joueur' })).toBe(d);
    d = appliquer(d, { type: 'couleurs', couleurs: 'agent' });
    d = appliquer(d, { type: 'verrouiller', etape: 0, ids: ['f'], verrou: true });
    const relu = lireDocument(JSON.parse(serialiser(d)), 'valorant');
    expect(relu.couleurs).toBe('agent');
    expect(relu.etapes[0].objets[0]).toMatchObject({ creux: true });
    expect(relu.etapes[0].objets[1]).toMatchObject({ usage: 'regard', verrou: true });
    expect(lireDocument(JSON.parse(serialiser(appliquer(d, { type: 'couleurs', couleurs: 'joueur' }))), 'valorant').couleurs).toBeUndefined();
  });
});

describe('reprise d’une étape : les pions à leur dernière position', () => {
  it('position finale = bout du dernier trajet du joueur ; le pion regarde dans le sens de son arrivée', () => {
    const d = documentAvec(
      pion('a', 100, 100, 0, { angle: 90 }),
      pion('b', 500, 500, 1),
      pion('ennemi', 800, 800, null),
      fleche('f1', [100, 100, 200, 100], 0, { t0: 0, t1: 2 }),
      fleche('f2', [200, 100, 200, 300], 0, { t0: 2, t1: 4 }),
      fumee('c', 300, 300),
    );
    const finaux = pionsFinaux(d.etapes[0]);
    expect(finaux.map(o => [o.id, o.x, o.y])).toEqual([
      ['a', 200, 300],
      ['b', 500, 500],
      ['ennemi', 800, 800],
    ]);
    // Arrivée vers le bas : regard à 90°. Le pion sans regard n'en reçoit pas.
    expect(finaux[0].angle).toBe(90);
    expect(finaux[1].angle).toBeUndefined();
  });

  it('nouvelle étape avec reprise : pions seulement (pas les utilitaires ni les flèches), nouveaux identifiants ; sans reprise : vide', () => {
    const d = documentAvec(pion('a', 100, 100), pion('b', 500, 500, 1), fleche('f', [100, 100, 300, 100], 0), fumee('c', 300, 300));
    const avec = appliquer(d, { type: 'ajouterEtape', apres: 0, reprise: true });
    expect(avec.etapes).toHaveLength(2);
    expect(avec.etapes[1].objets.map(o => [o.type, (o as ObjetAgent).x, (o as ObjetAgent).y])).toEqual([
      ['agent', 300, 100],
      ['agent', 500, 500],
    ]);
    const tous = avec.etapes.flatMap(e => e.objets.map(o => o.id));
    expect(new Set(tous).size).toBe(tous.length);
    // L'étape d'origine n'est pas touchée.
    expect(avec.etapes[0]).toBe(d.etapes[0]);
    expect(appliquer(d, { type: 'ajouterEtape', apres: 0 }).etapes[1].objets).toEqual([]);
  });

  it('second pion du même joueur (doublon) : il ne suit pas le trajet', () => {
    const d = documentAvec(pion('a', 100, 100), pion('a2', 150, 150), fleche('f', [100, 100, 300, 100], 0));
    expect(pionsFinaux(d.etapes[0]).map(o => [o.id, o.x, o.y])).toEqual([
      ['a', 300, 100],
      ['a2', 150, 150],
    ]);
  });
});

describe('cadrage de la map dans le canevas', () => {
  it('la map entière tient dans la place laissée par l’interface, centrée', () => {
    const c = cadrage(1440, 754, { haut: 58, bas: 4, gauche: 60, droite: 0 });
    // Hauteur utile : 754 − 58 − 4 − 2 × 12 de retrait = 668 px pour 1000 unités.
    expect(c.base).toBeCloseTo(0.668, 3);
    expect(c.dx).toBeCloseTo(60 + (1380 - 668) / 2, 1);
    expect(c.dy).toBeCloseTo(58 + 12, 1);
    // Bords de la map dans la zone libre.
    expect(c.dx).toBeGreaterThanOrEqual(60);
    expect(c.dx + 1000 * c.base).toBeLessThanOrEqual(1440);
    expect(c.dy + 1000 * c.base).toBeLessThanOrEqual(754 - 4);
  });

  it('portrait (tablette, téléphone) : la largeur commande ; carré sans marge : tout le côté moins le retrait', () => {
    const c = cadrage(390, 726, { haut: 58, bas: 4, gauche: 0, droite: 0 });
    expect(c.base).toBeCloseTo((390 - 24) / 1000, 3);
    expect(c.dx).toBeCloseTo(12, 1);
    expect(cadrage(600, 600, SANS_MARGE, 0)).toEqual({ base: 0.6, dx: 0, dy: 0 });
  });

  it('place nulle ou minuscule : jamais d’échelle négative', () => {
    expect(cadrage(0, 0).base).toBeGreaterThan(0);
    expect(cadrage(40, 40, { haut: 60, bas: 60, gauche: 60, droite: 60 }).base).toBeGreaterThan(0);
  });
});

describe('lecture animée', () => {
  const etape = (objets: ObjetStrat[], duree = 4) => ({ id: 'e', titre: '', note: '', phase: null, duree, objets });

  it('interpolation linéaire bornée', () => {
    expect(interpoler({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5)).toEqual({ x: 50, y: 25 });
    expect(interpoler({ x: 0, y: 0 }, { x: 100, y: 50 }, -1)).toEqual({ x: 0, y: 0 });
    expect(interpoler({ x: 0, y: 0 }, { x: 100, y: 50 }, 3)).toEqual({ x: 100, y: 50 });
  });

  it('un pion suit le trajet de son joueur', () => {
    const e = etape([pion('a', 100, 100), fleche('f', [100, 100, 300, 100], 0, { t0: 0, t1: 4 })]);
    expect(etatLecture(e, 0).pions.get('a')).toEqual({ x: 100, y: 100 });
    const milieu = etatLecture(e, 2).pions.get('a') as { x: number; y: number };
    expect(milieu.x).toBeCloseTo(200, 0);
    expect(milieu.y).toBeCloseTo(100, 0);
    expect(etatLecture(e, 4).pions.get('a')).toEqual({ x: 300, y: 100 });
  });

  it('lecture enchaînée : le pion glisse depuis sa position finale de l’étape précédente', () => {
    const avant = etape([pion('a', 100, 100), fleche('f', [100, 100, 300, 100], 0)]);
    const apres = etape([pion('n', 500, 400)]);
    const departs = departsDepuis(avant, apres);
    expect(departs.get('n')).toEqual({ x: 300, y: 100 });
    const debut = etatLecture(apres, 0, { precedente: avant, transition: 0.8 }).pions.get('n') as { x: number; y: number };
    expect(debut).toEqual({ x: 300, y: 100 });
    const milieu = etatLecture(apres, 0.4, { precedente: avant, transition: 0.8 }).pions.get('n') as { x: number; y: number };
    expect(milieu.x).toBeGreaterThan(300);
    expect(milieu.x).toBeLessThan(500);
    expect(etatLecture(apres, 0.8, { precedente: avant, transition: 0.8 }).pions.get('n')).toBeUndefined();
    // Sans étape précédente (ou joueur absent avant) : le pion est à sa place.
    expect(etatLecture(apres, 0).pions.get('n')).toBeUndefined();
    expect(departsDepuis(etape([pion('x', 1, 1, 3)]), apres).size).toBe(0);
  });

  it('vie d’une capacité : déploiement, durée qui s’écoule, fondu à l’expiration', () => {
    const e = etape([fumee('c', 300, 300, { t: 1 })], 10);
    const options = { dureeCapacite: () => 4, deploiement: 0.4, fondu: 0.5 };
    expect(etatLecture(e, 0.5, options).visibles.has('c')).toBe(false);
    const pose = etatLecture(e, 1.2, options).capacites.get('c');
    expect(pose?.deploiement).toBeGreaterThan(0);
    expect(pose?.deploiement).toBeLessThan(1);
    const pleine = etatLecture(e, 3, options).capacites.get('c');
    expect(pleine).toMatchObject({ deploiement: 1, opacite: 1 });
    expect(pleine?.reste).toBeCloseTo(0.5, 2);
    const finissante = etatLecture(e, 5.25, options).capacites.get('c');
    expect(finissante?.reste).toBe(0);
    expect(finissante?.opacite).toBeGreaterThan(0);
    expect(finissante?.opacite).toBeLessThan(1);
    expect(etatLecture(e, 6, options).visibles.has('c')).toBe(false);
    // Durée inconnue : la capacité reste jusqu'à la fin de l'étape, sans anneau.
    expect(etatLecture(e, 9, {}).capacites.get('c')).toMatchObject({ reste: null, opacite: 1 });
  });
});

describe('sélection au cadre, aligner, répartir', () => {
  const objets: ObjetStrat[] = [pion('a', 100, 100), pion('b', 300, 140, 1), pion('c', 620, 200, 2), fleche('f', [50, 50, 150, 150], null), { id: 't', type: 'texte', x: 800, y: 800, texte: 'B', couleur: '#ffffff', taille: 20 }];

  it('cadre tracé dans n’importe quel sens : objets dont l’ancre est dedans', () => {
    expect(rectangle({ x: 400, y: 300 }, { x: 0, y: 0 })).toEqual({ x1: 0, y1: 0, x2: 400, y2: 300 });
    expect(objetsDansRectangle(objets, rectangle({ x: 400, y: 300 }, { x: 0, y: 0 })).sort()).toEqual(['a', 'b', 'f']);
    expect(objetsDansRectangle(objets, rectangle({ x: 700, y: 700 }, { x: 900, y: 900 }))).toEqual(['t']);
    expect(objetsDansRectangle(objets, rectangle({ x: 0, y: 0 }, { x: 5, y: 5 }))).toEqual([]);
  });

  it('ancre et boîte d’un objet (tracé : son milieu et ses extrémités)', () => {
    expect(ancre(objets[0])).toEqual({ x: 100, y: 100 });
    expect(ancre(objets[3])).toEqual({ x: 100, y: 100 });
    expect(boiteObjet(objets[3])).toEqual({ x1: 50, y1: 50, x2: 150, y2: 150 });
  });

  it('aligner à gauche, au centre, en haut : décalages par objet', () => {
    const pions = objets.slice(0, 3);
    const gauche = aligner(pions, 'gauche');
    const apres = (id: string) => {
      const o = pions.find(p => p.id === id) as ObjetAgent;
      const d = gauche.find(x => x.id === id) ?? { dx: 0, dy: 0 };
      return boiteObjet({ ...o, x: o.x + d.dx, y: o.y + d.dy }).x1;
    };
    expect(apres('b')).toBeCloseTo(apres('a'), 5);
    expect(apres('c')).toBeCloseTo(apres('a'), 5);
    expect(gauche.every(d => d.dy === 0)).toBe(true);
    const haut = aligner(pions, 'haut');
    expect(haut.every(d => d.dx === 0)).toBe(true);
    expect(aligner(pions.slice(0, 1), 'centre')).toEqual([]);
  });

  it('répartir : écarts égaux entre le premier et le dernier, qui ne bougent pas', () => {
    const pions = objets.slice(0, 3);
    const d = repartir(pions, 'horizontal');
    const x = (id: string) => (pions.find(p => p.id === id) as ObjetAgent).x + (d.find(v => v.id === id)?.dx ?? 0);
    expect(x('a')).toBe(100);
    expect(x('c')).toBe(620);
    expect(x('b')).toBeCloseTo(360, 5);
    expect(repartir(pions.slice(0, 2), 'horizontal')).toEqual([]);
  });
});

describe('tracés', () => {
  it('lissage : mêmes extrémités, plus de points, aucun point hors de l’enveloppe', () => {
    const brut = [0, 0, 100, 0, 100, 100];
    const lisse = lisserTrace(brut);
    expect(lisse.slice(0, 2)).toEqual([0, 0]);
    expect(lisse.slice(-2)).toEqual([100, 100]);
    expect(lisse.length).toBeGreaterThan(brut.length);
    for (let i = 0; i < lisse.length; i += 2) {
      expect(lisse[i]).toBeGreaterThanOrEqual(0);
      expect(lisse[i]).toBeLessThanOrEqual(100);
    }
    expect(lisserTrace([0, 0, 10, 10])).toEqual([0, 0, 10, 10]);
  });

  it('ruban effilé : polygone fermé autour du tracé, plus large au bout indiqué', () => {
    const ruban = rubanEffile([0, 0, 100, 0], 2, 10);
    expect(ruban.length).toBe(8);
    const ys = ruban.filter((_, i) => i % 2 === 1).map(Math.abs);
    expect(Math.max(...ys)).toBeCloseTo(5, 5);
    expect(Math.min(...ys)).toBeCloseTo(1, 5);
  });

  it('jalons le long du tracé (sens de marche) et sens final', () => {
    const j = jalons([0, 0, 100, 0], 25);
    expect(j.length).toBeGreaterThanOrEqual(3);
    expect(j.every(p => p.angle === 0 && p.y === 0)).toBe(true);
    expect(j.every((p, i) => i === 0 || p.x > j[i - 1].x)).toBe(true);
    expect(sensFinal([0, 0, 0, 50])).toBe(90);
    expect(sensFinal([0, 0, 10, 0, 10, -30])).toBe(-90);
  });
});
