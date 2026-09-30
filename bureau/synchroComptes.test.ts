/**
 * Synchronisation des comptes par le relais : ce qui part, pour qui, et ce
 * qu'un navigateur neuf (administrateur ou ami) en reçoit.
 */

import { aleatoireDeterministe } from '../src/securite/aleatoire';
import {
  appliquerProfilsAdmin,
  lireAnnuaire,
  noterConnexionAmi,
  ouvrirAnnuaireAdmin,
  trouverCompte,
  type Annuaire,
  type ClesAdmin,
} from '../src/profils/annuaire';
import { ajouterProfil, supprimerProfil, type Profil } from '../src/profils/profils';
import { encoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { liaisonPourProfil } from '../src/sync/relais/portees';
import { espacesDuRelais } from '../src/sync/relais/espaces';
import { avecEvenement, chargerDonnees, donneesVides, ecrireDonnees, lireDonnees } from '../src/hub/admin/donnees';
import { JETON_TEST, RELAIS_TEST, relaisPortees } from '../src/sync/relais/__fixtures__/relaisPortees';
import {
  CLES_MEMOIRE,
  avantOuverture,
  coffreAdminEtranger,
  lireAnnuaireFichier,
  preparerLiaison,
  retenirLiaison,
  synchroniserAnnuaire,
  synchroniserCompteAmi,
  synchroniserComptesAdmin,
  type Fichiers,
  type Memoire,
} from './synchroComptes';

const MAITRE: Liaison = { relais: RELAIS_TEST, jeton: JETON_TEST };
const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

function memoire(): Memoire & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}

function disque(): Fichiers & { f: Map<string, Uint8Array> } {
  const f = new Map<string, Uint8Array>();
  return { f, lire: async n => f.get(n), ecrire: async (n, o) => void f.set(n, o) };
}

const cles: ClesAdmin = { annuaire: new Uint8Array(32).fill(7), sequestre: new Uint8Array(32).fill(9) };
const copieCles = () => ({ annuaire: cles.annuaire.slice(), sequestre: cles.sequestre.slice() });
let t = Date.parse('2026-09-30T08:00:00Z');
const horloge = () => new Date((t += 60_000));

/** Un appareil : ses fichiers, sa mémoire de navigateur, son annuaire. */
function appareil() {
  const fichiers = disque();
  const mem = memoire();
  return {
    fichiers,
    mem,
    lire: () => lireAnnuaireFichier(fichiers),
    ecrire: async (a: Annuaire) => fichiers.ecrire('profils', encodeur.encode(JSON.stringify({ ...a, format: 'annuaire' }))),
    donnees: undefined as undefined | string,
  };
}

/** Le PC : administrateur « Enzo » et un ami « Léa » (fichiers de Léa sur le disque). */
async function pcAvecLea() {
  const pc = appareil();
  const alea = aleatoireDeterministe(11);
  const vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copieCles(), alea);
  let profils: Profil[] = vue.profils.map(p => (p.admin ? { ...p, nom: 'Enzo' } : p));
  profils = ajouterProfil(profils, 'Léa', 'lea0000001', '2026-09-01', ['portefeuille']);
  const annuaire = appliquerProfilsAdmin(vue.annuaire, profils, copieCles(), alea);
  await pc.ecrire(annuaire);
  await pc.fichiers.ecrire('coffre', encodeur.encode('{"version":1,"enveloppes":[{"usage":"motdepasse"}]}'));
  await pc.fichiers.ecrire('coffre-lea0000001', encodeur.encode('{"coffre":"lea"}'));
  await pc.fichiers.ecrire('portefeuille-lea0000001', Uint8Array.from([1, 2, 3, 4]));
  return pc;
}

function tourAdmin(a: ReturnType<typeof appareil>, relais: ReturnType<typeof relaisPortees>) {
  return synchroniserComptesAdmin({
    liaison: MAITRE,
    memoire: a.mem,
    fichiers: a.fichiers,
    lire: a.lire,
    ecrire: a.ecrire,
    cles: copieCles,
    maintenant: horloge,
    requete: relais.requete,
    effacerFichiers: async id => {
      await a.fichiers.ecrire(`coffre-${id}`, new Uint8Array(0));
      await a.fichiers.ecrire(`portefeuille-${id}`, new Uint8Array(0));
    },
    donnees: {
      lire: () => a.donnees,
      ecrire: v => void (a.donnees = v),
      cleSynchro: 'ab'.repeat(32),
    },
  });
}

describe('publication par le PC de l’administrateur', () => {
  it('dépose l’annuaire (sans prénom en clair) chez l’administrateur, et à Léa sa seule projection et ses fichiers', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    const bilan = await tourAdmin(pc, relais);
    expect(bilan.erreurs).toEqual([]);
    const annuaire = relais.boite.get('p:principal:annuaire')!;
    expect(annuaire).toBeDefined();
    expect(annuaire).not.toMatch(/Enzo|Léa|L\\u00e9a|lea\b/i);
    expect(relais.boite.get('p:lea0000001:annuaire')).toBeDefined();
    const projection = JSON.parse(JSON.parse(relais.boite.get('p:lea0000001:annuaire')!).charge);
    expect(projection.restreint).toBe(true);
    expect(projection.comptes.map((c: { id: string }) => c.id)).toEqual(['lea0000001']);
    expect(projection.admin).toEqual({ cleSequestre: expect.any(String) });
    expect(projection.prive).toBeUndefined();
    expect(relais.boite.get('p:lea0000001:coffre')).toBeDefined();
    expect(relais.boite.get('p:lea0000001:portefeuille')).toBeDefined();
    // Un tour sans changement ne redépose rien.
    const avant = relais.appels.filter(a => a.methode === 'PUT').length;
    await tourAdmin(pc, relais);
    expect(relais.appels.filter(a => a.methode === 'PUT').length).toBe(avant);
  });

  it('isolation : le code de Léa n’ouvre ni l’annuaire, ni les données admin, ni l’espace d’un autre ami', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    const lea = espacesDuRelais(liaisonPourProfil(MAITRE, 'lea0000001'), relais.requete);
    await expect(lea.lire('principal', 'annuaire')).rejects.toThrow(/ne donne pas accès/);
    await expect(lea.lire('principal', 'admin')).rejects.toThrow(/ne donne pas accès/);
    await expect(lea.lire('hugo000002', 'coffre')).rejects.toThrow(/ne donne pas accès/);
    await expect(lea.deposer('hugo000002', 'coffre', 'x', '2026-01-01T00:00:00Z')).rejects.toThrow(/ne donne pas accès/);
    expect(await lea.lire('lea0000001', 'coffre')).toBeDefined();
    // Et son code ne contient pas le jeton maître.
    expect(encoderLiaison(liaisonPourProfil(MAITRE, 'lea0000001'))).not.toContain(JETON_TEST);
  });
});

describe('premier lancement sur un navigateur', () => {
  it('administrateur : le code du PC amène l’annuaire (écran prénom) puis SON coffre seulement', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    // Le coffre de l'administrateur est déposé par la synchro historique.
    await espacesDuRelais(MAITRE, relais.requete); // (même relais)
    relais.boite.set('appareil:coffre', JSON.stringify({ format: 'applibourse-relais', version: 1, appareil: 'coffre', date: '2026-09-30T08:00:00Z', charge: '{"version":1,"enveloppes":[{"usage":"motdepasse"}]}' }));

    const site = appareil();
    const relie = await preparerLiaison(encoderLiaison(MAITRE), relais.requete);
    expect(relie.compte).toBeUndefined();
    expect(relie.annuaire.comptes).toHaveLength(1);
    expect(trouverCompte(relie.annuaire, 'léa')?.id).toBe('lea0000001');
    expect(trouverCompte(relie.annuaire, 'Enzo')?.admin).toBe(true);
    await site.ecrire(relie.annuaire);
    retenirLiaison(site.mem, relie.liaison);

    relais.appels.length = 0;
    expect(await avantOuverture({ memoire: site.mem, fichiers: site.fichiers, compte: 'principal', requete: relais.requete })).toBe(true);
    expect(decodeur.decode(site.fichiers.f.get('coffre'))).toContain('motdepasse');
    expect(site.fichiers.f.has('coffre-lea0000001')).toBe(false);
    expect(await coffreAdminEtranger(site.mem, site.fichiers)).toBe(false);
  });

  it('ami : son code amène sa projection (son compte seul), le leurre pour tout autre prénom, puis ses fichiers', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    const telephone = appareil();
    const code = encoderLiaison(liaisonPourProfil(MAITRE, 'lea0000001'));
    const relie = await preparerLiaison(code, relais.requete);
    expect(relie.compte).toBe('lea0000001');
    expect(relie.annuaire.restreint).toBe(true);
    expect(trouverCompte(relie.annuaire, 'Léa')?.id).toBe('lea0000001');
    expect(trouverCompte(relie.annuaire, 'Enzo')).toBeUndefined();
    expect(trouverCompte(relie.annuaire, 'admin')).toBeUndefined();
    expect(trouverCompte(relie.annuaire, 'Hugo')).toBeUndefined();
    await telephone.ecrire(relie.annuaire);
    retenirLiaison(telephone.mem, relie.liaison);
    expect(telephone.mem.m.get(CLES_MEMOIRE.liaisons)).not.toContain(JETON_TEST);

    // Leurre : même appel (liste de l'espace de ce navigateur), aucun 404.
    relais.appels.length = 0;
    await avantOuverture({ memoire: telephone.mem, fichiers: telephone.fichiers, compte: undefined, requete: relais.requete });
    const leurre = relais.appels.map(a => `${a.methode} ${a.chemin} ${a.statut}`);
    expect(leurre).toEqual(['GET /p/lea0000001/boite 200']);

    relais.appels.length = 0;
    expect(await avantOuverture({ memoire: telephone.mem, fichiers: telephone.fichiers, compte: 'lea0000001', requete: relais.requete })).toBe(true);
    expect(relais.appels[0]).toEqual(leurre.length ? { methode: 'GET', chemin: '/p/lea0000001/boite', statut: 200 } : undefined);
    expect(relais.appels.every(a => a.statut === 200)).toBe(true);
    expect(Array.from(telephone.fichiers.f.get('portefeuille-lea0000001')!)).toEqual([1, 2, 3, 4]);
    expect(decodeur.decode(telephone.fichiers.f.get('coffre-lea0000001'))).toBe('{"coffre":"lea"}');
  });
});

describe('va-et-vient entre le PC et le site', () => {
  it('un compte ajouté sur le site arrive au PC ; une suppression sur le PC retire le compte et ses fichiers du site', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    const site = appareil();
    const relie = await preparerLiaison(encoderLiaison(MAITRE), relais.requete);
    await site.ecrire(relie.annuaire);
    await tourAdmin(site, relais);
    expect(site.fichiers.f.get('portefeuille-lea0000001')).toEqual(Uint8Array.from([1, 2, 3, 4]));

    // Le site ajoute Hugo.
    const vue = ouvrirAnnuaireAdmin(await site.lire(), copieCles());
    const avecHugo = ajouterProfil(vue.profils, 'Hugo', 'hugo000002', '2026-09-30');
    await site.ecrire(appliquerProfilsAdmin(vue.annuaire, avecHugo, copieCles()));
    await tourAdmin(site, relais);
    const bilanPc = await tourAdmin(pc, relais);
    expect(bilanPc.annuaireChange).toBe(true);
    const vuePc = ouvrirAnnuaireAdmin(await pc.lire(), copieCles());
    expect(vuePc.profils.map(p => p.nom)).toEqual(['Enzo', 'Léa', 'Hugo']);

    // Le PC supprime Léa.
    await pc.ecrire(appliquerProfilsAdmin(vuePc.annuaire, supprimerProfil(vuePc.profils, 'lea0000001'), copieCles()));
    await tourAdmin(pc, relais);
    expect(relais.boite.has('p:lea0000001:coffre')).toBe(false);
    await tourAdmin(site, relais);
    const vueSite = ouvrirAnnuaireAdmin(await site.lire(), copieCles());
    expect(vueSite.profils.map(p => p.nom)).toEqual(['Enzo', 'Hugo']);
    expect(site.fichiers.f.get('coffre-lea0000001')?.length).toBe(0);
  });

  it('comptes créés en même temps sur le PC et sur le site : les deux prénoms sont gardés, puis plus rien ne repart', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    const site = appareil();
    await site.ecrire((await preparerLiaison(encoderLiaison(MAITRE), relais.requete)).annuaire);
    await tourAdmin(site, relais);
    const ajouter = async (a: ReturnType<typeof appareil>, nom: string, id: string) => {
      const vue = ouvrirAnnuaireAdmin(await a.lire(), copieCles());
      await a.ecrire(appliquerProfilsAdmin(vue.annuaire, ajouterProfil(vue.profils, nom, id, '2026-09-30'), copieCles()));
    };
    await ajouter(pc, 'Hugo', 'hugo000002');
    await ajouter(site, 'Zoé', 'zoe0000003');
    for (let i = 0; i < 3; i++) {
      await tourAdmin(pc, relais);
      await tourAdmin(site, relais);
    }
    for (const a of [pc, site]) {
      expect(ouvrirAnnuaireAdmin(await a.lire(), copieCles()).profils.map(p => p.nom).sort()).toEqual(['Enzo', 'Hugo', 'Léa', 'Zoé']);
    }
    const puts = relais.appels.filter(x => x.methode === 'PUT').length;
    await tourAdmin(pc, relais);
    await tourAdmin(site, relais);
    expect(relais.appels.filter(x => x.methode === 'PUT').length).toBe(puts);
  });

  it('fusion par compte : accès changés sur le site et connexion notée sur le PC sont gardés tous les deux', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    const site = appareil();
    await site.ecrire((await preparerLiaison(encoderLiaison(MAITRE), relais.requete)).annuaire);
    await tourAdmin(site, relais);

    const vue = ouvrirAnnuaireAdmin(await site.lire(), copieCles());
    await site.ecrire(appliquerProfilsAdmin(vue.annuaire, vue.profils.map(p => (p.admin ? p : { ...p, apps: ['portefeuille', 'podcast'] })), copieCles()));
    await pc.ecrire(noterConnexionAmi(await pc.lire(), 'lea0000001', '2026-09-30T09:00:00Z', 3));
    await tourAdmin(site, relais);
    await tourAdmin(pc, relais);
    await tourAdmin(site, relais);
    for (const a of [pc, site]) {
      const lea = ouvrirAnnuaireAdmin(await a.lire(), copieCles()).profils.find(p => p.id === 'lea0000001')!;
      expect(lea.apps).toEqual(['portefeuille', 'podcast']);
      expect(lea.connexions).toBe(3);
    }
  });

  it('journal et réglages d’administration : union du journal (sans doublon), dernier réglage gagnant', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    const site = appareil();
    const base = Date.parse('2026-09-30T07:00:00Z');
    let dPc = avecEvenement(donneesVides(), { type: 'compte', action: 'Compte de Léa créé', cible: 'lea0000001' }, base);
    pc.donnees = ecrireDonnees(dPc);
    await tourAdmin(pc, relais);
    await site.ecrire((await preparerLiaison(encoderLiaison(MAITRE), relais.requete)).annuaire);
    await tourAdmin(site, relais);
    expect(lireDonnees(site.donnees).journal.map(e => e.action)).toEqual(['Compte de Léa créé']);

    // Chacun ajoute un événement ; le site change un réglage.
    dPc = avecEvenement(lireDonnees(pc.donnees), { type: 'reglages', action: 'Sur le PC' }, base + 1000);
    pc.donnees = ecrireDonnees(dPc);
    const dSite = avecEvenement(lireDonnees(site.donnees), { type: 'reglages', action: 'Sur le site' }, base + 2000);
    site.donnees = ecrireDonnees({ ...dSite, reglages: { ...dSite.reglages, inactifJours: 12 } });
    await tourAdmin(pc, relais);
    await tourAdmin(site, relais);
    await tourAdmin(pc, relais);
    for (const a of [pc, site]) {
      const d = chargerDonnees({ lire: () => a.donnees, ecrire: () => undefined });
      expect(d.journal.map(e => e.action)).toEqual(['Compte de Léa créé', 'Sur le PC', 'Sur le site']);
      expect(d.reglages.inactifJours).toBe(12);
    }
    // Les données d'administration sont scellées : rien de lisible sur le relais.
    expect(relais.boite.get('p:principal:admin')).not.toMatch(/Léa|Sur le PC/);
  });

  it('ce que l’ami fait sur son téléphone (connexion, séquestre) remonte au PC ; ses accès changés descendent', async () => {
    const relais = relaisPortees();
    const pc = await pcAvecLea();
    await tourAdmin(pc, relais);
    const telephone = appareil();
    const liaison = liaisonPourProfil(MAITRE, 'lea0000001');
    await telephone.ecrire((await preparerLiaison(encoderLiaison(liaison), relais.requete)).annuaire);
    retenirLiaison(telephone.mem, liaison);
    await avantOuverture({ memoire: telephone.mem, fichiers: telephone.fichiers, compte: 'lea0000001', requete: relais.requete });

    // Léa se connecte sur son téléphone et modifie son portefeuille.
    await telephone.ecrire(noterConnexionAmi(await telephone.lire(), 'lea0000001', '2026-09-30T10:00:00Z', 1));
    await telephone.fichiers.ecrire('portefeuille-lea0000001', Uint8Array.from([9, 9]));
    const ami = { liaison, id: 'lea0000001', memoire: telephone.mem, fichiers: telephone.fichiers, lire: telephone.lire, ecrire: telephone.ecrire, maintenant: horloge, requete: relais.requete };
    const bilan = await synchroniserCompteAmi(ami);
    expect(bilan.depots).toBe(2);
    await tourAdmin(pc, relais);
    expect(Array.from(pc.fichiers.f.get('portefeuille-lea0000001')!)).toEqual([9, 9]);
    const lea = ouvrirAnnuaireAdmin(await pc.lire(), copieCles()).profils.find(p => p.id === 'lea0000001')!;
    expect(lea.connexions).toBe(1);

    // L'administrateur la désactive sur le PC : le téléphone le reçoit.
    const vue = ouvrirAnnuaireAdmin(await pc.lire(), copieCles());
    await pc.ecrire(appliquerProfilsAdmin(vue.annuaire, vue.profils.map(p => (p.admin ? p : { ...p, actif: false })), copieCles()));
    await tourAdmin(pc, relais);
    await synchroniserCompteAmi(ami);
    const recu = await telephone.lire();
    expect(recu.restreint).toBe(true);
    expect(recu.comptes[0].acces.actif).toBe(false);
    expect(recu.comptes[0].suivi).toBeDefined();
  });

  it('annuaire seul avant le déverrouillage : un compte ajouté sur le PC apparaît sur l’écran prénom du site', async () => {
    const relais = relaisPortees();
    const pc = appareil();
    const vide = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copieCles());
    await pc.ecrire(appliquerProfilsAdmin(vide.annuaire, vide.profils.map(p => ({ ...p, nom: 'Enzo' })), copieCles()));
    await tourAdmin(pc, relais);
    const site = appareil();
    await site.ecrire((await preparerLiaison(encoderLiaison(MAITRE), relais.requete)).annuaire);
    expect((await site.lire()).comptes).toHaveLength(0);

    const vue = ouvrirAnnuaireAdmin(await pc.lire(), copieCles());
    await pc.ecrire(appliquerProfilsAdmin(vue.annuaire, ajouterProfil(vue.profils, 'Léa', 'lea0000001', '2026-09-30'), copieCles()));
    await tourAdmin(pc, relais);
    const resultat = await synchroniserAnnuaire({ liaison: MAITRE, memoire: site.mem, lire: site.lire, ecrire: site.ecrire, maintenant: horloge, requete: relais.requete });
    expect(resultat.change).toBe(true);
    expect(trouverCompte(await site.lire(), 'Léa')?.id).toBe('lea0000001');
  });
});

describe('ancien coffre local', () => {
  it('un navigateur au coffre créé ici autrefois, avec un code du PC connu, est signalé', async () => {
    const site = appareil();
    await site.fichiers.ecrire('coffre', encodeur.encode('{"ancien":true}'));
    expect(await coffreAdminEtranger(site.mem, site.fichiers)).toBe(false);
    retenirLiaison(site.mem, MAITRE);
    expect(await coffreAdminEtranger(site.mem, site.fichiers)).toBe(true);
  });
});
