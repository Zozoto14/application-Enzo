import { langueProbable, lireActualites } from '../fondamentaux/actualites';
import { construireEpisode, dateParlee, eurosParles, phrases, pourcentParle, sujetDuJour } from './episode';

describe('à l’oral', () => {
  it('dit les dates, les montants et les pourcentages', () => {
    expect(dateParlee('2026-09-25')).toBe('vendredi 25 septembre');
    expect(dateParlee('2026-10-01', false)).toBe('1er octobre');
    expect(eurosParles(12047.88)).toBe('12048 euros');
    expect(eurosParles(-1)).toBe('1 euro');
    expect(pourcentParle(1.234)).toBe('plus 1,2 pour cent');
    expect(pourcentParle(-0.4)).toBe('moins 0,4 pour cent');
    expect(pourcentParle(0.01)).toBe('stable');
  });

  it('découpe en phrases', () => {
    expect(phrases('Bonjour. Voici le point : la bourse monte. Fin !')).toEqual([
      'Bonjour.',
      'Voici le point : la bourse monte.',
      'Fin !',
    ]);
  });
});

describe('actualités', () => {
  it('lit les titres et devine leur langue', () => {
    const actualites = lireActualites({
      news: [
        { title: 'Stellantis cuts its outlook as sales fall', publisher: 'Reuters', providerPublishTime: 1790000000 },
        { title: 'Stellantis : le titre rebondit à Paris', publisher: 'Boursorama', providerPublishTime: 1790000000 },
        { title: '' },
      ],
    });
    expect(actualites.map(a => a.langue)).toEqual(['en', 'fr']);
    expect(actualites[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(langueProbable('Nvidia shares jump after earnings')).toBe('en');
  });
});

describe('épisode', () => {
  const base = {
    aujourdhui: '2026-09-25',
    valeurTotale: 12047.88,
    totalReturn: -20.58,
    totalReturnPct: -0.17,
    seance: { montant: 35.2, pourcentage: 0.29 },
    lignes: [
      { nom: 'Amundi MSCI World', variationJour: 0.4, latentPct: 1.2, poids: 99.3 },
      { nom: 'Stellantis', variationJour: -1.8, latentPct: -17.5, poids: 0.7 },
    ],
    valeurs: [
      {
        nom: 'Stellantis',
        actualites: [{ titre: 'Stellantis cuts its outlook', source: 'Reuters', date: '2026-09-24', langue: 'en' as const }],
        consensus: 'Conserver',
        objectifMoyen: 5,
        cours: 4.22,
        prochainsResultats: '2026-10-16',
      },
    ],
    indices: [{ nom: 'le CAC 40', seancePct: -0.6 }],
    actualitesMarche: [{ titre: 'La BCE maintient ses taux', source: 'Les Échos', date: '2026-09-25', langue: 'fr' as const }],
    sujet: { titre: 'TWR', court: 'Court.', detail: 'Détail.' },
  };

  it('enchaîne les chapitres dans l’ordre d’une émission', () => {
    const episode = construireEpisode(base);
    expect(episode.chapitres.map(c => c.titre)).toEqual([
      'Ouverture',
      'Votre portefeuille',
      'Les mouvements du jour',
      'Vos valeurs à la une',
      'L’agenda',
      'Les marchés',
      'Le sujet du jour : TWR',
      'Clôture',
    ]);
    expect(episode.duree).toBeGreaterThanOrEqual(1);
  });

  it('lit les titres anglais avec une voix anglaise', () => {
    const une = construireEpisode(base).chapitres.find(c => c.titre === 'Vos valeurs à la une')!;
    expect(une.segments.find(s => s.texte === 'Stellantis cuts its outlook.')?.langue).toBe('en');
    expect(une.segments.some(s => s.texte.includes('conseillent plutôt de conserver'))).toBe(true);
  });

  it('saute ce qui manque au lieu d’inventer', () => {
    const episode = construireEpisode({
      ...base,
      seance: undefined,
      lignes: [],
      valeurs: [],
      indices: [],
      actualitesMarche: [],
      sujet: undefined,
    });
    expect(episode.chapitres.map(c => c.titre)).toEqual(['Ouverture', 'Votre portefeuille', 'Clôture']);
  });

  it('fait tourner le sujet du jour', () => {
    expect(sujetDuJour(['a', 'b', 'c'], '2026-01-01')).toBe('a');
    expect(sujetDuJour(['a', 'b', 'c'], '2026-01-02')).toBe('b');
  });
});

describe('épisode long', () => {
  const article = (rang: number, langue: 'fr' | 'en') => ({
    titre: `${langue === 'fr' ? 'Les marchés européens' : 'Wall Street stocks'} numéro ${rang} bougent`,
    resume:
      langue === 'fr'
        ? 'La séance a été marquée par les annonces des banques centrales. Les investisseurs restent prudents avant les chiffres de l’emploi.'
        : 'Stocks moved on Thursday as investors weighed central bank comments. Traders remain cautious ahead of jobs data.',
    source: langue === 'fr' ? 'Les Echos' : 'CNBC',
    date: '2026-09-25',
    langue,
  });
  const presse = [
    ...Array.from({ length: 30 }, (_, rang) => article(rang, 'fr')),
    ...Array.from({ length: 10 }, (_, rang) => article(rang, 'en')),
  ];
  const base = {
    aujourdhui: '2026-09-25',
    valeurTotale: 22658,
    totalReturn: 2658,
    totalReturnPct: 13.3,
    lignes: [{ nom: 'Air Liquide', variationJour: 1.9, latentPct: 12.6, poids: 38 }],
    valeurs: [
      {
        nom: 'Air Liquide',
        actualites: [],
        articles: [{ ...article(99, 'fr'), titre: 'Air Liquide signe un contrat dans l’hydrogène' }],
        cours: 177,
        plusHaut52: 190,
        plusBas52: 150,
        per: 28.4,
        rendementDividende: 1.8,
      },
    ],
    indices: [{ nom: 'le CAC 40', seancePct: 0.4 }],
    actualitesMarche: [],
    sujet: { titre: 'Le PRU', court: 'Le prix de revient unitaire.', detail: 'Il inclut les frais.' },
    presse,
  };

  it('remplit dix minutes avec la revue de presse, sans les dépasser', () => {
    const episode = construireEpisode({ ...base, cibleMinutes: 10 });
    const titres = episode.chapitres.map(chapitre => chapitre.titre);
    expect(titres).toEqual(
      expect.arrayContaining(['La revue de presse', 'À l’international', 'Le sujet du jour : Le PRU']),
    );
    expect(episode.duree).toBeGreaterThanOrEqual(8);
    expect(episode.duree).toBeLessThanOrEqual(10);
    // Le sommaire annonce les chapitres.
    expect(episode.chapitres[0].segments.at(-1)!.texte).toMatch(/^Au programme : .*la revue de presse, à l’international/);
  });

  it('raccourcit en cinq minutes', () => {
    const court = construireEpisode({ ...base, cibleMinutes: 5 });
    const long = construireEpisode({ ...base, cibleMinutes: 15 });
    expect(court.duree).toBeLessThanOrEqual(5);
    expect(long.duree).toBeGreaterThan(court.duree);
  });

  it('raconte la valeur : poids, presse, valorisation et position sur un an', () => {
    const une = construireEpisode(base).chapitres.find(chapitre => chapitre.titre === 'Vos valeurs à la une')!;
    const texte = une.segments.map(segment => segment.texte).join(' ');
    expect(texte).toContain('Parlons de Air Liquide, qui représente 38 pour cent de vos titres, en plus-value de 13 pour cent.');
    expect(texte).toContain('Dans la presse, chez Les Echos :');
    expect(texte).toContain('le titre se paie 28 fois ses bénéfices');
    expect(texte).toContain('sous son plus haut sur un an');
    // L'article déjà raconté avec la valeur ne revient pas dans la revue de presse.
    const revue = construireEpisode(base).chapitres.find(chapitre => chapitre.titre === 'La revue de presse')!;
    expect(revue.segments.some(segment => segment.texte.includes('hydrogène'))).toBe(false);
  });
});
