import { achat, compte, titre, versement } from '../../core/testing/fixtures';
import { DepotComptes, DepotParametres, DepotTitres, DepotTransactions, DepotWatchlist, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { deriverCleSynchro, depuisBase64, ouvrirEnveloppe, sceller, versBase64 } from './chiffrement';
import { ANCIENS_SITES, SITE_PRINCIPAL, estSiteConnu } from '../../config/site';
import { decoderLiaison, encoderLiaison, lienSite } from './liaison';
import { ecrireConfigRelais, lireEtatSynchro, recupererCoffre, synchroniser } from './synchroniser';

const KDF_RAPIDE = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };
const JETON = 'jeton-du-relais-0123456789';
const RELAIS = 'https://relais.exemple.workers.dev';

/** Relais en mémoire, même contrat que relais/worker.mjs. */
function relaisMemoire() {
  const boite = new Map<string, string>();
  const index: Record<string, { date: string }> = {};
  const requete = (async (url: string, init: RequestInit = {}) => {
    const chemin = url.slice(RELAIS.length);
    const reponse = (corps: unknown, status = 200) =>
      ({ ok: status < 300, status, json: async () => (typeof corps === 'string' ? JSON.parse(corps) : corps) }) as Response;
    if ((init.headers as Record<string, string>).Authorization !== `Bearer ${JETON}`) {
      return reponse({}, 401);
    }
    if (chemin === '/sante') return reponse({ ok: true });
    if (chemin === '/boite') return reponse({ appareils: index });
    const id = chemin.slice('/boite/'.length);
    if (init.method === 'PUT') {
      boite.set(id, String(init.body));
      index[id] = { date: JSON.parse(String(init.body)).date };
      return reponse({ ok: true });
    }
    if (init.method === 'DELETE') {
      boite.delete(id);
      delete index[id];
      return reponse({ ok: true });
    }
    return boite.has(id) ? reponse(boite.get(id)!) : reponse({}, 404);
  }) as unknown as typeof fetch;
  return { boite, requete };
}

function appareil(nom: string, cle: string): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  ecrireConfigRelais(pilote, { relais: RELAIS, jeton: JETON, cle, nom });
  return pilote;
}

let horloge = Date.parse('2026-09-26T10:00:00Z');
const maintenant = () => new Date((horloge += 60_000));

describe('synchronisation par le relais', () => {
  const cle = deriverCleSynchro('mot de passe commun', JETON, KDF_RAPIDE);
  let relais: ReturnType<typeof relaisMemoire>;
  let pc: PiloteSqlite;
  let iphone: PiloteSqlite;
  const tour = (pilote: PiloteSqlite, id: string, expireLe?: string) =>
    synchroniser({ pilote, appareil: id, moi: { plateforme: id === 'aaaa1111' ? 'bureau' : 'ios', expireLe }, maintenant, requete: relais.requete });

  beforeEach(() => {
    relais = relaisMemoire();
    pc = appareil('PC', cle);
    iphone = appareil('iPhone', cle);
    new DepotComptes(pc).enregistrer(compte());
    new DepotTitres(pc).enregistrer(titre());
    new DepotTransactions(pc).enregistrer(versement('2026-01-02', 1000));
    new DepotTransactions(pc).enregistrer(achat('2026-01-03', 2, 150));
    new DepotWatchlist(pc).ajouter({ titreId: 'air-liquide', ajouteLe: '2026-09-01' });
  });

  afterEach(() => {
    pc.fermer();
    iphone.fermer();
  });

  it('amène tout le portefeuille du PC sur un iPhone neuf', async () => {
    const envoi = await tour(pc, 'aaaa1111');
    expect(envoi.envoye).toBe(true);
    const reception = await tour(iphone, 'bbbb2222', '2026-10-03T10:00:00Z');
    expect(reception.recus).toBe(1);
    expect(new DepotComptes(iphone).tous()).toHaveLength(1);
    expect(new DepotTransactions(iphone).toutes()).toHaveLength(2);
    expect(new DepotWatchlist(iphone).contient('air-liquide')).toBe(true);
    expect(reception.bilan.echecs).toEqual([]);

    // Le PC apprend en retour l'expiration de l'iPhone.
    const retour = await tour(pc, 'aaaa1111');
    expect(retour.appareils.bbbb2222).toMatchObject({ nom: 'iPhone', plateforme: 'ios', expireLe: '2026-10-03T10:00:00Z' });
  });

  it('le relais ne voit rien en clair', async () => {
    await tour(pc, 'aaaa1111');
    const depot = relais.boite.get('aaaa1111')!;
    expect(depot).not.toMatch(/PEA|Air Liquide|FR0000120073/);
  });

  it('une suppression voyage et ne renaît pas', async () => {
    await tour(pc, 'aaaa1111');
    await tour(iphone, 'bbbb2222');
    const [versementPc] = new DepotTransactions(pc).toutes().filter(t => t.type === 'VERSEMENT');
    new DepotTransactions(pc).supprimer(versementPc.id);
    new DepotWatchlist(pc).retirer('air-liquide');
    await tour(pc, 'aaaa1111');
    await tour(iphone, 'bbbb2222');
    expect(new DepotTransactions(iphone).toutes()).toHaveLength(1);
    expect(new DepotWatchlist(iphone).contient('air-liquide')).toBe(false);
    // L'iPhone renvoie son état : l'opération ne revient pas sur le PC.
    await tour(pc, 'aaaa1111');
    expect(new DepotTransactions(pc).toutes()).toHaveLength(1);
  });

  it('la modification la plus récente gagne partout', async () => {
    await tour(pc, 'aaaa1111');
    await tour(iphone, 'bbbb2222');
    new DepotComptes(iphone).enregistrer(compte({ nom: 'PEA renommé sur l’iPhone' }));
    await tour(iphone, 'bbbb2222');
    await tour(pc, 'aaaa1111');
    expect(new DepotComptes(pc).tous()[0].nom).toBe('PEA renommé sur l’iPhone');
    new DepotComptes(pc).enregistrer(compte({ nom: 'Puis sur le PC' }));
    await tour(pc, 'aaaa1111');
    await tour(iphone, 'bbbb2222');
    expect(new DepotComptes(iphone).tous()[0].nom).toBe('Puis sur le PC');
  });

  it('réunit une valeur créée des deux côtés avec le même ISIN', async () => {
    new DepotTitres(iphone).enregistrer(titre({ id: 'air-liquide-iphone' }));
    new DepotComptes(iphone).enregistrer(compte({ id: 'cto', nom: 'CTO', type: 'CTO' }));
    new DepotTransactions(iphone).enregistrer(achat('2026-02-01', 1, 160, 0, { compteId: 'cto', titreId: 'air-liquide-iphone' }));
    await tour(pc, 'aaaa1111');
    const resultat = await tour(iphone, 'bbbb2222');
    expect(resultat.bilan.echecs).toEqual([]);
    expect(new DepotTitres(iphone).tous()).toHaveLength(1);
    const achats = new DepotTransactions(iphone).toutes().filter(t => t.type === 'ACHAT');
    expect(achats.map(a => ('titreId' in a ? a.titreId : ''))).toEqual(['air-liquide-iphone', 'air-liquide-iphone']);
  });

  it('partage le carnet et les objectifs, pas les réglages de l’appareil', async () => {
    const parametres = new DepotParametres(pc);
    parametres.ecrire(PARAMETRES.carnetTheses, JSON.stringify({ 'air-liquide': { pourquoi: 'Qualité', ecriteLe: '2026-09-01' } }));
    parametres.ecrire(PARAMETRES.objectif, '{"montant":"50000"}');
    parametres.ecrire(PARAMETRES.theme, 'clair');
    await tour(pc, 'aaaa1111');
    await tour(iphone, 'bbbb2222');
    const recus = new DepotParametres(iphone);
    expect(JSON.parse(recus.lire(PARAMETRES.carnetTheses)!)['air-liquide'].pourquoi).toBe('Qualité');
    expect(recus.lire(PARAMETRES.objectif)).toBe('{"montant":"50000"}');
    expect(recus.lire(PARAMETRES.theme)).toBeUndefined();
  });

  it('ne renvoie rien quand rien n’a changé', async () => {
    await tour(pc, 'aaaa1111');
    const second = await tour(pc, 'aaaa1111');
    expect(second.envoye).toBe(false);
    expect(lireEtatSynchro(pc).derniereSynchro).toBeDefined();
  });

  it('dépose le coffre pour qu’un nouvel appareil se lie, et ne le prend pas pour un appareil', async () => {
    const coffre = { version: 1, enveloppes: [{ usage: 'motdepasse' }] };
    await synchroniser({ pilote: pc, appareil: 'aaaa1111', moi: { plateforme: 'bureau' }, maintenant, requete: relais.requete, coffre });
    expect(await recupererCoffre({ relais: RELAIS, jeton: JETON }, relais.requete)).toEqual(coffre);

    const reception = await tour(iphone, 'bbbb2222');
    expect(reception.erreurs).toEqual([]);
    expect(Object.keys(reception.appareils)).toEqual(['aaaa1111']);

    // Inchangé : pas de nouveau dépôt.
    const avant = relais.boite.get('coffre');
    await synchroniser({ pilote: pc, appareil: 'aaaa1111', moi: { plateforme: 'bureau' }, maintenant, requete: relais.requete, coffre });
    expect(relais.boite.get('coffre')).toBe(avant);
  });

  it('dit clairement quand aucun compte n’a encore été déposé', async () => {
    await expect(recupererCoffre({ relais: RELAIS, jeton: JETON }, relais.requete)).rejects.toThrow(/Aucun compte/);
  });

  it('signale un mot de passe différent sans rien casser', async () => {
    await tour(pc, 'aaaa1111');
    ecrireConfigRelais(iphone, { relais: RELAIS, jeton: JETON, cle: deriverCleSynchro('autre', JETON, KDF_RAPIDE), nom: 'iPhone' });
    const resultat = await tour(iphone, 'bbbb2222');
    expect(resultat.erreurs[0]).toMatch(/mot de passe de synchronisation/);
    expect(new DepotComptes(iphone).tous()).toHaveLength(0);
  });
});

describe('enveloppes et code de liaison', () => {
  it('base 64 aller-retour', () => {
    for (const taille of [0, 1, 2, 3, 4, 50]) {
      const octets = Uint8Array.from({ length: taille }, (_, i) => (i * 37) % 256);
      expect(Array.from(depuisBase64(versBase64(octets)))).toEqual(Array.from(octets));
    }
  });

  it('refuse une enveloppe dont on a changé l’appareil', () => {
    const cle = deriverCleSynchro('x', JETON, KDF_RAPIDE);
    const enveloppe = sceller(cle, { a: 1 }, 'aaaa1111', '2026-09-26T10:00:00Z');
    expect(ouvrirEnveloppe(cle, enveloppe)).toEqual({ a: 1 });
    expect(() => ouvrirEnveloppe(cle, { ...enveloppe, appareil: 'bbbb2222' })).toThrow();
  });

  it('code de liaison aller-retour, y compris dans un lien', () => {
    const liaison = { relais: RELAIS, jeton: JETON, site: 'https://applibourse.pages.dev' };
    const code = encoderLiaison(liaison);
    expect(code.startsWith('AB1.')).toBe(true);
    expect(decoderLiaison(code)).toEqual(liaison);
    expect(decoderLiaison(lienSite(liaison)!)).toEqual(liaison);
    expect(decoderLiaison('AB1.nimportequoi')).toBeUndefined();
  });

  it('le lien du site vient de la configuration, sans adresse propre au code', () => {
    const lien = lienSite({ relais: RELAIS, jeton: JETON })!;
    expect(lien.startsWith(`${SITE_PRINCIPAL}/#liaison=AB1.`)).toBe(true);
    expect(SITE_PRINCIPAL).toBe('https://appdashboard.pages.dev');
    // Un code émis avec l'ancienne adresse reste lisible et garde son site.
    const ancien = { relais: RELAIS, jeton: JETON, site: ANCIENS_SITES[0] };
    expect(estSiteConnu(ancien.site)).toBe(true);
    expect(decoderLiaison(lienSite(ancien)!)?.site).toBe(ancien.site);
    expect(lienSite(ancien)!.startsWith(`${ANCIENS_SITES[0]}/#`)).toBe(true);
    expect(decoderLiaison(encoderLiaison({ relais: 'http://pas-https', jeton: JETON }))).toBeUndefined();
  });
});
