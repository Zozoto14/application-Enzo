import { classerResultats, detecterLangue, numeroDepuisAdresse, SCORE_MINIMAL, titreDeBase, variantesDeRecherche } from './appariement';

describe('langue VF / VOSTFR', () => {
  it('detecte dans le titre ou l\'adresse', () => {
    expect(detecterLangue('Kimetsu no Yaiba (VF)')).toBe('vf');
    expect(detecterLangue('Kimetsu no Yaiba VOSTFR')).toBe('vostfr');
    expect(detecterLangue('https://s.exemple.fr/kimetsu-no-yaiba-vf/')).toBe('vf');
    expect(detecterLangue('Kimetsu no Yaiba')).toBeNull();
    expect(detecterLangue('Vfx Story')).toBeNull();
  });
});

describe('classement', () => {
  const r = (title: string, url = `https://s.fr/${title.toLowerCase().replace(/\W+/g, '-')}/`) => ({ title, url });

  it('un mot en trop designe une autre oeuvre', () => {
    const c = classerResultats([r('One Piece Heroines'), r('One Piece')], ['One Piece']);
    expect(c[0].title).toBe('One Piece');
    expect(c.find(x => x.title === 'One Piece Heroines')!.baseScore).toBeLessThan(SCORE_MINIMAL);
  });

  it('la preference VF departage sans rattraper une mauvaise serie', () => {
    const liste = [r('Naruto VOSTFR'), r('Naruto VF'), r('Naruto Shippuden VF')];
    expect(classerResultats(liste, ['Naruto'], 'vf')[0].title).toBe('Naruto VF');
    expect(classerResultats(liste, ['Naruto'], 'vostfr')[0].title).toBe('Naruto VOSTFR');
    const mauvais = classerResultats([r('Bleach VF'), r('Naruto VOSTFR')], ['Naruto'], 'vf');
    expect(mauvais.find(x => x.title === 'Bleach VF')!.baseScore).toBeLessThan(SCORE_MINIMAL);
  });

  it('« Titre » et « Titre (VF) » ont le meme score de base', () => {
    const [a, b] = classerResultats([r('Titre'), r('Titre (VF)')], ['Titre']);
    expect(a.baseScore).toBe(b.baseScore);
  });

  it('accents et ponctuation sont ignores', () => {
    expect(classerResultats([r('Shangri-La Frontier')], ['Shangri La Frontier'])[0].baseScore).toBe(1000);
    expect(classerResultats([r('Pokémon')], ['Pokemon'])[0].baseScore).toBe(1000);
  });
});

describe('titres et variantes', () => {
  it('titre de base', () => {
    expect(titreDeBase('Mushoku Tensei: Jobless Reincarnation Season 2 Part 2')).toBe('Mushoku Tensei');
    expect(titreDeBase('Overlord IV')).toBe('Overlord');
    expect(titreDeBase('Spy x Family Saison 2')).toBe('Spy x Family');
  });
  it('variantes sans doublon, six au plus', () => {
    expect(variantesDeRecherche(['Overlord IV', 'Overlord'])).toEqual(['Overlord IV', 'Overlord']);
    expect(variantesDeRecherche(['a1 b', 'a2 b', 'a3 b', 'a4 b', 'a5 b', 'a6 b', 'a7 b']).length).toBe(6);
  });
  it('numero depuis l\'adresse : le dernier nombre du slug', () => {
    expect(numeroDepuisAdresse('https://s.fr/shangri-la-frontier-2-25-vf/?x=1')).toBe(25);
    expect(numeroDepuisAdresse('https://s.fr/sans-numero/')).toBeNull();
  });
});
