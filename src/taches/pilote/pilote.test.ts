/**
 * Pilote de semaine, côté hôte : ce qui est planifié (tâches assignées à
 * l'utilisateur, rangs et partage d'équipe), les événements des autres apps,
 * la validation (une seule modification, annulable), l'état de l'appareil et la
 * proposition du dimanche soir.
 */

import { abonnementsVides, compteVide } from '../../hub/abonnements/abonnements';
import { donneesVides as adminVides, ecrireDonnees as ecrireAdmin } from '../../hub/admin/donnees';
import { REGLAGES_PILOTE_DEFAUT } from '../../hub/pilote/contrats';
import { proposerSemaine } from '../../hub/pilote/planification';
import type { ContexteHub } from '../../hub/types';
import type { Profil } from '../../profils/profils';
import { aleatoireDeterministe } from '../../securite/aleatoire';
import { enregistrerProspect, prospectsVides, saisieVide } from '../../prospects/prospects';
import type { BasePrefs } from '../../tsuzuku/plateforme/stockage';
import { changerDroit, inviterMembre, listeMembres } from '../membres';
import {
  creerEspace,
  creerProjet,
  creerTache,
  lireDonnees,
  modifierTache,
  type Contexte,
  type DonneesTaches,
  type SaisieTache,
} from '../modele';
import { appliquerReception, CLES_TACHES, copieVide, documentPourMembre } from '../partage';
import { lireEtatRappels } from '../rappels';
import { verifierRappels } from '../resume';
import { terminerTache } from '../recurrence';
import {
  annulerValidation,
  CLE_PILOTE,
  construireEntree,
  ecrireEtatBase,
  episodesPilote,
  evenementsPilote,
  lireEtatBase,
  lireEtatPilote,
  peutPlanifier,
  tachesFaites,
  tachesPlanifiables,
  validerSemaine,
} from './hote';
import { FRAICHEUR_PROPOSITION_MS, texteProposition } from './notification';

const LEA = 'lea0000001';
const HUGO = 'hugo000002';
const DIM = new Date(2026, 9, 18, 18, 5).getTime();
const AUJ = '2026-10-15'; // jeudi
const LUNDI = '2026-10-19';
let n = 0;
const ctx = (auteur: Contexte['auteur'] = 'fondateur'): Contexte & { aleaOctets: (k: number) => Uint8Array } => ({ maintenant: new Date(2026, 9, 14, 9).getTime() + n++, auteur, aleaOctets: aleatoireDeterministe(n + 3) });

const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
const lea: Profil = { id: LEA, nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['taches', 'tsuzuku'], creePar: 'principal' };

function base(init: Record<string, string> = {}): BasePrefs & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return { m, lire: c => m.get(c), ecrire: (c, v) => void m.set(c, v), supprimer: c => void m.delete(c) };
}

function monde() {
  const e = creerEspace(lireDonnees(undefined), 'Travail', ctx());
  const site = creerProjet(e.donnees, e.espace.id, 'Site', ctx());
  const prive = creerProjet(site.donnees, e.espace.id, 'Privé', ctx());
  let d: DonneesTaches = prive.donnees;
  d = inviterMembre(d, LEA, 'Léa', ctx(), 'ami');
  d = inviterMembre(d, HUGO, 'Hugo', ctx(), 'gestionnaire');
  d = changerDroit(d, site.projet.id, LEA, 'ecriture', ctx());
  d = changerDroit(d, site.projet.id, HUGO, 'lecture', ctx());
  const ajouter = (titre: string, liste: string, c: Partial<Omit<SaisieTache, 'titre' | 'listeId'>> = {}) => {
    const r = creerTache(d, { ...c, titre, listeId: liste }, ctx());
    d = r.donnees;
    return r.tache.id;
  };
  const ids = {
    perso: ajouter('Facture', prive.liste.id, { echeance: { jour: '2026-10-21' }, estimation: 60 }),
    moiSite: ajouter('Maquette', site.liste.id, { echeance: { jour: '2026-10-22' }, assignes: ['fondateur'], priorite: 'haute' }),
    personneSite: ajouter('Sans responsable', site.liste.id, { echeance: { jour: '2026-10-22' } }),
    pourLea: ajouter('Textes', site.liste.id, { echeance: { jour: '2026-10-20' }, assignes: [LEA], estimation: 90 }),
    pourHugo: ajouter('Relecture', site.liste.id, { echeance: { jour: '2026-10-20' }, assignes: [HUGO] }),
    sansDate: ajouter('Un jour', prive.liste.id, {}),
    haute: ajouter('Important sans date', prive.liste.id, { priorite: 'haute' }),
  } as Record<string, string>;
  return { d, ids, site: site.projet.id, prive: prive.projet.id, lSite: site.liste.id, lPrive: prive.liste.id };
}

describe('tâches planifiées : assignation, rangs et partage', () => {
  it('le Fondateur : ses tâches et celles de personne dans ses projets non partagés', () => {
    const m = monde();
    const ids = tachesPlanifiables(m.d, 'fondateur', 'fondateur', LUNDI, AUJ).map(t => t.id);
    expect(ids).toContain(m.ids.perso);
    expect(ids).toContain(m.ids.moiSite);
    expect(ids).toContain(m.ids.haute);
    // Pas celles des autres, ni sans responsable dans un projet partagé, ni sans date ni priorité.
    expect(ids).not.toContain(m.ids.personneSite);
    expect(ids).not.toContain(m.ids.pourLea);
    expect(ids).not.toContain(m.ids.pourHugo);
    expect(ids).not.toContain(m.ids.sansDate);
  });

  it('un membre : seulement ce qui lui est assigné, dans un projet où il écrit', () => {
    const m = monde();
    const membre = (c: string) => listeMembres(m.d).find(x => x.compte === c)!;
    const copieLea = appliquerReception(copieVide(), documentPourMembre(m.d, membre(LEA), 'Enzo'));
    const idsLea = tachesPlanifiables(copieLea.donnees, 'ami', copieLea.moi!, LUNDI, AUJ).map(t => t.titre);
    expect(idsLea).toEqual(['Textes']);
    // Hugo n'a que la lecture : rien à planifier, même assigné.
    const copieHugo = appliquerReception(copieVide(), documentPourMembre(m.d, membre(HUGO), 'Enzo'));
    expect(tachesPlanifiables(copieHugo.donnees, 'ami', copieHugo.moi!, LUNDI, AUJ)).toEqual([]);
  });

  it('exclut terminées, supprimées, sous-tâches et tâches venues de Prospects / Abonnements / Portefeuille', () => {
    const m = monde();
    let d = terminerTache(m.d, m.ids.perso, ctx(), AUJ).donnees;
    expect(peutPlanifier(d, d.taches[m.ids.perso], 'fondateur', 'fondateur')).toBe(false);
    const sous = creerTache(d, { titre: 'Sous-tâche', listeId: m.lPrive, parentId: m.ids.haute, priorite: 'urgente' }, ctx());
    d = sous.donnees;
    expect(peutPlanifier(d, d.taches[sous.tache.id], 'fondateur', 'fondateur')).toBe(false);
    const src = creerTache(d, { titre: 'Relancer Paul', listeId: m.lPrive, echeance: { jour: '2026-10-20' }, source: { app: 'prospects', cle: 'p|2026-10-20' } }, ctx());
    d = src.donnees;
    expect(peutPlanifier(d, d.taches[src.tache.id], 'fondateur', 'fondateur')).toBe(false);
    const sup = modifierTache(d, m.ids.haute, { supprime: true } as never, ctx());
    expect(peutPlanifier(sup, sup.taches[m.ids.haute], 'fondateur', 'fondateur')).toBe(false);
  });

  it('durée = estimation restante (temps déjà passé déduit), 15 min au minimum', () => {
    const m = monde();
    const t = tachesPlanifiables(m.d, 'fondateur', 'fondateur', LUNDI, AUJ).find(x => x.id === m.ids.perso)!;
    expect(t.dureeMin).toBe(60);
    expect(t.projet).toBe('Privé');
  });

  it('une tâche récurrente revient les jours de la semaine', () => {
    const m = monde();
    const r = creerTache(m.d, { titre: 'Point', listeId: m.lPrive, echeance: { jour: '2026-10-19' }, recurrence: { type: 'quotidienne', intervalle: 2 }, estimation: 30 }, ctx());
    const t = tachesPlanifiables(r.donnees, 'fondateur', 'fondateur', LUNDI, AUJ).find(x => x.id === r.tache.id)!;
    expect(t.repetitions).toEqual(['2026-10-21', '2026-10-23', '2026-10-25']);
  });
});

describe('événements et récompenses des autres apps', () => {
  const carnet = () => {
    let c = prospectsVides();
    for (const [nom, relance] of [['Paul', '2026-10-14'], ['Marie', '2026-10-21'], ['Loin', '2027-01-20']] as const) {
      c = enregistrerProspect(c, { ...saisieVide(), nom, email: `${nom.toLowerCase()}@exemple.fr`, relance: relance.split('-').reverse().join('/'), statut: 'nouveau' }, DIM).donnees;
    }
    return c;
  };
  const abo = () => {
    const a = abonnementsVides();
    a.comptes[LEA] = { ...compteVide(a.reglages, '2026-01-01T00:00:00.000Z'), echeance: '2026-10-23', montant: 500 };
    return a;
  };
  const services = () => {
    const s = new Map<string, string>([['admin.donnees', ecrireAdmin({ ...adminVides(), prospects: carnet(), abonnements: abo() })]]);
    return { stockage: { lire: (k: string) => s.get(k), ecrire: (k: string, v: string) => void s.set(k, v) }, verifierIdentite: () => undefined, etatCoffre: () => undefined };
  };
  const contexte = (extra: Partial<ContexteHub> = {}): ContexteHub => ({ profil: fondateur, admin: services(), profils: { actuel: fondateur, tous: [fondateur, lea] } as never, baseProfil: base(), ...extra });

  it('relances (retard compris), paiements et portefeuille du Fondateur', () => {
    const portefeuille = { valeur: '', sansCompte: false, rappelsTaches: { versement: { actif: true, jour: 22, montant: 200 }, dividendes: [{ nom: 'Total', date: '2026-10-20', montant: '12 €' }, { nom: 'Loin', date: '2026-12-01' }] } };
    const ev = evenementsPilote(contexte({ portefeuille }), REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ);
    expect(ev.map(e => [e.genre, e.jour, e.titre])).toEqual([
      ['relance', '2026-10-14', 'Relancer Paul'],
      ['relance', '2026-10-21', 'Relancer Marie'],
      ['paiement', '2026-10-23', 'Paiement attendu : abonnement de Léa'],
      ['versement', '2026-10-22', 'Versement mensuel : 200 €'],
      ['dividende', '2026-10-20', 'Vérifier le dividende de Total'],
    ]);
    expect(ev[0].retard).toBe(true);
    expect(evenementsPilote(contexte({ portefeuille }), { ...REGLAGES_PILOTE_DEFAUT, portefeuille: false }, LUNDI, AUJ).map(e => e.genre)).toEqual(['relance', 'relance', 'paiement']);
  });

  it('un membre ne voit ni Prospects ni Abonnements (rangs)', () => {
    const ev = evenementsPilote({ profil: lea, baseProfil: base() }, REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ);
    expect(ev).toEqual([]);
    // Même avec les services d'administration sous la main, un ami n'a pas ces apps.
    expect(evenementsPilote({ profil: lea, admin: services(), baseProfil: base() }, REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ).filter(e => e.genre === 'relance' || e.genre === 'paiement')).toEqual([]);
  });

  const biblio = (entrees: object[]) => JSON.stringify({ version: 2, anime: entrees, movies: [], history: [], manualSources: {} });
  const anime = (id: string, titre: string, status: string, courant: number, total: number | null, lastWatched: string) => ({ id, kind: 'anime', title: titre, image: null, status, currentEpisode: courant, totalEpisodes: total, runtime: 24, year: 2025, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: null, lastWatched });

  it('épisodes : la suite des animés suivis, du plus récemment regardé, si Tsuzuku est ouvert', () => {
    const b = base({ 'tsuzuku.bibliotheque': biblio([anime('a1', 'Alpha', 'en_cours', 3, 12, '2026-10-10'), anime('a2', 'Beta', 'a_reprendre', 11, 12, '2026-10-12'), anime('a3', 'Gamma', 'vu', 12, 12, '2026-10-01'), anime('a4', 'Delta', 'a_voir', 0, 12, '2026-10-02')]) });
    const eps = episodesPilote({ profil: lea, baseProfil: b });
    expect(eps.map(e => `${e.titre} ${e.episode}`)).toEqual(['Beta 12', 'Alpha 4', 'Alpha 5', 'Alpha 6']);
    expect(eps[0].dureeMin).toBe(24);
    // Sans l'accès à Tsuzuku : rien. Bibliothèque illisible : rien.
    expect(episodesPilote({ profil: { ...lea, apps: ['taches'] }, baseProfil: b })).toEqual([]);
    expect(episodesPilote({ profil: lea, baseProfil: base({ 'tsuzuku.bibliotheque': '{pas du json' }) })).toEqual([]);
    expect(episodesPilote({ profil: lea, baseProfil: base() })).toEqual([]);
  });

  it('un animé dont le total est inconnu : l’épisode suivant seulement', () => {
    const b = base({ 'tsuzuku.bibliotheque': biblio([anime('a1', 'Alpha', 'en_cours', 7, null, '2026-10-10')]) });
    expect(episodesPilote({ profil: lea, baseProfil: b }).map(e => e.episode)).toEqual([8]);
  });
});

describe('validation et annulation', () => {
  const planifier = (m: ReturnType<typeof monde>) => proposerSemaine(construireEntree({ profil: fondateur, baseProfil: base() }, { role: 'fondateur', moi: 'fondateur', donnees: m.d }, REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ));

  it('applique les jours et créneaux dans Tâches en une seule modification', () => {
    const m = monde();
    const s = planifier(m);
    const b = validerSemaine(m.d, s, ctx(), 'fondateur', 'fondateur');
    expect(b.appliquees).toBe(3);
    for (const id of [m.ids.perso, m.ids.moiSite, m.ids.haute]) {
      const el = s.elements.find(e => e.refId === id)!;
      expect(b.donnees.taches[id].echeance).toEqual({ jour: el.jour, heure: el.debut });
    }
    // Les autres tâches ne bougent pas.
    expect(b.donnees.taches[m.ids.pourLea]).toBe(m.d.taches[m.ids.pourLea]);
    expect(b.donnees.taches[m.ids.sansDate]).toBe(m.d.taches[m.ids.sansDate]);
    // L'ancienne échéance reste dans l'historique de la tâche.
    expect(b.donnees.taches[m.ids.perso].historique.length).toBeGreaterThan(m.d.taches[m.ids.perso].historique.length);
    expect(b.annulation.find(a => a.tacheId === m.ids.perso)?.avant).toEqual({ jour: '2026-10-21' });
    expect(b.annulation.find(a => a.tacheId === m.ids.haute)?.avant).toBeUndefined();
  });

  it('ne touche ni aux relances, paiements, récurrences ni aux épisodes', () => {
    const m = monde();
    let s = planifier(m);
    s = { ...s, elements: [...s.elements, { id: 'relance:x', genre: 'relance', refId: 'x', titre: 'R', jour: LUNDI, dureeMin: 15, ordre: 9 }, { id: 'episode:e', genre: 'episode', refId: 'e', titre: 'E', jour: LUNDI, dureeMin: 24, ordre: 9 }] };
    const b = validerSemaine(m.d, s, ctx(), 'fondateur', 'fondateur');
    expect(b.appliquees).toBe(3);
    expect(Object.keys(b.donnees.taches).sort()).toEqual(Object.keys(m.d.taches).sort());
  });

  it('ignore une tâche terminée ou retirée depuis la proposition', () => {
    const m = monde();
    const s = planifier(m);
    const d = terminerTache(m.d, m.ids.perso, ctx(), AUJ).donnees;
    const b = validerSemaine(d, s, ctx(), 'fondateur', 'fondateur');
    expect(b.appliquees).toBe(2);
    expect(b.ignorees).toBe(1);
  });

  it('un membre ne peut appliquer que ses tâches', () => {
    const m = monde();
    const membre = listeMembres(m.d).find(x => x.compte === LEA)!;
    const copie = appliquerReception(copieVide(), documentPourMembre(m.d, membre, 'Enzo'));
    const entree = construireEntree({ profil: lea, baseProfil: base() }, { role: 'ami', moi: copie.moi!, donnees: copie.donnees }, REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ);
    expect(entree.taches.map(t => t.titre)).toEqual(['Textes']);
    const s = proposerSemaine(entree);
    // Un autre membre (ou un forgeur) ne planifie pas la tâche de Léa.
    const forge = { ...s, elements: [...s.elements, { id: 'tache:x', genre: 'tache' as const, refId: m.ids.moiSite, titre: 'X', jour: LUNDI, dureeMin: 30, ordre: 5 }] };
    const b = validerSemaine(copie.donnees, forge, ctx(copie.moi), 'ami', copie.moi!);
    expect(b.appliquees).toBe(1);
    expect(b.ignorees).toBe(1);
    expect(b.donnees.taches[m.ids.moiSite]?.echeance).toEqual(copie.donnees.taches[m.ids.moiSite]?.echeance);
  });

  it('annuler rend les échéances d’avant, sauf pour une tâche modifiée depuis', () => {
    const m = monde();
    const s = planifier(m);
    const b = validerSemaine(m.d, s, ctx(), 'fondateur', 'fondateur');
    const v = { debut: LUNDI, le: DIM, annulation: b.annulation, semaine: s };
    const modifiee = modifierTache(b.donnees, m.ids.moiSite, { echeance: { jour: '2026-10-30' } }, ctx());
    const a = annulerValidation(modifiee, v, ctx());
    expect(a.restaurees).toBe(2);
    expect(a.conservees).toBe(1);
    expect(a.donnees.taches[m.ids.perso].echeance).toEqual({ jour: '2026-10-21' });
    expect(a.donnees.taches[m.ids.haute].echeance).toBeUndefined();
    expect(a.donnees.taches[m.ids.moiSite].echeance).toEqual({ jour: '2026-10-30' });
    // Tout annuler sans modification : retour à l'état d'origine.
    const tout = annulerValidation(b.donnees, v, ctx());
    for (const id of Object.keys(m.d.taches)) expect(tout.donnees.taches[id].echeance).toEqual(m.d.taches[id].echeance);
  });

  it('les tâches faites débloquent visuellement', () => {
    const m = monde();
    const s = planifier(m);
    expect([...tachesFaites(m.d, s)]).toEqual([]);
    const d = terminerTache(m.d, m.ids.perso, ctx(), AUJ).donnees;
    expect([...tachesFaites(d, s)]).toEqual([m.ids.perso]);
  });
});

describe('état de l’appareil', () => {
  it('lit n’importe quoi sans planter', () => {
    expect(lireEtatPilote(undefined).reglages).toEqual(REGLAGES_PILOTE_DEFAUT);
    expect(lireEtatPilote('{pas du json').notifiees).toEqual([]);
    expect(lireEtatPilote(JSON.stringify({ reglages: { chargeMax: 99999 }, brouillon: { debut: 'x' }, valide: { debut: LUNDI } })).brouillon).toBeUndefined();
  });

  it('écrit et relit à l’identique', () => {
    const m = monde();
    const s = proposerSemaine(construireEntree({ profil: fondateur, baseProfil: base() }, { role: 'fondateur', moi: 'fondateur', donnees: m.d }, REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ));
    const b = base();
    const e = { ...lireEtatPilote(undefined), brouillon: s, notifiees: [LUNDI] };
    ecrireEtatBase(b, e);
    expect(b.m.has(CLE_PILOTE)).toBe(true);
    expect(lireEtatBase(b)).toEqual(e);
  });
});

describe('proposition du dimanche soir', () => {
  const fond = (b: ReturnType<typeof base>, donnees: DonneesTaches): ContexteHub => ({ profil: fondateur, admin: { stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined }, baseProfil: b, maintenant: DIM, profils: { actuel: fondateur, tous: [fondateur] } as never, ...(donnees ? {} : {}) });
  const avecDonnees = () => {
    const m = monde();
    return { m, b: base({ [CLES_TACHES.donnees]: JSON.stringify(m.d) }) };
  };

  it('à l’heure choisie : une alerte et la pastille, une seule fois', () => {
    const { m, b } = avecDonnees();
    const c = fond(b, m.d);
    expect(verifierRappels(c, DIM - 10 * 60_000)).toEqual([]);
    const a1 = verifierRappels(c, DIM);
    expect(a1.map(x => [x.cle, x.type, x.titre])).toEqual([[`pilote|${LUNDI}`, 'pilote', 'Ta semaine est prête']]);
    expect(a1[0].texte).toMatch(/^La semaine du 19 au 25 octobre est prête : 3 tâches/);
    expect(lireEtatRappels(b.m.get(CLES_TACHES.rappels)).nonLus.filter(x => x.type === 'pilote')).toHaveLength(1);
    // Aucune écriture dans les données de Tâches (donc aucun dépôt sur le relais).
    expect(b.m.get(CLES_TACHES.donnees)).toBe(JSON.stringify(m.d));
    expect(verifierRappels(c, DIM + 30_000).filter(x => x.type === 'pilote')).toEqual([]);
    expect(lireEtatBase(b).notifiees).toEqual([LUNDI]);
  });

  it('jour et heure réglables', () => {
    const { m, b } = avecDonnees();
    ecrireEtatBase(b, { ...lireEtatPilote(undefined), reglages: { ...REGLAGES_PILOTE_DEFAUT, jour: 5, heure: '17:00' } });
    const c = fond(b, m.d);
    const vendredi = new Date(2026, 9, 16, 17, 30).getTime();
    expect(verifierRappels(c, DIM).filter(x => x.type === 'pilote')).toEqual([]);
    const a = verifierRappels(c, vendredi);
    expect(a.find(x => x.type === 'pilote')?.cle).toBe(`pilote|${LUNDI}`);
  });

  it('rien si désactivé, si la notification est coupée, si la semaine est déjà validée ou si l’heure est trop ancienne', () => {
    for (const r of [{ actif: false }, { notification: false }]) {
      const { m, b } = avecDonnees();
      ecrireEtatBase(b, { ...lireEtatPilote(undefined), reglages: { ...REGLAGES_PILOTE_DEFAUT, ...r } });
      expect(verifierRappels(fond(b, m.d), DIM).filter(x => x.type === 'pilote')).toEqual([]);
    }
    const { m, b } = avecDonnees();
    const s = proposerSemaine(construireEntree({ profil: fondateur, baseProfil: b }, { role: 'fondateur', moi: 'fondateur', donnees: m.d }, REGLAGES_PILOTE_DEFAUT, LUNDI, AUJ));
    ecrireEtatBase(b, { ...lireEtatPilote(undefined), valide: { debut: LUNDI, le: DIM, annulation: [], semaine: s } });
    expect(verifierRappels(fond(b, m.d), DIM).filter(x => x.type === 'pilote')).toEqual([]);
    const { m: m2, b: b2 } = avecDonnees();
    expect(verifierRappels(fond(b2, m2.d), DIM + FRAICHEUR_PROPOSITION_MS + 60_000).filter(x => x.type === 'pilote')).toEqual([]);
  });

  it('un membre est aussi prévenu, avec ses seules tâches', () => {
    const m = monde();
    const membre = listeMembres(m.d).find(x => x.compte === LEA)!;
    const copie = appliquerReception(copieVide(), documentPourMembre(m.d, membre, 'Enzo'));
    const b = base({ [CLES_TACHES.copie]: JSON.stringify(copie) });
    const a = verifierRappels({ profil: lea, baseProfil: b }, DIM);
    expect(a.find(x => x.type === 'pilote')?.texte).toMatch(/1 tâche\b/);
  });

  it('formule la proposition sans fautes d’accord', () => {
    const r = { taches: 1, repetitions: 0, relances: 2, paiements: 1, portefeuille: 0, episodes: 1, minutesTravail: 60, nonPlaces: 0 };
    expect(texteProposition(LUNDI, r)).toBe('La semaine du 19 au 25 octobre est prête : 1 tâche, 2 relances, 1 paiement, 1 épisode en récompense. Ouvre Tâches › Ta semaine pour la valider.');
    expect(texteProposition(LUNDI, { ...r, taches: 0, relances: 0, paiements: 0, episodes: 0 })).toBe('La semaine du 19 au 25 octobre est prête. Ouvre Tâches › Ta semaine pour la valider.');
  });
});
