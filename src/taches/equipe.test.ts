/**
 * Déplacer des tâches (emplacement, multi-sélection, sous-tâches, statuts,
 * étiquettes, liens conservés, droits, visibilité et pierres tombales de
 * déplacement chez les membres, annuler) et menu « Équipe » (lignes, accès,
 * charge, matrice de droits, retrait d'un projet ou de tous avec rotation de
 * clé, réassignation, fiche d'un membre, vue d'un membre).
 */

import { aleatoireDeterministe } from '../securite/aleatoire';
import { droitsProjet } from './acces';
import { analyserDeplacement, annulerDeplacement, cheminTache, deplacerTaches, destinations, peutDeplacerVers, type Cote } from './deplacer';
import {
  activiteRecente,
  appliquerMatrice,
  chargeDe,
  debriefingsDe,
  equipeVueMembre,
  etatAcces,
  filtrerEquipe,
  FILTRES_EQUIPE,
  invitables,
  lignesEquipe,
  matriceDroits,
  profilsSupprimes,
  reassignerTaches,
  retirerDesProjets,
  tachesDuMembre,
} from './equipe';
import { ajouterEntree } from './journal';
import { changerDroit, droitDe, inviterMembre, listeMembres } from './membres';
import {
  ajouterCommentaire,
  assignesDe,
  changerStatuts,
  creerEspace,
  creerListe,
  creerProjet,
  creerTache,
  donneesVides,
  ErreurTaches,
  lireTache,
  modifierProjet,
  modifierTache,
  nouveauStatut,
  statutsDe,
  type Contexte,
  type DonneesTaches,
} from './modele';
import { appliquerEnvoiMembre, appliquerReception, copieVide, documentPourMembre, envoiDeLAmi, ouvrirEnvoi, scellerEnvoi, tachesParties } from './partage';
import { ajouterTemps } from './temps';
import { creerObjectif } from './objectifs';

const AUJ = '2026-10-15';
const T0 = new Date(2026, 9, 15, 9, 0).getTime();
let pas = 0;
const f = (n = 0): Contexte & { aleaOctets: (n: number) => Uint8Array } => ({ maintenant: T0 + n + pas++ * 10, auteur: 'fondateur', alea: () => ((pas * 7919) % 1000) / 1000, aleaOctets: aleatoireDeterministe(pas + 1) });
const par = (qui: string, n = 0): Contexte => ({ maintenant: T0 + n + pas++ * 10, auteur: qui, alea: () => ((pas * 104729) % 1000) / 1000 });
const FONDATEUR: Cote = { role: 'fondateur', moi: 'fondateur' };

const LEA = 'lea0000001';
const HUGO = 'hugo000002';

/** Espace « Travail » : A (Léa écriture, Hugo lecture), B (Hugo écriture), C (privé, statuts à lui). */
function scenario() {
  const e = creerEspace(donneesVides(), 'Travail', f());
  const pA = creerProjet(e.donnees, e.espace.id, 'Site', f());
  const pB = creerProjet(pA.donnees, e.espace.id, 'Appli', f());
  const pC = creerProjet(pB.donnees, e.espace.id, 'Privé', f());
  let d = pC.donnees;
  // C : statuts différents (« Idée », « Livré »).
  d = changerStatuts(d, pC.projet.id, [nouveauStatut('Idée', []), { ...nouveauStatut('Livré', []), id: 'livre', ferme: true }], f());
  d = inviterMembre(d, LEA, 'Léa', f(), 'ami');
  d = inviterMembre(d, HUGO, 'Hugo', f(), 'gestionnaire');
  d = changerDroit(d, pA.projet.id, LEA, 'ecriture', f());
  d = changerDroit(d, pA.projet.id, HUGO, 'lecture', f());
  d = changerDroit(d, pB.projet.id, HUGO, 'ecriture', f());
  const t1 = creerTache(d, { titre: 'Maquette', listeId: pA.liste.id, etiquettes: ['design'], assignes: [LEA] }, f());
  const t1a = creerTache(t1.donnees, { titre: 'Couleurs', listeId: pA.liste.id, parentId: t1.tache.id }, f());
  const t2 = creerTache(t1a.donnees, { titre: 'API', listeId: pB.liste.id, assignes: [HUGO] }, f());
  const t3 = creerTache(t2.donnees, { titre: 'Secret', listeId: pC.liste.id }, f());
  return { d: t3.donnees, A: pA.projet.id, B: pB.projet.id, C: pC.projet.id, lA: pA.liste.id, lB: pB.liste.id, lC: pC.liste.id, t1: t1.tache.id, t1a: t1a.tache.id, t2: t2.tache.id, t3: t3.tache.id };
}

const copieDe = (d: DonneesTaches, compte: string) => appliquerReception(copieVide(), documentPourMembre(d, listeMembres(d).find(m => m.compte === compte)!));

// ------------------------------------------------------------------ Déplacer

describe('déplacer des tâches', () => {
  it('vers un autre projet : sous-tâches suivantes, statut équivalent, historique, liens conservés, annuler', () => {
    const s = scenario();
    let d = modifierTache(s.d, s.t1, { statut: 'en-cours', dependances: [s.t2], jalon: true, debut: AUJ }, f());
    d = ajouterTemps(d, s.t1, { jour: AUJ, minutes: 45 }, f());
    d = ajouterCommentaire(d, s.t1, 'Voir la charte', f());
    d = ajouterEntree(d, { projetId: s.A, jour: AUJ, texte: 'Maquette avancée', tacheId: s.t1 }, f()).donnees;
    d = creerObjectif(d, { titre: 'Lancer', mode: 'taches', taches: [s.t1], projets: [] }, f()).donnees;
    d = { ...d, taches: { ...d.taches, [s.t1]: { ...d.taches[s.t1], liensOffice: [{ session: 'sess-1', depuis: new Date(T0).toISOString() }] } } };
    const r = deplacerTaches(d, [s.t1], { listeId: s.lB }, f(), FONDATEUR);
    const t = r.donnees.taches[s.t1];
    expect(t.projetId).toBe(s.B);
    expect(t.listeId).toBe(s.lB);
    expect(t.statut).toBe('en-cours');
    expect(t.anciensProjets).toEqual([s.A]);
    // Sous-tâche : suit sa parente.
    expect(r.donnees.taches[s.t1a]).toMatchObject({ projetId: s.B, listeId: s.lB, parentId: s.t1 });
    // Tout le reste est conservé.
    expect(t.dependances).toEqual([s.t2]);
    expect(t.jalon).toBe(true);
    expect(Object.values(t.temps)).toHaveLength(1);
    expect(Object.values(t.commentaires)).toHaveLength(1);
    expect(t.liensOffice?.[0].session).toBe('sess-1');
    expect(Object.values(r.donnees.journal)[0].tacheId).toBe(s.t1);
    expect(Object.values(r.donnees.objectifs)[0].taches).toEqual([s.t1]);
    expect(t.historique.at(-1)!.texte).toBe('Déplacée de « Travail › Site » vers « Travail › Appli »');
    expect(r.texte).toBe('« Maquette » déplacée vers « Travail › Appli ».');
    expect(cheminTache(r.donnees, t)).toBe('Travail › Appli');
    // Annuler : tout revient.
    const a = annulerDeplacement(r.donnees, r.retours, f());
    expect(a.taches[s.t1]).toMatchObject({ projetId: s.A, listeId: s.lA, statut: 'en-cours' });
    expect(a.taches[s.t1].anciensProjets).toBeUndefined();
    expect(a.taches[s.t1a].projetId).toBe(s.A);
    expect(a.taches[s.t1].historique.at(-1)!.texte).toBe('Déplacement annulé');
  });

  it('statut inconnu dans le projet d’arrivée : proposé (équivalent ou premier), ou choisi', () => {
    const s = scenario();
    const d = modifierTache(s.d, s.t1, { statut: 'en-revue' }, f());
    const an = analyserDeplacement(d, [s.t1], { listeId: s.lC }, FONDATEUR);
    // La tâche (« En revue ») et sa sous-tâche (« À faire ») : deux statuts inconnus dans « Privé ».
    expect(an.statuts).toEqual([
      { cle: `${s.A}|en-revue`, projetId: s.A, statutId: 'en-revue', nom: 'En revue', nb: 1, propose: statutsDe(d, s.C)[0].id },
      { cle: `${s.A}|a-faire`, projetId: s.A, statutId: 'a-faire', nom: 'À faire', nb: 1, propose: statutsDe(d, s.C)[0].id },
    ]);
    // Statut choisi.
    let r = deplacerTaches(d, [s.t1], { listeId: s.lC }, f(), FONDATEUR, { statuts: { [`${s.A}|en-revue`]: 'livre' } });
    expect(r.donnees.taches[s.t1].statut).toBe('livre');
    expect(r.donnees.taches[s.t1].termineLe).toBeUndefined();
    expect(r.donnees.taches[s.t1].historique.some(e => e.texte === 'Statut : En revue → Livré')).toBe(true);
    // Sans choix : le proposé ; une tâche « Fait » va vers le statut terminé.
    const d2 = modifierTache(s.d, s.t1, { statut: 'fait' }, f());
    r = deplacerTaches(d2, [s.t1], { listeId: s.lC }, f(), FONDATEUR);
    expect(r.donnees.taches[s.t1].statut).toBe('livre');
  });

  it('étiquettes propres au projet : conservées sur la tâche, ou créées dans le projet', () => {
    const s = scenario();
    const d = modifierProjet(s.d, s.B, { etiquettes: ['back'] }, f());
    const an = analyserDeplacement(d, [s.t1], { listeId: s.lB }, FONDATEUR);
    expect(an.etiquettes).toEqual(['design']);
    expect(an.peutCreerEtiquettes).toBe(true);
    let r = deplacerTaches(d, [s.t1], { listeId: s.lB }, f(), FONDATEUR);
    expect(r.donnees.taches[s.t1].etiquettes).toEqual(['design']);
    expect(r.donnees.projets[s.B].etiquettes).toEqual(['back']);
    r = deplacerTaches(d, [s.t1], { listeId: s.lB }, f(), FONDATEUR, { etiquettes: 'creer' });
    expect(r.donnees.projets[s.B].etiquettes).toEqual(['back', 'design']);
    expect(annulerDeplacement(r.donnees, r.retours, f()).projets[s.B].etiquettes).toEqual(['back']);
  });

  it('multi-sélection, convertir en sous-tâche (un niveau) et en tâche principale', () => {
    const s = scenario();
    // Deux tâches (dont une sous-tâche dont la parente est aussi choisie : elle suit).
    let r = deplacerTaches(s.d, [s.t1, s.t1a, s.t3], { listeId: s.lB }, f(), FONDATEUR);
    expect(r.nb).toBe(2);
    expect(r.texte).toBe('2 tâches déplacées vers « Travail › Appli ».');
    expect(r.donnees.taches[s.t3].statut).toBe('a-faire');
    // Convertir « Maquette » en sous-tâche de « API » : sa sous-tâche est rattachée à « API » (un seul niveau).
    r = deplacerTaches(s.d, [s.t1], { listeId: s.lB, parentId: s.t2 }, f(), FONDATEUR);
    expect(r.donnees.taches[s.t1]).toMatchObject({ parentId: s.t2, projetId: s.B });
    expect(r.donnees.taches[s.t1a]).toMatchObject({ parentId: s.t2, projetId: s.B });
    expect(r.texte).toBe('« Maquette » devient sous-tâche de « API ».');
    expect(r.donnees.taches[s.t1].historique.some(e => e.texte === 'Devenue sous-tâche de « API »')).toBe(true);
    // Sous-tâche d'une sous-tâche : rattachée à la principale.
    const r2 = deplacerTaches(s.d, [s.t3], { listeId: s.lA, parentId: s.t1a }, f(), FONDATEUR);
    expect(r2.donnees.taches[s.t3].parentId).toBe(s.t1);
    // Sous-tâche → tâche principale.
    const r3 = deplacerTaches(s.d, [s.t1a], { listeId: s.lA, parentId: null }, f(), FONDATEUR);
    expect(r3.donnees.taches[s.t1a].parentId).toBeUndefined();
    expect(r3.texte).toBe('« Couleurs » devient une tâche principale.');
    // Elle-même, ou une de ses sous-tâches : refusé.
    expect(() => deplacerTaches(s.d, [s.t1], { listeId: s.lA, parentId: s.t1a }, f(), FONDATEUR)).toThrow(/elle-même/);
    // Une sous-tâche déplacée seule vers un autre projet devient principale.
    const r4 = deplacerTaches(s.d, [s.t1a], { listeId: s.lB }, f(), FONDATEUR);
    expect(r4.donnees.taches[s.t1a]).toMatchObject({ projetId: s.B });
    expect(r4.donnees.taches[s.t1a].parentId).toBeUndefined();
    // Rien à faire.
    expect(deplacerTaches(s.d, [s.t1], { listeId: s.lA }, f(), FONDATEUR).nb).toBe(0);
  });

  it('sélecteur « Emplacement » : listes autorisées, recherche, sous-tâche de…', () => {
    const s = scenario();
    const d = creerListe(s.d, s.B, 'Recette', f()).donnees;
    expect(destinations(d, FONDATEUR).map(x => x.libelle)).toEqual(['Site', 'Appli › Liste', 'Appli › Recette', 'Privé']);
    expect(destinations(d, FONDATEUR, 'recet').map(x => x.libelle)).toEqual(['Appli › Recette']);
    // Recherche d'une tâche : « Sous-tâche de « API » ».
    const sous = destinations(d, FONDATEUR, 'api', [d.taches[s.t1]]);
    expect(sous.map(x => x.libelle)).toContain('↳ Sous-tâche de « API »');
    // Une tâche ne se propose pas comme sa propre parente.
    expect(destinations(d, FONDATEUR, 'maquette', [d.taches[s.t1]]).some(x => x.parentId === s.t1)).toBe(false);
    // Projet tenu par une autre app : n'accepte que ses tâches.
    const auto = { ...d, projets: { ...d.projets, [s.C]: { ...d.projets[s.C], auto: 'prospects' as const } } };
    expect(peutDeplacerVers(auto, s.C, FONDATEUR, [d.taches[s.t1]])).toBe(false);
    expect(() => deplacerTaches(auto, [s.t1], { listeId: s.lC }, f(), FONDATEUR)).toThrow(/autre app/);
  });

  it('droits : un membre ne déplace que depuis et vers des projets où il écrit', () => {
    const s = scenario();
    const d = changerDroit(s.d, s.B, LEA, 'ecriture', f());
    const lea = copieDe(d, LEA);
    const cote: Cote = { role: 'ami', moi: LEA };
    expect(destinations(lea.donnees, cote).map(x => x.projetId).sort()).toEqual([s.A, s.B].sort());
    const r = deplacerTaches(lea.donnees, [s.t1], { listeId: s.lB }, par(LEA), cote);
    expect(r.donnees.taches[s.t1].projetId).toBe(s.B);
    // Hugo : lecture sur A → refusé.
    const hugo = copieDe(d, HUGO);
    expect(() => deplacerTaches(hugo.donnees, [s.t1], { listeId: s.lB }, par(HUGO), { role: 'ami', moi: HUGO })).toThrow(/ne pouvez pas modifier/);
    // Hugo : de B (écriture) vers A (lecture) → refusé.
    expect(() => deplacerTaches(hugo.donnees, [s.t2], { listeId: s.lA }, par(HUGO), { role: 'ami', moi: HUGO })).toThrow(/écrire/);
    // Un membre ne crée pas d'étiquette dans un projet qu'il ne gère pas.
    expect(analyserDeplacement(lea.donnees, [s.t1], { listeId: s.lB }, cote).peutCreerEtiquettes).toBe(false);
  });

  it('le Fondateur accepte le déplacement d’un membre entre deux projets où il écrit, et refuse le reste', () => {
    const s = scenario();
    const d = changerDroit(s.d, s.B, LEA, 'ecriture', f());
    const cop = copieDe(d, LEA);
    const envoi = (dd: DonneesTaches) => {
      const cp = { ...cop, donnees: dd };
      return ouvrirEnvoi(cp.cle!, scellerEnvoi(cp.cle!, envoiDeLAmi(cp), new Date(T0).toISOString(), aleatoireDeterministe(9), cp.clesProjets, cp.moi));
    };
    const r = deplacerTaches(cop.donnees, [s.t1], { listeId: s.lB }, par(LEA), { role: 'ami', moi: LEA });
    const b = appliquerEnvoiMembre(d, envoi(r.donnees), LEA);
    expect(b.donnees.taches[s.t1]).toMatchObject({ projetId: s.B, listeId: s.lB });
    expect(b.donnees.taches[s.t1a]).toMatchObject({ projetId: s.B, listeId: s.lB, parentId: s.t1 });
    // Hugo forge un déplacement de A (lecture) vers B (écriture) : refusé.
    const ch = copieDe(d, HUGO);
    const t = ch.donnees.taches[s.t1];
    const h = `${new Date(T0 + 60_000).toISOString()}|${HUGO}`;
    const forge = { ...ch.donnees, taches: { ...ch.donnees.taches, [s.t1]: { ...t, projetId: s.B, listeId: s.lB, h: { ...t.h, projetId: h, listeId: h } } } };
    const bh = appliquerEnvoiMembre(d, ouvrirEnvoi(ch.cle!, scellerEnvoi(ch.cle!, envoiDeLAmi({ ...ch, donnees: forge }), new Date(T0).toISOString(), aleatoireDeterministe(3), ch.clesProjets, ch.moi)), HUGO);
    expect(bh.donnees.taches[s.t1].projetId).toBe(s.A);
    expect(bh.refusees).toBeGreaterThan(0);
  });

  it('visibilité : avertissement vers un projet partagé ; hors d’un projet partagé, la tâche disparaît chez le membre (pierre tombale)', () => {
    const s = scenario();
    // Privé → A : Léa et Hugo la verront.
    const an = analyserDeplacement(s.d, [s.t3], { listeId: s.lA }, FONDATEUR);
    expect(an.visibles.map(p => p.nom).sort()).toEqual(['Hugo', 'Léa']);
    expect(an.disparus).toEqual([]);
    // A → privé : elle disparaît chez Léa et Hugo.
    const an2 = analyserDeplacement(s.d, [s.t1], { listeId: s.lC }, FONDATEUR);
    expect(an2.disparus.map(p => p.nom).sort()).toEqual(['Hugo', 'Léa']);
    expect(an2.visibles).toEqual([]);
    // Léa a une copie avec la tâche ; le Fondateur la déplace dans C (privé).
    const lea = copieDe(s.d, LEA);
    expect(lea.donnees.taches[s.t1]).toBeDefined();
    const r = deplacerTaches(s.d, [s.t1], { listeId: s.lC }, f(), FONDATEUR);
    expect(tachesParties(r.donnees, LEA).sort()).toEqual([s.t1, s.t1a].sort());
    const doc = documentPourMembre(r.donnees, listeMembres(r.donnees).find(m => m.compte === LEA)!);
    expect(JSON.stringify(doc)).not.toContain('Maquette');
    const apres = appliquerReception(lea, doc);
    expect(apres.donnees.taches[s.t1]).toBeUndefined();
    expect(apres.donnees.taches[s.t1a]).toBeUndefined();
    // Remise dans A : elle revient chez Léa.
    const retour = deplacerTaches(r.donnees, [s.t1], { listeId: s.lA }, f(), FONDATEUR);
    expect(tachesParties(retour.donnees, LEA)).toEqual([]);
    const revenue = appliquerReception(apres, documentPourMembre(retour.donnees, listeMembres(retour.donnees).find(m => m.compte === LEA)!));
    expect(revenue.donnees.taches[s.t1]?.titre).toBe('Maquette');
    // Une tâche d'une autre app dans un projet partagé : signalée (jamais montrée aux membres).
    const auto = { ...s.d, taches: { ...s.d.taches, [s.t3]: { ...s.d.taches[s.t3], source: { app: 'prospects' as const, cle: 'x1' } } } };
    expect(analyserDeplacement(auto, [s.t3], { listeId: s.lA }, FONDATEUR).appsCachees).toBe(1);
    // `anciensProjets` est lu et borné.
    expect(lireTache({ ...r.donnees.taches[s.t1], anciensProjets: [s.A, 'X!', s.C] })?.anciensProjets).toEqual([s.A]);
  });

  it('chez un membre : l’avertissement nomme les personnes du projet d’arrivée', () => {
    const s = scenario();
    let d = changerDroit(s.d, s.B, LEA, 'ecriture', f());
    d = changerDroit(d, s.B, HUGO, 'ecriture', f());
    const lea = copieDe(d, LEA);
    const an = analyserDeplacement(lea.donnees, [s.t1], { listeId: s.lB }, { role: 'ami', moi: LEA }, lea.membres);
    // Hugo voit déjà A (lecture) et B : rien de nouveau ; personne ne la perd.
    expect(an.visibles).toEqual([]);
    expect(an.disparus).toEqual([]);
  });
});

// ------------------------------------------------------------------ Équipe

describe('menu Équipe', () => {
  const profils = [
    { id: 'admin00001', nom: 'Enzo', admin: true },
    { id: LEA, nom: 'Léa', apps: ['taches'], derniereConnexion: '2026-10-14T08:00:00.000Z' },
    { id: HUGO, nom: 'Hugo', apps: [], role: 'gestionnaire' },
    { id: 'zoe0000003', nom: 'Zoé', apps: ['tsuzuku'] },
  ];

  it('lignes : accès (même vérité que l’Administration), projets et droit, charge, dernière activité', () => {
    const s = scenario();
    let d = modifierTache(s.d, s.t1, { echeance: { jour: '2026-10-10' } }, f());
    d = ajouterTemps(d, s.t2, { jour: AUJ, minutes: 90 }, par(HUGO));
    d = ajouterCommentaire(d, s.t1, 'Je m’en occupe', par(LEA, 5000));
    const lignes = lignesEquipe(d, profils, AUJ);
    const lea = lignes.find(l => l.membre.compte === LEA)!;
    expect(lea.acces).toBe('ouvert');
    expect(lea.projets).toEqual([expect.objectContaining({ id: s.A, droit: 'ecriture' })]);
    expect(lea.charge).toEqual({ ouvertes: 1, enRetard: 1, minutesSemaine: 0 });
    expect(lea.derniere! > '2026-10-15').toBe(true);
    const hugo = lignes.find(l => l.membre.compte === HUGO)!;
    expect(hugo.acces).toBe('ferme');
    expect(hugo.projets.map(p => [p.id, p.droit])).toEqual([
      [s.A, 'lecture'],
      [s.B, 'ecriture'],
    ]);
    expect(hugo.charge.minutesSemaine).toBe(90);
    expect(etatAcces(LEA, undefined).acces).toBe('inconnu');
    expect(etatAcces(LEA, [{ id: LEA, nom: 'Léa', actif: false, apps: ['taches'] }, { id: 'x00000001', nom: 'X' }]).acces).toBe('desactive');
    // Invitables : profils du hub pas encore membres.
    expect(invitables(d, profils).map(p => p.nom)).toEqual(['Zoé']);
    // Filtres et recherche.
    expect(filtrerEquipe(lignes, { ...FILTRES_EQUIPE, recherche: 'lea' }).map(l => l.membre.nom)).toEqual(['Léa']);
    expect(filtrerEquipe(lignes, { ...FILTRES_EQUIPE, acces: 'ferme' }).map(l => l.membre.nom)).toEqual(['Hugo']);
    expect(filtrerEquipe(lignes, { ...FILTRES_EQUIPE, projet: s.B }).map(l => l.membre.nom)).toEqual(['Hugo']);
    expect(filtrerEquipe(lignes, { ...FILTRES_EQUIPE, retard: true }).map(l => l.membre.nom)).toEqual(['Léa']);
    expect(filtrerEquipe(lignes, { ...FILTRES_EQUIPE, rang: 'gestionnaire' }).map(l => l.membre.nom)).toEqual(['Hugo']);
  });

  it('profils supprimés du hub : signalés, jamais retirés automatiquement', () => {
    const s = scenario();
    const sansHugo = profils.filter(p => p.id !== HUGO);
    expect(profilsSupprimes(s.d, sansHugo).map(m => m.nom)).toEqual(['Hugo']);
    expect(profilsSupprimes(s.d, undefined)).toEqual([]);
    expect(profilsSupprimes(s.d, [profils[0]])).toEqual([]);
  });

  it('matrice : droits en masse, retirer fait tourner la clé du projet', () => {
    const s = scenario();
    const m = matriceDroits(s.d);
    expect(m.projets.map(p => p.nom)).toEqual(['Site', 'Appli', 'Privé']);
    expect(m.droits[LEA]).toEqual({ [s.A]: 'ecriture', [s.B]: 'aucun', [s.C]: 'aucun' });
    const cleA = s.d.reglages.clesProjets![s.A].cle;
    const r = appliquerMatrice(
      s.d,
      [
        { projetId: s.B, compte: LEA, droit: 'admin' },
        { projetId: s.C, compte: LEA, droit: 'lecture' },
        { projetId: s.A, compte: HUGO, droit: 'aucun' },
        { projetId: s.A, compte: LEA, droit: 'ecriture' },
      ],
      f(),
    );
    expect(r.nb).toBe(3);
    expect(droitDe(r.donnees, s.B, LEA)).toBe('admin');
    expect(droitDe(r.donnees, s.C, LEA)).toBe('lecture');
    expect(droitDe(r.donnees, s.A, HUGO)).toBe('aucun');
    expect(r.donnees.reglages.clesProjets![s.A].cle).not.toBe(cleA);
    expect(r.donnees.reglages.clesProjets![s.C]).toBeDefined();
    expect(() => appliquerMatrice(s.d, [{ projetId: s.A, compte: LEA, droit: 'lecture' }], { ...par(LEA), aleaOctets: aleatoireDeterministe(1) })).toThrow(ErreurTaches);
  });

  it('retirer d’un projet ou de tous (révocation + rotation), puis réassigner ses tâches', () => {
    const s = scenario();
    const cleA = s.d.reglages.clesProjets![s.A].cle;
    const cleB = s.d.reglages.clesProjets![s.B].cle;
    let d = retirerDesProjets(s.d, HUGO, [s.B], f());
    expect(droitDe(d, s.B, HUGO)).toBe('aucun');
    expect(droitDe(d, s.A, HUGO)).toBe('lecture');
    expect(d.reglages.clesProjets![s.B].cle).not.toBe(cleB);
    d = retirerDesProjets(d, HUGO, 'tous', f());
    expect(droitDe(d, s.A, HUGO)).toBe('aucun');
    expect(d.reglages.clesProjets![s.A].cle).not.toBe(cleA);
    // Toujours membre (sans projet).
    expect(listeMembres(d).some(m => m.compte === HUGO)).toBe(true);
    // Ses tâches : à Léa (qui ne voit pas B : ignorée), ou au Fondateur.
    let r = reassignerTaches(d, HUGO, LEA, f());
    expect(r).toMatchObject({ nb: 1, ignorees: 1 });
    expect(assignesDe(r.donnees.taches[s.t2])).toEqual([]);
    r = reassignerTaches(d, HUGO, 'fondateur', f(), {}, { fondateur: 'Enzo' });
    expect(assignesDe(r.donnees.taches[s.t2])).toEqual(['fondateur']);
    expect(r.donnees.taches[s.t2].historique.at(-1)!.texte).toBe('Assignée à Enzo');
    // Seulement dans certains projets ; terminées laissées.
    const fini = modifierTache(s.d, s.t1, { statut: 'fait' }, f());
    expect(reassignerTaches(fini, LEA, 'fondateur', f()).nb).toBe(0);
    expect(reassignerTaches(fini, LEA, 'fondateur', f(), { toutes: true }).nb).toBe(1);
    expect(reassignerTaches(s.d, LEA, 'fondateur', f(), { projets: [s.B] }).nb).toBe(0);
    // Seul le Fondateur.
    expect(() => reassignerTaches(s.d, LEA, HUGO, par(LEA))).toThrow(ErreurTaches);
    // Le membre retiré ne reçoit plus le projet ; ce qu'il renvoie est refusé.
    expect(Object.keys(documentPourMembre(d, listeMembres(d).find(m => m.compte === HUGO)!).donnees.projets)).toEqual([]);
  });

  it('fiche d’un membre : ses tâches, son activité récente, ses débriefings', () => {
    const s = scenario();
    let d = changerDroit(s.d, s.B, LEA, 'ecriture', f());
    d = modifierTache(d, s.t2, { assignes: [HUGO, LEA] }, f());
    d = ajouterCommentaire(d, s.t1, 'Première version prête', par(LEA));
    d = modifierTache(d, s.t1, { priorite: 'haute' }, par(LEA));
    // Entrées de Léa (telles que le Fondateur les reçoit de son retour).
    const deLea = (dd: DonneesTaches, jour: string, texte: string) => {
      const r = ajouterEntree(dd, { projetId: s.A, jour, texte, tacheId: s.t1 }, f());
      return { ...r.donnees, journal: { ...r.donnees.journal, [r.entree.id]: { ...r.entree, auteur: LEA, h: r.entree.h.replace('|f', `|${LEA}`) } } };
    };
    d = deLea(d, AUJ, 'Maquette envoyée');
    d = deLea(d, '2026-10-14', 'Recherches');
    expect(tachesDuMembre(d, LEA).map(t => t.titre)).toEqual(['API', 'Maquette']);
    const act = activiteRecente(d, LEA);
    expect(act.map(a => a.texte)).toEqual(expect.arrayContaining(['Priorité : Normale → Haute — « Maquette »', 'A commenté « Maquette » : Première version prête', 'Journal : Maquette envoyée']));
    const deb = debriefingsDe(d, LEA, '2026-10-01');
    expect(deb.map(g => [g.jour, g.entrees.map(e => e.texte)])).toEqual([
      [AUJ, ['Maquette envoyée']],
      ['2026-10-14', ['Recherches']],
    ]);
    expect(chargeDe(d, LEA, AUJ).ouvertes).toBe(2);
  });

  it('vue d’un membre : l’équipe des projets qu’il partage, en lecture seule', () => {
    const s = scenario();
    const hugo = copieDe(s.d, HUGO);
    const eq = equipeVueMembre(hugo.donnees, { ...hugo.membres, fondateur: 'Enzo' }, AUJ);
    expect(eq.map(p => p.nom)).toEqual(['Enzo', 'Hugo', 'Léa']);
    expect(eq.find(p => p.code === LEA)!.projets).toEqual([expect.objectContaining({ id: s.A, droit: 'ecriture' })]);
    expect(eq.find(p => p.code === HUGO)!.projets.map(p => p.droit)).toEqual(['lecture', 'ecriture']);
    // Rien de ses projets privés, ni de droits d'autrui sur des projets qu'il ne voit pas.
    expect(JSON.stringify(eq)).not.toContain('Privé');
    expect(droitsProjet('ami', hugo.donnees, s.A, HUGO).gerer).toBe(false);
  });
});
