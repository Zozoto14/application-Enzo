/**
 * Revue de presse : les flux RSS de médias économiques.
 *
 * Un flux donne, pour chaque article, un titre et un court résumé : de quoi
 * raconter l'actualité sans rien inventer. Chaque flux qui ne répond pas est
 * simplement ignoré.
 *
 * Les adresses sont aussi la liste fermée que le processus principal accepte
 * de télécharger (voir bureau/electron/principal.mjs) : les deux listes
 * doivent rester d'accord.
 */

export interface Media {
  id: string;
  nom: string;
  url: string;
  langue: 'fr' | 'en';
}

export const MEDIAS: readonly Media[] = [
  { id: 'echos-marches', nom: 'Les Echos', url: 'https://services.lesechos.fr/rss/les-echos-finance-marches.xml', langue: 'fr' },
  { id: 'echos-economie', nom: 'Les Echos', url: 'https://services.lesechos.fr/rss/les-echos-economie.xml', langue: 'fr' },
  { id: 'monde-economie', nom: 'Le Monde', url: 'https://www.lemonde.fr/economie/rss_full.xml', langue: 'fr' },
  { id: 'figaro-economie', nom: 'Le Figaro', url: 'https://www.lefigaro.fr/rss/figaro_economie.xml', langue: 'fr' },
  { id: 'franceinfo-economie', nom: 'franceinfo', url: 'https://www.francetvinfo.fr/economie.rss', langue: 'fr' },
  { id: 'bfm-economie', nom: 'BFM Business', url: 'https://www.bfmtv.com/rss/economie/', langue: 'fr' },
  { id: 'cnbc-marches', nom: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', langue: 'en' },
  { id: 'marketwatch', nom: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', langue: 'en' },
];

export interface ArticleMedia {
  titre: string;
  /** Une ou deux phrases, sans balises. */
  resume: string;
  source: string;
  /** Date ISO (AAAA-MM-JJ), vide si le flux n'en donne pas. */
  date: string;
  lien?: string;
  langue: 'fr' | 'en';
}

const ENTITES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '’',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ecirc: 'ê',
};

/** Texte lisible : CDATA ouvert, balises retirées, entités décodées. */
export function texteBrut(brut: string): string {
  return brut
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (tout: string, nom: string) => ENTITES[nom.toLowerCase()] ?? tout)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les deux premières phrases, sans dépasser `limite` caractères. */
export function resumeCourt(texte: string, limite = 320): string {
  const morceaux = texte.split(/(?<=[.!?])\s+/).filter(Boolean);
  let resume = '';
  for (const morceau of morceaux.slice(0, 2)) {
    if ((resume + ' ' + morceau).trim().length > limite) {
      break;
    }
    resume = (resume + ' ' + morceau).trim();
  }
  if (!resume && texte) {
    const coupe = texte.slice(0, limite);
    resume = `${coupe.slice(0, Math.max(coupe.lastIndexOf(' '), 0)) || coupe}…`;
  }
  return resume;
}

function balise(bloc: string, nom: string): string | undefined {
  const trouve = new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i').exec(bloc);
  return trouve ? trouve[1] : undefined;
}

function dateIso(brute: string | undefined): string {
  if (!brute) {
    return '';
  }
  const temps = Date.parse(texteBrut(brute));
  return Number.isNaN(temps) ? '' : new Date(temps).toISOString().slice(0, 10);
}

/** Articles d'un flux RSS 2.0 ou Atom. */
export function lireFlux(xml: string, media: Pick<Media, 'nom' | 'langue'>): ArticleMedia[] {
  const blocs = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const articles: ArticleMedia[] = [];
  for (const bloc of blocs) {
    const titre = texteBrut(balise(bloc, 'title') ?? '');
    if (!titre) {
      continue;
    }
    const description = texteBrut(
      balise(bloc, 'description') ?? balise(bloc, 'summary') ?? balise(bloc, 'content') ?? '',
    );
    // Un résumé qui ne fait que répéter le titre n'apporte rien à l'oreille.
    const resume = description && description !== titre ? resumeCourt(description) : '';
    const lienRss = balise(bloc, 'link');
    const lienAtom = /<link[^>]*href="([^"]+)"/i.exec(bloc)?.[1];
    articles.push({
      titre,
      resume,
      source: media.nom,
      date: dateIso(balise(bloc, 'pubDate') ?? balise(bloc, 'published') ?? balise(bloc, 'updated') ?? balise(bloc, 'dc:date')),
      lien: (lienRss ? texteBrut(lienRss) : lienAtom) || undefined,
      langue: media.langue,
    });
  }
  return articles;
}

const MOTS_GENERIQUES = new Set([
  'amundi', 'lyxor', 'ishares', 'bnp', 'paribas', 'easy', 'etf', 'ucits', 'swap', 'acc', 'dist', 'eur', 'usd',
  'sa', 'se', 'nv', 'plc', 'inc', 'corp', 'group', 'groupe', 'the', 'de', 'du', 'des', 'la', 'le', 'les', 'et',
  'pea', 'index', 'indice', 'fund', 'c', 'd',
]);

/** Mots qui désignent la valeur dans un article : « Air Liquide », « Stellantis », « MSCI World ». */
export function motsCles(nom: string): string[] {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(mot => mot.length >= 2 && !MOTS_GENERIQUES.has(mot));
}

function normaliser(texte: string): string {
  return ` ${texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
}

/** L'article parle-t-il de cette valeur ? Tous ses mots-clés doivent y figurer. */
export function concerne(article: ArticleMedia, nom: string): boolean {
  const mots = motsCles(nom).slice(0, 3);
  if (mots.length === 0) {
    return false;
  }
  const texte = normaliser(`${article.titre} ${article.resume}`);
  return mots.every(mot => texte.includes(` ${mot} `));
}

/** Articles des flux, du plus récent au plus ancien, sans doublon de titre. */
export async function chargerMedias(
  recuperer: (url: string) => Promise<string>,
  medias: readonly Media[] = MEDIAS,
): Promise<{ articles: ArticleMedia[]; echecs: number }> {
  const resultats = await Promise.allSettled(
    medias.map(async media => lireFlux(await recuperer(media.url), media)),
  );
  const vus = new Set<string>();
  const articles: ArticleMedia[] = [];
  let echecs = 0;
  for (const resultat of resultats) {
    if (resultat.status === 'rejected') {
      echecs += 1;
      continue;
    }
    for (const article of resultat.value) {
      const cle = normaliser(article.titre).trim();
      if (!vus.has(cle)) {
        vus.add(cle);
        articles.push(article);
      }
    }
  }
  articles.sort((a, b) => b.date.localeCompare(a.date));
  return { articles, echecs };
}
