import { adresseEpisode, apercuEpisodes, associerParTitre, corrigerEpisode, definirAssociation, definirLienFilm, deduireMotif, deviner, extraireLiensEpisodes, liensVides, lireAssociation, normaliserAssociation, remplirMotif, retirerAssociation, retirerLienFilm } from './liensManuels';

const horloge = { maintenant: () => Date.UTC(2026, 8, 30, 12) };

describe('motif {n}', () => {
  it('deduit le motif depuis l\'adresse d\'un episode', () => {
    expect(deduireMotif('https://site-exemple.fr/one-piece-episode-5/', 5)).toMatchObject({ pattern: 'https://site-exemple.fr/one-piece-episode-{n}/', padding: 0, offset: 0 });
  });
  it('conserve le zero de remplissage et l\'ecart de numerotation', () => {
    const m = deduireMotif('https://site-exemple.fr/s2/ep-013', 1)!;
    expect(m).toMatchObject({ pattern: 'https://site-exemple.fr/s2/ep-{n}', padding: 3, offset: 12, detectedNumber: 13 });
    expect(remplirMotif(m.pattern, 2, m)).toBe('https://site-exemple.fr/s2/ep-014');
  });
  it('prefere le nombre egal a l\'episode regarde, puis le mot-cle, puis le dernier du chemin', () => {
    expect(deduireMotif('https://s-exemple.fr/saison-2/episode-7', 2)!.pattern).toBe('https://s-exemple.fr/saison-{n}/episode-7');
    expect(deduireMotif('https://s-exemple.fr/2024/saison-2/episode-7', null)!.pattern).toBe('https://s-exemple.fr/2024/saison-2/episode-{n}');
    expect(deduireMotif('https://s-exemple.fr/video-x264-12', null)!.detectedNumber).toBe(12);
  });
  it('aucun nombre : null ; adresse invalide : erreur', () => {
    expect(deduireMotif('https://s-exemple.fr/accueil')).toBeNull();
    expect(() => deduireMotif('javascript:alert(1)')).toThrow();
  });
  it('remplir : negatif ou non entier refuse', () => {
    expect(remplirMotif('https://s.fr/e-{n}', 1, { offset: -5 })).toBeNull();
    expect(remplirMotif('https://s.fr/e-{n}', 1.5)).toBeNull();
    expect(remplirMotif('https://s.fr/e-{n}', 4, { padding: 2 })).toBe('https://s.fr/e-04');
  });
});

describe('associations', () => {
  it('motif exactement une fois {n}, pas dans le domaine, http(s) public seulement', () => {
    const p = (pattern: string) => () => normaliserAssociation({ type: 'pattern', pattern }, null, horloge);
    expect(p('https://s-exemple.fr/e/1')).toThrow(/exactement une fois/);
    expect(p('https://s-exemple.fr/{n}/{n}')).toThrow(/exactement une fois/);
    expect(p('https://s{n}-exemple.fr/e')).toThrow(/domaine/);
    expect(p('javascript:{n}')).toThrow();
    expect(p('http://192.168.0.1/e-{n}')).not.toThrow(); // la garde reseau s'applique a l'appel, pas a la saisie
  });

  it('adresse d\'episode : correction > motif', () => {
    const { liens } = definirAssociation(liensVides(), 42, { type: 'pattern', pattern: 'https://s-exemple.fr/e-{n}', padding: 2, overrides: { '7': 'https://autre-exemple.fr/sept' } }, horloge);
    const a = lireAssociation(liens, 42)!;
    expect(adresseEpisode(a, 3)).toBe('https://s-exemple.fr/e-03');
    expect(adresseEpisode(a, 7)).toBe('https://autre-exemple.fr/sept');
    expect(apercuEpisodes(a, 1, 2).map(x => x.url)).toEqual(['https://s-exemple.fr/e-01', 'https://s-exemple.fr/e-02']);
    expect(a.createdAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('serie : liste d\'episodes, corrections et retrait', () => {
    let { liens } = definirAssociation(liensVides(), 'a', { type: 'series', seriesUrl: 'https://s-exemple.fr/serie', episodes: [{ number: 1, url: 'https://s-exemple.fr/e/1' }, { number: 'x', url: 'https://s-exemple.fr/z' }, { number: 2, url: 'ftp://nope' }].slice(0, 2) }, horloge);
    expect(adresseEpisode(lireAssociation(liens, 'a'), 2)).toBeNull();
    liens = corrigerEpisode(liens, 'a', 2, 'https://s-exemple.fr/e/deux', horloge).liens;
    expect(adresseEpisode(lireAssociation(liens, 'a'), 2)).toBe('https://s-exemple.fr/e/deux');
    liens = corrigerEpisode(liens, 'a', 2, null, horloge).liens;
    expect(adresseEpisode(lireAssociation(liens, 'a'), 2)).toBeNull();
    expect(() => corrigerEpisode(liens, 'zz', 1, 'https://s-exemple.fr/x')).toThrow(/Aucune association/);
    expect(retirerAssociation(liens, 'a').anime).toEqual({});
  });

  it('type inconnu refuse ; l\'etat d\'origine n\'est pas modifie', () => {
    expect(() => normaliserAssociation({ type: 'x' })).toThrow(/inconnu/);
    const vide = liensVides();
    definirAssociation(vide, 1, { type: 'pattern', pattern: 'https://s-exemple.fr/{n}' }, horloge);
    expect(vide.anime).toEqual({});
  });

  it('liens de film : nature du media', () => {
    let { liens, lien } = definirLienFilm(liensVides(), 'tmdb-1', { url: 'https://cdn-exemple.fr/f.m3u8', label: ' Ma copie ' }, horloge);
    expect(lien).toMatchObject({ kind: 'hls', label: 'Ma copie' });
    expect(() => definirLienFilm(liens, 'tmdb-1', { url: 'ftp://x' })).toThrow();
    expect(retirerLienFilm(liens, 'tmdb-1').movies).toEqual({});
  });
});

describe('extraction depuis une page de serie', () => {
  const PAGE = `<a href="/">Accueil</a><a href="/serie/x">Cette page</a>
   <a href="/ep/x-episode-2">Lire</a><a href="/ep/x-episode-1" title="Épisode 1">Lire</a>
   <a href="https://autre-exemple.fr/x-episode-9">Autre site</a><a href="/p/z">Episode 10 - Fin</a>
   <a href="javascript:void(0)">Episode 5</a><a href="/ep/x-episode-2#lecteur">doublon</a><a href="/contact">Contact</a><a href="/ep/x-episode-99999">trop grand</a>`;
  it('garde les liens du meme site qui designent un episode, tries et sans doublon', () => {
    const l = extraireLiensEpisodes(PAGE, 'https://www.site-exemple.fr/serie/x');
    expect(l).toEqual([
      { number: 1, url: 'https://site-exemple.fr/ep/x-episode-1' },
      { number: 2, url: 'https://site-exemple.fr/ep/x-episode-2' },
      { number: 10, url: 'https://site-exemple.fr/p/z' },
    ].map(e => ({ ...e, url: e.url.replace('https://site-exemple.fr', 'https://www.site-exemple.fr') })));
  });
  it('deviner : episode ou serie', () => {
    expect(deviner('https://s-exemple.fr/x/episode-3')).toBe('episode');
    expect(deviner('https://s-exemple.fr/x.mp4')).toBe('episode');
    expect(deviner('https://s-exemple.fr/anime/x')).toBe('series');
    expect(deviner('https://s-exemple.fr/v/12', 12)).toBe('episode');
  });
});

describe('mapping par titre', () => {
  it('rattache par titre puis par numero ; titres dupliques ignores', () => {
    const cat = [{ number: 1, title: 'Le départ' }, { number: 2, title: 'La route' }, { number: 3, title: 'Sans equivalent' }, { number: 4, title: null }];
    const page = [
      { number: 10, title: 'Épisode 10 : Le depart', url: 'https://s-exemple.fr/a' },
      { number: 11, title: 'La route', url: 'https://s-exemple.fr/b' },
      { number: 12, title: 'La route', url: 'https://s-exemple.fr/c' },
      { number: 4, title: null, url: 'https://s-exemple.fr/d' },
    ];
    const r = associerParTitre(cat, page);
    expect(r.liens).toEqual([{ number: 1, url: 'https://s-exemple.fr/a' }, { number: 4, url: 'https://s-exemple.fr/d' }]);
    expect(r.manquants).toEqual([2, 3]);
  });
});
