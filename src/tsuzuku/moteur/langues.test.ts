import { langueDAdresse, langueDeCandidat, langueDeNoeud, langueDeTexte, langueDEpisode, langueDObjetJson } from './langues';
import { lirePage } from './lecteurPage';
import { cleSerie, classerResultats, detecterLangue, estTitreDEpisode } from './appariement';

const l = (t: unknown) => langueDeTexte(t)?.langue ?? null;

describe('langue d’un titre ou d’un texte', () => {
  it.each([
    ['Le Long Voyage (VF)', 'vf'],
    ['Le Long Voyage VF', 'vf'],
    ['LE LONG VOYAGE [VF]', 'vf'],
    ['Le Long Voyage - VFF', 'vf'],
    ['Le Long Voyage (Dub)', 'vf'],
    ['Le Long Voyage English Dubbed', 'vf'],
    ['Le Long Voyage – doublé en français', 'vf'],
    ['Le Long Voyage version française', 'vf'],
    ['Le Long Voyage French', 'vf'],
    ['Le Long Voyage VOSTFR', 'vostfr'],
    ['Le Long Voyage (VOSTFR)', 'vostfr'],
    ['Le Long Voyage Vostfr HD', 'vostfr'],
    ['Le Long Voyage VOST', 'vostfr'],
    ['Le Long Voyage (VO)', 'vostfr'],
    ['Le Long Voyage [Sub]', 'vostfr'],
    ['Le Long Voyage French Sub', 'vostfr'],
    ['Le Long Voyage sous-titré', 'vostfr'],
    ['Le Long Voyage Sous titres français', 'vostfr'],
    ['Episode 3 VOSTFR', 'vostfr'],
    ['Épisode 3 VF', 'vf'],
  ])('« %s » → %s', (texte, attendu) => {
    expect(l(texte)).toBe(attendu);
  });

  it.each(['Le Long Voyage', 'Vfx Story', 'Double Decker', 'Subaru', 'VF / VOSTFR', 'VOSTFR et VF', '', null, 'Épisode 12', 'Fr'])('« %s » : inconnue', texte => {
    expect(l(texte)).toBeNull();
  });

  it('dit pourquoi (indice)', () => {
    expect(langueDeTexte('Titre (VF)')?.indice).toBe('« VF » dans le texte');
    expect(langueDeTexte('Titre VOSTFR', 'titre')?.indice).toBe('« VOSTFR » dans le titre');
  });

  it('detecterLangue (appariement) suit la même détection', () => {
    expect(detecterLangue('Titre [Sub]')).toBe('vostfr');
    expect(detecterLangue('https://s.exemple.fr/titre-vf/')).toBe('vf');
  });
});

describe('langue d’une adresse : chemin et requête, jamais le nom du site', () => {
  it.each([
    ['https://site-exemple.fr/anime/titre-vf/', 'vf'],
    ['https://site-exemple.fr/anime/titre-vostfr/episode-1', 'vostfr'],
    ['https://site-exemple.fr/vf/titre/episode-1', 'vf'],
    ['https://site-exemple.fr/watch?id=3&lang=vf', 'vf'],
    ['https://site-exemple.fr/titre-episode-1-dub', 'vf'],
    ['https://site-exemple.fr/titre-sub/1', 'vostfr'],
  ])('%s → %s', (url, attendu) => {
    expect(langueDAdresse(url)?.langue).toBe(attendu);
  });

  it.each(['https://vf-exemple.fr/anime/titre', 'https://site-exemple.fr/anime/titre', 'https://site-exemple.fr/vf-vostfr/titre', 'https://site-exemple.fr/volume/titre'])('%s : inconnue', url => {
    expect(langueDAdresse(url)).toBeNull();
  });
});

describe('langue d’un bloc de page (onglets, attributs, sections)', () => {
  const premier = (html: string, sel = 'a') => {
    const p = lirePage(html);
    return { p, el: p.tous(sel)[0] };
  };

  it('onglets par identifiant ou classe (« #vf », « .tab-vostfr »)', () => {
    const a = premier('<div id="vf"><ul><li><a href="/e1">Épisode 1</a></li></ul></div>');
    expect(langueDeNoeud(a.p, a.el)).toEqual({ langue: 'vf', indice: 'bloc id="vf"' });
    const b = premier('<div class="tab-pane tab-vostfr"><a href="/e1">1</a></div>');
    expect(langueDeNoeud(b.p, b.el)?.langue).toBe('vostfr');
  });

  it('attributs data-lang / data-langue (« fr », « ja », « vostfr »)', () => {
    const a = premier('<section data-lang="fr"><a href="/e1">Épisode 1</a></section>');
    expect(langueDeNoeud(a.p, a.el)).toMatchObject({ langue: 'vf', indice: 'attribut data-lang="fr"' });
    const b = premier('<section data-langue="ja"><a href="/e1">Épisode 1</a></section>');
    expect(langueDeNoeud(b.p, b.el)?.langue).toBe('vostfr');
    const c = premier('<li data-version="VOSTFR"><a href="/e1">Épisode 1</a></li>');
    expect(langueDeNoeud(c.p, c.el)?.langue).toBe('vostfr');
  });

  it('titre de section juste avant la liste (« <h3>Version française</h3><ul> »)', () => {
    const a = premier('<h3>Épisodes</h3><h4>Version française</h4><ul><li><a href="/e1">Épisode 1</a></li></ul>');
    expect(langueDeNoeud(a.p, a.el)).toMatchObject({ langue: 'vf', indice: 'section « Version française »' });
    const b = premier('<div><span class="titre">VOSTFR</span><ol><li><a href="/e1">1</a></li></ol></div>');
    expect(langueDeNoeud(b.p, b.el)?.langue).toBe('vostfr');
  });

  it('groupe d’options (« <optgroup label="VF"> »)', () => {
    const a = premier('<select><optgroup label="VF"><option value="/e1">Épisode 1</option></optgroup></select>', 'option');
    expect(langueDeNoeud(a.p, a.el)).toMatchObject({ langue: 'vf' });
  });

  it('ne se trompe pas : « sub-menu », html lang="fr", section sans langue', () => {
    const a = premier('<ul class="sub-menu"><li><a href="/e1">Épisode 1</a></li></ul>');
    expect(langueDeNoeud(a.p, a.el)).toBeNull();
    const b = lirePage('<html lang="fr"><body><ul><li><a href="/e1">Épisode 1</a></li></ul></body></html>');
    expect(langueDeNoeud(b, b.tous('a')[0])).toBeNull();
    const c = premier('<h3>Saison 1</h3><ul><li><a href="/e1">Épisode 1</a></li></ul>');
    expect(langueDeNoeud(c.p, c.el)).toBeNull();
  });

  it('épisode : texte, puis adresse, puis bloc', () => {
    const a = premier('<div id="vostfr"><a href="/titre-vf/e1">Épisode 1</a></div>');
    expect(langueDEpisode('Épisode 1 VOSTFR', '/titre-vf/e1', a.p, a.el)?.langue).toBe('vostfr');
    expect(langueDEpisode('Épisode 1', 'https://s-exemple.fr/titre-vf/e1', a.p, a.el)?.langue).toBe('vf');
    expect(langueDEpisode('Épisode 1', 'https://s-exemple.fr/titre/e1', a.p, a.el)?.langue).toBe('vostfr');
  });

  it('objet JSON d’épisode : lang, version, titre, adresse', () => {
    expect(langueDObjetJson({ lang: 'vf' }, null)?.langue).toBe('vf');
    expect(langueDObjetJson({ version: 'VOSTFR' }, null)?.langue).toBe('vostfr');
    expect(langueDObjetJson({ title: 'Épisode 2 (VF)' }, null)?.langue).toBe('vf');
    expect(langueDObjetJson({ title: 'Épisode 2' }, 'https://s-exemple.fr/x-vostfr/2')?.langue).toBe('vostfr');
    expect(langueDObjetJson({ type: 'TV', title: 'Épisode 2' }, 'https://s-exemple.fr/x/2')).toBeNull();
  });
});

describe('même série, autre langue : clé de série', () => {
  it('« Titre » et « Titre (VF) » ont la même clé ; une autre saison ou un film non', () => {
    expect(cleSerie('Le Long Voyage')).toBe(cleSerie('Le Long Voyage (VF)'));
    expect(cleSerie('Le Long Voyage VOSTFR')).toBe(cleSerie('le long voyage - vf'));
    expect(cleSerie('Le Long Voyage Dub')).toBe(cleSerie('Le Long Voyage'));
    expect(cleSerie('Le Long Voyage Saison 2 VF')).not.toBe(cleSerie('Le Long Voyage'));
    expect(cleSerie('Le Long Voyage Film')).not.toBe(cleSerie('Le Long Voyage'));
  });

  it('un résultat « Titre Épisode 12 VOSTFR » est un épisode, pas une fiche', () => {
    expect(estTitreDEpisode('Le Long Voyage Episode 12 VOSTFR')).toBe(true);
    expect(estTitreDEpisode('Le Long Voyage (VF)')).toBe(false);
  });

  it('les deux fiches ont le même score de titre (la langue ne fait que départager)', () => {
    const c = classerResultats([{ title: 'Le Long Voyage', url: 'https://s-exemple.fr/a' }, { title: 'Le Long Voyage (VF)', url: 'https://s-exemple.fr/b' }], ['Le Long Voyage'], 'vf');
    expect(c.map(x => [x.title, x.baseScore, x.language])).toEqual([
      ['Le Long Voyage (VF)', 1000, 'vf'],
      ['Le Long Voyage', 1000, null],
    ]);
    expect(langueDeCandidat({ title: 'Le Long Voyage', url: 'https://s-exemple.fr/anime/le-long-voyage-vostfr' })?.langue).toBe('vostfr');
  });
});
