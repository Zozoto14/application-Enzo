/**
 * Parcours d'accès d'un ami, de bout en bout côté logique : le PC du
 * Fondateur crée Léa et son invitation ; un navigateur NEUF ouvre le lien,
 * Léa choisit son mot de passe ; un autre appareil se connecte ensuite par
 * identifiant + mot de passe. Relais en mémoire (contrat de relais/worker.mjs,
 * version 6 ou ancienne).
 */
import { createHash } from 'node:crypto';
import { aleatoireDeterministe } from '../src/securite/aleatoire';
import type { ParametresKdf } from '../src/securite/kdf';
import { ouvrirBaseNode } from '../src/db/pilotes/node';
import { Session } from '../src/session/session';
import { stockageMemoire } from '../src/session/stockage-coffre';
import { creerAccesAmi } from '../src/profils/identifiants';
import { appliquerProfilsAdmin, lireAnnuaire, ouvrirAnnuaireAdmin, type Annuaire, type ClesAdmin } from '../src/profils/annuaire';
import { ajouterProfil, type Profil } from '../src/profils/profils';
import { decoderInvitation, ErreurInvitation } from '../src/profils/invitation';
import type { Liaison } from '../src/sync/relais/liaison';
import { JETON_TEST, RELAIS_TEST, relaisPortees } from '../src/sync/relais/__fixtures__/relaisPortees';
import { accepterInvitation, chargerCodeCourt, chargerInvitation, connecterParIdentifiant, creerInvitation } from './connexionAmis';
import { lireAnnuaireFichier, synchroniserComptesAdmin, type Fichiers, type Memoire } from './synchroComptes';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MAITRE: Liaison = { relais: RELAIS_TEST, jeton: JETON_TEST };
const encodeur = new TextEncoder();
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** Relais en mémoire, version 6 (invitations, accès) ou ancienne (`ancien`). */
function relaisV6({ ancien = false } = {}) {
  const base = relaisPortees();
  const invs = new Map<string, Record<string, unknown>>();
  const acces = new Map<string, Record<string, unknown>>();
  const proprio = new Map<string, string>();
  const echecs = new Map<string, number>();
  let horsLigne = false;
  const rep = (corps: unknown, status = 200) => ({ ok: status < 300, status, headers: new Headers(), json: async () => corps }) as unknown as Response;
  const requete = (async (url: string, init: RequestInit = {}) => {
    if (horsLigne) throw new TypeError('Failed to fetch');
    const chemin = url.slice(RELAIS_TEST.length);
    const methode = init.method ?? 'GET';
    const jeton = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '').replace(/^Bearer\s+/, '');
    const corps = init.body ? JSON.parse(String(init.body)) : undefined;
    if (chemin === '/sante' && !ancien) {
      return jeton === JETON_TEST || jeton.startsWith('p1.') ? rep({ ok: true, version: 6, fonctions: ['invitations', 'acces'] }) : rep({}, 401);
    }
    if (chemin === '/heure') return rep({ heure: Date.now() });
    const inv = /^\/invitations\/([0-9a-f]{32})(\/utiliser)?$/.exec(chemin);
    const acc = /^\/acces\/([0-9a-f]{64})(\/ouvrir)?$/.exec(chemin);
    if ((inv || acc) && ancien) return jeton ? rep({ erreur: 'Adresse inconnue.' }, 404) : rep({ erreur: 'jeton' }, 401);
    if (inv) {
      const id = inv[1];
      if (methode === 'PUT') {
        if (jeton !== JETON_TEST) return rep({}, 403);
        for (const [autre, v] of invs) if (v.profil === corps.profil && autre !== id && !v.alias) v.etat = 'revoquee';
        invs.set(id, { ...corps, etat: 'active' });
        if (corps.court) invs.set(corps.court.id, { alias: id, charge: corps.court.charge, verif: corps.court.verif });
        if (corps.acces) proprio.set(corps.acces, corps.profil);
        return rep({ ok: true });
      }
      const lue = invs.get(id);
      if (!lue) return rep({ motif: 'inconnue' }, 404);
      const principale = (lue.alias ? invs.get(lue.alias as string) : lue)!;
      const etat = principale.etat !== 'active' ? principale.etat : Date.now() >= Date.parse(principale.expire as string) ? 'expiree' : 'active';
      if (etat !== 'active') return rep({ motif: etat }, 410);
      if (!inv[2]) return rep({ charge: lue.charge, expire: principale.expire });
      if (sha(corps.preuve) !== lue.verif) return rep({ motif: 'preuve' }, 403);
      principale.etat = 'utilisee';
      return rep({ ok: true });
    }
    if (acc) {
      const h = acc[1];
      if (methode === 'PUT') {
        const profil = /^p1\.([a-z0-9]+)\./.exec(jeton)?.[1];
        if (jeton !== JETON_TEST && (profil !== corps.compte || proprio.get(h) !== corps.compte)) return rep({}, 403);
        acces.set(h, corps);
        return rep({ ok: true });
      }
      if (methode === 'DELETE') {
        acces.delete(h);
        return rep({ ok: true });
      }
      const depot = acces.get(h);
      if (!depot) return rep({ motif: 'identifiant-inconnu' }, 404);
      if (!acc[2]) return rep({ sel: depot.sel, kdf: depot.kdf });
      if ((echecs.get(h) ?? 0) >= 5) return rep({ motif: 'trop-de-tentatives', attente: 30 }, 429);
      if (sha(corps.preuve) !== depot.verif) {
        echecs.set(h, (echecs.get(h) ?? 0) + 1);
        return rep({ motif: 'mot-de-passe' }, 403);
      }
      return rep({ compte: depot.compte, charge: depot.charge });
    }
    return base.requete(url, init);
  }) as typeof fetch;
  return { ...base, requete, invs, acces, couper: (v: boolean) => void (horsLigne = v) };
}

function memoire(): Memoire {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}
function disque(): Fichiers & { f: Map<string, Uint8Array> } {
  const f = new Map<string, Uint8Array>();
  return { f, lire: async n => f.get(n), ecrire: async (n, o) => void f.set(n, o) };
}
const cles: ClesAdmin = { annuaire: new Uint8Array(32).fill(7), sequestre: new Uint8Array(32).fill(9) };
const copieCles = () => ({ annuaire: cles.annuaire.slice(), sequestre: cles.sequestre.slice() });

/** Le PC du Fondateur : Enzo, et Léa créée avec un coffre au mot de passe temporaire. */
async function pcAvecLea() {
  const fichiers = disque();
  const mem = memoire();
  const alea = aleatoireDeterministe(11);
  const vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copieCles(), alea);
  let profils: Profil[] = vue.profils.map(p => (p.admin ? { ...p, nom: 'Enzo' } : p));
  profils = ajouterProfil(profils, 'Léa', 'lea0000001', '2026-10-01', ['portefeuille']);
  const annuaire = appliquerProfilsAdmin(vue.annuaire, profils, copieCles(), alea);
  const ecrire = async (a: Annuaire) => fichiers.ecrire('profils', encodeur.encode(JSON.stringify({ ...a, format: 'annuaire' })));
  await ecrire(annuaire);
  const stockageLea = stockageMemoire();
  const ids = creerAccesAmi(new Session({ stockage: stockageLea, ouvrirBase: () => ouvrirBaseNode(), kdf: KDF, profil: 'lea0000001' }), 'Léa', aleatoireDeterministe(3));
  await fichiers.ecrire('coffre-lea0000001', encodeur.encode(JSON.stringify(stockageLea.lire())));
  await fichiers.ecrire('portefeuille-lea0000001', Uint8Array.from([1, 2, 3]));
  await fichiers.ecrire('coffre', encodeur.encode('{"version":1,"enveloppes":[]}'));
  const tour = (relais: ReturnType<typeof relaisV6>) =>
    synchroniserComptesAdmin({ liaison: MAITRE, memoire: mem, fichiers, lire: () => lireAnnuaireFichier(fichiers), ecrire, cles: copieCles, requete: relais.requete, effacerFichiers: async () => undefined });
  return { fichiers, ids, tour };
}

describe('invitation d’un ami (relais à jour)', () => {
  it('Fondateur → lien → navigateur neuf → mot de passe choisi → connexion ; usage unique ; autre appareil par identifiant', async () => {
    const relais = relaisV6();
    const pc = await pcAvecLea();
    await pc.tour(relais);
    const inv = await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: pc.ids.motDePasse, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete, alea: aleatoireDeterministe(5), kdfCodeCourt: KDF });
    expect(inv.mode).toBe('relais');
    expect(inv.lien).toMatch(/^https:\/\/site\.test\/#invitation=AI1\./);
    expect(inv.message).toContain(inv.lien);
    expect(inv.message).not.toContain(pc.ids.motDePasse);
    expect(inv.lien).not.toContain(pc.ids.motDePasse);
    // Le relais ne garde rien de lisible : ni mot de passe temporaire, ni jeton en clair.
    expect(JSON.stringify([...relais.invs.values()])).not.toContain(pc.ids.motDePasse);
    expect(JSON.stringify([...relais.invs.values()])).not.toContain('p1.lea0000001');

    const lien = decoderInvitation(inv.lien)!;
    const chargee = await chargerInvitation(lien, relais.requete);
    expect(chargee.contenu.prenom).toBe('Léa');
    expect(chargee.contenu.fondateur).toBe('Enzo');
    const acceptee = await accepterInvitation({ invitation: chargee, motDePasse: '  Été à Biarritz 2026\n', requete: relais.requete, kdf: KDF, alea: aleatoireDeterministe(6) });
    expect(acceptee.avertissements).toEqual([]);
    expect(acceptee.relie.compte).toBe('lea0000001');
    // Coffre publié : ouvert par le mot de passe choisi, sans code TOTP, saisi autrement (NFD, majuscule iOS ignorée ? non : la casse compte).
    const session = new Session({ stockage: stockageMemoire(acceptee.coffre), ouvrirBase: () => ouvrirBaseNode(), kdf: KDF, profil: 'lea0000001' });
    session.deverrouiller({ motDePasse: 'Été à Biarritz 2026', codeTotp: '' });
    expect(session.statut()).toBe('deverrouille');

    // Invitation volée rejouée : refusée (utilisée).
    await expect(chargerInvitation(lien, relais.requete)).rejects.toMatchObject({ code: 'invitation-utilisee' });
    // Code court : consommé avec le lien.
    await expect(chargerCodeCourt(RELAIS_TEST, inv.codeCourt!, relais.requete, KDF)).rejects.toMatchObject({ code: 'invitation-utilisee' });

    // Deuxième appareil : identifiant (casse, accents, espaces indifférents) + mot de passe.
    const autre = await connecterParIdentifiant(RELAIS_TEST, '  LEA ', 'Été à Biarritz 2026', relais.requete);
    expect(autre.acces.compte).toBe('lea0000001');
    expect(autre.relie.annuaire.restreint).toBe(true);
    await expect(connecterParIdentifiant(RELAIS_TEST, 'Léa', 'mauvais mot de passe', relais.requete)).rejects.toMatchObject({ code: 'mot-de-passe' });
    await expect(connecterParIdentifiant(RELAIS_TEST, 'Lucas', 'Été à Biarritz 2026', relais.requete)).rejects.toMatchObject({ code: 'identifiant-inconnu' });
  });

  it('profil pas encore publié par l’appareil du Fondateur : message précis (« demande à Enzo… »), l’invitation reste valable', async () => {
    const relais = relaisV6();
    const pc = await pcAvecLea();
    // Le PC crée l'invitation mais s'éteint avant son tour de synchronisation.
    const inv = await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: pc.ids.motDePasse, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF });
    const chargee = await chargerInvitation(decoderInvitation(inv.lien)!, relais.requete);
    const essai = accepterInvitation({ invitation: chargee, motDePasse: 'Été à Biarritz 2026', requete: relais.requete, kdf: KDF });
    await expect(essai).rejects.toMatchObject({ code: 'non-publie' });
    await expect(essai).rejects.toThrow(/demande à Enzo d’ouvrir AppDashboard/);
    // Le PC se rallume : tout passe, avec le même lien.
    await pc.tour(relais);
    const ok = await accepterInvitation({ invitation: await chargerInvitation(decoderInvitation(inv.lien)!, relais.requete), motDePasse: 'Été à Biarritz 2026', requete: relais.requete, kdf: KDF });
    expect(ok.relie.compte).toBe('lea0000001');
  });

  it('renvoyer : la nouvelle invitation remplace l’ancienne ; relais injoignable : message clair', async () => {
    const relais = relaisV6();
    const pc = await pcAvecLea();
    await pc.tour(relais);
    const premiere = await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: pc.ids.motDePasse, jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF });
    await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: pc.ids.motDePasse, jours: 7, site: 'https://site.test', requete: relais.requete, kdfCodeCourt: KDF });
    await expect(chargerInvitation(decoderInvitation(premiere.lien)!, relais.requete)).rejects.toMatchObject({ code: 'invitation-revoquee' });
    relais.couper(true);
    await expect(chargerInvitation(decoderInvitation(premiere.lien)!, relais.requete)).rejects.toMatchObject({ code: 'relais-injoignable' });
  });
});

describe('relais pas encore redéployé (compatibilité)', () => {
  it('invitation en mode lien : marche, une seule fois ; expirée → message ; connexion par identifiant → « relais à mettre à jour »', async () => {
    const relais = relaisV6({ ancien: true });
    const pc = await pcAvecLea();
    await pc.tour(relais);
    const inv = await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: pc.ids.motDePasse, fondateur: 'Enzo', jours: 7, site: 'https://site.test', requete: relais.requete });
    expect(inv.mode).toBe('lien');
    expect(inv.avertissement).toMatch(/Relais à mettre à jour/);
    const lien = decoderInvitation(inv.lien)!;
    const acceptee = await accepterInvitation({ invitation: await chargerInvitation(lien, relais.requete), motDePasse: 'Été à Biarritz 2026', requete: relais.requete, kdf: KDF });
    expect(acceptee.avertissements.join(' ')).toMatch(/relais à mettre à jour/);
    // Rejouée : le mot de passe temporaire ne marche plus.
    await expect(accepterInvitation({ invitation: await chargerInvitation(lien, relais.requete), motDePasse: 'autre mot de passe', requete: relais.requete, kdf: KDF })).rejects.toMatchObject({ code: 'invitation-utilisee' });
    // Expirée (heure du relais).
    const vieille = await creerInvitation({ maitre: MAITRE, compte: 'lea0000001', prenom: 'Léa', motDePasse: 'temporaire-perime', fondateur: 'Enzo', jours: 1, site: 'https://site.test', requete: relais.requete, maintenant: () => Date.now() - 3 * 86_400_000 });
    await expect(chargerInvitation(decoderInvitation(vieille.lien)!, relais.requete)).rejects.toMatchObject({ code: 'invitation-expiree' });
    await expect(connecterParIdentifiant(RELAIS_TEST, 'Léa', 'Été à Biarritz 2026', relais.requete)).rejects.toBeInstanceOf(ErreurInvitation);
    await expect(connecterParIdentifiant(RELAIS_TEST, 'Léa', 'Été à Biarritz 2026', relais.requete)).rejects.toMatchObject({ code: 'relais-ancien' });
  });
});
