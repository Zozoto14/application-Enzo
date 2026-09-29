import {
  adresseThesesAutorisee,
  chargerTheses,
  lireReddit,
  lireSeekingAlpha,
  sourcesTheses,
  symboleAmericain,
  tonDe,
} from './theses';

const REDDIT = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/investisseur</name></author><category term="vosfinances" label="r/vosfinances"/>
<content type="html">&lt;div&gt;&lt;p&gt;Je renforce Nvidia malgré la hausse, les marges restent énormes.&lt;/p&gt;&lt;/div&gt; submitted by /u/investisseur [link] [comments]</content>
<link href="https://www.reddit.com/r/vosfinances/comments/abc/nvidia/"/><updated>2026-09-20T10:00:00+00:00</updated>
<title>Nvidia : toujours une opportunité ?</title></entry>
<entry><author><name>/u/hors_sujet</name></author><category term="vosfinances" label="r/vosfinances"/>
<content type="html">Quel livret choisir ?</content><link href="https://www.reddit.com/r/vosfinances/comments/def/livret/"/>
<updated>2026-09-21T10:00:00+00:00</updated><title>Livret A ou LDDS ?</title></entry>
</feed>`;

const SEEKING_ALPHA = `<rss><channel>
<item><title>Nvidia: The Chip Is Just The Beginning (Rating Upgrade)</title>
<link>https://seekingalpha.com/article/4801234-nvidia-chip-just-beginning</link>
<pubDate>Mon, 14 Sep 2026 12:00:00 -0400</pubDate><sa:author_name>Julien M.</sa:author_name></item>
<item><title>Nvidia shares rise premarket</title><link>https://seekingalpha.com/news/4401-nvidia-shares</link>
<pubDate>Tue, 15 Sep 2026 08:00:00 -0400</pubDate></item>
</channel></rss>`;

const GOOGLE = `<rss><channel>
<item><title>Faut-il encore acheter Nvidia ? - Investir</title><link>https://news.google.com/a</link>
<pubDate>Wed, 16 Sep 2026 08:00:00 GMT</pubDate><description>Faut-il encore acheter Nvidia ? Investir</description></item>
</channel></rss>`;

describe('thèses d’une valeur', () => {
  it('reconnaît un symbole américain', () => {
    expect(symboleAmericain('NVDA')).toBe('NVDA');
    expect(symboleAmericain('brk-b')).toBe('BRK-B');
    expect(symboleAmericain('AI.PA')).toBeUndefined();
  });

  it('interroge Seeking Alpha seulement pour une valeur américaine', () => {
    const us = sourcesTheses({ nom: 'NVIDIA Corporation', symbole: 'NVDA' });
    const paris = sourcesTheses({ nom: 'Air Liquide', symbole: 'AI.PA' });
    expect(us.some(source => source.source === 'Seeking Alpha')).toBe(true);
    expect(paris.some(source => source.source === 'Seeking Alpha')).toBe(false);
    // Le processus principal accepte chacune de ces adresses.
    for (const source of [...us, ...paris].filter(s => !s.url.startsWith('https://news.google.com'))) {
      expect(adresseThesesAutorisee(source.url)).toBe(true);
    }
  });

  it('refuse toute autre adresse', () => {
    expect(adresseThesesAutorisee('https://www.reddit.com/r/autre/search.rss?q=x')).toBe(false);
    expect(adresseThesesAutorisee('https://seekingalpha.com/api/sa/combined/NVDA.xml?x=1')).toBe(false);
    expect(adresseThesesAutorisee('https://exemple.com/NVDA.xml')).toBe(false);
  });

  it('lit une discussion Reddit, auteur compris, sans la signature', () => {
    const [premiere] = lireReddit(REDDIT, 'fr');
    expect(premiere.auteur).toBe('/u/investisseur');
    expect(premiere.source).toBe('Reddit · r/vosfinances');
    expect(premiere.resume).toContain('Je renforce Nvidia');
    expect(premiere.resume).not.toContain('submitted by');
    expect(premiere.date).toBe('2026-09-20');
  });

  it('ne garde de Seeking Alpha que les analyses', () => {
    const analyses = lireSeekingAlpha(SEEKING_ALPHA);
    expect(analyses).toHaveLength(1);
    expect(analyses[0].auteur).toBe('Julien M.');
  });

  it('estime le ton sans prétendre davantage', () => {
    expect(tonDe('Nvidia, une opportunité à acheter')).toBe('optimiste');
    expect(tonDe('Une bulle : prudence, risque de chute')).toBe('prudent');
    expect(tonDe('Résultats trimestriels')).toBeUndefined();
  });

  it('rassemble les sources, écarte le hors-sujet et compte les échecs', async () => {
    const flux = async (url: string) => {
      if (url.includes('seekingalpha')) return SEEKING_ALPHA;
      if (url.includes('vosfinances')) return REDDIT;
      if (url.includes('reddit')) throw new Error('429');
      return GOOGLE;
    };
    const resultat = await chargerTheses({ nom: 'NVIDIA Corporation', symbole: 'NVDA' }, flux);
    const titres = resultat.theses.map(these => these.titre);
    expect(titres).toContain('Nvidia : toujours une opportunité ?');
    expect(titres).toContain('Nvidia: The Chip Is Just The Beginning (Rating Upgrade)');
    expect(titres).toContain('Faut-il encore acheter Nvidia ?');
    expect(titres).not.toContain('Livret A ou LDDS ?');
    expect(resultat.echecs).toBe(1);
    expect(resultat.theses.find(these => these.genre === 'discussion')?.ton).toBe('optimiste');
    // Du plus récent au plus ancien.
    expect(resultat.theses[0].date >= resultat.theses[resultat.theses.length - 1].date).toBe(true);
  });
});
