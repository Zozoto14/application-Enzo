import {
  memeSujet,
  autresSources,
  chargerMedias,
  concerne,
  lireFlux,
  lireRechercheActualites,
  mediaReconnu,
  motsCles,
  requeteValeur,
  resumeCourt,
  statutSource,
  texteBrut,
  urlActualitesValeur,
} from './medias';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Les Echos</title>
<item>
  <title><![CDATA[Air Liquide signe un contrat géant dans l&#8217;hydrogène]]></title>
  <link>https://www.lesechos.fr/air-liquide</link>
  <description><![CDATA[<p>Le groupe fournira de l&apos;hydrogène à une aciérie allemande. Le contrat porte sur quinze ans. Les détails financiers n'ont pas été communiqués.</p>]]></description>
  <pubDate>Thu, 24 Sep 2026 07:30:00 +0200</pubDate>
</item>
<item>
  <title>La BCE maintient ses taux</title>
  <description>La BCE maintient ses taux</description>
  <pubDate>Wed, 23 Sep 2026 14:00:00 GMT</pubDate>
</item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Stocks rally as inflation cools</title><link href="https://example.com/a"/>
<summary>US stocks rose on Thursday. The S&amp;P 500 gained 1%.</summary><updated>2026-09-24T20:00:00Z</updated></entry>
</feed>`;

describe('revue de presse', () => {
  it('lit un flux RSS : titre, résumé court, date et lien', () => {
    const [premier, second] = lireFlux(RSS, { nom: 'Les Echos', langue: 'fr' });
    expect(premier).toEqual({
      titre: 'Air Liquide signe un contrat géant dans l’hydrogène',
      resume: 'Le groupe fournira de l’hydrogène à une aciérie allemande. Le contrat porte sur quinze ans.',
      source: 'Les Echos',
      date: '2026-09-24',
      lien: 'https://www.lesechos.fr/air-liquide',
      langue: 'fr',
    });
    // Un résumé qui répète le titre est écarté.
    expect(second.resume).toBe('');
  });

  it('lit un flux Atom', () => {
    expect(lireFlux(ATOM, { nom: 'CNBC', langue: 'en' })).toEqual([
      {
        titre: 'Stocks rally as inflation cools',
        resume: 'US stocks rose on Thursday. The S&P 500 gained 1%.',
        source: 'CNBC',
        date: '2026-09-24',
        lien: 'https://example.com/a',
        langue: 'en',
      },
    ]);
  });

  it('nettoie le texte et coupe les résumés trop longs', () => {
    expect(texteBrut('<b>Hausse</b> &amp; baisse&nbsp;!')).toBe('Hausse & baisse !');
    expect(resumeCourt('a'.repeat(400), 50)).toMatch(/…$/);
  });

  it('reconnaît les articles qui parlent d’une valeur', () => {
    expect(motsCles('AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC')).toEqual(['msci', 'world']);
    const article = lireFlux(RSS, { nom: 'Les Echos', langue: 'fr' })[0];
    expect(concerne(article, 'AIR LIQUIDE')).toBe(true);
    expect(concerne(article, 'Stellantis')).toBe(false);
    // « Air » seul ne suffit pas : tous les mots doivent y être.
    expect(concerne({ ...article, titre: 'Air France', resume: '' }, 'Air Liquide')).toBe(false);
  });

  it('assemble les flux, ignore ceux qui échouent et retire les doublons', async () => {
    const { articles, echecs } = await chargerMedias(
      async url => {
        if (url.includes('panne')) {
          throw new Error('hors ligne');
        }
        return RSS;
      },
      [
        { id: 'a', nom: 'Les Echos', url: 'https://a', langue: 'fr' },
        { id: 'b', nom: 'Les Echos bis', url: 'https://b', langue: 'fr' },
        { id: 'c', nom: 'Panne', url: 'https://panne', langue: 'fr' },
      ],
    );
    expect(echecs).toBe(1);
    expect(articles.map(article => article.titre)).toEqual([
      'Air Liquide signe un contrat géant dans l’hydrogène',
      'La BCE maintient ses taux',
    ]);
  });
});

describe('actualités par valeur', () => {
  it('fabrique la recherche et lit le média dans le titre', () => {
    expect(requeteValeur('AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC')).toBe('"msci world"');
    expect(urlActualitesValeur('Air Liquide')).toBe(
      'https://news.google.com/rss/search?q=%22air%20liquide%22%20when%3A7d&hl=fr&gl=FR&ceid=FR:fr',
    );
    const xml = `<rss><channel><item><title>Air Liquide relève ses objectifs - Zonebourse</title>
      <description>&lt;a href="x"&gt;Air Liquide relève ses objectifs&lt;/a&gt;&amp;nbsp;&lt;font&gt;Zonebourse&lt;/font&gt;</description>
      <pubDate>Fri, 25 Sep 2026 08:00:00 GMT</pubDate><link>https://news.google.com/x</link></item></channel></rss>`;
    expect(lireRechercheActualites(xml)).toEqual([
      {
        titre: 'Air Liquide relève ses objectifs',
        resume: '',
        source: 'Zonebourse',
        date: '2026-09-25',
        lien: 'https://news.google.com/x',
        langue: 'fr',
      },
    ]);
  });
});

describe('fiabilité des sources', () => {
  const article = (titre: string, source: string) => ({ titre, resume: '', source, date: '2026-09-25', langue: 'fr' as const });

  it('reconnaît les médias établis, quelle que soit la graphie', () => {
    expect(mediaReconnu('Les Echos')).toBe(true);
    expect(mediaReconnu('BFM Bourse')).toBe(true);
    expect(mediaReconnu('Boursorama.com')).toBe(true);
    expect(mediaReconnu('Le Figaro Économie')).toBe(true);
    expect(mediaReconnu('super-bourse-gratuite.net')).toBe(false);
    expect(mediaReconnu('')).toBe(false);
  });

  it('dit recoupée quand un autre média rapporte la même information', () => {
    const a = article('Air Liquide relève ses objectifs annuels après un bon trimestre', 'Zonebourse');
    const b = article('Air Liquide relève ses objectifs pour l’année', 'Les Echos');
    const c = article('La BCE maintient ses taux directeurs', 'Le Monde');
    const d = article('Air Liquide : un blogueur prédit un triplement', 'monblogbourse.fr');
    const tous = [a, b, c, d];
    expect(statutSource(a, tous)).toBe('recoupee');
    expect(autresSources(a, tous)).toEqual(['Les Echos']);
    expect(statutSource(c, tous)).toBe('reconnue');
    expect(statutSource(d, tous)).toBe('non-verifiee');
  });
});

describe('même sujet', () => {
  it('reconnaît deux titres courts sur la même nouvelle', () => {
    expect(memeSujet({ titre: 'La BCE maintient ses taux' }, { titre: 'La BCE maintient ses taux directeurs' })).toBe(true);
  });
  it('distingue deux nouvelles différentes', () => {
    expect(memeSujet({ titre: 'Apple bondit avec le nouvel iPhone' }, { titre: 'Le luxe marque le pas en Chine' })).toBe(false);
    expect(memeSujet({ titre: 'La BCE maintient ses taux' }, { titre: 'La Fed baisse ses taux' })).toBe(false);
  });
});
