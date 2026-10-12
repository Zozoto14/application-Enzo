import { classerResultats, detecterLangue, MAX_VARIANTES, numeroDepuisAdresse, saisonDe, SCORE_MINIMAL, scoreTitre, titreDeBase, variantesDeRecherche } from './appariement';

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
  it('variantes sans doublon, huit au plus, titres non latins écartés', () => {
    expect(variantesDeRecherche(['Overlord IV', 'Overlord'])).toEqual(['Overlord IV', 'Overlord']);
    expect(variantesDeRecherche(['a1 b', 'a2 b', 'a3 b', 'a4 b', 'a5 b', 'a6 b', 'a7 b', 'a8 b', 'a9 b']).length).toBe(MAX_VARIANTES);
    // Titre principal, sa forme réduite, puis les autres titres du catalogue.
    expect(variantesDeRecherche(["Starlight: The Long Voyage", 'Hoshizora no Kiroku', '星空の記録', 'Les Chroniques de l’Étoile'])).toEqual([
      'Starlight: The Long Voyage', 'Starlight', 'Hoshizora no Kiroku', 'Les Chroniques de l’Étoile',
    ]);
  });
  it('saison désignée par un titre', () => {
    expect(saisonDe('Frieren Saison 2')).toBe(2);
    expect(saisonDe('Frieren 2nd Season')).toBe(2);
    expect(saisonDe('Overlord IV')).toBe(4);
    expect(saisonDe('Frieren: Beyond Journey’s End')).toBeNull();
    expect(saisonDe('Spy x Family Part 2')).toBe(2);
  });
  it('numero depuis l\'adresse : le dernier nombre du slug', () => {
    expect(numeroDepuisAdresse('https://s.fr/shangri-la-frontier-2-25-vf/?x=1')).toBe(25);
    expect(numeroDepuisAdresse('https://s.fr/sans-numero/')).toBeNull();
  });
});

describe('titre du catalogue contre titre du site (bogue : test OK, fiche KO)', () => {
  const CATALOGUE = ["Frieren: Beyond Journey's End", 'Sousou no Frieren', '葬送のフリーレン'];
  it('le site raccourcit le titre : « Frieren » est accepté (580 avant le correctif)', () => {
    expect(scoreTitre('Frieren', CATALOGUE)).toBeGreaterThanOrEqual(SCORE_MINIMAL);
    expect(scoreTitre('Frieren (2023)', CATALOGUE)).toBeGreaterThanOrEqual(SCORE_MINIMAL);
    expect(scoreTitre('FRIEREN – Saison 1 VOSTFR', CATALOGUE)).toBeGreaterThanOrEqual(SCORE_MINIMAL);
  });
  it('une autre saison, une autre oeuvre ou un sous-titre en plus restent refusés', () => {
    expect(scoreTitre('Frieren Saison 2', CATALOGUE)).toBeLessThan(SCORE_MINIMAL);
    expect(scoreTitre('Naruto: Shippuden', ['Naruto'])).toBeLessThan(SCORE_MINIMAL);
    expect(scoreTitre('One Piece Heroines', ['One Piece'])).toBeLessThan(SCORE_MINIMAL);
  });
  it('la saison voulue l’emporte sur la page générale ; « 2nd Season » = « Saison 2 »', () => {
    const classes = classerResultats([{ title: 'Frieren', url: 'a' }, { title: 'Frieren Saison 2', url: 'b' }], ['Frieren 2nd Season']);
    expect(classes[0].url).toBe('b');
    expect(classes[1].baseScore).toBeGreaterThanOrEqual(SCORE_MINIMAL);
  });
  it('casse, accents et ponctuation ne comptent pas', () => {
    expect(scoreTitre('les chroniques de l etoile', ['Les Chroniques de l’Étoile'])).toBe(1000);
    // Un article en tête ne compte pas : « Rivière » trouve « La Rivière ».
    expect(scoreTitre('La Rivière', ['Rivière'])).toBe(1000);
  });
});

describe('titres réalistes : catalogue (Jikan/AniList) contre titres des sites', () => {
  const FRIEREN = ["Frieren: Beyond Journey's End", 'Sousou no Frieren', '葬送のフリーレン'];
  const REZERO = ['Re:ZERO -Starting Life in Another World- Season 2', 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season'];
  const acceptes: Array<[string, readonly string[]]> = [
    // Le site liste des ÉPISODES dans sa recherche (-200 et 340 avant le correctif).
    ['Frieren Episode 12 VOSTFR', FRIEREN],
    ['Sousou no Frieren - Épisode 12', FRIEREN],
    ['Sousou no Frieren EP 03 VF', FRIEREN],
    ['Frieren S01E05', FRIEREN],
    ['Sousou no Frieren 第5話', FRIEREN],
    // Apostrophe retirée par le site (30 avant le correctif).
    ['Frieren Beyond Journeys End', FRIEREN],
    ['Frieren : Beyond Journey’s End', FRIEREN],
    // « Re:Zero » n'est pas un sous-titre (-50 avant le correctif : « Re » seul servait de base).
    ['Re:Zero Saison 2', REZERO],
    ['Re:Zero kara Hajimeru Isekai Seikatsu Saison 2', REZERO],
    // Saison abrégée « S2 » (0 et 30 avant le correctif).
    ['Vinland Saga S2', ['Vinland Saga Season 2']],
    ['One Punch Man S2 VF', ['One Punch Man Season 2']],
    // Film : « (Film) » contre « : The Movie » (30 avant le correctif).
    ['Jujutsu Kaisen 0 (Film)', ['Jujutsu Kaisen 0: The Movie']],
    ['Jujutsu Kaisen 0', ['Jujutsu Kaisen 0: The Movie']],
    // Romains, langue en fin de titre, « (TV) », année.
    ['Overlord IV VF', ['Overlord IV']],
    ['Overlord Saison 4', ['Overlord IV']],
    ['Mob Psycho 100 Saison 3', ['Mob Psycho 100 III']],
    ['Mushoku Tensei II', ['Mushoku Tensei: Jobless Reincarnation Season 2']],
    ['Shingeki no Kyojin Saison 3 Partie 2', ['Attack on Titan Season 3 Part 2', 'Shingeki no Kyojin Season 3 Part 2']],
    ['Sword Art Online : Alicization VF', ['Sword Art Online: Alicization']],
    ['Demon Slayer (TV)', ['Demon Slayer: Kimetsu no Yaiba']],
    ['Hunter X Hunter', ['Hunter x Hunter (2011)']],
    ['Oshi no Ko', ['[Oshi no Ko]']],
    ['Steins;Gate 0', ['Steins;Gate 0']],
  ];
  it.each(acceptes)('« %s » est reconnu', (site, catalogue) => {
    expect(scoreTitre(site, catalogue)).toBeGreaterThanOrEqual(SCORE_MINIMAL);
  });
  const refuses: Array<[string, readonly string[]]> = [
    ['Frieren Saison 2 Episode 3', FRIEREN],
    ['Chainsaw Man – OAV', ['Chainsaw Man']],
    ['Demon Slayer Film', ['Demon Slayer']],
    ['Re:Zero Saison 3', REZERO],
    ['Vinland Saga S1', ['Vinland Saga Season 2']],
    ['One Piece Heroines', ['One Piece']],
  ];
  it.each(refuses)('« %s » reste écarté (autre saison, film/OAV, autre oeuvre)', (site, catalogue) => {
    expect(scoreTitre(site, catalogue)).toBeLessThan(SCORE_MINIMAL);
  });
  it('la série exacte passe devant le film ou l’épisode', () => {
    const c = classerResultats([{ title: 'Demon Slayer Film', url: 'a' }, { title: 'Demon Slayer Episode 4', url: 'b' }, { title: 'Demon Slayer', url: 'c' }], ['Demon Slayer']);
    expect(c[0].url).toBe('c');
  });
  it('titre de base et saison : « Re:Zero » gardé, « S2 » compris', () => {
    expect(titreDeBase('Re:ZERO -Starting Life in Another World- Season 2')).toBe('Re:ZERO');
    expect(titreDeBase('Overlord IV VF')).toBe('Overlord');
    expect(saisonDe('Vinland Saga S2')).toBe(2);
    expect(saisonDe('Frieren S01E05')).toBe(1);
    expect(saisonDe('Shangri-La Frontier')).toBeNull();
    expect(variantesDeRecherche(REZERO)).toContain('Re:ZERO');
  });
});
