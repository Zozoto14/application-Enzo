import { lirePage, sembleRenduEnJs } from './lecteurPage';
import {
  analyserJson,
  baseDePage,
  candidatsGeneriques,
  decoderEntites,
  episodesGeneriques,
  estReponseJson,
  filtrerSaison,
  fragmentHtmlJson,
  lienSuivant,
  numeroEtSaison,
  redirectionMeta,
  resultatsJson,
  texteJson,
  titresDePage,
  valeurJson,
} from './extraction';

const SITE = 'https://mediatheque-exemple.fr';

describe('JSON : chemins, listes, fragments', () => {
  const api = { data: { resultats: [{ titre: { rendered: 'Les Chroniques &#8217;Étoile' }, slug: 'chroniques', annee: 2024 }, { titre: 'Sans lien' }] } };
  it('valeur à un chemin (points, crochets, $.)', () => {
    expect(valeurJson(api, 'data.resultats[0].slug')).toBe('chroniques');
    expect(valeurJson(api, '$.data.resultats.0.annee')).toBe(2024);
    expect(valeurJson(api, 'data.absent.x')).toBeUndefined();
    expect(valeurJson(api, '')).toBe(api);
  });
  it('texte : chaîne (balises et entités retirées), nombre, objet « rendered »', () => {
    expect(texteJson('<b>A &amp; B</b>')).toBe('A & B');
    expect(texteJson(12)).toBe('12');
    expect(texteJson({ rendered: 'Titre' })).toBe('Titre');
    expect(decoderEntites('L&#039;été &eacute;')).toBe("L'été é");
  });
  it('résultats par chemins configurés, lien fabriqué depuis un slug', () => {
    const r = resultatsJson(api, { item: 'data.resultats', title: 'titre', link: 'slug', image: '', year: 'annee', linkFormat: '/anime/{value}' }, SITE);
    expect(r).toEqual([{ title: 'Les Chroniques ’Étoile', url: `${SITE}/anime/chroniques`, image: null, year: '2024' }]);
  });
  it('repérage automatique d’une liste (titre + url) et d’un fragment HTML', () => {
    const auto = resultatsJson({ ok: true, payload: { items: [{ name: 'Voyage', url: '/serie/voyage' }] } }, { item: '', title: '', link: '', image: '', year: '', linkFormat: '' }, SITE);
    expect(auto).toEqual([{ title: 'Voyage', url: `${SITE}/serie/voyage`, image: null, year: null }]);
    expect(fragmentHtmlJson({ success: true, data: '<ul><li><a href="/serie/1">Un</a></li></ul>' })).toContain('/serie/1');
    expect(analyserJson('pas du json')).toBeUndefined();
    expect(estReponseJson('application/json; charset=utf-8', '[]')).toBe(true);
    expect(estReponseJson(null, '{"a":1}')).toBe(true);
    expect(estReponseJson('text/html', '{"a":1}')).toBe(false);
  });
});

describe('résultats de recherche sans sélecteur', () => {
  it('cartes <article>, lien à attribut title, JSON-LD ; menus et pages techniques écartés', () => {
    const page = lirePage(`
      <header><nav><a href="/">Accueil</a><a href="/serie/menu">Série du menu</a></nav></header>
      <main>
        <article class="post"><a href="/serie/voyage"><img src="/i/v.jpg" alt="Affiche"></a><h2 class="entry-title"><a href="/serie/voyage">Le Long Voyage</a></h2></article>
        <div class="grille"><a href="/serie/lanternes" title="Lanternes de minuit"><img data-src="/i/l.jpg"></a></div>
        <a href="/genre/aventure">Aventure</a><a href="/page/2">2</a><a href="/?s=voyage">Rechercher</a>
        <a href="https://autre-exemple.fr/serie/x">Ailleurs</a>
      </main>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"url":"${SITE}/serie/etoiles","name":"Chroniques des Étoiles"}]}</script>`);
    const c = candidatsGeneriques(page, `${SITE}/recherche?q=x`, SITE);
    const parUrl = Object.fromEntries(c.map(x => [x.url.replace(SITE, ''), x]));
    expect(parUrl['/serie/voyage'].title).toBe('Le Long Voyage');
    expect(parUrl['/serie/voyage'].origine).toBe('carte');
    expect(parUrl['/serie/lanternes'].title).toBe('Lanternes de minuit');
    expect(parUrl['/serie/lanternes'].image).toBe(`${SITE}/i/l.jpg`);
    expect(parUrl['/serie/etoiles'].origine).toBe('json-ld');
    expect(Object.keys(parUrl)).not.toEqual(expect.arrayContaining(['/serie/menu']));
    expect(c.some(x => /genre|page\/2|\?s=|autre-exemple|^\/$/.test(x.url.replace(SITE, '')))).toBe(false);
  });
  it('titres d’une page d’oeuvre : og:title, h1, <title> et sa première partie', () => {
    const page = lirePage('<head><title>Le Long Voyage - Médiathèque exemple</title><meta property="og:title" content="Le Long Voyage (VOSTFR)"></head><body><h1>Le Long Voyage</h1></body>');
    expect(titresDePage(page)).toEqual(['Le Long Voyage (VOSTFR)', 'Le Long Voyage', 'Le Long Voyage - Médiathèque exemple']);
  });
  it('<base href> et <meta refresh> (miroir)', () => {
    const page = lirePage('<head><base href="https://miroir-exemple.fr/site/"><meta http-equiv="Refresh" content="0; url=https://miroir-exemple.fr/"></head>');
    expect(baseDePage(page, `${SITE}/r`)).toBe('https://miroir-exemple.fr/site/');
    expect(redirectionMeta(page, `${SITE}/`)).toBe('https://miroir-exemple.fr/');
    expect(baseDePage(lirePage('<p>x</p>'), `${SITE}/r`)).toBe(`${SITE}/r`);
  });
});

describe('épisodes sans sélecteur', () => {
  it('numéro et saison : « Épisode N », « EP N », « E01 », « S2E03 », « 第N話 », fin d’adresse', () => {
    expect(numeroEtSaison('Épisode 12', '')).toEqual({ number: 12, saison: null });
    expect(numeroEtSaison('EP 03 VOSTFR', '')).toEqual({ number: 3, saison: null });
    expect(numeroEtSaison('E07', '')).toEqual({ number: 7, saison: null });
    expect(numeroEtSaison('S2E03', '')).toEqual({ number: 3, saison: 2 });
    expect(numeroEtSaison('第5話', '')).toEqual({ number: 5, saison: null });
    expect(numeroEtSaison('Voir', '/serie/voyage/saison-2/episode-4')).toEqual({ number: 4, saison: 2 });
    expect(numeroEtSaison('9', '/serie/voyage/9')).toEqual({ number: 9, saison: null });
    expect(numeroEtSaison('Accueil', '/serie/voyage')).toBeNull();
  });
  it('liens, menus <option>, data-*, blocs masqués ; menus de navigation écartés', () => {
    const page = lirePage(`
      <nav><a href="/serie/voyage/episode-99">Épisode 99 (menu)</a></nav>
      <div class="onglet" style="display:none"><a href="/serie/voyage/episode-1">Épisode 1</a><a href="/serie/voyage/episode-2">Épisode 2</a></div>
      <select class="lecteurs"><option value="/serie/voyage/episode-3">EP 3</option></select>
      <button data-episode="4" data-url="/serie/voyage/episode-4">▶</button>`);
    const e = episodesGeneriques(page, `${SITE}/serie/voyage`, SITE, `${SITE}/serie/voyage`);
    expect(e.map(x => x.number).sort()).toEqual([1, 2, 3, 4]);
  });
  it('saison voulue gardée quand la page en mêle plusieurs', () => {
    const e = [{ number: 1, saison: 1 }, { number: 2, saison: 1 }, { number: 1, saison: 2 }];
    expect(filtrerSaison(e, 2)).toEqual([{ number: 1, saison: 2 }]);
    expect(filtrerSaison(e, null)).toHaveLength(2);
    expect(filtrerSaison([{ number: 1, saison: null }], 2)).toHaveLength(1);
  });
  it('pagination : rel=next, « Suivant », sélecteur configuré', () => {
    expect(lienSuivant(lirePage('<link rel="next" href="?page=2">'), `${SITE}/serie/v`)).toBe(`${SITE}/serie/v?page=2`);
    expect(lienSuivant(lirePage('<div class="pagination"><a href="/serie/v/p/2">Suivant</a></div>'), `${SITE}/serie/v`)).toBe(`${SITE}/serie/v/p/2`);
    expect(lienSuivant(lirePage('<a class="plus" href="/p3">+</a>'), `${SITE}/serie/v`, 'a.plus')).toBe(`${SITE}/p3`);
    expect(lienSuivant(lirePage('<p>fin</p>'), `${SITE}/serie/v`)).toBeNull();
  });
});

describe('page construite en JavaScript (SPA)', () => {
  it('un seul script et un point de montage vide suffisent (avant : 4 scripts exigés)', () => {
    expect(sembleRenduEnJs(lirePage('<html><body><div id="app"></div><script type="module" src="/assets/index.js"></script></body></html>'))).toBe(true);
    expect(sembleRenduEnJs(lirePage('<body><div id="__next"></div><script src="/a.js"></script><script>window.x = "' + 'y'.repeat(5000) + '"</script></body>'))).toBe(true);
    expect(sembleRenduEnJs(lirePage('<body><noscript>Activez JavaScript pour utiliser ce site.</noscript><script src="/a.js"></script></body>'))).toBe(true);
  });
  it('une vraie page de résultats n’est pas prise pour une SPA', () => {
    const liens = Array.from({ length: 20 }, (_, i) => `<li><a href="/serie/${i}">Série numéro ${i} avec un titre assez long pour compter</a></li>`).join('');
    expect(sembleRenduEnJs(lirePage(`<body><div id="app"><ul>${liens}</ul></div><script src="/a.js"></script></body>`))).toBe(false);
  });
});
