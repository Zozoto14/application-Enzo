import { langueProbable, lireActualites } from '../fondamentaux/actualites';
import { construireEpisode, enchainer, dateParlee, eurosParles, phrases, pourcentParle, sujetDuJour } from './episode';

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
    // Des informations distinctes : des titres trop proches seraient, à
    // raison, regroupés en une seule nouvelle.
    titre: langue === 'fr' ? `La societe${rang} publie ses comptes` : `Company${rang} posts results`,
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
    expect(texte).toContain('Selon Les Echos, Air Liquide signe un contrat dans l’hydrogène.');
    // Le résumé de l'article est raconté, pas seulement son titre.
    expect(texte).toContain('La séance a été marquée par les annonces des banques centrales.');
    expect(texte).toMatch(/Source reconnue|média reconnu|Média fiable/);
    expect(texte).toContain('le titre se paie 28 fois ses bénéfices');
    expect(texte).toContain('sous son plus haut sur un an');
    // L'article déjà raconté avec la valeur ne revient pas dans la revue de presse.
    const revue = construireEpisode(base).chapitres.find(chapitre => chapitre.titre === 'La revue de presse')!;
    expect(revue.segments.some(segment => segment.texte.includes('hydrogène'))).toBe(false);
  });
});

describe('revue de presse reliée au portefeuille', () => {
  const presse = [
    { titre: 'Le Tour de France passe par Lyon', resume: 'Une étape de montagne.', source: 'Le Monde', date: '2026-09-25', langue: 'fr' as const },
    { titre: 'Apple bondit avec le nouvel iPhone', resume: 'Les précommandes dépassent les attentes.', source: 'Les Echos', date: '2026-09-25', langue: 'fr' as const },
  ];
  const episode = construireEpisode({
    aujourdhui: '2026-09-25',
    valeurTotale: 10000,
    totalReturn: 500,
    totalReturnPct: 5,
    lignes: [
      { nom: 'AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC', variationJour: 0.3, latentPct: 5, poids: 70 },
      { nom: 'Air Liquide', variationJour: 1, latentPct: 8, poids: 30 },
    ],
    valeurs: [
      {
        nom: 'Air Liquide',
        actualites: [],
        articles: [
          { titre: 'Air Liquide relève ses objectifs', resume: '', source: 'Zonebourse', date: '2026-09-24', langue: 'fr' as const },
        ],
      },
    ],
    indices: [],
    actualitesMarche: [],
    presse,
  });

  it('place en tête l’article qui touche vos lignes, avec « Pour vous »', () => {
    const revue = episode.chapitres.find(chapitre => chapitre.titre === 'La revue de presse')!;
    const textes = revue.segments.map(segment => segment.texte);
    expect(textes[1]).toMatch(/Les Echos.* Apple bondit avec le nouvel iPhone\.$/);
    expect(textes.find(texte => texte.startsWith('Pour vous'))).toContain('Apple pèse environ 4,5 pour cent du MSCI World');
  });

  it('cite les titres sur vos valeurs, avec leur source', () => {
    const une = episode.chapitres.find(chapitre => chapitre.titre === 'Vos valeurs à la une')!;
    const texte = une.segments.map(segment => segment.texte).join(' ');
    expect(texte).toContain('Selon Zonebourse, Air Liquide relève ses objectifs.');
    expect(texte).toContain('Source reconnue, mais pas encore recoupée par un autre média.');
    expect(episode.sources.map(source => source.source)).toEqual(expect.arrayContaining(['Zonebourse', 'Les Echos']));
  });
});

describe('une information dite une seule fois, et vérifiée', () => {
  const article = (titre: string, source: string, resume = '') => ({
    titre,
    resume,
    source,
    date: '2026-09-25',
    langue: 'fr' as const,
  });
  const episode = construireEpisode({
    aujourdhui: '2026-09-25',
    valeurTotale: 10000,
    totalReturn: 500,
    totalReturnPct: 5,
    lignes: [{ nom: 'Nvidia', variationJour: 2, latentPct: 20, poids: 100 }],
    valeurs: [
      {
        nom: 'Nvidia',
        actualites: [
          {
            titre: 'Nvidia publie un chiffre d’affaires record',
            source: 'Yahoo Finance',
            date: '2026-09-25',
            langue: 'fr',
            resume: 'Les ventes atteignent 46 milliards de dollars, portées par les centres de données.',
          },
        ],
        articles: [
          article('Nvidia publie un chiffre d’affaires record au trimestre', 'Les Echos'),
          article('Chiffre d’affaires record pour Nvidia qui publie ses comptes', 'BFM Bourse'),
        ],
      },
    ],
    indices: [],
    actualitesMarche: [],
    presse: [
      article('Nvidia publie un chiffre d’affaires record, Wall Street salue', 'Le Figaro', 'Les ventes bondissent.'),
      article('Le luxe marque le pas en Chine', 'bourse-express-gratuit.net', 'Les ventes ralentissent.'),
    ],
  });
  const texte = episode.chapitres.flatMap(chapitre => chapitre.segments.map(segment => segment.texte)).join(' ');

  it('raconte le contenu de l’article, pas seulement son titre', () => {
    expect(texte).toContain('Les ventes atteignent 46 milliards de dollars, portées par les centres de données.');
  });

  it('ne répète pas la même nouvelle rapportée par plusieurs médias', () => {
    expect(texte.match(/chiffre d’affaires record/gi)).toHaveLength(1);
  });

  it('dit que l’information est recoupée, et par qui', () => {
    expect(texte).toMatch(/(vérifiée|recoupée).*(Les Echos|BFM Bourse|Le Figaro)|(Les Echos|BFM Bourse|Le Figaro).*recoupée/);
  });

  it('prévient quand la source n’est pas vérifiée', () => {
    expect(texte).toMatch(/bourse-express-gratuit\.net n’est pas un média que l’application connaît|source non vérifiée/);
  });
});

describe('enchaînement à l’oral', () => {
  it('accorde l’introduction et le titre', () => {
    expect(enchainer('Selon Le Figaro,', 'La BCE maintient ses taux.')).toBe('Selon Le Figaro, la BCE maintient ses taux.');
    expect(enchainer('Les Echos rapporte que', 'Air Liquide investit.')).toBe('Les Echos rapporte qu’Air Liquide investit.');
    expect(enchainer('Les Echos rapporte que', 'Nvidia bondit.')).toBe('Les Echos rapporte que Nvidia bondit.');
    expect(enchainer('À noter :', 'La BCE agit.')).toBe('À noter : La BCE agit.');
  });
});

describe('flash de deux minutes et semaine en bref', () => {
  const article = (titre: string, source: string, resume = '') => ({ titre, resume, source, date: '2026-09-25', langue: 'fr' as const });
  const base = {
    aujourdhui: '2026-09-25', // un vendredi
    valeurTotale: 22658,
    totalReturn: 2658,
    totalReturnPct: 13.3,
    seance: { montant: 211, pourcentage: 0.94 },
    lignes: [
      { nom: 'Air Liquide', variationJour: 1.9, latentPct: 12.6, poids: 38 },
      { nom: 'Stellantis', variationJour: -1.2, latentPct: -20, poids: 5 },
    ],
    valeurs: [],
    indices: [{ nom: 'le CAC 40', seancePct: 0.4 }],
    actualitesMarche: [],
    presse: [
      article('La BCE maintient ses taux directeurs', 'Les Echos', 'Le taux de dépôt reste à 2 %.'),
      article('La BCE maintient ses taux', 'Le Figaro'),
      article('Le luxe marque le pas en Chine', 'Le Monde', 'Les ventes ralentissent.'),
      ...Array.from({ length: 20 }, (_, rang) => article(`La societe${rang} publie ses comptes`, 'BFM Bourse', 'Des comptes solides.')),
    ],
    semaine: {
      montant: 420,
      pourcentage: 1.9,
      lignes: [
        { nom: 'Air Liquide', pourcentage: 3.2 },
        { nom: 'Stellantis', pourcentage: -4.1 },
      ],
      indices: [{ nom: 'CAC 40', pourcentage: 1.1 }],
    },
  };

  it('dit l’essentiel en deux minutes au plus, avec l’info la plus reprise et sa vérification', () => {
    const flash = construireEpisode({ ...base, cibleMinutes: 2 });
    expect(flash.titre).toMatch(/^Votre flash bourse/);
    expect(flash.duree).toBeLessThanOrEqual(2);
    expect(flash.chapitres.map(chapitre => chapitre.titre)).toEqual(['Ouverture', 'L’essentiel', 'À retenir', 'Clôture']);
    const texte = flash.chapitres.flatMap(chapitre => chapitre.segments.map(segment => segment.texte)).join(' ');
    expect(texte).toContain('En tête, Air Liquide, plus 1,9 pour cent.');
    expect(texte).toContain('En queue, Stellantis, moins 1,2 pour cent.');
    expect(texte).toContain('Sur la semaine, votre portefeuille fait plus 1,9 pour cent.');
    // La BCE, reprise par deux journaux, passe en premier, une seule fois, vérifiée.
    expect(texte.match(/BCE maintient/g)).toHaveLength(1);
    expect(texte).toMatch(/Information vérifiée|recoupée|la même chose/);
  });

  it('ajoute la semaine en bref le vendredi, et seulement le vendredi', () => {
    const vendredi = construireEpisode(base);
    const semaine = vendredi.chapitres.find(chapitre => chapitre.titre === 'La semaine en bref')!;
    const texte = semaine.segments.map(segment => segment.texte).join(' ');
    expect(texte).toContain('Sur la semaine, votre portefeuille a gagné 420 euros, soit plus 1,9 pour cent.');
    expect(texte).toContain('La meilleure de la semaine : Air Liquide, plus 3,2 pour cent.');
    expect(texte).toContain('La plus en retrait : Stellantis, moins 4,1 pour cent.');
    const jeudi = construireEpisode({ ...base, aujourdhui: '2026-09-24' });
    expect(jeudi.chapitres.some(chapitre => chapitre.titre === 'La semaine en bref')).toBe(false);
  });
});
