import {
  MAX_ONGLETS,
  ONGLETS_VIDES,
  RATIO_MAX,
  RATIO_MIN,
  activer,
  affichage,
  afficherACote,
  borneRatio,
  deplacer,
  echanger,
  fermer,
  filtrer,
  ouvrir,
  parRang,
  quitterCote,
  redimensionner,
  restaurer,
  serialiser,
  voisin,
  type EtatOnglets,
} from './onglets';

const ouvrirTout = (ids: string[], depart: EtatOnglets = ONGLETS_VIDES) => ids.reduce((etat, id) => ouvrir(etat, id).etat, depart);

describe('onglets d’apps : ouvrir, passer de l’une à l’autre, fermer', () => {
  it('ouvrir une app depuis une tuile l’ajoute à la barre et l’affiche', () => {
    const { etat, limite } = ouvrir(ONGLETS_VIDES, 'portefeuille');
    expect(limite).toBe(false);
    expect(etat.ouverts).toEqual(['portefeuille']);
    expect(etat.actif).toBe('portefeuille');
  });

  it('rouvrir une app déjà ouverte l’affiche, sans doublon', () => {
    const etat = ouvrir(activer(ouvrirTout(['portefeuille', 'taches']), undefined), 'portefeuille').etat;
    expect(etat.ouverts).toEqual(['portefeuille', 'taches']);
    expect(etat.actif).toBe('portefeuille');
  });

  it('un nouvel onglet se place juste après l’onglet actif (comme un navigateur)', () => {
    let etat = ouvrirTout(['a', 'b', 'c']);
    etat = activer(etat, 'a');
    etat = ouvrir(etat, 'd').etat;
    expect(etat.ouverts).toEqual(['a', 'd', 'b', 'c']);
  });

  it('« ouvrir dans un nouvel onglet » ne quitte pas l’écran actuel', () => {
    const surHub = ouvrir(ONGLETS_VIDES, 'taches', { arrierePlan: true }).etat;
    expect(surHub.ouverts).toEqual(['taches']);
    expect(surHub.actif).toBeUndefined();
    const dansUneApp = ouvrir(ouvrirTout(['portefeuille']), 'tsuzuku', { arrierePlan: true }).etat;
    expect(dansUneApp.actif).toBe('portefeuille');
    expect(dansUneApp.ouverts).toEqual(['portefeuille', 'tsuzuku']);
  });

  it(`${MAX_ONGLETS} onglets au plus : au-delà, rien ne change et la limite est signalée`, () => {
    const plein = ouvrirTout(Array.from({ length: MAX_ONGLETS }, (_, i) => `app-${i}`));
    expect(plein.ouverts).toHaveLength(MAX_ONGLETS);
    const { etat, limite } = ouvrir(plein, 'une-de-trop');
    expect(limite).toBe(true);
    expect(etat).toBe(plein);
    // Une app déjà ouverte reste accessible même à la limite.
    expect(ouvrir(plein, 'app-0').limite).toBe(false);
  });

  it('refuse un identifiant invalide', () => {
    expect(ouvrir(ONGLETS_VIDES, '../admin').etat).toBe(ONGLETS_VIDES);
    expect(ouvrir(ONGLETS_VIDES, 'Majuscules').etat).toBe(ONGLETS_VIDES);
  });

  it('fermer l’onglet affiché montre son voisin de droite, sinon de gauche, sinon le hub', () => {
    let etat = activer(ouvrirTout(['a', 'b', 'c']), 'b');
    etat = fermer(etat, 'b');
    expect(etat.ouverts).toEqual(['a', 'c']);
    expect(etat.actif).toBe('c');
    etat = fermer(etat, 'c');
    expect(etat.actif).toBe('a');
    etat = fermer(etat, 'a');
    expect(etat.actif).toBeUndefined();
    expect(etat.ouverts).toEqual([]);
  });

  it('fermer un onglet en arrière-plan ne change pas l’onglet affiché', () => {
    const etat = fermer(activer(ouvrirTout(['a', 'b', 'c']), 'a'), 'c');
    expect(etat.actif).toBe('a');
    expect(etat.ouverts).toEqual(['a', 'b']);
  });

  it('Ctrl+Tab / Ctrl+Maj+Tab : suivant, précédent, en boucle ; depuis le hub, le premier ou le dernier', () => {
    const base = activer(ouvrirTout(['a', 'b', 'c']), undefined);
    expect(voisin(base, 1).actif).toBe('a');
    expect(voisin(base, -1).actif).toBe('c');
    const surC = activer(base, 'c');
    expect(voisin(surC, 1).actif).toBe('a');
    expect(voisin(activer(base, 'a'), -1).actif).toBe('c');
    expect(voisin(ONGLETS_VIDES, 1)).toBe(ONGLETS_VIDES);
  });

  it('Ctrl+1…8 : l’onglet de ce rang ; Ctrl+9 : le dernier ; hors limites : rien', () => {
    const etat = activer(ouvrirTout(['a', 'b', 'c']), undefined);
    expect(parRang(etat, 2).actif).toBe('b');
    expect(parRang(etat, 9).actif).toBe('c');
    expect(parRang(etat, 5)).toBe(etat);
    expect(parRang(etat, 0)).toBe(etat);
  });

  it('déplacer un onglet dans la barre', () => {
    const etat = ouvrirTout(['a', 'b', 'c']);
    expect(deplacer(etat, 'a', 2).ouverts).toEqual(['b', 'c', 'a']);
    expect(deplacer(etat, 'a', -1)).toBe(etat);
  });
});

describe('côte à côte', () => {
  const deux = () => afficherACote(activer(ouvrirTout(['portefeuille', 'taches', 'claude-office']), 'taches'), 'claude-office');

  it('« Afficher à côté » met l’onglet à droite de l’onglet actif', () => {
    const etat = deux();
    expect(etat.actif).toBe('taches');
    expect(etat.cote).toBe('claude-office');
    expect(affichage(etat, true)).toEqual({ gauche: 'taches', droite: 'claude-office', ratio: 0.5 });
  });

  it('écran étroit (téléphone) : un seul onglet, jamais deux', () => {
    expect(affichage(deux(), false)).toEqual({ gauche: 'taches', ratio: 1 });
  });

  it('sur le hub, « afficher à côté » ouvre simplement l’onglet', () => {
    const etat = afficherACote(activer(ouvrirTout(['a', 'b']), undefined), 'b');
    expect(etat.actif).toBe('b');
    expect(etat.cote).toBeUndefined();
  });

  it('échanger les côtés garde la largeur de chaque app', () => {
    const etat = echanger(redimensionner(deux(), 0.3));
    expect(etat.actif).toBe('claude-office');
    expect(etat.cote).toBe('taches');
    expect(etat.ratio).toBeCloseTo(0.7);
  });

  it('fermer un côté : l’onglet reste ouvert, l’autre côté prend la place', () => {
    const droite = quitterCote(deux(), 'droite');
    expect(droite.cote).toBeUndefined();
    expect(droite.actif).toBe('taches');
    expect(droite.ouverts).toContain('claude-office');
    const gauche = quitterCote(deux(), 'gauche');
    expect(gauche.actif).toBe('claude-office');
    expect(gauche.cote).toBeUndefined();
    expect(gauche.ouverts).toContain('taches');
  });

  it('choisir l’onglet de droite échange les côtés ; revenir au hub quitte le côte à côte', () => {
    const etat = activer(deux(), 'claude-office');
    expect(etat.actif).toBe('claude-office');
    expect(etat.cote).toBe('taches');
    const hub = activer(deux(), undefined);
    expect(hub.actif).toBeUndefined();
    expect(hub.cote).toBeUndefined();
  });

  it('fermer l’onglet de gauche : la droite prend toute la place', () => {
    const etat = fermer(deux(), 'taches');
    expect(etat.actif).toBe('claude-office');
    expect(etat.cote).toBeUndefined();
  });

  it('la séparation reste dans ses bornes (et laisse 420 px à chaque côté)', () => {
    expect(borneRatio(0.05)).toBe(RATIO_MIN);
    expect(borneRatio(0.99)).toBe(RATIO_MAX);
    expect(borneRatio(Number.NaN)).toBe(0.5);
    expect(borneRatio(0.25, 1280)).toBeCloseTo(420 / 1280);
    expect(redimensionner(deux(), 0.62).ratio).toBe(0.62);
  });
});

describe('droits et mémoire de l’appareil', () => {
  it('une app que le profil ne peut plus ouvrir perd son onglet', () => {
    const etat = afficherACote(activer(ouvrirTout(['portefeuille', 'administration', 'taches']), 'administration'), 'taches');
    const filtre = filtrer(etat, id => id !== 'administration');
    expect(filtre.ouverts).toEqual(['portefeuille', 'taches']);
    expect(filtre.actif).toBe('taches');
    expect(filtre.cote).toBeUndefined();
    // Rien à retirer : le même état (pas de rendu inutile).
    expect(filtrer(filtre, () => true)).toBe(filtre);
  });

  it('restaurés au redémarrage : la liste et la séparation, sur le hub', () => {
    const etat = redimensionner(afficherACote(activer(ouvrirTout(['portefeuille', 'taches']), 'taches'), 'portefeuille'), 0.6);
    const restaure = restaurer(serialiser(etat));
    expect(restaure.ouverts).toEqual(['portefeuille', 'taches']);
    expect(restaure.actif).toBeUndefined();
    expect(restaure.cote).toBeUndefined();
    expect(restaure.ratio).toBe(0.6);
  });

  it('restauration : droits revérifiés, valeurs illisibles ou retouchées écartées', () => {
    expect(restaurer(JSON.stringify({ v: 1, ouverts: ['portefeuille', 'administration'] }), id => id !== 'administration').ouverts).toEqual(['portefeuille']);
    expect(restaurer(JSON.stringify({ v: 1, ouverts: ['a', 'a', '../x', 42, 'b'] })).ouverts).toEqual(['a', 'b']);
    expect(restaurer(JSON.stringify({ v: 1, ouverts: Array.from({ length: 20 }, (_, i) => `x${i}`) })).ouverts).toHaveLength(MAX_ONGLETS);
    expect(restaurer('{pas du json')).toBe(ONGLETS_VIDES);
    expect(restaurer(JSON.stringify({ v: 2, ouverts: ['a'] }))).toBe(ONGLETS_VIDES);
    expect(restaurer(null)).toBe(ONGLETS_VIDES);
    expect(restaurer(JSON.stringify({ v: 1, ouverts: ['a'], ratio: 3 })).ratio).toBe(RATIO_MAX);
  });
});
