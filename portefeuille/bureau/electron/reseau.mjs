/**
 * Accès réseau restreints, partagés par le processus principal d'Electron et
 * par le relais Cloudflare (relais/worker.mjs) qui sert le site de secours
 * et l'iPhone.
 *
 * Dans les deux cas la règle est la même : une **liste fermée** d'adresses.
 * Ni la fenêtre du bureau ni un visiteur du relais ne peuvent s'en servir
 * pour joindre autre chose que Yahoo Finance et les médias connus.
 *
 * Aucune dépendance à Node ni à Electron : seulement `fetch`, `URL` et
 * `AbortSignal`, présents partout.
 */

export const CHEMINS_YAHOO = [
  '/v10/finance/quoteSummary/',
  '/ws/fundamentals-timeseries/v1/finance/timeseries/',
  '/v8/finance/chart/',
  '/v1/finance/search',
];
/** Adresse Yahoo que l'on accepte de relayer. */
export function adresseYahooAutorisee(url) {
  return (
    url.protocol === 'https:' &&
    /^query[12]\.finance\.yahoo\.com$/.test(url.hostname) &&
    CHEMINS_YAHOO.some(chemin => url.pathname.startsWith(chemin))
  );
}

/**
 * Flux RSS de la revue de presse. Liste fermée, la même que
 * src/podcast/medias.ts : le rendu ne peut pas faire télécharger autre chose.
 */
export const FLUX_MEDIAS = new Set([
  'https://services.lesechos.fr/rss/les-echos-finance-marches.xml',
  'https://services.lesechos.fr/rss/les-echos-economie.xml',
  'https://www.lemonde.fr/economie/rss_full.xml',
  'https://www.lefigaro.fr/rss/figaro_economie.xml',
  'https://www.francetvinfo.fr/economie.rss',
  'https://www.bfmtv.com/rss/economie/',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
]);
export const TAILLE_MAX_FLUX = 3 * 1024 * 1024;

/** Recherche d'actualités par valeur : seule la requête varie. */
export function rechercheActualitesAutorisee(adresse) {
  try {
    const url = new URL(adresse);
    return (
      url.origin === 'https://news.google.com' &&
      url.pathname === '/rss/search' &&
      adresse.length < 400 &&
      [...url.searchParams.keys()].every(cle => ['q', 'hl', 'gl', 'ceid'].includes(cle))
    );
  } catch {
    return false;
  }
}

/**
 * Thèses d'une valeur : analyses Seeking Alpha et discussions Reddit, sur
 * des chemins fixes. Même règle que src/fondamentaux/theses.ts.
 */
export function adresseThesesAutorisee(adresse) {
  try {
    const url = new URL(adresse);
    if (adresse.length >= 500) return false;
    if (url.origin === 'https://seekingalpha.com') {
      return /^\/api\/sa\/combined\/[A-Z]{1,5}(-[A-Z])?\.xml$/.test(url.pathname) && url.search === '';
    }
    if (url.origin === 'https://www.reddit.com') {
      return (
        ['/r/vosfinances+Bourse/search.rss', '/r/stocks+investing+ValueInvesting/search.rss'].includes(url.pathname) &&
        [...url.searchParams.keys()].every(cle => ['q', 'restrict_sr', 'sort', 't'].includes(cle))
      );
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Pages d'articles des médias connus, pour en tirer le chapeau. Même liste
 * que src/podcast/extraits.ts ; la redirection finale est vérifiée aussi.
 */
export const SITES_ARTICLES = [
  'lesechos.fr', 'lemonde.fr', 'lefigaro.fr', 'bfmtv.com', 'francetvinfo.fr', 'boursorama.com',
  'zonebourse.com', 'capital.fr', 'latribune.fr', 'challenges.fr', 'lexpress.fr', 'lepoint.fr',
  'leparisien.fr', 'ouest-france.fr', 'abcbourse.com', 'boursier.com', 'cnbc.com', 'marketwatch.com',
  'reuters.com', 'finance.yahoo.com', 'fool.com', 'investing.com', 'morningstar.fr', 'morningstar.com',
];
export const TAILLE_MAX_PAGE = 800 * 1024;

export function pageAutorisee(adresse) {
  try {
    const url = new URL(adresse);
    return (
      url.protocol === 'https:' &&
      adresse.length < 600 &&
      SITES_ARTICLES.some(site => url.hostname === site || url.hostname.endsWith(`.${site}`))
    );
  } catch {
    return false;
  }
}

/** Flux RSS relayable : médias connus, recherche d'actualités, thèses. */
export function fluxAutorise(adresse) {
  return FLUX_MEDIAS.has(adresse) || rechercheActualitesAutorisee(adresse) || adresseThesesAutorisee(adresse);
}

export const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

let sessionYahoo;

async function ouvrirSessionYahoo() {
  // Le cookie vient de n'importe quelle page du domaine ; fc.yahoo.com le
  // pose même en répondant 404.
  const reponse = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': AGENT }, redirect: 'manual' });
  const cookies = (reponse.headers.getSetCookie?.() ?? [reponse.headers.get('set-cookie') ?? ''])
    .map(ligne => ligne.split(';')[0])
    .filter(Boolean)
    .join('; ');
  const jeton = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': AGENT, Cookie: cookies },
  });
  const crumb = (await jeton.text()).trim();
  if (!jeton.ok || !crumb || crumb.includes('<')) {
    throw new Error(`Jeton Yahoo refusé (${jeton.status}).`);
  }
  return { cookies, crumb };
}

export async function pageArticle(adresse) {
  if (!pageAutorisee(adresse)) {
    throw new Error('Page non autorisée.');
  }
  const reponse = await fetch(adresse, {
    headers: { 'User-Agent': AGENT, Accept: 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!reponse.ok || !pageAutorisee(reponse.url || adresse)) {
    throw new Error(`La page a répondu ${reponse.status}.`);
  }
  const texte = await reponse.text();
  return texte.length > TAILLE_MAX_PAGE ? texte.slice(0, TAILLE_MAX_PAGE) : texte;
}

export async function fluxMedia(adresse) {
  if (!fluxAutorise(adresse)) {
    throw new Error('Flux non autorisé.');
  }
  const reponse = await fetch(adresse, {
    headers: { 'User-Agent': AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!reponse.ok) {
    throw new Error(`Le flux a répondu ${reponse.status}.`);
  }
  const texte = await reponse.text();
  return texte.length > TAILLE_MAX_FLUX ? texte.slice(0, TAILLE_MAX_FLUX) : texte;
}

/**
 * Screener de Yahoo : une requête POST sur une seule adresse. Le corps est
 * composé par src/fondamentaux/screener.ts ; ici, on vérifie seulement que
 * c'est un petit objet JSON.
 */
export async function yahooScreener(corps) {
  const texte = JSON.stringify(corps ?? {});
  if (texte.length > 8_000 || typeof corps !== 'object' || Array.isArray(corps)) {
    throw new Error('Requête de screener refusée.');
  }
  for (let essai = 0; essai < 2; essai++) {
    if (!sessionYahoo) {
      sessionYahoo = await ouvrirSessionYahoo();
    }
    const url = new URL('https://query1.finance.yahoo.com/v1/finance/screener');
    url.searchParams.set('crumb', sessionYahoo.crumb);
    url.searchParams.set('lang', 'fr-FR');
    url.searchParams.set('region', 'FR');
    url.searchParams.set('formatted', 'false');
    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': AGENT,
        Cookie: sessionYahoo.cookies,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: texte,
    });
    if (reponse.status === 401 || reponse.status === 403) {
      sessionYahoo = undefined;
      continue;
    }
    if (!reponse.ok) {
      throw new Error(`Le screener Yahoo a répondu ${reponse.status}.`);
    }
    return await reponse.json();
  }
  throw new Error('Yahoo refuse l’accès au screener.');
}

export async function yahooJson(adresse) {
  const url = new URL(adresse);
  if (!adresseYahooAutorisee(url)) {
    throw new Error(`Adresse non autorisée : ${url.hostname}${url.pathname}`);
  }

  for (let essai = 0; essai < 2; essai++) {
    if (!sessionYahoo) {
      sessionYahoo = await ouvrirSessionYahoo();
    }
    url.searchParams.set('crumb', sessionYahoo.crumb);
    const reponse = await fetch(url, {
      headers: { 'User-Agent': AGENT, Cookie: sessionYahoo.cookies, Accept: 'application/json' },
    });
    if (reponse.status === 401 || reponse.status === 403) {
      // Jeton expiré : on en redemande un, une fois.
      sessionYahoo = undefined;
      continue;
    }
    if (!reponse.ok) {
      throw new Error(`Yahoo a répondu ${reponse.status}.`);
    }
    return await reponse.json();
  }
  throw new Error('Yahoo refuse l’accès, même avec un nouveau jeton.');
}

