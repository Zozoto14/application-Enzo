/**
 * Assistant d'ajout de source par lien (Administration › Tsuzuku › Sources).
 *
 * Outil GÉNÉRIQUE d'analyse d'une page que l'administrateur a le droit
 * d'utiliser : aucune source n'est fournie, aucun site n'est connu d'avance.
 *
 *  1. `analyserSite` lit la page par le client réseau protégé (anti-SSRF,
 *     taille bornée, délai) ;
 *  2. `analyserStructure` en tire un résumé : balises/classes récurrentes,
 *     formulaires de recherche, liens qui ressemblent à des épisodes, iframes,
 *     menus de lecteurs ; `extraitHtml` garde un extrait allégé (sans scripts,
 *     styles ni commentaires) ;
 *  3. `genererPrompt` compose un texte à copier vers une IA : il décrit TOUT le
 *     format de source du moteur (animés ET films) et des règles de qualité ;
 *  4. `validerSourceJson` vérifie le JSON renvoyé (schéma du moteur, sélecteurs
 *     CSS valides, `{query}` présent, adresse publique) avant le test pas à pas.
 *
 * Données pures, hors `analyserSite` : testées avec des pages neutres faites main.
 */

import { echec, messageDe } from './erreurs';
import { lirePage, sembleRenduEnJs, texteCompact, type Page } from './lecteurPage';
import type { ClientSur } from './reseau';
import { normaliserSource, supporteAnimes, supporteFilms, type DefinitionSource, type OptionsNormalisation } from './sources';

/** Taille maximale d'une page analysée (plus petite que celle d'une lecture). */
export const TAILLE_MAX_ANALYSE = 2 * 1024 * 1024;
/** Longueur maximale de l'extrait HTML joint au prompt. */
export const LONGUEUR_EXTRAIT = 14000;

export interface Recurrent {
  selecteur: string;
  nombre: number;
  /** Texte du premier élément, raccourci. */
  exemple: string;
}

export interface Formulaire {
  action: string;
  methode: string;
  champs: string[];
}

export interface ResumeStructure {
  url: string;
  titre: string;
  octets: number;
  /** Page quasi vide mais pleine de scripts : les sélecteurs ne trouveront peut-être rien. */
  renduJs: boolean;
  recurrents: Recurrent[];
  formulaires: Formulaire[];
  /** Liens dont le texte ou l'adresse évoque un épisode (numéro, « épisode », « ep »). */
  liensEpisodes: Array<{ texte: string; href: string }>;
  iframes: Array<{ selecteur: string; src: string }>;
  menus: Array<{ selecteur: string; options: number; exemple: string }>;
  images: number;
}

const court = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const nomSelecteur = (page: Page, el: ReturnType<Page['tous']>[number]) => {
  const id = page.attr(el, 'id');
  const classes = (page.attr(el, 'class') || '').split(/\s+/).filter(c => c && c.length <= 40).slice(0, 2);
  return `${el.name.toLowerCase()}${id && id.length <= 40 ? `#${id}` : ''}${classes.map(c => `.${c}`).join('')}`;
};
const MOTIF_EPISODE = /(episode|épisode|\bep\b|\bep[-_ .]?\d|saison|season|\bs\d+e\d+)/i;

export function analyserStructure(html: string, url: string): ResumeStructure {
  const page = lirePage(html);
  const titre = page.tous('title').map(t => texteCompact(page, t))[0] ?? '';

  // Balises + classe qui se répètent : « un résultat », « un épisode ».
  const compte = new Map<string, { n: number; exemple: string }>();
  for (const el of page.tous('[class]')) {
    const balise = el.name.toLowerCase();
    if (['html', 'body', 'script', 'style', 'svg', 'path'].includes(balise)) continue;
    for (const cls of (page.attr(el, 'class') || '').split(/\s+/).filter(Boolean)) {
      if (cls.length > 40) continue;
      const cle = `${balise}.${cls}`;
      const actuel = compte.get(cle);
      if (actuel) actuel.n++;
      else compte.set(cle, { n: 1, exemple: court(texteCompact(page, el)) });
    }
  }
  const recurrents = [...compte.entries()]
    .filter(([, v]) => v.n >= 2 && v.n <= 500)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([selecteur, v]) => ({ selecteur, nombre: v.n, exemple: v.exemple }));

  const formulaires = page.tous('form').slice(0, 5).map(f => ({
    action: court(page.attr(f, 'action') || '', 120),
    methode: (page.attr(f, 'method') || 'get').toLowerCase(),
    champs: page
      .dans(f, 'input, select, textarea')
      .map(c => page.attr(c, 'name') || '')
      .filter(Boolean)
      .slice(0, 8),
  }));

  const liensEpisodes = page
    .tous('a[href]')
    .map(a => ({ texte: court(texteCompact(page, a), 50), href: court(page.attr(a, 'href') || '', 120) }))
    .filter(l => MOTIF_EPISODE.test(l.texte) || MOTIF_EPISODE.test(l.href))
    .slice(0, 8);

  const iframes = page.tous('iframe').slice(0, 6).map(i => ({ selecteur: nomSelecteur(page, i), src: court(page.attr(i, 'src') || page.attr(i, 'data-src') || '', 120) }));
  const menus = page
    .tous('select')
    .map(s => ({ el: s, options: page.dans(s, 'option') }))
    .filter(m => m.options.length >= 2)
    .slice(0, 4)
    .map(m => ({ selecteur: `${nomSelecteur(page, m.el)} option`, options: m.options.length, exemple: court(`${page.attr(m.options[0], 'value') || ''} — ${texteCompact(page, m.options[0])}`) }));

  return {
    url,
    titre: court(titre, 100),
    octets: html.length,
    renduJs: sembleRenduEnJs(page),
    recurrents,
    formulaires,
    liensEpisodes,
    iframes,
    menus,
    images: page.tous('img').length,
  };
}

/** Extrait allégé du HTML : sans scripts, styles, SVG ni commentaires, espaces compactés, borné. */
export function extraitHtml(html: string, max = LONGUEUR_EXTRAIT): string {
  const allege = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\s(style|on[a-z]+)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\sdata:[^"'\s>]{60,}/gi, ' data:…')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '>\n<')
    .trim();
  return allege.length > max ? `${allege.slice(0, max)}\n<!-- … extrait tronqué (${allege.length} caractères au total) -->` : allege;
}

/** Lit la page par le client réseau protégé et en tire le résumé et l'extrait. */
export async function analyserSite(client: ClientSur, adresse: string): Promise<{ resume: ResumeStructure; extrait: string }> {
  const url = String(adresse ?? '').trim();
  if (!url) throw echec('Collez l’adresse d’une page du site.', 'configuration', 400);
  const rep = await client.texte(url, { tailleMax: TAILLE_MAX_ANALYSE });
  const type = (rep.typeContenu || '').toLowerCase();
  if (type && !type.includes('html') && !type.includes('xml') && !type.includes('text/plain')) {
    throw echec(`Cette adresse ne renvoie pas une page HTML (${type}).`, 'configuration', 415);
  }
  return { resume: analyserStructure(rep.corps, rep.url), extrait: extraitHtml(rep.corps) };
}

// ------------------------------------------------------------------ Prompt

/** Description du format de source du moteur (tous les paramètres), reprise dans le prompt et la doc. */
export const FORMAT_SOURCE = `{
  "name": "Nom lisible de la source",
  "baseUrl": "https://… (adresse racine du site, publique)",
  "language": "vf | vostfr | indifferent (doublage principal du site)",
  "timeout": 15000,
  "search": {                      // ANIMÉS · page de résultats de recherche
    "path": "/chemin?q={query}",   // {query} = titre recherché (encodé) ; OBLIGATOIRE pour les animés
    "pathVf": "",                  // facultatif : chemin distinct pour la VF
    "pathVostfr": "",              // facultatif : chemin distinct pour la VOSTFR
    "item": "sélecteur CSS d'UN résultat",
    "title": "sélecteur du titre, relatif à item (« & » = item lui-même)",
    "link": "sélecteur du lien <a>, relatif à item (défaut « a »)",
    "image": "sélecteur de l'image, relatif à item (facultatif)",
    "imageAttr": "src (ou data-src…)",
    "year": ""
  },
  "episodes": {                    // ANIMÉS · page d'une série : liste des épisodes
    "item": "sélecteur d'UN épisode",
    "number": "sélecteur du numéro, relatif à item",
    "title": "sélecteur du titre de l'épisode (facultatif)",
    "link": "sélecteur du lien vers la page de l'épisode (défaut « a »)"
  },
  "player": {                      // ANIMÉS · page d'un épisode : lecteurs
    "iframe": "sélecteur des <iframe> du lecteur",
    "attr": "src (ou data-src…)",
    "label": "nom affiché du lecteur (défaut « Lecteur »)",
    "options": "sélecteur des <option> d'un menu de lecteurs (facultatif)",
    "optionAttr": "value",
    "optionLabel": "sélecteur du nom dans l'option (facultatif)"
  },
  "movies": {                      // FILMS · laisser vide si le site n'a pas de films
    "search": { "path": "/films?q={query}", "pathVf": "", "pathVostfr": "", "item": "", "title": "", "link": "a", "image": "", "imageAttr": "src", "year": "sélecteur de l'année (facultatif)" },
    "player": { "iframe": "", "attr": "src", "label": "Lecteur", "options": "", "optionAttr": "value", "optionLabel": "" }
  }
}`;

function lignesResume(r: ResumeStructure): string[] {
  const l: string[] = [`Adresse analysée : ${r.url}`, `Titre de la page : ${r.titre || '(aucun)'}`, `Taille : ${r.octets} caractères ; ${r.images} image(s).`];
  if (r.renduJs) l.push('ATTENTION : la page semble construite en JavaScript (corps presque vide) ; les sélecteurs risquent de ne rien trouver.');
  l.push('Éléments récurrents (balise.classe × nombre — exemple de texte) :');
  l.push(...(r.recurrents.length ? r.recurrents.map(x => `  - ${x.selecteur} × ${x.nombre} — « ${x.exemple} »`) : ['  (aucun)']));
  l.push('Formulaires :');
  l.push(...(r.formulaires.length ? r.formulaires.map(f => `  - ${f.methode.toUpperCase()} ${f.action || '(même page)'} ; champs : ${f.champs.join(', ') || '(aucun)'}`) : ['  (aucun)']));
  l.push('Liens qui évoquent des épisodes :');
  l.push(...(r.liensEpisodes.length ? r.liensEpisodes.map(x => `  - « ${x.texte} » → ${x.href}`) : ['  (aucun)']));
  l.push('Iframes :');
  l.push(...(r.iframes.length ? r.iframes.map(x => `  - ${x.selecteur} → ${x.src || '(sans src)'}`) : ['  (aucune)']));
  l.push('Menus déroulants (lecteurs possibles) :');
  l.push(...(r.menus.length ? r.menus.map(x => `  - ${x.selecteur} × ${x.options} — ${x.exemple}`) : ['  (aucun)']));
  return l;
}

/**
 * Texte prêt à copier vers une IA : elle doit renvoyer UN objet JSON au format
 * de source du moteur, en s'appuyant sur le résumé et l'extrait joints.
 */
export function genererPrompt(resume: ResumeStructure, extrait: string): string {
  return [
    'Tu aides à configurer une source pour Tsuzuku, un lecteur qui lit des pages web par sélecteurs CSS.',
    'La source peut servir aux ANIMÉS (recherche → liste d’épisodes → lecteur), aux FILMS (recherche → page du film → lecteur), ou aux deux.',
    '',
    'Propose UNE définition de source complète, au format JSON ci-dessous (tous les paramètres ; mets "" pour une partie que le site n’a pas) :',
    '',
    FORMAT_SOURCE,
    '',
    'Règles de qualité :',
    '1. Sélecteurs CSS ROBUSTES : classes ou attributs stables et parlants ; évite les classes générées (suites aléatoires), les :nth-child et les chemins trop longs.',
    '2. title, link, image, number et year sont RELATIFS à item ; « & » désigne item lui-même.',
    '3. Les chemins de recherche commencent par « / » et contiennent {query} ; déduis-les du formulaire de recherche (action + nom du champ).',
    '4. Vérifie chaque sélecteur sur AU MOINS 2 exemples de l’extrait (deux résultats, deux épisodes…) et indique-les brièvement après le JSON.',
    '5. N’invente rien : si une partie n’apparaît pas dans l’extrait (page d’épisode, lecteur, films), laisse ses champs vides et dis quelle page me demander pour la compléter.',
    '6. language : « vf », « vostfr » ou « indifferent » selon ce que la page montre.',
    '7. Réponds d’abord par le JSON seul, dans un bloc ```json, sans commentaires à l’intérieur.',
    '',
    'Résumé de la structure de la page :',
    ...lignesResume(resume),
    '',
    'Extrait HTML de la page (allégé : sans scripts, styles ni commentaires) :',
    '```html',
    extrait,
    '```',
  ].join('\n');
}

// ------------------------------------------------------------------ Validation du JSON renvoyé

export interface ValidationSource {
  source?: DefinitionSource;
  erreurs: string[];
  avertissements: string[];
}

/** Retire un éventuel bloc ```json … ``` et le texte autour. */
function jsonDepuisTexte(texte: string): string {
  const t = String(texte ?? '').trim();
  const bloc = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (bloc) return bloc[1].trim();
  const debut = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  return debut >= 0 && fin > debut ? t.slice(debut, fin + 1) : t;
}

const CHAMPS_SELECTEURS: ReadonlyArray<readonly [string, (s: DefinitionSource) => string]> = [
  ['search.item', s => s.search.item],
  ['search.title', s => s.search.title],
  ['search.link', s => s.search.link],
  ['search.image', s => s.search.image],
  ['episodes.item', s => s.episodes.item],
  ['episodes.number', s => s.episodes.number],
  ['episodes.title', s => s.episodes.title],
  ['episodes.link', s => s.episodes.link],
  ['player.iframe', s => s.player.iframe],
  ['player.options', s => s.player.options],
  ['player.optionLabel', s => s.player.optionLabel],
  ['movies.search.item', s => s.movies.search.item],
  ['movies.search.title', s => s.movies.search.title],
  ['movies.search.link', s => s.movies.search.link],
  ['movies.search.image', s => s.movies.search.image],
  ['movies.search.year', s => s.movies.search.year],
  ['movies.player.iframe', s => s.movies.player.iframe],
  ['movies.player.options', s => s.movies.player.options],
];

/**
 * Valide le JSON collé par l'administrateur : forme, schéma du moteur
 * (`normaliserSource` : adresse publique…), sélecteurs CSS compilables,
 * `{query}` dans les chemins, au moins une partie utilisable. `analysee` :
 * adresse de la page analysée (un autre site n'est qu'un avertissement).
 */
export function validerSourceJson(texte: string, analysee?: string, options: OptionsNormalisation = {}): ValidationSource {
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  let brut: unknown;
  try {
    brut = JSON.parse(jsonDepuisTexte(texte));
  } catch {
    return { erreurs: ['Ce n’est pas un JSON valide : collez l’objet renvoyé par l’IA (le bloc ```json suffit).'], avertissements };
  }
  if (Array.isArray(brut)) brut = brut[0];
  const liste = (brut as { sources?: unknown } | null)?.sources;
  if (Array.isArray(liste)) brut = liste[0];
  if (!brut || typeof brut !== 'object') {
    return { erreurs: ['Le JSON doit être un objet décrivant UNE source.'], avertissements };
  }
  let source: DefinitionSource;
  try {
    // L'identifiant et la date sont ceux de l'app, jamais ceux du JSON collé.
    const { id: _id, createdAt: _date, enabled: _actif, ...reste } = brut as Record<string, unknown>;
    source = normaliserSource({ ...reste, enabled: true }, null, options);
  } catch (e) {
    return { erreurs: [messageDe(e)], avertissements };
  }
  const page = lirePage('<p></p>');
  for (const [nom, lire] of CHAMPS_SELECTEURS) {
    const sel = lire(source);
    if (!sel || sel === '&') continue;
    try {
      page.tous(sel);
    } catch {
      erreurs.push(`Sélecteur CSS invalide pour ${nom} : « ${sel} ».`);
    }
  }
  for (const [nom, chemin] of [
    ['search.path', source.search.path],
    ['search.pathVf', source.search.pathVf],
    ['search.pathVostfr', source.search.pathVostfr],
    ['movies.search.path', source.movies.search.path],
  ] as const) {
    if (chemin && !chemin.includes('{query}')) erreurs.push(`${nom} doit contenir {query} (le titre recherché).`);
  }
  const animes = supporteAnimes(source);
  const films = supporteFilms(source);
  if (!animes && !films) erreurs.push('Aucune partie utilisable : il faut au moins search.path + search.item (animés) ou movies.search.path + movies.search.item (films).');
  if (animes && !source.episodes.item) avertissements.push('Animés : pas de sélecteur d’épisode (episodes.item) ; la liste des épisodes sera vide.');
  if (animes && !source.player.iframe && !source.player.options) avertissements.push('Animés : pas de lecteur (player.iframe ou player.options).');
  if (films && !source.movies.player.iframe && !source.movies.player.options) avertissements.push('Films : pas de lecteur (movies.player.iframe ou movies.player.options).');
  if (analysee) {
    try {
      if (new URL(analysee).hostname !== new URL(source.baseUrl).hostname) avertissements.push(`L’adresse de la source (${source.baseUrl}) n’est pas celle de la page analysée.`);
    } catch {
      // Adresse analysée illisible : rien à comparer.
    }
  }
  return erreurs.length ? { erreurs, avertissements } : { source, erreurs, avertissements };
}

/** Rappel affiché dans l'assistant. */
export const RAPPEL_DROITS = 'N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.';
