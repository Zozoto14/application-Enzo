import {
  ajouterOuMettreAJour,
  DepotBibliotheque,
  dejaVu,
  enregistrerProgression,
  exporterBibliotheque,
  HISTORIQUE_MAX,
  importerBibliotheque,
  marquerVuAilleurs,
  migrerBibliotheque,
  migrerFichierHerite,
  modifierEntree,
  statistiques,
  stockageMemoire,
  supprimerEntree,
  trouver,
  VERSION_BIBLIOTHEQUE,
} from './bibliotheque';

const t = { v: Date.UTC(2026, 8, 30, 10) };
const ctx = { horloge: { maintenant: () => t.v }, genererId: () => 'uuid-1' };

// Ancien fichier backend/data/libraries/{userId}.json (v1) : fixture figee.
const V1 = {
  anime: [{ id: '5114', title: 'Alchemist Saga', status: 'en_cours', currentEpisode: 5, totalEpisodes: 64, rating: 9, favorite: false, dateAdded: '2026-09-19', lastWatched: '2026-09-19', champInconnu: 'garde' }, { title: 'sans id' }, null],
  history: [{ animeId: '5114', title: 'AS', episode: 5, watchedAt: '2026-09-19T10:00:00.000Z' }, 'nimporte quoi'],
};

describe('migration', () => {
  it('v1 -> v2 : rien de perdu, champs ajoutes, entrees invalides ecartees', () => {
    const db = migrerBibliotheque(JSON.parse(JSON.stringify(V1)));
    expect(db.version).toBe(VERSION_BIBLIOTHEQUE);
    expect(db.anime).toHaveLength(1);
    expect(db.anime[0]).toMatchObject({ id: '5114', kind: 'anime', currentEpisode: 5, rating: 9, watchedElsewhere: null, comment: null, champInconnu: 'garde' });
    expect(db.movies).toEqual([]);
    expect(db.manualSources).toEqual({ anime: {}, movies: {} });
    expect(db.history).toHaveLength(1);
  });
  it('idempotente et tolerante', () => {
    const une = migrerBibliotheque(JSON.parse(JSON.stringify(V1)));
    expect(migrerBibliotheque(JSON.parse(JSON.stringify(une)))).toEqual(une);
    expect(migrerBibliotheque({ anime: 'x', movies: [null, { id: 'tmdb-1', title: 'X' }], history: {}, manualSources: 12 })).toMatchObject({ anime: [], history: [], manualSources: { anime: {}, movies: {} } });
    expect(migrerBibliotheque(null).anime).toEqual([]);
    expect(migrerBibliotheque({ movies: [{ id: 5 }] }).movies[0].id).toBe('5');
  });
  it('fichier herite : liens manuels v2 conserves ; JSON invalide refuse (pas de remise a zero silencieuse)', () => {
    const v2 = { version: 2, anime: [], movies: [], history: [], manualSources: { anime: { '1': { type: 'pattern', pattern: 'https://s-exemple.fr/{n}' } }, movies: {} } };
    expect(migrerFichierHerite(JSON.stringify(v2)).manualSources.anime['1']).toBeDefined();
    expect(() => migrerFichierHerite('{pas du json')).toThrow(/illisible/);
    expect(() => migrerFichierHerite('[1,2]')).toThrow(/illisible/);
  });
});

describe('statuts et progression', () => {
  it('ajout, mise a jour de statut, date de vision', () => {
    const db = migrerBibliotheque({});
    const e = ajouterOuMettreAJour(db, 'anime', { id: 1, title: ' Titre ', image: 'javascript:alert(1)', totalEpisodes: 12 }, ctx);
    expect(e).toMatchObject({ id: '1', title: 'Titre', image: null, status: 'a_voir', dateAdded: '2026-09-30' });
    ajouterOuMettreAJour(db, 'anime', { id: 1, title: 'Titre', status: 'vu' }, ctx);
    expect(db.anime).toHaveLength(1);
    expect(e).toMatchObject({ status: 'vu', watchedAt: '2026-09-30' });
    expect(() => ajouterOuMettreAJour(db, 'anime', { id: 2, title: 'x', status: 'nimporte' as never }, ctx)).toThrow(/Statut/);
    expect(() => ajouterOuMettreAJour(db, 'anime', { id: '', title: 'x' }, ctx)).toThrow();
  });

  it('progression anime : en cours puis vu au dernier episode ; films : vu', () => {
    const db = migrerBibliotheque({});
    ajouterOuMettreAJour(db, 'anime', { id: 1, title: 'A', totalEpisodes: 2 }, ctx);
    ajouterOuMettreAJour(db, 'movie', { id: 'tmdb-1', title: 'F' }, ctx);
    expect(enregistrerProgression(db, 'anime', 1, 1, ctx)).toMatchObject({ status: 'en_cours', currentEpisode: 1 });
    expect(enregistrerProgression(db, 'anime', 1, 2, ctx)).toMatchObject({ status: 'vu', currentEpisode: 2, watchedAt: '2026-09-30' });
    expect(enregistrerProgression(db, 'anime', 1, 1, ctx)!.currentEpisode).toBe(2); // ne recule pas
    expect(enregistrerProgression(db, 'movie', 'tmdb-1', 99, ctx)).toMatchObject({ status: 'vu' });
    expect(enregistrerProgression(db, 'anime', 'absent', 1, ctx)).toBeNull();
    expect(() => enregistrerProgression(db, 'anime', 1, 0, ctx)).toThrow(/episode/);
    expect(db.history[0]).toMatchObject({ kind: 'movie', animeId: 'tmdb-1', episode: 1 });
  });

  it('historique borne, le plus recent en tete', () => {
    const db = migrerBibliotheque({});
    ajouterOuMettreAJour(db, 'anime', { id: 1, title: 'A', totalEpisodes: 1000 }, ctx);
    for (let i = 1; i <= HISTORIQUE_MAX + 50; i += 1) {
      t.v += 1000;
      enregistrerProgression(db, 'anime', 1, i, ctx);
    }
    expect(db.history).toHaveLength(HISTORIQUE_MAX);
    expect(db.history[0].episode).toBe(HISTORIQUE_MAX + 50);
  });

  it('modification : note validee, quitter « vu ailleurs » efface le detail', () => {
    const db = migrerBibliotheque({});
    marquerVuAilleurs(db, { title: 'X', date: '2026-01-02', rating: 8 }, ctx);
    const id = db.anime[0].id;
    expect(() => modifierEntree(db, 'anime', id, { rating: 11 })).toThrow(/note/);
    expect(modifierEntree(db, 'anime', id, { status: 'a_reprendre', favorite: true, comment: 'ok' }, ctx)).toMatchObject({ watchedElsewhere: null, favorite: true, comment: 'ok' });
    expect(modifierEntree(db, 'anime', 'absent', { favorite: true })).toBeNull();
    expect(supprimerEntree(db, 'anime', id)).toBe(true);
    expect(supprimerEntree(db, 'anime', id)).toBe(false);
  });
});

describe('vu ailleurs et deja vu', () => {
  it('saisie libre : identifiant manuel, distinct de « vu », comptes a part', () => {
    const db = migrerBibliotheque({});
    const e = marquerVuAilleurs(db, { kind: 'anime', title: 'Serie vue chez un ami', date: '2025-12-24', rating: 7.46, comment: 'Top', totalEpisodes: 12 }, ctx);
    expect(e).toMatchObject({ id: 'manuel-uuid-1', manual: true, status: 'vu_ailleurs', rating: 7.5, currentEpisode: 12 });
    expect(e.watchedElsewhere).toEqual({ date: '2025-12-24', rating: 7.5, comment: 'Top', episodesWatched: 12 });
    ajouterOuMettreAJour(db, 'anime', { id: 9, title: 'Vu ici', status: 'vu' }, ctx);
    const s = statistiques(db).anime;
    expect(s).toMatchObject({ seen: 2, watchedElsewhere: 1 });
    expect(s.byStatus.vu).toBe(1);
  });

  it('depuis le catalogue : episodes partiels bornes, film sans episodes', () => {
    const db = migrerBibliotheque({});
    expect(marquerVuAilleurs(db, { id: 5114, title: 'A', totalEpisodes: 64, episodesWatched: 999 }, ctx).currentEpisode).toBe(64);
    expect(marquerVuAilleurs(db, { id: 7, title: 'B', totalEpisodes: 64, episodesWatched: 10 }, ctx).currentEpisode).toBe(10);
    const f = marquerVuAilleurs(db, { kind: 'movie', id: 'tmdb-2', title: 'F', runtime: 100 }, ctx);
    expect(f.currentEpisode).toBe(0);
    expect(statistiques(db).movies.minutesWatched).toBe(100);
  });

  it('valide titre et date', () => {
    const db = migrerBibliotheque({});
    expect(() => marquerVuAilleurs(db, { title: '  ' }, ctx)).toThrow(/titre/);
    expect(() => marquerVuAilleurs(db, { title: 'x', date: '30/09/2026' }, ctx)).toThrow(/Date/);
    expect(() => marquerVuAilleurs(db, { title: 'x', rating: -1 }, ctx)).toThrow(/note/);
    expect(marquerVuAilleurs(db, { title: 'x' }, ctx).watchedElsewhere!.date).toBe('2026-09-30');
  });

  it('deja vu : par id, par titre normalise (saisie libre), avec annee', () => {
    const db = migrerBibliotheque({});
    marquerVuAilleurs(db, { kind: 'movie', title: 'L\'Aube Rouge', year: 2010, date: '2024-05-05' }, ctx);
    ajouterOuMettreAJour(db, 'movie', { id: 'tmdb-3', title: 'Pas vu', year: 2020 }, ctx);
    expect(dejaVu(db, 'movie', { title: 'l aube rouge' })).toMatchObject({ vu: true, statut: 'vu_ailleurs', date: '2024-05-05' });
    expect(dejaVu(db, 'movie', { title: 'L\'aube rouge', year: 2024 }).vu).toBe(false);
    expect(dejaVu(db, 'movie', { id: 'tmdb-3' })).toMatchObject({ vu: false, statut: 'a_voir', date: null });
    expect(dejaVu(db, 'movie', { id: 'inconnu' })).toMatchObject({ vu: false, statut: null });
    expect(dejaVu(db, 'anime', { title: 'L\'aube rouge' }).vu).toBe(false);
  });
});

describe('export / import', () => {
  const rempli = () => {
    const db = migrerBibliotheque(JSON.parse(JSON.stringify(V1)));
    marquerVuAilleurs(db, { title: 'Hors plateforme', date: '2025-01-01' }, ctx);
    ajouterOuMettreAJour(db, 'movie', { id: 'tmdb-1', title: 'F' }, ctx);
    return db;
  };

  it('aller-retour sans perte', () => {
    const src = rempli();
    const sauve = JSON.parse(JSON.stringify(exporterBibliotheque(src, ctx)));
    expect(sauve).toMatchObject({ app: 'tsuzuku', version: 2, exportedAt: expect.stringMatching(/^2026-09-30T/) });
    const cible = migrerBibliotheque({});
    expect(importerBibliotheque(cible, sauve, 'remplacement', ctx)).toEqual({ anime: 2, movies: 1, skipped: 0 });
    expect(cible.anime.map(e => [e.id, e.status])).toEqual(src.anime.map(e => [e.id, e.status]));
    expect(cible.anime[1].watchedElsewhere).toEqual(src.anime[1].watchedElsewhere);
    expect(cible.history).toHaveLength(src.history.length);
  });

  it('fusion : met a jour l\'existant, ajoute le nouveau, compte les entrees ecartees, ne dedouble pas l\'historique', () => {
    const db = rempli();
    const avant = db.history.length;
    const r = importerBibliotheque(
      db,
      { anime: [{ id: '5114', title: 'Alchemist Saga', status: 'vu', currentEpisode: 64 }, { id: '77', title: 'Nouveau' }, { id: '', title: 'x' }, 'x', { id: '8', title: 'Img', image: 'file:///etc/passwd', rating: 99, status: 'bizarre' }], history: db.history },
      'fusion',
      ctx,
    );
    expect(r).toEqual({ anime: 3, movies: 0, skipped: 2 });
    expect(trouver(db, 'anime', '5114')).toMatchObject({ status: 'vu', currentEpisode: 64 });
    expect(trouver(db, 'anime', '8')).toMatchObject({ image: null, rating: null, status: 'a_voir' });
    expect(db.history).toHaveLength(avant);
  });

  it('refuse un fichier qui n\'est pas un objet ; ne fait confiance a rien', () => {
    expect(() => importerBibliotheque(migrerBibliotheque({}), 'x')).toThrow(/invalide/);
    expect(() => importerBibliotheque(migrerBibliotheque({}), null)).toThrow(/invalide/);
    const db = migrerBibliotheque({});
    importerBibliotheque(db, { anime: [{ id: '1', title: 'A', __proto__: { x: 1 }, comment: 'c'.repeat(5000), currentEpisode: -4 }] }, 'fusion', ctx);
    expect(db.anime[0].comment).toHaveLength(2000);
    expect(db.anime[0].currentEpisode).toBe(0);
  });
});

describe('depot sur Stockage', () => {
  it('lecture vide, ecriture, relecture ; ecritures concurrentes serialisees', async () => {
    const st = stockageMemoire();
    const depot = new DepotBibliotheque(st);
    expect((await depot.lire()).anime).toEqual([]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => depot.modifier(db => { ajouterOuMettreAJour(db, 'anime', { id: i, title: `T${i}` }, ctx); })));
    expect((await depot.lire()).anime).toHaveLength(20);
  });

  it('une erreur dans la modification n\'ecrit rien et n\'empeche pas la suivante', async () => {
    const st = stockageMemoire();
    const depot = new DepotBibliotheque(st);
    await expect(depot.modifier(db => { ajouterOuMettreAJour(db, 'anime', { id: 1, title: 'A' }, ctx); throw new Error('boum'); })).rejects.toThrow('boum');
    expect(st.contenu.size).toBe(0);
    await depot.modifier(db => { ajouterOuMettreAJour(db, 'anime', { id: 2, title: 'B' }, ctx); });
    expect((await depot.lire()).anime.map(e => e.id)).toEqual(['2']);
  });

  it('stockage corrompu : erreur, jamais ecrase', async () => {
    const st = stockageMemoire({ 'tsuzuku.bibliotheque': '{casse' });
    const depot = new DepotBibliotheque(st);
    await expect(depot.modifier(() => {})).rejects.toThrow(/illisible/);
    expect(st.contenu.get('tsuzuku.bibliotheque')).toBe('{casse');
  });

  it('importe un ancien fichier libraries/{userId}.json', async () => {
    const depot = new DepotBibliotheque(stockageMemoire());
    const db = await depot.importerFichierHerite(JSON.stringify(V1));
    expect(db.anime[0].id).toBe('5114');
    expect((await depot.lire()).version).toBe(2);
  });
});
