/**
 * The Finals : proposition automatique des maps depuis le wiki communautaire THE FINALS Wiki (wiki.gg,
 * MediaWiki), https://www.thefinals.wiki/w/api.php. Rien n'est appliqué ici : ce module LIT le wiki et rend des
 * propositions (cartesProposees.mjs les range « À valider » ; le Fondateur valide).
 *
 * Ce que l'API donne (vérifié sur le wiki réel) :
 *  - `meta=siteinfo&siprop=general|rightsinfo` : nom du site et licence des contenus (attribution enregistrée) ;
 *  - `generator=categorymembers&gcmtitle=Category:Arenas` + `prop=revisions` : les arènes et leur wikitexte :
 *    image de l'infobox (`{{Infobox Arena|image=…}}`, illustration) et, dans la section « Overview », une vue
 *    de dessus (`{{Infographic|Image=…}}`, ex. « MonacoOverview Hi-Res.jpg ») ;
 *  - `Template:ArenaVariantData` : la base des variantes (`{{Arenas|Arena=|Variant=|Gamemodes=}}`) : variantes
 *    et modes jouables par arène. « Ranked Cashout » → pool compétitif suggéré ; une arène sans aucun mode
 *    Cashout (ancienne Las Vegas, Practice Range, arènes d'événement) n'est pas proposée ;
 *  - `prop=imageinfo&iiprop=url|size|mime` : adresse, taille et type de chaque image.
 * Le wiki ne donne ni dimensions des arènes ni coordonnées de repères : échelle approximative par défaut
 * (« à vérifier », calibrage à deux points) et aucun repère pré-placé.
 *
 * Réseau : uniquement www.thefinals.wiki, par le téléchargeur borné (https, sans redirection, taille et type).
 */

import { echec } from '../outils.mjs';
import { cleDe } from './schema.mjs';
import { TAILLE_MAX_IMAGE_IMPORT, TAILLE_MAX_JSON_IMPORT, echelleApproxTheFinals, telechargerBorne } from './import.mjs';

export const HOTE_WIKI_THEFINALS = 'www.thefinals.wiki';
export const HOTES_WIKI_THEFINALS = [HOTE_WIKI_THEFINALS];
export const API_WIKI_THEFINALS = `https://${HOTE_WIKI_THEFINALS}/w/api.php`;
export const CATEGORIE_ARENES = 'Category:Arenas';
export const DONNEES_VARIANTES = 'Template:ArenaVariantData';
const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const LONGUEUR_MAX_URL = 480;
/** Fichiers à ne jamais prendre pour une vue de dessus (mascottes, icônes, images provisoires). */
const IMAGE_PROVISOIRE = /namatama|nama-?404|placeholder|(^|[_ -])icon([_ .-]|$)/i;
const NOM_VUE_DESSUS = /overview|minimap|mini-map|top[-_ ]?down|layout/i;

/** Adresse d'un appel à l'API du wiki (paramètres triés : adresses stables, enregistrables en test). */
export function urlApiWiki(params) {
  const p = new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
  p.sort();
  return `${API_WIKI_THEFINALS}?${p}`;
}

async function lireJsonWiki(fetchImport, params) {
  const { octets } = await telechargerBorne(fetchImport, urlApiWiki(params), { hotes: HOTES_WIKI_THEFINALS, max: TAILLE_MAX_JSON_IMPORT, types: ['application/json'] });
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(octets));
  } catch {
    throw echec(502, 'import-json', 'Réponse du wiki The Finals illisible.');
  }
  if (json?.error) throw echec(502, 'import-wiki', 'Le wiki The Finals a refusé la requête.');
  return json;
}

const pagesDe = json => (Array.isArray(json?.query?.pages) ? json.query.pages : Object.values(json?.query?.pages ?? {}));
const contenuDe = p => p?.revisions?.[0]?.slots?.main?.content ?? p?.revisions?.[0]?.content ?? '';
const nomFichier = v => String(v ?? '').replace(/^\s*(file|fichier|image):/i, '').replace(/_/g, ' ').trim();

/** Paramètre `nom=` d'un appel de modèle (texte brut) ; null s'il n'y est pas. */
function parametre(bloc, nom) {
  const m = new RegExp(`\\|\\s*${nom}\\s*=\\s*([^|}\\n]*)`, 'i').exec(bloc);
  return m ? m[1].trim() : null;
}

/** Blocs `{{Nom … }}` d'un wikitexte (sans modèles imbriqués dans les paramètres utiles). */
function blocs(texte, nom) {
  const sortie = [];
  const re = new RegExp(`\\{\\{\\s*${nom}\\s*[|\\n]`, 'gi');
  let m;
  while ((m = re.exec(texte))) {
    let profondeur = 0;
    let i = m.index;
    for (; i < texte.length - 1; i++) {
      if (texte[i] === '{' && texte[i + 1] === '{') (profondeur++, i++);
      else if (texte[i] === '}' && texte[i + 1] === '}') {
        profondeur--;
        i++;
        if (profondeur === 0) break;
      }
    }
    sortie.push(texte.slice(m.index, i + 1));
  }
  return sortie;
}

/** Wikitexte d'une arène → image de l'infobox et vues de dessus candidates (dans l'ordre de préférence). */
export function imagesArene(wikitexte) {
  const t = String(wikitexte ?? '');
  const infobox = blocs(t, 'Infobox Arena')[0];
  const illustration = infobox ? nomFichier(parametre(infobox, 'image')) : '';
  const candidats = [];
  const ajouter = n => {
    const f = nomFichier(n);
    if (f && !IMAGE_PROVISOIRE.test(f) && f !== illustration && !candidats.includes(f) && /\.(png|jpe?g|webp)$/i.test(f)) candidats.push(f);
  };
  for (const b of blocs(t, 'Infographic')) ajouter(parametre(b, 'image'));
  for (const m of t.matchAll(/(?:\[\[\s*(?:File|Image):|^\s*(?:File|Image):|\|\s*image\s*=\s*)([^|\]\n}]+)/gim)) if (NOM_VUE_DESSUS.test(m[1])) ajouter(m[1]);
  return { illustration: illustration && !IMAGE_PROVISOIRE.test(illustration) ? illustration : '', vuesDessus: candidats };
}

/** `Template:ArenaVariantData` → `{ [arène]: { variantes: [...], modes: [...] } }`. */
export function variantesArenes(wikitexte) {
  const sortie = {};
  for (const b of blocs(String(wikitexte ?? ''), 'Arenas')) {
    const arene = parametre(b, 'Arena');
    if (!arene) continue;
    const e = (sortie[arene] ??= { variantes: [], modes: [] });
    const v = parametre(b, 'Variant');
    if (v && !e.variantes.includes(v)) e.variantes.push(v);
    for (const mode of String(parametre(b, 'Gamemodes') ?? '').split(',').map(x => x.trim()).filter(Boolean)) if (!e.modes.includes(mode)) e.modes.push(mode);
  }
  return sortie;
}

/** Lots de titres de fichiers dont l'adresse d'appel reste sous la longueur permise. */
function lotsDeTitres(titres, base) {
  const lots = [];
  let lot = [];
  for (const t of titres) {
    const essai = [...lot, t];
    if (lot.length && (urlApiWiki({ ...base, titles: essai.join('|') }).length > LONGUEUR_MAX_URL || essai.length > 20)) {
      lots.push(lot);
      lot = [t];
    } else lot = essai;
  }
  if (lot.length) lots.push(lot);
  return lots;
}

/** Infos des fichiers (adresse, taille, type) : `{ [nom]: { url, largeur, hauteur, taille, type } }`. */
async function infosImages(fetchImport, noms) {
  const base = { action: 'query', prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '2048' };
  const sortie = {};
  for (const lot of lotsDeTitres(noms.map(n => `File:${n}`), base)) {
    const json = await lireJsonWiki(fetchImport, { ...base, titles: lot.join('|') });
    // Titres normalisés par le wiki (« File:A_b.png » → « File:A b.png ») : rattachés au nom demandé.
    const normalise = new Map((json?.query?.normalized ?? []).map(n => [n.to, n.from]));
    for (const p of pagesDe(json)) {
      const ii = p?.imageinfo?.[0];
      if (!ii || p.missing) continue;
      const nom = nomFichier(normalise.get(p.title) ?? p.title);
      const grand = !(Number(ii.size) <= TAILLE_MAX_IMAGE_IMPORT) || Number(ii.width) > 8192 || Number(ii.height) > 8192;
      const url = grand ? ii.thumburl : ii.url;
      const type = grand ? ii.thumbmime || 'image/webp' : ii.mime;
      if (typeof url !== 'string' || !TYPES_IMAGE.includes(type)) continue;
      sortie[nom] = { url, largeur: Number(grand ? ii.thumbwidth : ii.width) || null, hauteur: Number(grand ? ii.thumbheight : ii.height) || null, type };
    }
  }
  return sortie;
}

/** Texte d'attribution enregistré avec chaque image (licence lue sur le wiki). */
export function attributionWiki({ site, licence, page }) {
  return `Source : ${site} (wiki.gg), page « ${page} » ; textes sous licence ${licence.texte}${licence.url ? ` (${licence.url})` : ''}. Image : œuvre du jeu (Embark Studios) reproduite par le wiki.`.slice(0, 400);
}

/**
 * Lit le wiki et rend `{ licence, site, arenes: [proposition] }`. Une proposition : `{ cle, nom, page, image:
 * { url, fichier, vueDessus, largeur, hauteur } | null, variantes, modes, competitive, echelle, reperes: [] }`.
 */
export async function arenesDuWiki(fetchImport) {
  const info = await lireJsonWiki(fetchImport, { action: 'query', meta: 'siteinfo', siprop: 'general|rightsinfo' });
  const site = String(info?.query?.general?.sitename ?? 'THE FINALS Wiki').slice(0, 60);
  const licence = { texte: String(info?.query?.rightsinfo?.text || 'voir le wiki').slice(0, 120), url: /^https:\/\//.test(info?.query?.rightsinfo?.url ?? '') ? String(info.query.rightsinfo.url).replace(/^http:/, 'https:') : null };
  const pagesJson = await lireJsonWiki(fetchImport, { action: 'query', generator: 'categorymembers', gcmtitle: CATEGORIE_ARENES, gcmnamespace: '0', gcmlimit: '50', prop: 'revisions', rvprop: 'content', rvslots: 'main' });
  const pages = pagesDe(pagesJson).filter(p => p && typeof p.title === 'string' && !p.missing);
  if (pages.length === 0) throw echec(502, 'import-vide', 'Le wiki The Finals ne liste aucune arène.');
  const variantesJson = await lireJsonWiki(fetchImport, { action: 'query', prop: 'revisions', titles: DONNEES_VARIANTES, rvprop: 'content', rvslots: 'main' });
  const variantes = variantesArenes(contenuDe(pagesDe(variantesJson)[0]));
  const avecDonnees = Object.keys(variantes).length > 0;
  const retenues = pages
    .map(p => ({ titre: p.title, images: imagesArene(contenuDe(p)), ...(variantes[p.title] ?? { variantes: [], modes: [] }) }))
    // Arènes de Cashout (modes du jeu que l'éditeur de strats connaît) ; sans base de variantes : toutes sauf l'entraînement.
    .filter(a => (avecDonnees ? a.modes.some(m => /cashout/i.test(m)) : !/practice|range/i.test(a.titre)))
    .sort((a, b) => a.titre.localeCompare(b.titre));
  const noms = [...new Set(retenues.flatMap(a => [...a.images.vuesDessus, a.images.illustration].filter(Boolean)))];
  const fichiers = noms.length ? await infosImages(fetchImport, noms) : {};
  return {
    site,
    licence,
    arenes: retenues.map(a => {
      const vue = a.images.vuesDessus.find(n => fichiers[n]);
      const nomImage = vue ?? (fichiers[a.images.illustration] ? a.images.illustration : null);
      const f = nomImage ? fichiers[nomImage] : null;
      const page = `https://${HOTE_WIKI_THEFINALS}/wiki/${encodeURIComponent(a.titre.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
      return {
        cle: cleDe(a.titre),
        nom: a.titre,
        page,
        image: f ? { url: f.url, fichier: nomImage, vueDessus: Boolean(vue), largeur: f.largeur, hauteur: f.hauteur } : null,
        variantes: a.variantes.slice(0, 12),
        modes: a.modes.slice(0, 20),
        competitive: a.modes.some(m => /^ranked|world tour/i.test(m)),
        echelle: echelleApproxTheFinals(),
        reperes: [],
        attribution: attributionWiki({ site, licence, page: a.titre }),
      };
    }),
  };
}
