/**
 * « Le déchiffrement a échoué : mauvaise clé, ou fichier altéré » après « Réinitialiser l'accès »
 * (production, octobre 2026) : un ami réinitialisé choisit son nouveau mot de passe, puis l'écran
 * « Déverrouiller » refuse ce mot de passe avec une erreur de déchiffrement.
 *
 * Rejoue, contre le VRAI relais en mémoire et la vraie session du bureau (sql.js), les étapes de
 * `bureau/index.tsx` : compte créé par le Fondateur, invitation acceptée, appareil de l'ami avec
 * une base locale (modifiée depuis le dernier envoi), réinitialisation par le Fondateur (séquestre :
 * MÊME clé maîtresse), lien ouvert ici ou sur un autre appareil, rechargement → `avantOuverture` →
 * écran « Déverrouiller » → nouveau mot de passe.
 *
 * Cause : la clé maîtresse du compte avait changé (« Régénérer les identifiants ») ; le nouveau
 * coffre partait sur le relais, mais PAS la nouvelle base (écriture perdue au verrouillage qui suit
 * la création du coffre), si bien que le relais gardait la base scellée par l'ANCIENNE clé à côté
 * du coffre de la nouvelle. Chaque appareil la reprenait, et aucune réinitialisation (qui garde la
 * clé) ne pouvait réparer.
 */
import { aleatoireDeterministe } from '../src/securite/aleatoire';
import type { ParametresKdf } from '../src/securite/kdf';
import { ErreurDeverrouillage, cleOuvreCoffre, deverrouillerParMotDePasse, type Coffre } from '../src/securite/coffre';
import { ErreurScelle, descellerOctets } from '../src/securite/scelle';
import { DepotComptes } from '../src/db/depots';
import { ErreurBaseIllisible } from '../src/session/session';
import { compte } from '../src/core/testing/fixtures';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from '../src/sync/relais/__fixtures__/relaisV9';
import { decoderInvitation } from '../src/profils/invitation';
import { appliquerProfilsAdmin, lireAnnuaire, ouvrirAnnuaireAdmin, type Annuaire, type ClesAdmin } from '../src/profils/annuaire';
import { ajouterProfil, fichiersDuProfil, type Profil } from '../src/profils/profils';
import { creerAccesAmi } from '../src/profils/identifiants';
import { empreinteOctets } from '../src/sync/relais/fichiers';
import { chargeEnOctets, espacesDuRelais, octetsEnCharge } from '../src/sync/relais/espaces';
import { accepterInvitation, chargerInvitation, coffreReinitialise, creerInvitation } from './connexionAmis';
import {
  CLES_MEMOIRE,
  avantOuverture,
  garderPourMemeCompte,
  liaisonPourCompte,
  lireAnnuaireFichier,
  oublierSuivi,
  retenirLiaison,
  synchroniserCompteAmi,
  synchroniserComptesAdmin,
  type Memoire,
} from './synchroComptes';
import { ouvrirSessionBureau, type SessionBureau } from './session';
import type { NomFichier, Stockage } from './stockage';

const initSqlJs = require('sql.js');

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };
const ID = 'raph000001';
const NOMS = fichiersDuProfil(ID) as { coffre: NomFichier; portefeuille: NomFichier };
const ECARTE = `ecarte-${NOMS.portefeuille}`;
const ANCIEN = 'Ancien mot de passe 2026';
const NOUVEAU = 'Nouveau mot de passe 2026';
const encodeur = new TextEncoder();
const decodeur = new TextDecoder();
jest.setTimeout(120_000);

type Disque = Stockage & { f: Map<string, Uint8Array> };
function disque(): Disque {
  const f = new Map<string, Uint8Array>();
  return { f, surDisque: true, lire: async n => f.get(n), ecrire: async (n, o) => void f.set(n, o), emplacement: async () => 'mémoire' };
}
function memoire(): Memoire {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}

let fabrique: unknown;
beforeAll(async () => {
  fabrique = await initSqlJs();
});

/** Horloge qui avance d'une minute à chaque lecture (dates de dépôt toutes distinctes). */
let t = Date.now();
const horloge = () => new Date((t += 60_000));
let graine = 3;

/** Le PC du Fondateur : annuaire, fichiers de l'ami, synchronisation des comptes. */
function pcFondateur(relais: RelaisV9) {
  const d = disque();
  const mem = memoire();
  const cles: ClesAdmin = { annuaire: new Uint8Array(32).fill(7), sequestre: new Uint8Array(32).fill(9) };
  const copie = () => ({ annuaire: cles.annuaire.slice(), sequestre: cles.sequestre.slice() });
  const ecrire = async (x: Annuaire) => d.ecrire('profils', encodeur.encode(JSON.stringify({ ...x, format: 'annuaire' })));
  const coffreAmi = (): Coffre => JSON.parse(decodeur.decode(d.f.get(NOMS.coffre)!)) as Coffre;
  const tour = () =>
    synchroniserComptesAdmin({ liaison: MAITRE, memoire: mem, fichiers: d, lire: () => lireAnnuaireFichier(d), ecrire, cles: copie, requete: relais.requete, maintenant: horloge, effacerFichiers: async () => undefined });
  return {
    d,
    coffreAmi,
    tour,
    async preparer() {
      const alea = aleatoireDeterministe(11);
      const vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copie(), alea);
      let profils: Profil[] = vue.profils.map(p => (p.admin ? { ...p, nom: 'Enzo' } : p));
      profils = ajouterProfil(profils, 'RaphouT', ID, '2026-10-24', ['portefeuille']);
      await ecrire(appliquerProfilsAdmin(vue.annuaire, profils, copie(), alea));
    },
    /**
     * Création, ou « Régénérer les identifiants » (bureau/index.tsx, creerCoffreAmi) : fichiers
     * effacés, nouveau coffre, NOUVELLE clé maîtresse. Rend le mot de passe temporaire et la clé
     * (celle que le séquestre du Fondateur garde).
     */
    async creerCoffreAmi(): Promise<{ temporaire: string; cle: Uint8Array }> {
      await d.ecrire(NOMS.coffre, new Uint8Array(0));
      await d.ecrire(NOMS.portefeuille, new Uint8Array(0));
      const ami = await ouvrirSessionBureau({ fabrique: fabrique as never, stockage: d, profil: ID, delaiEcriture: 400, kdf: KDF });
      const { motDePasse } = creerAccesAmi(ami.session, 'RaphouT', aleatoireDeterministe((graine += 17)));
      await ami.vider();
      return { temporaire: motDePasse, cle: deverrouillerParMotDePasse(coffreAmi(), motDePasse) };
    },
    /** « Réinitialiser l'accès » (onInvitation) : clé du séquestre, nouveau mot de passe temporaire. */
    async reinitialiser(cleSequestre: Uint8Array, temporaire: string) {
      await tour();
      await d.ecrire(NOMS.coffre, encodeur.encode(JSON.stringify(coffreReinitialise(coffreAmi(), cleSequestre, temporaire, { kdf: KDF }))));
      await tour();
      return (await creerInvitation({ maitre: MAITRE, compte: ID, prenom: 'RaphouT', motDePasse: temporaire, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF })).lien;
    },
  };
}

/** Un appareil de l'ami (navigateur ou PC) : ses fichiers, la mémoire de son navigateur. */
function appareilAmi(relais: RelaisV9) {
  const d = disque();
  const mem = memoire();
  return {
    d,
    /** Lien ouvert ICI : `accepterInvitation` puis `installerCompteAmi` (bureau/index.tsx). */
    async accepter(lien: string, motDePasse: string) {
      const chargee = await chargerInvitation(decoderInvitation(lien)!, relais.requete);
      const a = await accepterInvitation({ invitation: chargee, motDePasse, requete: relais.requete, kdf: KDF });
      const garder = garderPourMemeCompte(mem, a.relie.compte, a.relie.liaison.relais);
      for (const nom of [NOMS.coffre, NOMS.portefeuille]) if (!garder.fichiers.includes(nom)) await d.ecrire(nom, new Uint8Array(0));
      oublierSuivi(mem);
      garder.restaurer();
      retenirLiaison(mem, a.relie.liaison);
      await d.ecrire(NOMS.coffre, a.octets);
      const etat = JSON.parse(mem.getItem(CLES_MEMOIRE.fichiers) ?? '{}') as Record<string, unknown>;
      mem.setItem(CLES_MEMOIRE.fichiers, JSON.stringify({ ...etat, [NOMS.coffre]: { h: empreinteOctets(a.octets), date: a.date } }));
    },
    /** Rechargement → prénom → `avantOuverture` → session : l'écran « Déverrouiller ». */
    async ouvrir(): Promise<SessionBureau> {
      let relu: Uint8Array | undefined;
      await avantOuverture({ memoire: mem, fichiers: d, compte: ID, requete: relais.requete, maintenant: horloge, surPortefeuilleRelais: o => (relu = o) });
      return ouvrirSessionBureau({ fabrique: fabrique as never, stockage: d, profil: ID, delaiEcriture: 0, portefeuillesAlternatifs: () => (relu ? [relu] : []) });
    },
    /** Tour de synchronisation de l'ami, compte ouvert ici. */
    tour: () =>
      synchroniserCompteAmi({ liaison: liaisonPourCompte(mem, ID)!, id: ID, memoire: mem, fichiers: d, lire: async () => lireAnnuaire(undefined), ecrire: async () => undefined, requete: relais.requete, maintenant: horloge }),
  };
}

const noms = (s: SessionBureau) => new DepotComptes(s.session.base()).tous().map(c => c.nom).sort();
const portefeuilleRelais = async (relais: RelaisV9) => {
  const lu = await espacesDuRelais(MAITRE, relais.requete).lire(ID, 'portefeuille');
  return lu ? chargeEnOctets(lu.charge) : undefined;
};

/** RaphouT accepté sur l'appareil A, un PEA envoyé, puis une modification PAS encore partie (onglet fermé avant le tour). */
async function situationDeDepart() {
  const relais = relaisV9();
  const pc = pcFondateur(relais);
  await pc.preparer();
  const { temporaire, cle } = await pc.creerCoffreAmi();
  await pc.tour();
  const a = appareilAmi(relais);
  const lien = await creerInvitation({ maitre: MAITRE, compte: ID, prenom: 'RaphouT', motDePasse: temporaire, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF });
  await a.accepter(lien.lien, ANCIEN);
  const s = await a.ouvrir();
  s.session.deverrouiller({ motDePasse: ANCIEN, codeTotp: '' });
  new DepotComptes(s.session.base()).enregistrer(compte({ id: 'pea', nom: 'PEA envoyé' }));
  await s.vider();
  await a.tour();
  new DepotComptes(s.session.base()).enregistrer(compte({ id: 'cto', nom: 'Compte-titres pas encore envoyé' }));
  await s.vider();
  s.session.verrouiller();
  return { relais, pc, a, cle };
}

describe('réinitialisation de l’accès d’un ami (séquestre : même clé maîtresse)', () => {
  it('lien ouvert sur un AUTRE appareil : sur A, le nouveau mot de passe ouvre la base locale (modification non envoyée comprise), l’ancien ne marche plus', async () => {
    const { relais, pc, a, cle } = await situationDeDepart();
    const lien = await pc.reinitialiser(cle, 'Temporaire-numero-2');
    const b = appareilAmi(relais);
    await b.accepter(lien, NOUVEAU);

    const s = await a.ouvrir();
    expect(() => s.session.deverrouiller({ motDePasse: ANCIEN, codeTotp: '' })).toThrow(ErreurDeverrouillage);
    s.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    expect(noms(s)).toEqual(['Compte-titres pas encore envoyé', 'PEA envoyé']);

    const sb = await b.ouvrir();
    sb.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    expect(noms(sb)).toContain('PEA envoyé');
  });

  it('lien ouvert sur l’appareil A lui-même : sa base est gardée à l’installation (plus effacée), modification non envoyée comprise', async () => {
    const { pc, a, cle } = await situationDeDepart();
    const lien = await pc.reinitialiser(cle, 'Temporaire-numero-2');
    await a.accepter(lien, NOUVEAU);
    const s = await a.ouvrir();
    s.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    expect(noms(s)).toEqual(['Compte-titres pas encore envoyé', 'PEA envoyé']);
  });

  it('séquestre périmé (clé qui n’ouvre pas le coffre) : réinitialisation refusée plutôt qu’un coffre qui ouvrirait une autre clé', async () => {
    const { pc, cle } = await situationDeDepart();
    const coffre = pc.coffreAmi();
    expect(cleOuvreCoffre(coffre, cle)).toBe(true);
    expect(cleOuvreCoffre(coffre, new Uint8Array(32).fill(1))).toBe(false);
    expect(() => coffreReinitialise(coffre, new Uint8Array(32).fill(1), 'Temporaire-numero-2', { kdf: KDF })).toThrow(/ne correspond plus à son coffre/);
  });
});

describe('clé maîtresse changée (« Régénérer les identifiants »), puis réinitialisation', () => {
  /** Régénération sur le PC (nouvelle clé), réinitialisation par séquestre (cette clé), nouveau mot de passe choisi sur un appareil neuf B. */
  async function apresRegeneration() {
    const depart = await situationDeDepart();
    const { relais, pc } = depart;
    await pc.tour();
    const { cle } = await pc.creerCoffreAmi();
    await pc.tour();
    const lien = await pc.reinitialiser(cle, 'Temporaire-numero-3');
    const b = appareilAmi(relais);
    await b.accepter(lien, NOUVEAU);
    return { ...depart, b, cle2: cle };
  }

  it('cause : la nouvelle base part bien sur le relais avec le nouveau coffre (elle était perdue au verrouillage) ; un appareil neuf s’ouvre', async () => {
    const { relais, b, cle2 } = await apresRegeneration();
    const publie = await portefeuilleRelais(relais);
    expect(() => descellerOctets(cle2, publie!)).not.toThrow();
    const sb = await b.ouvrir();
    sb.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    expect(sb.session.statut()).toBe('deverrouille');
  });

  it('appareil A (base de l’ancienne clé, modifiée ici) : la copie du serveur est reprise toute seule, l’ancienne mise de côté, rien d’effacé', async () => {
    const { a } = await apresRegeneration();
    const avant = a.d.f.get(NOMS.portefeuille)!.slice();
    const s = await a.ouvrir();
    s.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    expect(s.session.statut()).toBe('deverrouille');
    await s.vider();
    expect(a.d.f.get(ECARTE)).toEqual(avant);
    expect(empreinteOctets(a.d.f.get(NOMS.portefeuille)!)).not.toBe(empreinteOctets(avant));
  });

  it('appareil A resté ouvert avec l’ancienne clé : sa base ne repart plus sur le relais une fois le coffre changé là-bas', async () => {
    const relais = relaisV9();
    const pc = pcFondateur(relais);
    await pc.preparer();
    const { temporaire } = await pc.creerCoffreAmi();
    await pc.tour();
    const a = appareilAmi(relais);
    await a.accepter((await creerInvitation({ maitre: MAITRE, compte: ID, prenom: 'RaphouT', motDePasse: temporaire, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF })).lien, ANCIEN);
    const s = await a.ouvrir();
    s.session.deverrouiller({ motDePasse: ANCIEN, codeTotp: '' });
    await s.vider();
    await a.tour();
    // Pendant que A reste ouvert : régénération et nouveau mot de passe ailleurs.
    await pc.tour();
    const { cle } = await pc.creerCoffreAmi();
    await pc.tour();
    await appareilAmi(relais).accepter(await pc.reinitialiser(cle, 'Temporaire-numero-3'), NOUVEAU);
    new DepotComptes(s.session.base()).enregistrer(compte({ id: 'x', nom: 'Écrit avec l’ancienne clé' }));
    await s.vider();
    await a.tour();
    const publie = await portefeuilleRelais(relais);
    expect(() => descellerOctets(cle, publie!)).not.toThrow();
  });

  it('copie du serveur elle aussi de l’ancienne clé (état laissé par le bug) : message clair, puis « Reprendre mes données du serveur » ; un mauvais mot de passe ne reprend rien', async () => {
    const { a, relais, pc } = await apresRegeneration();
    // Ce que le bug laissait sur le relais : la base de l'ANCIENNE clé à côté du nouveau coffre.
    const ancienne = a.d.f.get(NOMS.portefeuille)!.slice();
    await espacesDuRelais(MAITRE, relais.requete).deposer(ID, 'portefeuille', octetsEnCharge(ancienne), horloge().toISOString());
    void pc;
    const s = await a.ouvrir();
    let erreur: unknown;
    try {
      s.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(ErreurBaseIllisible);
    expect(erreur).not.toBeInstanceOf(ErreurScelle);
    expect((erreur as Error).message).not.toMatch(/mauvaise clé, ou fichier altéré/);
    expect((erreur as Error).message).toMatch(/Reprendre mes données du serveur/);
    // Rien d'effacé, aucun échec d'authentification compté.
    expect(a.d.f.get(NOMS.portefeuille)).toEqual(ancienne);
    expect(a.d.f.get(ECARTE)).toBeUndefined();
    expect(s.session.verrou()).toMatchObject({ verrouille: false });
    // Un mauvais mot de passe reste un mauvais mot de passe : rien n'est repris.
    expect(() => s.session.deverrouiller({ motDePasse: 'Pas le bon mot de passe', codeTotp: '', repartirDuServeur: true })).toThrow(ErreurDeverrouillage);
    expect(a.d.f.get(ECARTE)).toBeUndefined();

    s.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '', repartirDuServeur: true });
    expect(s.session.statut()).toBe('deverrouille');
    expect(noms(s)).toEqual([]);
    await s.vider();
    expect(a.d.f.get(ECARTE)).toEqual(ancienne);
    // La base neuve est scellée par la clé du coffre : elle se rouvre au prochain déverrouillage.
    s.session.verrouiller();
    const s2 = await a.ouvrir();
    s2.session.deverrouiller({ motDePasse: NOUVEAU, codeTotp: '' });
    expect(s2.session.statut()).toBe('deverrouille');
  });
});

describe('session du bureau : verrouillage juste après une écriture', () => {
  it('l’écriture en attente est scellée au verrouillage au lieu d’être perdue', async () => {
    const d = disque();
    const s = await ouvrirSessionBureau({ fabrique: fabrique as never, stockage: d, profil: ID, delaiEcriture: 60_000, kdf: KDF });
    s.session.initialiser({ motDePasse: 'Une phrase solide 2026' });
    new DepotComptes(s.session.base()).enregistrer(compte({ id: 'pea', nom: 'PEA' }));
    s.session.verrouiller();
    await s.vider();
    expect(d.f.get(NOMS.portefeuille)?.length).toBeGreaterThan(0);
    const relu = await ouvrirSessionBureau({ fabrique: fabrique as never, stockage: d, profil: ID, delaiEcriture: 0 });
    const coffre = JSON.parse(decodeur.decode(d.f.get(NOMS.coffre)!)) as Coffre;
    relu.session.ouvrirAvecCle(deverrouillerParMotDePasse(coffre, 'Une phrase solide 2026'));
    expect(noms(relu)).toEqual(['PEA']);
  });
});
