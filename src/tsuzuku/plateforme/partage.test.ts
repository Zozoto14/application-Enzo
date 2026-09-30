/**
 * Partage des sources par le relais : publication scellée par compte, clé de
 * réception, retrait, isolation, aucune clé d'API ni autre compte exposés.
 * Faux relais en mémoire qui applique les portées (un compte ne lit que SON espace).
 */

import { aleatoireDeterministe } from '../../securite/aleatoire';
import type { Espaces } from '../../sync/relais/espaces';
import { importerSources } from '../moteur/sources';
import { lireRecues } from '../app/gestion';
import { CLES, type BasePrefs } from './stockage';
import { OBJET_CLE, OBJET_SOURCES, lirePaire, ouvrirPublication, paireDe, publierSourcesPartagees, recevoirSourcesPartagees, scellerPublication, type EtatPublications, type SuiviReception } from './partage';

type Objet = { date: string; charge: string };

/** Relais en mémoire ; `pour(id)` rend les espaces vus avec le jeton de ce compte (403 ailleurs). */
function fauxRelais() {
  const boites = new Map<string, Map<string, Objet>>();
  const boite = (id: string) => boites.get(id) ?? boites.set(id, new Map()).get(id)!;
  let ecritures = 0;
  const espaces = (compte?: string): Espaces => {
    const verifier = (id: string) => {
      if (compte && compte !== id) throw Object.assign(new Error('403'), { statut: 403 });
    };
    return {
      async lister(id) {
        verifier(id);
        return Object.fromEntries([...boite(id)].map(([n, o]) => [n, { date: o.date, taille: o.charge.length }]));
      },
      async lire(id, nom) {
        verifier(id);
        return boite(id).get(nom);
      },
      async deposer(id, nom, charge, date) {
        verifier(id);
        if (compte && nom === OBJET_SOURCES) throw Object.assign(new Error('403 lecture seule'), { statut: 403 });
        ecritures++;
        boite(id).set(nom, { date, charge });
      },
      async supprimer(id, nom) {
        verifier(id);
        if (compte && nom === OBJET_SOURCES) throw Object.assign(new Error('403 lecture seule'), { statut: 403 });
        ecritures++;
        boite(id).delete(nom);
      },
    };
  };
  return { maitre: espaces(), pour: (id: string) => espaces(id), boite, ecritures: () => ecritures };
}

const baseMemoire = (initial: Record<string, string> = {}): BasePrefs & { contenu: Map<string, string> } => {
  const contenu = new Map(Object.entries(initial));
  return { contenu, lire: cle => contenu.get(cle), ecrire: (cle, valeur) => void contenu.set(cle, valeur) };
};

const SOURCES = importerSources([
  { id: 'src-a', name: 'Médiathèque A', baseUrl: 'https://mediatheque-exemple.fr', enabled: true, search: { path: '/r?q={query}', item: 'li', title: 'a', link: 'a' } },
  { id: 'src-b', name: 'Films libres', baseUrl: 'https://films-exemple.fr', enabled: true, movies: { search: { path: '/f?q={query}', item: '.film', title: 'h3' }, player: { iframe: 'iframe' } } },
]).sources;
const A = 'amiaaa01';
const B = 'amibbb02';
const COMPTES = [
  { id: A, apps: ['tsuzuku'], actif: true },
  { id: B, apps: ['tsuzuku'], actif: true },
];

let horloge = 0;
const date = () => new Date(Date.UTC(2026, 8, 30, 10, 0, horloge++)).toISOString();

describe('partage des sources par le relais', () => {
  const relais = fauxRelais();
  // Base du Fondateur (compte historique) : ses sources, une clé TMDB, les partages.
  const baseFondateur = baseMemoire({
    [CLES.sources]: JSON.stringify(SOURCES),
    [CLES.avance]: JSON.stringify({ cleTmdb: 'CLE-TMDB-SECRETE-123456' }),
    [CLES.partages]: JSON.stringify({ 'src-a': { mode: 'selection', comptes: [A] } }),
  });
  const baseA = baseMemoire();
  const baseB = baseMemoire();
  let etat: EtatPublications = {};
  const suivis: Record<string, SuiviReception> = {};

  const tourFondateur = async () => {
    const r = await publierSourcesPartagees({ espaces: relais.maitre, comptes: COMPTES, base: baseFondateur, etat, maintenant: date(), alea: aleatoireDeterministe(7) });
    etat = r.etat;
    return r;
  };
  const tourAmi = async (id: string, base: BasePrefs) => {
    const espaces = relais.pour(id);
    const r = await recevoirSourcesPartagees({ espaces, id, base, objets: await espaces.lister(id), suivi: suivis[id] ?? {}, maintenant: date(), alea: aleatoireDeterministe(id === A ? 11 : 13) });
    suivis[id] = r.suivi;
    return r;
  };

  it('avant que l’ami ait publié sa clé : rien n’est déposé, il est « en attente »', async () => {
    const r = await tourFondateur();
    expect(r.enAttente).toEqual([A]);
    expect(relais.boite(A).has(OBJET_SOURCES)).toBe(false);
  });

  it('l’ami publie sa clé publique ; la clé privée reste dans SA base', async () => {
    await tourAmi(A, baseA);
    await tourAmi(B, baseB);
    const paire = lirePaire(baseA.contenu.get(CLES.reception))!;
    expect(JSON.parse(relais.boite(A).get(OBJET_CLE)!.charge)).toEqual({ v: 1, cle: paire.publique });
    expect(relais.boite(A).get(OBJET_CLE)!.charge).not.toContain(paire.privee);
  });

  it('le Fondateur publie : A reçoit sa source, B rien ; le contenu est scellé, sans clé d’API ni autre compte', async () => {
    const r = await tourFondateur();
    expect(r.enAttente).toEqual([]);
    const brut = relais.boite(A).get(OBJET_SOURCES)!.charge;
    expect(brut).not.toMatch(/Médiathèque|mediatheque-exemple/); // scellé
    expect(relais.boite(B).has(OBJET_SOURCES)).toBe(false); // B : jamais rien publié, rien à retirer
    // Ce que contient le dépôt une fois ouvert : SES sources, rien d'autre.
    const ouvert = ouvrirPublication(lirePaire(baseA.contenu.get(CLES.reception))!, A, brut);
    expect(ouvert.sources.map(s => s.id)).toEqual(['src-a']);
    expect(JSON.stringify(ouvert)).not.toMatch(/CLE-TMDB|amibbb02|principal|selection/);

    expect((await tourAmi(A, baseA)).change).toBe(true);
    expect(lireRecues(baseA.contenu.get(CLES.sourcesRecues)).sources.map(s => s.name)).toEqual(['Médiathèque A']);
    expect((await tourAmi(B, baseB)).change).toBe(false);
    expect(baseB.contenu.get(CLES.sourcesRecues)).toBeUndefined();
  });

  it('isolation : B ne peut lire ni l’espace ni la publication de A ; A ne peut pas réécrire ses sources', async () => {
    await expect(relais.pour(B).lire(A, OBJET_SOURCES)).rejects.toMatchObject({ statut: 403 });
    await expect(relais.pour(A).deposer(A, OBJET_SOURCES, '{}', date())).rejects.toMatchObject({ statut: 403 });
    // Même avec le dépôt en main, la clé de B n'ouvre pas celui de A.
    const pairB = lirePaire(baseB.contenu.get(CLES.reception))!;
    expect(() => ouvrirPublication(pairB, A, relais.boite(A).get(OBJET_SOURCES)!.charge)).toThrow();
    expect(() => ouvrirPublication(pairB, B, relais.boite(A).get(OBJET_SOURCES)!.charge)).toThrow();
  });

  it('un tour sans changement n’écrit rien', async () => {
    const avant = relais.ecritures();
    expect((await tourFondateur()).depots).toBe(0);
    expect((await tourAmi(A, baseA)).depots).toBe(0);
    expect(relais.ecritures()).toBe(avant);
  });

  it('partage étendu à « tous » : B la reçoit aussi', async () => {
    baseFondateur.ecrire(CLES.partages, JSON.stringify({ 'src-a': { mode: 'tous', comptes: [] } }));
    await tourFondateur();
    await tourAmi(B, baseB);
    expect(lireRecues(baseB.contenu.get(CLES.sourcesRecues)).sources.map(s => s.id)).toEqual(['src-a']);
  });

  it('retrait du partage : propagé (liste vide), la copie de l’ami se vide', async () => {
    baseFondateur.ecrire(CLES.partages, JSON.stringify({ 'src-a': { mode: 'selection', comptes: [B] } }));
    const r = await tourFondateur();
    expect(r.depots).toBe(1); // A reçoit une liste vide ; B garde la même.
    expect((await tourAmi(A, baseA)).change).toBe(true);
    expect(lireRecues(baseA.contenu.get(CLES.sourcesRecues)).sources).toEqual([]);
    expect(lireRecues(baseB.contenu.get(CLES.sourcesRecues)).sources.map(s => s.id)).toEqual(['src-a']);
  });

  it('objet effacé (compte sans clé, ou vidé) : la copie se vide aussi', async () => {
    await relais.maitre.supprimer(B, OBJET_SOURCES);
    expect((await tourAmi(B, baseB)).change).toBe(true);
    expect(lireRecues(baseB.contenu.get(CLES.sourcesRecues)).sources).toEqual([]);
  });

  it('nouvelle paire de l’ami (autre appareil) : la clé est republiée et le Fondateur rescelle', async () => {
    baseFondateur.ecrire(CLES.partages, JSON.stringify({ 'src-b': { mode: 'tous', comptes: [] } }));
    const baseA2 = baseMemoire();
    paireDe(baseA2, aleatoireDeterministe(99));
    delete suivis[A];
    await tourAmi(A, baseA2);
    await tourFondateur();
    await tourAmi(A, baseA2);
    expect(lireRecues(baseA2.contenu.get(CLES.sourcesRecues)).sources.map(s => s.id)).toEqual(['src-b']);
  });

  it('un dépôt scellé pour un autre compte (même clé) ne s’ouvre pas : l’usage lie l’identifiant', () => {
    const paire = lirePaire(baseA.contenu.get(CLES.reception))!;
    const depot = scellerPublication(paire.publique, B, SOURCES, date(), aleatoireDeterministe(3));
    expect(() => ouvrirPublication(paire, A, depot)).toThrow();
    expect(ouvrirPublication(paire, B, depot).sources).toHaveLength(2);
  });
});
