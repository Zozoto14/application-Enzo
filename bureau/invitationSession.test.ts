/**
 * « Le relais refuse ce code de liaison » à l'acceptation d'une invitation (production, octobre 2026).
 *
 * Cause : le Fondateur connecté par identifiant sur un navigateur n'a qu'un jeton de SESSION
 * (`s1.…`) ; l'invitation scellait un jeton de profil calculé avec cette session (HMAC), que le
 * serveur refuse (401). Contre le VRAI relais en mémoire : invitation créée depuis une session,
 * invitation déjà émise avec un mauvais jeton (réparée par le serveur), ancienne adresse du relais
 * (Worker Cloudflare), frontal qui coupe les PUT/DELETE, changement de mot de passe, réinitialisation
 * par le Fondateur, mot de passe oublié, et causes exactes des refus.
 */
import { aleatoireDeterministe } from '../src/securite/aleatoire';
import type { ParametresKdf } from '../src/securite/kdf';
import { codeTotp } from '../src/securite/totp';
import { genererCodeRecuperation } from '../src/securite/codes-recuperation';
import { ouvrirBaseNode } from '../src/db/pilotes/node';
import { DepotComptes } from '../src/db/depots';
import { Session } from '../src/session/session';
import { stockageMemoire } from '../src/session/stockage-coffre';
import { decoderInvitation, encoderInvitation, nouveauSecret, lienInvitation, preparerSecours, empreinteIdentifiant, preparerAcces, type ContenuAcces } from '../src/profils/invitation';
import { publierAcces } from '../src/sync/relais/connexionAmis';
import { deposerCoffreSiChange, ecrireConfigRelais } from '../src/sync/relais/synchroniser';
import { synchroniserServeur } from '../src/sync/relais/coffreServeur';
import { jetonDeProfil } from '../src/sync/relais/portees';
import { compte } from '../src/core/testing/fixtures';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from '../src/sync/relais/__fixtures__/relaisV9';
import {
  accepterInvitation,
  chargerInvitation,
  connecterParIdentifiant,
  connecterParSecours,
  creerInvitation,
  publierAccesFondateur,
  relaisActuel,
  republierAcces,
} from './connexionAmis';
import { lireAnnuaireFichier, synchroniserComptesAdmin, type Fichiers, type Memoire } from './synchroComptes';
import { appliquerProfilsAdmin, lireAnnuaire, ouvrirAnnuaireAdmin, type Annuaire, type ClesAdmin } from '../src/profils/annuaire';
import { ajouterProfil, type Profil } from '../src/profils/profils';
import { creerAccesAmi } from '../src/profils/identifiants';
import { RELAIS_OFFICIEL } from './liaisonTemporaire';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };
const ANCIEN = 'https://applibourse-relais.enzo-test.workers.dev';
const ID = 'raph000001';
jest.setTimeout(60_000);

/** Frontal d'hébergement mutualisé : PUT/DELETE coupés (préliminaire CORS → erreur réseau, ou page HTML 405/403). */
function derriereFrontal(relais: RelaisV9, mode: 'reseau' | '405' | '403' = 'reseau'): { requete: typeof fetch; refus: string[] } {
  const refus: string[] = [];
  const requete = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const methode = (init.method ?? 'GET').toUpperCase();
    if (methode === 'PUT' || methode === 'DELETE' || methode === 'PATCH') {
      refus.push(`${methode} ${new URL(String(url)).pathname}`);
      if (mode === 'reseau') throw new TypeError('Failed to fetch');
      return new Response('<html><body>Refusé (LiteSpeed simulé)</body></html>', { status: Number(mode), headers: { 'Content-Type': 'text/html' } });
    }
    return relais.requete(url as string, init);
  }) as unknown as typeof fetch;
  return { requete, refus };
}

/** Requêtes vers une ancienne adresse : servies par le même relais, mais notées (aucune ne doit partir après la réécriture). */
function avecAncienneAdresse(relais: RelaisV9, base: typeof fetch = relais.requete): { requete: typeof fetch; versAncien: string[] } {
  const versAncien: string[] = [];
  const requete = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const adresse = String(url);
    if (adresse.startsWith(ANCIEN)) {
      versAncien.push(`${init.method ?? 'GET'} ${adresse.slice(ANCIEN.length)}`);
      return base(RELAIS_V9 + adresse.slice(ANCIEN.length), init);
    }
    return base(url as string, init);
  }) as unknown as typeof fetch;
  return { requete, versAncien };
}

/** PC du Fondateur migré (identifiant « Enzo »), puis connexion d'un navigateur neuf : SESSION. */
async function fondateurEnSession(relais: RelaisV9) {
  const session = new Session({ stockage: stockageMemoire(), ouvrirBase: () => ouvrirBaseNode(), kdf: KDF, alea: aleatoireDeterministe(7) });
  const { secretTotp } = session.initialiser({ motDePasse: 'ancien mot de passe du PC' });
  new DepotComptes(session.base()).enregistrer(compte({ nom: 'PEA du Fondateur' }));
  ecrireConfigRelais(session.base(), { ...MAITRE, cle: session.cleDerivee('synchro'), nom: 'PC' });
  const alea = aleatoireDeterministe(11);
  const codes = Array.from({ length: 10 }, () => genererCodeRecuperation(alea));
  const code = codeTotp(secretTotp, Date.now());
  session.verifierIdentite({ motDePasse: 'ancien mot de passe du PC', codeTotp: code });
  await publierAccesFondateur({ maitre: MAITRE, identifiant: 'Enzo', motDePasse: 'Une phrase solide 2026', codes, requete: relais.requete, kdf: KDF });
  const { coffre } = session.passerAConnexionParIdentifiant({ motDePasseActuel: 'ancien mot de passe du PC', codeTotp: code, nouveauMotDePasse: 'Une phrase solide 2026', codes });
  await deposerCoffreSiChange(session.base(), MAITRE, coffre, relais.requete);
  await synchroniserServeur({ pilote: session.base(), liaison: MAITRE, cle: session.cleDerivee('synchro'), compte: 'principal', requete: relais.requete });
  const c = await connecterParIdentifiant(RELAIS_V9, 'Enzo', 'Une phrase solide 2026', relais.requete);
  expect(c.relie.liaison.jeton).toMatch(/^s1\./);
  return c.relie.liaison;
}

/** Le compte de RaphouT (coffre au mot de passe temporaire) publié sur le relais par le Fondateur ; rend le mot de passe temporaire. */
async function publierCompteRaph(relais: RelaisV9, maitre = MAITRE): Promise<string> {
  const fichiers = new Map<string, Uint8Array>();
  const disque: Fichiers = { lire: async n => fichiers.get(n), ecrire: async (n, o) => void fichiers.set(n, o) };
  const m = new Map<string, string>();
  const mem: Memoire = { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
  const cles: ClesAdmin = { annuaire: new Uint8Array(32).fill(7), sequestre: new Uint8Array(32).fill(9) };
  const copie = () => ({ annuaire: cles.annuaire.slice(), sequestre: cles.sequestre.slice() });
  const alea = aleatoireDeterministe(11);
  const vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copie(), alea);
  let profils: Profil[] = vue.profils.map(p => (p.admin ? { ...p, nom: 'Enzo' } : p));
  profils = ajouterProfil(profils, 'RaphouT', ID, '2026-10-24', ['portefeuille']);
  const ecrire = async (x: Annuaire) => disque.ecrire('profils', new TextEncoder().encode(JSON.stringify({ ...x, format: 'annuaire' })));
  await ecrire(appliquerProfilsAdmin(vue.annuaire, profils, copie(), alea));
  const stockage = stockageMemoire();
  const ids = creerAccesAmi(new Session({ stockage, ouvrirBase: () => ouvrirBaseNode(), kdf: KDF, profil: ID }), 'RaphouT', aleatoireDeterministe(3));
  await disque.ecrire(`coffre-${ID}`, new TextEncoder().encode(JSON.stringify(stockage.lire())));
  await synchroniserComptesAdmin({ liaison: maitre, memoire: mem, fichiers: disque, lire: () => lireAnnuaireFichier(disque), ecrire, cles: copie, requete: relais.requete, effacerFichiers: async () => undefined });
  return ids.motDePasse;
}

const inviter = (maitre: { relais: string; jeton: string }, temporaire: string, requete: typeof fetch) =>
  creerInvitation({ maitre, compte: ID, prenom: 'RaphouT', motDePasse: temporaire, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete, kdfCodeCourt: KDF });

describe('relaisActuel', () => {
  it('réécrit seulement une ancienne adresse connue du relais (Worker Cloudflare)', () => {
    expect(relaisActuel(`${ANCIEN}/`)).toBe(RELAIS_OFFICIEL);
    expect(relaisActuel(ANCIEN, 'https://relais.site.test/')).toBe('https://relais.site.test');
    expect(relaisActuel(ANCIEN, ANCIEN)).toBe(RELAIS_OFFICIEL);
    expect(relaisActuel(ANCIEN, 'http://pas-https.test')).toBe(RELAIS_OFFICIEL);
    expect(relaisActuel('https://relais.appdashboard.fr/')).toBe('https://relais.appdashboard.fr');
    expect(relaisActuel('https://autre-serveur.test', 'https://relais.site.test')).toBe('https://autre-serveur.test');
    expect(relaisActuel('https://evil-applibourse-relais.x.workers.dev.attaque.test')).toBe('https://evil-applibourse-relais.x.workers.dev.attaque.test');
  });
});

describe('invitation créée par le Fondateur connecté par SESSION (navigateur)', () => {
  it('cas de production : RaphouT choisit son mot de passe et son accès est créé (jeton de profil demandé au serveur)', async () => {
    const relais = relaisV9();
    const session = await fondateurEnSession(relais);
    const temporaire = await publierCompteRaph(relais, session);
    const inv = await inviter(session, temporaire, relais.requete);
    expect(inv.mode).toBe('relais');
    const chargee = await chargerInvitation(decoderInvitation(inv.lien)!, relais.requete);
    expect(chargee.contenu.jeton).toBe(jetonDeProfil(JETON_V9, ID));
    const a = await accepterInvitation({ invitation: chargee, motDePasse: 'Un mot de passe solide 2026', requete: relais.requete, kdf: KDF });
    expect(a.avertissements).toEqual([]);
    expect(a.relie.liaison.jeton).toBe(jetonDeProfil(JETON_V9, ID));
    // Appareil suivant : identifiant + mot de passe.
    const c = await connecterParIdentifiant(RELAIS_V9, 'raphout', 'Un mot de passe solide 2026', relais.requete);
    expect(c.relie.compte).toBe(ID);
    // Changement de mot de passe (accès republié avec son jeton de profil).
    await republierAcces(c.relie.liaison, ID, 'RaphouT', 'Encore plus solide 2027', relais.requete, undefined, KDF);
    await expect(connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Un mot de passe solide 2026', relais.requete)).rejects.toMatchObject({ code: 'mot-de-passe' });
    expect((await connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Encore plus solide 2027', relais.requete)).relie.compte).toBe(ID);
  });

  it('invitation DÉJÀ émise avec un jeton calculé sur la session (avant la correction) : elle marche quand même', async () => {
    const relais = relaisV9();
    const session = await fondateurEnSession(relais);
    const temporaire = await publierCompteRaph(relais, session);
    // Ancien code du site : le jeton de profil était un HMAC de la session.
    const ancienClient = (async (url: string, init?: RequestInit) =>
      String(url).includes('/v10/jeton-profil/')
        ? new Response(JSON.stringify({ jeton: jetonDeProfil(session.jeton, ID) }), { headers: { 'Content-Type': 'application/json' } })
        : relais.requete(url, init)) as unknown as typeof fetch;
    const inv = await inviter(session, temporaire, ancienClient);
    const chargee = await chargerInvitation(decoderInvitation(inv.lien)!, relais.requete);
    expect(chargee.contenu.jeton).not.toBe(jetonDeProfil(JETON_V9, ID));
    const a = await accepterInvitation({ invitation: chargee, motDePasse: 'Un mot de passe solide 2026', requete: relais.requete, kdf: KDF });
    expect(a.relie.liaison.jeton).toBe(jetonDeProfil(JETON_V9, ID));
    expect(a.avertissements).toEqual([]);
    // L'accès par identifiant porte le BON jeton.
    expect((await connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Un mot de passe solide 2026', relais.requete)).relie.liaison.jeton).toBe(jetonDeProfil(JETON_V9, ID));
  });

  it('accès déjà publié avec un jeton refusé : la vraie raison, pas « Le relais refuse ce code de liaison »', async () => {
    const relais = relaisV9();
    await publierCompteRaph(relais);
    // Accès d'un compte dont le jeton ne vaut rien sur ce serveur (posé par le Fondateur).
    const acces: ContenuAcces = { v: 1, compte: ID, prenom: 'RaphouT', jeton: jetonDeProfil('un-autre-jeton-maitre-0123456789', ID), relais: RELAIS_V9 };
    await publierAcces(MAITRE, empreinteIdentifiant('RaphouT'), preparerAcces('Un mot de passe solide 2026', acces, undefined, KDF), relais.requete);
    const refus = connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Un mot de passe solide 2026', relais.requete);
    await expect(refus).rejects.toMatchObject({ code: 'jeton-refuse' });
    await expect(refus).rejects.toThrow(/Renvoyer une invitation/);
  });
});

describe('ancienne adresse du relais (Worker Cloudflare supprimé)', () => {
  it('invitation et accès émis avant la fin de Cloudflare : réécrits vers le relais du site, aucun appel vers l’ancienne adresse', async () => {
    const relais = relaisV9();
    const temporaire = await publierCompteRaph(relais);
    // Création à l'époque du Worker (le Worker et le serveur partagent la boîte et le jeton maître).
    const epoque = avecAncienneAdresse(relais);
    const inv = await inviter({ relais: ANCIEN, jeton: JETON_V9 }, temporaire, epoque.requete);
    expect(decoderInvitation(inv.lien)!.relais).toBe(ANCIEN);
    const maintenant = avecAncienneAdresse(relais);
    const chargee = await chargerInvitation(decoderInvitation(inv.lien)!, maintenant.requete, undefined, RELAIS_V9);
    expect(chargee.lien.relais).toBe(RELAIS_V9);
    expect(chargee.contenu.relais).toBe(RELAIS_V9);
    const a = await accepterInvitation({ invitation: chargee, motDePasse: 'Un mot de passe solide 2026', requete: maintenant.requete, kdf: KDF });
    expect(a.relie.liaison.relais).toBe(RELAIS_V9);
    const c = await connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Un mot de passe solide 2026', maintenant.requete);
    expect(c.relie.liaison.relais).toBe(RELAIS_V9);
    expect(maintenant.versAncien).toEqual([]);
  });

  it('accès par identifiant publié avec l’ancienne adresse : la connexion utilise le relais qui a répondu', async () => {
    const relais = relaisV9();
    await publierCompteRaph(relais);
    const acces: ContenuAcces = { v: 1, compte: ID, prenom: 'RaphouT', jeton: jetonDeProfil(JETON_V9, ID), relais: ANCIEN };
    await publierAcces(MAITRE, empreinteIdentifiant('RaphouT'), preparerAcces('Un mot de passe solide 2026', acces, undefined, KDF), relais.requete);
    const suivi = avecAncienneAdresse(relais);
    const c = await connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Un mot de passe solide 2026', suivi.requete);
    expect(c.relie.liaison.relais).toBe(RELAIS_V9);
    expect(c.acces.relais).toBe(RELAIS_V9);
    expect(suivi.versAncien).toEqual([]);
  });

  it('invitation « lien » (contenu dans le lien) à l’ancienne adresse : relais du site, ou relais officiel à défaut', async () => {
    const relais = relaisV9();
    const contenu = { v: 1 as const, compte: ID, prenom: 'RaphouT', jeton: jetonDeProfil(JETON_V9, ID), relais: ANCIEN, mdp: 'temporaire-0123', expire: new Date(Date.now() + 86_400_000).toISOString(), creeLe: new Date().toISOString() };
    const lien = decoderInvitation(lienInvitation('https://site.test', encoderInvitation({ mode: 'lien', relais: ANCIEN, contenu })))!;
    const suivi = avecAncienneAdresse(relais);
    const chargee = await chargerInvitation(lien, suivi.requete, undefined, RELAIS_V9);
    expect(chargee.contenu.relais).toBe(RELAIS_V9);
    expect(suivi.versAncien).toEqual([]);
    const sansSite = await chargerInvitation(lien, (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch);
    expect(sansSite.contenu.relais).toBe(RELAIS_OFFICIEL);
  });
});

describe('derrière le frontal o2switch (PUT et DELETE coupés)', () => {
  for (const mode of ['reseau', '405', '403'] as const) {
    it(`création, renvoi, acceptation, changement de mot de passe, réinitialisation, mot de passe oublié (refus ${mode})`, async () => {
      const relais = relaisV9();
      const frontal = derriereFrontal(relais, mode);
      const session = await fondateurEnSession(relais);
      const temporaire = await publierCompteRaph(relais, session);
      // Première invitation, puis RENVOI : la première est révoquée, la seconde marche.
      const premiere = await inviter(session, temporaire, frontal.requete);
      const renvoi = await inviter(session, temporaire, frontal.requete);
      const cles = [...relais.env.BOITE.donnees.keys()].filter(k => k.startsWith('inv:'));
      expect(cles.length).toBeGreaterThanOrEqual(2);
      await expect(chargerInvitation(decoderInvitation(premiere.lien)!, frontal.requete)).rejects.toMatchObject({ code: 'invitation-revoquee' });
      const chargee = await chargerInvitation(decoderInvitation(renvoi.lien)!, frontal.requete);
      await accepterInvitation({ invitation: chargee, motDePasse: 'Un mot de passe solide 2026', requete: frontal.requete, kdf: KDF });
      // Déjà utilisée : la vraie raison.
      await expect(chargerInvitation(decoderInvitation(renvoi.lien)!, frontal.requete)).rejects.toMatchObject({ code: 'invitation-utilisee' });
      const c = await connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Un mot de passe solide 2026', frontal.requete);
      // Changement de mot de passe, avec codes de récupération (mot de passe oublié).
      const alea = aleatoireDeterministe(5);
      const codes = Array.from({ length: 4 }, () => genererCodeRecuperation(alea));
      const acces: ContenuAcces = { v: 1, compte: ID, prenom: 'RaphouT', jeton: c.relie.liaison.jeton, relais: RELAIS_V9 };
      const depot = preparerAcces('Encore plus solide 2027', acces, undefined, KDF);
      depot.secours = preparerSecours(codes, acces, undefined, KDF);
      await publierAcces(c.relie.liaison, empreinteIdentifiant('RaphouT'), depot, frontal.requete);
      expect((await connecterParIdentifiant(RELAIS_V9, 'RaphouT', 'Encore plus solide 2027', frontal.requete)).relie.compte).toBe(ID);
      expect((await connecterParSecours(RELAIS_V9, 'RaphouT', codes[1], frontal.requete)).relie.compte).toBe(ID);
      // Réinitialisation par le Fondateur : nouvelle invitation, nouveau mot de passe choisi.
      const reinit = await inviter(session, temporaire, frontal.requete);
      const rechargee = await chargerInvitation(decoderInvitation(reinit.lien)!, frontal.requete);
      expect(rechargee.contenu.compte).toBe(ID);
      expect(frontal.refus.length).toBeGreaterThan(0);
    });
  }
});

describe('causes exactes à l’ouverture d’une invitation', () => {
  it('introuvable sur le serveur (jamais déposée) : « demande… de la renvoyer »', async () => {
    const relais = relaisV9();
    const lien = decoderInvitation(lienInvitation('https://site.test', encoderInvitation({ mode: 'relais', relais: RELAIS_V9, secret: nouveauSecret(aleatoireDeterministe(9)) })))!;
    const essai = chargerInvitation(lien, relais.requete);
    await expect(essai).rejects.toMatchObject({ code: 'invitation-inconnue' });
    await expect(essai).rejects.toThrow(/renvoyer/);
  });

  it('expirée', async () => {
    const relais = relaisV9();
    const temporaire = await publierCompteRaph(relais);
    const inv = await creerInvitation({ maitre: MAITRE, compte: ID, prenom: 'RaphouT', motDePasse: temporaire, fondateur: 'Enzo', jours: 1, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF });
    const vraie = Date.now;
    Date.now = () => vraie() + 2 * 86_400_000;
    try {
      await expect(chargerInvitation(decoderInvitation(inv.lien)!, relais.requete)).rejects.toMatchObject({ code: 'invitation-expiree' });
    } finally {
      Date.now = vraie;
    }
  });
});
