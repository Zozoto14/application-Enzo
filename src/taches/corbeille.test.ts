/**
 * Tâches : suppression d'espaces, de projets, de listes et de tâches —
 * cascade par lot, déplacement du contenu, « Annuler », corbeille (restaurer,
 * supprimer définitivement, 30 jours), droits, pierres tombales vues par
 * l'autre appareil et par l'ami.
 */

import {
  annulerSuppression,
  bilanSuppression,
  ciblesDeplacement,
  DUREE_CORBEILLE_MS,
  effacerElement,
  elementsCorbeille,
  purgerCorbeille,
  restaurerElement,
  supprimerElement,
  texteContenu,
  viderCorbeille,
} from './corbeille';
import { fusionnerDonnees } from './fusion';
import {
  changerReglages,
  creerEspace,
  creerListe,
  creerProjet,
  creerTache,
  donneesVides,
  espacesVivants,
  lireDonnees,
  ecrireDonnees,
  listesDe,
  modifierProjet,
  projetsDe,
  supprimerTache,
  tachesVivantes,
  vivant,
  type Contexte,
  type DonneesTaches,
} from './modele';
import { appliquerEnvoiAmi, appliquerReception, copieVide, envoiDeLAmi, projectionPourAmi } from './partage';

const T0 = new Date(2026, 9, 13, 8, 0).getTime();
let pas = 0;
const f = (n = 0): Contexte => ({ maintenant: T0 + n + pas++ * 10, auteur: 'fondateur', alea: () => ((pas * 7919) % 1000) / 1000 });
const a = (n = 0): Contexte => ({ maintenant: T0 + n + pas++ * 10, auteur: 'ami', alea: () => ((pas * 104729) % 1000) / 1000 });

/** Deux espaces : « Travail » (Site : 2 listes, 3 tâches dont une sous-tâche ; Blog : 1 tâche) et « Perso ». */
function monde() {
  let d: DonneesTaches = donneesVides();
  const travail = creerEspace(d, 'Travail', f());
  const perso = creerEspace(travail.donnees, 'Perso', f());
  const site = creerProjet(perso.donnees, travail.espace.id, 'Site', f());
  const l2 = creerListe(site.donnees, site.projet.id, 'Mise en ligne', f());
  const blog = creerProjet(l2.donnees, travail.espace.id, 'Blog', f());
  const courses = creerProjet(blog.donnees, perso.espace.id, 'Courses', f());
  d = courses.donnees;
  const t1 = creerTache(d, { titre: 'Maquette', listeId: site.liste.id, statut: 'en-cours' }, f());
  const st = creerTache(t1.donnees, { titre: 'Couleurs', listeId: site.liste.id, parentId: t1.tache.id }, f());
  const t2 = creerTache(st.donnees, { titre: 'Mise en ligne', listeId: l2.liste.id }, f());
  const t3 = creerTache(t2.donnees, { titre: 'Article', listeId: blog.liste.id }, f());
  return {
    d: t3.donnees,
    travail: travail.espace.id,
    perso: perso.espace.id,
    site: site.projet.id,
    liste1: site.liste.id,
    liste2: l2.liste.id,
    blog: blog.projet.id,
    courses: courses.projet.id,
    listeCourses: courses.liste.id,
    t1: t1.tache.id,
    st: st.tache.id,
    t2: t2.tache.id,
    t3: t3.tache.id,
  };
}

describe('suppression : ce qui part, et le dire', () => {
  const m = monde();
  it('bilan et texte : « 2 projets, 4 tâches »', () => {
    expect(bilanSuppression(m.d, 'espace', m.travail)).toEqual({ projets: 2, listes: 3, taches: 4, partages: 0 });
    expect(texteContenu(bilanSuppression(m.d, 'espace', m.travail), 'espace')).toBe('2 projets, 4 tâches');
    expect(texteContenu(bilanSuppression(m.d, 'projet', m.site), 'projet')).toBe('2 listes, 3 tâches');
    expect(texteContenu(bilanSuppression(m.d, 'liste', m.liste2), 'liste')).toBe('1 tâche');
    expect(texteContenu(bilanSuppression(m.d, 'tache', m.t1), 'tache')).toBe('1 sous-tâche');
    expect(texteContenu(bilanSuppression(m.d, 'espace', m.perso), 'espace')).toBe('1 projet');
  });
  it('cibles de déplacement : les autres espaces, projets, listes', () => {
    expect(ciblesDeplacement(m.d, 'espace', m.travail).map(c => c.nom)).toEqual(['Perso']);
    expect(ciblesDeplacement(m.d, 'projet', m.site).map(c => c.id).sort()).toEqual([m.blog, m.courses].sort());
    expect(ciblesDeplacement(m.d, 'liste', m.liste2).map(c => c.nom)).toEqual(['Liste', 'Blog › Liste', 'Courses › Liste']);
  });
});

describe('cascade, annuler, corbeille', () => {
  it('espace : tout part dans un même lot, « Annuler » rend tout', () => {
    const m = monde();
    const r = supprimerElement(m.d, 'espace', m.travail, f());
    expect(r.texte).toBe('Espace « Travail » supprimé (2 projets, 4 tâches).');
    expect(projetsDe(r.donnees).map(p => p.nom)).toEqual(['Courses']);
    expect(tachesVivantes(r.donnees)).toHaveLength(0);
    expect(r.donnees.taches[m.st].lot).toBe(m.travail);
    const annule = annulerSuppression(r.donnees, r, f());
    expect(projetsDe(annule).map(p => p.nom).sort()).toEqual(['Blog', 'Courses', 'Site']);
    expect(tachesVivantes(annule)).toHaveLength(4);
    expect(Object.values(annule.taches).every(t => t.lot === undefined)).toBe(true);
  });
  it('ce qui avait été supprimé avant reste à la corbeille quand on restaure', () => {
    const m = monde();
    const avant = supprimerElement(m.d, 'tache', m.t2, f()).donnees;
    const r = supprimerElement(avant, 'projet', m.site, f());
    const corbeille = elementsCorbeille(r.donnees, T0 + 1000);
    expect(corbeille.map(e => `${e.genre}:${e.nom}`)).toEqual(['projet:Site', 'tache:Mise en ligne']);
    expect(corbeille[0].contenu).toBe('2 listes, 2 tâches');
    expect(corbeille[1]).toMatchObject({ restaurable: false, raison: 'Restaurez d’abord la liste « Mise en ligne ».' });
    const rest = restaurerElement(r.donnees, 'projet', m.site, f());
    expect(tachesVivantes(rest, m.site).map(t => t.titre).sort()).toEqual(['Couleurs', 'Maquette']);
    expect(rest.taches[m.t2].supprime).toBe(true);
    // La tâche peut maintenant revenir à son tour.
    const tout = restaurerElement(rest, 'tache', m.t2, f());
    expect(tachesVivantes(tout, m.site)).toHaveLength(3);
    expect(tout.taches[m.t2].historique.at(-1)?.texte).toBe('Tâche restaurée');
  });
  it('tâche supprimée avec ses sous-tâches, restaurée avec elles', () => {
    const m = monde();
    const r = supprimerElement(m.d, 'tache', m.t1, f());
    expect(r.texte).toBe('« Maquette » supprimée (1 sous-tâche).');
    expect(r.donnees.taches[m.st]).toMatchObject({ supprime: true, lot: m.t1 });
    expect(elementsCorbeille(r.donnees, T0).map(e => e.nom)).toEqual(['Maquette']);
    const rest = restaurerElement(r.donnees, 'tache', m.t1, f());
    expect(vivant(rest.taches[m.st])).toBe(true);
  });
  it('déplacer avant de supprimer : projets vers un autre espace, puis annuler', () => {
    const m = monde();
    const r = supprimerElement(m.d, 'espace', m.travail, f(), { deplacerVers: m.perso });
    expect(r.texte).toBe('Espace « Travail » supprimé (contenu déplacé vers « Perso »).');
    expect(projetsDe(r.donnees, m.perso).map(p => p.nom).sort()).toEqual(['Blog', 'Courses', 'Site']);
    expect(tachesVivantes(r.donnees)).toHaveLength(4);
    expect(elementsCorbeille(r.donnees, T0)[0].contenu).toBe('vide');
    const annule = annulerSuppression(r.donnees, r, f());
    expect(projetsDe(annule, m.travail).map(p => p.nom).sort()).toEqual(['Blog', 'Site']);
  });
  it('déplacer un projet : listes et tâches vers un autre projet (statuts équivalents), puis annuler', () => {
    const m = monde();
    let d = modifierProjet(m.d, m.blog, { nom: 'Blog' }, f());
    // Le projet cible a d'autres statuts : « En cours » devient le statut du même nom.
    d = { ...d, projets: { ...d.projets, [m.blog]: { ...d.projets[m.blog], statuts: [{ id: 'todo', nom: 'À faire', couleur: '#8A94A7', ferme: false }, { id: 'doing', nom: 'En cours', couleur: '#5B8CFF', ferme: false }, { id: 'done', nom: 'Fait', couleur: '#3FD49B', ferme: true }] } } };
    const r = supprimerElement(d, 'projet', m.site, f(), { deplacerVers: m.blog });
    expect(listesDe(r.donnees, m.blog)).toHaveLength(3);
    expect(r.donnees.taches[m.t1]).toMatchObject({ projetId: m.blog, statut: 'doing' });
    expect(r.donnees.taches[m.t2]).toMatchObject({ projetId: m.blog, statut: 'todo' });
    expect(tachesVivantes(r.donnees, m.blog)).toHaveLength(4);
    const annule = annulerSuppression(r.donnees, r, f());
    expect(tachesVivantes(annule, m.site)).toHaveLength(3);
    expect(annule.taches[m.t1].statut).toBe('en-cours');
  });
  it('déplacer une liste vers une autre (même d’un autre projet), puis supprimer', () => {
    const m = monde();
    const r = supprimerElement(m.d, 'liste', m.liste1, f(), { deplacerVers: m.listeCourses });
    expect(tachesVivantes(r.donnees, m.courses).map(t => t.titre).sort()).toEqual(['Couleurs', 'Maquette']);
    expect(listesDe(r.donnees, m.site).map(l => l.nom)).toEqual(['Mise en ligne']);
    const annule = annulerSuppression(r.donnees, r, f());
    expect(tachesVivantes(annule, m.site)).toHaveLength(3);
  });
  it('un projet garde au moins une liste', () => {
    const m = monde();
    expect(() => supprimerElement(m.d, 'liste', m.listeCourses, f())).toThrow('au moins une liste');
  });
  it('le dernier espace supprimé : un espace « Personnel » vide le remplace (retiré si l’on annule)', () => {
    const m = monde();
    const sans = supprimerElement(m.d, 'espace', m.perso, f()).donnees;
    const r = supprimerElement(sans, 'espace', m.travail, f());
    expect(espacesVivants(r.donnees).map(e => e.nom)).toEqual(['Personnel']);
    expect(projetsDe(r.donnees)).toHaveLength(0);
    const annule = annulerSuppression(r.donnees, r, f());
    expect(espacesVivants(annule).map(e => e.nom)).toEqual(['Travail']);
    // L'espace recréé n'encombre pas la corbeille.
    expect(elementsCorbeille(annule, T0).map(e => e.nom)).toEqual(['Perso']);
  });
  it('restaurer un projet dont l’espace a été supprimé définitivement : il revient dans un espace vivant', () => {
    const m = monde();
    const x = supprimerElement(m.d, 'projet', m.blog, f()).donnees;
    const y = effacerElement(supprimerElement(x, 'espace', m.travail, f()).donnees, 'espace', m.travail, f());
    const corb = elementsCorbeille(y, T0);
    expect(corb.map(e => e.nom)).toEqual([]);
    // Le projet supprimé à part a été effacé avec son espace (rien d'orphelin).
    expect(y.projets[m.blog].efface).toBe(true);
    const z = supprimerElement(m.d, 'projet', m.blog, f()).donnees;
    const espaceParti = { ...z, espaces: { ...z.espaces, [m.travail]: { ...z.espaces[m.travail], supprime: true, efface: true } } };
    const rest = restaurerElement(espaceParti, 'projet', m.blog, f());
    expect(rest.projets[m.blog].espaceId).toBe(m.perso);
    expect(tachesVivantes(rest, m.blog)).toHaveLength(1);
  });
  it('supprimer définitivement efface le contenu, garde la pierre tombale ; vider ; 30 jours', () => {
    const m = monde();
    const r = supprimerElement(m.d, 'projet', m.site, f());
    const e = effacerElement(r.donnees, 'projet', m.site, f());
    expect(e.taches[m.t1]).toMatchObject({ supprime: true, efface: true, titre: '', description: '' });
    expect(Object.keys(e.taches[m.t1].commentaires)).toHaveLength(0);
    expect(elementsCorbeille(e, T0)).toHaveLength(0);
    expect(() => restaurerElement(e, 'projet', m.site, f())).toThrow('plus dans la corbeille');
    // Vider : tout.
    const deux = supprimerElement(supprimerElement(m.d, 'tache', m.t3, f()).donnees, 'espace', m.perso, f()).donnees;
    expect(elementsCorbeille(viderCorbeille(deux, f()), T0)).toHaveLength(0);
    // 30 jours : rien avant, tout après.
    expect(purgerCorbeille(deux, { ...f(), maintenant: T0 + DUREE_CORBEILLE_MS - 60_000 })).toBe(deux);
    const purge = purgerCorbeille(deux, { ...f(), maintenant: T0 + DUREE_CORBEILLE_MS + 60_000 });
    expect(elementsCorbeille(purge, T0 + DUREE_CORBEILLE_MS + 60_000)).toHaveLength(0);
    expect(elementsCorbeille(deux, T0 + 10 * 86_400_000)[0].resteJours).toBe(20);
  });
  it('les suppressions de la V1 (sans lot) se restaurent d’un bloc', () => {
    const m = monde();
    // Pierres tombales « V1 » : même instant, pas de lot.
    const h = new Date(T0 + 5000).toISOString() + '|f';
    const v1 = (e: { h: Record<string, string> }) => ({ ...e, supprime: true, h: { ...e.h, supprime: h } });
    const d: DonneesTaches = {
      ...m.d,
      projets: { ...m.d.projets, [m.blog]: v1(m.d.projets[m.blog]) as never },
      listes: Object.fromEntries(Object.values(m.d.listes).map(l => [l.id, l.projetId === m.blog ? (v1(l) as never) : l])),
      taches: { ...m.d.taches, [m.t3]: v1(m.d.taches[m.t3]) as never },
    };
    expect(elementsCorbeille(d, T0).map(e => e.nom)).toEqual(['Blog']);
    expect(tachesVivantes(restaurerElement(d, 'projet', m.blog, f()), m.blog)).toHaveLength(1);
  });
});

describe('droits', () => {
  it('seul le Fondateur supprime un espace, un projet, une liste, et gère la corbeille', () => {
    const m = monde();
    expect(() => supprimerElement(m.d, 'espace', m.travail, a())).toThrow('Seul le Fondateur supprime un espace');
    expect(() => supprimerElement(m.d, 'projet', m.site, a())).toThrow('Seul le Fondateur supprime un projet');
    expect(() => supprimerElement(m.d, 'liste', m.liste2, a())).toThrow('Seul le Fondateur supprime une liste');
    const r = supprimerElement(m.d, 'projet', m.site, f());
    expect(() => restaurerElement(r.donnees, 'projet', m.site, a())).toThrow('Seul le Fondateur');
    expect(() => effacerElement(r.donnees, 'projet', m.site, a())).toThrow('Seul le Fondateur');
  });
  it('l’ami supprime et restaure une tâche d’un projet en écriture, pas en lecture', () => {
    const m = monde();
    let d = changerReglages(m.d, { ami: 'leaami01', amiNom: 'Léa', cle: 'ab'.repeat(32) }, f());
    d = modifierProjet(d, m.site, { partage: 'ecriture' }, f());
    d = modifierProjet(d, m.blog, { partage: 'lecture' }, f());
    const copie = appliquerReception(copieVide(), { v: 1, ami: 'leaami01', cle: 'ab'.repeat(32), donnees: projectionPourAmi(d) });
    const r = supprimerElement(copie.donnees, 'tache', m.t2, a());
    expect(elementsCorbeille(r.donnees, T0, 'ami').map(e => e.nom)).toEqual(['Mise en ligne']);
    expect(() => supprimerElement(copie.donnees, 'tache', m.t3, a())).toThrow('pas partagé en écriture');
    const rest = restaurerElement(r.donnees, 'tache', m.t2, a());
    expect(vivant(rest.taches[m.t2])).toBe(true);
    // Le Fondateur accepte la suppression de l'ami (une tâche d'un projet en écriture).
    const envoi = envoiDeLAmi({ ...copie, donnees: r.donnees });
    expect(appliquerEnvoiAmi(d, envoi).donnees.taches[m.t2].supprime).toBe(true);
  });
});

describe('pierres tombales : autres appareils et ami', () => {
  it('l’autre appareil du Fondateur suit la suppression puis la restauration', () => {
    const m = monde();
    const pc = supprimerElement(m.d, 'espace', m.travail, f()).donnees;
    const ipad = fusionnerDonnees(lireDonnees(ecrireDonnees(m.d)), lireDonnees(ecrireDonnees(pc)));
    expect(espacesVivants(ipad).map(e => e.nom)).toEqual(['Perso']);
    expect(tachesVivantes(ipad)).toHaveLength(0);
    const rest = restaurerElement(ipad, 'espace', m.travail, f());
    expect(tachesVivantes(fusionnerDonnees(pc, rest))).toHaveLength(4);
  });
  it('un projet partagé supprimé disparaît chez l’ami (pierre tombale seule), revient s’il est restauré', () => {
    const m = monde();
    let d = changerReglages(m.d, { ami: 'leaami01', amiNom: 'Léa', cle: 'ab'.repeat(32) }, f());
    d = modifierProjet(d, m.site, { partage: 'ecriture' }, f());
    const doc = (x: DonneesTaches) => ({ v: 1 as const, ami: 'leaami01', cle: 'ab'.repeat(32), donnees: projectionPourAmi(x) });
    let copie = appliquerReception(copieVide(), doc(d));
    // L'ami a une création en attente dans ce projet.
    const attente = creerTache(copie.donnees, { titre: 'En attente', listeId: m.liste1 }, a());
    copie = { ...copie, donnees: attente.donnees };
    expect(projetsDe(copie.donnees).map(p => p.nom)).toEqual(['Site']);
    const sup = supprimerElement(d, 'espace', m.travail, f()).donnees;
    const proj = projectionPourAmi(sup);
    expect(proj.projets[m.site]).toMatchObject({ supprime: true });
    expect(Object.keys(proj.taches)).toHaveLength(0);
    expect(JSON.stringify(proj)).not.toContain('Maquette');
    const apres = appliquerReception(copie, doc(sup));
    expect(projetsDe(apres.donnees)).toHaveLength(0);
    expect(tachesVivantes(apres.donnees)).toHaveLength(0);
    expect(Object.keys(envoiDeLAmi(apres).taches)).toHaveLength(0);
    // Restauré : il revient chez l'ami.
    const rest = restaurerElement(sup, 'espace', m.travail, f());
    const retour = appliquerReception(apres, doc(rest));
    expect(projetsDe(retour.donnees).map(p => p.nom)).toEqual(['Site']);
    expect(tachesVivantes(retour.donnees).map(t => t.titre).sort()).toEqual(['Couleurs', 'Maquette', 'Mise en ligne']);
    // Supprimé définitivement : plus rien ne part.
    const efface = effacerElement(sup, 'espace', m.travail, f());
    expect(projectionPourAmi(efface).projets[m.site]).toBeUndefined();
  });
  it('l’ami ne peut pas faire passer une suppression de projet', () => {
    const m = monde();
    let d = changerReglages(m.d, { ami: 'leaami01', cle: 'ab'.repeat(32) }, f());
    d = modifierProjet(d, m.site, { partage: 'ecriture' }, f());
    const copie = appliquerReception(copieVide(), { v: 1, ami: 'leaami01', cle: 'ab'.repeat(32), donnees: projectionPourAmi(d) });
    // Tentative : pierre tombale du projet forgée dans la copie de l'ami.
    const forge = supprimerTache(copie.donnees, m.t1, a());
    const r = appliquerEnvoiAmi(d, { taches: forge.taches, projets: { [m.site]: { ...d.projets[m.site], supprime: true } } });
    expect(vivant(r.donnees.projets[m.site])).toBe(true);
    expect(r.donnees.taches[m.t1].supprime).toBe(true);
  });
});
