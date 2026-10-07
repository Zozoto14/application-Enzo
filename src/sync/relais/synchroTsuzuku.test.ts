/**
 * Sources Tsuzuku entre les appareils d'un même compte (bogue : « les sources
 * ne sont pas liées entre les appareils quand c'est le même compte »).
 * Avant le correctif, aucune entité `tsuzuku:*` n'existait : une source
 * ajoutée sur le PC n'arrivait jamais sur le site.
 */

import { DepotParametres, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { CLES } from '../../tsuzuku/plateforme/stockage';
import { lireListeSources, lirePartages, lireTests, lireAvances } from '../../tsuzuku/app/gestion';
import { deriverCleSynchro } from './chiffrement';
import { ecrireEntite, empreinte, extraireEntites, PARAMETRES_A_SYNCHRONISER } from './entites';
import { etatPastilleTsuzuku } from './entitesTsuzuku';
import { ecrireConfigRelais, synchroniser } from './synchroniser';
import { ecritureSynchronisee } from '../../db/ecoute';

const JETON = 'jeton-du-relais-0123456789';
const RELAIS = 'https://relais.exemple.workers.dev';
const KDF = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };

function relaisMemoire() {
  const boite = new Map<string, string>();
  const index: Record<string, { date: string }> = {};
  const requete = (async (url: string, init: RequestInit = {}) => {
    const chemin = url.slice(RELAIS.length);
    const reponse = (corps: unknown, status = 200) => ({ ok: status < 300, status, json: async () => (typeof corps === 'string' ? JSON.parse(corps) : corps) }) as Response;
    if (chemin === '/boite') return reponse({ appareils: index });
    const id = chemin.slice('/boite/'.length);
    if (init.method === 'PUT') {
      boite.set(id, String(init.body));
      index[id] = { date: JSON.parse(String(init.body)).date };
      return reponse({ ok: true });
    }
    return boite.has(id) ? reponse(boite.get(id)!) : reponse({}, 404);
  }) as unknown as typeof fetch;
  return { boite, requete };
}

const source = (id: string, nom: string, enabled = true) => ({
  id,
  name: nom,
  enabled,
  baseUrl: `https://${id}.mediatheque-exemple.fr`,
  language: 'vostfr',
  search: { path: '/recherche?q={query}', item: 'li.carte', title: 'a', link: 'a' },
  episodes: { item: 'li.ep', number: '.num', link: 'a' },
  player: { iframe: 'iframe' },
  createdAt: '2026-10-01T10:00:00.000Z',
});

let horloge = Date.parse('2026-10-07T10:00:00Z');
const maintenant = () => new Date((horloge += 60_000));

describe('sources Tsuzuku entre appareils du même compte', () => {
  const cle = deriverCleSynchro('commun', JETON, KDF);
  let relais: ReturnType<typeof relaisMemoire>;
  let pc: PiloteSqlite;
  let site: PiloteSqlite;
  const p = (pilote: PiloteSqlite) => new DepotParametres(pilote);
  const ecrireSources = (pilote: PiloteSqlite, liste: unknown[]) => p(pilote).ecrire(CLES.sources, JSON.stringify(liste));
  const sourcesDe = (pilote: PiloteSqlite) => lireListeSources(p(pilote).lire(CLES.sources));
  const tour = (pilote: PiloteSqlite, id: string) => synchroniser({ pilote, appareil: id, moi: { plateforme: id === 'aaaa1111' ? 'bureau' : 'site' }, maintenant, requete: relais.requete, force: true });
  const appareil = (nom: string) => {
    const pilote = ouvrirBaseNode();
    migrer(pilote);
    ecrireConfigRelais(pilote, { relais: RELAIS, jeton: JETON, cle, nom });
    return pilote;
  };

  beforeEach(async () => {
    relais = relaisMemoire();
    pc = appareil('PC');
    site = appareil('Site');
    // Les deux appareils se connaissent (version 2 déclarée) avant tout changement.
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    await tour(pc, 'aaaa1111');
  });
  afterEach(() => {
    pc.fermer();
    site.fermer();
  });

  it('une source ajoutée sur le PC (liste, activée, partage, dernier test, clé d’API) arrive sur le site', async () => {
    ecrireSources(pc, [source('s1', 'Médiathèque')]);
    p(pc).ecrire(CLES.partages, JSON.stringify({ s1: { mode: 'tous', comptes: [] } }));
    p(pc).ecrire(CLES.testsSources, JSON.stringify({ s1: { ok: true, date: '2026-10-07T09:00:00Z', detail: 'OK' } }));
    p(pc).ecrire(CLES.avance, JSON.stringify({ cleTmdb: 'cle-tmdb-secrete-123', delaiS: 20, tailleMaxMo: 8 }));
    await tour(pc, 'aaaa1111');
    // Rien en clair sur le relais : ni adresse de source, ni clé d'API.
    const depose = relais.boite.get('aaaa1111')!;
    expect(depose).not.toContain('cle-tmdb-secrete-123');
    expect(depose).not.toContain('mediatheque-exemple');
    await tour(site, 'bbbb2222');
    expect(sourcesDe(site).map(s => [s.id, s.name, s.enabled])).toEqual([['s1', 'Médiathèque', true]]);
    expect(lirePartages(p(site).lire(CLES.partages))).toEqual({ s1: { mode: 'tous', comptes: [] } });
    expect(lireTests(p(site).lire(CLES.testsSources)).s1.ok).toBe(true);
    expect(lireAvances(p(site).lire(CLES.avance))).toMatchObject({ cleTmdb: 'cle-tmdb-secrete-123', delaiS: 20 });
  });

  it('deux appareils modifient deux sources différentes : aucune perte ; la désactivation voyage', async () => {
    ecrireSources(pc, [source('s1', 'Une')]);
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    // Le PC ajoute s2, le site désactive s1, sans s'être revus.
    ecrireSources(pc, [source('s1', 'Une'), source('s2', 'Deux')]);
    ecrireSources(site, [source('s1', 'Une', false)]);
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    await tour(pc, 'aaaa1111');
    for (const pilote of [pc, site]) {
      expect(sourcesDe(pilote).map(s => [s.id, s.enabled])).toEqual([['s1', false], ['s2', true]]);
    }
  });

  it('une suppression se propage (pierre tombale) et la source ne renaît pas', async () => {
    ecrireSources(pc, [source('s1', 'Une'), source('s2', 'Deux')]);
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    expect(sourcesDe(site)).toHaveLength(2);
    ecrireSources(site, [source('s2', 'Deux')]);
    await tour(site, 'bbbb2222');
    await tour(pc, 'aaaa1111');
    await tour(site, 'bbbb2222');
    expect(sourcesDe(pc).map(s => s.id)).toEqual(['s2']);
    expect(sourcesDe(site).map(s => s.id)).toEqual(['s2']);
  });

  it('une source reçue est revalidée : une adresse non publique est refusée', async () => {
    ecrireSources(pc, [source('s1', 'Une')]);
    await tour(pc, 'aaaa1111');
    // Falsification simulée côté réception : l'écriture directe d'une entité invalide ne passe pas.
    expect(ecrireEntite(site, 'tsuzuku:source:x', { ...source('x', 'X'), baseUrl: 'http://192.168.1.10' }, t => t)).toBe(false);
    expect(sourcesDe(site)).toEqual([]);
  });

  it('pastille : « en attente » après une modification, « synchronisé » après le tour ; un tour part après l’écriture', async () => {
    const lire = (pilote: PiloteSqlite) => (k: string) => p(pilote).lire(k);
    const cles = { relais: PARAMETRES.relaisSynchro, etat: PARAMETRES.etatSynchro };
    ecrireSources(pc, [source('s1', 'Une')]);
    expect(etatPastilleTsuzuku(lire(pc), cles, empreinte).etat).toBe('en-attente');
    await tour(pc, 'aaaa1111');
    expect(etatPastilleTsuzuku(lire(pc), cles, empreinte).etat).toBe('synchronise');
    for (const k of [CLES.sources, CLES.partages, CLES.testsSources, CLES.avance]) {
      expect(PARAMETRES_A_SYNCHRONISER).toContain(k);
      expect(ecritureSynchronisee('INSERT OR REPLACE INTO parametres (cle, valeur) VALUES (?, ?)', [k, 'x'])).toBe(true);
    }
    // Les données propres à l'appareil (bibliothèque, mode, réglages de confort) ne partent pas par ce chemin.
    expect(Object.keys(extraireEntites(pc)).filter(k => k.startsWith('tsuzuku:')).sort()).toEqual(['tsuzuku:ordre', 'tsuzuku:source:s1']);
  });
});
