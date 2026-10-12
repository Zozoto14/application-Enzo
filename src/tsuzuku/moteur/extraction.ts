/**
 * Extraction GÉNÉRIQUE (sans sélecteurs propres au site) : ce que fait un
 * humain devant une page quand les sélecteurs configurés ne trouvent rien.
 *
 *  - réponses JSON : chemins (« data.results[0].title »), listes repérées
 *    automatiquement, fragments HTML renvoyés dans du JSON (points AJAX) ;
 *  - résultats de recherche : JSON-LD (ItemList, séries, films), cartes
 *    (<article>, titres h1-h4), liens à attribut `title`, image `alt` ;
 *  - titre d'une page d'oeuvre : og:title, h1, <title> ;
 *  - épisodes : liens dont le texte ou l'adresse dit « Épisode N », « EP N »,
 *    « E01 », « S2E03 », « 第N話 », numéro en fin d'adresse, y compris dans
 *    les blocs masqués, les menus (<option>) et les attributs data-* ;
 *  - pagination : rel=next, « Suivant », .pagination.
 *
 * Garde-fous : liens du même site seulement (ou de la page lue après
 * redirection), menus/en-têtes/pieds ignorés, nombre de candidats borné. Le
 * choix final passe TOUJOURS par l'appariement des titres et son seuil : un
 * candidat générique ne peut pas faire lire une autre oeuvre.
 */

import type { Element } from 'domhandler';
import { analyserAdresse, hoteDeSite } from './adresse';
import { texteCompact, type Noeud, type Page } from './lecteurPage';
import { absolue } from './sources';

export const MAX_CANDIDATS = 200;

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Lit un JSON sans lever (undefined si ce n'en est pas). */
export function analyserJson(texte: string): unknown {
  const t = String(texte ?? '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) {
    return undefined;
  }
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** La réponse est-elle du JSON (en-tête ou contenu) ? */
export function estReponseJson(typeContenu: string | null | undefined, corps: string): boolean {
  if (/json/i.test(typeContenu ?? '')) {
    return true;
  }
  return !/html|xml/i.test(typeContenu ?? '') && analyserJson(corps) !== undefined;
}

/**
 * Valeur à un chemin JSON : « data.items », « data.items[0].title »,
 * « data.items.0.title » ; « » ou « & » : la valeur elle-même ; « $. » en tête toléré.
 */
export function valeurJson(racine: unknown, chemin: string | null | undefined): unknown {
  const c = String(chemin ?? '').trim().replace(/^\$\.?/, '');
  if (!c || c === '&') {
    return racine;
  }
  let v: unknown = racine;
  for (const morceau of c.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (v === null || v === undefined || typeof v !== 'object') {
      return undefined;
    }
    v = (v as Record<string, unknown>)[morceau];
  }
  return v;
}

/** Texte d'une valeur JSON : chaîne, nombre, ou objet { rendered | name | title | text }. */
export function texteJson(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = decoderEntites(v.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return t || null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const cle of ['rendered', 'romaji', 'name', 'title', 'text', 'fr', 'en', 'value']) {
      const t = texteJson(o[cle]);
      if (t) {
        return t;
      }
    }
  }
  return null;
}

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'", rsquo: '’', lsquo: '‘', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

/** Entités HTML courantes dans un texte venu d'un JSON (« &#8217; », « &amp; »). */
export function decoderEntites(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITES[e.toLowerCase()] ?? m;
  });
}

const CLES_TITRE = ['title', 'name', 'titre', 'nom', 'label', 'post_title', 'title_english', 'romaji'];
const CLES_LIEN = ['url', 'link', 'permalink', 'href', 'lien', 'path', 'guid'];
const CLES_SLUG = ['slug', 'id'];
const CLES_IMAGE = ['image', 'img', 'poster', 'cover', 'thumbnail', 'thumb', 'image_url'];

export interface ResultatJson {
  title: string;
  url: string;
  image: string | null;
  year: string | null;
}

/** Une liste d'objets « qui ressemblent à des résultats » (titre + lien ou slug), cherchée jusqu'à 4 niveaux. */
export function listeAutoJson(racine: unknown): Record<string, unknown>[] | null {
  const essayer = (v: unknown, profondeur: number): Record<string, unknown>[] | null => {
    if (Array.isArray(v)) {
      const objets = v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x));
      if (objets.length && objets.some(o => CLES_TITRE.some(k => texteJson(o[k])) && [...CLES_LIEN, ...CLES_SLUG].some(k => o[k] != null))) {
        return objets;
      }
    }
    if (profondeur >= 4 || !v || typeof v !== 'object') {
      return null;
    }
    for (const x of Object.values(v as Record<string, unknown>)) {
      const r = essayer(x, profondeur + 1);
      if (r) {
        return r;
      }
    }
    return null;
  };
  return essayer(racine, 0);
}

/** Premier fragment HTML contenant des liens dans un JSON (réponse d'un point AJAX). */
export function fragmentHtmlJson(racine: unknown): string | null {
  const trouver = (v: unknown, profondeur: number): string | null => {
    if (typeof v === 'string') {
      return /<a\s[^>]*href=/i.test(v) ? v : null;
    }
    if (profondeur >= 5 || !v || typeof v !== 'object') {
      return null;
    }
    for (const x of Object.values(v as Record<string, unknown>)) {
      const r = trouver(x, profondeur + 1);
      if (r) {
        return r;
      }
    }
    return null;
  };
  return trouver(racine, 0);
}

/** Lien d'un élément JSON : chemin configuré, ou clés usuelles ; `format` : « /anime/{value} ». */
export function lienJson(el: Record<string, unknown>, chemin: string, format: string, base: string): string | null {
  let brut: unknown = chemin && chemin !== 'a' ? valeurJson(el, chemin) : undefined;
  if (brut == null && !format) {
    brut = CLES_LIEN.map(k => el[k]).find(v => typeof v === 'string' && v);
  }
  if (brut == null && format) {
    brut = [...CLES_SLUG, ...CLES_LIEN].map(k => el[k]).find(v => (typeof v === 'string' && v) || typeof v === 'number');
  }
  if (brut == null || (typeof brut !== 'string' && typeof brut !== 'number')) {
    return null;
  }
  const valeur = String(brut).trim();
  const lien = format ? format.replace(/\{value\}/g, encodeURIComponent(valeur).replace(/%2F/gi, '/')) : valeur;
  return absolue(lien, base);
}

/** Résultats d'une réponse JSON (chemins configurés, ou repérage automatique). */
export function resultatsJson(
  racine: unknown,
  o: { item: string; title: string; link: string; image: string; year: string; linkFormat: string },
  base: string,
): ResultatJson[] {
  let liste: unknown = o.item ? valeurJson(racine, o.item) : racine;
  if (!Array.isArray(liste)) {
    liste = liste && typeof liste === 'object' && !o.item ? listeAutoJson(liste) : liste && typeof liste === 'object' ? Object.values(liste as object) : null;
  }
  if (!Array.isArray(liste)) {
    liste = listeAutoJson(racine);
  }
  const sortie: ResultatJson[] = [];
  for (const el of (Array.isArray(liste) ? liste : []).slice(0, MAX_CANDIDATS)) {
    if (!el || typeof el !== 'object') {
      continue;
    }
    const objet = el as Record<string, unknown>;
    const titre = texteJson(o.title && o.title !== '&' ? valeurJson(objet, o.title) : CLES_TITRE.map(k => objet[k]).find(v => texteJson(v)));
    const url = lienJson(objet, o.link, o.linkFormat, base);
    if (!titre || !url) {
      continue;
    }
    const imageBrute = o.image ? valeurJson(objet, o.image) : CLES_IMAGE.map(k => objet[k]).find(v => typeof v === 'string');
    const annee = o.year ? texteJson(valeurJson(objet, o.year)) : null;
    sortie.push({ title: titre, url, image: typeof imageBrute === 'string' ? absolue(imageBrute, base) : null, year: annee });
  }
  return sortie;
}

// ---------------------------------------------------------------------------
// Pages HTML
// ---------------------------------------------------------------------------

/** Adresse de base d'une page : `<base href>` s'il existe (résolu par rapport à l'adresse lue). */
export function baseDePage(page: Page, url: string): string {
  const base = page.tous('base[href]')[0];
  const href = base ? page.attr(base, 'href') : null;
  return (href && absolue(href, url)) || url;
}

/** Redirection par `<meta http-equiv="refresh">` (miroirs, pages « le site a déménagé »). */
export function redirectionMeta(page: Page, url: string): string | null {
  for (const m of page.tous('meta[http-equiv]')) {
    if ((page.attr(m, 'http-equiv') || '').toLowerCase() !== 'refresh') {
      continue;
    }
    const cible = /url\s*=\s*['"]?([^'";]+)/i.exec(page.attr(m, 'content') || '');
    if (cible) {
      return absolue(cible[1].trim(), url);
    }
  }
  return null;
}

const ZONES_IGNOREES = new Set(['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'template']);
const CLASSES_IGNOREES = /(?:^|[\s_-])(?:nav|navbar|menu|header|footer|breadcrumb|sidebar|widget|social|share|login|pagination|comments?)(?:$|[\s_-])/i;

/** Lien dans un menu, un en-tête, un pied de page, une barre latérale… (`strict` faux : balises nav/header/footer seulement). */
function dansZoneIgnoree(el: Element, strict = true): boolean {
  for (let p = el.parent as Element | null; p && (p.type as string) !== 'root'; p = p.parent as Element | null) {
    const nom = (p.name || '').toLowerCase();
    if (strict ? ZONES_IGNOREES.has(nom) : nom === 'nav' || nom === 'header' || nom === 'footer') {
      return true;
    }
    const attribs = p.attribs || {};
    if (strict && CLASSES_IGNOREES.test(`${attribs.class ?? ''} ${attribs.id ?? ''} ${attribs.role ?? ''}`)) {
      return true;
    }
  }
  return false;
}

/** Ancêtre <article> (ou carte) le plus proche. */
function carteDe(el: Element): Element | null {
  for (let p = el.parent as Element | null, n = 0; p && (p.type as string) !== 'root' && n < 6; p = p.parent as Element | null, n += 1) {
    const nom = (p.name || '').toLowerCase();
    if (nom === 'article' || /(?:^|[\s_-])(?:card|item|result|post|movie|serie|anime|film)s?(?:$|[\s_-])/i.test(p.attribs?.class ?? '')) {
      return p;
    }
  }
  return null;
}

const CHEMINS_EXCLUS = /\/(?:tag|tags|categor(?:y|ie|ies)|genre|genres|page|author|auteur|login|connexion|register|inscription|contact|dmca|cgu|faq|search|recherche|feed|wp-login\.php|wp-admin)(?:\/|$)|[?&](?:s|q|query|search)=/i;

const meme = (a: string, b: string) => {
  const x = analyserAdresse(a);
  const y = analyserAdresse(b);
  return Boolean(x && y && hoteDeSite(x) === hoteDeSite(y));
};

const nettoyer = (t: string | null | undefined) => (t ? t.replace(/\s+/g, ' ').trim() : '');

/** Titre lisible d'un lien : attribut title, titre de la carte, alt de l'image, data-title, texte. */
function titreDeLien(page: Page, a: Noeud): { titre: string; poids: number } {
  const carte = carteDe(a);
  const titreCarte = carte ? page.dans(carte, 'h1, h2, h3, h4, .title, .titre, [class*="title"]')[0] : null;
  const essais: Array<[string | null | undefined, number]> = [
    [titreCarte ? texteCompact(page, titreCarte) : null, 4],
    [page.attr(a, 'title'), 3],
    [page.attr(a, 'data-title') || page.attr(a, 'aria-label'), 3],
    [page.dans(a, 'h1, h2, h3, h4')[0] ? texteCompact(page, page.dans(a, 'h1, h2, h3, h4')[0]) : null, 3],
    [texteCompact(page, a), 2],
    [page.dans(a, 'img[alt]')[0] ? page.attr(page.dans(a, 'img[alt]')[0], 'alt') : null, 1],
  ];
  for (const [t, poids] of essais) {
    const n = nettoyer(t);
    if (n.length >= 2 && n.length <= 160) {
      return { titre: n, poids };
    }
  }
  return { titre: '', poids: 0 };
}

export interface CandidatGenerique {
  title: string;
  url: string;
  image: string | null;
  year: string | null;
  /** D'où vient le candidat (diagnostic). */
  origine: 'json-ld' | 'carte' | 'lien';
}

/** Objets JSON-LD de la page (tableaux et @graph aplatis). */
function objetsJsonLd(page: Page): Record<string, unknown>[] {
  const sortie: Record<string, unknown>[] = [];
  const pousser = (v: unknown, profondeur = 0) => {
    if (profondeur > 6 || !v || typeof v !== 'object') {
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(x => pousser(x, profondeur + 1));
      return;
    }
    const o = v as Record<string, unknown>;
    sortie.push(o);
    for (const cle of ['@graph', 'itemListElement', 'item', 'mainEntity']) {
      if (o[cle]) {
        pousser(o[cle], profondeur + 1);
      }
    }
  };
  for (const s of page.tous('script[type="application/ld+json"]')) {
    pousser(analyserJson(page.texte(s)));
  }
  return sortie;
}

const TYPES_OEUVRE = /^(?:TVSeries|TVSeason|Movie|CreativeWork|CreativeWorkSeries|CreativeWorkSeason|VideoObject|TVEpisode|Book|ListItem|Thing)$/i;

/**
 * Candidats d'une page de résultats SANS sélecteur : JSON-LD, cartes et
 * liens titrés du même site. Bornés, dédoublonnés par adresse (meilleur titre gardé).
 */
export function candidatsGeneriques(page: Page, base: string, site: string): CandidatGenerique[] {
  const parUrl = new Map<string, CandidatGenerique & { poids: number }>();
  const ajouter = (c: CandidatGenerique, poids: number) => {
    const actuel = parUrl.get(c.url);
    if (!actuel || actuel.poids < poids) {
      parUrl.set(c.url, { ...c, poids });
    }
  };
  for (const o of objetsJsonLd(page)) {
    const type = String(o['@type'] ?? '');
    if (!TYPES_OEUVRE.test(type)) {
      continue;
    }
    const titre = texteJson(o.name) || texteJson(o.headline) || texteJson((o.item as Record<string, unknown> | undefined)?.name);
    const lien = (typeof o.url === 'string' && o.url) || (typeof o['@id'] === 'string' && /^https?:|^\//.test(o['@id'] as string) ? (o['@id'] as string) : null) || (typeof o.item === 'string' ? o.item : null);
    const url = lien ? absolue(lien, base) : null;
    if (titre && url && (meme(url, site) || meme(url, base))) {
      ajouter({ title: titre, url, image: typeof o.image === 'string' ? absolue(o.image, base) : null, year: null, origine: 'json-ld' }, 5);
    }
  }
  for (const a of page.tous('a[href]')) {
    if (parUrl.size >= MAX_CANDIDATS) {
      break;
    }
    const url = absolue(page.attr(a, 'href'), base);
    if (!url || !(meme(url, site) || meme(url, base)) || dansZoneIgnoree(a)) {
      continue;
    }
    const cible = analyserAdresse(url);
    if (!cible || cible.chemin.replace(/\/+$/, '') === '' || CHEMINS_EXCLUS.test(`${cible.chemin}${cible.requete}`) || url.split('#')[0] === base.split('#')[0]) {
      continue;
    }
    const { titre, poids } = titreDeLien(page, a);
    if (!titre || /^(?:\d+|suivant|précédent|next|prev|previous|«|»|voir plus|lire la suite|read more)$/i.test(titre)) {
      continue;
    }
    const img = page.dans(a, 'img')[0] ?? (carteDe(a) ? page.dans(carteDe(a)!, 'img')[0] : undefined);
    const image = img ? absolue(page.attr(img, 'data-src') || page.attr(img, 'data-lazy-src') || page.attr(img, 'src'), base) : null;
    ajouter({ title: titre, url, image, year: null, origine: carteDe(a) ? 'carte' : 'lien' }, poids);
  }
  return [...parUrl.values()].map(({ poids: _p, ...c }) => c);
}

/** Titres possibles d'une page d'oeuvre (page atteinte par `{slug}`) : og:title, h1, <title> et sa première partie. */
export function titresDePage(page: Page): string[] {
  const meta = (nom: string) => {
    const el = page.tous(`meta[property="${nom}"], meta[name="${nom}"]`)[0];
    return el ? page.attr(el, 'content') : null;
  };
  const h1 = page.tous('h1')[0];
  const titre = page.tous('title')[0];
  const t = titre ? texteCompact(page, titre) : '';
  const brut = [meta('og:title'), h1 ? texteCompact(page, h1) : null, t, t.split(/\s+[|–—-]\s+/)[0]];
  for (const o of objetsJsonLd(page)) {
    if (TYPES_OEUVRE.test(String(o['@type'] ?? ''))) {
      brut.push(texteJson(o.name));
    }
  }
  return [...new Set(brut.map(nettoyer).filter(x => x.length >= 2 && x.length <= 200))];
}

// ---------------------------------------------------------------------------
// Épisodes
// ---------------------------------------------------------------------------

export interface EpisodeGenerique {
  number: number;
  title: string | null;
  url: string;
  saison: number | null;
}

const NUM_TEXTE: ReadonlyArray<RegExp> = [
  /\bs(\d{1,2})\s*[-.]?\s*e(?:p)?\s*(\d{1,4})\b/i,
  /(?:épisode|episode|episodio|ep|eps)\.?\s*#?\s*(\d{1,4})\b/i,
  /\be(\d{1,4})\b/i,
  /第\s*(\d{1,4})\s*[話话集]/,
];
const NUM_ADRESSE: ReadonlyArray<RegExp> = [
  /s(\d{1,2})[-_]?e(\d{1,4})(?:\D|$)/i,
  /(?:episode|episodes|episodio|ep)[-_/]?(\d{1,4})(?:[-_/.]|$)/i,
];

/** Numéro (et saison) d'épisode lisible dans un texte ou une adresse ; null sinon. */
export function numeroEtSaison(texte: string, href: string): { number: number; saison: number | null } | null {
  const saisonTexte = /\b(?:saison|season)\s*(\d{1,2})\b/i.exec(texte) ?? /(?:saison|season)[-_]?(\d{1,2})(?:\D|$)/i.exec(href);
  const saison = saisonTexte ? Number(saisonTexte[1]) : null;
  for (const motif of NUM_TEXTE) {
    const m = motif.exec(texte);
    if (m) {
      return m.length > 2 && m[2] ? { number: Number(m[2]), saison: Number(m[1]) } : { number: Number(m[1]), saison };
    }
  }
  const chemin = href.replace(/[?#].*$/, '');
  for (const motif of NUM_ADRESSE) {
    const m = motif.exec(chemin);
    if (m) {
      return m.length > 2 && m[2] ? { number: Number(m[2]), saison: Number(m[1]) } : { number: Number(m[1]), saison };
    }
  }
  // Lien dont le texte n'est qu'un numéro (« 12 ») et dont l'adresse finit par ce numéro.
  const seul = /^\d{1,4}$/.exec(texte.trim());
  if (seul && new RegExp(`(?:^|\\D)${seul[0]}/?$`).test(chemin)) {
    return { number: Number(seul[0]), saison };
  }
  return null;
}

/**
 * Épisodes d'une page de série SANS sélecteur : liens, options de menus et
 * éléments data-* dont le texte ou l'adresse désigne un épisode. Blocs
 * masqués compris (le HTML est lu tel quel, sans CSS).
 */
export function episodesGeneriques(page: Page, base: string, site: string, serie: string): EpisodeGenerique[] {
  const sortie: EpisodeGenerique[] = [];
  const vus = new Set<string>();
  const pousser = (href: string | null, texte: string) => {
    const url = absolue(href, base);
    if (!url || vus.has(url) || url.split('#')[0] === serie.split('#')[0] || !(meme(url, site) || meme(url, base))) {
      return;
    }
    const n = numeroEtSaison(texte, url);
    if (!n || n.number <= 0 || n.number > 5000) {
      return;
    }
    vus.add(url);
    sortie.push({ number: n.number, saison: n.saison, title: texte && !/^\d+$/.test(texte) ? texte.slice(0, 120) : null, url });
  };
  for (const a of page.tous('a[href]')) {
    if (sortie.length >= 2000) {
      break;
    }
    // Les listes d'épisodes sont parfois dans une barre latérale : seuls menus, en-têtes et pieds sont écartés.
    if (dansZoneIgnoree(a, false)) {
      continue;
    }
    pousser(page.attr(a, 'href'), texteCompact(page, a) || page.attr(a, 'title') || '');
  }
  for (const o of page.tous('option[value]')) {
    pousser(page.attr(o, 'value'), texteCompact(page, o));
  }
  for (const el of page.tous('[data-episode], [data-ep], [data-episode-url], [data-href], [data-url]')) {
    const href = page.attr(el, 'data-episode-url') || page.attr(el, 'data-href') || page.attr(el, 'data-url');
    const num = page.attr(el, 'data-episode') || page.attr(el, 'data-ep');
    pousser(href, num ? `Épisode ${num}` : texteCompact(page, el));
  }
  return sortie;
}

/** Garde la saison voulue quand la page en mélange plusieurs (onglets de saisons). */
export function filtrerSaison<T extends { saison: number | null }>(episodes: T[], voulue: number | null): T[] {
  const saisons = new Set(episodes.map(e => e.saison).filter((s): s is number => s != null));
  if (saisons.size <= 1) {
    return episodes;
  }
  const cible = voulue ?? Math.min(...saisons);
  const garde = episodes.filter(e => e.saison === cible || (e.saison == null && cible === 1));
  return garde.length ? garde : episodes;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Lien « page suivante » d'une liste paginée (sélecteur configuré, sinon rel=next / « Suivant »). */
export function lienSuivant(page: Page, base: string, selecteur?: string): string | null {
  const essais: Noeud[] = [];
  if (selecteur) {
    try {
      essais.push(...page.tous(selecteur));
    } catch {
      // Sélecteur invalide : la validation le signale ailleurs.
    }
  }
  essais.push(...page.tous('link[rel~="next"], a[rel~="next"]'));
  for (const a of page.tous('.pagination a, .pager a, nav a, a.next, a.suivant, [class*="pagination"] a')) {
    const t = texteCompact(page, a);
    if (/^(?:suivant(?:e)?|next|page suivante|›|»|>)$/i.test(t) || /next|suivant/i.test(page.attr(a, 'class') || '') || /suivant|next/i.test(page.attr(a, 'aria-label') || '')) {
      essais.push(a);
    }
  }
  for (const el of essais) {
    const url = absolue(page.attr(el, 'href'), base);
    if (url && url.split('#')[0] !== base.split('#')[0]) {
      return url;
    }
  }
  return null;
}
