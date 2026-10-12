/**
 * VF / VOSTFR d'une série sur une source : deux fiches (« Titre » et « Titre
 * (VF) »), une page à onglets de langue, des épisodes marqués, des adresses
 * -vf / -vostfr, une recherche dédiée (search.pathVf), une source qui ne dit
 * rien. Domaines fictifs `*-exemple.fr`, aucune requête réelle.
 */
import { creerClient } from './reseau';
import { episodesEnLangue, episodesSur, lireEpisodesDetail, resumerLangues, variantesDeLangue } from './resolution';
import { classerResultats } from './appariement';
import { normaliserSource, type DefinitionSource } from './sources';
import { fauxReseau, html } from './outilsTest';
import { lignesSource } from '../app/diagnosticTexte';

const SITE = 'https://fiches-exemple.fr';
const eps = (prefixe: string, n = 3, suffixe = '') => Array.from({ length: n }, (_, i) => `<li class="ep"><a href="${prefixe}/episode-${i + 1}">Épisode ${i + 1}${suffixe}</a></li>`).join('');
const RECHERCHE_DEUX = html(`<ul>
  <li class="r"><a href="${SITE}/anime/le-long-voyage/">Le Long Voyage</a></li>
  <li class="r"><a href="${SITE}/anime/le-long-voyage-vf/">Le Long Voyage (VF)</a></li>
  <li class="r"><a href="${SITE}/anime/le-long-voyage-saison-2/">Le Long Voyage Saison 2</a></li>
  <li class="r"><a href="${SITE}/le-long-voyage-episode-12-vostfr/">Le Long Voyage Episode 12 VOSTFR</a></li>
</ul>`);

const src = (o: Partial<Record<string, unknown>> = {}): DefinitionSource =>
  normaliserSource({ name: 'Fiches', baseUrl: SITE, enabled: true, search: { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' }, ...o }, null, { genererId: () => 'fiches' });

const ctx = (routes: Parameters<typeof fauxReseau>[0]) => {
  const reseau = fauxReseau(routes);
  return { reseau, ctx: { client: creerClient(reseau) } };
};

describe('deux fiches « Titre » et « Titre (VF) »', () => {
  const routes = {
    [`${SITE}/?s=`]: RECHERCHE_DEUX,
    [`${SITE}/anime/le-long-voyage/`]: html(`<ul>${eps(`${SITE}/anime/le-long-voyage`)}</ul>`),
    [`${SITE}/anime/le-long-voyage-vf/`]: html(`<ul>${eps(`${SITE}/anime/le-long-voyage-vf`, 2)}</ul>`),
  };

  it('préférence VOSTFR : la fiche sans marqueur (présumée VOSTFR) est lue, la VF reste à lire à la demande', async () => {
    const { reseau, ctx: c } = ctx(routes);
    const r = await episodesSur(c, src(), { titres: ['Le Long Voyage'], langue: 'vostfr' });
    expect(r.serie?.url).toBe(`${SITE}/anime/le-long-voyage/`);
    expect(r.episodes.map(e => e.number)).toEqual([1, 2, 3]);
    expect(r.langues?.courante).toBe('vostfr');
    expect(r.langues?.variantes.vostfr).toMatchObject({ presumee: true, indice: expect.stringContaining('présumée') });
    expect(r.langues?.variantes.vf).toMatchObject({ url: `${SITE}/anime/le-long-voyage-vf/`, title: 'Le Long Voyage (VF)' });
    expect(r.langues?.variantes.vf?.episodes).toBeUndefined();
    // Ni la saison 2, ni l'épisode 12 listé dans la recherche ne deviennent une « version ».
    expect(reseau.urls().filter(u => u.includes('/anime/'))).toEqual([`${SITE}/anime/le-long-voyage/`]);

    // À la demande : UNE page de plus, gardée (une seconde demande ne relit rien).
    const vf = await episodesEnLangue(c, src(), r.langues!, 'vf', { titres: ['Le Long Voyage'] });
    expect(vf.episodes.map(e => [e.number, e.langue])).toEqual([
      [1, 'vf'],
      [2, 'vf'],
    ]);
    const avant = reseau.appels.length;
    await episodesEnLangue(c, src(), r.langues!, 'vf', { titres: ['Le Long Voyage'] });
    expect(reseau.appels.length).toBe(avant);
    // Ni plus de 2 pages de série en tout.
    expect(reseau.urls().filter(u => u.includes('/anime/')).length).toBe(2);
  });

  it('préférence VF : la fiche « (VF) » est lue d’abord', async () => {
    const { ctx: c } = ctx(routes);
    const r = await episodesSur(c, src(), { titres: ['Le Long Voyage'], langue: 'vf' });
    expect(r.serie?.title).toBe('Le Long Voyage (VF)');
    expect(r.langues?.courante).toBe('vf');
    expect(r.langues?.variantes.vf?.indice).toBe('« VF » dans le titre');
    expect(r.langues?.variantes.vostfr?.url).toBe(`${SITE}/anime/le-long-voyage/`);
  });

  it('diagnostic : langue de chaque candidat, versions, page lue', async () => {
    const { ctx: c } = ctx(routes);
    const r = await episodesSur(c, src(), { titres: ['Le Long Voyage'], langue: 'vostfr' });
    const texte = lignesSource(r.diagnostics[0]).join('\n');
    expect(texte).toMatch(/« Le Long Voyage \(VF\) » \(1000, VF\)/);
    expect(texte).toMatch(/« Le Long Voyage » \(1000, langue non marquée\)/);
    expect(texte).toMatch(/langue : VOSTFR pour les épisodes lus/);
    expect(texte).toMatch(/VF : « Le Long Voyage \(VF\) » .* — « VF » dans le titre — page lue à la demande/);
    expect(texte).toMatch(/VOSTFR \(présumée\)/);
  });

  it('regroupement : seulement les fiches de la MÊME série (ni autre saison, ni épisode, ni titre trop éloigné)', () => {
    const classes = classerResultats(
      [
        { title: 'Le Long Voyage', url: `${SITE}/a` },
        { title: 'Le Long Voyage VOSTFR', url: `${SITE}/b` },
        { title: 'Le Long Voyage (VF)', url: `${SITE}/c` },
        { title: 'Le Long Voyage Saison 2 VF', url: `${SITE}/d` },
        { title: 'Lanternes de minuit VF', url: `${SITE}/e` },
      ],
      ['Le Long Voyage'],
    );
    const v = variantesDeLangue(classes, classes.find(x => x.url === `${SITE}/a`)!).variantes;
    expect(v.vostfr?.url).toBe(`${SITE}/b`);
    expect(v.vf?.url).toBe(`${SITE}/c`);
    // Deux langues marquées : la fiche muette n'est rien présumé.
    expect(Object.values(v).some(x => x?.presumee)).toBe(false);
  });
});

describe('une seule page, plusieurs langues', () => {
  const lire = async (corps: string, langue?: 'vf' | 'vostfr') => {
    const { reseau, ctx: c } = ctx({ [`${SITE}/serie`]: html(corps) });
    return { r: await lireEpisodesDetail(c, src(), `${SITE}/serie`, { langue }), reseau };
  };

  it('onglets (« div#vf » / « div#vostfr ») : deux listes, numérotées chacune, sans requête de plus', async () => {
    const { r, reseau } = await lire(`<ul class="onglets"><li>VOSTFR</li><li>VF</li></ul><div id="vostfr"><ul>${eps(`${SITE}/vostfr`)}</ul></div><div id="vf" style="display:none"><ul>${eps(`${SITE}/vf`, 2)}</ul></div>`, 'vf');
    expect(r.parLangue?.vostfr?.map(e => e.number)).toEqual([1, 2, 3]);
    expect(r.parLangue?.vf?.map(e => e.number)).toEqual([1, 2]);
    expect(r.episodes[0]).toMatchObject({ number: 1, langue: 'vf' });
    expect(r.langue?.langue).toBe('vf');
    expect(r.detail.langues).toMatchObject({ separees: true, vf: 2, vostfr: 3 });
    expect(reseau.appels.length).toBe(1);
  });

  it('sections titrées (« <h3>VF</h3><ul> ») et attributs data-lang', async () => {
    const a = await lire(`<h3>Épisodes VOSTFR</h3><ul>${eps(`${SITE}/a`)}</ul><h3>Épisodes VF</h3><ul>${eps(`${SITE}/b`)}</ul>`);
    expect(a.r.parLangue?.vf?.[0].url).toBe(`${SITE}/b/episode-1`);
    expect(a.r.parLangue?.vostfr?.[0].url).toBe(`${SITE}/a/episode-1`);
    const b = await lire(`<div data-lang="fr"><ul>${eps(`${SITE}/x`)}</ul></div><div data-lang="ja"><ul>${eps(`${SITE}/y`)}</ul></div>`, 'vostfr');
    expect(b.r.episodes[0].url).toBe(`${SITE}/y/episode-1`);
  });

  it('marqueurs dans le texte (« Épisode 1 VF » / « Épisode 1 VOSTFR »), dans le désordre', async () => {
    const { r } = await lire(`<ul>${eps(`${SITE}/s`, 3, ' VOSTFR')}${eps(`${SITE}/d`, 3, ' VF')}</ul>`);
    expect(r.parLangue?.vf?.map(e => e.url)).toEqual([1, 2, 3].map(n => `${SITE}/d/episode-${n}`));
    expect(r.parLangue?.vostfr?.length).toBe(3);
  });

  it('blocs sans marqueur à côté de blocs « VF » aux mêmes numéros : présumés VOSTFR (et dit)', async () => {
    const { r } = await lire(`<ul>${eps(`${SITE}/s`)}${eps(`${SITE}/d`, 3, ' VF')}</ul>`, 'vostfr');
    expect(r.detail.langues?.presumee).toBe('vostfr');
    expect(r.episodes.map(e => e.url)).toEqual([1, 2, 3].map(n => `${SITE}/s/episode-${n}`));
  });

  it('page entièrement marquée « VF » (adresses -vf) : la page est en VF', async () => {
    const { r } = await lire(`<ul>${eps(`${SITE}/titre-vf`)}</ul>`);
    expect(r.parLangue).toBeUndefined();
    expect(r.langue?.langue).toBe('vf');
    expect(r.episodes.every(e => e.langue === 'vf')).toBe(true);
  });

  it('aucun marqueur : langue inconnue (rien d’inventé)', async () => {
    const { r } = await lire(`<ul>${eps(`${SITE}/titre`)}</ul>`);
    expect(r.langue).toBeNull();
    expect(r.detail.langues).toBeUndefined();
  });
});

describe('ce que la source ne dit pas', () => {
  it('une seule fiche sans marqueur, page sans marqueur : langue inconnue, les deux absentes avec leur raison', async () => {
    const { ctx: c } = ctx({
      [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage">Le Long Voyage</a></li></ul>`),
      [`${SITE}/anime/voyage`]: html(`<ul>${eps(`${SITE}/anime/voyage`)}</ul>`),
    });
    const r = await episodesSur(c, src(), { titres: ['Le Long Voyage'] });
    expect(r.episodes.length).toBe(3);
    expect(r.langues?.courante).toBeNull();
    expect(r.langues?.absentes.vf).toMatch(/ne distingue pas la langue/);
    expect(resumerLangues(r.langues!).variantes).toEqual([]);
    expect(lignesSource(r.diagnostics[0]).join('\n')).toMatch(/langue : inconnue/);
  });

  it('source réglée sur VOSTFR : VOSTFR (langue déclarée), VF absente « réglée sur VOSTFR seulement »', async () => {
    const { ctx: c } = ctx({
      [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage">Le Long Voyage</a></li></ul>`),
      [`${SITE}/anime/voyage`]: html(`<ul>${eps(`${SITE}/anime/voyage`)}</ul>`),
    });
    const r = await episodesSur(c, src({ language: 'vostfr' }), { titres: ['Le Long Voyage'] });
    expect(r.langues?.courante).toBe('vostfr');
    expect(r.langues?.variantes.vostfr?.indice).toMatch(/déclarée par la source/);
    expect(r.langues?.absentes.vf).toMatch(/réglée sur VOSTFR seulement/);
  });

  it('recherche dédiée (search.pathVf) : la VF se cherche à la demande, puis sa page', async () => {
    const { reseau, ctx: c } = ctx({
      [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage">Le Long Voyage</a></li></ul>`),
      [`${SITE}/vf/?s=`]: html(`<ul><li class="r"><a href="${SITE}/vf/anime/voyage">Le Long Voyage</a></li></ul>`),
      [`${SITE}/anime/voyage`]: html(`<ul>${eps(`${SITE}/anime/voyage`)}</ul>`),
      [`${SITE}/vf/anime/voyage`]: html(`<ul>${eps(`${SITE}/vf/anime/voyage`, 1)}</ul>`),
    });
    const s = src({ language: 'vostfr', search: { path: '/?s={query}', pathVf: '/vf/?s={query}', item: 'li.r', title: 'a', link: 'a' } });
    const r = await episodesSur(c, s, { titres: ['Le Long Voyage'], langue: 'vostfr' });
    expect(r.langues?.variantes.vf).toMatchObject({ aChercher: true });
    expect(reseau.urls().some(u => u.includes('/vf/'))).toBe(false);
    const vf = await episodesEnLangue(c, s, r.langues!, 'vf', { titres: ['Le Long Voyage'] });
    expect(vf.episodes.map(e => e.url)).toEqual([`${SITE}/vf/anime/voyage/episode-1`]);
  });

  it('page de l’autre langue qui s’annonce dans la langue d’origine : refusée, avec la raison', async () => {
    const { ctx: c } = ctx({
      [`${SITE}/?s=`]: RECHERCHE_DEUX,
      [`${SITE}/anime/le-long-voyage/`]: html(`<ul>${eps(`${SITE}/anime/le-long-voyage`)}</ul>`),
      [`${SITE}/anime/le-long-voyage-vf/`]: html(`<ul>${eps(`${SITE}/anime/le-long-voyage`, 3, ' VOSTFR')}</ul>`),
    });
    const r = await episodesSur(c, src(), { titres: ['Le Long Voyage'], langue: 'vostfr' });
    const vf = await episodesEnLangue(c, src(), r.langues!, 'vf', { titres: ['Le Long Voyage'] });
    expect(vf.episodes).toEqual([]);
    expect(vf.raison).toMatch(/s’annonce VOSTFR/);
  });
});
