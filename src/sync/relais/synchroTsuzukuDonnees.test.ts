/**
 * Tout Tsuzuku dans le coffre serveur du compte (demande : « synchroniser et enregistrer tout ce qu'il
 * y a sur Tsuzuku sur le serveur : bibliothèque, sources, etc. »). Tests contre le VRAI relais en
 * mémoire : bibliothèque fusionnée titre par titre, progression au maximum (recul volontaire compris),
 * historique réuni, sources, langue par série, fiabilité des lecteurs, position de lecture ; migration
 * des données locales de chaque appareil et de l'ancien bloc `kv:tsuzuku.bibliotheque`, sans perte ni
 * doublon ni aller-retour sans fin. Fixtures *-exemple.fr.
 */
import { DepotParametres } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { lireListeSources } from '../../tsuzuku/app/gestion';
import { lirePositions } from '../../tsuzuku/app/positions';
import { ajouterOuMettreAJour, DepotBibliotheque, enregistrerProgression, modifierEntree, supprimerEntree, trouver, type Bibliotheque } from '../../tsuzuku/moteur/bibliotheque';
import { fusionnerEntrees } from '../../tsuzuku/moteur/fusionBibliotheque';
import { CLES, stockageDepuisBase } from '../../tsuzuku/plateforme/stockage';
import { deriverCleSynchro } from './chiffrement';
import { historiqueServeur, idEnregistrement, oublierCapacites, scellerEnregistrement, synchroniserServeur } from './coffreServeur';
import { extraireEntites } from './entites';
import { lireEtatSynchro } from './synchroniser';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from './__fixtures__/relaisV9';

const KDF_RAPIDE = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };
const CLE = deriverCleSynchro('cle-du-compte-tsuzuku', 'x', KDF_RAPIDE);
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };

let horloge = Date.parse('2026-10-21T10:00:00Z');
const maintenant = () => new Date((horloge += 60_000));
const horlogeMoteur = { maintenant: () => (horloge += 1_000) };

function appareil(): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  return pilote;
}
const base = (pilote: PiloteSqlite) => {
  const p = new DepotParametres(pilote);
  return { lire: (c: string) => p.lire(c), ecrire: (c: string, v: string) => p.ecrire(c, v), supprimer: (c: string) => p.supprimer(c) };
};
const depot = (pilote: PiloteSqlite) => new DepotBibliotheque(stockageDepuisBase(base(pilote)), CLES.bibliotheque, horlogeMoteur);
const biblio = (pilote: PiloteSqlite): Promise<Bibliotheque> => depot(pilote).lire();
const tour = (relais: RelaisV9, pilote: PiloteSqlite) => synchroniserServeur({ pilote, liaison: MAITRE, cle: CLE, compte: 'principal', maintenant, requete: relais.requete });

const ajouter = (pilote: PiloteSqlite, id: string, titre: string, statut: 'a_voir' | 'en_cours' = 'a_voir') =>
  depot(pilote).modifier(db => ajouterOuMettreAJour(db, 'anime', { id, title: titre, image: `https://affiches-exemple.fr/${id}.jpg`, totalEpisodes: 12, status: statut }));
const voir = (pilote: PiloteSqlite, id: string, episode: number) => depot(pilote).modifier(db => enregistrerProgression(db, 'anime', id, episode));

const source = (id: string) => ({
  id,
  name: `Médiathèque ${id}`,
  enabled: true,
  baseUrl: `https://${id}.mediatheque-exemple.fr`,
  language: 'vostfr',
  search: { path: '/recherche?q={query}', item: 'li.carte', title: 'a', link: 'a' },
  episodes: { item: 'li.ep', number: '.num', link: 'a' },
  player: { iframe: 'iframe' },
  createdAt: '2026-10-01T10:00:00.000Z',
});

/** Fait tourner les appareils jusqu'à ce qu'aucun n'envoie plus rien (convergence), et rend le nombre de tours. */
async function converger(relais: RelaisV9, appareils: PiloteSqlite[], max = 6): Promise<number> {
  for (let n = 1; n <= max; n++) {
    let envoyes = 0;
    for (const a of appareils) envoyes += (await tour(relais, a)).envoyes;
    if (envoyes === 0) return n;
  }
  throw new Error('pas de convergence : aller-retour sans fin');
}

describe('Tsuzuku : tout dans le coffre serveur du compte', () => {
  let relais: RelaisV9;
  beforeEach(() => {
    relais = relaisV9();
    oublierCapacites();
  });

  it('bibliothèque, épisodes vus, historique, sources : un navigateur neuf retrouve tout, chiffré sur le serveur', async () => {
    const pc = appareil();
    await ajouter(pc, '52991', 'Frieren');
    await voir(pc, '52991', 3);
    await depot(pc).modifier(db => modifierEntree(db, 'anime', '52991', { favorite: true, rating: 9, comment: 'Superbe' }));
    base(pc).ecrire(CLES.sources, JSON.stringify([source('alpha')]));
    base(pc).ecrire(CLES.languesSeries, JSON.stringify({ 'anime:52991': 'vf' }));
    base(pc).ecrire(CLES.positions, JSON.stringify({ 'anime:52991': { ep: 4, s: 754, a: horloge } }));
    base(pc).ecrire(CLES.fiabiliteLecteurs, JSON.stringify({ alpha: { 'lecteur-exemple.fr': { ok: 3, ko: 0, a: horloge } } }));
    await tour(relais, pc);

    const brut = (await (relais.env.COFFRES as { lire(p: string, d: number, l: number): Promise<{ enregistrements: Array<{ valeur: string }> }> }).lire('principal', 0, 10_000)).enregistrements.map(e => e.valeur).join('\n');
    for (const clair of ['Frieren', 'Superbe', 'mediatheque-exemple', 'tsuzuku', '52991']) expect(brut).not.toContain(clair);

    const navigateur = appareil();
    await tour(relais, navigateur);
    const recue = await biblio(navigateur);
    const frieren = trouver(recue, 'anime', '52991')!;
    expect(frieren).toMatchObject({ title: 'Frieren', currentEpisode: 3, status: 'en_cours', favorite: true, rating: 9, comment: 'Superbe' });
    expect(recue.history.map(h => h.episode)).toEqual([3]);
    expect(lireListeSources(base(navigateur).lire(CLES.sources)).map(s => s.id)).toEqual(['alpha']);
    expect(JSON.parse(base(navigateur).lire(CLES.languesSeries)!)).toEqual({ 'anime:52991': 'vf' });
    expect(lirePositions(base(navigateur).lire(CLES.positions))['anime:52991']).toMatchObject({ ep: 4, s: 754 });
    expect(JSON.parse(base(navigateur).lire(CLES.fiabiliteLecteurs)!).alpha['lecteur-exemple.fr'].ok).toBe(3);
    // Plus rien ne bouge ensuite (pas d'aller-retour).
    expect(await converger(relais, [pc, navigateur])).toBe(1);
  });

  it('deux appareils hors ligne : bibliothèques réunies titre par titre, progression au maximum, historique sans doublon', async () => {
    const pc = appareil();
    const tel = appareil();
    await ajouter(pc, '1', 'Titre commun');
    await tour(relais, pc);
    await tour(relais, tel);
    // Hors ligne chacun de son côté.
    await ajouter(pc, '2', 'Ajouté sur le PC');
    await voir(pc, '1', 7);
    await ajouter(tel, '3', 'Ajouté sur le téléphone');
    await voir(tel, '1', 4); // plus RÉCENT, mais moins loin : l'épisode 7 vu sur le PC n'est pas perdu
    await depot(tel).modifier(db => modifierEntree(db, 'anime', '1', { favorite: true }));

    await converger(relais, [pc, tel]);
    for (const a of [pc, tel]) {
      const db = await biblio(a);
      expect(db.anime.map(e => e.id).sort()).toEqual(['1', '2', '3']);
      expect(trouver(db, 'anime', '1')).toMatchObject({ currentEpisode: 7, favorite: true });
      // Historique : les deux épisodes, une fois chacun.
      expect(db.history.filter(h => h.animeId === '1').map(h => h.episode).sort()).toEqual([4, 7]);
    }
    expect(extraireEntites(pc)).toEqual(extraireEntites(tel));
  });

  it('progression : un recul volontaire (épisode corrigé à la baisse) l’emporte sur l’ancienne progression', async () => {
    const pc = appareil();
    const tel = appareil();
    await ajouter(pc, '1', 'Titre');
    await voir(pc, '1', 9);
    await converger(relais, [pc, tel]);
    await depot(tel).modifier(db => modifierEntree(db, 'anime', '1', { currentEpisode: 2 }));
    await converger(relais, [tel, pc]);
    for (const a of [pc, tel]) expect(trouver(await biblio(a), 'anime', '1')?.currentEpisode).toBe(2);
    // Puis on avance de nouveau : le maximum reprend.
    await voir(pc, '1', 3);
    await converger(relais, [pc, tel]);
    expect(trouver(await biblio(tel), 'anime', '1')?.currentEpisode).toBe(3);
  });

  it('fusion déterministe : même résultat dans les deux sens, et refusionner ne change rien', async () => {
    const pc = appareil();
    await ajouter(pc, '1', 'Titre');
    const a = trouver(await biblio(pc), 'anime', '1')!;
    await voir(pc, '1', 5);
    const b = { ...trouver(await biblio(pc), 'anime', '1')!, comment: 'plus ancien', _sync: { fiche: '2026-01-01T00:00:00.000Z', progression: '2026-01-01T00:00:00.000Z', generation: 0 } };
    const ab = fusionnerEntrees(a, b);
    expect(ab).toEqual(fusionnerEntrees(b, a));
    expect(fusionnerEntrees(ab, a)).toEqual(ab);
    expect(fusionnerEntrees(ab, b)).toEqual(ab);
    expect(ab.currentEpisode).toBe(5);
  });

  it('suppression d’un titre : il disparaît partout et ne renaît pas', async () => {
    const pc = appareil();
    const tel = appareil();
    await ajouter(pc, '1', 'À garder');
    await ajouter(pc, '2', 'À supprimer');
    await converger(relais, [pc, tel]);
    await depot(tel).modifier(db => supprimerEntree(db, 'anime', '2'));
    await converger(relais, [tel, pc]);
    for (const a of [pc, tel]) expect((await biblio(a)).anime.map(e => e.id)).toEqual(['1']);
  });

  it('sources et choix : deux appareils ajoutent chacun une source, les deux restent', async () => {
    const pc = appareil();
    const site = appareil();
    await converger(relais, [pc, site]);
    base(pc).ecrire(CLES.sources, JSON.stringify([source('alpha')]));
    base(site).ecrire(CLES.sources, JSON.stringify([source('beta')]));
    base(site).ecrire(CLES.choixSources, JSON.stringify({ partagee: false }));
    await converger(relais, [pc, site]);
    for (const a of [pc, site]) {
      expect(lireListeSources(base(a).lire(CLES.sources)).map(s => s.id).sort()).toEqual(['alpha', 'beta']);
      expect(JSON.parse(base(a).lire(CLES.choixSources)!)).toEqual({ partagee: false });
    }
  });

  it('migration : les données locales de chaque appareil (anciennes, sans estampille) sont réunies au premier lancement, sans perte ni doublon', async () => {
    // Deux appareils d'avant cette version : bibliothèques écrites telles quelles, jamais synchronisées titre par titre.
    const ancienne = (titres: Array<{ id: string; title: string; currentEpisode: number; favorite?: boolean }>, historique: number[]) =>
      JSON.stringify({
        version: 2,
        anime: titres.map(t => ({ kind: 'anime', image: null, status: 'en_cours', totalEpisodes: 12, runtime: null, year: null, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: '2026-09-01', lastWatched: '2026-09-02', ...t })),
        movies: [],
        history: historique.map(n => ({ kind: 'anime', animeId: '1', title: 'Commun', image: null, episode: n, watchedAt: `2026-09-0${n}T10:00:00.000Z` })),
        manualSources: { anime: {}, movies: {} },
      });
    const pc = appareil();
    const tel = appareil();
    base(pc).ecrire(CLES.bibliotheque, ancienne([{ id: '1', title: 'Commun', currentEpisode: 5 }, { id: '2', title: 'PC seulement', currentEpisode: 1 }], [4, 5]));
    base(tel).ecrire(CLES.bibliotheque, ancienne([{ id: '1', title: 'Commun', currentEpisode: 3, favorite: true }, { id: '3', title: 'Téléphone seulement', currentEpisode: 2 }], [3, 4]));
    await converger(relais, [pc, tel]);
    for (const a of [pc, tel]) {
      const db = await biblio(a);
      expect(db.anime.map(e => e.id).sort()).toEqual(['1', '2', '3']);
      expect(trouver(db, 'anime', '1')).toMatchObject({ currentEpisode: 5, favorite: true });
      expect(db.history.map(h => h.episode)).toEqual([5, 4, 3]);
    }
  });

  it('ancien bloc `kv:tsuzuku.bibliotheque` (appareil pas à jour) : fusionné titre par titre, jamais effacé ni réémis', async () => {
    const pc = appareil();
    await ajouter(pc, '1', 'Déjà ici');
    await tour(relais, pc);
    // Un appareil pas encore à jour envoie toute sa bibliothèque d'un bloc.
    const vieux = { version: 2, anime: [{ id: '9', kind: 'anime', title: 'Vu sur le vieil appareil', image: null, status: 'en_cours', currentEpisode: 6, totalEpisodes: null, runtime: null, year: null, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: '2026-09-01', lastWatched: null }], movies: [], history: [], manualSources: { anime: {}, movies: {} } };
    const id = idEnregistrement(CLE, 'kv:tsuzuku.bibliotheque');
    const date = maintenant().toISOString();
    await relais.requete(`${RELAIS_V9}/v9/coffre/principal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${JETON_V9}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enregistrements: [{ id, base: 0, date, supprime: false, valeur: scellerEnregistrement(CLE, 'principal', id, { cle: 'kv:tsuzuku.bibliotheque', date, valeur: JSON.stringify(vieux) }) }] }),
    });
    await tour(relais, pc);
    expect((await biblio(pc)).anime.map(e => e.id).sort()).toEqual(['1', '9']);
    const navigateur = appareil();
    await converger(relais, [pc, navigateur]);
    expect((await biblio(navigateur)).anime.map(e => e.id).sort()).toEqual(['1', '9']);
    // Le bloc n'est ni réémis, ni effacé du serveur (l'appareil pas à jour le relit).
    expect(Object.keys(extraireEntites(pc))).not.toContain('kv:tsuzuku.bibliotheque');
    expect(Object.keys(lireEtatSynchro(pc).supprimes)).not.toContain('kv:tsuzuku.bibliotheque');
    const corbeille = await historiqueServeur({ liaison: MAITRE, cle: CLE, compte: 'principal', requete: relais.requete });
    expect(corbeille.some(h => h.cle === 'kv:tsuzuku.bibliotheque' && h.supprime)).toBe(false);
  });

  it('appareil déjà synchronisé avant cette version : le bloc qu’il émettait n’est pas diffusé comme une suppression', async () => {
    const pc = appareil();
    await ajouter(pc, '1', 'Titre');
    // État d'avant : le bloc était une entité connue (kv), déjà envoyée.
    const etat = lireEtatSynchro(pc);
    base(pc).ecrire('sync.etat', JSON.stringify({ ...etat, connus: { 'kv:tsuzuku.bibliotheque': 'empreinte-ancienne' } }));
    await tour(relais, pc);
    expect(Object.keys(lireEtatSynchro(pc).supprimes)).not.toContain('kv:tsuzuku.bibliotheque');
  });

  it('bibliothèque illisible sur un appareil : rien n’est supprimé ailleurs, et le serveur la répare', async () => {
    const pc = appareil();
    const tel = appareil();
    await ajouter(pc, '1', 'Titre');
    await converger(relais, [pc, tel]);
    base(tel).ecrire(CLES.bibliotheque, '{abîmé');
    await tour(relais, tel);
    await tour(relais, pc);
    expect((await biblio(pc)).anime.map(e => e.id)).toEqual(['1']);
    await voir(pc, '1', 2);
    await tour(relais, pc);
    await tour(relais, tel);
    expect(trouver(await biblio(tel), 'anime', '1')?.currentEpisode).toBe(2);
  });
});
