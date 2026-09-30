import { adresseDeRecherche, ajouterSource, importerSources, modifierSource, normaliserSource, SOURCES_PAR_DEFAUT, sourcePourUrl, supprimerSource, supporteAnimes, supporteFilms, vueFilm } from './sources';

const SITE = 'https://mediatheque-exemple.fr';
const ctx = { genererId: () => 'id-1', horloge: { maintenant: () => Date.UTC(2026, 8, 30) } };

describe('sources', () => {
  it('aucune source par defaut, et rien qui evoque un site de streaming', () => {
    expect(SOURCES_PAR_DEFAUT).toEqual([]);
    expect(Object.isFrozen(SOURCES_PAR_DEFAUT)).toBe(true);
  });

  it('normalise : champs par defaut, delai borne, adresse canonique', () => {
    const s = normaliserSource({ name: ' Ma mediatheque ', baseUrl: `${SITE}/`, timeout: 999999, search: { path: '/?s={query}', item: 'li.res' } }, null, ctx);
    expect(s).toMatchObject({ id: 'id-1', name: 'Ma mediatheque', enabled: false, language: 'indifferent', timeout: 60000 });
    expect(s.search.link).toBe('a');
    expect(s.player.attr).toBe('src');
    expect(s.createdAt).toBe('2026-09-30T00:00:00.000Z');
    expect(supporteAnimes(s)).toBe(true);
    expect(supporteFilms(s)).toBe(false);
  });

  it.each(['http://localhost:8080', 'http://192.168.1.10', 'ftp://exemple.fr', 'http://[::1]/'])('refuse une baseUrl %s', baseUrl => {
    expect(() => normaliserSource({ name: 'x', baseUrl }, null, ctx)).toThrow();
  });
  it('baseUrl obligatoire', () => {
    expect(() => normaliserSource({ name: 'x' }, null, ctx)).toThrow(/baseUrl/);
  });

  it('films : section distincte, vue film sans episodes', () => {
    const s = normaliserSource({ baseUrl: SITE, movies: { search: { path: '/films?q={query}', item: '.film', year: '.an' }, player: { iframe: 'iframe' } } }, null, ctx);
    expect(supporteFilms(s)).toBe(true);
    const v = vueFilm(s);
    expect(v.search.item).toBe('.film');
    expect(v.episodes.item).toBe('');
  });

  it('adresse de recherche : chemin VF / VOSTFR distincts, requete encodee', () => {
    const s = normaliserSource({ baseUrl: SITE, search: { path: '/rech?q={query}', pathVf: '/vf?q={query}', pathVostfr: '/vostfr?q={query}', item: 'li' } }, null, ctx);
    expect(adresseDeRecherche(s, 'Spy x Family')).toBe(`${SITE}/rech?q=Spy%20x%20Family`);
    expect(adresseDeRecherche(s, 'é&a', 'vf')).toBe(`${SITE}/vf?q=%C3%A9%26a`);
    expect(adresseDeRecherche(s, 'a', 'vostfr')).toBe(`${SITE}/vostfr?q=a`);
    const sansVf = normaliserSource({ baseUrl: SITE, search: { path: '/rech?q={query}', item: 'li' } }, null, ctx);
    expect(adresseDeRecherche(sansVf, 'a', 'vf')).toBe(`${SITE}/rech?q=a`);
  });

  it('gestion de liste : ajout, doublon, modification, suppression', () => {
    let { liste } = ajouterSource([], { name: 'A', baseUrl: SITE, enabled: true }, ctx);
    expect(() => ajouterSource(liste, { name: 'B', baseUrl: SITE }, ctx)).toThrow(/deja/);
    liste = modifierSource(liste, 'id-1', { name: 'A2' }, ctx).liste;
    expect(liste[0]).toMatchObject({ name: 'A2', enabled: true, baseUrl: `${SITE}/` });
    expect(() => modifierSource(liste, 'nope', {}, ctx)).toThrow(/introuvable/);
    expect(supprimerSource(liste, 'id-1')).toEqual([]);
  });

  it('retrouve la source d\'une adresse par domaine (www ignore, activee seulement)', () => {
    const { liste } = ajouterSource([], { baseUrl: SITE, enabled: true }, ctx);
    expect(sourcePourUrl(liste, 'https://www.mediatheque-exemple.fr/serie/x')?.id).toBe('id-1');
    expect(sourcePourUrl(liste, 'https://autre.fr/')).toBeNull();
    const inactive = modifierSource(liste, 'id-1', { enabled: false }, ctx).liste;
    expect(sourcePourUrl(inactive, `${SITE}/x`)).toBeNull();
  });

  it('importe un ancien sources.json en ecartant l\'invalide', () => {
    const r = importerSources(
      { sources: [{ id: 'a', name: 'A', baseUrl: SITE }, { id: 'a', name: 'doublon', baseUrl: SITE }, { name: 'local', baseUrl: 'http://127.0.0.1' }, 'n\'importe quoi'] },
      ctx,
    );
    expect(r.sources.map(s => s.id)).toEqual(['a']);
    expect(r.ecartees).toBe(3);
  });
});
