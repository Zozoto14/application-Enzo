/**
 * Lecteurs d'une page d'épisode (ou de film) : on en extrait l'adresse
 * d'EMBED de chaque hôte vidéo (« LECTEUR A », « LECTEUR B »…), jamais la
 * page du site elle-même.
 *
 * Cas réel corrigé : un thème WordPress de catalogue propose ses lecteurs dans
 * un menu `<select>` dont les valeurs sont des NOMS (« LECTEUR A »), pas des
 * adresses. Lue comme une adresse relative, la valeur donnait la page de
 * l'épisode elle-même, affichée en entier (recherche, filtres, menus…) dans
 * le cadre du lecteur. Désormais :
 *  - une valeur n'est une adresse que si elle en a la forme (`https://`, `//`,
 *    `/chemin`) ; sinon c'est une clé ;
 *  - une clé se résout par : la table des lecteurs dans un script de la page,
 *    les attributs `data-*` de l'option, le lecteur visible (option choisie),
 *    l'appel AJAX du thème (`data-post` + `data-nume`), ou la même page avec
 *    `?host=<clé>` (le thème recharge la page pour changer de lecteur), dont on
 *    ne garde QUE l'iframe de l'hôte ;
 *  - valeurs encodées : HTML d'iframe, JSON (`embed_url`, `url`, `src`…),
 *    base64 ;
 *  - toute adresse qui retombe sur la page de l'épisode (ou une sous-page) est
 *    écartée.
 * Rien d'extractible : liste vide et diagnostic (sélecteurs essayés, iframes,
 * `data-src`, options trouvés), jamais la page en repli.
 */

import { classerMedia, urlPubliqueSure } from './garde';
import { lirePage, texteCompact, type Noeud, type Page } from './lecteurPage';
import { absolue, type SectionLecteur } from './sources';
import type { Lecteur } from './resolution';

/** Ce que l'analyse d'une page a trouvé (affiché quand aucun lecteur n'est lisible). */
export interface DiagnosticLecteurs {
  /** Page analysée. */
  url: string;
  /** Sélecteurs CSS essayés, dans l'ordre. */
  selecteurs: string[];
  /** Iframes présents sur la page (avec une adresse). */
  iframes: number;
  /** Attributs `data-src` / `data-embed` / `data-video`… avec une valeur. */
  dataSrc: number;
  /** Options / onglets de lecteurs trouvés. */
  options: number;
  /** Adresses de lecteur trouvées dans les scripts de la page. */
  scripts: number;
  /** Lecteurs demandés à part (AJAX ou `?host=`). */
  differes: number;
  /** Valeurs écartées et pourquoi (quelques-unes). */
  ecartes: string[];
}

export interface LecteursExtraits {
  lecteurs: Lecteur[];
  diagnostic: DiagnosticLecteurs;
}

/** Accès réseau dont l'extraction a besoin (lecteurs chargés à part). */
export interface AccesLecteurs {
  /** GET d'une page du site : son HTML. */
  page(url: string): Promise<string>;
  /** POST d'un formulaire (AJAX du site) : le corps de la réponse. */
  formulaire(url: string, corps: string): Promise<string>;
}

/** Au plus ce nombre de lecteurs par page (chacun peut coûter une requête). */
export const LECTEURS_MAX = 12;

const ATTRS_DONNEES = ['data-embed', 'data-video', 'data-player', 'data-src', 'data-lazy-src', 'data-url', 'data-link', 'data-iframe', 'data-frame'];
/** Menus / onglets de lecteurs courants, quand la source n'en configure pas. */
export const SELECTEURS_OPTIONS_GENERIQUES = [
  'select.host-select option',
  'select[name*="host" i] option',
  'select[class*="lecteur" i] option',
  'select[id*="lecteur" i] option',
  'select[class*="player" i] option',
  'select[class*="server" i] option',
  '[data-post][data-nume]',
  'a[href*="?host="], a[href*="&host="]',
];
/** Iframes qui ne sont jamais un lecteur (captcha, publicité, réseaux sociaux, commentaires). */
const PAS_UN_LECTEUR = /recaptcha|hcaptcha|challenges\.cloudflare|googletagmanager|doubleclick|googlesyndication|facebook\.com\/plugins|platform\.twitter|disqus|about:blank/i;

const cle = (s: string | null | undefined) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const adresseProbable = (v: string) => /^(https?:)?\/\/[^\s]/i.test(v) || /^\.{0,2}\/[^\s/]/.test(v);

function base64(v: string): string | null {
  if (v.length < 12 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return null;
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const net = v.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let acc = 0;
  const octets: number[] = [];
  for (const c of net) {
    const i = alpha.indexOf(c);
    if (i < 0) return null;
    acc = (acc << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets.push((acc >> bits) & 0xff);
    }
  }
  // Adresses, HTML d'iframe et JSON sont en ASCII ; sinon UTF-8 si l'environnement sait le décoder.
  let texte: string;
  if (octets.every(o => o < 0x80)) {
    texte = String.fromCharCode(...octets);
  } else {
    const Decodeur = (globalThis as { TextDecoder?: new (e: string, o: { fatal: boolean }) => { decode(b: Uint8Array): string } }).TextDecoder;
    if (!Decodeur) return null;
    try {
      texte = new Decodeur('utf-8', { fatal: true }).decode(new Uint8Array(octets));
    } catch {
      return null;
    }
  }
  // Du texte lisible seulement (une valeur quelconque décodée donne des octets de contrôle).
  return /[\u0000-\u0008\u000e-\u001f]/.test(texte) ? null : texte;
}

const deguillemeter = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');

/** Adresse brute contenue dans une valeur (adresse, HTML d'iframe, JSON, base64), ou null. */
export function adresseDansValeur(brut: string | null | undefined, profondeur = 0): string | null {
  const v = deguillemeter(String(brut ?? '').trim());
  if (!v || profondeur > 2) return null;
  const iframe = /<iframe\b[^>]*?\s(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i.exec(v);
  if (iframe) return adresseDansValeur(iframe[1], profondeur + 1);
  const video = /<(?:video|source)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(v);
  if (video) return adresseDansValeur(video[1], profondeur + 1);
  if (adresseProbable(v)) return v;
  if (/^[[{]/.test(v)) {
    try {
      return adresseDansJson(JSON.parse(v), profondeur + 1);
    } catch {
      return null;
    }
  }
  const decode = base64(v);
  return decode ? adresseDansValeur(decode, profondeur + 1) : null;
}

const CHAMPS_JSON = ['embed_url', 'embedUrl', 'embed', 'iframe', 'url', 'src', 'file', 'link', 'player', 'video'];
function adresseDansJson(o: unknown, profondeur: number): string | null {
  if (typeof o === 'string') return adresseDansValeur(o, profondeur);
  if (Array.isArray(o)) {
    for (const x of o) {
      const a = adresseDansJson(x, profondeur);
      if (a) return a;
    }
    return null;
  }
  if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    for (const c of CHAMPS_JSON) {
      if (r[c] != null) {
        const a = adresseDansJson(r[c], profondeur);
        if (a) return a;
      }
    }
    for (const c of ['data', 'result', 'sources']) {
      if (r[c] && typeof r[c] === 'object') {
        const a = adresseDansJson(r[c], profondeur);
        if (a) return a;
      }
    }
  }
  return null;
}

const SANS_ECHAPPEMENT = (s: string) => {
  try {
    return JSON.parse(`"${s.replace(/\n/g, '\\n')}"`) as string;
  } catch {
    return s.replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
};

/** Lecteurs écrits dans les scripts de la page : table « nom → iframe / adresse », et iframes en texte. */
export function lecteursDansScripts(page: Page): { table: Map<string, string>; libres: string[] } {
  const table = new Map<string, string>();
  const libres: string[] = [];
  for (const el of page.tous('script')) {
    if (page.attr(el, 'src')) continue;
    const texte = page.texte(el);
    if (!texte || texte.length > 500_000) continue;
    const paire = /(["'])((?:\\.|(?!\1)[^\\\n]){1,80})\1\s*:\s*(["'])((?:\\.|(?!\3)[^\\])*)\3/g;
    for (let m = paire.exec(texte); m; m = paire.exec(texte)) {
      const nom = SANS_ECHAPPEMENT(m[2]);
      const valeur = SANS_ECHAPPEMENT(m[4]);
      const a = adresseDansValeur(valeur);
      if (!a) continue;
      if (CHAMPS_JSON.includes(nom) || /^(https?:)?\/\//i.test(nom)) {
        libres.push(a);
      } else if (!table.has(cle(nom))) {
        table.set(cle(nom), a);
      }
    }
    const brut = SANS_ECHAPPEMENT(texte.replace(/\\"/g, '"'));
    const iframes = /<iframe\b[^>]*?\s(?:data-src|src)\s*=\s*["']([^"']+)["']/gi;
    for (let m = iframes.exec(brut); m; m = iframes.exec(brut)) libres.push(m[1]);
  }
  return { table, libres };
}

interface Candidat {
  nom: string;
  brut?: string | null;
  differe?: () => Promise<string | null>;
}

/** Adresse brute de l'iframe / de la vidéo d'un élément. */
const srcDe = (page: Page, el: Noeud) => page.attr(el, 'src') || page.attr(el, 'data-src') || page.attr(el, 'data-lazy-src') || null;

/** Iframes de lecteur de la page (captcha, publicité… écartés), du conteneur vidéo d'abord. */
export function iframesDeLecteur(page: Page): string[] {
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const el of page.tous('iframe')) {
    const s = srcDe(page, el);
    if (!s || PAS_UN_LECTEUR.test(s) || vus.has(s)) continue;
    vus.add(s);
    sortie.push(s);
  }
  return sortie;
}

function avecParametre(url: string, nom: string, valeur: string): string {
  const [sansAncre] = url.split('#');
  const [chemin, requete = ''] = sansAncre.split('?');
  const params = requete.split('&').filter(p => p && !p.startsWith(`${nom}=`));
  params.push(`${nom}=${encodeURIComponent(valeur).replace(/%20/g, '+')}`);
  return `${chemin}?${params.join('&')}`;
}

const cheminDe = (u: string) => {
  try {
    const x = new URL(u);
    return { hote: x.hostname.toLowerCase().replace(/^www\./, ''), chemin: decodeURIComponent(x.pathname).replace(/\/+$/, '') };
  } catch {
    return null;
  }
};

/** Vrai si l'adresse est la page de l'épisode elle-même (autre paramètre, ou « sous-page » d'une valeur relative). */
export function estLaPage(url: string, urlPage: string): boolean {
  const a = cheminDe(url);
  const p = cheminDe(urlPage);
  if (!a || !p || a.hote !== p.hote) return false;
  return a.chemin === p.chemin || (p.chemin !== '' && a.chemin.startsWith(`${p.chemin}/`));
}

export interface OptionsExtraction {
  /** Nom de la source (préfixe des libellés). */
  source?: string;
  /** Sélecteurs de la source ; absents : repérage automatique seulement. */
  player?: Partial<SectionLecteur>;
  /** Base des liens relatifs (après redirections / `<base href>`). */
  base?: string;
  /** Lecteurs chargés à part ; absent : seulement ce qui est dans la page. */
  acces?: AccesLecteurs;
  /** Page déjà analysée (sinon `html` est lu). */
  page?: Page;
}

/** Extrait les lecteurs (adresses d'embed des hôtes) d'une page d'épisode. */
export async function extraireLecteurs(html: string, urlPage: string, o: OptionsExtraction = {}): Promise<LecteursExtraits> {
  const page = o.page ?? lirePage(html);
  const base = o.base || urlPage;
  const prefixe = o.source ? `${o.source} - ` : '';
  const diag: DiagnosticLecteurs = { url: urlPage, selecteurs: [], iframes: 0, dataSrc: 0, options: 0, scripts: 0, differes: 0, ecartes: [] };
  const ecarter = (v: string, raison: string) => {
    if (diag.ecartes.length < 8) diag.ecartes.push(`${v.length > 60 ? `${v.slice(0, 57)}…` : v} : ${raison}`);
  };
  const iframes = iframesDeLecteur(page);
  diag.iframes = iframes.length;
  diag.dataSrc = page.tous(ATTRS_DONNEES.map(a => `[${a}]:not(img):not(script):not(link)`).join(', ')).filter(el => ATTRS_DONNEES.some(a => page.attr(el, a))).length;
  const scripts = lecteursDansScripts(page);
  diag.scripts = scripts.table.size + scripts.libres.length;
  const essayer = (selecteur: string, noter = true): Noeud[] => {
    if (noter && !diag.selecteurs.includes(selecteur)) diag.selecteurs.push(selecteur);
    try {
      return page.tous(selecteur);
    } catch {
      ecarter(selecteur, 'sélecteur invalide');
      return [];
    }
  };

  /** Un lecteur rechargé à part (même page avec `?host=`, ou réponse AJAX) : on n'en garde que l'iframe. */
  const depuisReponse = (corps: string): string | null => {
    const t = corps.trim();
    if (/^[[{]/.test(t)) {
      try {
        return adresseDansJson(JSON.parse(t), 0);
      } catch {
        // HTML commençant par une accolade : lu comme du HTML.
      }
    }
    const sous = lirePage(t);
    return iframesDeLecteur(sous)[0] ?? (sous.tous('video[src], video source[src]').map(e => sous.attr(e, 'src')).find(Boolean) as string | undefined) ?? null;
  };

  const candidats: Candidat[] = [];
  const parOption = (el: Noeud, i: number, attr: string | undefined, libelle: string | undefined) => {
    // « Choisir un lecteur… » : option vide ou désactivée, pas un lecteur.
    if (page.attr(el, 'disabled') !== null || page.attr(el, 'value') === '') return undefined;
    const nom = (libelle ? texteCompact(page, page.premier(el, libelle) ?? el) : texteCompact(page, el)) || page.attr(el, 'title') || `Lecteur ${i + 1}`;
    const valeurs = [attr ? page.attr(el, attr) : null, page.attr(el, 'value'), ...ATTRS_DONNEES.map(a => page.attr(el, a)), page.attr(el, 'href')].filter((v): v is string => Boolean(v && v.trim()));
    for (const v of valeurs) {
      const a = adresseDansValeur(v);
      if (a && !estLaPage(absolue(a, base) ?? '', urlPage)) return candidats.push({ nom, brut: a });
    }
    const valeur = valeurs[0] ?? '';
    const hoteDansLien = /[?&]host=([^&#]+)/.exec(page.attr(el, 'href') ?? '');
    const cleHote = hoteDansLien ? decodeURIComponent(hoteDansLien[1].replace(/\+/g, ' ')) : valeur && !adresseProbable(valeur) ? valeur : nom;
    const deTable = scripts.table.get(cle(cleHote)) ?? scripts.table.get(cle(nom));
    if (deTable) return candidats.push({ nom, brut: deTable });
    const post = page.attr(el, 'data-post');
    const nume = page.attr(el, 'data-nume');
    if (post && nume && o.acces) {
      diag.differes += 1;
      const action = page.attr(el, 'data-action') || 'doo_player_ajax';
      const corps = `action=${encodeURIComponent(action)}&post=${encodeURIComponent(post)}&nume=${encodeURIComponent(nume)}&type=${encodeURIComponent(page.attr(el, 'data-type') || 'tv')}`;
      const point = absolue('/wp-admin/admin-ajax.php', base);
      return candidats.push({ nom, differe: async () => (point ? depuisReponse(await o.acces!.formulaire(point, corps)) : null) });
    }
    // Option affichée par la page : le lecteur visible est le sien.
    const choisie = page.attr(el, 'selected') !== null || /\b(active|selected|current)\b/i.test(page.attr(el, 'class') ?? '');
    if (choisie && iframes[0]) return candidats.push({ nom, brut: iframes[0] });
    if (cleHote && o.acces) {
      diag.differes += 1;
      const cible = avecParametre(urlPage, 'host', cleHote);
      return candidats.push({ nom, differe: async () => depuisReponse(await o.acces!.page(cible)) });
    }
    ecarter(valeur || nom, 'ni adresse, ni lecteur associé');
    return undefined;
  };

  const p = o.player ?? {};
  if (p.options) {
    const els = essayer(p.options);
    diag.options += els.length;
    els.slice(0, LECTEURS_MAX).forEach((el, i) => parOption(el, i, p.optionAttr || 'value', p.optionLabel || undefined));
  }
  if (p.iframe) {
    essayer(p.iframe).forEach((el, i) => {
      const a = adresseDansValeur(page.attr(el, p.attr || 'src')) ?? adresseDansValeur(srcDe(page, el));
      if (a && !PAS_UN_LECTEUR.test(a)) candidats.push({ nom: `${p.label || 'Lecteur'} ${i + 1}`, brut: a });
    });
  }
  // Repérage automatique : menus / onglets de lecteurs courants, puis iframes, data-*, scripts, vidéos.
  if (!candidats.length) {
    diag.selecteurs.push('menus de lecteurs courants (select.host-select, [data-post][data-nume], liens ?host=…)');
    for (const s of SELECTEURS_OPTIONS_GENERIQUES) {
      const els = essayer(s, false);
      if (!els.length) continue;
      diag.options += els.length;
      els.slice(0, LECTEURS_MAX).forEach((el, i) => parOption(el, i, undefined, undefined));
      if (candidats.length) break;
    }
  }
  if (!candidats.length) {
    diag.selecteurs.push('iframe[src], iframe[data-src], iframe[data-lazy-src]');
    iframes.forEach(s => candidats.push({ nom: 'Lecteur', brut: s }));
    diag.selecteurs.push('[data-embed], [data-video], [data-src]… (attributs data-*)');
    for (const el of page.tous(ATTRS_DONNEES.map(a => `[${a}]:not(img):not(script):not(link)`).join(', '))) {
      const a = ATTRS_DONNEES.map(x => adresseDansValeur(page.attr(el, x))).find(Boolean);
      if (a) candidats.push({ nom: texteCompact(page, el).slice(0, 40) || 'Lecteur', brut: a });
    }
    diag.selecteurs.push('scripts (table de lecteurs, <iframe> en texte)');
    for (const [nom, a] of scripts.table) candidats.push({ nom: nom.toUpperCase(), brut: a });
    scripts.libres.forEach(a => candidats.push({ nom: 'Lecteur', brut: a }));
    diag.selecteurs.push('video[src], video source[src]');
    for (const el of page.tous('video[src], video source[src]')) candidats.push({ nom: 'Vidéo', brut: page.attr(el, 'src') });
  }

  const resolus = await Promise.all(
    candidats.slice(0, LECTEURS_MAX).map(async c => {
      if (!c.differe) return { nom: c.nom, brut: c.brut ?? null };
      try {
        return { nom: c.nom, brut: await c.differe() };
      } catch (e) {
        ecarter(c.nom, `lecteur chargé à part illisible (${e instanceof Error ? e.message : String(e)})`);
        return { nom: c.nom, brut: null };
      }
    }),
  );
  const lecteurs: Lecteur[] = [];
  const vus = new Set<string>();
  const noms = new Map<string, number>();
  for (const r of resolus) {
    if (!r.brut) continue;
    const url = urlPubliqueSure(absolue(r.brut, base));
    if (!url) {
      ecarter(r.brut, 'adresse refusée (non publique ou invalide)');
      continue;
    }
    if (estLaPage(url, urlPage)) {
      ecarter(r.brut, 'c’est la page de l’épisode, pas un lecteur');
      continue;
    }
    if (vus.has(url)) continue;
    vus.add(url);
    const n = (noms.get(r.nom) ?? 0) + 1;
    noms.set(r.nom, n);
    const nom = r.nom === 'Lecteur' || r.nom === 'Vidéo' ? `${r.nom} ${n}` : n > 1 ? `${r.nom} (${n})` : r.nom;
    lecteurs.push({ label: `${prefixe}${nom}`.trim(), url, kind: classerMedia(url) });
  }
  return { lecteurs, diagnostic: diag };
}

/** Diagnostic en une phrase (affiché sous « Lecteur introuvable sur cette page »). */
export function texteDiagnosticLecteurs(d: DiagnosticLecteurs): string {
  const s = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  return [
    `${s(d.iframes, 'iframe')}, ${s(d.dataSrc, 'attribut')} data-src/data-embed, ${s(d.options, 'option')} de lecteur, ${s(d.scripts, 'adresse')} dans les scripts${d.differes ? `, ${s(d.differes, 'lecteur')} chargé(s) à part` : ''}.`,
    `Sélecteurs essayés : ${d.selecteurs.join(' ; ') || 'aucun'}.`,
    d.ecartes.length ? `Écartés : ${d.ecartes.join(' ; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
