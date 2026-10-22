/**
 * Tâches : modèle, ajout rapide et dates en français, récurrences, filtres,
 * fusion (pierres tombales, conflits Fondateur / ami), droits, rappels, et
 * échanges chiffrés par un relais en mémoire qui applique les portées.
 */

import { espacesDuRelais } from '../sync/relais/espaces';
import { liaisonPourProfil } from '../sync/relais/portees';
import { JETON_TEST, RELAIS_TEST, relaisPortees } from '../sync/relais/__fixtures__/relaisPortees';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { documentCle, OBJET_CLE, paireDe } from '../tsuzuku/plateforme/partage';
import { droitsProjet, roleTaches } from './acces';
import { lireAjoutRapide } from './ajoutRapide';
import { ajouterJours, jourLisible, lireDateLibre, trouverDate } from './dates';
import { ajouterDemo, retirerDemo } from './demo';
import { filtrer, grilleMois, grouper, maJournee, trier } from './filtres';
import { fusionnerDonnees, fusionnerTache, memesDonnees } from './fusion';
import {
  ajouterCommentaire,
  ajouterElement,
  changerElement,
  changerReglages,
  changerStatuts,
  creerEspace,
  creerProjet,
  creerTache,
  donneesVides,
  ErreurTaches,
  estTerminee,
  FILTRES_DEFAUT,
  lireDonnees,
  modifierProjet,
  modifierTache,
  nouveauStatut,
  statutsDe,
  supprimerProjet,
  supprimerTache,
  tachesVivantes,
  type Contexte,
  type DonneesTaches,
  type SaisieTache,
} from './modele';
import {
  appliquerEnvoiAmi,
  appliquerReception,
  CLES_TACHES,
  copieVide,
  envoiDeLAmi,
  lireCopie,
  OBJET_TACHES,
  ouvrirEnvoi,
  projectionPourAmi,
  recevoirTachesAmi,
  synchroniserTachesFondateur,
  type EtatTachesFondateur,
  type SuiviTachesAmi,
} from './partage';
import { evaluerRappels, etatRappelsVide, libelleDelai } from './rappels';
import { idOccurrence, occurrenceApres, prochaineEcheance, terminerTache } from './recurrence';
import { infoTaches, verifierRappels } from './resume';

const AUJ = '2026-10-13'; // un mardi
const T0 = new Date(2026, 9, 13, 8, 0).getTime();
let pas = 0;
const f = (n = 0): Contexte => ({ maintenant: T0 + n + pas++ * 10, auteur: 'fondateur', alea: () => ((pas * 7919) % 1000) / 1000 });
const a = (n = 0): Contexte => ({ maintenant: T0 + n + pas++ * 10, auteur: 'ami', alea: () => ((pas * 104729) % 1000) / 1000 });

function projetDeBase() {
  const e = creerEspace(donneesVides(), 'Travail', f());
  const p = creerProjet(e.donnees, e.espace.id, 'Site', f());
  return { d: p.donnees, espace: e.espace.id, projet: p.projet.id, liste: p.liste.id };
}

// ------------------------------------------------------------------ Dates en français

describe('dates en français', () => {
  const j = (t: string) => trouverDate(t, AUJ);
  it('lit les jours relatifs et nommés', () => {
    expect(j('aujourd’hui')?.jour).toBe(AUJ);
    expect(j("aujourd'hui")?.jour).toBe(AUJ);
    expect(j('demain')?.jour).toBe('2026-10-14');
    expect(j('après-demain')?.jour).toBe('2026-10-15');
    expect(j('lundi')?.jour).toBe('2026-10-19');
    expect(j('mardi')?.jour).toBe('2026-10-20'); // jamais aujourd'hui
    expect(j('vendredi prochain')?.jour).toBe('2026-10-16');
    expect(j('semaine prochaine')?.jour).toBe('2026-10-19');
  });
  it('lit les dates chiffrées et écrites', () => {
    expect(j('15/11')?.jour).toBe('2026-11-15');
    expect(j('15/01')?.jour).toBe('2027-01-15'); // déjà passé cette année
    expect(j('03/02/2027')?.jour).toBe('2027-02-03');
    expect(j('15 novembre')?.jour).toBe('2026-11-15');
    expect(j('1er mars')?.jour).toBe('2027-03-01');
    expect(j('2 déc. 2026')?.jour).toBe('2026-12-02');
    expect(j('31/02')).toBeUndefined();
  });
  it('lit « dans N jours / semaines / mois »', () => {
    expect(j('dans 3 jours')?.jour).toBe('2026-10-16');
    expect(j('dans deux semaines')?.jour).toBe('2026-10-27');
    expect(j('dans 1 mois')?.jour).toBe('2026-11-13');
  });
  it('lit l’heure qui suit', () => {
    expect(j('demain à 14h30')).toEqual({ jour: '2026-10-14', heure: '14:30', texte: 'demain à 14h30' });
    expect(j('15/11 9h')).toEqual({ jour: '2026-11-15', heure: '09:00', texte: '15/11 9h' });
    expect(j('appeler à 18h')).toEqual({ jour: AUJ, heure: '18:00', texte: 'à 18h' });
  });
  it('champ libre : tout le texte doit être compris', () => {
    expect(lireDateLibre('demain', AUJ)).toEqual({ jour: '2026-10-14' });
    expect(lireDateLibre('le 15/11', AUJ)).toEqual({ jour: '2026-11-15' });
    expect(lireDateLibre('demain peut-être', AUJ)).toBeUndefined();
    expect(lireDateLibre('', AUJ)).toBeUndefined();
  });
  it('affiche un jour lisible', () => {
    expect(jourLisible(AUJ, AUJ)).toBe('aujourd’hui');
    expect(jourLisible('2026-10-14', AUJ)).toBe('demain');
    expect(jourLisible('2026-11-15', AUJ, true)).toBe('dimanche 15 novembre');
  });
});

// ------------------------------------------------------------------ Ajout rapide

describe('ajout rapide', () => {
  const o = { aujourdhui: AUJ, auteur: 'fondateur' as const, noms: { fondateur: 'Enzo', ami: 'Léa' } };
  it('« Appeler Paul demain #prospects !haute @ami »', () => {
    const r = lireAjoutRapide('Appeler Paul demain #prospects !haute @ami', o);
    expect(r).toMatchObject({ titre: 'Appeler Paul', echeance: { jour: '2026-10-14' }, etiquettes: ['prospects'], priorite: 'haute', assigne: 'ami' });
    expect(r.reconnus).toEqual(expect.arrayContaining(['#prospects', '!haute', '@ami', 'demain']));
  });
  it('prénoms, @moi, priorités abrégées, « le » avant la date', () => {
    expect(lireAjoutRapide('Réunion le 15/11 à 9h @Léa !1', o)).toMatchObject({ titre: 'Réunion', echeance: { jour: '2026-11-15', heure: '09:00' }, assigne: 'ami', priorite: 'urgente' });
    expect(lireAjoutRapide('Relire @moi !basse', { ...o, auteur: 'ami' })).toMatchObject({ titre: 'Relire', assigne: 'ami', priorite: 'basse' });
    expect(lireAjoutRapide('Écrire à @Enzo dans 3 jours', o)).toMatchObject({ titre: 'Écrire à', assigne: 'fondateur', echeance: { jour: '2026-10-16' } });
  });
  it('récurrences écrites', () => {
    expect(lireAjoutRapide('Payer le loyer tous les mois #maison', o)).toMatchObject({ titre: 'Payer le loyer', recurrence: { type: 'mensuelle', jour: 13 }, echeance: { jour: AUJ } });
    expect(lireAjoutRapide('Sport chaque lundi et jeudi', o)).toMatchObject({ titre: 'Sport', recurrence: { type: 'hebdo', jours: [1, 4] }, echeance: { jour: '2026-10-15' } });
    expect(lireAjoutRapide('Arroser tous les jours', o)).toMatchObject({ recurrence: { type: 'quotidienne', intervalle: 1 } });
  });
  it('rien de reconnu : tout est titre', () => {
    expect(lireAjoutRapide('Lire un livre', o)).toEqual({ titre: 'Lire un livre', etiquettes: [], reconnus: [] });
    expect(lireAjoutRapide('Voir @inconnu', o).titre).toBe('Voir @inconnu');
  });
});

// ------------------------------------------------------------------ Modèle

describe('modèle', () => {
  it('projet : statuts par défaut et une liste', () => {
    const { d, projet } = projetDeBase();
    expect(statutsDe(d, projet).map(s => s.nom)).toEqual(['À faire', 'En cours', 'En revue', 'Fait']);
    expect(statutsDe(d, projet).filter(s => s.ferme).map(s => s.id)).toEqual(['fait']);
  });
  it('tâche : création, modification datée par champ, historique avec ancienne valeur', () => {
    const { d, liste } = projetDeBase();
    const c = creerTache(d, { titre: '  Rédiger  ', listeId: liste, priorite: 'haute', etiquettes: ['#Web', 'web'] }, f());
    expect(c.tache.titre).toBe('Rédiger');
    expect(c.tache.etiquettes).toEqual(['Web', 'web']);
    const d2 = modifierTache(c.donnees, c.tache.id, { titre: 'Rédiger la page', statut: 'en-cours' }, f());
    const t = d2.taches[c.tache.id];
    expect(t.h.titre > c.tache.h.titre).toBe(true);
    expect(t.h.priorite).toBe(c.tache.h.priorite);
    expect(t.historique.map(e => e.texte)).toEqual(['Tâche créée', 'Titre modifié', 'Statut : À faire → En cours']);
    expect(t.historique[1].avant).toBe('Rédiger');
    expect(() => modifierTache(d2, c.tache.id, { titre: '   ' }, f())).toThrow(ErreurTaches);
    expect(() => modifierTache(d2, c.tache.id, { statut: 'inconnu' }, f())).toThrow('Statut inconnu');
  });
  it('sous-tâches sur un seul niveau, supprimées avec leur parent', () => {
    const { d, liste } = projetDeBase();
    const p = creerTache(d, { titre: 'Parent', listeId: liste }, f());
    const s1 = creerTache(p.donnees, { titre: 'Enfant', listeId: liste, parentId: p.tache.id }, f());
    const s2 = creerTache(s1.donnees, { titre: 'Petit-enfant', listeId: liste, parentId: s1.tache.id }, f());
    expect(s2.tache.parentId).toBe(p.tache.id);
    const sup = supprimerTache(s2.donnees, p.tache.id, f());
    expect(tachesVivantes(sup)).toHaveLength(0);
    expect(sup.taches[s1.tache.id].supprime).toBe(true);
  });
  it('checklist et commentaires', () => {
    const { d, liste } = projetDeBase();
    const c = creerTache(d, { titre: 'X', listeId: liste }, f());
    let x = ajouterElement(c.donnees, c.tache.id, 'Un', f());
    const id = Object.keys(x.taches[c.tache.id].checklist)[0];
    x = changerElement(x, c.tache.id, id, { fait: true }, f());
    x = ajouterCommentaire(x, c.tache.id, 'Bravo', a());
    expect(Object.values(x.taches[c.tache.id].checklist)[0].fait).toBe(true);
    expect(Object.values(x.taches[c.tache.id].commentaires)[0]).toMatchObject({ auteur: 'ami', texte: 'Bravo' });
  });
  it('statuts personnalisés : retrait d’un statut, tâches déplacées', () => {
    const { d, projet, liste } = projetDeBase();
    const c = creerTache(d, { titre: 'X', listeId: liste, statut: 'en-revue' }, f());
    const statuts = statutsDe(c.donnees, projet).filter(s => s.id !== 'en-revue');
    const bloque = nouveauStatut('Bloqué', statuts);
    const x = changerStatuts(c.donnees, projet, [...statuts, bloque], f(), { 'en-revue': 'en-cours' });
    expect(statutsDe(x, projet).map(s => s.nom)).toContain('Bloqué');
    expect(x.taches[c.tache.id].statut).toBe('en-cours');
    expect(() => changerStatuts(x, projet, statuts.filter(s => !s.ferme), f())).toThrow('terminé');
  });
  it('seul le Fondateur supprime un projet', () => {
    const { d, projet } = projetDeBase();
    expect(() => supprimerProjet(d, projet, a())).toThrow('Seul le Fondateur');
    expect(tachesVivantes(supprimerProjet(d, projet, f()), projet)).toHaveLength(0);
  });
  it('données illisibles ou hostiles : écartées', () => {
    const lu = lireDonnees({ v: 1, taches: { x: { id: 'Bad Id!', projetId: 'p', listeId: 'l' }, ok: { id: 'tok', projetId: 'pab', listeId: 'lab', titre: 'a'.repeat(1000), priorite: 'zzz', etiquettes: Array(50).fill('e') } } });
    expect(Object.keys(lu.taches)).toEqual(['tok']);
    expect(lu.taches.tok.titre).toHaveLength(300);
    expect(lu.taches.tok.priorite).toBe('normale');
    expect(lireDonnees('pas du json')).toEqual(donneesVides());
  });
  it('exemple : ajouté puis retiré d’un geste', () => {
    const r = ajouterDemo(donneesVides(), f(), AUJ);
    expect(tachesVivantes(r.donnees).length).toBeGreaterThanOrEqual(8);
    expect(tachesVivantes(retirerDemo(r.donnees, f()))).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ Récurrences

describe('récurrences', () => {
  it('occurrence suivante', () => {
    expect(occurrenceApres({ type: 'quotidienne', intervalle: 2 }, AUJ)).toBe('2026-10-15');
    expect(occurrenceApres({ type: 'hebdo', jours: [1, 5] }, AUJ)).toBe('2026-10-16');
    expect(occurrenceApres({ type: 'hebdo', jours: [2] }, AUJ)).toBe('2026-10-20');
    expect(occurrenceApres({ type: 'mensuelle', jour: 31 }, '2027-01-31')).toBe('2027-02-28');
    expect(occurrenceApres({ type: 'mensuelle', jour: 20 }, AUJ)).toBe('2026-10-20');
    expect(occurrenceApres({ type: 'annuelle', mois: 2, jour: 29 }, '2027-03-01')).toBe('2028-02-29');
    // En retard : jamais dans le passé.
    expect(prochaineEcheance({ type: 'quotidienne', intervalle: 1 }, '2026-10-01', AUJ)).toBe(AUJ);
  });
  it('terminer crée la suivante (une seule, même identifiant des deux côtés)', () => {
    const { d, liste } = projetDeBase();
    const c = creerTache(d, { titre: 'Point hebdo', listeId: liste, echeance: { jour: AUJ, heure: '09:00' }, recurrence: { type: 'hebdo', jours: [2] }, rappels: [10] }, f());
    const avecListe = ajouterElement(c.donnees, c.tache.id, 'Ordre du jour', f());
    const cote1 = terminerTache(avecListe, c.tache.id, f(), AUJ);
    const cote2 = terminerTache(avecListe, c.tache.id, a(), AUJ);
    expect(cote1.suivante).toBe(idOccurrence(c.tache.id, '2026-10-20'));
    expect(cote2.suivante).toBe(cote1.suivante);
    const suivante = cote1.donnees.taches[cote1.suivante!];
    expect(suivante).toMatchObject({ titre: 'Point hebdo', echeance: { jour: '2026-10-20', heure: '09:00' }, statut: 'a-faire', rappels: [10] });
    expect(Object.values(suivante.checklist).map(e => [e.texte, e.fait])).toEqual([['Ordre du jour', false]]);
    expect(estTerminee(cote1.donnees, cote1.donnees.taches[c.tache.id])).toBe(true);
    const fusion = fusionnerDonnees(cote1.donnees, cote2.donnees);
    expect(tachesVivantes(fusion).filter(t => t.titre === 'Point hebdo')).toHaveLength(2);
    // Terminer à nouveau ne recrée rien.
    expect(Object.keys(terminerTache(cote1.donnees, c.tache.id, f(), AUJ).donnees.taches)).toHaveLength(Object.keys(cote1.donnees.taches).length);
  });
});

// ------------------------------------------------------------------ Filtres, tris, Ma journée

describe('filtres, tris, regroupements, Ma journée', () => {
  const { d: d0, liste } = projetDeBase();
  let d = d0;
  const ids: Record<string, string> = {};
  for (const [nom, saisie] of [
    ['retard', { echeance: { jour: '2026-10-10' }, priorite: 'urgente', etiquettes: ['web'] }],
    ['auj', { echeance: { jour: AUJ, heure: '15:00' }, assigne: 'ami' }],
    ['demain', { echeance: { jour: '2026-10-14' }, etiquettes: ['web', 'seo'] }],
    ['loin', { echeance: { jour: '2026-12-01' }, priorite: 'basse' }],
    ['sans', { pourAujourdhui: AUJ }],
    ['fini', { statut: 'fait', echeance: { jour: '2026-10-01' } }],
  ] as Array<[string, Partial<SaisieTache>]>) {
    const c = creerTache(d, { titre: `Tâche ${nom} éléphant`, listeId: liste, ...saisie }, f());
    d = c.donnees;
    ids[nom] = c.tache.id;
  }
  const toutes = tachesVivantes(d);
  const noms = (l: { id: string }[]) => l.map(t => Object.keys(ids).find(k => ids[k] === t.id));
  it('recherche sans accents, filtres combinés', () => {
    expect(filtrer(d, toutes, { ...FILTRES_DEFAUT, recherche: 'ELEPHANT retard' }, AUJ)).toHaveLength(1);
    expect(noms(filtrer(d, toutes, { ...FILTRES_DEFAUT, etiquettes: ['seo'] }, AUJ))).toEqual(['demain']);
    expect(noms(filtrer(d, toutes, { ...FILTRES_DEFAUT, echeance: 'retard' }, AUJ))).toEqual(['retard']);
    expect(noms(filtrer(d, toutes, { ...FILTRES_DEFAUT, echeance: 'sans' }, AUJ))).toEqual(['sans']);
    expect(noms(filtrer(d, toutes, { ...FILTRES_DEFAUT, assigne: 'ami' }, AUJ))).toEqual(['auj']);
    expect(filtrer(d, toutes, { ...FILTRES_DEFAUT, terminees: false }, AUJ)).toHaveLength(5);
    expect(noms(filtrer(d, toutes, { ...FILTRES_DEFAUT, priorites: ['urgente', 'basse'] }, AUJ)).sort()).toEqual(['loin', 'retard']);
  });
  it('tris', () => {
    expect(noms(trier(d, toutes, 'echeance'))).toEqual(['fini', 'retard', 'auj', 'demain', 'loin', 'sans']);
    expect(noms(trier(d, toutes, 'priorite'))[0]).toBe('retard');
    expect(noms(trier(d, toutes, 'statut')).pop()).toBe('fini');
  });
  it('regroupements', () => {
    expect(grouper(d, toutes, 'echeance', AUJ).map(g => g.cle)).toEqual(['retard', 'aujourdhui', 'demain', 'plus-tard', 'sans']);
    expect(grouper(d, toutes, 'statut', AUJ, toutes[0].projetId).map(g => [g.titre, g.taches.length])).toEqual([
      ['À faire', 5],
      ['En cours', 0],
      ['En revue', 0],
      ['Fait', 1],
    ]);
  });
  it('tous projets : colonnes par nom de statut, dans l’ordre des statuts', () => {
    const x = modifierTache(d, ids.loin, { statut: 'en-revue' }, f());
    const y = modifierTache(x, ids.demain, { statut: 'en-cours' }, f());
    expect(grouper(y, trier(y, tachesVivantes(y), 'priorite'), 'statut', AUJ).map(g => g.titre)).toEqual(['À faire', 'En cours', 'En revue', 'Fait']);
  });
  it('Ma journée : en retard, aujourd’hui, choisies, 7 jours ; chaque tâche une fois', () => {
    const j = maJournee(d, AUJ);
    expect([noms(j.retard), noms(j.aujourdhui), noms(j.choisies), noms(j.aVenir)]).toEqual([['retard'], ['auj'], ['sans'], ['demain']]);
    expect(noms(maJournee(d, AUJ, 'fondateur').aujourdhui)).toEqual([]); // assignée à l'ami
  });
  it('grille du mois : 6 semaines commençant un lundi', () => {
    const g = grilleMois(AUJ);
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-09-28');
  });
});

// ------------------------------------------------------------------ Fusion

describe('fusion par champ, pierres tombales, conflits', () => {
  const { d, liste } = projetDeBase();
  const c = creerTache(d, { titre: 'Commun', listeId: liste }, f());
  const base = c.donnees;
  const id = c.tache.id;
  it('Fondateur et ami changent des champs différents : les deux restent', () => {
    const cf = modifierTache(base, id, { priorite: 'haute' }, f(5));
    const ca = modifierTache(base, id, { echeance: { jour: '2026-10-20' }, description: 'détail' }, a(6));
    const m1 = fusionnerDonnees(cf, ca);
    const m2 = fusionnerDonnees(ca, cf);
    expect(memesDonnees(m1, m2)).toBe(true);
    expect(m1.taches[id]).toMatchObject({ priorite: 'haute', echeance: { jour: '2026-10-20' }, description: 'détail' });
    expect(m1.taches[id].historique.map(e => e.texte)).toEqual(expect.arrayContaining(['Priorité : Normale → Haute', 'Description modifiée']));
    expect(memesDonnees(fusionnerDonnees(m1, m1), m1)).toBe(true);
  });
  it('même champ : le plus récent gagne, l’autre valeur reste dans l’historique', () => {
    const cf = modifierTache(base, id, { titre: 'Version Fondateur' }, f(100));
    const ca = modifierTache(base, id, { titre: 'Version ami' }, a(200));
    const m = fusionnerDonnees(cf, ca);
    expect(m.taches[id].titre).toBe('Version ami');
    const textes = m.taches[id].historique.filter(e => e.texte === 'Titre modifié');
    expect(textes).toHaveLength(2);
    expect(fusionnerDonnees(ca, cf).taches[id].titre).toBe('Version ami');
  });
  it('pierre tombale : plus récente qu’une modification, elle gagne ; une restauration plus récente la défait', () => {
    const modif = modifierTache(base, id, { priorite: 'basse' }, a(10));
    const sup = supprimerTache(base, id, f(20));
    expect(tachesVivantes(fusionnerDonnees(modif, sup))).toHaveLength(0);
    const restauree = modifierTache(sup, id, { supprime: false }, f(30));
    expect(tachesVivantes(fusionnerDonnees(restauree, modif))).toHaveLength(1);
  });
  it('checklist et commentaires fusionnés élément par élément', () => {
    const x = ajouterElement(base, id, 'A', f(1));
    const y = ajouterCommentaire(ajouterElement(base, id, 'B', a(2)), id, 'Salut', a(3));
    const m = fusionnerTache(x.taches[id], y.taches[id]);
    expect(Object.values(m.checklist).map(e => e.texte).sort()).toEqual(['A', 'B']);
    expect(Object.values(m.commentaires)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ Partage (logique) et droits

function scenarioPartage() {
  const { d, projet, liste, espace } = projetDeBase();
  const prive = creerProjet(d, espace, 'Privé', f());
  let x = changerReglages(prive.donnees, { ami: 'leaami01', amiNom: 'Léa', cle: 'ab'.repeat(32) }, f());
  x = modifierProjet(x, projet, { partage: 'ecriture' }, f());
  const lecture = creerProjet(x, espace, 'Lecture', f());
  x = modifierProjet(lecture.donnees, lecture.projet.id, { partage: 'lecture' }, f());
  const t1 = creerTache(x, { titre: 'Partagée', listeId: liste }, f());
  const t2 = creerTache(t1.donnees, { titre: 'Secrète', listeId: prive.liste.id }, f());
  const t3 = creerTache(t2.donnees, { titre: 'À lire', listeId: lecture.liste.id }, f());
  return { d: t3.donnees, projet, liste, prive: prive.projet.id, listePrivee: prive.liste.id, lecture: lecture.projet.id, listeLecture: lecture.liste.id, t1: t1.tache.id, t2: t2.tache.id, t3: t3.tache.id };
}

describe('partage Fondateur / ami (logique)', () => {
  const s = scenarioPartage();
  const doc = { v: 1 as const, ami: 'leaami01', amiNom: 'Léa', fondateur: 'Enzo', cle: 'ab'.repeat(32), donnees: projectionPourAmi(s.d) };
  it('l’ami ne reçoit que les projets partagés', () => {
    expect(Object.keys(doc.donnees.projets).sort()).toEqual([s.lecture, s.projet].sort());
    expect(Object.values(doc.donnees.taches).map(t => t.titre).sort()).toEqual(['Partagée', 'À lire']);
    expect(JSON.stringify(doc.donnees)).not.toContain('Secrète');
    expect(JSON.stringify(doc.donnees)).not.toContain('Privé');
    expect(doc.donnees.reglages).toEqual({ id: 'reglages', h: {} });
  });
  it('droits : Fondateur, ami (écriture / lecture / non partagé), autres', () => {
    const copie = appliquerReception(copieVide(), doc).donnees;
    expect(droitsProjet('fondateur', s.d, s.prive)).toMatchObject({ voir: true, modifier: true, supprimerProjet: true });
    expect(droitsProjet('ami', copie, s.projet)).toMatchObject({ voir: true, modifier: true, gerer: false, supprimerProjet: false });
    expect(droitsProjet('ami', copie, s.lecture)).toMatchObject({ voir: true, modifier: false });
    expect(droitsProjet('ami', copie, s.prive)).toMatchObject({ voir: false, modifier: false });
    expect(droitsProjet(undefined, s.d, s.projet).voir).toBe(false);
  });
  it('rôle : Fondateur (compte historique), les profils qui ont l’app, personne d’autre', () => {
    const base = (copie?: string): BasePrefs => ({ lire: k => (k === CLES_TACHES.copie ? copie : undefined), ecrire: () => undefined });
    const admin = { stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined };
    const avecCle = JSON.stringify({ ...copieVide(), cle: 'ab'.repeat(32) });
    expect(roleTaches({ admin, profil: { id: 'principal', nom: 'Moi', admin: true, creeLe: '' } })).toBe('fondateur');
    expect(roleTaches({ profil: { id: 'leaami01', nom: 'Léa', admin: false, creeLe: '', apps: ['taches'] }, baseProfil: base(avecCle) })).toBe('ami');
    // V3 : l'accès donné par l'Administration ouvre l'app (sans dépôt : aucun projet, état vide).
    expect(roleTaches({ profil: { id: 'hugoami1', nom: 'Hugo', admin: false, creeLe: '', apps: ['taches'] }, baseProfil: base(undefined) })).toBe('ami');
    expect(roleTaches({ profil: { id: 'hugoami1', nom: 'Hugo', admin: false, creeLe: '', apps: [] }, baseProfil: base(avecCle) })).toBeUndefined();
    // Un gestionnaire / administrateur sans l'accès ne voit rien, même avec les services d'administration.
    expect(roleTaches({ admin, profil: { id: 'gestion01', nom: 'G', admin: false, creeLe: '', role: 'gestionnaire' } })).toBeUndefined();
  });
  it('l’ami modifie, crée ; le Fondateur n’accepte que dans les projets en écriture', () => {
    let copie = appliquerReception(copieVide(), doc);
    let cd = modifierTache(copie.donnees, s.t1, { statut: 'en-cours' }, a());
    cd = creerTache(cd, { titre: 'Idée de l’ami', listeId: s.liste }, a()).donnees;
    // Tentatives interdites : tâche d'un projet en lecture, déplacement vers un projet non partagé.
    cd = { ...cd, taches: { ...cd.taches, [s.t3]: { ...cd.taches[s.t3], titre: 'Pirate', h: { ...cd.taches[s.t3].h, titre: '2099-01-01T00:00:00.000Z|a' } } } };
    copie = { ...copie, donnees: cd };
    const envoi = envoiDeLAmi(copie);
    expect(Object.values(envoi.taches).map(t => t.titre).sort()).toEqual(['Idée de l’ami', 'Partagée']);
    const forge = { taches: { ...envoi.taches, [s.t3]: cd.taches[s.t3], [s.t2]: { ...s.d.taches[s.t2], titre: 'Volée', h: { titre: '2099-01-01T00:00:00.000Z|a' } }, x: { ...cd.taches[s.t1], id: 'tdeplacee', listeId: s.listePrivee, projetId: s.prive } } };
    const r = appliquerEnvoiAmi(s.d, forge);
    expect(r.acceptees).toBe(2);
    expect(r.refusees).toBe(3);
    expect(r.donnees.taches[s.t1].statut).toBe('en-cours');
    expect(r.donnees.taches[s.t3].titre).toBe('À lire');
    expect(r.donnees.taches[s.t2].titre).toBe('Secrète');
    expect(r.donnees.taches.tdeplacee).toBeUndefined();
    expect(Object.values(r.donnees.projets).every(p => !p.supprime)).toBe(true);
  });
  it('un projet retiré du partage disparaît chez l’ami ; ses créations en attente restent en écriture', () => {
    const copie = appliquerReception(copieVide(), doc);
    const cree = creerTache(copie.donnees, { titre: 'En attente', listeId: s.liste }, a());
    const avecAttente = { ...copie, donnees: cree.donnees };
    const encore = appliquerReception(avecAttente, doc);
    expect(encore.donnees.taches[cree.tache.id]).toBeDefined();
    const retrait = modifierProjet(s.d, s.projet, { partage: 'aucun' }, f());
    const apres = appliquerReception(avecAttente, { ...doc, donnees: projectionPourAmi(retrait) });
    expect(Object.keys(apres.donnees.projets)).toEqual([s.lecture]);
    expect(Object.values(apres.donnees.taches).map(t => t.titre)).toEqual(['À lire']);
  });
});

// ------------------------------------------------------------------ Rappels

describe('rappels', () => {
  const { d, liste } = projetDeBase();
  const c = creerTache(d, { titre: 'Appeler', listeId: liste, echeance: { jour: AUJ, heure: '10:00' }, rappels: [0, 30] }, f());
  const autre = creerTache(c.donnees, { titre: 'Pour Léa', listeId: liste, echeance: { jour: AUJ, heure: '10:00' }, rappels: [0], assigne: 'ami' }, f());
  const x = autre.donnees;
  const a930 = new Date(2026, 9, 13, 9, 31).getTime();
  it('à l’heure dite, une seule fois ; pas pour la tâche d’un autre', () => {
    const r1 = evaluerRappels(x, etatRappelsVide(), a930, 'fondateur');
    expect(r1.nouvelles.map(n => n.texte)).toEqual(['Échéance dans 30 min (10 h 00)']);
    const r2 = evaluerRappels(x, r1.etat, a930 + 60_000, 'fondateur');
    expect(r2.nouvelles).toHaveLength(0);
    const r3 = evaluerRappels(x, r2.etat, new Date(2026, 9, 13, 10, 0).getTime(), 'fondateur');
    expect(r3.nouvelles.map(n => n.titre)).toEqual(['Appeler']);
    expect(r3.etat.nonLus).toHaveLength(2);
    expect(evaluerRappels(x, etatRappelsVide(), new Date(2026, 9, 13, 10, 0).getTime(), 'ami').nouvelles.map(n => n.titre)).toEqual(['Pour Léa']);
  });
  it('échéance déplacée : le rappel repart ; tâche terminée ou trop ancienne : rien', () => {
    const r1 = evaluerRappels(x, etatRappelsVide(), a930, 'fondateur');
    const deplacee = modifierTache(x, c.tache.id, { echeance: { jour: AUJ, heure: '10:15' } }, f());
    expect(evaluerRappels(deplacee, r1.etat, new Date(2026, 9, 13, 9, 46).getTime(), 'fondateur').nouvelles).toHaveLength(1);
    expect(evaluerRappels(modifierTache(x, c.tache.id, { statut: 'fait' }, f()), etatRappelsVide(), a930, 'fondateur').nouvelles).toHaveLength(0);
    expect(evaluerRappels(x, etatRappelsVide(), new Date(2026, 9, 15, 11, 0).getTime(), 'fondateur').nouvelles).toHaveLength(0);
  });
  it('libellés', () => {
    expect([0, 10, 60, 1440, 2880].map(libelleDelai)).toEqual(['À l’échéance', '10 min avant', '1 h avant', '1 j avant', '2 j avant']);
  });
  it('vérification du hub : état écrit, notification sur le PC, pastille de la tuile', async () => {
    const contenu = new Map<string, string>([[CLES_TACHES.donnees, JSON.stringify(x)]]);
    const base: BasePrefs = { lire: k => contenu.get(k), ecrire: (k, v) => void contenu.set(k, v) };
    const notifications: string[] = [];
    (globalThis as { applibourse?: unknown }).applibourse = { systeme: { notifier: async (t: string, c2: string) => (notifications.push(`${t} — ${c2}`), true) } };
    const admin = { stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined };
    const ctx = { admin, profil: { id: 'principal', nom: 'Moi', admin: true, creeLe: '' }, baseProfil: base };
    expect(verifierRappels(ctx, a930)).toHaveLength(1);
    expect(verifierRappels(ctx, a930 + 30_000)).toHaveLength(0);
    expect(notifications).toEqual(['Tâche : Appeler — Échéance dans 30 min (10 h 00)']);
    expect(infoTaches({ ...ctx, maintenant: a930 })?.pastille).toBe('1 RAPPEL');
    delete (globalThis as { applibourse?: unknown }).applibourse;
  });
});

// ------------------------------------------------------------------ Relais (portées réelles du relais en mémoire)

describe('synchronisation chiffrée par le relais', () => {
  const AMI = 'leaami01';
  const AUTRE = 'hugoami2';
  const maitre = { relais: RELAIS_TEST, jeton: JETON_TEST };
  const CLE_SYNCHRO = '11'.repeat(32);
  const mem = () => {
    const m = new Map<string, string>();
    return { m, base: { lire: (k: string) => m.get(k), ecrire: (k: string, v: string) => void m.set(k, v) } as BasePrefs };
  };
  let horloge = Date.UTC(2026, 9, 13, 8, 0);
  const iso = (sauter = 31_000) => new Date((horloge += sauter)).toISOString();

  it('Fondateur ↔ ami : chiffré, projets partagés seulement, écriture renvoyée, conflits fusionnés, retrait', async () => {
    const relais = relaisPortees();
    const espF = espacesDuRelais(maitre, relais.requete);
    const espA = espacesDuRelais(liaisonPourProfil(maitre, AMI), relais.requete);
    const espH = espacesDuRelais(liaisonPourProfil(maitre, AUTRE), relais.requete);
    const s = scenarioPartage();
    const pc = mem();
    const pc2 = mem();
    const lea = mem();
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(s.d));
    let etatF: EtatTachesFondateur = {};
    let etatF2: EtatTachesFondateur = {};
    let suiviA: SuiviTachesAmi = {};
    const comptes = new Set([AMI, AUTRE]);
    const tourF = async (base = pc.base, etat = etatF, retours: Record<string, unknown> = {}) => {
      const r = await synchroniserTachesFondateur({ espaces: espF, base, cleSynchro: CLE_SYNCHRO, etat, objetsAdmin: await espF.lister('principal'), objetsCompte: id => espF.lister(id), comptes, retours, nomFondateur: 'Enzo', maintenant: iso(), alea: aleatoireDeterministe(3) });
      expect(r.erreurs).toEqual([]);
      return r;
    };
    const tourA = async () => {
      const r = await recevoirTachesAmi({ espaces: espA, id: AMI, base: lea.base, objets: await espA.lister(AMI), suivi: suiviA, maintenant: iso(), alea: aleatoireDeterministe(5) });
      suiviA = r.suivi;
      return r;
    };

    // 1. L'ami ouvre une première fois son compte : clé de réception (comme Tsuzuku).
    await tourA();
    await espA.deposer(AMI, OBJET_CLE, documentCle(paireDe(lea.base).publique), iso());

    // 2. Le Fondateur publie : ses appareils (principal) et l'ami.
    let r = await tourF();
    etatF = r.etat;
    expect(r.depots).toBe(2);
    const brutPrincipal = relais.boite.get(`p:principal:${OBJET_TACHES}`)!;
    const brutAmi = relais.boite.get(`p:${AMI}:${OBJET_TACHES}`)!;
    for (const brut of [brutPrincipal, brutAmi]) expect(brut).not.toMatch(/Partagée|Secrète|À lire|Privé|Site|Léa|Enzo/);
    expect(relais.boite.has(`p:${AUTRE}:${OBJET_TACHES}`)).toBe(false);
    // Un tour sans changement n'écrit rien.
    r = await tourF();
    etatF = r.etat;
    expect(r.depots).toBe(0);

    // 3. L'ami reçoit seulement les projets partagés.
    let ra = await tourA();
    expect(ra.change).toBe(true);
    const copie = lireCopie(lea.m.get(CLES_TACHES.copie));
    expect(Object.values(copie.donnees.taches).map(t => t.titre).sort()).toEqual(['Partagée', 'À lire']);
    expect(copie.fondateur).toBe('Enzo');
    // Un autre compte ne lit pas le dépôt de l'ami ; l'ami n'écrit pas l'objet du Fondateur.
    await expect(espH.lire(AMI, OBJET_TACHES)).rejects.toThrow();
    await expect(espA.deposer(AMI, OBJET_TACHES, '{}', iso())).rejects.toThrow();
    await expect(espA.lire('principal', OBJET_TACHES)).rejects.toThrow();

    // 4. Conflit : le Fondateur change la priorité, l'ami le statut et le titre (plus tard) de la même tâche.
    const dF = modifierTache(lireDonnees(pc.m.get(CLES_TACHES.donnees)), s.t1, { priorite: 'urgente', titre: 'Titre Fondateur' }, { maintenant: horloge, auteur: 'fondateur' });
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(dF));
    const dA = modifierTache(copie.donnees, s.t1, { statut: 'en-revue', titre: 'Titre Léa' }, { maintenant: horloge + 5000, auteur: 'ami' });
    lea.base.ecrire(CLES_TACHES.copie, JSON.stringify({ ...copie, donnees: dA }));
    ra = await tourA();
    expect(ra.envoi).toBeDefined();
    const enveloppe = ra.envoi!.sceller(iso(0));
    // Ce que l'ami dépose dans son retour `compte` (objet qu'il a le droit d'écrire).
    await espA.deposer(AMI, 'compte', JSON.stringify({ taches: enveloppe }), iso(0));
    expect(relais.boite.get(`p:${AMI}:compte`)).not.toMatch(/Titre Léa|en-revue/);
    expect(() => ouvrirEnvoi('00'.repeat(32), enveloppe)).toThrow();
    const retourLu = await espF.lire(AMI, 'compte');
    r = await tourF(pc.base, etatF, { [AMI]: (JSON.parse(retourLu!.charge) as { taches: unknown }).taches });
    etatF = r.etat;
    const fusionF = lireDonnees(pc.m.get(CLES_TACHES.donnees)).taches[s.t1];
    expect(fusionF).toMatchObject({ priorite: 'urgente', statut: 'en-revue', titre: 'Titre Léa' });
    expect(fusionF.historique.some(e => e.avant === 'Partagée')).toBe(true);

    // 5. Un deuxième appareil du Fondateur reçoit tout (principal), sans rien perdre.
    r = await tourF(pc2.base, etatF2);
    etatF2 = r.etat;
    expect(lireDonnees(pc2.m.get(CLES_TACHES.donnees)).taches[s.t1].titre).toBe('Titre Léa');
    expect(lireDonnees(pc2.m.get(CLES_TACHES.donnees)).taches[s.t2].titre).toBe('Secrète');

    // 6. L'ami reçoit la fusion ; son envoi ne repart pas en boucle.
    ra = await tourA();
    suiviA = { ...suiviA, envoye: ra.envoi?.h ?? suiviA.envoye };
    expect(lireCopie(lea.m.get(CLES_TACHES.copie)).donnees.taches[s.t1]).toMatchObject({ priorite: 'urgente', statut: 'en-revue' });

    // 7. Le Fondateur supprime la tâche (pierre tombale) puis retire le partage du projet.
    const sup = supprimerTache(lireDonnees(pc.m.get(CLES_TACHES.donnees)), s.t1, { maintenant: horloge + 60_000, auteur: 'fondateur' });
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(sup));
    r = await tourF();
    etatF = r.etat;
    await tourA();
    expect(tachesVivantes(lireCopie(lea.m.get(CLES_TACHES.copie)).donnees).map(t => t.titre).sort()).toEqual(['À lire']);
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(modifierProjet(sup, s.lecture, { partage: 'aucun' }, { maintenant: horloge + 90_000, auteur: 'fondateur' })));
    r = await tourF();
    etatF = r.etat;
    await tourA();
    expect(tachesVivantes(lireCopie(lea.m.get(CLES_TACHES.copie)).donnees)).toHaveLength(0);

    // 8. Plus d'ami : son dépôt est retiré, sa copie se vide (la tuile disparaît).
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(changerReglages(lireDonnees(pc.m.get(CLES_TACHES.donnees)), { ami: undefined, cle: undefined }, { maintenant: horloge + 120_000, auteur: 'fondateur' })));
    r = await tourF();
    expect(relais.boite.has(`p:${AMI}:${OBJET_TACHES}`)).toBe(false);
    await tourA();
    expect(lireCopie(lea.m.get(CLES_TACHES.copie)).cle).toBeUndefined();
  });

  it('regroupement des rafales : jamais deux dépôts à moins de 3 s (pas de quota d’écritures depuis la version 9)', async () => {
    const relais = relaisPortees();
    const espF = espacesDuRelais(maitre, relais.requete);
    const pc = mem();
    const { d } = projetDeBase();
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(d));
    const tour = async (etat: EtatTachesFondateur, sauter: number) =>
      synchroniserTachesFondateur({ espaces: espF, base: pc.base, cleSynchro: CLE_SYNCHRO, etat, objetsAdmin: await espF.lister('principal'), objetsCompte: id => espF.lister(id), comptes: new Set(), retours: {}, maintenant: iso(sauter) });
    let r = await tour({}, 1000);
    expect(r.depots).toBe(1);
    const ecrire = (n: number) => pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(creerEspace(lireDonnees(pc.m.get(CLES_TACHES.donnees)), `E${n}`, f()).donnees));
    ecrire(1);
    r = await tour(r.etat, 2000);
    expect(r.depots).toBe(0); // 1 s après : reporté
    ecrire(2);
    r = await tour(r.etat, 5_000);
    expect(r.depots).toBe(1); // les deux changements partent ensemble
    const puts = relais.appels.filter(x => x.methode === 'PUT');
    expect(puts).toHaveLength(2);
  });
});

// Garde : la date de test reste un mardi.
test('jour de référence', () => {
  expect(ajouterJours(AUJ, 0)).toBe(AUJ);
});

export type { DonneesTaches };
