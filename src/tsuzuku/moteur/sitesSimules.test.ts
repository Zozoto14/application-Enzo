/**
 * Bout en bout du moteur contre un VRAI serveur HTTP local qui simule les
 * comportements réels des sites (aucun site réel, domaines fictifs
 * `*-exemple.fr`, contenus neutres) : page de recherche construite en
 * JavaScript + API JSON, cartes <article> et résultats « épisodes », page
 * anti-robot, redirection vers un miroir, page ISO-8859-1, slug exigé,
 * point AJAX en POST, épisodes paginés et onglets de saisons.
 *
 * Le transport imite celui du PC (bureau/electron/tsuzuku.mjs, testé à part
 * avec node --test) : aucune redirection suivie, aucun cookie gardé (présence
 * signalée), corps décodé selon son jeu de caractères.
 */

import { creerClient, type Reseau } from './reseau';
import { episodesSur, trouverEpisodes, lecteursSur, type ResultatEpisodes } from './resolution';
import { normaliserSource, type DefinitionSource } from './sources';
import { testerSourcePasAPas, testReussi } from './assistant';

// Types Node minimaux : le tsconfig de l'app n'inclut pas @types/node (même façon que src/db/pilotes/node.ts).
type Octets = Uint8Array;
interface Flux {
  on(evenement: string, rappel: (donnee: Octets) => void): void;
}
interface RequeteEntrante extends Flux {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}
interface ReponseSortante {
  writeHead(statut: number, entetes: Record<string, string>): void;
  end(corps: string | Octets): void;
}
interface ReponseEntrante extends Flux {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
}
interface Serveur {
  listen(port: number, hote: string, pret: () => void): void;
  address(): { port: number };
  close(fin: () => void): void;
}
const http = require('http') as {
  createServer(gestion: (req: RequeteEntrante, res: ReponseSortante) => void): Serveur;
  request(o: object, rappel: (rep: ReponseEntrante) => void): { on(e: string, f: (err: Error) => void): void; write(c: string): void; end(): void };
};
const { TextDecoder: Decodeur } = require('util') as { TextDecoder: new (jeu: string) => { decode(o: Octets): string } };
const latin1 = (t: string): Octets => Uint8Array.from(t, c => c.charCodeAt(0) & 0xff);
const concat = (morceaux: Octets[]): Octets => {
  const sortie = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
  let i = 0;
  for (const m of morceaux) {
    sortie.set(m, i);
    i += m.length;
  }
  return sortie;
};
const enTexte = (o: Octets) => new Decodeur('utf-8').decode(o);

const page = (corps: string, tete = '') => `<!doctype html><html><head><meta charset="utf-8">${tete}</head><body>${corps}</body></html>`;
const SERIE = ['The Long Voyage', 'Le Long Voyage'];
const SAISON_2 = ['The Long Voyage Season 2', 'Le Long Voyage Saison 2'];
const listeEpisodes = (prefixe: string, de: number, a: number) => Array.from({ length: a - de + 1 }, (_, i) => `<li><a href="${prefixe}/episode-${de + i}">Épisode ${de + i}</a></li>`).join('');
const lecteur = (id: string) => page(`<div class="video"><iframe src="https://lecteur-exemple.fr/embed/${id}"></iframe></div>`);

type Rep = { statut?: number; type?: string; corps: string | Octets; entetes?: Record<string, string> };

/** L'« internet » simulé, par nom d'hôte. */
function repondre(hote: string, methode: string, chemin: string, corps: string): Rep {
  const u = new URL(chemin, 'https://x');
  const p = u.pathname;
  const q = (u.searchParams.get('q') ?? u.searchParams.get('s') ?? u.searchParams.get('terme') ?? '').toLowerCase();
  switch (hote) {
    // (1) Recherche construite en JavaScript : le HTML est une coquille ; les résultats viennent d'une API JSON.
    case 'spa-exemple.fr':
      if (p === '/recherche') return { corps: page('<div id="app"></div><script type="module" src="/assets/app.js"></script>') };
      if (p === '/api/recherche') {
        const tous = [{ titre: { rendered: 'Le Long Voyage' }, slug: 'le-long-voyage' }, { titre: { rendered: 'Lanternes de minuit' }, slug: 'lanternes' }];
        return { type: 'application/json', corps: JSON.stringify({ data: { resultats: tous.filter(x => x.titre.rendered.toLowerCase().includes(q.split(' ')[0] ?? '')) } }) };
      }
      if (p === '/anime/le-long-voyage') return { corps: page(`<h1>Le Long Voyage</h1><ul>${listeEpisodes('/anime/le-long-voyage', 1, 3)}</ul>`) };
      if (/\/episode-\d+$/.test(p)) return { corps: lecteur(`spa${p}`) };
      break;
    // (2) Cartes <article> (le sélecteur configuré venait de l'accueil) ; recherche qui liste aussi des épisodes ; épisodes paginés.
    case 'articles-exemple.fr':
      if (p === '/' && u.searchParams.has('s')) {
        return {
          corps: page(`<header><nav><a href="/">Accueil</a></nav></header><main>
            <article class="post"><h2 class="entry-title"><a href="/le-long-voyage-episode-12-vostfr/">Le Long Voyage Episode 12 VOSTFR</a></h2></article>
            <article class="post"><h2 class="entry-title"><a href="/serie/le-long-voyage/">Le Long Voyage</a></h2></article>
            <article class="post"><h2 class="entry-title"><a href="/serie/le-long-voyage-film/">Le Long Voyage – Le Film</a></h2></article></main>`),
        };
      }
      if (p === '/serie/le-long-voyage/') {
        const n = Number(u.searchParams.get('page') ?? 1);
        const suite = n < 2 ? '<div class="pagination"><a class="next" href="?page=2">Suivant</a></div>' : '';
        return { corps: page(`<div class="liste">${listeEpisodes('/le-long-voyage', n === 1 ? 1 : 4, n === 1 ? 3 : 6)}</div>${suite}`) };
      }
      if (/episode-\d+$/.test(p)) return { corps: lecteur(`art${p}`) };
      break;
    // (4) Protection anti-robot sur tout le site.
    case 'protege-exemple.fr':
      return { statut: 503, entetes: { server: 'cloudflare', 'set-cookie': '__cf_bm=abc; HttpOnly' }, corps: page('Checking your browser before accessing. <div id="challenge-platform"></div>', '<title>Just a moment...</title>') };
    // (5) Ancienne adresse redirigée vers un miroir (autre domaine), <base href> sur le miroir.
    case 'ancien-exemple.fr':
      return { statut: 301, entetes: { location: `https://miroir-exemple.fr${chemin}` }, corps: '' };
    case 'miroir-exemple.fr':
      if (p === '/recherche') return { corps: page('<ul class="res"><li><a href="serie/voyage">Le Long Voyage</a></li></ul>', '<base href="https://miroir-exemple.fr/v2/">') };
      if (p === '/v2/serie/voyage') return { corps: page(`<ol class="eps">${listeEpisodes('/v2/serie/voyage', 1, 2)}</ol>`) };
      if (/episode-\d+$/.test(p)) return { corps: lecteur(`miroir${p}`) };
      break;
    // (5) Page en ISO-8859-1 : les accents doivent survivre.
    case 'latin-exemple.fr':
      if (p === '/recherche') return { type: 'text/html; charset=iso-8859-1', corps: latin1(page('<ul class="res"><li><a href="/serie/ete">Été éternel</a></li></ul>')) };
      if (p === '/serie/ete') return { type: 'text/html; charset=iso-8859-1', corps: latin1(page(`<ul class="eps">${listeEpisodes('/serie/ete', 1, 2)}</ul>`)) };
      break;
    // (3) Aucune recherche : la page de l'oeuvre a une adresse prévisible (slug), saison en suffixe.
    case 'slug-exemple.fr':
      if (p === '/anime/le-long-voyage-saison-2') {
        return { corps: page(`<h1>Le Long Voyage Saison 2</h1><ul>${Array.from({ length: 3 }, (_, i) => `<li><a href="/anime/le-long-voyage-saison-2/s2e${i + 1}">S2E0${i + 1}</a></li>`).join('')}</ul>`, '<meta property="og:title" content="Le Long Voyage Saison 2 - Exemple">') };
      }
      if (/\/s2e\d+$/.test(p)) return { corps: lecteur(`slug${p}`) };
      return { statut: 404, corps: page('Introuvable') };
    // (1) Point AJAX en POST qui renvoie du HTML dans du JSON.
    case 'ajax-exemple.fr':
      if (p === '/ajax/recherche' && methode === 'POST') {
        const terme = new URLSearchParams(corps).get('terme') ?? '';
        return { type: 'application/json', corps: JSON.stringify({ success: true, data: terme.toLowerCase().includes('voyage') ? '<ul><li class="r"><a href="/serie/voyage">Le Long Voyage</a></li></ul>' : '' }) };
      }
      if (p === '/recherche') return { corps: page('<form id="f"></form><div id="resultats"></div><script src="/r.js"></script>') };
      if (p === '/serie/voyage') return { corps: page(`<ul>${listeEpisodes('/serie/voyage', 1, 4)}</ul>`) };
      break;
    // (2) Onglets de saisons sur la même page (blocs masqués).
    case 'saisons-exemple.fr':
      if (p === '/recherche') return { corps: page('<div class="r"><a href="/voyage">Le Long Voyage</a></div>') };
      if (p === '/voyage') {
        const s = (n: number) => `<div class="tab" ${n > 1 ? 'style="display:none"' : ''}>${Array.from({ length: 3 }, (_, i) => `<a href="/voyage/saison-${n}/episode-${i + 1}">Saison ${n} - Épisode ${i + 1}</a>`).join('')}</div>`;
        return { corps: page(`${s(1)}${s(2)}`) };
      }
      break;
  }
  return { statut: 404, corps: 'introuvable' };
}

let serveur: Serveur;
let port = 0;
beforeAll(async () => {
  serveur = http.createServer((req, res) => {
    const recu: Octets[] = [];
    req.on('data', c => recu.push(c));
    req.on('end', () => {
      const corps = enTexte(concat(recu));
      const r = repondre(String(req.headers.host ?? '').split(':')[0], req.method ?? 'GET', req.url ?? '/', corps);
      res.writeHead(r.statut ?? 200, { 'content-type': r.type ?? 'text/html; charset=utf-8', ...(r.entetes ?? {}) });
      res.end(r.corps);
    });
  });
  await new Promise<void>(ok => serveur.listen(0, '127.0.0.1', () => ok()));
  port = serveur.address().port;
});
afterAll(() => new Promise<void>(ok => serveur.close(() => ok())));

const appels: string[] = [];
/** Transport réel vers le serveur local, au contrat du PC (pas de redirection suivie, pas de cookie). */
const reseau: Reseau = {
  requete: r =>
    new Promise((ok, ko) => {
      const u = new URL(r.url);
      appels.push(`${r.methode} ${r.url}`);
      const req = http.request({ host: '127.0.0.1', port, path: u.pathname + u.search, method: r.methode, headers: { ...r.entetes, host: u.hostname } }, rep => {
        const morceaux: Octets[] = [];
        rep.on('data', c => morceaux.push(c));
        rep.on('end', () => {
          const entetes: Record<string, string> = {};
          for (const [k, v] of Object.entries(rep.headers)) {
            if (k === 'set-cookie') entetes['x-tsuzuku-cookie'] = '1';
            else entetes[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
          }
          const jeu = /charset=([\w-]+)/i.exec(entetes['content-type'] ?? '')?.[1] ?? 'utf-8';
          const statut = rep.statusCode ?? 0;
          ok({ statut, entetes, corps: statut >= 300 && statut < 400 ? '' : new Decodeur(jeu.toLowerCase() === 'iso-8859-1' ? 'windows-1252' : jeu).decode(concat(morceaux)) });
        });
      });
      req.on('error', ko);
      if (r.corps) req.write(r.corps);
      req.end();
    }),
};
const ctx = () => ({ client: creerClient(reseau) });
const source = (baseUrl: string, extra: Record<string, unknown>): DefinitionSource =>
  normaliserSource({ name: new URL(baseUrl).hostname, baseUrl, enabled: true, player: { iframe: 'iframe' }, ...extra }, null, { genererId: () => new URL(baseUrl).hostname });
const resume = (r: ResultatEpisodes) => ({ statut: r.diagnostics[0].statut, n: r.episodes.length, serie: r.serie?.url });

describe('sites simulés (serveur HTTP local, contenus neutres)', () => {
  beforeEach(() => appels.splice(0));

  it('(1) recherche construite en JavaScript : « page SPA » dit clairement, puis lue par son API JSON', async () => {
    const naif = await episodesSur(ctx(), source('https://spa-exemple.fr', { search: { path: '/recherche?q={query}', item: '.resultat', title: 'a', link: 'a' } }), { titres: SERIE });
    expect(naif.diagnostics[0].statut).toBe('aucun-resultat');
    expect(naif.diagnostics[0].requetes[0].renduJs).toBe(true);
    expect(naif.diagnostics[0].raison).toMatch(/construite en JavaScript/);
    const api = source('https://spa-exemple.fr', { search: { path: '/api/recherche?terme={q}', type: 'json', item: 'data.resultats', title: 'titre', link: 'slug', linkFormat: '/anime/{value}' } });
    const r = await episodesSur(ctx(), api, { titres: SERIE });
    expect(resume(r)).toEqual({ statut: 'ok', n: 3, serie: 'https://spa-exemple.fr/anime/le-long-voyage' });
    expect(r.diagnostics[0].requetes[0]).toMatchObject({ json: true, extraction: 'json', statut: 200 });
    expect(await lecteursSur(ctx(), api, r.episodes[1].url)).toEqual([expect.objectContaining({ url: 'https://lecteur-exemple.fr/embed/spa/anime/le-long-voyage/episode-2' })]);
  });

  it('(1) point AJAX en POST (HTML dans du JSON)', async () => {
    const src = source('https://ajax-exemple.fr', { search: { path: '/ajax/recherche', method: 'POST', body: 'action=recherche&terme={query}', item: 'li.r', title: 'a', link: 'a' } });
    const r = await episodesSur(ctx(), src, { titres: SERIE });
    expect(resume(r)).toEqual({ statut: 'ok', n: 4, serie: 'https://ajax-exemple.fr/serie/voyage' });
    expect(appels[0]).toBe('POST https://ajax-exemple.fr/ajax/recherche');
    expect(r.diagnostics[0].requetes[0]).toMatchObject({ methode: 'POST', extraction: 'json-html' });
  });

  it('(2) cartes <article> : sélecteur faux → repérage automatique ; la série passe devant l’épisode et le film ; pagination suivie', async () => {
    const src = source('https://articles-exemple.fr', { search: { path: '/?s={query}', item: 'div.derniers-ajouts .carte', title: 'h3', link: 'a' } });
    const r = await episodesSur(ctx(), src, { titres: SERIE });
    expect(resume(r)).toEqual({ statut: 'ok', n: 6, serie: 'https://articles-exemple.fr/serie/le-long-voyage/' });
    expect(r.diagnostics[0].requetes[0]).toMatchObject({ extraction: 'generique', blocs: 0 });
    expect(r.diagnostics[0].lectureEpisodes).toMatchObject({ pages: 2, extraction: 'generique' });
    expect(r.diagnostics[0].meilleurs?.[0].title).toBe('Le Long Voyage');
  });

  it('(2) onglets de saisons masqués : la saison de la fiche est gardée', async () => {
    const src = source('https://saisons-exemple.fr', { search: { path: '/recherche?q={query}', item: 'div.r', title: 'a', link: 'a' } });
    const s2 = await episodesSur(ctx(), src, { titres: SAISON_2 });
    expect(s2.episodes.map(e => e.url)).toEqual([1, 2, 3].map(n => `https://saisons-exemple.fr/voyage/saison-2/episode-${n}`));
    const s1 = await episodesSur(ctx(), src, { titres: SERIE });
    expect(s1.episodes.map(e => e.url)[0]).toBe('https://saisons-exemple.fr/voyage/saison-1/episode-1');
  });

  it('(3) slug exigé : la page de l’oeuvre est ouverte directement, variantes de saison essayées', async () => {
    const src = source('https://slug-exemple.fr', { search: { path: '/anime/{slug}' } });
    const r = await episodesSur(ctx(), src, { titres: SAISON_2 });
    expect(resume(r)).toEqual({ statut: 'ok', n: 3, serie: 'https://slug-exemple.fr/anime/le-long-voyage-saison-2' });
    expect(r.diagnostics[0].requetes.some(q => q.statut === 404)).toBe(true);
  });

  it('(4) anti-robot : « bloquée », pas « aucun résultat », et une seule requête (inutile d’insister)', async () => {
    const r = await episodesSur(ctx(), source('https://protege-exemple.fr', { search: { path: '/recherche?q={query}', item: '.r' } }), { titres: SERIE });
    expect(r.diagnostics[0].statut).toBe('bloquee');
    expect(r.diagnostics[0].raison).toMatch(/bloque les requêtes automatiques/);
    expect(r.diagnostics[0].requetes).toHaveLength(1);
    expect(r.diagnostics[0].requetes[0]).toMatchObject({ statut: 503, blocage: expect.stringMatching(/Just a moment/) });
    expect(appels).toHaveLength(1);
  });

  it('(5) redirection vers un miroir (autre domaine) et <base href> : liens résolus sur le miroir', async () => {
    const src = source('https://ancien-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ol.eps li', link: 'a' } });
    const r = await episodesSur(ctx(), src, { titres: SERIE });
    expect(resume(r)).toEqual({ statut: 'ok', n: 2, serie: 'https://miroir-exemple.fr/v2/serie/voyage' });
    expect(r.diagnostics[0].requetes[0].urlFinale).toMatch(/^https:\/\/miroir-exemple\.fr\/recherche/);
  });

  it('(5) page ISO-8859-1 : les accents survivent, le titre est reconnu', async () => {
    const src = source('https://latin-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ul.eps li', link: 'a' } });
    const r = await episodesSur(ctx(), src, { titres: ['Été éternel'] });
    expect(resume(r)).toEqual({ statut: 'ok', n: 2, serie: 'https://latin-exemple.fr/serie/ete' });
  });

  it('(9) plusieurs sources : une source bloquée n’empêche pas la suivante', async () => {
    const r = await trouverEpisodes(ctx(), [source('https://protege-exemple.fr', { search: { path: '/r?q={query}', item: '.r' } }), source('https://latin-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' } })], { titres: ['Ete eternel'] });
    expect(r.episodes).toHaveLength(2);
    expect(r.diagnostics.map(d => d.statut)).toEqual(['bloquee', 'ok']);
  });

  it('(7) le test pas à pas de l’assistant suit le même pipeline (API JSON)', async () => {
    const api = source('https://spa-exemple.fr', { search: { path: '/api/recherche?terme={q}', type: 'json', item: 'data.resultats', title: 'titre', link: 'slug', linkFormat: '/anime/{value}' } });
    const etapes = await testerSourcePasAPas(ctx(), api, { titres: SERIE });
    expect(testReussi(etapes)).toBe(true);
    const bloque = await testerSourcePasAPas(ctx(), source('https://protege-exemple.fr', { search: { path: '/r?q={query}', item: '.r' } }), { titres: SERIE });
    expect(bloque[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/bloque les requêtes automatiques/) });
  });
});
