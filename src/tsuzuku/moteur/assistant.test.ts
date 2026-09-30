/**
 * Assistant d'ajout de source : extraction de structure, prompt, validation
 * du JSON renvoyé. Pages NEUTRES faites main (médiathèque fictive) : aucun
 * site réel, aucune source préconfigurée.
 */

import { FORMAT_SOURCE, RAPPEL_DROITS, analyserSite, analyserStructure, extraitHtml, genererPrompt, validerSourceJson } from './assistant';
import { creerClient } from './reseau';
import { fauxReseau, html } from './outilsTest';

const PAGE = `<!doctype html><html><head><title>Médiathèque exemple · recherche</title>
<style>.carte{color:red}</style><script>var suivi = "ne doit pas apparaître";</script></head>
<body>
  <!-- commentaire interne -->
  <form class="recherche" action="/catalogue/recherche" method="get"><input name="q"><button>OK</button></form>
  <ul class="resultats">
    <li class="carte"><a class="titre" href="/oeuvre/le-voyage">Le voyage</a><img src="/i/1.jpg"></li>
    <li class="carte"><a class="titre" href="/oeuvre/la-riviere">La rivière</a><img src="/i/2.jpg"></li>
    <li class="carte"><a class="titre" href="/oeuvre/les-nuages">Les nuages</a><img src="/i/3.jpg"></li>
  </ul>
  <ol class="episodes">
    <li class="ep"><a href="/oeuvre/le-voyage/episode-1"><span class="num">1</span> Épisode 1</a></li>
    <li class="ep"><a href="/oeuvre/le-voyage/episode-2"><span class="num">2</span> Épisode 2</a></li>
  </ol>
  <div class="lecteur"><iframe class="video" src="https://lecteur-exemple.fr/embed/abc"></iframe></div>
  <select class="lecteurs"><option value="https://lecteur-exemple.fr/1">Lecteur 1</option><option value="https://lecteur-exemple.fr/2">Lecteur 2</option></select>
</body></html>`;

const JSON_IA = {
  name: 'Médiathèque exemple',
  baseUrl: 'https://mediatheque-exemple.fr',
  language: 'vostfr',
  search: { path: '/catalogue/recherche?q={query}', item: 'ul.resultats li.carte', title: 'a.titre', link: 'a.titre', image: 'img', imageAttr: 'src' },
  episodes: { item: 'ol.episodes li.ep', number: '.num', link: 'a' },
  player: { iframe: 'div.lecteur iframe', attr: 'src', options: 'select.lecteurs option', optionAttr: 'value' },
  movies: { search: { path: '', item: '' }, player: { iframe: '' } },
};

describe('assistant : extraction de structure', () => {
  const r = analyserStructure(PAGE, 'https://mediatheque-exemple.fr/catalogue');

  it('titre, formulaires de recherche, éléments récurrents', () => {
    expect(r.titre).toBe('Médiathèque exemple · recherche');
    expect(r.formulaires).toEqual([{ action: '/catalogue/recherche', methode: 'get', champs: ['q'] }]);
    const li = r.recurrents.find(x => x.selecteur === 'li.carte');
    expect(li).toMatchObject({ nombre: 3, exemple: 'Le voyage' });
    expect(r.recurrents.map(x => x.selecteur)).toEqual(expect.arrayContaining(['a.titre', 'li.ep', 'span.num']));
    expect(r.images).toBe(3);
    expect(r.renduJs).toBe(false);
  });

  it('liens d’épisodes, iframes, menus de lecteurs', () => {
    expect(r.liensEpisodes.map(l => l.href)).toEqual(['/oeuvre/le-voyage/episode-1', '/oeuvre/le-voyage/episode-2']);
    expect(r.iframes).toEqual([{ selecteur: 'iframe.video', src: 'https://lecteur-exemple.fr/embed/abc' }]);
    expect(r.menus).toEqual([{ selecteur: 'select.lecteurs option', options: 2, exemple: 'https://lecteur-exemple.fr/1 — Lecteur 1' }]);
  });

  it('extrait allégé : ni scripts, ni styles, ni commentaires ; borné', () => {
    const e = extraitHtml(PAGE);
    expect(e).not.toMatch(/ne doit pas apparaître|color:red|commentaire interne/);
    expect(e).toContain('<li class="carte">');
    const long = extraitHtml(`<div>${'x'.repeat(50000)}</div>`, 1000);
    expect(long.length).toBeLessThan(1100);
    expect(long).toMatch(/extrait tronqué/);
  });

  it('page construite en JavaScript : signalée', () => {
    const js = analyserStructure(`<html><body><div id="app"></div>${'<script>1</script>'.repeat(5)}</body></html>`, 'https://exemple.fr');
    expect(js.renduJs).toBe(true);
    expect(genererPrompt(js, '')).toMatch(/construite en JavaScript/);
  });
});

describe('assistant : prompt', () => {
  const prompt = genererPrompt(analyserStructure(PAGE, 'https://mediatheque-exemple.fr/catalogue'), extraitHtml(PAGE));

  it('générique (animés ET films) et décrit TOUS les paramètres du format', () => {
    expect(prompt).toMatch(/ANIMÉS/);
    expect(prompt).toMatch(/FILMS/);
    for (const cle of ['"search"', '"episodes"', '"player"', '"movies"', '"path"', '"pathVf"', '"pathVostfr"', '"item"', '"title"', '"link"', '"image"', '"imageAttr"', '"number"', '"iframe"', '"attr"', '"label"', '"options"', '"optionAttr"', '"optionLabel"', '"year"', '"language"', 'vf', 'vostfr', '{query}']) {
      expect(prompt).toContain(cle);
      expect(FORMAT_SOURCE).toContain(cle);
    }
  });

  it('règles de qualité, résumé et extrait joints', () => {
    expect(prompt).toMatch(/ROBUSTES/);
    expect(prompt).toMatch(/AU MOINS 2 exemples/);
    expect(prompt).toContain('li.carte × 3');
    expect(prompt).toContain('GET /catalogue/recherche ; champs : q');
    expect(prompt).toContain('```html');
    expect(prompt).not.toContain('ne doit pas apparaître');
  });

  it('rappel des droits', () => {
    expect(RAPPEL_DROITS).toBe('N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.');
  });
});

describe('assistant : validation du JSON renvoyé', () => {
  it('accepte le JSON (même dans un bloc ```json entouré de texte) et le normalise', () => {
    const v = validerSourceJson(`Voici la source :\n\`\`\`json\n${JSON.stringify(JSON_IA, null, 2)}\n\`\`\`\nTesté sur « Le voyage » et « La rivière ».`, 'https://mediatheque-exemple.fr/catalogue');
    expect(v.erreurs).toEqual([]);
    expect(v.avertissements).toEqual([]);
    expect(v.source).toMatchObject({ name: 'Médiathèque exemple', language: 'vostfr', enabled: true, baseUrl: 'https://mediatheque-exemple.fr/' });
    expect(v.source!.search.item).toBe('ul.resultats li.carte');
  });

  it('l’identifiant et la date du JSON collé sont ignorés', () => {
    const v = validerSourceJson(JSON.stringify({ ...JSON_IA, id: 'impose', createdAt: '2000-01-01' }), undefined, { genererId: () => 'neuf', horloge: { maintenant: () => Date.UTC(2026, 8, 30) } });
    expect(v.source).toMatchObject({ id: 'neuf', createdAt: '2026-09-30T00:00:00.000Z' });
  });

  it('refuse un texte qui n’est pas du JSON', () => {
    expect(validerSourceJson('bonjour').erreurs[0]).toMatch(/pas un JSON valide/);
    expect(validerSourceJson('[1]').erreurs[0]).toMatch(/objet/);
  });

  it('refuse un sélecteur CSS invalide, un chemin sans {query}, une source sans partie utilisable', () => {
    const v = validerSourceJson(JSON.stringify({ ...JSON_IA, search: { ...JSON_IA.search, path: '/recherche', item: 'li[[' } }));
    expect(v.source).toBeUndefined();
    expect(v.erreurs.join(' ')).toMatch(/Sélecteur CSS invalide pour search.item/);
    expect(v.erreurs.join(' ')).toMatch(/search.path doit contenir \{query\}/);
    const vide = validerSourceJson(JSON.stringify({ name: 'Rien', baseUrl: 'https://exemple.fr' }));
    expect(vide.erreurs.join(' ')).toMatch(/Aucune partie utilisable/);
  });

  it('refuse une adresse non publique (schéma du moteur)', () => {
    expect(validerSourceJson(JSON.stringify({ ...JSON_IA, baseUrl: 'http://192.168.1.10' })).erreurs.length).toBe(1);
  });

  it('avertit : autre site que la page analysée, films sans lecteur', () => {
    const v = validerSourceJson(JSON.stringify({ ...JSON_IA, movies: { search: { path: '/f?q={query}', item: '.film' } } }), 'https://autre-exemple.fr/page');
    expect(v.source).toBeDefined();
    expect(v.avertissements.join(' ')).toMatch(/n’est pas celle de la page analysée/);
    expect(v.avertissements.join(' ')).toMatch(/Films : pas de lecteur/);
  });
});

describe('assistant : lecture par le client protégé', () => {
  it('lit la page et en tire résumé et extrait', async () => {
    const client = creerClient(fauxReseau({ 'https://mediatheque-exemple.fr/catalogue': html(PAGE) }, { resoudre: async () => ['93.184.216.34'] }));
    const { resume, extrait } = await analyserSite(client, 'https://mediatheque-exemple.fr/catalogue');
    expect(resume.formulaires).toHaveLength(1);
    expect(extrait).toContain('ol class="episodes"');
  });

  it('anti-SSRF : une adresse locale ou privée est refusée avant toute requête', async () => {
    const reseau = fauxReseau({});
    const client = creerClient(reseau, { resoudre: async () => ['10.0.0.1'] });
    await expect(analyserSite(client, 'http://127.0.0.1/admin')).rejects.toBeTruthy();
    await expect(analyserSite(client, 'https://interne-exemple.fr/')).rejects.toBeTruthy();
    expect(reseau.appels).toHaveLength(0);
  });

  it('refuse ce qui n’est pas une page HTML, et une adresse vide', async () => {
    const client = creerClient(fauxReseau({ 'https://exemple.fr/image': { statut: 200, entetes: { 'content-type': 'image/png' }, corps: 'x' } }, { resoudre: async () => ['93.184.216.34'] }));
    await expect(analyserSite(client, 'https://exemple.fr/image')).rejects.toThrow(/pas une page HTML/);
    await expect(analyserSite(client, '  ')).rejects.toThrow(/Collez/);
  });

  it('taille bornée : une page trop grosse est refusée', async () => {
    const client = creerClient(fauxReseau({ 'https://exemple.fr/grosse': html('x'.repeat(3 * 1024 * 1024)) }, { resoudre: async () => ['93.184.216.34'] }));
    await expect(analyserSite(client, 'https://exemple.fr/grosse')).rejects.toBeTruthy();
  });
});
