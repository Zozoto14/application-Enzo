/**
 * Logique pure de l'éditeur de strats : modèle de document, actions,
 * annuler / rétablir, étapes, calques, sérialisation, migration de version,
 * taille, zoom.
 */

import {
  ETAPES_MAX,
  LIMITE_HISTORIQUE,
  VERSION_DOCUMENT,
  annuler,
  appliquer,
  calqueDe,
  documentVide,
  executer,
  historique,
  idUnique,
  lireDocument,
  octetsUtf8,
  retablir,
  serialiser,
  tailleDocument,
  zoneDepuisV2,
  zoneParDefaut,
  zoomer,
  ordreUtilitaires,
  prochainOrdre,
  COULEURS_JOUEURS,
  type DocumentStrat,
  type ObjetCapacite,
  type ObjetStrat,
} from './document';

const ASCENT = { cle: 'ascent', nom: 'Ascent', image: null, echelle: null };
const agent = (id: string, x = 100, y = 100): ObjetStrat => ({ id, type: 'agent', x, y, agent: 'omen', nom: 'Omen', icone: null, joueur: 1, couleur: '#3b82f6' });
const fleche = (id: string): ObjetStrat => ({ id, type: 'fleche', points: [0, 0, 50, 50, 100, 60], couleur: '#ef4444', epaisseur: 5, tirets: false });

describe('document', () => {
  it('document vide : version courante, cinq joueurs, une étape, calques visibles et déverrouillés', () => {
    const d = documentVide(ASCENT, 'defense');
    expect(d.version).toBe(VERSION_DOCUMENT);
    expect(d.side).toBe('defense');
    expect(d.joueurs.map(j => j.couleur)).toHaveLength(5);
    expect(d.etapes).toHaveLength(1);
    expect(Object.values(d.calques).every(c => c.visible && !c.verrou)).toBe(true);
  });

  it('ajouter, modifier, déplacer, supprimer ; une action sans effet rend le même document', () => {
    let d = documentVide(ASCENT);
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: agent('a1') });
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: fleche('f1') });
    expect(d.etapes[0].objets.map(o => o.id)).toEqual(['a1', 'f1']);
    expect(appliquer(d, { type: 'ajouter', etape: 0, objet: agent('a1') })).toBe(d);
    d = appliquer(d, { type: 'deplacer', etape: 0, id: 'a1', dx: 10, dy: -5 });
    expect(d.etapes[0].objets[0]).toMatchObject({ x: 110, y: 95 });
    d = appliquer(d, { type: 'deplacer', etape: 0, id: 'f1', dx: 10, dy: 10 });
    expect((d.etapes[0].objets[1] as { points: number[] }).points).toEqual([10, 10, 60, 60, 110, 70]);
    expect(appliquer(d, { type: 'deplacer', etape: 0, id: 'a1', dx: 0, dy: 0 })).toBe(d);
    d = appliquer(d, { type: 'modifier', etape: 0, id: 'a1', champs: { couleur: '#ffffff' } });
    expect(d.etapes[0].objets[0]).toMatchObject({ couleur: '#ffffff', type: 'agent', id: 'a1' });
    d = appliquer(d, { type: 'supprimer', etape: 0, id: 'f1' });
    expect(d.etapes[0].objets.map(o => o.id)).toEqual(['a1']);
    expect(appliquer(d, { type: 'supprimer', etape: 0, id: 'inconnu' })).toBe(d);
  });

  it('calques : déduits du type ; un calque verrouillé refuse ajouts, déplacements et suppressions', () => {
    expect(calqueDe(agent('a'))).toBe('utilitaires');
    expect(calqueDe(fleche('f'))).toBe('dessins');
    expect(calqueDe({ id: 't', type: 'texte', x: 0, y: 0, texte: 'A', couleur: '#ffffff', taille: 20 })).toBe('texte');
    let d = appliquer(documentVide(ASCENT), { type: 'ajouter', etape: 0, objet: agent('a1') });
    d = appliquer(d, { type: 'calque', calque: 'utilitaires', champs: { verrou: true } });
    expect(appliquer(d, { type: 'deplacer', etape: 0, id: 'a1', dx: 5, dy: 5 })).toBe(d);
    expect(appliquer(d, { type: 'supprimer', etape: 0, id: 'a1' })).toBe(d);
    expect(appliquer(d, { type: 'ajouter', etape: 0, objet: agent('a2') })).toBe(d);
    // Vider l'étape garde les objets des calques verrouillés.
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: fleche('f1') });
    d = appliquer(d, { type: 'vider', etape: 0 });
    expect(d.etapes[0].objets.map(o => o.id)).toEqual(['a1']);
    d = appliquer(d, { type: 'calque', calque: 'fond', champs: { visible: false } });
    expect(d.calques.fond.visible).toBe(false);
  });

  it('étapes : ajouter, dupliquer (nouveaux identifiants), réordonner, renommer, supprimer (jamais la dernière), limite', () => {
    let d = appliquer(documentVide(ASCENT), { type: 'ajouter', etape: 0, objet: agent('a1') });
    d = appliquer(d, { type: 'titreEtape', etape: 0, titre: 'Mise en place' });
    d = appliquer(d, { type: 'noteEtape', etape: 0, note: 'Tout le monde A lobby' });
    d = appliquer(d, { type: 'dupliquerEtape', etape: 0 });
    expect(d.etapes).toHaveLength(2);
    expect(d.etapes[1].titre).toBe('Mise en place (suite)');
    expect(d.etapes[1].note).toBe('Tout le monde A lobby');
    expect(d.etapes[1].objets).toHaveLength(1);
    expect(d.etapes[1].objets[0].id).not.toBe('a1');
    expect(d.etapes[1].id).not.toBe(d.etapes[0].id);
    // La copie est indépendante.
    d = appliquer(d, { type: 'deplacer', etape: 1, id: d.etapes[1].objets[0].id, dx: 50, dy: 0 });
    expect(d.etapes[0].objets[0]).toMatchObject({ x: 100 });
    d = appliquer(d, { type: 'ajouterEtape', apres: 0 });
    expect(d.etapes.map(e => e.titre)).toEqual(['Mise en place', 'Étape 3', 'Mise en place (suite)']);
    d = appliquer(d, { type: 'deplacerEtape', de: 2, vers: 0 });
    expect(d.etapes[0].titre).toBe('Mise en place (suite)');
    d = appliquer(d, { type: 'supprimerEtape', etape: 1 });
    expect(d.etapes).toHaveLength(2);
    let seul = documentVide(ASCENT);
    expect(appliquer(seul, { type: 'supprimerEtape', etape: 0 })).toBe(seul);
    for (let i = 0; i < ETAPES_MAX + 3; i++) seul = appliquer(seul, { type: 'ajouterEtape', apres: seul.etapes.length - 1 });
    expect(seul.etapes).toHaveLength(ETAPES_MAX);
  });

  it('joueurs : changer la couleur d’un joueur recolore ses agents et capacités', () => {
    let d = appliquer(documentVide(ASCENT), { type: 'ajouter', etape: 0, objet: agent('a1') });
    d = appliquer(d, { type: 'joueur', index: 1, champs: { couleur: '#000000', nom: 'Kai' } });
    expect(d.joueurs[1]).toMatchObject({ nom: 'Kai', couleur: '#000000' });
    expect(d.etapes[0].objets[0]).toMatchObject({ couleur: '#000000' });
  });

  it('identifiants uniques et zones par défaut des capacités', () => {
    const pris = new Set<string>();
    for (let i = 0; i < 500; i++) pris.add(idUnique(pris));
    expect(pris.size).toBe(500);
    expect([...pris].every(id => /^[A-Za-z0-9_-]{1,24}$/.test(id))).toBe(true);
    expect(zoneParDefaut('cercle')).toEqual({ forme: 'cercle', rayon: 4 });
    expect(zoneParDefaut('mur')?.forme).toBe('mur');
    expect(zoneParDefaut('cone')).toMatchObject({ forme: 'cone', ouverture: 60 });
    expect(zoneParDefaut('aucune')).toBeNull();
  });
});

describe('version 3 : modèles, phases, économie, utilitaires', () => {
  it('The Finals : trois joueurs, phases et économie propres au modèle', () => {
    let d = documentVide(ASCENT, 'attaque', 'the-finals', 'thefinals');
    expect(d.joueurs).toHaveLength(3);
    expect(appliquer(d, { type: 'phaseEtape', etape: 0, phase: 'post-plant' })).toBe(d);
    d = appliquer(d, { type: 'phaseEtape', etape: 0, phase: 'prise' });
    expect(d.etapes[0].phase).toBe('prise');
    expect(appliquer(d, { type: 'economie', economie: 'full' })).toBe(d);
    d = appliquer(d, { type: 'ajouterEtape', apres: 0 });
    expect(d.etapes[1].phase).toBe('prise');
    d = appliquer(d, { type: 'dureeEtape', etape: 1, duree: 500 });
    expect(d.etapes[1].duree).toBe(120);
    const v = appliquer(documentVide(ASCENT), { type: 'economie', economie: 'eco' });
    expect(v.economie).toBe('eco');
  });

  it('ordre des utilitaires, coller avec de nouveaux identifiants, recoloration des trajets du joueur', () => {
    const cap = (id: string, ordre: number | null, t: number | null): ObjetStrat => ({ id, type: 'capacite', x: 0, y: 0, agent: 'omen', capacite: 'Ability2', nom: id, icone: null, joueur: 0, couleur: '#ef4444', zone: null, ordre, t });
    let d = documentVide(ASCENT);
    for (const o of [cap('c', 2, null), cap('a', null, 3), cap('b', 1, null), cap('d', null, 1)]) d = appliquer(d, { type: 'ajouter', etape: 0, objet: o });
    expect(ordreUtilitaires(d.etapes[0]).map(o => o.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(prochainOrdre(d.etapes[0])).toBe(3);
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: { ...fleche('f1'), joueur: 0, t0: 0, t1: 4 } as ObjetStrat });
    d = appliquer(d, { type: 'coller', etape: 0, objets: [d.etapes[0].objets[0]], decalage: 20 });
    expect(d.etapes[0].objets).toHaveLength(6);
    expect(new Set(d.etapes[0].objets.map(o => o.id)).size).toBe(6);
    expect(d.etapes[0].objets[5]).toMatchObject({ x: 20, y: 20, nom: 'c' });
    d = appliquer(d, { type: 'joueur', index: 0, champs: { couleur: '#000000' } });
    expect(d.etapes[0].objets.every(o => (o as { couleur: string }).couleur === '#000000')).toBe(true);
  });
});

describe('annuler / rétablir', () => {
  it('annule et rétablit dans l’ordre ; une nouvelle action efface le futur ; les actions sans effet ne comptent pas', () => {
    let h = historique(documentVide(ASCENT));
    h = executer(h, { type: 'ajouter', etape: 0, objet: agent('a1') });
    h = executer(h, { type: 'ajouter', etape: 0, objet: fleche('f1') });
    h = executer(h, { type: 'deplacer', etape: 0, id: 'a1', dx: 0, dy: 0 });
    expect(h.passe).toHaveLength(2);
    h = annuler(h);
    expect(h.present.etapes[0].objets.map(o => o.id)).toEqual(['a1']);
    h = annuler(h);
    expect(h.present.etapes[0].objets).toHaveLength(0);
    expect(annuler(h)).toBe(h);
    h = retablir(h);
    expect(h.present.etapes[0].objets.map(o => o.id)).toEqual(['a1']);
    h = executer(h, { type: 'ajouterEtape', apres: 0 });
    expect(h.futur).toHaveLength(0);
    expect(retablir(h)).toBe(h);
  });

  it('l’historique est borné (100 états)', () => {
    let h = historique(documentVide(ASCENT));
    for (let i = 0; i < LIMITE_HISTORIQUE + 20; i++) h = executer(h, { type: 'titreEtape', etape: 0, titre: `T${i}` });
    expect(h.passe).toHaveLength(LIMITE_HISTORIQUE);
  });

  it('restaurer une ancienne version est une action annulable', () => {
    const ancienne = documentVide({ cle: 'bind', nom: 'Bind', image: null });
    let h = historique(documentVide(ASCENT));
    h = executer(h, { type: 'remplacer', document: ancienne });
    expect(h.present.carte.cle).toBe('bind');
    expect(annuler(h).present.carte.cle).toBe('ascent');
  });
});

describe('sérialisation et migration', () => {
  it('aller-retour JSON sans perte', () => {
    let d: DocumentStrat = documentVide(ASCENT);
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: agent('a1') });
    d = appliquer(d, { type: 'ajouter', etape: 0, objet: { id: 'c1', type: 'capacite', x: 1, y: 2, agent: 'omen', capacite: 'Ability2', nom: 'Dark Cover', icone: null, joueur: 1, couleur: '#3b82f6', zone: zoneParDefaut('cercle') } });
    expect(lireDocument(serialiser(d))).toEqual(d);
  });

  it('migre un document version 1 (une seule frame) vers la version courante', () => {
    const v1 = { version: 1, carte: 'bind', side: 'defense', notes: 'Retake', objets: [agent('a1')] };
    const d = lireDocument(JSON.stringify(v1));
    expect(d.version).toBe(3);
    expect(d.modele).toBe('valorant');
    expect(d.carte).toEqual({ cle: 'bind', nom: 'bind', image: null, echelle: null });
    expect(d.etapes).toHaveLength(1);
    expect(d.etapes[0].note).toBe('Retake');
    expect(d.etapes[0].objets[0].id).toBe('a1');
    expect(d.joueurs).toHaveLength(5);
    expect(d.calques.utilitaires.visible).toBe(true);
  });

  it('refuse un JSON illisible, sans carte ou d’une version future', () => {
    expect(() => lireDocument('{pas du json')).toThrow('illisible');
    expect(() => lireDocument({ version: 2, etapes: [] })).toThrow('carte');
    expect(() => lireDocument({ ...documentVide(ASCENT), version: 9 })).toThrow('plus récente');
  });

  it('migre un document version 2 : zones en mètres (dessin inchangé sans calibrage), modèle de la strat, trois joueurs pour The Finals', () => {
    const v2 = {
      version: 2,
      jeu: 'autre',
      carte: { cle: 'monaco', nom: 'Monaco', image: null },
      side: 'attaque',
      joueurs: COULEURS_JOUEURS.slice(0, 5).map((couleur, i) => ({ nom: `J${i}`, couleur, agent: null })),
      calques: { fond: { visible: true, verrou: false }, utilitaires: { visible: false, verrou: false }, dessins: { visible: true, verrou: true }, texte: { visible: true, verrou: false } },
      etapes: [{ id: 'e1', titre: 'A', note: '', objets: [{ id: 'c', type: 'capacite', x: 1, y: 2, agent: 'x', capacite: 'q', nom: 'Q', icone: null, joueur: 4, couleur: '#ffffff', zone: { forme: 'mur', dx: 0, dy: 80, epaisseur: 8 } }] }],
    };
    const d = lireDocument(v2, 'thefinals');
    expect(d.modele).toBe('thefinals');
    expect(d.joueurs).toHaveLength(3);
    expect(d.calques.utilitaires.visible).toBe(false);
    expect(d.calques.callouts.visible).toBe(true);
    expect(d.etapes[0].duree).toBe(5);
    const c = d.etapes[0].objets[0] as ObjetCapacite;
    expect(c.joueur).toBeNull();
    expect(c.zone).toEqual({ forme: 'mur', angle: 90, longueur: 10, largeur: 1, courbure: 0 });
    expect(zoneDepuisV2({ forme: 'cercle', rayon: 40 })).toEqual({ forme: 'cercle', rayon: 5 });
  });

  it('taille en octets UTF-8 (limite du serveur : 384 Ko)', () => {
    expect(octetsUtf8('aé€😀')).toBe(1 + 2 + 3 + 4);
    const d = documentVide(ASCENT);
    expect(tailleDocument(d)).toBe(octetsUtf8(JSON.stringify(d)));
  });
});

describe('vue', () => {
  it('zoom autour d’un point (le point reste sous le curseur), borné', () => {
    const v = zoomer({ echelle: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    expect(v).toEqual({ echelle: 2, x: -100, y: -50 });
    // Point écran (100, 50) → point document identique avant et après.
    const doc = (vue: typeof v, p: { x: number; y: number }) => ({ x: (p.x - vue.x) / vue.echelle, y: (p.y - vue.y) / vue.echelle });
    expect(doc(v, { x: 100, y: 50 })).toEqual(doc({ echelle: 1, x: 0, y: 0 }, { x: 100, y: 50 }));
    expect(zoomer(v, 100, { x: 0, y: 0 }).echelle).toBe(6);
    expect(zoomer(v, 0.001, { x: 0, y: 0 }).echelle).toBe(0.5);
  });
});
