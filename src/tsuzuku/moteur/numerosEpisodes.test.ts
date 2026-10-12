/**
 * Numéros d'épisodes lus sur une page de série (cas réel : « 3 épisodes, mais
 * pas l'épisode 1 »). Balisage d'un thème WordPress courant de catalogue
 * (`li.wp-manga-chapter > a` + date de sortie), liste du plus récent au plus
 * ancien, HTML MINIFIÉ (aucun espace entre le lien et la date). Domaines
 * fictifs `*-exemple.fr`, aucune requête réelle.
 */
import { creerClient } from './reseau';
import { episodesSur, lireEpisodes, lireEpisodesDetail, numeroterParOrdre } from './resolution';
import { numeroEtSaison } from './extraction';
import { normaliserSource } from './sources';
import { fauxReseau, html, json } from './outilsTest';

const SITE = 'https://catalogue-exemple.fr';
const SERIE = `${SITE}/anime/forgeron-legendaire/`;
const li = (href: string, texte: string, date: string) => `<li class="wp-manga-chapter"><a href="${href}">${texte}</a><span class="chapter-release-date"><i>${date}</i></span></li>`;
/** Page de la série telle que livrée par le thème, minifiée. */
const pageSerie = (lignes: string[]) =>
  html(`<div class="post-title"><h1>Forgeron Légendaire</h1></div><div id="manga-chapters-holder" data-id="4242"><div class="page-content-listing single-page"><div class="listing-chapters_wrap"><ul class="main version-chap no-volumn">${lignes.join('')}</ul></div></div></div>`);
const RECHERCHE = html(
  `<div class="c-tabs-item"><div class="row c-tabs-item__content"><div class="post-title"><h3 class="h4"><a href="${SERIE}">Forgeron Légendaire</a></h3></div></div><div class="row c-tabs-item__content"><div class="post-title"><h3 class="h4"><a href="${SITE}/anime/forgeron-legendaire-vf/">Forgeron Légendaire (VF)</a></h3></div></div></div>`,
);

const source = (episodes: Record<string, string>) =>
  normaliserSource(
    { name: 'Catalogue', baseUrl: SITE, enabled: true, search: { path: '/?s={query}&post_type=wp-manga', item: '.c-tabs-item__content', title: '.post-title a', link: '.post-title a' }, episodes },
    null,
    { genererId: () => 'cat' },
  );
const CONFIG = { item: 'li.wp-manga-chapter', link: 'a' };

describe('numéros d’épisodes : cas réel « 3 épisodes, mais pas l’épisode 1 »', () => {
  it('liste minifiée, du plus récent au plus ancien : la date collée ne fait plus de « Episode 1 » l’épisode 112', async () => {
    const reseau = fauxReseau({
      [`${SITE}/?s=`]: RECHERCHE,
      [SERIE]: pageSerie([3, 2, 1].map(n => li(`${SERIE}episode-${n}/`, `Episode ${n}`, `${10 + n}/03/2025`))),
    });
    const r = await episodesSur({ client: creerClient(reseau) }, source(CONFIG), { titres: ['Forgeron Légendaire'] });
    expect(r.episodes.map(e => e.number)).toEqual([1, 2, 3]);
    expect(r.episodes[0].url).toBe(`${SERIE}episode-1/`);
    const d = r.diagnostics[0].lectureEpisodes!;
    expect(d.numeros).toEqual([1, 2, 3]);
    expect(d.numerotation).toBe('lue');
    expect(d.lus?.[0]).toEqual({ numero: 3, texte: 'Episode 3 13/03/2025', url: `${SERIE}episode-3/` });
  });

  const lignes = (f: (n: number) => [string, string, string]) => [3, 2, 1].map(n => li(...f(n)));
  const VARIANTES: Record<string, string[]> = {
    'Saison 1 - Épisode 01': lignes(n => [`${SERIE}saison-1-episode-0${n}/`, `Saison 1 - Épisode 0${n}`, '12 mars 2025']),
    'Titre 2 - 01 VOSTFR (chiffre dans le titre, zéro en tête)': lignes(n => [`${SERIE}forgeron-legendaire-2-0${n}-vostfr/`, `Forgeron Légendaire 2 - 0${n} VOSTFR`, '12 mars 2025']),
    'Ep. 1 VF + date jj/mm/aaaa': lignes(n => [`${SERIE}ep-${n}/`, `Ep. ${n} VF`, `0${n}/03/2025`]),
    'Épisode décomposé (NFD)': lignes(n => [`${SERIE}e${n}/`, `Épisode ${n}`, 'il y a 3 jours']),
    'numéro seul « 01 »': lignes(n => [`${SERIE}${n}/`, `0${n}`, '2025-03-12']),
    'S1 E1': lignes(n => [`${SERIE}s1e${n}/`, `S1 E${n}`, '12 mars 2025']),
    '« Episode 1 - 1080p »': lignes(n => [`${SERIE}video-${n * 7}/`, `Episode ${n} - 1080p`, '12 mars 2025']),
  };
  const NUMEROS: Record<string, Record<string, string>> = { 'sans sélecteur de numéro': CONFIG, 'number: a': { ...CONFIG, number: 'a' }, 'number: & (tout le bloc)': { ...CONFIG, number: '&' } };
  for (const [nom, l] of Object.entries(VARIANTES)) {
    for (const [nomConfig, config] of Object.entries(NUMEROS)) {
      it(`${nom} — ${nomConfig}`, async () => {
        const reseau = fauxReseau({ [SERIE]: pageSerie(l) });
        const eps = await lireEpisodes({ client: creerClient(reseau) }, source(config), SERIE, { titres: ['Forgeron Légendaire 2'] });
        expect(eps.map(e => e.number)).toEqual([1, 2, 3]);
      });
    }
  }

  it('aucun numéro lisible : numérotation par l’ordre (du plus récent au plus ancien)', async () => {
    const reseau = fauxReseau({ [SERIE]: pageSerie(['c', 'b', 'a'].map(x => li(`${SERIE}video-${x}/`, 'Regarder', 'hier'))) });
    const { episodes, detail } = await lireEpisodesDetail({ client: creerClient(reseau) }, source(CONFIG), SERIE);
    expect(episodes.map(e => [e.number, e.url])).toEqual([[1, `${SERIE}video-a/`], [2, `${SERIE}video-b/`], [3, `${SERIE}video-c/`]]);
    expect(detail.numerotation).toBe('ordre');
  });

  it('trous comblés selon le sens de la liste (croissant ou décroissant)', () => {
    expect(numeroterParOrdre([3, null, 1])).toEqual({ numeros: [3, 2, 1], numerotation: 'mixte' });
    expect(numeroterParOrdre([1, null, 3, null])).toEqual({ numeros: [1, 2, 3, 4], numerotation: 'mixte' });
    expect(numeroterParOrdre([null, null])).toEqual({ numeros: [2, 1], numerotation: 'ordre' });
    // Un numéro déjà pris n'est pas réattribué.
    expect(numeroterParOrdre([2, null, 2]).numeros).toEqual([2, 3, 2]);
  });

  it('API JSON : « Épisode 01 (2024) » est l’épisode 1, pas le 12024', async () => {
    const reseau = fauxReseau({ [`${SITE}/api/serie`]: json({ data: [{ numero: 'Épisode 01 (2024)', url: '/e/1' }, { numero: 'Épisode 02 (2024)', url: '/e/2' }] }) });
    const src = source({ type: 'json', item: 'data', number: 'numero', link: 'url' });
    expect((await lireEpisodes({ client: creerClient(reseau) }, src, `${SITE}/api/serie`)).map(e => e.number)).toEqual([1, 2]);
  });

  it('lecture libre : dates, années, durées, saison et titre de la série ne sont pas des numéros', () => {
    expect(numeroEtSaison('Forgeron Légendaire 2 - 03 VOSTFR', '', { libre: true })).toEqual({ number: 3, saison: null });
    expect(numeroEtSaison('Forgeron 2 VOSTFR 12 mars 2025', '', { libre: true, titres: ['Forgeron 2'] })).toBeNull();
    expect(numeroEtSaison('Saison 2 · 07 · 24 min', '', { libre: true })).toEqual({ number: 7, saison: 2 });
    expect(numeroEtSaison('Accueil', '/anime/x/', { libre: true })).toBeNull();
    // Sans « libre » (repérage générique sur toute la page), un nombre quelconque ne fait pas un épisode.
    expect(numeroEtSaison('Top 10 2025', '/classement/')).toBeNull();
  });
});
