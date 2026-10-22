/**
 * Relais version 9 : connexion par identifiant + mot de passe POUR TOUS, Fondateur compris.
 * Contre le VRAI relais en mémoire : migration du compte du Fondateur (le PC a les clés), connexion
 * sur un navigateur neuf (session, jamais le jeton maître), mot de passe oublié (code de
 * récupération), ami existant inchangé, réponses neutres, style public, identifiant déjà pris.
 */
import { aleatoireDeterministe } from '../src/securite/aleatoire';
import type { ParametresKdf } from '../src/securite/kdf';
import { codeTotp } from '../src/securite/totp';
import { genererCodeRecuperation } from '../src/securite/codes-recuperation';
import { ouvrirBaseNode } from '../src/db/pilotes/node';
import { DepotComptes } from '../src/db/depots';
import { Session, coffreValide } from '../src/session/session';
import { stockageMemoire } from '../src/session/stockage-coffre';
import { empreinteIdentifiant } from '../src/profils/invitation';
import { activerA2f, desactiverA2f, etatA2f, lireThemePublic, publierThemePublic } from '../src/sync/relais/connexionAmis';
import { deposerCoffreSiChange, ecrireConfigRelais, recupererCoffre } from '../src/sync/relais/synchroniser';
import { synchroniserServeur } from '../src/sync/relais/coffreServeur';
import { compte } from '../src/core/testing/fixtures';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from '../src/sync/relais/__fixtures__/relaisV9';
import { accepterInvitation, chargerInvitation, connecterParIdentifiant, connecterParSecours, creerInvitation, publierAccesFondateur } from './connexionAmis';
import { lireAnnuaireFichier, synchroniserComptesAdmin, type Fichiers, type Memoire } from './synchroComptes';
import { appliquerProfilsAdmin, lireAnnuaire, ouvrirAnnuaireAdmin, type Annuaire, type ClesAdmin } from '../src/profils/annuaire';
import { ajouterProfil, type Profil } from '../src/profils/profils';
import { creerAccesAmi } from '../src/profils/identifiants';
import { decoderInvitation } from '../src/profils/invitation';
import { migrer as migrerBase } from '../src/db/schema';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };
// Un identifiant inconnu se dérive avec les paramètres réels (réponse neutre du relais) : ~1 s par essai.
jest.setTimeout(30_000);

/** Le PC du Fondateur : coffre avec code à six chiffres, des données, relié au relais (jeton maître). */
function pcDuFondateur(relais: RelaisV9) {
  const stockage = stockageMemoire();
  const session = new Session({ stockage, ouvrirBase: () => ouvrirBaseNode(), kdf: KDF, alea: aleatoireDeterministe(7) });
  const { secretTotp } = session.initialiser({ motDePasse: 'ancien mot de passe du PC' });
  new DepotComptes(session.base()).enregistrer(compte({ nom: 'PEA du Fondateur' }));
  ecrireConfigRelais(session.base(), { ...MAITRE, cle: session.cleDerivee('synchro'), nom: 'PC' });
  return { session, stockage, secretTotp, relais };
}

async function migrer(pc: ReturnType<typeof pcDuFondateur>, identifiant = 'Enzo', nouveau = 'Une phrase solide 2026') {
  const alea = aleatoireDeterministe(11);
  const codes = Array.from({ length: 10 }, () => genererCodeRecuperation(alea));
  const code = codeTotp(pc.secretTotp, Date.now());
  pc.session.verifierIdentite({ motDePasse: 'ancien mot de passe du PC', codeTotp: code });
  await publierAccesFondateur({ maitre: MAITRE, identifiant, motDePasse: nouveau, codes, requete: pc.relais.requete, kdf: KDF });
  const { coffre } = pc.session.passerAConnexionParIdentifiant({ motDePasseActuel: 'ancien mot de passe du PC', codeTotp: code, nouveauMotDePasse: nouveau, codes });
  await deposerCoffreSiChange(pc.session.base(), MAITRE, coffre, pc.relais.requete);
  await synchroniserServeur({ pilote: pc.session.base(), liaison: MAITRE, cle: pc.session.cleDerivee('synchro'), compte: 'principal', requete: pc.relais.requete });
  return codes;
}

describe('connexion par identifiant + mot de passe (version 9)', () => {
  it('le Fondateur migre sur son PC, puis se connecte sur un navigateur neuf avec son nom et son mot de passe : toutes ses données, sans code', async () => {
    const relais = relaisV9();
    const pc = pcDuFondateur(relais);
    await migrer(pc);

    const c = await connecterParIdentifiant(RELAIS_V9, '  ENZO ', 'Une phrase solide 2026', relais.requete);
    expect(c.fondateur).toBe(true);
    expect(c.relie.liaison.jeton).toMatch(/^s1\./);
    expect(c.relie.liaison.jeton).not.toBe(JETON_V9);
    // Le navigateur neuf récupère le coffre avec la session, l'ouvre avec le seul mot de passe (plus de code à six chiffres).
    const coffre = await recupererCoffre(c.relie.liaison, relais.requete);
    expect(coffreValide(coffre)).toBe(true);
    const navigateur = new Session({ stockage: stockageMemoire(coffre as never), ouvrirBase: () => ouvrirBaseNode(), kdf: KDF });
    navigateur.deverrouiller({ motDePasse: 'Une phrase solide 2026 ', codeTotp: '' });
    expect(navigateur.statut()).toBe('deverrouille');
    // Même clé de synchronisation : ses données arrivent du coffre serveur.
    await synchroniserServeur({ pilote: navigateur.base(), liaison: c.relie.liaison, cle: navigateur.cleDerivee('synchro'), compte: 'principal', requete: relais.requete });
    expect(new DepotComptes(navigateur.base()).tous()[0].nom).toBe('PEA du Fondateur');
    // L'ancien mot de passe ne sert plus, ni sur le serveur ni dans le coffre.
    await expect(connecterParIdentifiant(RELAIS_V9, 'Enzo', 'ancien mot de passe du PC', relais.requete)).rejects.toMatchObject({ code: 'mot-de-passe' });
    // Rien en clair dans la boîte du relais : ni mot de passe, ni identifiant, ni jeton de session.
    const tout = [...relais.env.BOITE.donnees.entries()].join('\n');
    for (const secret of ['Une phrase solide 2026', 'Enzo', c.relie.liaison.jeton]) expect(tout).not.toContain(secret);
  });

  it('identifiant inconnu et mot de passe faux : même réponse ; le PC du Fondateur sans migration ne s’ouvre pas par identifiant', async () => {
    const relais = relaisV9();
    const pc = pcDuFondateur(relais);
    await expect(connecterParIdentifiant(RELAIS_V9, 'Enzo', 'quoi que ce soit', relais.requete)).rejects.toMatchObject({ code: 'mot-de-passe' });
    await migrer(pc);
    const faux = await connecterParIdentifiant(RELAIS_V9, 'Enzo', 'faux', relais.requete).catch(e => e);
    const inconnu = await connecterParIdentifiant(RELAIS_V9, 'Personne', 'faux', relais.requete).catch(e => e);
    expect([faux.code, faux.message]).toEqual([inconnu.code, inconnu.message]);
    expect(faux.message).toMatch(/Identifiant ou mot de passe incorrect/);
  });

  it('mot de passe oublié : identifiant + un code de récupération ouvre le compte ; le code ne marche qu’une fois côté coffre', async () => {
    const relais = relaisV9();
    const pc = pcDuFondateur(relais);
    const codes = await migrer(pc);
    const c = await connecterParSecours(RELAIS_V9, 'enzo', codes[3].toLowerCase(), relais.requete);
    expect(c.fondateur).toBe(true);
    expect(c.secours).toBe(3);
    const coffre = await recupererCoffre(c.relie.liaison, relais.requete);
    const navigateur = new Session({ stockage: stockageMemoire(coffre as never), ouvrirBase: () => ouvrirBaseNode(), kdf: KDF });
    navigateur.recuperer({ codeRecuperation: codes[3], nouveauMotDePasse: 'Nouvelle phrase 2027' });
    expect(navigateur.statut()).toBe('deverrouille');
    await expect(connecterParSecours(RELAIS_V9, 'enzo', 'AAAA-BBBB-CCCC-DDDD', relais.requete)).rejects.toMatchObject({ code: 'code-recuperation' });
  });

  it('un ami : invitation, puis identifiant + mot de passe sur un autre appareil (jeton de profil, pas de session) ; son coffre serveur à lui', async () => {
    const relais = relaisV9();
    const fichiers = new Map<string, Uint8Array>();
    const disque: Fichiers = { lire: async n => fichiers.get(n), ecrire: async (n, o) => void fichiers.set(n, o) };
    const m = new Map<string, string>();
    const mem: Memoire = { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
    const cles: ClesAdmin = { annuaire: new Uint8Array(32).fill(7), sequestre: new Uint8Array(32).fill(9) };
    const copie = () => ({ annuaire: cles.annuaire.slice(), sequestre: cles.sequestre.slice() });
    const alea = aleatoireDeterministe(11);
    const vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copie(), alea);
    let profils: Profil[] = vue.profils.map(p => (p.admin ? { ...p, nom: 'Enzo' } : p));
    profils = ajouterProfil(profils, 'Léa', 'lea0000001', '2026-10-01', ['portefeuille']);
    const ecrire = async (x: Annuaire) => disque.ecrire('profils', new TextEncoder().encode(JSON.stringify({ ...x, format: 'annuaire' })));
    await ecrire(appliquerProfilsAdmin(vue.annuaire, profils, copie(), alea));
    const stockageLea = stockageMemoire();
    const ids = creerAccesAmi(new Session({ stockage: stockageLea, ouvrirBase: () => ouvrirBaseNode(), kdf: KDF, profil: 'lea0000001' }), 'Léa', aleatoireDeterministe(3));
    await disque.ecrire('coffre-lea0000001', new TextEncoder().encode(JSON.stringify(stockageLea.lire())));
    await disque.ecrire('portefeuille-lea0000001', Uint8Array.from([1, 2, 3]));
    await synchroniserComptesAdmin({ liaison: MAITRE, memoire: mem, fichiers: disque, lire: () => lireAnnuaireFichier(disque), ecrire, cles: copie, requete: relais.requete, effacerFichiers: async () => undefined });
    const inv = await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: ids.motDePasse, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF });
    await accepterInvitation({ invitation: await chargerInvitation(decoderInvitation(inv.lien)!, relais.requete), motDePasse: 'Été à Biarritz 2026', requete: relais.requete, kdf: KDF });

    const c = await connecterParIdentifiant(RELAIS_V9, ' LEA ', 'Été à Biarritz 2026', relais.requete);
    expect(c.fondateur).toBe(false);
    expect(c.relie.liaison.jeton).toMatch(/^p1\.lea0000001\./);
    expect(c.relie.annuaire.restreint).toBe(true);
    // Son coffre serveur : elle seule (et le Fondateur, sans pouvoir le lire) y accède.
    const telephone = ouvrirBaseNode();
    migrerBase(telephone);
    new DepotComptes(telephone).enregistrer(compte({ id: 'lea', nom: 'Livret de Léa' }));
    const cleLea = 'ab'.repeat(32);
    await synchroniserServeur({ pilote: telephone, liaison: c.relie.liaison, cle: cleLea, compte: 'lea0000001', requete: relais.requete });
    await expect(synchroniserServeur({ pilote: telephone, liaison: c.relie.liaison, cle: cleLea, compte: 'principal', requete: relais.requete })).rejects.toThrow(/403/);
  });

  it('style : le nom du thème seulement, publié par le compte ; identifiant inconnu = pas de thème ; identifiant pris = refus', async () => {
    const relais = relaisV9();
    const pc = pcDuFondateur(relais);
    await migrer(pc);
    const h = empreinteIdentifiant('Enzo');
    expect(await lireThemePublic(RELAIS_V9, h, relais.requete)).toBeUndefined();
    await publierThemePublic(MAITRE, h, 'sauge', relais.requete);
    expect(await lireThemePublic(RELAIS_V9, empreinteIdentifiant(' enzo '), relais.requete)).toBe('sauge');
    expect(await lireThemePublic(RELAIS_V9, empreinteIdentifiant('Inconnu'), relais.requete)).toBeUndefined();
    // Un ami qui aurait déjà « Enzo » : le Fondateur ne peut pas le prendre (et inversement).
    await relais.requete(`${RELAIS_V9}/invitations/${'c'.repeat(32)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${JETON_V9}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profil: 'hugo123456', expire: new Date(Date.now() + 86_400_000).toISOString(), charge: 'x', verif: 'a'.repeat(64), acces: empreinteIdentifiant('Hugo') }),
    });
    await expect(publierAccesFondateur({ maitre: MAITRE, identifiant: 'Hugo', motDePasse: 'Une phrase solide 2026', requete: relais.requete, kdf: KDF })).rejects.toMatchObject({ code: 'identifiant-pris' });
  });
});

describe('validation en deux étapes vérifiée par le serveur (version 10)', () => {
  /** Code d'un pas qui ne bascule pas pendant le test. */
  async function pasStable() {
    const reste = 30_000 - (Date.now() % 30_000);
    if (reste < 5_000) await new Promise(ok => setTimeout(ok, reste + 50));
  }

  it('migration du Fondateur AVEC son code à six chiffres : même secret confié au serveur ; navigateur neuf : mot de passe puis code ; faux et rejoué refusés', async () => {
    const relais = relaisV9();
    const pc = pcDuFondateur(relais);
    await pasStable();
    // Migration (comme bureau/index.tsx) : secret du coffre confié au serveur AVANT l'accès, coffre qui garde le code.
    const alea = aleatoireDeterministe(13);
    const codes = Array.from({ length: 10 }, () => genererCodeRecuperation(alea));
    const code = codeTotp(pc.secretTotp, Date.now());
    pc.session.verifierIdentite({ motDePasse: 'ancien mot de passe du PC', codeTotp: code });
    const secret = pc.session.secretTotp();
    expect(secret).toBe(pc.secretTotp);
    await activerA2f(MAITRE, 'principal', secret!, code, relais.requete);
    expect(await etatA2f(MAITRE, 'principal', relais.requete)).toBe(true);
    await publierAccesFondateur({ maitre: MAITRE, identifiant: 'admin', motDePasse: 'Une phrase solide 2026', codes, requete: relais.requete, kdf: KDF });
    const { coffre } = pc.session.passerAConnexionParIdentifiant({ motDePasseActuel: 'ancien mot de passe du PC', codeTotp: code, nouveauMotDePasse: 'Une phrase solide 2026', codes, garderCode: true });
    expect(pc.session.etatCoffre()?.codeDemande).toBe(true);
    await deposerCoffreSiChange(pc.session.base(), MAITRE, coffre, relais.requete);
    // Le secret n'est jamais rangé en clair sur le serveur.
    expect([...relais.env.BOITE.donnees.values()].join('\n')).not.toContain(pc.secretTotp);

    // Navigateur neuf : mot de passe juste, mais pas de code → le serveur le demande, sans rien rendre.
    await expect(connecterParIdentifiant(RELAIS_V9, ' Admin ', 'Une phrase solide 2026', relais.requete)).rejects.toMatchObject({ code: 'a2f-requis' });
    // Mauvais mot de passe : même réponse qu'avant (le code n'est même pas demandé).
    await expect(connecterParIdentifiant(RELAIS_V9, 'admin', 'pas le bon', relais.requete, '123456')).rejects.toMatchObject({ code: 'mot-de-passe' });
    // Code faux.
    const suivant = codeTotp(pc.secretTotp, Date.now() + 30_000);
    const faux = ['000000', '111111'].find(c => c !== suivant && c !== codeTotp(pc.secretTotp, Date.now()))!;
    await expect(connecterParIdentifiant(RELAIS_V9, 'admin', 'Une phrase solide 2026', relais.requete, faux)).rejects.toMatchObject({ code: 'a2f-code' });
    // Bon code (le pas suivant : celui de la migration est déjà consommé).
    const c = await connecterParIdentifiant(RELAIS_V9, 'admin', 'Une phrase solide 2026', relais.requete, suivant);
    expect(c.fondateur).toBe(true);
    expect(c.relie.liaison.jeton).toMatch(/^s1\./);
    // Code rejoué : refusé.
    await expect(connecterParIdentifiant(RELAIS_V9, 'admin', 'Une phrase solide 2026', relais.requete, suivant)).rejects.toMatchObject({ code: 'a2f-code' });
    // Le coffre récupéré s'ouvre avec le mot de passe ET le même code (même secret qu'avant).
    const recupere = await recupererCoffre(c.relie.liaison, relais.requete);
    const navigateur = new Session({ stockage: stockageMemoire(recupere as never), ouvrirBase: () => ouvrirBaseNode(), kdf: KDF });
    expect(() => navigateur.deverrouiller({ motDePasse: 'Une phrase solide 2026', codeTotp: '' })).toThrow();
    navigateur.deverrouiller({ motDePasse: 'Une phrase solide 2026', codeTotp: suivant });
    expect(navigateur.statut()).toBe('deverrouille');
    // Codes de récupération : toujours une autre porte, sans code à six chiffres.
    const parSecours = await connecterParSecours(RELAIS_V9, 'admin', codes[0], relais.requete);
    expect(parSecours.fondateur).toBe(true);
    // Désactivation : un code exigé (le jeton maître du PC peut aussi la retirer).
    await expect(desactiverA2f(c.relie.liaison, 'principal', '000000', relais.requete)).rejects.toMatchObject({ code: expect.stringMatching(/a2f-code|trop-de-tentatives/) });
    await desactiverA2f(MAITRE, 'principal', '', relais.requete);
    expect(await etatA2f(MAITRE, 'principal', relais.requete)).toBe(false);
  });
});
