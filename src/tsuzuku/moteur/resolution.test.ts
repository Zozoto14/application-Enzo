import { creerClient } from './reseau';
import { lirePage, sembleRenduEnJs, suggererSelecteurs } from './lecteurPage';
import { diagnostiquerRecherche, episodesSur, lecteursDansHtml, lecteursPourPage, lireEpisodes, trouverEpisodes, trouverFilm, trouverLecteurs } from './resolution';
import { normaliserSource, type DefinitionSource } from './sources';
import { fauxReseau, html } from './outilsTest';
import { testerSourcePasAPas } from './assistant';

const SITE = 'https://mediatheque-exemple.fr';
const ctx = { genererId: () => 'src-1' };

const source = (extra: Record<string, unknown> = {}): DefinitionSource =>
  normaliserSource(
    {
      name: 'Exemple',
      baseUrl: SITE,
      enabled: true,
      search: { path: '/recherche?q={query}', pathVf: '/recherche-vf?q={query}', item: 'ul.resultats li', title: 'a.titre', link: 'a.titre', image: 'img', imageAttr: 'data-src' },
      episodes: { item: 'ol.episodes li', number: '.num', title: '.nom', link: 'a' },
      player: { iframe: 'div.lecteur iframe', options: 'select.lecteurs option', optionAttr: 'value', label: 'Lecteur' },
      movies: { search: { path: '/films?q={query}', item: '.film', title: 'h3', link: 'a', year: '.an' }, player: { iframe: 'iframe.film' } },
      ...extra,
    },
    null,
    ctx,
  );

const RESULTATS = `<ul class="resultats">
  <li><a class="titre" href="/serie/etoiles-vf">Chroniques des Étoiles (VF)</a><img data-src="/img/e.jpg"></li>
  <li><a class="titre" href="/serie/etoiles-vostfr">Chroniques des Étoiles VOSTFR</a></li>
  <li><a class="titre" href="/serie/etoiles-heroines">Chroniques des Étoiles Heroines</a></li>
  <li><a class="titre" href="javascript:void(0)">Piège</a></li>
  <li><span>sans lien</span></li>
</ul>`;

const SERIE = `<nav><ul><li><a href="/">Accueil</a></li></ul></nav>
<ol class="episodes">
  <li><a href="/serie/etoiles-vf">Retour à la série</a></li>
  <li><a href="/ep/etoiles-3"><span class="num">Épisode 3</span><span class="nom">Le retour</span></a></li>
  <li><a href="/ep/etoiles-2"><span class="num">2</span><span class="nom">La route</span></a></li>
  <li><a href="/ep/etoiles-1"><span class="num">1</span><span class="nom">Le départ</span></a></li>
</ol>`;

const EPISODE = `<div class="lecteur"><iframe src="https://lecteur-exemple.fr/embed/abc"></iframe><iframe src="//cdn-exemple.fr/v/1.mp4"></iframe><iframe src="javascript:alert(1)"></iframe></div>
<select class="lecteurs"><option value="https://lecteur-exemple.fr/embed/abc">Doublon</option><option value="https://flux-exemple.fr/master.m3u8">Serveur HLS</option><option value="">vide</option></select>`;

describe('lecteur de page', () => {
  it('lit texte, attributs et selecteurs relatifs', () => {
    const p = lirePage(RESULTATS);
    const items = p.tous('ul.resultats li');
    expect(items).toHaveLength(5);
    expect(p.attr(p.premier(items[0], 'a.titre')!, 'href')).toBe('/serie/etoiles-vf');
    expect(p.texte(items[0])).toContain('Chroniques');
  });
  it('selecteur invalide : erreur explicite', () => {
    expect(() => lirePage('<p>x</p>').tous('a[[')).toThrow(/Selecteur CSS invalide/);
  });
  it('HTML tolerant (balises non fermees, entites)', () => {
    const p = lirePage('<ul><li>a &amp; b<li>c</ul>');
    expect(p.tous('li').map(l => p.texte(l))).toEqual(['a & b', 'c']);
  });
  it('suggestions et page rendue en JS', () => {
    expect(suggererSelecteurs(lirePage('<div><p class="x">1</p><p class="x">2</p><p class="x">3</p></div>'))).toEqual(['p.x (3x)']);
    expect(sembleRenduEnJs(lirePage('<body><div id="app"></div><script></script><script></script><script></script><script></script></body>'))).toBe(true);
  });
});

describe('recherche, episodes, lecteurs', () => {
  const reseau = () =>
    fauxReseau({
      [`${SITE}/recherche-vf?q=`]: html(RESULTATS),
      [`${SITE}/recherche?q=`]: html(RESULTATS),
      [`${SITE}/serie/etoiles-vf`]: html(SERIE),
      [`${SITE}/serie/etoiles-vostfr`]: html(SERIE),
      [`${SITE}/ep/etoiles-2`]: html(EPISODE),
    });

  it('choisit la bonne serie (VF preferee) et lit les episodes tries, sans le lien de retour', async () => {
    const r = reseau();
    const res = await episodesSur({ client: creerClient(r) }, source(), { titres: ['Chroniques des Étoiles'], langue: 'vf' });
    expect(res.serie?.url).toBe(`${SITE}/serie/etoiles-vf`);
    expect(res.serie?.image).toBe(`${SITE}/img/e.jpg`);
    expect(res.episodes.map(e => [e.number, e.title])).toEqual([[1, 'Le départ'], [2, 'La route'], [3, 'Le retour']]);
    expect(r.urls()[0]).toContain('/recherche-vf?q=');
  });

  it('VOSTFR : la serie VOSTFR l\'emporte', async () => {
    const res = await episodesSur({ client: creerClient(reseau()) }, source(), { titres: ['Chroniques des Étoiles'], langue: 'vostfr' });
    expect(res.serie?.url).toBe(`${SITE}/serie/etoiles-vostfr`);
  });

  it('les adresses javascript: ne sortent jamais', async () => {
    const { lecteurs } = { lecteurs: await trouverLecteurs({ client: creerClient(reseau()) }, [source()], `${SITE}/ep/etoiles-2`) };
    expect(lecteurs.every(l => /^https?:/.test(l.url))).toBe(true);
  });

  it('refuse une correspondance douteuse et l\'explique', async () => {
    const res = await trouverEpisodes({ client: creerClient(reseau()) }, [source()], { titres: ['Tout Autre Titre'] });
    expect(res.episodes).toEqual([]);
    expect(res.serie).toBeNull();
  });

  it('un candidat unique trop different est ecarte (refuse renseigne)', async () => {
    const r = fauxReseau({ [`${SITE}/recherche`]: html('<ul class="resultats"><li><a class="titre" href="/s/x">Chroniques des Étoiles Heroines</a></li></ul>') });
    const res = await trouverEpisodes({ client: creerClient(r) }, [source()], { titres: ['Chroniques des Étoiles'] });
    expect(res.episodes).toEqual([]);
    expect(res.refuse?.title).toBe('Chroniques des Étoiles Heroines');
  });

  it('adresse de serie connue : pas de recherche', async () => {
    const r = reseau();
    const eps = await lireEpisodes({ client: creerClient(r) }, source(), `${SITE}/serie/etoiles-vf`);
    expect(eps).toHaveLength(3);
    expect(r.urls()).toEqual([`${SITE}/serie/etoiles-vf`]);
  });

  it('numerotation inversee quand aucun numero n\'est lisible', async () => {
    const r = fauxReseau({ [`${SITE}/s`]: html('<ol class="e"><li><a href="/a/x-des-mots">Dernier</a></li><li><a href="/a/y-des-mots">Premier</a></li></ol>') });
    const src = source({ episodes: { item: 'ol.e li', link: 'a' } });
    const eps = await lireEpisodes({ client: creerClient(r) }, src, `${SITE}/s`);
    expect(eps.map(e => [e.number, e.url.endsWith('y-des-mots')])).toEqual([[1, true], [2, false]]);
  });

  it('lecteurs : iframes + menu, doublons et schemas dangereux ecartes, types reconnus', async () => {
    const l = await trouverLecteurs({ client: creerClient(reseau()) }, [source()], `${SITE}/ep/etoiles-2`);
    expect(l.map(x => [x.url, x.kind])).toEqual([
      ['https://lecteur-exemple.fr/embed/abc', 'iframe'],
      ['https://flux-exemple.fr/master.m3u8', 'hls'],
      ['https://cdn-exemple.fr/v/1.mp4', 'video'],
    ]);
    expect(l[1].label).toBe('Exemple - Serveur HLS');
  });

  it('une source en erreur est sautee, la suivante sert', async () => {
    const journal: string[] = [];
    const r = fauxReseau({ [`${SITE}/ep/etoiles-2`]: html(EPISODE) });
    const cassee = normaliserSource({ id: 'b', name: 'Cassee', baseUrl: 'https://cassee-exemple.fr', enabled: true, player: { iframe: 'iframe' } }, null, ctx);
    const l = await trouverLecteurs({ client: creerClient(r), journal: m => journal.push(m) }, [cassee, source()], `${SITE}/ep/etoiles-2`);
    expect(l.length).toBeGreaterThan(0);
  });

  it('les sources desactivees sont ignorees', async () => {
    const r = reseau();
    const res = await trouverEpisodes({ client: creerClient(r) }, [source({ enabled: false })], { titres: ['Chroniques des Étoiles'] });
    expect(res.episodes).toEqual([]);
    expect(r.appels).toHaveLength(0);
  });
});

describe('films', () => {
  const FILMS = `<div class="film"><a href="/film/aube-2010"><h3>L'Aube rouge</h3></a><span class="an">2010</span></div>
    <div class="film"><a href="/film/aube-2024"><h3>L'Aube rouge</h3></a><span class="an">2024</span></div>`;
  const reseau = () =>
    fauxReseau({
      [`${SITE}/films?q=`]: html(FILMS),
      [`${SITE}/film/aube-2024`]: html('<iframe class="film" src="https://lecteur-exemple.fr/f/2024"></iframe>'),
      [`${SITE}/film/aube-2010`]: html('<iframe class="film" src="https://lecteur-exemple.fr/f/2010"></iframe>'),
    });

  it('l\'annee departage un remake', async () => {
    const r = await trouverFilm({ client: creerClient(reseau()) }, [source()], { titres: ["L'Aube rouge"], annee: 2024 });
    expect(r.sources[0].url).toBe('https://lecteur-exemple.fr/f/2024');
    const r2 = await trouverFilm({ client: creerClient(reseau()) }, [source()], { titres: ["L'Aube rouge"], annee: 2010 });
    expect(r2.sources[0].url).toBe('https://lecteur-exemple.fr/f/2010');
  });

  it('source sans section films : ignoree', async () => {
    const sans = source({ movies: {} });
    const r = reseau();
    expect((await trouverFilm({ client: creerClient(r) }, [sans], { titres: ['x'] })).sources).toEqual([]);
    expect(r.appels).toHaveLength(0);
  });
});

describe('pages collees a la main', () => {
  const PAGE = `<iframe data-src="https://lecteur-exemple.fr/e/1"></iframe><video src="/media/a.mp4"></video>
    <video><source src="https://cdn-exemple.fr/b.webm"></video><div data-embed="//embed-exemple.fr/z"></div>
    <iframe src="javascript:x"></iframe><iframe src="http://127.0.0.1/interne"></iframe>`;

  it('heuristique : iframes, video, data-*, sans doublons', () => {
    const l = lecteursDansHtml(PAGE, 'https://site-exemple.fr/ep/1');
    // Le lecteur visant 127.0.0.1 est ecarte, comme javascript:.
    expect(l.map(x => [x.url, x.kind])).toEqual([
      ['https://lecteur-exemple.fr/e/1', 'iframe'],
      ['https://site-exemple.fr/media/a.mp4', 'video'],
      ['https://cdn-exemple.fr/b.webm', 'video'],
      ['https://embed-exemple.fr/z', 'iframe'],
    ]);
  });

  it('fichier direct sans aucun appel reseau', async () => {
    const r = fauxReseau({});
    const res = await lecteursPourPage({ client: creerClient(r) }, [], 'https://cdn-exemple.fr/film.m3u8');
    expect(res).toMatchObject({ method: 'direct', sources: [{ kind: 'hls' }] });
    expect(r.appels).toHaveLength(0);
  });

  it('heuristique puis repli sur la page integree', async () => {
    const r = fauxReseau({ 'https://site-exemple.fr/ep/1': html(PAGE), 'https://site-exemple.fr/vide': html('<p>rien</p>') });
    const c = { client: creerClient(r) };
    expect((await lecteursPourPage(c, [], 'https://site-exemple.fr/ep/1')).method).toBe('heuristique');
    const vide = await lecteursPourPage(c, [], 'https://site-exemple.fr/vide');
    expect(vide).toMatchObject({ method: 'page', sources: [{ kind: 'iframe', url: 'https://site-exemple.fr/vide' }] });
    expect(vide.warning).toMatch(/Aucun lecteur/);
    const inconnu = await lecteursPourPage(c, [], 'https://site-exemple.fr/absent');
    expect(inconnu.method).toBe('page');
    expect(inconnu.warning).toMatch(/pas pu etre analysee/);
  });

  it('selecteurs de la source du meme domaine d\'abord', async () => {
    const r = fauxReseau({ [`${SITE}/ep/etoiles-2`]: html(EPISODE) });
    const res = await lecteursPourPage({ client: creerClient(r) }, [source()], `${SITE}/ep/etoiles-2`);
    expect(res).toMatchObject({ method: 'source', sourceName: 'Exemple' });
  });
});

describe('diagnostic', () => {
  it('signale un selecteur sans correspondance avec des pistes', async () => {
    const r = fauxReseau({ [`${SITE}/recherche`]: html(RESULTATS) });
    const d = await diagnostiquerRecherche({ client: creerClient(r) }, source({ search: { path: '/recherche?q={query}', item: '.introuvable' } }), 'x');
    expect(d.ok).toBe(false);
    expect(d.detail).toMatch(/ne correspond a aucun/);
    const ok = await diagnostiquerRecherche({ client: creerClient(r) }, source(), 'x');
    expect(ok.ok).toBe(true);
  });
});

describe('même pipeline pour la fiche et le test de l’assistant (bogue : test OK, fiche KO)', () => {
  const SRC = normaliserSource(
    { name: 'Médiathèque', baseUrl: SITE, enabled: true, search: { path: '/recherche/?q={query}', item: 'li.carte', title: 'a', link: 'a' }, episodes: { item: 'li.ep', number: '.num', link: 'a' }, player: { iframe: 'iframe' } },
    null,
    { genererId: () => 'med' },
  );
  // Le site écrit « Frieren » (et sa saison 2) ; ses liens sont RELATIFS à la page de résultats.
  const site = (titres = ['Frieren', 'Frieren Saison 2']) =>
    fauxReseau({
      [`${SITE}/recherche/?q=`]: r => {
        const q = decodeURIComponent(new URL(r.url).searchParams.get('q') ?? '').toLowerCase();
        return html(titres.filter(t => t.toLowerCase().includes(q)).map((t, i) => `<li class="carte"><a href="../serie/${i}/">${t}</a></li>`).join(''));
      },
      [`${SITE}/serie/0/`]: html('<li class="ep"><span class="num">1</span><a href="ep-1">1</a></li><li class="ep"><span class="num">2</span><a href="ep-2">2</a></li>'),
      [`${SITE}/serie/0/ep-1`]: html('<iframe src="https://lecteur-exemple.fr/e/1"></iframe>'),
    });
  const CATALOGUE = ["Frieren: Beyond Journey's End", 'Sousou no Frieren', '葬送のフリーレン'];

  it('le test avec « Frieren » passe ET la fiche (titres du catalogue) trouve les épisodes', async () => {
    const ctxR = { client: creerClient(site()) };
    expect((await testerSourcePasAPas(ctxR, SRC, 'Frieren')).map(e => e.ok)).toEqual([true, true, true]);
    const fiche = await trouverEpisodes(ctxR, [SRC], { titres: CATALOGUE });
    expect(fiche.episodes.map(e => e.number)).toEqual([1, 2]);
    expect(fiche.serie?.title).toBe('Frieren');
    // Liens relatifs lus par rapport à la page, comme un navigateur.
    expect(fiche.episodes[0].url).toBe(`${SITE}/serie/0/ep-1`);
    expect(fiche.diagnostics[0]).toMatchObject({ source: 'Médiathèque', statut: 'ok', episodes: 2 });
    // Le test sur les titres du catalogue joue exactement la même recherche que la fiche.
    const surCatalogue = await testerSourcePasAPas(ctxR, SRC, { titres: CATALOGUE });
    expect(surCatalogue.map(e => e.ok)).toEqual([true, true, true]);
    expect(surCatalogue[0].detail).toContain('Retenu : « Frieren »');
  });

  it('diagnostic : titre introuvable, aucun résultat, erreur réseau, aucune source configurée pour les animés', async () => {
    const refuse = await trouverEpisodes({ client: creerClient(site(['Frieren Saison 2'])) }, [SRC], { titres: ['Frieren'] });
    expect(refuse.diagnostics[0]).toMatchObject({ statut: 'titre-introuvable', refuse: { title: 'Frieren Saison 2' } });
    expect(refuse.diagnostics[0].requetes[0]).toMatchObject({ requete: 'Frieren', resultats: 1 });
    const vide = await trouverEpisodes({ client: creerClient(site([])) }, [SRC], { titres: ['Frieren'] });
    expect(vide.diagnostics[0].statut).toBe('aucun-resultat');
    const panne = fauxReseau({ [`${SITE}/recherche/?q=`]: () => { throw new Error('connexion refusée'); } });
    const erreur = await trouverEpisodes({ client: creerClient(panne) }, [SRC], { titres: ['Frieren'] });
    expect(erreur.diagnostics[0].statut).toBe('erreur');
    expect(erreur.diagnostics[0].erreur).toBeTruthy();
    const filmsSeuls = normaliserSource({ name: 'Films', baseUrl: SITE, enabled: true, movies: { search: { path: '/f?q={query}', item: 'li' } } }, null, { genererId: () => 'f' });
    expect((await trouverEpisodes({ client: creerClient(site()) }, [filmsSeuls], { titres: ['Frieren'] })).diagnostics[0].statut).toBe('non-configuree');
  });
});
