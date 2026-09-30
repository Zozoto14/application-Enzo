/**
 * Synchronisation des préférences du hub, des thèmes et des nouveautés vues,
 * compatibilité avec l'ancien format, file d'envoi, économie d'écritures du
 * relais et isolation entre profils.
 */

import { compte } from '../../core/testing/fixtures';
import { DepotComptes, DepotParametres, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { CLE_DEVBLOG } from '../../hub/devblog/logiqueDevblog';
import { CLE_PREFS, CLE_THEME } from '../../hub/personnalisation';
import { contexteDerivation } from '../../session/session';
import { deriverCleSynchro, ouvrirEnveloppe, sceller } from './chiffrement';
import {
  CLE_DEVBLOG_VUES,
  CLE_PREFS_HUB,
  CLE_THEME_HUB,
  VERSION_CHARGE,
  ecrireEntite,
  extraireEntites,
  supprimerEntite,
  unionVues,
} from './entites';
import { appliquerCharge, chargeLocale, etatVide, noterChangementsLocaux, type Charge } from './moteur';
import {
  DELAI_MIN_DEPOTS_MS,
  ecrireConfigRelais,
  deposerAvantFermeture,
  lireEtatSynchro,
  synchroniser,
} from './synchroniser';

const JETON = 'jeton-du-relais-0123456789';
const RELAIS = 'https://relais.exemple.workers.dev';
const KDF = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };

function relaisMemoire() {
  const boite = new Map<string, string>();
  const index: Record<string, { date: string }> = {};
  const compteurs = { put: 0, get: 0 };
  let coupe = false;
  const requete = (async (url: string, init: RequestInit = {}) => {
    if (coupe) {
      throw new TypeError('Failed to fetch');
    }
    const chemin = url.slice(RELAIS.length);
    const reponse = (corps: unknown, status = 200) =>
      ({ ok: status < 300, status, json: async () => (typeof corps === 'string' ? JSON.parse(corps) : corps) }) as Response;
    if (chemin === '/boite') return reponse({ appareils: index });
    const id = chemin.slice('/boite/'.length);
    if (init.method === 'PUT') {
      compteurs.put++;
      boite.set(id, String(init.body));
      index[id] = { date: JSON.parse(String(init.body)).date };
      return reponse({ ok: true });
    }
    compteurs.get++;
    return boite.has(id) ? reponse(boite.get(id)!) : reponse({}, 404);
  }) as unknown as typeof fetch;
  return { boite, index, compteurs, requete, couper: (v: boolean) => (coupe = v) };
}

function appareil(nom: string, cle: string): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  ecrireConfigRelais(pilote, { relais: RELAIS, jeton: JETON, cle, nom });
  return pilote;
}

let horloge = Date.parse('2026-09-26T10:00:00Z');
const maintenant = () => new Date((horloge += 60_000));

describe('préférences, thèmes et devblog entre appareils', () => {
  const cle = deriverCleSynchro('commun', JETON, KDF);
  let relais: ReturnType<typeof relaisMemoire>;
  let pc: PiloteSqlite;
  let site: PiloteSqlite;
  const tour = (pilote: PiloteSqlite, id: string, extra: { force?: boolean } = {}) =>
    synchroniser({ pilote, appareil: id, moi: { plateforme: id === 'aaaa1111' ? 'bureau' : 'site' }, maintenant, requete: relais.requete, ...extra });

  beforeEach(() => {
    relais = relaisMemoire();
    pc = appareil('PC', cle);
    site = appareil('Site', cle);
  });
  afterEach(() => {
    pc.fermer();
    site.fermer();
  });

  it('les clés des entités sont celles du hub', () => {
    expect(CLE_PREFS_HUB).toBe(CLE_PREFS);
    expect(CLE_THEME_HUB).toBe(CLE_THEME);
    expect(CLE_DEVBLOG_VUES).toBe(CLE_DEVBLOG);
  });

  it('le thème unique et l’ordre des tuiles arrivent sur l’autre appareil', async () => {
    const p = new DepotParametres(pc);
    p.ecrire(CLE_THEME, 'ivoire');
    p.ecrire(CLE_PREFS, '{"version":1,"ordre":["administration","portefeuille"]}');
    await tour(pc, 'aaaa1111');
    const resultat = await tour(site, 'bbbb2222');
    expect(resultat.bilan.ajoutes).toBeGreaterThanOrEqual(2);
    const s = new DepotParametres(site);
    expect(s.lire(CLE_THEME)).toBe('ivoire');
    expect(s.lire(CLE_PREFS)).toBe('{"version":1,"ordre":["administration","portefeuille"]}');
  });

  it('l’ancienne entité prefs:theme-portefeuille reste lue, mais n’est plus jamais émise', () => {
    // Un appareil pas encore à jour l'envoie : elle est écrite en clair dans l'ancien réglage,
    // d'où la migration du thème unique la lit si le hub n'a pas encore de thème.
    expect(ecrireEntite(pc, 'prefs:theme-portefeuille', 'sauge', id => id)).toBe(true);
    expect(new DepotParametres(pc).lire(PARAMETRES.theme)).toBe('sauge');
    // Rien ne la renvoie ensuite, même quand le réglage existe : le thème est celui du hub.
    expect(Object.keys(extraireEntites(pc))).not.toContain('prefs:theme-portefeuille');
    new DepotParametres(pc).ecrire(CLE_THEME, 'terminal');
    expect(extraireEntites(pc)['prefs:theme']).toBe('terminal');
    expect(Object.keys(extraireEntites(pc))).not.toContain('prefs:theme-portefeuille');
  });

  it('dernier gagnant par clé pour les préférences', async () => {
    new DepotParametres(pc).ecrire(CLE_THEME, 'ivoire');
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    new DepotParametres(site).ecrire(CLE_THEME, 'terminal');
    await tour(site, 'bbbb2222', { force: true });
    await tour(pc, 'aaaa1111');
    expect(new DepotParametres(pc).lire(CLE_THEME)).toBe('terminal');
  });

  it('une modification locale non envoyée n’est pas écrasée par un dépôt plus ancien', async () => {
    new DepotParametres(pc).ecrire(CLE_THEME, 'ivoire');
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    // Le site change de thème après le dépôt du PC, sans avoir encore synchronisé.
    new DepotParametres(site).ecrire(CLE_THEME, 'terminal');
    await tour(site, 'bbbb2222');
    expect(new DepotParametres(site).lire(CLE_THEME)).toBe('terminal');
  });

  it('les versions du devblog vues se réunissent (union) et ne disparaissent jamais', async () => {
    new DepotParametres(pc).ecrire(CLE_DEVBLOG, JSON.stringify({ version: 1, vues: ['2026.09.29'] }));
    new DepotParametres(site).ecrire(CLE_DEVBLOG, JSON.stringify({ version: 1, vues: ['2026.09.30'] }));
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    await tour(pc, 'aaaa1111', { force: true });
    const vuesSite = JSON.parse(new DepotParametres(site).lire(CLE_DEVBLOG)!).vues;
    const vuesPc = JSON.parse(new DepotParametres(pc).lire(CLE_DEVBLOG)!).vues;
    expect(vuesSite).toEqual(['2026.09.29', '2026.09.30']);
    expect(vuesPc).toEqual(['2026.09.29', '2026.09.30']);
  });

  it('un appareil neuf (base vide, après « Lier ») reprend les versions déjà vues', async () => {
    new DepotParametres(pc).ecrire(CLE_DEVBLOG, JSON.stringify({ version: 1, vues: ['2026.09.29', '2026.09.30'] }));
    await tour(pc, 'aaaa1111');
    expect(new DepotParametres(site).lire(CLE_DEVBLOG)).toBeUndefined();
    await tour(site, 'bbbb2222');
    expect(JSON.parse(new DepotParametres(site).lire(CLE_DEVBLOG)!).vues).toEqual(['2026.09.29', '2026.09.30']);
  });

  it('la fusion par union n’enlève rien, même si l’autre appareil a moins de versions', () => {
    const parametres = new DepotParametres(pc);
    parametres.ecrire(CLE_DEVBLOG, JSON.stringify({ version: 1, vues: ['a', 'b'] }));
    ecrireEntite(pc, 'devblog:vues', { vues: ['b', 'c'] }, x => x);
    expect(JSON.parse(parametres.lire(CLE_DEVBLOG)!).vues).toEqual(['a', 'b', 'c']);
    supprimerEntite(pc, 'devblog:vues');
    expect(parametres.lire(CLE_DEVBLOG)).toBeDefined();
    expect(unionVues('pas du json', { vues: ['x', 3] }).vues).toEqual(['x']);
  });

  it('une suppression de « devblog:vues » reçue est ignorée', () => {
    new DepotParametres(pc).ecrire(CLE_DEVBLOG, JSON.stringify({ version: 1, vues: ['a'] }));
    const etat = { ...etatVide(), dates: {} };
    const charge: Charge = { entites: {}, dates: {}, supprimes: { 'devblog:vues': '2099-01-01T00:00:00Z' }, appareil: { nom: 'x', plateforme: 'site' } };
    const { etat: apres, bilan } = appliquerCharge(pc, etat, charge);
    expect(bilan.supprimes).toBe(0);
    expect(new DepotParametres(pc).lire(CLE_DEVBLOG)).toBeDefined();
    expect(apres.supprimes['devblog:vues']).toBeUndefined();
  });

  it('ne signale jamais « supprimé » une version vue qui disparaîtrait de la base locale', () => {
    let etat = noterChangementsLocaux(etatVide(), { 'devblog:vues': { vues: ['a'] } }, '2026-09-26T10:00:00Z');
    etat = noterChangementsLocaux(etat, {}, '2026-09-26T10:05:00Z');
    expect(etat.supprimes['devblog:vues']).toBeUndefined();
  });
});

describe('compatibilité avec l’ancien format', () => {
  const cle = deriverCleSynchro('commun', JETON, KDF);
  let pilote: PiloteSqlite;
  beforeEach(() => {
    pilote = appareil('PC', cle);
  });
  afterEach(() => pilote.fermer());

  it('lit une charge de l’ancien format (sans version ni genres récents)', () => {
    const ancienne = {
      entites: { 'compte:pea': JSON.parse(JSON.stringify(compte({ id: 'pea', nom: 'PEA ancien' }))), 'parametre:objectifs.epargne': '{"montant":"1"}' },
      dates: { 'compte:pea': '2026-09-01T00:00:00Z', 'parametre:objectifs.epargne': '2026-09-01T00:00:00Z' },
      supprimes: {},
      appareil: { nom: 'Vieux PC', plateforme: 'bureau' },
    } as Charge;
    const { bilan } = appliquerCharge(pilote, etatVide(), ancienne);
    expect(bilan.echecs).toEqual([]);
    expect(new DepotComptes(pilote).tous()[0].nom).toBe('PEA ancien');
    expect(new DepotParametres(pilote).lire(PARAMETRES.objectif)).toBe('{"montant":"1"}');
  });

  it('ignore un genre inconnu sans erreur et sans date fantôme', () => {
    expect(ecrireEntite(pilote, 'futur:truc', { a: 1 }, x => x)).toBe(false);
    expect(() => supprimerEntite(pilote, 'futur:truc')).not.toThrow();
    const charge = {
      version: 99,
      entites: { 'futur:truc': { a: 1 }, 'prefs:inconnue': 'x', 'prefs:hub': 42 },
      dates: { 'futur:truc': '2026-09-01T00:00:00Z', 'prefs:hub': '2026-09-01T00:00:00Z' },
      supprimes: { 'autre:chose': '2026-09-01T00:00:00Z' },
      appareil: { nom: 'Futur', plateforme: 'site' },
    } as unknown as Charge;
    const { etat, bilan } = appliquerCharge(pilote, etatVide(), charge);
    expect(bilan.echecs).toEqual([]);
    expect(bilan.ajoutes + bilan.modifies + bilan.supprimes).toBe(0);
    expect(etat.dates).toEqual({});
    expect(etat.supprimes).toEqual({});
    expect(new DepotParametres(pilote).lire(CLE_PREFS)).toBeUndefined();
  });

  it('une charge minimale ou mal formée ne fait pas tomber le tour', () => {
    expect(() => appliquerCharge(pilote, etatVide(), { appareil: { nom: 'x', plateforme: 'y' } } as unknown as Charge)).not.toThrow();
  });

  it('n’émet les genres récents que si les autres appareils les comprennent, et déclare sa version', () => {
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    const etat = noterChangementsLocaux(etatVide(), extraireEntites(pilote), '2026-09-26T10:00:00Z');
    const ancien = chargeLocale(pilote, etat, { nom: 'x', plateforme: 'site' }, false);
    expect(Object.keys(ancien.entites).some(k => k.startsWith('prefs:'))).toBe(false);
    expect(ancien.version).toBeUndefined();
    const nouveau = chargeLocale(pilote, etat, { nom: 'x', plateforme: 'site' }, true);
    expect(nouveau.entites['prefs:theme']).toBe('ivoire');
    expect(nouveau.version).toBe(VERSION_CHARGE);
    expect(nouveau.appareil.versionCharge).toBe(VERSION_CHARGE);
  });

  it('n’envoie pas les préférences tant qu’un appareil ancien (sans version) est sur le relais', async () => {
    const relais = relaisMemoire();
    const ancien = sceller(cle, { entites: {}, dates: {}, supprimes: {}, appareil: { nom: 'Vieux', plateforme: 'bureau' } }, 'vieux0001', '2026-09-26T09:00:00Z');
    relais.boite.set('vieux0001', JSON.stringify(ancien));
    relais.index.vieux0001 = { date: '2026-09-26T09:00:00Z' };
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    await synchroniser({ pilote, appareil: 'aaaa1111', moi: { plateforme: 'site' }, maintenant, requete: relais.requete });
    const depose = ouvrirEnveloppe<Charge>(cle, JSON.parse(relais.boite.get('aaaa1111')!));
    expect(Object.keys(depose.entites).filter(k => k.startsWith('prefs:'))).toEqual([]);
    // Le vieil appareil est mis à jour (il déclare la version 2) : les préférences partent alors.
    const recent = sceller(cle, { version: 2, entites: {}, dates: {}, supprimes: {}, appareil: { nom: 'Vieux', plateforme: 'bureau', versionCharge: 2 } }, 'vieux0001', '2026-09-26T11:00:00Z');
    relais.boite.set('vieux0001', JSON.stringify(recent));
    relais.index.vieux0001 = { date: '2026-09-26T11:00:00Z' };
    await synchroniser({ pilote, appareil: 'aaaa1111', moi: { plateforme: 'site' }, maintenant, requete: relais.requete, force: true });
    const apres = ouvrirEnveloppe<Charge>(cle, JSON.parse(relais.boite.get('aaaa1111')!));
    expect(apres.entites['prefs:theme']).toBe('ivoire');
  });
});

describe('file d’envoi, idempotence et économie d’écritures', () => {
  const cle = deriverCleSynchro('commun', JETON, KDF);
  let relais: ReturnType<typeof relaisMemoire>;
  let pilote: PiloteSqlite;
  let t = Date.parse('2026-09-26T10:00:00Z');
  const heure = () => new Date(t);
  const tour = (extra: { force?: boolean } = {}) =>
    synchroniser({ pilote, appareil: 'aaaa1111', moi: { plateforme: 'bureau' }, maintenant: heure, requete: relais.requete, ...extra });

  beforeEach(() => {
    relais = relaisMemoire();
    pilote = appareil('PC', cle);
    new DepotComptes(pilote).enregistrer(compte());
  });
  afterEach(() => pilote.fermer());

  it('un tour sans changement n’émet aucun PUT (ni sur le relais, ni en local)', async () => {
    await tour();
    expect(relais.compteurs.put).toBe(1);
    for (let i = 0; i < 5; i++) {
      t += 130_000;
      const r = await tour();
      expect(r.envoye).toBe(false);
    }
    expect(relais.compteurs.put).toBe(1);
  });

  it('respecte le délai minimal entre deux dépôts et regroupe les changements', async () => {
    await tour();
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    t += 5_000;
    const trop = await tour();
    expect(trop.envoye).toBe(false);
    expect(trop.differeDans).toBeGreaterThan(0);
    expect(lireEtatSynchro(pilote).enAttente?.cles).toEqual(['prefs:theme']);
    new DepotParametres(pilote).ecrire(CLE_PREFS, '{"version":1}');
    t += DELAI_MIN_DEPOTS_MS;
    const ok = await tour();
    expect(ok.envoye).toBe(true);
    expect(relais.compteurs.put).toBe(2); // un seul dépôt pour les deux changements
    expect(lireEtatSynchro(pilote).enAttente).toBeUndefined();
  });

  it('« Synchroniser maintenant » passe outre le délai minimal', async () => {
    await tour();
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    t += 1_000;
    expect((await tour({ force: true })).envoye).toBe(true);
  });

  it('hors ligne : la file garde les clés, la date du premier échec et le nombre d’essais ; rien n’est perdu', async () => {
    await tour();
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    new DepotParametres(pilote).ecrire(PARAMETRES.theme, 'clair');
    relais.couper(true);
    t += 60_000;
    const premier = new Date(t).toISOString();
    await expect(tour()).rejects.toThrow(/injoignable/);
    t += 60_000;
    await expect(tour()).rejects.toThrow(/injoignable/);
    const attente = lireEtatSynchro(pilote).enAttente!;
    expect(attente.cles).toEqual(['prefs:theme']);
    expect(attente.essais).toBe(2);
    expect(attente.premierEchec).toBe(premier);
    expect(attente.motif).toMatch(/injoignable/);
    // dernierEnvoi n'a pas bougé : le prochain tour renverra tout.
    relais.couper(false);
    t += 60_000;
    const retour = await tour();
    expect(retour.envoye).toBe(true);
    expect(lireEtatSynchro(pilote).enAttente).toBeUndefined();
    const depose = ouvrirEnveloppe<Charge>(cle, JSON.parse(relais.boite.get('aaaa1111')!));
    expect(depose.entites['prefs:theme']).toBe('ivoire');
  });

  it('un dépôt refusé par le relais laisse dernierEnvoi intact (idempotent)', async () => {
    await tour();
    const avant = lireEtatSynchro(pilote).dernierEnvoi;
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    const refus = (async (url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? ({ ok: false, status: 500, json: async () => ({}) } as Response) : relais.requete(url, init)) as unknown as typeof fetch;
    t += 60_000;
    await expect(synchroniser({ pilote, appareil: 'aaaa1111', moi: { plateforme: 'bureau' }, maintenant: heure, requete: refus })).rejects.toThrow(/refusé/);
    expect(lireEtatSynchro(pilote).dernierEnvoi).toBe(avant);
    expect(lireEtatSynchro(pilote).enAttente?.essais).toBe(1);
  });

  it('répare l’index du relais s’il a perdu cet appareil (course), au plus une fois par heure', async () => {
    await tour();
    delete relais.index.aaaa1111;
    t += 60_000;
    expect((await tour()).envoye).toBe(true);
    expect(relais.index.aaaa1111).toBeDefined();
    delete relais.index.aaaa1111;
    t += 60_000;
    expect((await tour()).envoye).toBe(false); // déjà réparé il y a moins d'une heure
  });

  it('à la fermeture : envoi keepalive seulement s’il y a du nouveau, une seule fois', async () => {
    await tour();
    const appels: RequestInit[] = [];
    const requete = (async (_u: string, init?: RequestInit) => {
      appels.push(init ?? {});
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const fermer = () => deposerAvantFermeture({ pilote, appareil: 'aaaa1111', moi: { plateforme: 'site' }, maintenant: heure, requete });
    expect(fermer()).toBe(false); // rien de neuf
    new DepotParametres(pilote).ecrire(CLE_THEME, 'ivoire');
    expect(fermer()).toBe(true);
    expect(appels).toHaveLength(1);
    expect(appels[0].keepalive).toBe(true);
    expect(appels[0].method).toBe('PUT');
    expect(fermer()).toBe(false); // déjà parti
    // Le tour normal redépose ensuite (l'issue du keepalive est inconnue) : idempotent.
    t += 60_000;
    expect((await tour()).envoye).toBe(true);
  });
});

describe('isolation entre profils', () => {
  it('la clé de synchro dépend du profil : un ami ne lit jamais le dépôt de l’administrateur', async () => {
    const admin = contexteDerivation('synchro', 'principal');
    const ami = contexteDerivation('synchro', 'lea0000001');
    expect(admin).not.toBe(ami);
    const cleAdmin = deriverCleSynchro('meme-secret', admin + JETON, KDF);
    const cleAmi = deriverCleSynchro('meme-secret', ami + JETON, KDF);
    expect(cleAdmin).not.toBe(cleAmi);

    const relais = relaisMemoire();
    const pAdmin = appareil('PC', cleAdmin);
    const pAmi = appareil('Ami', cleAmi);
    new DepotComptes(pAdmin).enregistrer(compte({ nom: 'Secret admin' }));
    new DepotParametres(pAdmin).ecrire(CLE_THEME, 'terminal');
    new DepotParametres(pAdmin).ecrire(CLE_DEVBLOG, JSON.stringify({ version: 1, vues: ['2026.09.30'] }));
    await synchroniser({ pilote: pAdmin, appareil: 'aaaa1111', moi: { plateforme: 'bureau' }, maintenant, requete: relais.requete });

    const resultat = await synchroniser({ pilote: pAmi, appareil: 'bbbb2222', moi: { plateforme: 'site' }, maintenant, requete: relais.requete });
    expect(resultat.recus).toBe(0);
    expect(resultat.erreurs.length).toBe(1);
    expect(new DepotComptes(pAmi).tous()).toHaveLength(0);
    expect(new DepotParametres(pAmi).lire(CLE_THEME)).toBeUndefined();
    expect(new DepotParametres(pAmi).lire(CLE_DEVBLOG)).toBeUndefined();
    // Et l'inverse : les préférences de l'ami ne sont pas lisibles avec la clé de l'admin.
    new DepotParametres(pAmi).ecrire(CLE_THEME, 'nuit');
    await synchroniser({ pilote: pAmi, appareil: 'bbbb2222', moi: { plateforme: 'site' }, maintenant, requete: relais.requete, force: true });
    expect(() => ouvrirEnveloppe(cleAdmin, JSON.parse(relais.boite.get('bbbb2222')!))).toThrow();
    pAdmin.fermer();
    pAmi.fermer();
  });
});
