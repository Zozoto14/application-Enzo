/**
 * Recherche en parallèle : MÊME résultat que le parcours séquentiel d'avant
 * (titre retenu, requêtes du diagnostic, épisodes), en moins de temps ; une
 * seule requête vers un site qui bloque ; priorité des sources gardée.
 */
import { creerClient } from './reseau';
import { chercherOeuvre, trouverEpisodes, trouverFilm, type ContexteResolution } from './resolution';
import { normaliserSource } from './sources';
import { fauxReseau, html, type Reponse } from './outilsTest';

const latence = (ms: number, r: ReturnType<typeof html>): Reponse => () => new Promise(ok => setTimeout(() => ok(r), ms));
const SITE = 'https://catalogue-exemple.fr';
const src = normaliserSource({ id: 'cat', name: 'Catalogue', baseUrl: SITE, enabled: true, search: { path: '/recherche?q={query}', item: 'li', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } });
const listeSur = (base: string, ...t: string[]) => html(`<ul>${t.map((x, i) => `<li><a href="${base}/serie/${i}-${encodeURIComponent(x)}">${x}</a></li>`).join('')}</ul>`);
const liste = (...t: string[]) => listeSur(SITE, ...t);

/** Le site ne connaît que le titre français : les premières variantes ne donnent rien. */
function routes(ms: number): Record<string, Reponse> {
  return {
    [`${SITE}/recherche?q=Nagai`]: latence(ms, liste('Autre oeuvre')),
    [`${SITE}/recherche?q=The`]: latence(ms, liste('The Long Voyage Movie')),
    [`${SITE}/recherche?q=Le`]: latence(ms, liste('Le Long Voyage', 'Le Long Voyage (VF)')),
  };
}
const titres = ['Nagai Tabi', 'The Long Voyage', 'Le Long Voyage'];
const ctx = (r: Record<string, Reponse>, parallele?: ContexteResolution['parallele']) => {
  const reseau = fauxReseau(r);
  return { reseau, ctx: { client: creerClient(reseau), parallele } as ContexteResolution };
};

describe('chercherOeuvre : variantes du titre en parallèle', () => {
  it('même titre retenu, mêmes requêtes dans le diagnostic, deux fois plus vite que le séquentiel', async () => {
    const seq = ctx(routes(60), { variantes: 1 });
    let t = Date.now();
    const a = await chercherOeuvre(seq.ctx, src, { titres });
    const dureeSeq = Date.now() - t;
    const par = ctx(routes(60), { variantes: 3, relaisMs: 20 });
    t = Date.now();
    const b = await chercherOeuvre(par.ctx, src, { titres });
    const dureePar = Date.now() - t;
    expect(b.serie).toEqual(a.serie);
    expect(b.meilleurs).toEqual(a.meilleurs);
    expect(b.langues).toEqual(a.langues);
    const sansMs = (q: typeof a.requetes) => q.map(({ ms: _ms, ...x }) => x);
    expect(sansMs(b.requetes)).toEqual(sansMs(a.requetes));
    expect(a.serie?.title).toBe('Le Long Voyage');
    expect(dureePar).toBeLessThan(dureeSeq * 0.75);
  });

  it('première variante suffisante et rapide : une seule requête (aucune requête spéculative)', async () => {
    const { reseau, ctx: c } = ctx({ [`${SITE}/recherche?q=Le`]: liste('Le Long Voyage') });
    const r = await chercherOeuvre(c, src, { titres: ['Le Long Voyage', 'Nagai Tabi', 'The Long Voyage'] });
    expect(r.serie?.title).toBe('Le Long Voyage');
    expect(reseau.appels).toHaveLength(1);
  });

  it('site qui bloque (anti-robot) : une seule requête, comme avant', async () => {
    const { reseau, ctx: c } = ctx({ [`${SITE}/recherche`]: { statut: 503, entetes: { 'content-type': 'text/html', server: 'cloudflare' }, corps: '<title>Just a moment...</title>' } });
    const r = await chercherOeuvre(c, src, { titres });
    expect(r.code).toBe('anti-robot');
    expect(reseau.appels).toHaveLength(1);
  });
});

describe('trouverEpisodes / trouverFilm : sources en parallèle, priorité gardée', () => {
  const B = 'https://second-exemple.fr';
  const second = normaliserSource({ ...src, id: 'b', name: 'Seconde', baseUrl: B });
  const lente = normaliserSource({ ...src, id: 'a', name: 'Prioritaire lente' });

  it('la prioritaire lente sans le titre est interrompue après le délai de grâce ; la seconde l’emporte', async () => {
    const r: Record<string, Reponse> = {
      [`${SITE}/recherche`]: latence(1500, liste('Autre oeuvre')),
      [`${B}/recherche?q=Le`]: listeSur(B, 'Le Long Voyage'),
      [`${B}/serie/0-Le%20Long%20Voyage`]: html('<ul><li class="ep"><a href="/e1">Épisode 1</a></li></ul>'),
    };
    const { ctx: c } = ctx(r, { relaisSourcesMs: 20, graceMs: 60 });
    const debut = Date.now();
    const res = await trouverEpisodes(c, [lente, second], { titres: ['Le Long Voyage'] });
    expect(Date.now() - debut).toBeLessThan(1000);
    expect(res.source?.id).toBe('b');
    expect(res.diagnostics.map(d => d.statut)).toEqual(['interrompue', 'ok']);
    expect(res.diagnostics[0].raison).toMatch(/« Seconde » a trouvé/);
    expect(res.diagnostics[1].ms?.recherche).toBeGreaterThanOrEqual(0);
  });

  it('les deux ont le titre : la prioritaire l’emporte, même si la seconde répond avant', async () => {
    const r: Record<string, Reponse> = {
      [`${SITE}/recherche?q=Le`]: latence(120, liste('Le Long Voyage')),
      [`${SITE}/serie/0-Le%20Long%20Voyage`]: html('<ul><li class="ep"><a href="/a1">Épisode 1</a></li><li class="ep"><a href="/a2">Épisode 2</a></li></ul>'),
      [`${B}/recherche?q=Le`]: listeSur(B, 'Le Long Voyage'),
      [`${B}/serie/0-Le%20Long%20Voyage`]: html('<ul><li class="ep"><a href="/e1">Épisode 1</a></li></ul>'),
    };
    const { ctx: c } = ctx(r, { relaisSourcesMs: 10, graceMs: 2000 });
    const res = await trouverEpisodes(c, [lente, second], { titres: ['Le Long Voyage'] });
    expect(res.source?.id).toBe('a');
    expect(res.episodes).toHaveLength(2);
    // La seconde (moins prioritaire) n'apparaît pas dans le diagnostic, comme avant.
    expect(res.diagnostics.map(d => d.sourceId)).toEqual(['a']);
  });

  it('films : même course, même priorité', async () => {
    const film = (id: string, base: string) =>
      normaliserSource({ id, name: id, baseUrl: base, enabled: true, search: { path: '' }, player: { iframe: 'iframe' }, movies: { search: { path: '/films?q={query}', item: 'li', title: 'a', link: 'a' }, player: { iframe: 'iframe' } } } as never);
    const r: Record<string, Reponse> = {
      [`${SITE}/films`]: latence(1500, liste('Rien')),
      [`${B}/films?q=Le`]: html(`<ul><li><a href="${B}/film/voyage">Le Long Voyage</a></li></ul>`),
      [`${B}/film/voyage`]: html('<iframe src="https://lecteur-exemple.fr/embed/film"></iframe>'),
    };
    const { ctx: c } = ctx(r, { relaisSourcesMs: 20, graceMs: 60 });
    const res = await trouverFilm(c, [film('a', SITE), film('b', B)], { titres: ['Le Long Voyage'] });
    expect(res.sources[0]?.url).toBe('https://lecteur-exemple.fr/embed/film');
    expect(res.diagnostics.map(d => d.statut)).toEqual(['interrompue', 'ok']);
  });
});
