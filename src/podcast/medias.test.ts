import { chargerMedias, concerne, lireFlux, motsCles, resumeCourt, texteBrut } from './medias';

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
