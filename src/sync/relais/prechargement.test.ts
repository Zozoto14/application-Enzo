import { achat, compte, titre, versement } from '../../core/testing/fixtures';
import { DepotComptes, DepotParametres, DepotTitres, DepotTransactions, DepotWatchlist, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { deriverCleSynchro, sceller } from './chiffrement';
import {
  CachesSynchro,
  LIMITES_CACHES,
  ajouterEntrant,
  empreinteLiaison,
  entrantVide,
  enveloppeSure,
  lireCacheEntrant,
  nomFichierCache,
  stockageCachesMemoire,
} from './caches';
import { DELAIS_REESSAI_MS, type Minuteries } from './planificateur';
import {
  INTERVALLE_PRECHARGEMENT_MS,
  Prechargeur,
  integrerEntrant,
  lireEtatDemarrage,
  noterEtatDemarrage,
  noterLus,
  prechargerAuDemarrage,
  preparerSortant,
  textesEtatDemarrage,
} from './prechargement';
import { jetonDeProfil } from './portees';
import { ecrireConfigRelais, lireEtatSynchro, synchroniser } from './synchroniser';

const KDF_RAPIDE = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };
const JETON = 'jeton-du-relais-0123456789';
const RELAIS = 'https://relais.exemple.workers.dev';
const LIAISON = { relais: RELAIS, jeton: JETON };
const PC = 'aaaa1111';
const TEL = 'bbbb2222';

/** Relais en mémoire (même contrat que relais/worker.mjs), qui compte les appels et peut être coupé. */
function relaisMemoire() {
  const boite = new Map<string, string>();
  const index: Record<string, { date: string }> = {};
  const appels: string[] = [];
  const etat = { coupe: false };
  const requete = (async (url: string, init: RequestInit = {}) => {
    if (etat.coupe) {
      throw new TypeError('Failed to fetch');
    }
    const chemin = url.slice(RELAIS.length);
    appels.push(`${init.method ?? 'GET'} ${chemin}`);
    const reponse = (corps: unknown, status = 200) =>
      ({ ok: status < 300, status, json: async () => (typeof corps === 'string' ? JSON.parse(corps) : corps) }) as Response;
    if ((init.headers as Record<string, string>).Authorization !== `Bearer ${JETON}`) {
      return reponse({}, 401);
    }
    if (chemin === '/boite') return reponse({ appareils: index });
    const id = chemin.slice('/boite/'.length);
    if (init.method === 'PUT') {
      boite.set(id, String(init.body));
      index[id] = { date: JSON.parse(String(init.body)).date };
      return reponse({ ok: true });
    }
    return boite.has(id) ? reponse(boite.get(id)!) : reponse({}, 404);
  }) as unknown as typeof fetch;
  const puts = (id?: string) => appels.filter(a => a.startsWith('PUT') && (!id || a === `PUT /boite/${id}`)).length;
  return { boite, index, appels, etat, requete, puts };
}

function appareil(nom: string, cle: string): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  ecrireConfigRelais(pilote, { relais: RELAIS, jeton: JETON, cle, nom });
  return pilote;
}

let horloge = Date.parse('2026-09-30T10:00:00Z');
const maintenant = () => new Date((horloge += 60_000));

/** Ce qui ne doit JAMAIS apparaître dans un cache sur le disque. */
function verifierSansClair(fichiers: Map<string, string>, cle: string, interdits: string[]) {
  for (const [nom, texte] of fichiers) {
    expect(nom).toMatch(/^synchro-(entrant|sortant)(-[a-z0-9]{6,16})?$/);
    for (const mot of [cle, JETON, ...interdits]) {
      expect(texte.includes(mot)).toBe(false);
    }
    // Seules des enveloppes chiffrées : nonce hexadécimal, charge en base 64, champs connus.
    const brut = JSON.parse(texte) as { elements: Record<string, { enveloppe: Record<string, unknown> }> | Array<{ enveloppe: Record<string, unknown> }> };
    for (const element of Object.values(brut.elements)) {
      expect(Object.keys(element.enveloppe).sort()).toEqual(['appareil', 'charge', 'date', 'format', 'nonce', 'version']);
      expect(String(element.enveloppe.charge)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  }
}

describe('synchronisation dès le démarrage', () => {
  const cle = deriverCleSynchro('mot de passe commun', JETON, KDF_RAPIDE);
  let relais: ReturnType<typeof relaisMemoire>;
  let pc: PiloteSqlite;
  let tel: PiloteSqlite;
  let disqueTel: ReturnType<typeof stockageCachesMemoire>;
  const tour = (pilote: PiloteSqlite, id: string) =>
    synchroniser({ pilote, appareil: id, moi: { plateforme: id === PC ? 'bureau' : 'ios' }, maintenant, requete: relais.requete });

  beforeEach(() => {
    relais = relaisMemoire();
    pc = appareil('PC', cle);
    tel = appareil('iPhone', cle);
    disqueTel = stockageCachesMemoire();
    new DepotComptes(pc).enregistrer(compte());
    new DepotTitres(pc).enregistrer(titre());
    new DepotTransactions(pc).enregistrer(versement('2026-01-02', 1000));
    new DepotTransactions(pc).enregistrer(achat('2026-01-03', 2, 150));
    new DepotWatchlist(pc).ajouter({ titreId: 'air-liquide', ajouteLe: '2026-09-01' });
  });

  afterEach(() => {
    pc.fermer();
    tel.fermer();
  });

  it('télécharge sans clé, fusionne immédiatement au déverrouillage, sans retélécharger', async () => {
    await tour(pc, PC);
    await tour(tel, TEL); // Le téléphone a déjà une session : il connaît le relais.
    const caches = new CachesSynchro(disqueTel);
    await noterLus({ pilote: tel, appareil: TEL, profil: 'principal', caches });
    // Le PC change pendant que le téléphone est fermé.
    new DepotParametres(pc).ecrire('hub.theme', 'ivoire');
    new DepotComptes(pc).enregistrer({ ...compte(), id: 'compte-neuf', nom: 'Livret nouvelle-valeur' });
    horloge += 60_000;
    await tour(pc, PC);

    // Démarrage verrouillé (nouveau processus : caches relus du disque).
    const auDemarrage = new CachesSynchro(disqueTel);
    const putsAvant = relais.puts();
    const bilan = await prechargerAuDemarrage({ liaison: LIAISON, caches: auDemarrage, requete: relais.requete, maintenant });
    expect(bilan).toMatchObject({ telecharges: 1, envoyes: 0, enAttente: 1, aEnvoyer: 0 });
    expect(relais.puts()).toBe(putsAvant); // Rien à pousser : aucun PUT.
    await auDemarrage.vidage();
    verifierSansClair(disqueTel.fichiers, cle, ['ivoire', 'nouvelle-valeur', 'air-liquide', compte().nom, titre().isin]);

    // Déverrouillage : fusion synchrone, sans réseau.
    relais.etat.coupe = true;
    const integration = integrerEntrant({ pilote: tel, appareil: TEL, profil: 'principal', caches: auDemarrage, maintenant });
    expect(integration.recus).toBe(1);
    expect(new DepotParametres(tel).lire('hub.theme')).toBe('ivoire');
    expect(new DepotComptes(tel).tous().map(c => c.nom)).toContain('Livret nouvelle-valeur');
    expect(Object.keys(auDemarrage.entrant('principal').elements)).toHaveLength(0);
    // Le tour réseau qui suit ne retélécharge pas le dépôt déjà fusionné.
    relais.etat.coupe = false;
    const avant = relais.appels.length;
    const suite = await tour(tel, TEL);
    expect(suite.recus).toBe(0);
    expect(relais.appels.slice(avant).filter(a => a === `GET /boite/${PC}`)).toHaveLength(0);
  });

  it('pousse au démarrage, sans clé, ce qu’une session hors ligne n’a pas pu envoyer — une seule fois', async () => {
    await tour(pc, PC);
    await tour(tel, TEL);
    horloge += 60_000;
    const caches = new CachesSynchro(disqueTel);
    // Hors ligne : un changement, le tour échoue, l'enveloppe est scellée dans `sortant`.
    relais.etat.coupe = true;
    new DepotParametres(tel).ecrire('hub.theme', 'terminal');
    await expect(tour(tel, TEL)).rejects.toThrow();
    await preparerSortant({ pilote: tel, appareil: TEL, profil: 'principal', moi: { plateforme: 'ios' }, caches, maintenant });
    expect(caches.sortant('principal').elements).toHaveLength(1);
    await caches.vidage();
    verifierSansClair(disqueTel.fichiers, cle, ['terminal', compte().nom]);
    // Préparer deux fois la même chose ne réécrit rien.
    const ecrit = JSON.stringify(caches.sortant('principal'));
    await preparerSortant({ pilote: tel, appareil: TEL, profil: 'principal', moi: { plateforme: 'ios' }, caches, maintenant });
    expect(JSON.stringify(caches.sortant('principal'))).toBe(ecrit);

    // Redémarrage, toujours hors ligne : le passage échoue, l'enveloppe reste.
    const redemarre = new CachesSynchro(disqueTel);
    await expect(prechargerAuDemarrage({ liaison: LIAISON, caches: redemarre, requete: relais.requete, maintenant })).rejects.toThrow();
    expect(redemarre.sortant('principal').elements).toHaveLength(1);
    // Retour du réseau : l'envoi part tout seul.
    relais.etat.coupe = false;
    const putsAvant = relais.puts(TEL);
    const bilan = await prechargerAuDemarrage({ liaison: LIAISON, caches: redemarre, requete: relais.requete, maintenant });
    expect(bilan.envoyes).toBe(1);
    expect(relais.puts(TEL)).toBe(putsAvant + 1);
    expect(redemarre.sortant('principal').elements).toHaveLength(0);
    // Le PC le reçoit.
    await tour(pc, PC);
    expect(new DepotParametres(pc).lire('hub.theme')).toBe('terminal');
    // Passage suivant : rien à pousser.
    await prechargerAuDemarrage({ liaison: LIAISON, caches: redemarre, requete: relais.requete, maintenant });
    expect(relais.puts(TEL)).toBe(putsAvant + 1);
    // Au déverrouillage, l'envoi fait sans clé est reporté : le tour ne redépose pas la même chose.
    integrerEntrant({ pilote: tel, appareil: TEL, profil: 'principal', caches: redemarre, maintenant });
    const apres = await tour(tel, TEL);
    expect(apres.envoye).toBe(false);
    expect(relais.puts(TEL)).toBe(putsAvant + 1);
  });

  it('respecte le budget d’écritures : 30 s entre deux dépôts, rien si le relais a déjà plus récent', async () => {
    await tour(tel, TEL);
    const caches = new CachesSynchro(disqueTel);
    new DepotParametres(tel).ecrire('hub.theme', 'sauge');
    // Dépôt réussi il y a 5 s : l'enveloppe attend.
    const t = Date.parse('2026-10-01T08:00:00Z');
    await preparerSortant({ pilote: tel, appareil: TEL, profil: 'principal', moi: { plateforme: 'ios' }, caches, maintenant: () => new Date(t) });
    await caches.ecrireSortant('principal', { ...caches.sortant('principal'), dernierDepotLe: new Date(t - 5_000).toISOString() });
    const putsAvant = relais.puts();
    const bilan = await prechargerAuDemarrage({ liaison: LIAISON, caches, requete: relais.requete, maintenant: () => new Date(t) });
    expect(relais.puts()).toBe(putsAvant);
    expect(bilan.differeDans).toBe(25_000);
    expect(bilan.aEnvoyer).toBe(1);
    // Le relais a déjà un dépôt plus récent de cet appareil (envoi de fermeture) : l'enveloppe est abandonnée.
    relais.index[TEL] = { date: new Date(t + 60_000).toISOString() };
    await prechargerAuDemarrage({ liaison: LIAISON, caches, requete: relais.requete, maintenant: () => new Date(t + 120_000) });
    expect(relais.puts()).toBe(putsAvant);
    expect(caches.sortant('principal').elements).toHaveLength(0);
  });

  it('chaque profil a ses caches ; un relais différent ne lit ni ne pousse ceux d’un autre', async () => {
    expect(nomFichierCache('principal', 'entrant')).toBe('synchro-entrant');
    expect(nomFichierCache('lea0000001', 'sortant')).toBe('synchro-sortant-lea0000001');
    expect(() => nomFichierCache('../coffre', 'entrant')).toThrow();
    await tour(pc, PC);
    const caches = new CachesSynchro(disqueTel);
    await prechargerAuDemarrage({ liaison: LIAISON, caches, requete: relais.requete, maintenant });
    await caches.vidage();
    expect([...disqueTel.fichiers.keys()].sort()).toEqual(['synchro-entrant']);
    // Le profil d'un ami ne voit rien du cache de l'administrateur.
    await caches.charger('lea0000001');
    expect(caches.entrant('lea0000001').elements).toEqual({});
    const ami = integrerEntrant({ pilote: tel, appareil: TEL, profil: 'lea0000001', caches, maintenant });
    expect(ami.recus).toBe(0);
    expect(new DepotComptes(tel).tous()).toHaveLength(0);
    // Le jeton de profil d'un ami n'ouvre jamais le préchargement de l'administrateur.
    const appels = relais.appels.length;
    await expect(
      prechargerAuDemarrage({ liaison: { relais: RELAIS, jeton: jetonDeProfil(JETON, 'lea0000001') }, caches, requete: relais.requete, maintenant }),
    ).rejects.toThrow();
    expect(relais.appels.length).toBe(appels);
    // Relais changé : les enveloppes de l'ancien ne sont pas fusionnées.
    ecrireConfigRelais(tel, { relais: 'https://autre.exemple.workers.dev', jeton: JETON, cle, nom: 'iPhone' });
    const autre = integrerEntrant({ pilote: tel, appareil: TEL, profil: 'principal', caches, maintenant });
    expect(autre.recus).toBe(0);
    expect(new DepotComptes(tel).tous()).toHaveLength(0);
    expect(caches.entrant('principal').elements).toEqual({});
  });

  it('un appareil oublié du relais disparaît du cache entrant', async () => {
    await tour(pc, PC);
    const caches = new CachesSynchro(disqueTel);
    await prechargerAuDemarrage({ liaison: LIAISON, caches, requete: relais.requete, maintenant });
    expect(Object.keys(caches.entrant('principal').elements)).toEqual([PC]);
    delete relais.index[PC];
    await prechargerAuDemarrage({ liaison: LIAISON, caches, requete: relais.requete, maintenant });
    expect(caches.entrant('principal').elements).toEqual({});
  });
});

describe('caches : forme stricte et bornes', () => {
  const cle = 'ab'.repeat(32);
  const enveloppe = (appareil: string, date: string) => sceller(cle, { secret: 'contenu' }, appareil, date);

  it('refuse une enveloppe en clair ou mal formée, retire les champs inconnus', () => {
    const e = enveloppe('aaaa1111', '2026-09-30T10:00:00.000Z');
    expect(enveloppeSure({ ...e, auteur: 'maitre', clair: 'x' })).toEqual(e);
    expect(enveloppeSure({ ...e, charge: JSON.stringify({ secret: 'contenu' }) })).toBeUndefined();
    expect(enveloppeSure({ ...e, nonce: 'zz' })).toBeUndefined();
    expect(enveloppeSure({ ...e, appareil: 'coffre' })).toBeUndefined();
    expect(enveloppeSure({ ...e, charge: 'A'.repeat(LIMITES_CACHES.enveloppe + 4) })).toBeUndefined();
  });

  it('dédupliqué par appareil (la plus récente), nombre borné, fichier altéré nettoyé', () => {
    let cache = entrantVide();
    cache = ajouterEntrant(cache, 'aaaa1111', '2026-09-30T10:00:00.000Z', enveloppe('aaaa1111', '2026-09-30T10:00:00.000Z'), '2026-09-30T10:00:00.000Z');
    const plusAncien = ajouterEntrant(cache, 'aaaa1111', '2026-09-29T10:00:00.000Z', enveloppe('aaaa1111', '2026-09-29T10:00:00.000Z'), '2026-09-30T10:00:00.000Z');
    expect(plusAncien).toBe(cache);
    for (let i = 0; i < 40; i++) {
      const id = `cc${String(i).padStart(6, '0')}`;
      cache = ajouterEntrant(cache, id, '2026-09-30T10:00:00.000Z', enveloppe(id, '2026-09-30T10:00:00.000Z'), '2026-09-30T10:00:00.000Z');
    }
    expect(Object.keys(cache.elements)).toHaveLength(LIMITES_CACHES.entrants);
    const altere = JSON.parse(JSON.stringify(cache));
    altere.elements.aaaa1111.enveloppe.charge = '{"en clair": true}';
    expect(lireCacheEntrant(JSON.stringify(altere)).elements.aaaa1111).toBeUndefined();
    expect(lireCacheEntrant('pas du json')).toEqual(entrantVide());
    expect(empreinteLiaison(LIAISON)).toMatch(/^[0-9a-f]{32}$/);
    expect(empreinteLiaison(LIAISON).includes(JETON)).toBe(false);
  });
});

describe('lanceur au démarrage : réessais et suspension', () => {
  function fausseMinuterie() {
    const attentes: number[] = [];
    let suivante: (() => void) | undefined;
    const minuteries: Minuteries = {
      setTimeout: (action, ms) => {
        attentes.push(ms);
        suivante = action;
        return attentes.length;
      },
      clearTimeout: () => {
        suivante = undefined;
      },
      setInterval: () => 0,
      clearInterval: () => undefined,
    };
    return { minuteries, attentes, declencher: () => suivante?.() };
  }
  const attendre = () => new Promise<void>(ok => setTimeout(ok, 0));

  it('réessaie à 5 s, 30 s, 2 min puis 10 min ; reprend tout de suite au retour du réseau', async () => {
    const relais = relaisMemoire();
    relais.etat.coupe = true;
    const m = fausseMinuterie();
    const bilans: boolean[] = [];
    const p = new Prechargeur({
      liaison: async () => LIAISON,
      caches: new CachesSynchro(stockageCachesMemoire()),
      requete: relais.requete,
      minuteries: m.minuteries,
      surBilan: b => bilans.push(b.reussi),
    });
    p.demarrer();
    for (let i = 0; i < 5; i++) {
      await attendre();
      await attendre();
      m.declencher();
    }
    await attendre();
    await attendre();
    expect(m.attentes.slice(0, 5)).toEqual([...DELAIS_REESSAI_MS, DELAIS_REESSAI_MS[DELAIS_REESSAI_MS.length - 1]]);
    relais.etat.coupe = false;
    p.enLigne();
    await attendre();
    await attendre();
    await attendre();
    expect(bilans[bilans.length - 1]).toBe(true);
    expect(m.attentes[m.attentes.length - 1]).toBe(INTERVALLE_PRECHARGEMENT_MS);
    // Session déverrouillée : plus rien n'est planifié.
    p.suspendre();
    const nombre = m.attentes.length;
    p.enLigne();
    await attendre();
    expect(m.attentes.length).toBe(nombre);
    p.arreter();
  });

  it('ne fait rien sans liaison d’administrateur', async () => {
    const relais = relaisMemoire();
    const m = fausseMinuterie();
    const p = new Prechargeur({ liaison: async () => ({ relais: RELAIS, jeton: jetonDeProfil(JETON, 'lea0000001') }), requete: relais.requete, minuteries: m.minuteries });
    await p.passage();
    p.demarrer();
    await attendre();
    expect(relais.appels).toEqual([]);
    p.arreter();
  });
});

describe('état affiché avant déverrouillage', () => {
  it('ne contient que des compteurs et une date', () => {
    const memoire = new Map<string, string>();
    const m = { getItem: (c: string) => memoire.get(c) ?? null, setItem: (c: string, v: string) => void memoire.set(c, v) };
    noterEtatDemarrage({ le: '2026-10-01T10:00:00.000Z', recus: 1, aEnvoyer: 2 }, m);
    expect(Object.keys(JSON.parse([...memoire.values()][0])).sort()).toEqual(['aEnvoyer', 'le', 'recus']);
    expect(lireEtatDemarrage(m)).toEqual({ le: '2026-10-01T10:00:00.000Z', recus: 1, aEnvoyer: 2 });
    expect(textesEtatDemarrage(lireEtatDemarrage(m), Date.parse('2026-10-01T10:07:30Z'))).toEqual([
      '1 mise à jour reçue, en attente de déverrouillage',
      '2 éléments prêts à envoyer',
      'Synchronisé il y a 7 min',
    ]);
    expect(textesEtatDemarrage({ recus: 3, aEnvoyer: 1 })).toEqual(['3 mises à jour reçues, en attente de déverrouillage', '1 élément prêt à envoyer']);
    expect(textesEtatDemarrage({ recus: 0, aEnvoyer: 0 })).toEqual([]);
  });
});

// L'état chiffré n'est jamais recopié tel quel dans un cache.
it('lireEtatSynchro reste dans la base chiffrée', () => {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  expect(lireEtatSynchro(pilote).lus).toEqual({});
  expect(new DepotParametres(pilote).lire(PARAMETRES.etatSynchro)).toBeUndefined();
  pilote.fermer();
});
