/**
 * Tâches V2 : suivi du temps (minuteur unique, saisie, relevé, CSV, fusion,
 * ami), notifications (types, canaux, sourdine, heures calmes, regroupement,
 * anti-répétition, appareil, réglages de l'ami synchronisés), liens avec
 * Prospects, Abonnements, Portefeuille et Claude Office (sans doublon, jamais
 * chez l'ami).
 */

import { abonnementsVides, compteVide, type DonneesAbo } from '../hub/abonnements/abonnements';
import { donneesVides as adminVides, ecrireDonnees as ecrireAdmin, chargerDonnees } from '../hub/admin/donnees';
import { enregistrerProspect, prospectsVides, saisieVide } from '../prospects/prospects';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { fusionnerDonnees } from './fusion';
import { abonnementsVoulus } from './integrations/abonnements';
import { idListeAuto, idProjetAuto, idSource, lienActif, projetAuto, synchroniserSource } from './integrations/commun';
import { synchroniserLiens } from './integrations/moteur';
import { appliquerFinsOffice, creerTacheOffice, demanderHistorique, lierSession, prendreDemandeHistorique, statutRevue, tachesLieesOuvertes } from './integrations/office';
import { portefeuilleVoulu } from './integrations/portefeuille';
import { noterRelanceFaite, relancesVoulues } from './integrations/prospects';
import {
  changerReglages,
  creerEspace,
  creerProjet,
  creerTache,
  donneesVides,
  ecrireDonnees,
  lireDonnees,
  modifierProjet,
  modifierTache,
  projetsDe,
  supprimerTache,
  tachesVivantes,
  vivant,
  type Contexte,
  type DonneesTaches,
} from './modele';
import { champPrefs, enHeuresCalmes, evaluerNotifications, evenementsTaches, filtrerNotifications, lirePrefs, nomAppareil, PREFS_DEFAUT, prefsDe, type EvenementNotif, type PrefsNotif } from './notifications';
import { appliquerEnvoiAmi, appliquerReception, CLES_TACHES, copieVide, envoiDeLAmi, projectionPourAmi } from './partage';
import { etatRappelsVide } from './rappels';
import { testerNotification, verifierRappels } from './resume';
import { ajouterTemps, arreterMinuteur, demarrerMinuteur, dureeLisible, exporterTempsCsv, lireDuree, minuteurActif, releveHebdo, supprimerTemps, tempsPasse } from './temps';

const AUJ = '2026-10-13'; // mardi
const T0 = new Date(2026, 9, 13, 9, 0).getTime();
const MIN = 60_000;
let pas = 0;
const f = (n = 0): Contexte => ({ maintenant: T0 + n + pas++, auteur: 'fondateur', alea: () => ((pas * 7919) % 1000) / 1000 });
const a = (n = 0): Contexte => ({ maintenant: T0 + n + pas++, auteur: 'ami', alea: () => ((pas * 104729) % 1000) / 1000 });
const noms = { fondateur: 'Enzo', ami: 'Léa' };

function monde() {
  const e = creerEspace(donneesVides(), 'Travail', f());
  const p = creerProjet(e.donnees, e.espace.id, 'Site', f());
  const q = creerProjet(p.donnees, e.espace.id, 'Blog', f());
  let d = changerReglages(q.donnees, { ami: 'leaami01', amiNom: 'Léa', cle: 'ab'.repeat(32) }, f());
  d = modifierProjet(d, p.projet.id, { partage: 'ecriture' }, f());
  const t1 = creerTache(d, { titre: 'Maquette', listeId: p.liste.id, etiquettes: ['design'], estimation: 120 }, f());
  const t2 = creerTache(t1.donnees, { titre: 'Article', listeId: q.liste.id, etiquettes: ['redaction', 'design'] }, f());
  return { d: t2.donnees, espace: e.espace.id, site: p.projet.id, listeSite: p.liste.id, blog: q.projet.id, t1: t1.tache.id, t2: t2.tache.id };
}
const copieAmi = (d: DonneesTaches) => appliquerReception(copieVide(), { v: 1, ami: 'leaami01', amiNom: 'Léa', fondateur: 'Enzo', cle: 'ab'.repeat(32), donnees: projectionPourAmi(d) });

// ------------------------------------------------------------------ Suivi du temps

describe('suivi du temps', () => {
  it('lit les durées en français', () => {
    expect(['45', '45 min', '1h30', '1 h 30', '2h', '1,5 h', '0:45', 'abc'].map(lireDuree)).toEqual([45, 45, 90, 90, 120, 90, 45, undefined]);
    expect([5, 60, 95].map(dureeLisible)).toEqual(['5 min', '1 h', '1 h 35']);
  });
  it('un seul minuteur actif : démarrer ailleurs arrête et note le précédent ; rien n’est écrit pendant qu’il tourne', () => {
    const m = monde();
    let d = demarrerMinuteur(m.d, m.t1, f()).donnees;
    expect(minuteurActif(d, 'fondateur')?.tache.id).toBe(m.t1);
    const avant = ecrireDonnees(d);
    // Le temps passe : les données ne changent pas (l'affichage compte tout seul).
    expect(ecrireDonnees(d)).toBe(avant);
    const r = demarrerMinuteur(d, m.t2, f(25 * MIN));
    d = r.donnees;
    expect(r.arrete).toMatchObject({ minutes: 25 });
    expect(minuteurActif(d, 'fondateur')?.tache.id).toBe(m.t2);
    expect(tempsPasse(d.taches[m.t1])).toBe(25);
    expect(d.taches[m.t1].chronoF).toBeUndefined();
    // Arrêt : noté ; moins de 30 s : rien.
    d = arreterMinuteur(d, m.t2, f(25 * MIN + 10 * MIN)).donnees;
    expect(tempsPasse(d.taches[m.t2])).toBe(10);
    const court = arreterMinuteur(demarrerMinuteur(d, m.t1, f(40 * MIN)).donnees, m.t1, f(40 * MIN + 10_000));
    expect(court.minutes).toBe(0);
    // Minuteur oublié : 12 h au plus.
    const oubli = arreterMinuteur(demarrerMinuteur(d, m.t1, f()).donnees, m.t1, f(30 * 3_600_000));
    expect(oubli.minutes).toBe(12 * 60);
  });
  it('le minuteur passe d’un appareil à l’autre par la fusion (champ daté)', () => {
    const m = monde();
    const pc = demarrerMinuteur(m.d, m.t1, f()).donnees;
    const ipad = fusionnerDonnees(m.d, lireDonnees(ecrireDonnees(pc)));
    expect(minuteurActif(ipad, 'fondateur')?.tache.id).toBe(m.t1);
    const arrete = arreterMinuteur(ipad, m.t1, f(30 * MIN)).donnees;
    const retour = fusionnerDonnees(pc, arrete);
    expect(minuteurActif(retour, 'fondateur')).toBeUndefined();
    expect(tempsPasse(retour.taches[m.t1])).toBe(30);
  });
  it('saisies manuelles, retrait, fusion élément par élément', () => {
    const m = monde();
    const x = ajouterTemps(m.d, m.t1, { jour: AUJ, minutes: 45, note: 'réunion' }, f());
    const y = ajouterTemps(m.d, m.t1, { jour: '2026-10-12', minutes: 30 }, f());
    const z = fusionnerDonnees(x, y);
    expect(tempsPasse(z.taches[m.t1])).toBe(75);
    const id = Object.keys(x.taches[m.t1].temps)[0];
    expect(tempsPasse(fusionnerDonnees(supprimerTemps(z, m.t1, id, f()), y).taches[m.t1])).toBe(30);
    expect(() => ajouterTemps(m.d, m.t1, { jour: AUJ, minutes: 0 }, f())).toThrow('Indiquez une durée');
  });
  it('relevé hebdomadaire par projet et par étiquette, estimé contre réel, export CSV', () => {
    const m = monde();
    let d = ajouterTemps(m.d, m.t1, { jour: AUJ, minutes: 90 }, f());
    d = ajouterTemps(d, m.t2, { jour: '2026-10-14', minutes: 30 }, f());
    d = ajouterTemps(d, m.t2, { jour: '2026-10-20', minutes: 15 }, f()); // semaine suivante
    const parProjet = releveHebdo(d, '2026-10-12', 'projet');
    expect(parProjet.lignes.map(l => [l.libelle, l.total])).toEqual([['Site', 90], ['Blog', 30]]);
    expect(parProjet.lignes[0].jours).toEqual([0, 90, 0, 0, 0, 0, 0]);
    expect(parProjet.total).toBe(120);
    const parEtiquette = releveHebdo(d, '2026-10-12', 'etiquette');
    expect(parEtiquette.lignes.map(l => [l.libelle, l.total])).toEqual([['#design', 120], ['#redaction', 30]]);
    expect(parEtiquette.total).toBe(120);
    expect(parProjet.estimations).toEqual([{ tacheId: m.t1, titre: 'Maquette', estimation: 120, reel: 90 }]);
    const csv = exporterTempsCsv(d, '2026-10-12', '2026-10-18', noms);
    const lignes = csv.replace('﻿', '').trim().split('\r\n');
    expect(lignes[0]).toBe('date;projet;liste;tache;etiquettes;personne;minutes;heures;estimation_minutes;note');
    expect(lignes.slice(1)).toEqual(['2026-10-13;Site;Liste;Maquette;design;Enzo;90;1,50;120;', '2026-10-14;Blog;Liste;Article;redaction design;Enzo;30;0,50;;']);
  });
  it('l’ami chronomètre une tâche d’un projet en écriture : son temps revient au Fondateur, pas son minuteur sur le sien', () => {
    const m = monde();
    let copie = copieAmi(m.d);
    let cd = demarrerMinuteur(copie.donnees, m.t1, a()).donnees;
    cd = arreterMinuteur(cd, m.t1, a(20 * MIN)).donnees;
    // Tentative : l'ami pose le minuteur du Fondateur.
    cd = { ...cd, taches: { ...cd.taches, [m.t1]: { ...cd.taches[m.t1], chronoF: new Date(T0).toISOString(), h: { ...cd.taches[m.t1].h, chronoF: '2099-01-01T00:00:00.000Z|a' } } } };
    copie = { ...copie, donnees: cd };
    const r = appliquerEnvoiAmi(m.d, envoiDeLAmi(copie));
    expect(tempsPasse(r.donnees.taches[m.t1], 'ami')).toBe(20);
    expect(r.donnees.taches[m.t1].chronoF).toBeUndefined();
  });
});

// ------------------------------------------------------------------ Notifications

const prefs = (c: Partial<PrefsNotif> = {}): PrefsNotif => ({ ...PREFS_DEFAUT, ...c, types: { ...PREFS_DEFAUT.types, ...c.types } });
const evt = (type: EvenementNotif['type'], cle: string, projetId = 'p1'): EvenementNotif => ({ type, cle, tacheId: 't1', projetId, titre: 'T', texte: 'texte', date: new Date(T0).toISOString() });

describe('notifications : réglages et tri', () => {
  it('réglages lus avec des valeurs par défaut sûres', () => {
    const p = lirePrefs({ actif: false, types: { recap: 'systeme', ami: 'n’importe quoi' }, delaiDefaut: 60, heureRecap: '25:00', muets: ['p1', 'X!'], appareil: { id: 'ap-1234', nom: 'PC' } });
    expect(p).toMatchObject({ actif: false, delaiDefaut: 60, heureRecap: '08:30', muets: ['p1'], appareil: { id: 'ap-1234', nom: 'PC' } });
    expect(p.types.recap).toBe('systeme');
    expect(p.types.ami).toBe(PREFS_DEFAUT.types.ami);
    expect(lirePrefs(undefined)).toEqual(PREFS_DEFAUT);
  });
  it('par type et par canal ; global ; anti-répétition', () => {
    const p = prefs({ types: { ...PREFS_DEFAUT.types, rappel: 'pastille', echeance: 'systeme', retard: 'aucun' } });
    const r = filtrerNotifications([evt('rappel', 'a'), evt('echeance', 'b'), evt('retard', 'c')], etatRappelsVide(), T0, p, {});
    expect(r.pastille.map(x => x.cle)).toEqual(['a']);
    expect(r.systeme).toHaveLength(1);
    expect(Object.keys(r.etat.vus).sort()).toEqual(['a', 'b', 'c']);
    // Rien ne repart.
    const r2 = filtrerNotifications([evt('rappel', 'a'), evt('echeance', 'b')], r.etat, T0 + MIN, p, {});
    expect(r2.pastille).toHaveLength(0);
    expect(r2.systeme).toHaveLength(0);
    // Désactivées : rien, mais consommées (pas de rafale à la réactivation).
    const off = filtrerNotifications([evt('rappel', 'd')], etatRappelsVide(), T0, prefs({ actif: false }), {});
    expect(off.pastille).toHaveLength(0);
    expect(off.etat.vus.d).toBeDefined();
  });
  it('projet en sourdine ; regroupement ; un appareil seulement', () => {
    const muet = filtrerNotifications([evt('rappel', 'a', 'p1'), evt('rappel', 'b', 'p2')], etatRappelsVide(), T0, prefs({ muets: ['p1'] }), {});
    expect(muet.pastille.map(x => x.cle)).toEqual(['b']);
    const groupe = filtrerNotifications([evt('rappel', 'a'), evt('echeance', 'b'), evt('assignee', 'c')], etatRappelsVide(), T0, prefs(), {});
    expect(groupe.systeme).toHaveLength(1);
    expect(groupe.systeme[0].titre).toBe('Tâches : 3 notifications');
    const separees = filtrerNotifications([evt('rappel', 'a'), evt('echeance', 'b')], etatRappelsVide(), T0, prefs({ regrouper: false }), {});
    expect(separees.systeme).toHaveLength(2);
    const ailleurs = filtrerNotifications([evt('rappel', 'a')], etatRappelsVide(), T0, prefs({ appareil: { id: 'ap-pc01', nom: 'PC' } }), { appareilId: 'ap-ipad' });
    expect(ailleurs.systeme).toHaveLength(0);
    expect(ailleurs.pastille).toHaveLength(1);
    const ici = filtrerNotifications([evt('rappel', 'a')], etatRappelsVide(), T0, prefs({ appareil: { id: 'ap-pc01', nom: 'PC' } }), { appareilId: 'ap-pc01' });
    expect(ici.systeme).toHaveLength(1);
  });
  it('heures calmes : plage qui passe minuit, week-end ; la pastille garde tout', () => {
    const calme = { actif: true, debut: '22:00', fin: '07:30', weekEnd: false };
    expect(enHeuresCalmes({ calme }, new Date(2026, 9, 13, 23, 0).getTime())).toBe(true);
    expect(enHeuresCalmes({ calme }, new Date(2026, 9, 13, 6, 0).getTime())).toBe(true);
    expect(enHeuresCalmes({ calme }, new Date(2026, 9, 13, 12, 0).getTime())).toBe(false);
    expect(enHeuresCalmes({ calme: { ...calme, weekEnd: true } }, new Date(2026, 9, 17, 12, 0).getTime())).toBe(true); // samedi
    expect(enHeuresCalmes({ calme: { ...calme, actif: false } }, new Date(2026, 9, 13, 23, 0).getTime())).toBe(false);
    const nuit = new Date(2026, 9, 13, 23, 0).getTime();
    const r = filtrerNotifications([evt('rappel', 'a')], etatRappelsVide(), nuit, prefs({ calme }), {});
    expect(r.systeme).toHaveLength(0);
    expect(r.calmees).toBe(1);
    expect(r.pastille).toHaveLength(1);
  });
});

describe('notifications : événements', () => {
  it('échéance, rappel, retard (une fois)', () => {
    const m = monde();
    let d = modifierTache(m.d, m.t2, { echeance: { jour: AUJ, heure: '10:00' }, rappels: [0, 30] }, f());
    const ev = (n: number) => evenementsTaches(d, n, 'fondateur', { premiere: false, autres: {} }, prefs(), noms).evenements.map(e => e.type);
    expect(ev(new Date(2026, 9, 13, 9, 31).getTime())).toEqual(['rappel']);
    expect(ev(new Date(2026, 9, 13, 10, 1).getTime())).toEqual(['echeance', 'rappel', 'retard']);
    d = modifierTache(d, m.t2, { statut: 'fait' }, f());
    expect(ev(new Date(2026, 9, 13, 10, 1).getTime())).toEqual([]);
  });
  it('l’autre a modifié, commenté, assigné : vu à l’arrivée de la synchronisation, pas à l’heure ; jamais rattrapé au premier passage', () => {
    const m = monde();
    // Premier passage du PC du Fondateur : on retient les traces, rien ne part.
    const e0 = evaluerNotifications(m.d, etatRappelsVide(), T0, 'fondateur', { noms });
    expect(e0.pastille).toHaveLength(0);
    // L'ami modifie à 9 h 05 ; la synchronisation n'apporte sa modification qu'à 9 h 20.
    const copie = copieAmi(m.d);
    let cd = modifierTache(copie.donnees, m.t1, { statut: 'en-cours' }, { ...a(), maintenant: T0 + 5 * MIN });
    cd = modifierTache(cd, m.t1, { assigne: 'fondateur' }, { ...a(), maintenant: T0 + 6 * MIN });
    const recu = appliquerEnvoiAmi(m.d, envoiDeLAmi({ ...copie, donnees: cd })).donnees;
    const e1 = evaluerNotifications(m.d, e0.etat, T0 + 10 * MIN, 'fondateur', { noms });
    const e2 = evaluerNotifications(recu, e1.etat, T0 + 20 * MIN, 'fondateur', { noms });
    expect(e2.pastille.map(p => [p.type, p.texte])).toEqual([['assignee', 'Léa vous a assigné cette tâche']]);
    expect(evaluerNotifications(recu, e2.etat, T0 + 21 * MIN, 'fondateur', { noms }).pastille).toHaveLength(0);
    // Côté ami : la modification du Fondateur.
    const fd = modifierTache(recu, m.t1, { titre: 'Maquette v2' }, { ...f(), maintenant: T0 + 30 * MIN });
    const etatAmi = evaluerNotifications(copie.donnees, etatRappelsVide(), T0, 'ami', { noms }).etat;
    const e3 = evaluerNotifications(copieAmi(fd).donnees, etatAmi, T0 + 31 * MIN, 'ami', { noms });
    expect(e3.pastille.map(p => [p.type, p.texte])).toEqual([['ami', 'Enzo a modifié cette tâche']]);
    expect(e3.systeme).toHaveLength(0); // « ami » : pastille seule par défaut
  });
  it('récap quotidien à l’heure choisie, une fois', () => {
    const m = monde();
    const d = changerReglages(m.d, { notifF: { ...PREFS_DEFAUT, types: { ...PREFS_DEFAUT.types, recap: 'les-deux' }, heureRecap: '08:00' } }, f());
    const r = evaluerNotifications(d, { ...etatRappelsVide(), depuis: new Date(T0).toISOString() }, new Date(2026, 9, 13, 8, 5).getTime(), 'fondateur', { noms });
    expect(r.pastille.map(p => p.titre)).toEqual(['Ma journée']);
    expect(evaluerNotifications(d, r.etat, new Date(2026, 9, 13, 9, 5).getTime(), 'fondateur', { noms }).pastille).toHaveLength(0);
  });
  it('réglages de l’ami : les siens, synchronisés entre ses appareils par le Fondateur', () => {
    const m = monde();
    const copie = copieAmi(m.d);
    const ipad = changerReglages(copie.donnees, { [champPrefs('ami')]: { ...PREFS_DEFAUT, actif: false } }, a());
    const envoi = envoiDeLAmi({ ...copie, donnees: ipad });
    expect(envoi.notif).toBeDefined();
    const chezF = appliquerEnvoiAmi(m.d, envoi).donnees;
    expect(prefsDe(chezF, 'ami').actif).toBe(false);
    expect(prefsDe(chezF, 'fondateur').actif).toBe(true);
    // Son téléphone (copie vierge) reçoit ses réglages, pas ceux du Fondateur.
    const tel = copieAmi(chezF);
    expect(prefsDe(tel.donnees, 'ami').actif).toBe(false);
    expect(tel.donnees.reglages.notifF).toBeUndefined();
    // Une réception plus ancienne n'écrase pas un changement plus récent fait sur l'appareil.
    const recent = changerReglages(tel.donnees, { notifA: { ...PREFS_DEFAUT, son: false } }, a(MIN));
    const apres = appliquerReception({ ...tel, donnees: recent }, { v: 1, ami: 'leaami01', cle: 'ab'.repeat(32), donnees: projectionPourAmi(chezF) });
    expect(prefsDe(apres.donnees, 'ami').son).toBe(false);
    // Un faux horodatage « Fondateur » n'est pas accepté.
    expect(appliquerEnvoiAmi(m.d, { taches: {}, notif: { valeur: { actif: false }, h: '2099-01-01T00:00:00.000Z|f' } }).donnees.reglages.notifA).toBeUndefined();
  });
  it('nom d’appareil', () => {
    expect(nomAppareil('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(nomAppareil('Mozilla/5.0 (Windows NT 10.0) Electron/30')).toBe('PC (application)');
  });
});

describe('notifications : tour du hub', () => {
  const mem = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { m, base: { lire: (k: string) => m.get(k), ecrire: (k: string, v: string) => void m.set(k, v) } as BasePrefs };
  };
  const admin = { stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined };
  afterEach(() => delete (globalThis as { applibourse?: unknown }).applibourse);
  it('désactiver un type : plus de notification ; test de notification ; son coupé', () => {
    const m = monde();
    let d = modifierTache(m.d, m.t1, { echeance: { jour: AUJ, heure: '10:00' }, rappels: [30] }, f());
    const envoyees: Array<[string, boolean]> = [];
    (globalThis as { applibourse?: unknown }).applibourse = { systeme: { notifier: async (t: string, _c: string, _d: string, o?: { silencieux?: boolean }) => (envoyees.push([t, Boolean(o?.silencieux)]), true) } };
    const s = mem({ [CLES_TACHES.donnees]: ecrireDonnees(changerReglages(d, { notifF: { ...PREFS_DEFAUT, types: { ...PREFS_DEFAUT.types, rappel: 'aucun' } } }, f())) });
    const ctx = { admin, profil: { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' }, baseProfil: s.base };
    expect(verifierRappels(ctx, new Date(2026, 9, 13, 9, 31).getTime())).toHaveLength(0);
    expect(envoyees).toHaveLength(0);
    // Réactivé, son coupé : la notification part, silencieuse.
    d = changerReglages(lireDonnees(s.m.get(CLES_TACHES.donnees)), { notifF: { ...PREFS_DEFAUT, son: false } }, f());
    d = modifierTache(d, m.t1, { echeance: { jour: AUJ, heure: '10:05' } }, f());
    s.m.set(CLES_TACHES.donnees, ecrireDonnees(d));
    expect(verifierRappels(ctx, new Date(2026, 9, 13, 9, 36).getTime())).toHaveLength(1);
    expect(envoyees).toEqual([['Tâche : Maquette', true]]);
    const t = testerNotification(ctx, T0);
    expect(t.systeme).toBe(true);
    expect(envoyees.at(-1)?.[0]).toBe('Tâches : notification de test');
  });
});

// ------------------------------------------------------------------ Liens avec les autres apps

describe('liens : socle', () => {
  it('identifiant stable, projet tenu par l’app aux identifiants fixes (deux appareils : un seul projet)', () => {
    expect(idSource('prospects', 'abc|2026-10-13')).toBe(idSource('prospects', 'abc|2026-10-13'));
    expect(idSource('prospects', 'abc|2026-10-13')).not.toBe(idSource('prospects', 'abc|2026-10-14'));
    expect(idSource('abonnements', 'x')).toMatch(/^[a-z0-9-]{2,48}$/);
    const m = monde();
    const pc = projetAuto(m.d, 'prospects', f()).donnees;
    const ipad = projetAuto(m.d, 'prospects', f(1000)).donnees;
    const fusion = fusionnerDonnees(pc, ipad);
    expect(projetsDe(fusion).filter(p => p.auto === 'prospects').map(p => p.id)).toEqual([idProjetAuto('prospects')]);
    expect(fusion.listes[idListeAuto('prospects')].projetId).toBe(idProjetAuto('prospects'));
    expect(() => modifierProjet(fusion, idProjetAuto('prospects'), { partage: 'ecriture' }, f())).toThrow('ne se partage pas');
  });
  it('sans doublon, ni retour d’une tâche supprimée ; terminée quand plus voulue', () => {
    const m = monde();
    const voulues = [{ cle: 'a', titre: 'A', echeance: { jour: AUJ } }, { cle: 'b', titre: 'B' }];
    const r1 = synchroniserSource(m.d, 'abonnements', voulues, f(), { fermerAbsentes: true });
    expect(r1.creees).toBe(2);
    const r2 = synchroniserSource(r1.donnees, 'abonnements', voulues, f(), { fermerAbsentes: true });
    expect(r2.creees).toBe(0);
    expect(r2.donnees).toBe(r1.donnees);
    const sansA = supprimerTache(r1.donnees, idSource('abonnements', 'a'), f());
    expect(synchroniserSource(sansA, 'abonnements', voulues, f(), { fermerAbsentes: true }).creees).toBe(0);
    const r3 = synchroniserSource(r1.donnees, 'abonnements', [voulues[1]], f(), { fermerAbsentes: true });
    expect(r3.terminees).toBe(1);
    expect(r3.donnees.taches[idSource('abonnements', 'a')].statut).toBe('fait');
    expect(r3.donnees.taches[idSource('abonnements', 'a')].historique.at(-1)?.texte).toBe('Terminée : plus rien à faire dans Abonnements');
    // Deux appareils créent la même : une seule tâche.
    const autre = synchroniserSource(m.d, 'abonnements', voulues, f(5000), { fermerAbsentes: true }).donnees;
    expect(tachesVivantes(fusionnerDonnees(r1.donnees, autre)).filter(t => t.source)).toHaveLength(2);
  });
  it('rien de ces apps chez l’ami : ni projet auto (même forcé), ni tâche venue d’une app, ni session liée', () => {
    const m = monde();
    let d = synchroniserSource(m.d, 'prospects', [{ cle: 'p1|2026-10-13', titre: 'Relancer Paul Secret' }], f(), { fermerAbsentes: true }).donnees;
    // Forcé dans les données (ancienne version, bricolage) : toujours exclu.
    d = { ...d, projets: { ...d.projets, [idProjetAuto('prospects')]: { ...d.projets[idProjetAuto('prospects')], partage: 'ecriture' } } };
    // Une tâche de Prospects déplacée dans un projet partagé : exclue aussi.
    d = modifierTache(d, idSource('prospects', 'p1|2026-10-13'), { listeId: m.listeSite }, f());
    d = creerTacheOffice(d, { session: 'sess-1234', projet: 'secret' }, 'Relire', m.site, f()).donnees;
    const proj = projectionPourAmi(d);
    const texte = JSON.stringify(proj);
    expect(texte).not.toContain('Paul Secret');
    expect(texte).not.toContain('sess-1234');
    expect(Object.values(proj.projets).some(p => p.auto)).toBe(false);
    expect(Object.values(proj.taches).map(t => t.titre).sort()).toEqual(['Maquette', 'Relire']);
  });
});

describe('liens : Prospects', () => {
  const carnet = () => {
    let c = prospectsVides();
    for (const [nom, relance, statut] of [['Paul', '2026-10-12', 'contacte'], ['Marie', '2026-10-20', 'nouveau'], ['Loin', '2027-01-20', 'nouveau'], ['Gagné', '2026-10-13', 'gagne']] as const) {
      c = enregistrerProspect(c, { ...saisieVide(), nom, email: `${nom.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@exemple.fr`, relance: relance.split('-').reverse().join('/'), statut }, T0).donnees;
    }
    return c;
  };
  it('relances prévues (30 jours, retards) → tâches ; cocher note le contact une fois', () => {
    const c = carnet();
    const v = relancesVoulues(c, AUJ);
    expect(v.map(x => x.titre)).toEqual(['Relancer Paul', 'Relancer Marie']);
    const paul = Object.values(c.prospects).find(p => p.nom === 'Paul')!;
    const c2 = noterRelanceFaite(c, { source: { app: 'prospects', cle: `${paul.id}|2026-10-12` } }, AUJ, T0);
    expect(c2.prospects[paul.id].relance).toBeUndefined();
    expect(c2.prospects[paul.id].historique.at(-1)).toMatchObject({ date: AUJ, note: 'Relance faite (cochée dans Tâches).' });
    expect(c2.prospects[paul.id].statut).toBe('relance');
    // Une deuxième fois (autre appareil, ou relance déjà déplacée) : rien.
    expect(noterRelanceFaite(c2, { source: { app: 'prospects', cle: `${paul.id}|2026-10-12` } }, AUJ, T0)).toBe(c2);
    // Relance notée dans Prospects : la tâche se termine toute seule.
    const m = monde();
    const d1 = synchroniserSource(m.d, 'prospects', v, f(), { fermerAbsentes: true }).donnees;
    const d2 = synchroniserSource(d1, 'prospects', relancesVoulues(c2, AUJ), f(), { fermerAbsentes: true });
    expect(d2.terminees).toBe(1);
  });
  it('passe complète : lien activé, accès du Fondateur, rien pour un autre compte ni lien désactivé', () => {
    const m = monde();
    const s = new Map<string, string>([['admin.donnees', ecrireAdmin({ ...adminVides(), prospects: carnet() })]]);
    const services = { stockage: { lire: (k: string) => s.get(k), ecrire: (k: string, v: string) => void s.set(k, v) }, verifierIdentite: () => undefined, etatCoffre: () => undefined };
    const fondateur = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' };
    expect(lienActif(m.d, 'prospects')).toBe(false);
    expect(lienActif(m.d, 'office')).toBe(true);
    expect(synchroniserLiens(m.d, { profil: fondateur, admin: services }, f(), AUJ).creees).toBe(0);
    const actif = changerReglages(m.d, { liens: { prospects: true } }, f());
    const r = synchroniserLiens(actif, { profil: fondateur, admin: services }, f(), AUJ);
    expect(r.creees).toBe(2);
    expect(synchroniserLiens(r.donnees, { profil: fondateur, admin: services }, f(), AUJ).donnees).toBe(r.donnees);
    expect(synchroniserLiens(actif, { profil: fondateur, admin: services }, a(), AUJ).creees).toBe(0);
    expect(synchroniserLiens(actif, { profil: { id: 'g1', nom: 'G', admin: false, creeLe: '', role: 'gestionnaire' }, admin: services }, f(), AUJ).creees).toBe(0);
    expect(chargerDonnees(services.stockage).prospects.prospects).toBeDefined();
  });
});

describe('liens : Abonnements et Portefeuille', () => {
  it('échéances proches et retards → tâches (montant, priorité)', () => {
    const abo: DonneesAbo = abonnementsVides();
    abo.comptes.leaami01 = { ...compteVide(abo.reglages, '2026-01-01T00:00:00.000Z'), echeance: '2026-10-10', montant: 500 };
    abo.comptes.hugoami2 = { ...compteVide(abo.reglages, '2026-01-01T00:00:00.000Z'), echeance: '2026-10-15', montant: 500 };
    abo.comptes.zoeami03 = { ...compteVide(abo.reglages, '2026-01-01T00:00:00.000Z'), echeance: '2026-12-15', montant: 500 };
    const v = abonnementsVoulus(abo, [{ id: 'leaami01', nom: 'Léa' }, { id: 'hugoami2', nom: 'Hugo' }, { id: 'zoeami03', nom: 'Zoé' }], AUJ);
    expect(v.map(x => [x.titre, x.priorite])).toEqual([
      ['Abonnement de Léa en retard', 'haute'],
      ['Abonnement de Hugo : échéance le 15/10/2026', 'normale'],
    ]);
    expect(v[0].description).toContain('5,00');
  });
  it('versement mensuel et dividendes à vérifier → tâches', () => {
    const v = portefeuilleVoulu({ versement: { actif: true, jour: 15, montant: 200 }, dividendes: [{ nom: 'TotalEnergies', date: '2026-10-14', montant: '12,30 €' }, { nom: 'Loin', date: '2026-12-01' }] }, AUJ);
    expect(v.map(x => [x.cle, x.titre])).toEqual([
      ['versement|2026-10', 'Versement mensuel : 200 €'],
      ['dividende|TotalEnergies|2026-10-14', 'Vérifier le dividende de TotalEnergies'],
    ]);
    expect(portefeuilleVoulu({ versement: { actif: true, jour: 28, montant: 200 }, dividendes: [] }, AUJ)).toEqual([]);
    expect(portefeuilleVoulu({ versement: { actif: false, jour: 14, montant: 200 }, dividendes: [] }, AUJ)).toEqual([]);
  });
});

describe('liens : Claude Office', () => {
  it('tâche créée depuis une session ; « En revue » quand l’agent lié finit APRÈS le lien, une fois', () => {
    const m = monde();
    const c = creerTacheOffice(m.d, { session: 'sess-0001', cle: 'pc|sess-0001', projet: 'appli', libelle: 'Corriger le test' }, '', undefined, f());
    expect(c.tache.titre).toBe('Corriger le test');
    expect(c.donnees.projets[c.tache.projetId].auto).toBe('office');
    expect(tachesLieesOuvertes(c.donnees)).toBe(1);
    const lien = Date.parse(c.tache.liensOffice![0].depuis);
    // Fin d'avant le lien : rien.
    expect(appliquerFinsOffice(c.donnees, [{ session: 'sess-0001', fin: lien - 1000 }], f()).evenements).toHaveLength(0);
    const r = appliquerFinsOffice(c.donnees, [{ session: 'sess-0001', fin: lien + MIN }], f(2 * MIN));
    expect(r.donnees.taches[c.tache.id].statut).toBe('en-revue');
    expect(r.evenements.map(e => [e.type, e.texte])).toEqual([['office', 'L’agent lié a fini : tâche passée « En revue »']]);
    // Même fin revue : rien de plus ; la tâche remise « En cours » repasse en revue à la fin suivante.
    expect(appliquerFinsOffice(r.donnees, [{ session: 'sess-0001', fin: lien + MIN }], f(3 * MIN)).evenements).toHaveLength(0);
    const reprise = modifierTache(r.donnees, c.tache.id, { statut: 'en-cours' }, f(4 * MIN));
    expect(appliquerFinsOffice(reprise, [{ session: 'sess-0001', fin: lien + 5 * MIN }], f(6 * MIN)).donnees.taches[c.tache.id].statut).toBe('en-revue');
  });
  it('sous-agent : seule SA fin compte ; liens multiples ; statut « En revue » introuvable : à relire', () => {
    const m = monde();
    const c = creerTacheOffice(m.d, { session: 'sess-0002', sousAgent: 'agent-9', libelle: 'Explorer' }, 'Relire l’exploration', m.site, f());
    expect(c.tache.projetId).toBe(m.site);
    const lien = Date.parse(c.tache.liensOffice![0].depuis);
    expect(appliquerFinsOffice(c.donnees, [{ session: 'sess-0002', fin: lien + MIN }], f()).evenements).toHaveLength(0);
    expect(appliquerFinsOffice(c.donnees, [{ session: 'sess-0002', sousAgent: 'agent-9', fin: lien + MIN }], f()).evenements).toHaveLength(1);
    const deux = lierSession(c.donnees, c.tache.id, { session: 'sess-0003' }, f());
    expect(deux.taches[c.tache.id].liensOffice).toHaveLength(2);
    expect(lierSession(deux, c.tache.id, { session: 'sess-0003' }, f())).toBe(deux);
    expect(statutRevue([{ id: 'a', nom: 'À faire', couleur: '#000000', ferme: false }, { id: 'b', nom: 'Fini', couleur: '#000000', ferme: true }])).toBeUndefined();
    expect(() => creerTacheOffice(m.d, { session: 's1' }, 'x', undefined, a())).toThrow('Réservé au Fondateur');
  });
  it('ouvrir l’Historique filtré : demande déposée puis prise une seule fois (une minute au plus)', () => {
    const m = new Map<string, string>();
    const base = { lire: (k: string) => m.get(k), ecrire: (k: string, v: string) => void m.set(k, v), supprimer: (k: string) => void m.delete(k) };
    demanderHistorique(base, 'sess-0001', T0);
    expect(prendreDemandeHistorique(base, T0 + 1000)).toBe('sess-0001');
    expect(prendreDemandeHistorique(base, T0 + 2000)).toBeUndefined();
    demanderHistorique(base, 'sess-0001', T0);
    expect(prendreDemandeHistorique(base, T0 + 2 * MIN)).toBeUndefined();
  });
  it('l’ami ne peut ni poser ni changer une source ou une session liée', () => {
    const m = monde();
    const copie = copieAmi(m.d);
    const cree = creerTache(copie.donnees, { titre: 'Forgée', listeId: m.listeSite, source: { app: 'prospects', cle: 'x' }, liensOffice: [{ session: 'pirate', depuis: new Date(T0).toISOString() }] }, a());
    const r = appliquerEnvoiAmi(m.d, envoiDeLAmi({ ...copie, donnees: cree.donnees }));
    const t = r.donnees.taches[cree.tache.id];
    expect(vivant(t)).toBe(true);
    expect(t.source).toBeUndefined();
    expect(t.liensOffice).toBeUndefined();
  });
});
