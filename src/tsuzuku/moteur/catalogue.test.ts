import { creerCatalogue, dureeEnMinutes, mapperAnimeJikan, mapperDetailsTmdb, mapperFilmJikan, mapperFilmTmdb, mapperMediaAnilist, mapperPlateformesTmdb, retirerHtml } from './catalogue';
import { creerClient } from './reseau';
import { attenteNulle, fauxReseau, json, type Reponse } from './outilsTest';

const JIKAN = 'https://api.jikan.moe/v4';
const ANILIST = 'https://graphql.anilist.co';
const TMDB = 'https://api.themoviedb.org/3';

const animeJikan = {
  mal_id: 5114,
  title: 'Hagane no Renkinjutsushi',
  title_english: 'Alchemist Saga',
  title_japanese: '鋼',
  synopsis: 'Deux freres.',
  images: { jpg: { large_image_url: 'https://img.exemple.fr/l.jpg', image_url: 'https://img.exemple.fr/s.jpg' } },
  episodes: 64,
  status: 'Finished Airing',
  score: 9.1,
  year: 2009,
  genres: [{ name: 'Action' }],
  themes: [{ name: 'Militaire' }],
  studios: [{ name: 'Studio Exemple' }],
  streaming: [{ name: 'Plateforme legale', url: 'https://legal.exemple.fr/x' }, { name: 'sans lien' }],
};

const mediaAnilist = {
  id: 1,
  idMal: 5114,
  title: { romaji: 'Hagane', english: null, native: '鋼' },
  description: 'Deux<br>freres <i>unis</i>',
  episodes: 64,
  status: 'FINISHED',
  format: 'TV',
  season: 'SPRING',
  seasonYear: 2009,
  averageScore: 91,
  popularity: 1000,
  genres: ['Action'],
  coverImage: { extraLarge: 'https://img.exemple.fr/x.jpg' },
  studios: { nodes: [{ name: 'Studio Exemple' }] },
  externalLinks: [
    { type: 'STREAMING', site: 'Plateforme', url: 'https://legal.exemple.fr/1', language: 'FR' },
    { type: 'STREAMING', site: 'Plateforme', url: 'https://legal.exemple.fr/2' },
    { type: 'INFO', site: 'Wiki', url: 'https://wiki.exemple.fr' },
  ],
};

const maintenant = { t: 1_000_000 };
const horloge = { maintenant: () => maintenant.t };

function outils(routes: Record<string, Reponse>, cle?: string) {
  const reseau = fauxReseau(routes);
  const journal: string[] = [];
  const cat = creerCatalogue({ client: creerClient(reseau), attendre: attenteNulle, horloge, journal: m => journal.push(m), cleTmdb: () => cle });
  return { reseau, cat, journal };
}

describe('conversions', () => {
  it('Jikan', () => {
    const f = mapperAnimeJikan(animeJikan)!;
    expect(f).toMatchObject({ id: 5114, title: 'Alchemist Saga', titleOriginal: 'Hagane no Renkinjutsushi', totalEpisodes: 64, year: 2009, genres: ['Action'] });
    expect(f.streamingLinks).toEqual([{ site: 'Plateforme legale', url: 'https://legal.exemple.fr/x', language: null }]);
    expect(mapperAnimeJikan(null)).toBeNull();
  });
  it('AniList : idMal conserve, note sur 10, HTML retire, une seule entree par plateforme', () => {
    const f = mapperMediaAnilist(mediaAnilist)!;
    expect(f).toMatchObject({ id: 5114, title: 'Hagane', score: 9.1, season: 'spring', airingStatus: 'Finished Airing', synopsis: 'Deux\nfreres unis' });
    expect(f.streamingLinks).toEqual([{ site: 'Plateforme', url: 'https://legal.exemple.fr/1', language: 'FR' }]);
    expect(retirerHtml('')).toBeNull();
  });
  it('TMDB : liste, details, plateformes legales', () => {
    const genres = new Map([[16, 'Animation']]);
    const f = mapperFilmTmdb({ id: 603, title: 'Film', poster_path: '/p.jpg', release_date: '1999-03-30', vote_average: 8.25, vote_count: 10, genre_ids: [16, 99] }, genres)!;
    expect(f).toMatchObject({ id: 'tmdb-603', year: 1999, score: 8.3, genres: ['Animation'], image: 'https://image.tmdb.org/t/p/w500/p.jpg' });
    expect(mapperFilmTmdb({ id: 1, vote_average: 5, vote_count: 0 })!.score).toBeNull();
    const d = mapperDetailsTmdb({
      id: 603,
      title: 'F',
      genres: [{ name: 'Action' }],
      videos: { results: [{ site: 'YouTube', key: 'ab', type: 'Teaser' }, { site: 'YouTube', key: 'fr1', type: 'Trailer', iso_639_1: 'fr' }] },
      'watch/providers': { results: { FR: { link: 'https://tmdb.exemple.fr/w', flatrate: [{ provider_name: 'A' }], rent: [{ provider_name: 'A' }, { provider_name: 'B' }] } } },
    })!;
    expect(d.trailer).toBe('https://www.youtube-nocookie.com/embed/fr1');
    expect(d.streamingLinks!.map(s => s.site)).toEqual(['A', 'A (location)', 'B (location)']);
    expect(mapperPlateformesTmdb({ results: {} })).toEqual([]);
  });
  it('film Jikan et durees', () => {
    expect(mapperFilmJikan({ mal_id: 199, title: 'X', duration: '1 hr 55 min', trailer: { youtube_id: 'k' }, aired: { from: '2001-07-20T00:00:00+00:00' } })).toMatchObject({ id: 'mal-199', runtime: 115, releaseDate: '2001-07-20', trailer: 'https://www.youtube-nocookie.com/embed/k' });
    expect(dureeEnMinutes('45 min per ep')).toBe(45);
    expect(dureeEnMinutes('Unknown')).toBeNull();
  });
});

describe('animes : Jikan puis AniList', () => {
  it('Jikan repond : source jikan, requete encodee, cache', async () => {
    const { cat, reseau } = outils({ [`${JIKAN}/anime?q=`]: json({ data: [animeJikan] }) });
    const r = await cat.animes.rechercher('Full metal & co');
    expect(r.source).toBe('jikan');
    expect(r.data[0].id).toBe(5114);
    expect(reseau.urls()[0]).toContain('q=Full%20metal%20%26%20co');
    await cat.animes.rechercher('Full metal & co');
    expect(reseau.appels).toHaveLength(1);
  });

  it('Jikan en panne : bascule sur AniList, disjoncteur puis retour', async () => {
    const { cat, reseau, journal } = outils({
      [`${JIKAN}/`]: { statut: 504 },
      [ANILIST]: json({ data: { Page: { media: [mediaAnilist, { ...mediaAnilist, idMal: null, id: 2 }] } } }),
    });
    const r = await cat.animes.rechercher('x');
    expect(r.source).toBe('anilist');
    expect(r.data).toHaveLength(1); // l'entree sans idMal est ecartee
    expect(journal[0]).toMatch(/bascule sur AniList/);
    expect(cat.animes.fournisseur()).toBe('anilist');
    const avant = reseau.appels.filter(a => a.url.startsWith(JIKAN)).length;
    await cat.animes.rechercher('y');
    expect(reseau.appels.filter(a => a.url.startsWith(JIKAN)).length).toBe(avant); // Jikan evite
    maintenant.t += 61_000;
    expect(cat.animes.fournisseur()).toBe('jikan');
  });

  it('reponse Jikan vide : repli AniList ; 404 : pas de repli', async () => {
    const a = outils({ [`${JIKAN}/anime?q=`]: json({ data: [] }), [ANILIST]: json({ data: { Page: { media: [mediaAnilist] } } }) });
    expect((await a.cat.animes.rechercher('x')).source).toBe('anilist');
    const b = outils({ [`${JIKAN}/anime/9/full`]: { statut: 404 } });
    await expect(b.cat.animes.parId(9)).rejects.toMatchObject({ statut: 404 });
    expect(b.reseau.urls().some(u => u.startsWith(ANILIST))).toBe(false);
  });

  it('429 : une nouvelle tentative apres attente', async () => {
    let n = 0;
    const { cat } = outils({ [`${JIKAN}/top/anime`]: () => (++n === 1 ? { statut: 429 } : json({ data: [animeJikan] })) });
    expect((await cat.animes.populaires()).source).toBe('jikan');
    expect(n).toBe(2);
  });

  it('identifiant invalide refuse sans requete', async () => {
    const { cat, reseau } = outils({});
    await expect(async () => cat.animes.parId('abc')).rejects.toMatchObject({ code: 'saisie' });
    expect(reseau.appels).toHaveLength(0);
  });

  it('episodes Jikan : pages agregees', async () => {
    const { cat } = outils({
      [`${JIKAN}/anime/1/episodes?page=1`]: json({ pagination: { last_visible_page: 2 }, data: [{ mal_id: 1, title: 'Un', filler: false }] }),
      [`${JIKAN}/anime/1/episodes?page=2`]: json({ pagination: { last_visible_page: 2 }, data: [{ mal_id: 2, title: 'Deux', filler: true }] }),
    });
    const r = await cat.animes.episodes(1);
    expect(r.source).toBe('jikan');
    expect(r.data.map(e => [e.number, e.filler])).toEqual([[1, false], [2, true]]);
  });

  it('serie longue : AniList sans ouvrir le disjoncteur ; numerotation complete', async () => {
    const { cat } = outils({
      [`${JIKAN}/anime/21/episodes`]: json({ pagination: { last_visible_page: 9 }, data: [] }),
      [ANILIST]: json({ data: { Media: { episodes: null, nextAiringEpisode: { episode: 4 }, streamingEpisodes: [{ title: 'Episode 2 - Deux', url: 'https://legal.exemple.fr/2', site: 'P' }] } } }),
    });
    const r = await cat.animes.episodes(21);
    expect(r.source).toBe('anilist');
    expect(r.data.map(e => e.number)).toEqual([1, 2, 3]);
    expect(r.data[1]).toMatchObject({ title: 'Deux', watchSite: 'P' });
    expect(cat.animes.fournisseur()).toBe('jikan');
  });

  it('parcourir : les criteres absents sont omis des variables (jamais null)', async () => {
    let corps: { variables: Record<string, unknown> } | undefined;
    const { cat } = outils({ [ANILIST]: r => { corps = JSON.parse(r.corps!); return json({ data: { Page: { media: [mediaAnilist], pageInfo: { hasNextPage: false } } } }); } });
    await cat.animes.parcourir({ genre: 'Action' });
    expect(corps!.variables).toEqual({ page: 1, perPage: 30, sort: ['POPULARITY_DESC'], genre: 'Action' });
  });

  it('erreurs GraphQL', async () => {
    const { cat } = outils({ [ANILIST]: json({ errors: [{ message: 'boom' }] }) });
    await expect(cat.animes.decouvrir()).rejects.toMatchObject({ code: 'service', message: expect.stringContaining('boom') });
  });

  it('genres : le genre adulte est masque', async () => {
    const { cat } = outils({ [ANILIST]: json({ data: { GenreCollection: ['Action', 'Hentai', 'Drame'] } }) });
    expect(await cat.animes.genres()).toEqual(['Action', 'Drame']);
  });
});

describe('films : TMDB avec cle, sinon Jikan', () => {
  const resultatsTmdb = { page: 1, total_pages: 3, total_results: 50, results: [{ id: 603, title: 'Film', genre_ids: [16], vote_average: 7, vote_count: 3 }] };
  const routesTmdb = {
    [`${TMDB}/genre/movie/list`]: json({ genres: [{ id: 16, name: 'Animation' }] }),
    [`${TMDB}/search/movie`]: json(resultatsTmdb),
    [`${TMDB}/movie/603`]: json({ id: 603, title: 'Film', genres: [] }),
  };

  it('sans cle : Jikan (type=movie), aucun appel TMDB', async () => {
    const { cat, reseau } = outils({ [`${JIKAN}/anime?type=movie&q=`]: json({ data: [{ mal_id: 199, title: 'Film A' }], pagination: { current_page: 1, has_next_page: true, items: { total: 40 } } }) });
    const r = await cat.films.rechercher('x');
    expect(r.source).toBe('jikan');
    expect(r.items[0].id).toBe('mal-199');
    expect(r.pageInfo).toEqual({ page: 1, hasNextPage: true, total: 40 });
    expect(reseau.urls().every(u => !u.startsWith(TMDB))).toBe(true);
    expect(await cat.films.fournisseur()).toBe('jikan');
  });

  it('avec cle v3 : TMDB, en francais, cle en parametre', async () => {
    const { cat, reseau } = outils(routesTmdb, 'cle-v3-abc');
    const r = await cat.films.rechercher('film');
    expect(r.source).toBe('tmdb');
    expect(r.items[0]).toMatchObject({ id: 'tmdb-603', genres: ['Animation'] });
    expect(r.pageInfo.hasNextPage).toBe(true);
    const u = reseau.urls().find(x => x.includes('/search/movie'))!;
    expect(u).toContain('language=fr-FR');
    expect(u).toContain('api_key=cle-v3-abc');
  });

  it('avec jeton Bearer : en-tete, pas de cle dans l\'adresse', async () => {
    const jeton = `eyJ${'a'.repeat(80)}`;
    const { cat, reseau } = outils(routesTmdb, jeton);
    await cat.films.rechercher('film');
    const appel = reseau.appels.find(a => a.url.includes('/search/movie'))!;
    expect(appel.url).not.toContain('api_key');
    expect(appel.entetes.authorization).toBe(`Bearer ${jeton}`);
  });

  it('TMDB en echec : repli Jikan ; cle refusee sans fuite de la cle', async () => {
    const { cat, journal } = outils(
      { [`${TMDB}/`]: { statut: 401 }, [`${JIKAN}/anime?type=movie&q=`]: json({ data: [{ mal_id: 1, title: 'J' }] }) },
      'secret-tmdb-123',
    );
    const r = await cat.films.rechercher('x');
    expect(r.source).toBe('jikan');
    expect(journal.join(' ')).not.toContain('secret-tmdb-123');
    expect(journal.join(' ')).toMatch(/repli sur Jikan/);
  });

  it('fiche detaillee : TMDB et Jikan, identifiant valide', async () => {
    const { cat } = outils({ ...routesTmdb, [`${JIKAN}/anime/199/full`]: json({ data: { mal_id: 199, title: 'Film A' } }) }, 'k');
    expect((await cat.films.parId('tmdb-603')).film.id).toBe('tmdb-603');
    expect((await cat.films.parId('mal-199')).source).toBe('jikan');
    await expect(cat.films.parId('../etc')).rejects.toMatchObject({ code: 'saisie' });
    await expect(cat.films.parId('tmdb-12; drop')).rejects.toMatchObject({ code: 'saisie' });
  });

  it('parcourir Jikan : annee et genre numerique', async () => {
    const { cat, reseau } = outils({ [`${JIKAN}/anime?type=movie`]: json({ data: [] }) });
    await cat.films.parcourir({ genre: '4', annee: 2019, tri: 'note' });
    const u = reseau.urls()[0];
    expect(u).toContain('genres=4');
    expect(u).toContain('start_date=2019-01-01');
    expect(u).toContain('order_by=score');
  });
});

describe('cache du catalogue : requêtes groupées, périmé servi puis rafraîchi, gardé sur l’appareil', () => {
  const routes = (titre: string): Record<string, Reponse> => ({ [`${JIKAN}/anime/5114/full`]: json({ data: { ...animeJikan, synopsis: titre } }) });

  it('deux demandes simultanées de la même fiche : une seule requête', async () => {
    const reseau = fauxReseau(routes('Hagane'));
    const cat = creerCatalogue({ client: creerClient(reseau), attendre: attenteNulle, horloge });
    const [a, b] = await Promise.all([cat.animes.parId(5114), cat.animes.parId(5114)]);
    expect(a.data).toEqual(b.data);
    expect(reseau.appels).toHaveLength(1);
  });

  it('périmée mais dans `perimeMaxMs` : servie tout de suite, rafraîchie en arrière-plan', async () => {
    const r = routes('Ancien titre');
    const reseau = fauxReseau(r);
    const cat = creerCatalogue({ client: creerClient(reseau), attendre: attenteNulle, horloge, cacheMs: 1000, perimeMaxMs: 60_000 });
    const avant = maintenant.t;
    try {
      await cat.animes.parId(5114);
      r[`${JIKAN}/anime/5114/full`] = json({ data: { ...animeJikan, synopsis: 'Nouveau' } });
      maintenant.t += 5000;
      const perimee = await cat.animes.parId(5114);
      expect(perimee.data.synopsis).toBe('Ancien titre');
      await new Promise<void>(ok => setTimeout(ok, 5));
      expect(reseau.appels).toHaveLength(2);
      expect((await cat.animes.parId(5114)).data.synopsis).toBe('Nouveau');
      // Trop vieille (au-delà de perimeMaxMs) : redemandée, pas servie.
      maintenant.t += 120_000;
      r[`${JIKAN}/anime/5114/full`] = json({ data: { ...animeJikan, synopsis: 'Encore plus neuf' } });
      expect((await cat.animes.parId(5114)).data.synopsis).toBe('Encore plus neuf');
      expect(reseau.appels).toHaveLength(3);
    } finally {
      maintenant.t = avant;
    }
  });

  it('cache persistant : un nouveau catalogue (relance de l’app) ne refait pas la requête', async () => {
    const garde = new Map<string, { a: number; donnees: unknown }>();
    const persistant = { lire: async (cle: string) => garde.get(cle), ecrire: (cle: string, donnees: unknown, a: number) => void garde.set(cle, { a, donnees }) };
    const reseau = fauxReseau(routes('Hagane'));
    await creerCatalogue({ client: creerClient(reseau), attendre: attenteNulle, horloge, persistant }).animes.parId(5114);
    const relance = creerCatalogue({ client: creerClient(reseau), attendre: attenteNulle, horloge, persistant });
    expect((await relance.animes.parId(5114)).data.id).toBe(5114);
    expect(reseau.appels).toHaveLength(1);
    // Jamais de clé d'API dans les clés gardées.
    expect([...garde.keys()].every(c => !/api_key|Bearer/.test(c))).toBe(true);
  });
});
