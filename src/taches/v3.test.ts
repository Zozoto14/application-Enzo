/**
 * Tâches V3 : partage à plusieurs membres (droits par projet, révocation et
 * rotation de la clé, chiffrement par le relais en mémoire, nombre de
 * dépôts), mentions, chronologie (dépendances, décalage), tableau de bord,
 * objectifs, IA (client simulé, validation obligatoire), GitHub (client
 * simulé, « Faite » à la fusion).
 */

import { espacesDuRelais } from '../sync/relais/espaces';
import { liaisonPourProfil } from '../sync/relais/portees';
import { JETON_TEST, RELAIS_TEST, relaisPortees } from '../sync/relais/__fixtures__/relaisPortees';
import { sceller } from '../sync/relais/chiffrement';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { documentCle, OBJET_CLE, paireDe } from '../tsuzuku/plateforme/partage';
import { droitsProjet } from './acces';
import { lireAjoutRapide } from './ajoutRapide';
import { ajouterJours } from './dates';
import { bornes, barres, decalerSuivantes, dependanceViolee, deplacer, echelle, etirer, liens, violationsDe } from './gantt';
import { appliquerFusions, lireEtat, lireLienSaisi, rafraichir, clientGithubSimule, type ClientGithub } from './github';
import {
  anonymiser,
  appliquerDecoupage,
  appliquerPlanning,
  clientIASimule,
  demandeDecouper,
  demandePlanning,
  demandeResumer,
  lireReponse,
  lireSecrets,
  masquer,
  type ClientIA,
  type DemandeIA,
} from './ia';
import { completerMention, decouperMentions, suggestionsMention, trouverMentions } from './mentions';
import { accorderAcces, changerDroit, changerPerso, droitDe, initiales, inviterMembre, listeMembres, membresDuProjet, retirerMembre } from './membres';
import {
  ajouterCommentaire,
  assignesDe,
  changerReglages,
  creerEspace,
  creerListe,
  creerProjet,
  creerTache,
  donneesVides,
  ErreurTaches,
  estTerminee,
  lireDonnees,
  modifierProjet,
  modifierTache,
  sousTaches,
  type Contexte,
  type DonneesTaches,
} from './modele';
import { evaluerNotifications, lirePrefs, PREFS_DEFAUT } from './notifications';
import { creerObjectif, modifierObjectif, progression } from './objectifs';
import {
  appliquerEnvoiMembre,
  appliquerReception,
  CLES_TACHES,
  copieVide,
  documentPourMembre,
  envoiDeLAmi,
  lireCopie,
  OBJET_TACHES,
  ouvrirEnvoi,
  projectionPourMembre,
  recevoirTachesAmi,
  scellerEnvoi,
  synchroniserTachesFondateur,
  type EtatTachesFondateur,
  type SuiviTachesAmi,
} from './partage';
import { etatRappelsVide } from './rappels';
import { verifierRappels } from './resume';
import { statistiques } from './tableauBord';
import { ajouterTemps } from './temps';

const AUJ = '2026-10-13';
const T0 = new Date(2026, 9, 13, 9, 0).getTime();
let pas = 0;
const f = (n = 0): Contexte & { aleaOctets: (n: number) => Uint8Array } => ({ maintenant: T0 + n + pas++ * 10, auteur: 'fondateur', alea: () => ((pas * 7919) % 1000) / 1000, aleaOctets: aleatoireDeterministe(pas + 1) });
const par = (qui: string, n = 0): Contexte => ({ maintenant: T0 + n + pas++ * 10, auteur: qui, alea: () => ((pas * 104729) % 1000) / 1000 });

const LEA = 'lea0000001';
const HUGO = 'hugo000002';
const ZOE = 'zoe0000003';

/** Fondateur, trois membres, trois projets : A (Léa écriture, Hugo lecture, Zoé admin), B (Hugo écriture), C (privé). */
function scenario() {
  const e = creerEspace(donneesVides(), 'Travail', f());
  const pA = creerProjet(e.donnees, e.espace.id, 'Site', f());
  const pB = creerProjet(pA.donnees, e.espace.id, 'Appli', f());
  const pC = creerProjet(pB.donnees, e.espace.id, 'Privé', f());
  let d = pC.donnees;
  d = inviterMembre(d, LEA, 'Léa', f(), 'ami');
  d = inviterMembre(d, HUGO, 'Hugo', f(), 'gestionnaire');
  d = inviterMembre(d, ZOE, 'Zoé', f(), 'ami');
  d = changerDroit(d, pA.projet.id, LEA, 'ecriture', f());
  d = changerDroit(d, pA.projet.id, HUGO, 'lecture', f());
  d = changerDroit(d, pA.projet.id, ZOE, 'admin', f());
  d = changerDroit(d, pB.projet.id, HUGO, 'ecriture', f());
  const t1 = creerTache(d, { titre: 'Maquette', listeId: pA.liste.id }, f());
  const t2 = creerTache(t1.donnees, { titre: 'API', listeId: pB.liste.id }, f());
  const t3 = creerTache(t2.donnees, { titre: 'Secret', listeId: pC.liste.id }, f());
  return { d: t3.donnees, A: pA.projet.id, B: pB.projet.id, C: pC.projet.id, lA: pA.liste.id, lB: pB.liste.id, lC: pC.liste.id, t1: t1.tache.id, t2: t2.tache.id, t3: t3.tache.id, espace: e.espace.id };
}

// ------------------------------------------------------------------ Membres et droits

describe('membres : droits par projet et par personne', () => {
  it('invitations, droits, initiales ; chacun ne voit que ses projets', () => {
    const s = scenario();
    expect(listeMembres(s.d).map(m => m.nom)).toEqual(['Hugo', 'Léa', 'Zoé']);
    expect(droitDe(s.d, s.A, LEA)).toBe('ecriture');
    expect(droitDe(s.d, s.A, HUGO)).toBe('lecture');
    expect(droitDe(s.d, s.B, LEA)).toBe('aucun');
    expect(droitDe(s.d, s.C, ZOE)).toBe('aucun');
    expect(membresDuProjet(s.d, s.A).map(m => m.nom)).toEqual(['Hugo', 'Léa', 'Zoé']);
    expect(initiales('Léa Martin')).toBe('LM');
    expect(initiales('hugo')).toBe('H');
    // Une clé par projet partagé ; aucune pour le projet privé.
    expect(Object.keys(s.d.reglages.clesProjets ?? {}).sort()).toEqual([s.A, s.B].sort());
    const pl = projectionPourMembre(s.d, LEA);
    expect(Object.keys(pl.projets)).toEqual([s.A]);
    expect(Object.values(pl.taches).map(t => t.titre)).toEqual(['Maquette']);
    expect(pl.projets[s.A].partage).toBe('ecriture');
    expect(pl.projets[s.A].acces).toEqual({ [LEA]: 'ecriture', [HUGO]: 'lecture', [ZOE]: 'admin' });
    const ph = projectionPourMembre(s.d, HUGO);
    expect(Object.keys(ph.projets).sort()).toEqual([s.A, s.B].sort());
    expect(ph.projets[s.A].partage).toBe('lecture');
    // Le document d'un membre ne porte que SES clés : la sienne et celles de ses projets.
    const doc = documentPourMembre(s.d, listeMembres(s.d).find(m => m.compte === LEA)!, 'Enzo');
    expect(doc.cle).toBe(s.d.reglages.membres![LEA].cle);
    expect(Object.keys(doc.clesProjets ?? {})).toEqual([s.A]);
    expect(JSON.stringify(doc)).not.toContain(s.d.reglages.membres![HUGO].cle);
    expect(JSON.stringify(doc)).not.toContain(s.d.reglages.clesProjets![s.B].cle);
    expect(JSON.stringify(doc)).not.toContain('Secret');
    expect(doc.membres).toEqual({ [LEA]: 'Léa', [HUGO]: 'Hugo', [ZOE]: 'Zoé' });
    // Seul le Fondateur invite et partage ; un projet d'une autre app ne se partage pas.
    expect(() => changerDroit(s.d, s.A, LEA, 'lecture', { ...par(LEA), aleaOctets: aleatoireDeterministe(1) })).toThrow(ErreurTaches);
    expect(() => changerDroit(s.d, s.A, 'inconnu01', 'lecture', f())).toThrow(/Invitez/);
  });

  it('droits côté membre : lecture, écriture, admin (gérer sans partager ni supprimer)', () => {
    const s = scenario();
    const copie = (compte: string) => appliquerReception(copieVide(), documentPourMembre(s.d, listeMembres(s.d).find(m => m.compte === compte)!));
    const z = copie(ZOE);
    expect(z.moi).toBe(ZOE);
    expect(droitsProjet('ami', z.donnees, s.A, ZOE)).toMatchObject({ modifier: true, gerer: true, partager: false, supprimerProjet: false });
    const h = copie(HUGO);
    expect(droitsProjet('ami', h.donnees, s.A, HUGO)).toMatchObject({ voir: true, modifier: false, gerer: false });
    expect(droitsProjet('ami', h.donnees, s.B, HUGO)).toMatchObject({ modifier: true, gerer: false });
  });

  it('retours : écriture acceptée, lecture refusée, admin limité aux paramètres et listes, auteurs vérifiés', () => {
    const s = scenario();
    const membre = (c: string) => listeMembres(s.d).find(m => m.compte === c)!;
    const cop = (c: string) => appliquerReception(copieVide(), documentPourMembre(s.d, membre(c)));
    const envoi = (c: string, d: DonneesTaches) => {
      const cp = { ...cop(c), donnees: d };
      const e = envoiDeLAmi(cp);
      return ouvrirEnvoi(cp.cle!, scellerEnvoi(cp.cle!, e, new Date(T0).toISOString(), aleatoireDeterministe(9), cp.clesProjets, cp.moi));
    };
    // Léa (écriture) : statut et commentaire acceptés.
    let dl = modifierTache(cop(LEA).donnees, s.t1, { statut: 'en-cours' }, par(LEA));
    dl = ajouterCommentaire(dl, s.t1, 'Fait de mon côté', par(LEA));
    let r = appliquerEnvoiMembre(s.d, envoi(LEA, dl), LEA);
    expect(r.acceptees).toBe(1);
    expect(r.donnees.taches[s.t1].statut).toBe('en-cours');
    expect(Object.values(r.donnees.taches[s.t1].commentaires)[0]).toMatchObject({ auteur: LEA, texte: 'Fait de mon côté' });
    // Hugo (lecture sur A) : rien n'est pris ; sur B (écriture), si.
    let dh = modifierTache(cop(HUGO).donnees, s.t1, { titre: 'Piraté' }, par(HUGO));
    dh = modifierTache(dh, s.t2, { priorite: 'haute' }, par(HUGO));
    r = appliquerEnvoiMembre(s.d, envoi(HUGO, dh), HUGO);
    expect(r.donnees.taches[s.t1].titre).toBe('Maquette');
    expect(r.donnees.taches[s.t2].priorite).toBe('haute');
    // Hugo forge quand même un paquet pour A (il en a la clé : lecture) : refusé par le Fondateur.
    const ch = cop(HUGO);
    const forgePaquet = sceller(ch.clesProjets![s.A], { taches: { [s.t1]: dh.taches[s.t1] } }, `tp|${s.A}|${HUGO}`, new Date(T0).toISOString(), aleatoireDeterministe(8));
    r = appliquerEnvoiMembre(s.d, { v: 1, taches: {}, scelles: { [s.A]: forgePaquet } }, HUGO);
    expect(r.refusees).toBe(1);
    expect(r.donnees.taches[s.t1].titre).toBe('Maquette');
    // Léa forge un commentaire « du Fondateur » : écarté.
    const forge = cop(LEA).donnees;
    const t = forge.taches[s.t1];
    const faux = { ...forge, taches: { ...forge.taches, [s.t1]: { ...t, commentaires: { mfaux0000001: { id: 'mfaux0000001', auteur: 'fondateur', texte: 'Je valide', date: new Date(T0).toISOString(), h: `${new Date(T0 + 99).toISOString()}|${LEA}` } }, h: { ...t.h, priorite: `${new Date(T0 + 99).toISOString()}|${LEA}` }, priorite: 'basse' as const } } };
    r = appliquerEnvoiMembre(s.d, envoi(LEA, faux), LEA);
    expect(Object.keys(r.donnees.taches[s.t1].commentaires)).toHaveLength(0);
    // Zoé (admin de A) : renomme le projet, ajoute une liste ; ne peut ni changer le partage, ni supprimer une liste.
    let dz = modifierProjet(cop(ZOE).donnees, s.A, { nom: 'Site v2', partage: 'aucun' }, par(ZOE));
    dz = creerListe(dz, s.A, 'Recette', par(ZOE)).donnees;
    r = appliquerEnvoiMembre(s.d, envoi(ZOE, dz), ZOE);
    expect(r.donnees.projets[s.A].nom).toBe('Site v2');
    expect(droitDe(r.donnees, s.A, LEA)).toBe('ecriture');
    expect(r.donnees.projets[s.A].acces).toEqual(s.d.projets[s.A].acces);
    expect(Object.values(r.donnees.listes).some(l => l.nom === 'Recette' && l.projetId === s.A)).toBe(true);
    // Léa (écriture, pas admin) : son renommage du projet n'est pas repris.
    const dl2 = modifierProjet(cop(LEA).donnees, s.A, { nom: 'Pas moi' }, par(LEA));
    r = appliquerEnvoiMembre(s.d, envoi(LEA, dl2), LEA);
    expect(r.donnees.projets[s.A].nom).toBe('Site');
    // Un membre V3 n'envoie pas au format à plat des V1/V2.
    r = appliquerEnvoiMembre(s.d, { v: 1, taches: { [s.t1]: { ...s.d.taches[s.t1], titre: 'À plat' } } }, LEA);
    expect(r.donnees.taches[s.t1].titre).toBe('Maquette');
  });

  it('révocation : la clé du projet tourne, l’ancien membre n’ouvre plus rien, ceux qui restent continuent', () => {
    const s = scenario();
    const avant = s.d.reglages.clesProjets![s.A].cle;
    const lea = listeMembres(s.d).find(m => m.compte === LEA)!;
    const copieLea = appliquerReception(copieVide(), documentPourMembre(s.d, lea));
    const copieZoe = appliquerReception(copieVide(), documentPourMembre(s.d, listeMembres(s.d).find(m => m.compte === ZOE)!));
    // Léa est retirée du projet A.
    const d = changerDroit(s.d, s.A, LEA, 'aucun', f());
    expect(d.reglages.clesProjets![s.A].cle).not.toBe(avant);
    expect(d.reglages.clesProjets![s.A].avant).toBe(avant);
    expect(Object.keys(projectionPourMembre(d, LEA).projets)).toEqual([]);
    // Ce qu'elle renvoie encore (scellé par l'ancienne clé) est refusé ; Zoé, restée, passe encore avec l'ancienne.
    const envoi = (cp: ReturnType<typeof appliquerReception>, dd: DonneesTaches) => ouvrirEnvoi(cp.cle!, scellerEnvoi(cp.cle!, envoiDeLAmi({ ...cp, donnees: dd }), new Date(T0).toISOString(), aleatoireDeterministe(4), cp.clesProjets, cp.moi));
    let r = appliquerEnvoiMembre(d, envoi(copieLea, modifierTache(copieLea.donnees, s.t1, { titre: 'Après retrait' }, par(LEA))), LEA);
    expect(r.donnees.taches[s.t1].titre).toBe('Maquette');
    r = appliquerEnvoiMembre(d, envoi(copieZoe, modifierTache(copieZoe.donnees, s.t1, { priorite: 'urgente' }, par(ZOE))), ZOE);
    expect(r.donnees.taches[s.t1].priorite).toBe('urgente');
    // Le nouveau document de Zoé porte la NOUVELLE clé ; un paquet scellé par une clé inconnue est refusé.
    const docZ = documentPourMembre(d, listeMembres(d).find(m => m.compte === ZOE)!);
    expect(docZ.clesProjets![s.A]).toBe(d.reglages.clesProjets![s.A].cle);
    const paquet = sceller('12'.repeat(32), { taches: {} }, `tp|${s.A}|${ZOE}`, new Date(T0).toISOString(), aleatoireDeterministe(2));
    r = appliquerEnvoiMembre(d, { v: 1, taches: {}, scelles: { [s.A]: paquet } }, ZOE);
    expect(r.refusees).toBe(1);
    // Un paquet rejoué pour un autre projet (données associées) est refusé.
    const pB = sceller(d.reglages.clesProjets![s.A].cle, { taches: {} }, `tp|${s.A}|${ZOE}`, new Date(T0).toISOString(), aleatoireDeterministe(3));
    r = appliquerEnvoiMembre(d, { v: 1, taches: {}, scelles: { [s.B]: pB } }, ZOE);
    expect(r.refusees).toBe(1);
    // Retirer Léa de Tâches : plus membre, plus de clé.
    const d2 = retirerMembre(d, LEA, f());
    expect(listeMembres(d2).map(m => m.compte)).not.toContain(LEA);
    expect(d2.reglages.membres?.[LEA]).toBeUndefined();
  });

  it('l’ami des V1/V2 reste membre (code « ami ») ; ses retours à plat sont encore acceptés', () => {
    const s = scenario();
    let d = changerReglages(s.d, { ami: 'amiv2x0001', amiNom: 'Max', cle: 'cd'.repeat(32) }, f());
    d = modifierProjet(d, s.B, { partage: 'ecriture' }, f());
    expect(listeMembres(d).find(m => m.code === 'ami')?.nom).toBe('Max');
    expect(droitDe(d, s.B, 'amiv2x0001')).toBe('ecriture');
    const t = { ...d.taches[s.t2], titre: 'Par Max', h: { ...d.taches[s.t2].h, titre: `${new Date(T0 + 500_000).toISOString()}|a` } };
    const r = appliquerEnvoiMembre(d, { v: 1, taches: { [s.t2]: t } }, 'amiv2x0001');
    expect(r.donnees.taches[s.t2].titre).toBe('Par Max');
    // Changer son droit V3 met aussi `partage` à jour (appareils plus anciens).
    const d2 = changerDroit(d, s.B, 'amiv2x0001', 'lecture', f());
    expect(d2.projets[s.B].partage).toBe('lecture');
  });
});

// ------------------------------------------------------------------ Relais : trois membres

describe('trois membres par le relais en mémoire', () => {
  const maitre = { relais: RELAIS_TEST, jeton: JETON_TEST };
  const CLE_SYNCHRO = '11'.repeat(32);
  const mem = () => {
    const m = new Map<string, string>();
    return { m, base: { lire: (k: string) => m.get(k), ecrire: (k: string, v: string) => void m.set(k, v) } as BasePrefs };
  };
  let horloge = Date.UTC(2026, 9, 13, 9, 0);
  const iso = (sauter = 31_000) => new Date((horloge += sauter)).toISOString();

  it('chacun ses projets, chiffrés ; révocation ; écritures comptées', async () => {
    const relais = relaisPortees();
    const espF = espacesDuRelais(maitre, relais.requete);
    const s = scenario();
    const pc = mem();
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(s.d));
    const membres: Record<string, ReturnType<typeof mem>> = { [LEA]: mem(), [HUGO]: mem(), [ZOE]: mem() };
    const esp = Object.fromEntries(Object.keys(membres).map(c => [c, espacesDuRelais(liaisonPourProfil(maitre, c), relais.requete)]));
    const suivis: Record<string, SuiviTachesAmi> = {};
    let etatF: EtatTachesFondateur = {};
    const comptes = new Set(Object.keys(membres));
    const tourF = async (retours: Record<string, unknown> = {}) => {
      const r = await synchroniserTachesFondateur({ espaces: espF, base: pc.base, cleSynchro: CLE_SYNCHRO, etat: etatF, objetsAdmin: await espF.lister('principal'), objetsCompte: id => espF.lister(id), comptes, retours, nomFondateur: 'Enzo', maintenant: iso(), alea: aleatoireDeterministe(3) });
      expect(r.erreurs).toEqual([]);
      etatF = r.etat;
      return r;
    };
    const tourM = async (c: string) => {
      const r = await recevoirTachesAmi({ espaces: esp[c], id: c, base: membres[c].base, objets: await esp[c].lister(c), suivi: suivis[c] ?? {}, maintenant: iso(0), alea: aleatoireDeterministe(5) });
      suivis[c] = r.suivi;
      return r;
    };
    // Avant leur clé de réception : en attente, rien n'est déposé chez eux.
    let r = await tourF();
    expect(r.attente.sort()).toEqual(Object.keys(membres).sort());
    expect(r.depots).toBe(1); // le principal seulement
    for (const c of Object.keys(membres)) {
      await tourM(c);
      await esp[c].deposer(c, OBJET_CLE, documentCle(paireDe(membres[c].base).publique), iso(0));
    }
    const ecrituresAvant = relais.appels.filter(x => x.methode === 'PUT' || x.methode === 'DELETE').length;
    r = await tourF();
    expect(r.depots).toBe(3); // un dépôt par membre
    for (const c of Object.keys(membres)) {
      const brut = relais.boite.get(`p:${c}:${OBJET_TACHES}`)!;
      expect(brut).not.toMatch(/Maquette|API|Secret|Site|Appli|Léa|Hugo|Zoé|Enzo/);
      await tourM(c);
    }
    const titres = (c: string) => Object.values(lireCopie(membres[c].m.get(CLES_TACHES.copie)).donnees.taches).map(t => t.titre).sort();
    expect(titres(LEA)).toEqual(['Maquette']);
    expect(titres(HUGO)).toEqual(['API', 'Maquette']);
    expect(titres(ZOE)).toEqual(['Maquette']);
    // Un membre ne lit pas le dépôt d'un autre.
    await expect(esp[LEA].lire(HUGO, OBJET_TACHES)).rejects.toThrow();
    // Léa change une tâche : un retour (le sien), puis un tour du Fondateur republie chez les membres du projet A seulement.
    const cl = lireCopie(membres[LEA].m.get(CLES_TACHES.copie));
    membres[LEA].base.ecrire(CLES_TACHES.copie, JSON.stringify({ ...cl, donnees: modifierTache(cl.donnees, s.t1, { statut: 'en-cours' }, { maintenant: horloge, auteur: LEA }) }));
    const rl = await tourM(LEA);
    const env = rl.envoi!.sceller(iso(0));
    await esp[LEA].deposer(LEA, 'compte', JSON.stringify({ taches: env }), iso(0));
    expect(relais.boite.get(`p:${LEA}:compte`)).not.toMatch(/en-cours|Maquette/);
    const retour = JSON.parse((await espF.lire(LEA, 'compte'))!.charge) as { taches: unknown };
    r = await tourF({ [LEA]: retour.taches });
    expect(lireDonnees(pc.m.get(CLES_TACHES.donnees)).taches[s.t1].statut).toBe('en-cours');
    expect(r.depots).toBe(4); // principal + Léa, Hugo, Zoé (le projet A a changé pour les trois)
    const ecritures = relais.appels.filter(x => x.methode === 'PUT' || x.methode === 'DELETE').length - ecrituresAvant;
    // 3 dépôts initiaux + 1 retour de Léa + 4 dépôts = 8 objets (chaque dépôt : valeur + index sur le KV).
    expect(ecritures).toBe(8);
    // Un tour sans changement n'écrit rien.
    r = await tourF();
    expect(r.depots).toBe(0);
    // Mention de Léa par le Fondateur : par le relais, elle arrive dans SES rappels (et pas chez Hugo).
    const ctxM = (c: string) => ({ profil: { id: c, nom: c, admin: false, actif: true, apps: ['taches'] } as never, baseProfil: membres[c].base });
    verifierRappels(ctxM(LEA), horloge);
    verifierRappels(ctxM(HUGO), horloge);
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(ajouterCommentaire(lireDonnees(pc.m.get(CLES_TACHES.donnees)), s.t1, '@Léa peux-tu relire ?', { maintenant: (horloge += 60_000), auteur: 'fondateur' }, [LEA])));
    r = await tourF();
    await tourM(LEA);
    await tourM(HUGO);
    const rl2 = verifierRappels(ctxM(LEA), (horloge += 30_000));
    expect(rl2.map(x => x.texte)).toEqual([expect.stringContaining('vous mentionne')]);
    expect(verifierRappels(ctxM(HUGO), horloge).some(x => /mentionne/.test(x.texte))).toBe(false);
    // Révocation : Léa retirée de Tâches → son dépôt est effacé, sa copie se vide.
    pc.base.ecrire(CLES_TACHES.donnees, JSON.stringify(retirerMembre(lireDonnees(pc.m.get(CLES_TACHES.donnees)), LEA, { ...f(), maintenant: horloge })));
    r = await tourF();
    expect(relais.boite.has(`p:${LEA}:${OBJET_TACHES}`)).toBe(false);
    await tourM(LEA);
    expect(lireCopie(membres[LEA].m.get(CLES_TACHES.copie)).cle).toBeUndefined();
    expect(titres(LEA)).toEqual([]);
    // Les autres reçoivent la nouvelle clé du projet A.
    await tourM(ZOE);
    expect(lireCopie(membres[ZOE].m.get(CLES_TACHES.copie)).clesProjets![s.A]).toBe(lireDonnees(pc.m.get(CLES_TACHES.donnees)).reglages.clesProjets![s.A].cle);
  });
});

describe('synchronisation du Fondateur et écritures locales', () => {
  it('un droit donné pendant la lecture du relais n’est pas écrasé', async () => {
    const s = scenario();
    const m = new Map<string, string>([[CLES_TACHES.donnees, JSON.stringify(s.d)]]);
    const base = { lire: (k: string) => m.get(k), ecrire: (k: string, v: string) => void m.set(k, v) } as BasePrefs;
    const espaces = {
      lire: async () => {
        // Pendant l'attente du relais : le Fondateur ouvre « Appli » à Zoé en lecture.
        m.set(CLES_TACHES.donnees, JSON.stringify(changerDroit(lireDonnees(m.get(CLES_TACHES.donnees)), s.B, ZOE, 'lecture', { ...f(), maintenant: T0 + 5000 })));
        // L'autre appareil du Fondateur a renommé une tâche.
        const distant = modifierTache(s.d, s.t1, { titre: 'Maquette v2' }, { ...f(), maintenant: T0 + 1000 });
        return { charge: JSON.stringify(sceller('11'.repeat(32), distant, OBJET_TACHES, new Date(T0).toISOString(), aleatoireDeterministe(6))), date: new Date(T0).toISOString() };
      },
      deposer: async () => undefined,
      supprimer: async () => undefined,
    } as never;
    await synchroniserTachesFondateur({ espaces, base, cleSynchro: '11'.repeat(32), etat: {}, objetsAdmin: { [OBJET_TACHES]: { date: new Date(T0).toISOString() } } as never, objetsCompte: async () => ({}), comptes: new Set<string>(), retours: {}, nomFondateur: 'Enzo', maintenant: new Date(T0 + 6000).toISOString(), alea: aleatoireDeterministe(3) });
    const fin = lireDonnees(m.get(CLES_TACHES.donnees));
    expect(droitDe(fin, s.B, ZOE)).toBe('lecture');
    expect(fin.taches[s.t1].titre).toBe('Maquette v2');
  });
});

// ------------------------------------------------------------------ Mentions et assignation multiple

describe('mentions et assignation à plusieurs', () => {
  const personnes = [
    { code: 'fondateur', nom: 'Enzo' },
    { code: LEA, nom: 'Léa Martin' },
    { code: HUGO, nom: 'Hugo' },
  ];
  it('lecture des mentions (sans accents ni casse), suggestions, complétion', () => {
    expect(trouverMentions('Merci @lea et @Hugo, voir avec @enzo', personnes, HUGO)).toEqual([LEA, 'fondateur']);
    expect(trouverMentions('email@exemple.fr', personnes)).toEqual([]);
    expect(trouverMentions('@LéaMartin ok', personnes)).toEqual([LEA]);
    expect(trouverMentions('Relis ?@Léa (et @hugo)', personnes)).toEqual([LEA, HUGO]);
    expect(decouperMentions('Hé @Léa !', personnes)).toEqual([{ texte: 'Hé ' }, { texte: '@Léa', mention: LEA }, { texte: ' !' }]);
    expect(suggestionsMention('Bonjour @h', personnes).map(p => p.code)).toEqual([HUGO]);
    expect(suggestionsMention('Bonjour @', personnes, 'fondateur').map(p => p.code)).toEqual([LEA, HUGO]);
    expect(completerMention('Bonjour @h', personnes[2])).toBe('Bonjour @Hugo ');
  });

  it('notification « mention » chez la personne mentionnée, selon SES réglages', () => {
    const s = scenario();
    const copie = appliquerReception(copieVide(), documentPourMembre(s.d, listeMembres(s.d).find(m => m.compte === LEA)!));
    const noms = { fondateur: 'Enzo', [LEA]: 'Léa', [HUGO]: 'Hugo', [ZOE]: 'Zoé', ami: 'Ami' };
    // Premier passage : rien n'est rattrapé.
    const e0 = evaluerNotifications(copie.donnees, etatRappelsVide(), T0 + 1000, LEA, { noms });
    expect(e0.pastille).toEqual([]);
    const d = ajouterCommentaire(copie.donnees, s.t1, '@Léa peux-tu relire ?', { maintenant: T0 + 60_000, auteur: ZOE }, [LEA]);
    const e1 = evaluerNotifications(d, e0.etat, T0 + 120_000, LEA, { noms });
    expect(e1.pastille).toHaveLength(1);
    expect(e1.pastille[0]).toMatchObject({ type: 'mention', texte: expect.stringContaining('Zoé vous mentionne') });
    // Réglage « mention : aucune » : rien.
    const sans = { ...d, reglages: { ...d.reglages, notifA: { ...PREFS_DEFAUT, types: { ...PREFS_DEFAUT.types, mention: 'aucun' } } } };
    expect(lirePrefs(sans.reglages.notifA).types.mention).toBe('aucun');
    expect(evaluerNotifications(sans, e0.etat, T0 + 120_000, LEA, { noms }).pastille).toEqual([]);
    // Hugo, non mentionné, ne reçoit pas de « mention ».
    const e2 = evaluerNotifications(d, e0.etat, T0 + 120_000, HUGO, { noms });
    expect(e2.pastille.every(p => p.type !== 'mention')).toBe(true);
  });

  it('assignation à plusieurs : ajout rapide, filtres, compatibilité avec `assigne`', () => {
    const s = scenario();
    const lu = lireAjoutRapide('Relire la maquette @Léa @hugo demain', { aujourdhui: AUJ, auteur: 'fondateur', noms: { fondateur: 'Enzo', [LEA]: 'Léa Martin', [HUGO]: 'Hugo' } });
    expect(lu.assignes).toEqual([LEA, HUGO]);
    expect(lu.titre).toBe('Relire la maquette');
    const c = creerTache(s.d, { titre: lu.titre, listeId: s.lA, assignes: lu.assignes }, f());
    expect(c.tache.assigne).toBe(LEA);
    expect(assignesDe(c.tache)).toEqual([LEA, HUGO]);
    // Un appareil V2 change `assigne` plus tard : c'est lui qui compte.
    const v2 = { ...c.tache, assigne: 'fondateur' as const, h: { ...c.tache.h, assigne: `${new Date(T0 + 9e6).toISOString()}|f` } };
    expect(assignesDe(v2)).toEqual(['fondateur']);
    const d = modifierTache(c.donnees, c.tache.id, { assignes: [] }, f());
    expect(assignesDe(d.taches[c.tache.id])).toEqual([]);
    expect(d.taches[c.tache.id].assigne).toBeUndefined();
  });
});

// ------------------------------------------------------------------ Chronologie

describe('chronologie (Gantt) et dépendances', () => {
  function chaine() {
    const s = scenario();
    let d = s.d;
    const a = creerTache(d, { titre: 'Conception', listeId: s.lA, debut: AUJ, echeance: { jour: ajouterJours(AUJ, 2) } }, f());
    const b = creerTache(a.donnees, { titre: 'Réalisation', listeId: s.lA, debut: ajouterJours(AUJ, 3), echeance: { jour: ajouterJours(AUJ, 6) } }, f());
    const c = creerTache(b.donnees, { titre: 'Recette', listeId: s.lA, debut: ajouterJours(AUJ, 7), echeance: { jour: ajouterJours(AUJ, 8) } }, f());
    d = modifierTache(c.donnees, b.tache.id, { dependances: [a.tache.id] }, f());
    d = modifierTache(d, c.tache.id, { dependances: [b.tache.id] }, f());
    return { d, a: a.tache.id, b: b.tache.id, c: c.tache.id };
  }
  it('barres, jalons, sans date, échelle', () => {
    const { d, a } = chaine();
    expect(bornes(d.taches[a])).toEqual({ debut: AUJ, fin: ajouterJours(AUJ, 2) });
    expect(bornes({ echeance: { jour: AUJ } })).toEqual({ debut: AUJ, fin: AUJ });
    expect(bornes({ debut: AUJ, echeance: { jour: '2026-10-20' }, jalon: true })).toEqual({ debut: '2026-10-20', fin: '2026-10-20' });
    const r = barres(d, Object.values(d.taches));
    expect(r.barres.map(b => b.tache.titre)).toEqual(['Conception', 'Réalisation', 'Recette']);
    expect(r.sansDate.map(t => t.titre).sort()).toEqual(['API', 'Maquette', 'Secret']);
    const e = echelle(r.barres, 'semaine', AUJ);
    expect(new Date(`${e.debut}T12:00:00`).getDay()).toBe(1);
    expect(e.reperes.length).toBeGreaterThan(1);
    expect(echelle(r.barres, 'jour', AUJ).largeurJour).toBeGreaterThan(echelle(r.barres, 'mois', AUJ).largeurJour);
  });
  it('déplacer, étirer ; dépendance violée ; décaler les suivantes en gardant les durées ; boucle refusée', () => {
    const c = chaine();
    let d = c.d;
    expect(liens(d, Object.values(d.taches)).every(l => !l.viole)).toBe(true);
    d = deplacer(d, c.a, 2, f()); // Conception finit le +4 : Réalisation (+3) commence trop tôt.
    expect(dependanceViolee(d, c.a, c.b)).toBe(true);
    expect(violationsDe(d, c.b)).toEqual([c.a]);
    const r = decalerSuivantes(d, c.a, f());
    expect(r.decalees).toEqual([c.b, c.c]);
    expect(bornes(r.donnees.taches[c.b])).toEqual({ debut: ajouterJours(AUJ, 5), fin: ajouterJours(AUJ, 8) });
    expect(bornes(r.donnees.taches[c.c])).toEqual({ debut: ajouterJours(AUJ, 9), fin: ajouterJours(AUJ, 10) });
    expect(liens(r.donnees, Object.values(r.donnees.taches)).every(l => !l.viole)).toBe(true);
    // Étirer : la fin, le début ; jamais l'un après l'autre.
    d = etirer(r.donnees, c.c, 'fin', 3, f());
    expect(bornes(d.taches[c.c])!.fin).toBe(ajouterJours(AUJ, 13));
    expect(() => etirer(d, c.c, 'debut', 10, f())).toThrow(ErreurTaches);
    // Boucle : Conception ne peut pas dépendre de Recette.
    expect(() => modifierTache(d, c.a, { dependances: [c.c] }, f())).toThrow(/boucle/);
    // Une dépendance terminée n'est plus « violée ».
    d = deplacer(d, c.a, 30, f());
    expect(dependanceViolee(d, c.a, c.b)).toBe(true);
    d = modifierTache(d, c.a, { statut: 'fait' }, f());
    expect(dependanceViolee(d, c.a, c.b)).toBe(false);
  });
});

// ------------------------------------------------------------------ Tableau de bord, objectifs

describe('tableau de bord et objectifs', () => {
  it('statistiques : avancement, par semaine, retard, charge, temps, burndown', () => {
    const s = scenario();
    let d = s.d;
    const x1 = creerTache(d, { titre: 'Retard', listeId: s.lA, echeance: { jour: ajouterJours(AUJ, -3) }, assignes: [LEA], estimation: 60 }, { ...f(), maintenant: T0 - 10 * 86_400_000 });
    d = ajouterTemps(x1.donnees, x1.tache.id, { jour: AUJ, minutes: 90 }, par(LEA));
    d = modifierTache(d, s.t1, { statut: 'fait', assignes: [LEA, ZOE] }, f());
    const st = statistiques(d, AUJ, s.A);
    expect(st.total).toBe(2);
    expect(st.faites).toBe(1);
    expect(st.pourcent).toBe(50);
    expect(st.retard.map(t => t.titre)).toEqual(['Retard']);
    expect(st.parSemaine.at(-1)!.nombre).toBe(1);
    expect(st.parSemaine).toHaveLength(8);
    expect(st.charge).toEqual([{ qui: LEA, ouvertes: 1, estimation: 0 }]);
    expect(st.temps).toMatchObject({ estime: 60, passe: 90, nbEstimees: 1, depassees: 1 });
    expect(st.burndown.restantes.at(-1)).toBe(1);
    expect(st.burndown.restantes[0]).toBe(1);
    expect(st.parStatut.find(x => x.id === 'fait')!.nombre).toBe(1);
    // Global : tout ce qui est visible.
    expect(statistiques(d, AUJ).total).toBe(4);
  });
  it('objectifs : progression par tâches et projets, manuelle, cible chiffrée ; états', () => {
    const s = scenario();
    let r = creerObjectif(s.d, { titre: 'Finir la v2 de Tsuzuku', echeance: ajouterJours(AUJ, 30), projets: [s.A], taches: [s.t2] }, f());
    let d = r.donnees;
    expect(progression(d, r.objectif, AUJ)).toMatchObject({ pourcent: 0, total: 2, etat: 'en-cours', texte: '0 tâche sur 2 (0 %)' });
    d = modifierTache(d, s.t1, { statut: 'fait' }, f());
    expect(progression(d, d.objectifs[r.objectif.id], AUJ)).toMatchObject({ pourcent: 50, faites: 1, total: 2 });
    d = modifierTache(d, s.t2, { statut: 'fait' }, f());
    expect(progression(d, d.objectifs[r.objectif.id], AUJ).etat).toBe('atteint');
    // Manuel, cible chiffrée, retard.
    r = creerObjectif(d, { titre: '10 articles', mode: 'manuel', cible: 10, atteint: 4, unite: 'articles', echeance: ajouterJours(AUJ, -1) }, f());
    const p = progression(r.donnees, r.objectif, AUJ);
    expect(p).toMatchObject({ pourcent: 40, etat: 'retard' });
    expect(p.texte).toBe('4 articles sur 10 articles (40 %)');
    d = modifierObjectif(r.donnees, r.objectif.id, { mode: 'manuel', cible: undefined, manuel: 80 }, f());
    expect(progression(d, d.objectifs[r.objectif.id], AUJ).pourcent).toBe(80);
    // Les objectifs sont au Fondateur : ils ne partent pas chez les membres.
    expect(Object.keys(projectionPourMembre(d, LEA).objectifs)).toEqual([]);
    expect(() => creerObjectif(d, { titre: 'x' }, par(LEA))).toThrow(ErreurTaches);
    // Fusion entre appareils du Fondateur.
    expect(Object.keys(lireDonnees(JSON.stringify(d)).objectifs)).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ IA

describe('aide de l’IA (client simulé)', () => {
  const enregistre = (): ClientIA & { demandes: DemandeIA[] } => {
    const demandes: DemandeIA[] = [];
    return { demandes, appeler: async (d, r) => (demandes.push(d), clientIASimule.appeler(d, r)) };
  };
  const reglages = { actif: true, mode: 'api' as const, modele: 'claude-sonnet-5-5', cle: 'sk-ant-' + 'x'.repeat(30) };

  it('découper : le minimum part (ni identifiant, ni commentaire, ni prénom) ; rien n’est créé avant « Appliquer »', async () => {
    const s = scenario();
    let d = ajouterCommentaire(s.d, s.t1, 'Commentaire privé de Léa', par(LEA));
    d = modifierTache(d, s.t1, { description: 'Pages accueil et contact', assignes: [LEA] }, f());
    const client = enregistre();
    const demande = demandeDecouper(d, d.taches[s.t1]);
    expect(demande.message).toContain('Maquette');
    expect(demande.message).toContain('Pages accueil et contact');
    expect(demande.message).not.toMatch(new RegExp(`${s.t1}|Commentaire privé|Léa|${LEA}`));
    const brut = await client.appeler(demande, reglages);
    expect(client.demandes).toHaveLength(1);
    const apercu = lireReponse(demande, brut);
    expect(sousTaches(d, s.t1)).toHaveLength(0); // l'appel n'a rien changé
    if (apercu.genre !== 'decouper') throw new Error();
    apercu.sousTaches[1].garder = false;
    const r = appliquerDecoupage(d, s.t1, apercu, f());
    expect(r.creees).toBe(3);
    expect(sousTaches(r.donnees, s.t1).map(t => t.titre)).toEqual(['Préparer : Maquette', 'Relire et vérifier', 'Partager le résultat']);
  });

  it('réponses non sûres : vides refusées, références inconnues écartées, textes bornés', () => {
    const s = scenario();
    const dd = demandeDecouper(s.d, s.d.taches[s.t1]);
    expect(() => lireReponse(dd, { sousTaches: [] })).toThrow(ErreurTaches);
    expect(() => lireReponse(dd, 'n’importe quoi')).toThrow(ErreurTaches);
    const ap = lireReponse(dd, { sousTaches: [{ titre: 'x'.repeat(500), minutes: -3 }, { titre: 42 }] });
    expect(ap.genre === 'decouper' && ap.sousTaches).toEqual([{ titre: `${'x'.repeat(200)}…`, garder: true }]);
    const dp = demandePlanning(s.d, Object.values(s.d.taches), AUJ);
    expect(Object.keys(dp.refs)).toEqual(['T1', 'T2', 'T3']);
    expect(dp.message).not.toContain(s.t1);
    const pl = lireReponse(dp, { jours: [{ jour: AUJ, taches: ['T1', 'T9', 'T1'] }, { jour: 'demain', taches: ['T2'] }] });
    expect(pl).toEqual({ genre: 'planning', jours: [{ jour: AUJ, taches: ['T1'] }] });
    const r = appliquerPlanning(s.d, dp, pl as Extract<typeof pl, { genre: 'planning' }>, f());
    expect(r.planifiees).toBe(1);
    expect(r.donnees.taches[dp.refs.T1].debut).toBe(AUJ);
  });

  it('résumer : projet et débriefing anonymisé ; secrets lus, clé masquée', () => {
    const s = scenario();
    const dr = demandeResumer(s.d, s.A, AUJ, anonymiser('Léa a fini la maquette, Hugo relit.', ['Léa', 'Hugo']));
    expect(dr.message).toContain('Personne');
    expect(dr.message).not.toMatch(/Léa|Hugo/);
    expect(lireReponse(dr, { resume: 'Ça avance.', points: ['a'], risques: [] })).toMatchObject({ genre: 'resumer', resume: 'Ça avance.' });
    expect(lireSecrets(undefined).ia).toEqual({ actif: false, mode: 'api', modele: 'claude-sonnet-5-5' });
    const sec = lireSecrets(JSON.stringify({ ia: { actif: true, cle: reglages.cle, modele: 'claude-opus-5-5' }, github: { actif: true, jeton: 'pas-un-jeton' } }));
    expect(sec.ia).toMatchObject({ actif: true, cle: reglages.cle, modele: 'claude-opus-5-5' });
    expect(sec.github.jeton).toBeUndefined();
    expect(masquer(reglages.cle)).toBe('sk-ant-…xxxx');
    // La clé n'entre jamais dans les données synchronisées.
    expect(JSON.stringify(s.d)).not.toContain('sk-ant-');
  });
});

// ------------------------------------------------------------------ GitHub

describe('GitHub (client simulé)', () => {
  it('liens saisis, état de la PR et de la CI, cache, « Faite » à la fusion', async () => {
    expect(lireLienSaisi('zozoto14/tsuzuku#12')).toEqual({ depot: 'zozoto14/tsuzuku', pr: 12 });
    expect(lireLienSaisi('https://github.com/Zozoto14/application-enzo/pull/7')).toEqual({ depot: 'Zozoto14/application-enzo', pr: 7 });
    expect(lireLienSaisi('zozoto14/tsuzuku@feature/v2')).toEqual({ depot: 'zozoto14/tsuzuku', branche: 'feature/v2' });
    expect(lireLienSaisi('https://github.com/a/b/tree/main')).toEqual({ depot: 'a/b', branche: 'main' });
    expect(lireLienSaisi('pas un lien')).toBeUndefined();
    const s = scenario();
    let d = modifierTache(s.d, s.t1, { github: { depot: 'zozoto14/tsuzuku', pr: 12, faiteSiFusion: true } }, f());
    d = modifierTache(d, s.t2, { github: { depot: 'zozoto14/tsuzuku', pr: 13 } }, f());
    const appels: string[] = [];
    const client: ClientGithub = { lire: async (c, j) => (appels.push(c), clientGithubSimule.lire(c, j)) };
    const e = await lireEtat(client, { depot: 'zozoto14/tsuzuku', pr: 13 }, 'jeton', T0);
    expect(e).toMatchObject({ etat: 'ouverte', numero: 13, ci: 'en-cours' });
    let r = await rafraichir(d, {}, client, 'jeton', T0);
    expect(r.cache[s.t1].etat).toBe('fusionnee');
    expect(r.cache[s.t2].etat).toBe('ouverte');
    const n = appels.length;
    r = await rafraichir(d, r.cache, client, 'jeton', T0 + 60_000); // moins de 5 min : rien n'est relu
    expect(appels.length).toBe(n);
    const f2 = appliquerFusions(d, r.cache, f(), AUJ);
    expect(f2.terminees).toEqual([s.t1]);
    expect(estTerminee(f2.donnees, f2.donnees.taches[s.t1])).toBe(true);
    expect(estTerminee(f2.donnees, f2.donnees.taches[s.t2])).toBe(false);
    // Une seule fois.
    expect(appliquerFusions(f2.donnees, r.cache, f(), AUJ).terminees).toEqual([]);
    // Erreur d'accès lisible.
    await expect(lireEtat({ lire: async () => ({ statut: 401, json: {} }) }, { depot: 'a/b', pr: 1 }, 'j', T0)).rejects.toThrow(/jeton/);
    // Un membre ne pose ni ne change le lien GitHub.
    const lea = listeMembres(d).find(m => m.compte === LEA)!;
    const cp = appliquerReception(copieVide(), documentPourMembre(d, lea));
    const dm = modifierTache(cp.donnees, s.t1, { github: { depot: 'pirate/x', pr: 1 }, priorite: 'haute' }, par(LEA));
    const env = ouvrirEnvoi(cp.cle!, scellerEnvoi(cp.cle!, envoiDeLAmi({ ...cp, donnees: dm }), new Date(T0).toISOString(), aleatoireDeterministe(4), cp.clesProjets, cp.moi));
    const ap = appliquerEnvoiMembre(d, env, LEA);
    expect(ap.donnees.taches[s.t1].github).toEqual({ depot: 'zozoto14/tsuzuku', pr: 12, faiteSiFusion: true });
    expect(ap.donnees.taches[s.t1].priorite).toBe('haute');
  });
});

// ------------------------------------------------------------------ Accès à l'app = membres (Administration)

describe('accès par l’Administration et projets personnels', () => {
  it('l’app ouverte à un profil en fait un membre ; fermée, il est retiré (clés tournées)', () => {
    const s = scenario();
    const profils = [
      { id: 'principal', nom: 'Enzo', admin: true },
      { id: LEA, nom: 'Léa', apps: ['taches'] },
      { id: HUGO, nom: 'Hugo', apps: ['taches'], role: 'gestionnaire' },
      { id: ZOE, nom: 'Zoé', apps: ['taches'] },
      { id: 'gerant0004', nom: 'Gérant', apps: ['taches', 'tsuzuku'], role: 'administrateur' },
      { id: 'sansapp005', nom: 'Sans', apps: ['tsuzuku'] },
    ];
    let d = accorderAcces(s.d, profils, f());
    expect(listeMembres(d).map(m => [m.nom, m.rang])).toEqual([
      ['Gérant', 'administrateur'],
      ['Hugo', 'gestionnaire'],
      ['Léa', 'ami'],
      ['Zoé', 'ami'],
    ]);
    // Rien ne change au tour suivant (aucune écriture).
    expect(accorderAcces(d, profils, f())).toBe(d);
    // Sans projet partagé : un document vide (aucun projet), mais la clé arrive.
    const docG = documentPourMembre(d, listeMembres(d).find(m => m.compte === 'gerant0004')!);
    expect(Object.keys(docG.donnees.projets)).toEqual([]);
    // Hugo perd l'accès (Administration) : retiré, la clé des projets qu'il voyait tourne.
    const cleA = d.reglages.clesProjets![s.A].cle;
    const profils2 = profils.map(p => (p.id === HUGO ? { ...p, apps: [] } : p));
    d = accorderAcces(d, profils2, f());
    expect(listeMembres(d).map(m => m.compte)).not.toContain(HUGO);
    expect(droitDe(d, s.B, HUGO)).toBe('aucun');
    expect(d.reglages.clesProjets![s.A].cle).not.toBe(cleA);
    // Compte désactivé : retiré aussi. Absent de la liste (annuaire en cours de chargement, ou compte supprimé) : gardé.
    d = accorderAcces(d, profils2.filter(p => p.id !== ZOE).map(p => (p.id === LEA ? { ...p, actif: false } : p)), f());
    expect(listeMembres(d).map(m => m.compte).sort()).toEqual(['gerant0004', ZOE].sort());
    expect(accorderAcces(d, profils.slice(0, 1), f())).toBe(d);
    // Liste vide (annuaire pas encore lu) : on ne touche à rien.
    expect(accorderAcces(d, [], f())).toBe(d);
  });

  it('« peut créer ses propres projets » : le droit voyage dans son dépôt', () => {
    const s = scenario();
    let d = changerPerso(s.d, LEA, true, f());
    const doc = documentPourMembre(d, listeMembres(d).find(m => m.compte === LEA)!);
    expect(doc.perso).toBe(true);
    const copie = appliquerReception(copieVide(), doc);
    expect(lireCopie(JSON.stringify(copie)).perso).toBe(true);
    d = changerPerso(d, LEA, false, f());
    expect(documentPourMembre(d, listeMembres(d).find(m => m.compte === LEA)!).perso).toBeUndefined();
    expect(() => changerPerso(s.d, 'inconnu01', true, f())).toThrow(ErreurTaches);
    expect(() => changerPerso(s.d, LEA, true, par(LEA))).toThrow(ErreurTaches);
  });
});
