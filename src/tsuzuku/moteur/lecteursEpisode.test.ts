/**
 * Lecteurs d'une page d'épisode (cas réel : « la zone du lecteur affiche la
 * page entière de l'épisode, sans style »). Balisage d'un thème WordPress de
 * catalogue : en-tête, recherche, filtres, menus, genres, puis le bloc vidéo
 * dont les lecteurs sont des NOMS dans un menu (« LECTEUR A/B/C/D ») :
 *  - A : choisi, son iframe est dans la page ;
 *  - B : table des lecteurs dans un script (iframe encodée en base64) ;
 *  - C : chargé en AJAX (`data-post` / `data-nume`) ;
 *  - D : la page rechargée avec `?host=LECTEUR+D`.
 * Domaines fictifs `*-exemple.fr`, aucune requête réelle.
 */
import { creerClient } from './reseau';
import { adresseDansValeur, estLaPage, extraireLecteurs, texteDiagnosticLecteurs } from './lecteursEpisode';
import { lecteursPourPage, trouverLecteurs, trouverLecteursDetail } from './resolution';
import { normaliserSource } from './sources';
import { fauxReseau, html, json } from './outilsTest';

const SITE = 'https://catalogue-exemple.fr';
const EP = `${SITE}/anime/voyage/episode-1/`;
/** Base64 d'un texte ASCII (sans dépendre de Buffer). */
const b64 = (s: string) => {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let sortie = '';
  for (let i = 0; i < s.length; i += 3) {
    const n = (s.charCodeAt(i) << 16) | ((s.charCodeAt(i + 1) || 0) << 8) | (s.charCodeAt(i + 2) || 0);
    sortie += a[(n >> 18) & 63] + a[(n >> 12) & 63] + (i + 1 < s.length ? a[(n >> 6) & 63] : '=') + (i + 2 < s.length ? a[n & 63] : '=');
  }
  return sortie;
};

/** Tout ce que la page du site affiche autour du lecteur (ce qui ne doit JAMAIS apparaître dans le lecteur). */
export const HABILLAGE_SITE = `
  <header><form class="search-form"><input type="text" placeholder="Rechercher en VOSTFR..." name="s"></form>
  <div class="search-advanced"><label><input type="checkbox"> Generic filters</label><label><input type="checkbox" checked> Exact matches only</label>
  <label><input type="checkbox" checked> Search in title</label><label><input type="checkbox" checked> Search in content</label></div>
  <nav class="main-menu"><ul><li><a href="/">ACCUEIL</a></li><li><a href="/liste/">LISTE</a></li><li><a href="/nouveau/">NOUVEAU</a></li><li><a href="/bientot/">BIENTÔT</a></li><li><a href="/?s=&post_type=wp-manga">RECHERCHE AV</a></li></ul></nav></header>
  <ul class="genres"><li><a href="/genre/action/">Action</a></li><li><a href="/genre/aventure/">Aventure</a></li><li><a href="/genre/comedie/">Comédie</a></li></ul>
  <aside class="widget"><iframe src="https://social-exemple.fr/facebook.com/plugins/page.php"></iframe></aside>`;

const pageEpisode = (o: { hote?: string; sansScript?: boolean } = {}) =>
  html(`${HABILLAGE_SITE}
  <div class="c-select-bottom"><select class="selectpicker host-select">
    <option value="LECTEUR A"${o.hote ? '' : ' selected'}>LECTEUR A</option>
    <option value="LECTEUR B">LECTEUR B</option>
    <option value="LECTEUR C" data-post="4242" data-nume="3" data-type="tv">LECTEUR C</option>
    <option value="LECTEUR D"${o.hote === 'LECTEUR D' ? ' selected' : ''}>LECTEUR D</option>
  </select></div>
  <div class="chapter-video-frame"><p><iframe src="${o.hote === 'LECTEUR D' ? 'https://hote-d-exemple.fr/v/444' : 'https://hote-a-exemple.fr/embed/111'}" allowfullscreen></iframe></p></div>
  ${o.sansScript ? '' : `<script>var thisChapterSources = {"LECTEUR B":"${b64('<iframe src="https://hote-b-exemple.fr/e/222" frameborder="0"></iframe>')}"};</script>`}
  <footer>Pied de page du site</footer>`);

const reseau = () =>
  fauxReseau({
    [`${EP}?host=LECTEUR+D`]: pageEpisode({ hote: 'LECTEUR D' }),
    [EP]: pageEpisode(),
    [`${SITE}/wp-admin/admin-ajax.php`]: r => (String(r.corps).includes('nume=3') ? json({ embed_url: '<iframe src="https:\/\/hote-c-exemple.fr\/embed\/333"></iframe>', type: 'iframe' }) : json({ embed_url: '' })),
  });

const source = (player: Record<string, string>) => normaliserSource({ name: 'Catalogue', baseUrl: SITE, enabled: true, player }, null, { genererId: () => 'cat' });

describe('lecteurs d’une page d’épisode : jamais la page du site', () => {
  for (const [nom, player] of Object.entries<Record<string, string>>({
    'source configurée (menu de lecteurs)': { options: 'select.host-select option', optionAttr: 'value' },
    'sans sélecteur (repérage automatique)': {},
  })) {
    it(`${nom} : 4 lecteurs, chacun l’embed de son hôte`, async () => {
      const r = reseau();
      const l = await trouverLecteurs({ client: creerClient(r) }, [source(player)], EP);
      expect(l.map(x => [x.label, x.url, x.kind])).toEqual([
        ['Catalogue - LECTEUR A', 'https://hote-a-exemple.fr/embed/111', 'iframe'],
        ['Catalogue - LECTEUR B', 'https://hote-b-exemple.fr/e/222', 'iframe'],
        ['Catalogue - LECTEUR C', 'https://hote-c-exemple.fr/embed/333', 'iframe'],
        ['Catalogue - LECTEUR D', 'https://hote-d-exemple.fr/v/444', 'iframe'],
      ]);
      // Aucune adresse ne retombe sur le site source (cause du bug : « LECTEUR A » lu comme adresse relative).
      expect(l.every(x => !x.url.startsWith(SITE))).toBe(true);
      // L'AJAX du thème : action, article, numéro du lecteur.
      const ajax = r.appels.find(a => a.url.endsWith('/wp-admin/admin-ajax.php'));
      expect(ajax).toMatchObject({ methode: 'POST' });
      expect(ajax!.corps).toBe('action=doo_player_ajax&post=4242&nume=3&type=tv');
    });
  }

  it('une valeur qui n’est pas une adresse n’est jamais résolue en page relative', async () => {
    const r = fauxReseau({ [EP]: html(`${HABILLAGE_SITE}<select class="lecteurs"><option value="LECTEUR X">LECTEUR X</option></select>`) });
    const d = await trouverLecteursDetail({ client: creerClient(r) }, [source({ options: 'select.lecteurs option' })], EP);
    expect(d.lecteurs).toEqual([]);
    expect(r.urls().some(u => u.includes('LECTEUR%20X'))).toBe(false);
  });

  it('aucun lecteur extractible : liste vide et diagnostic (sélecteurs, iframes, data-src)', async () => {
    const r = fauxReseau({ [EP]: html(`${HABILLAGE_SITE}<div class="video"><p>Bientôt</p></div>`) });
    const d = await trouverLecteursDetail({ client: creerClient(r) }, [source({ iframe: 'div.video iframe' })], EP);
    expect(d.lecteurs).toEqual([]);
    expect(d.diagnostic).toMatchObject({ url: EP, iframes: 0, dataSrc: 0, options: 0 });
    expect(d.diagnostic!.selecteurs).toEqual(expect.arrayContaining(['div.video iframe', expect.stringMatching(/^menus de lecteurs courants/), 'iframe[src], iframe[data-src], iframe[data-lazy-src]']));
    expect(texteDiagnosticLecteurs(d.diagnostic!)).toMatch(/0 iframe, 0 attribut data-src.*Sélecteurs essayés : div\.video iframe/);
  });

  it('page d’une source sans lecteur (lien manuel) : pas de repli « page intégrée »', async () => {
    const r = fauxReseau({ [EP]: html(HABILLAGE_SITE) });
    const res = await lecteursPourPage({ client: creerClient(r) }, [source({ iframe: 'div.video iframe' })], EP);
    expect(res.sources).toEqual([]);
    expect(res.warning).toMatch(/Lecteur introuvable/);
  });

  it('anciennes listes : l’option qui pointe sur la page de l’épisode est écartée', async () => {
    const r = fauxReseau({ [EP]: html(`<select class="l"><option value="${EP}?host=A">A</option><option value="/lecteur/embed/5">B</option></select>`) });
    const d = await trouverLecteursDetail({ client: creerClient(r) }, [source({ options: 'select.l option' })], EP);
    // A : la page elle-même → clé « A », rechargée avec ?host= (404 ici) ; B : chemin relatif → absolu, gardé.
    expect(d.lecteurs.map(x => x.url)).toEqual([`${SITE}/lecteur/embed/5`]);
  });
});

describe('extraction : formes des lecteurs', () => {
  const ex = (corps: string, o = {}) => extraireLecteurs(`<html><body>${corps}</body></html>`, EP, o);

  it('iframes paresseux (data-src, data-lazy-src), relatifs et sans schéma rendus absolus', async () => {
    const { lecteurs } = await ex('<iframe data-src="//hote-a-exemple.fr/e/1"></iframe><iframe data-lazy-src="/player/2"></iframe><iframe src="about:blank" data-src="https://hote-b-exemple.fr/e/3"></iframe>');
    expect(lecteurs.map(l => l.url)).toEqual(['https://hote-a-exemple.fr/e/1', `${SITE}/player/2`, 'https://hote-b-exemple.fr/e/3']);
  });

  it('onglets data-embed / data-video (base64, JSON, HTML d’iframe)', async () => {
    const { lecteurs } = await ex(
      `<ul class="onglets"><li data-embed="${b64('https://hote-a-exemple.fr/e/1')}">LECTEUR A</li><li data-video='{"file":"https://cdn-exemple.fr/v.m3u8"}'>LECTEUR B</li><li data-player="&lt;iframe src=&quot;https://hote-c-exemple.fr/e/3&quot;&gt;&lt;/iframe&gt;">LECTEUR C</li></ul>`,
    );
    expect(lecteurs.map(l => [l.url, l.kind])).toEqual([
      ['https://hote-a-exemple.fr/e/1', 'iframe'],
      ['https://cdn-exemple.fr/v.m3u8', 'hls'],
      ['https://hote-c-exemple.fr/e/3', 'iframe'],
    ]);
  });

  it('menu dont les valeurs sont des adresses encodées en base64', async () => {
    const { lecteurs } = await ex(`<select class="lecteur-select"><option value="${b64('https://hote-a-exemple.fr/e/1')}">A</option><option value="${b64('<iframe src="https://hote-b-exemple.fr/e/2"></iframe>')}">B</option></select>`);
    expect(lecteurs.map(l => [l.label, l.url])).toEqual([
      ['A', 'https://hote-a-exemple.fr/e/1'],
      ['B', 'https://hote-b-exemple.fr/e/2'],
    ]);
  });

  it('table JSON dans un script (barres obliques échappées)', async () => {
    const { lecteurs } = await ex(`<script>window.lecteurs = {"MOON":"https:\\/\\/hote-m-exemple.fr\\/e\\/7","VOE":"<iframe src=\\"https:\\/\\/hote-v-exemple.fr\\/e\\/8\\"><\\/iframe>"};</script>`);
    expect(lecteurs.map(l => [l.label, l.url])).toEqual([
      ['MOON', 'https://hote-m-exemple.fr/e/7'],
      ['VOE', 'https://hote-v-exemple.fr/e/8'],
    ]);
  });

  it('lien direct mp4 : lu par le lecteur natif', async () => {
    const { lecteurs } = await ex('<video><source src="https://cdn-exemple.fr/ep1.mp4"></video>');
    expect(lecteurs).toEqual([{ label: 'Vidéo 1', url: 'https://cdn-exemple.fr/ep1.mp4', kind: 'video' }]);
  });

  it('adresses privées, javascript:, la page elle-même et ses sous-pages : écartées', async () => {
    const { lecteurs, diagnostic } = await ex(`<iframe src="http://127.0.0.1/x"></iframe><iframe src="javascript:alert(1)"></iframe><iframe src="${EP}"></iframe><iframe src="LECTEUR%20A"></iframe>`);
    expect(lecteurs).toEqual([]);
    expect(diagnostic.ecartes.join(' | ')).toMatch(/page de l’épisode/);
  });

  it('valeurs', () => {
    expect(adresseDansValeur('LECTEUR myTV')).toBeNull();
    expect(adresseDansValeur('Lecteur 1')).toBeNull();
    expect(adresseDansValeur('{"embed_url":"https://h-exemple.fr/e"}')).toBe('https://h-exemple.fr/e');
    expect(estLaPage(`${EP}?host=X`, EP)).toBe(true);
    expect(estLaPage(`${EP}LECTEUR%20A`, EP)).toBe(true);
    expect(estLaPage(`${SITE}/player/1`, EP)).toBe(false);
    expect(estLaPage('https://hote-exemple.fr/anime/voyage/episode-1/', EP)).toBe(false);
  });
});
