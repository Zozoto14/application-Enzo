/**
 * Recherche d'informations pour l'assistant IA : le SERVEUR lit lui-même quelques pages web (wiki,
 * sites officiels) et en donne le texte au modèle, quand celui-ci ne sait pas naviguer.
 *
 * Protections (en plus de celles de ressources/apercu.mjs, réutilisées) :
 *  - https SEULEMENT (même après une redirection), port 443, aucun identifiant dans l'adresse ;
 *  - hôte public : jamais une IP privée, locale, réservée (IPv4 / IPv6, formes détournées), ni un nom
 *    local ; le téléchargeur du serveur Node (adaptateurs/apercuNode.mjs) vérifie l'adresse IP AU MOMENT
 *    DE LA CONNEXION et se connecte à cette adresse-là (pas de DNS rebinding) ; `resoudre` (facultatif)
 *    revérifie en plus avant chaque saut ;
 *  - redirections suivies À LA MAIN (3 au plus), chacune revérifiée ;
 *  - délai et taille bornés par page, nombre de pages borné, texte extrait borné ;
 *  - aucun cookie, aucun identifiant envoyé ; rien n'est exécuté : le HTML est réduit à du texte brut.
 * Le texte obtenu est une DONNÉE NON FIABLE : il est passé au modèle entre balises, comme matière à lire,
 * jamais comme instructions (voir assistant.mjs), et la sortie du modèle est validée par schéma.
 */

import { echec } from '../outils.mjs';
import { decoderEntites, ipInterdite, verifierAdresse } from '../ressources/apercu.mjs';

export const PAGES_MAX = 4;
export const DELAI_PAGE_MS = 8000;
export const TAILLE_MAX_PAGE = 768 * 1024;
export const CARACTERES_MAX_PAGE = 12_000;
export const REDIRECTIONS_MAX_PAGE = 3;
const TYPES_PAGE = /html|xml|text\/plain|json/i;
const AGENT = 'AppDashboardEsport/1.0 (profils de jeu)';

const refus = () => echec(400, 'ia-adresse', 'Adresse refusée : seules les pages web publiques en https sont lues.');

/** Adresse https publique (barrières de l'aperçu de lien + https obligatoire), ou erreur 400. */
export function verifierAdresseHttps(brut) {
  let url;
  try {
    url = verifierAdresse(brut);
  } catch {
    throw refus();
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) throw refus();
  url.hash = '';
  return url;
}

/** HTML → texte brut lisible (titres et paragraphes sur leur ligne), sans scripts, styles ni balises. */
export function htmlEnTexte(html, max = CARACTERES_MAX_PAGE) {
  const t = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|object|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/table|\/ul|\/ol)\b[^>]*>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]*>/g, ' ');
  return decoderEntites(t)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim()
    .slice(0, max);
}

const titreHtml = html => {
  const m = /<title\b[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(String(html ?? ''));
  return m ? decoderEntites(m[1]).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
};

/**
 * Lit UNE page. Options : `telecharger(url, { delai, max, types, agent })` (OBLIGATOIRE : le serveur Node
 * fournit celui qui épingle l'adresse IP), `resoudre(hote)` facultatif, `delai`, `max`, `caracteres`.
 * Rend `{ url, titre, texte }` ; lève une ErreurEsport sinon.
 */
export async function recupererPage(adresse, { telecharger, resoudre, delai = DELAI_PAGE_MS, max = TAILLE_MAX_PAGE, caracteres = CARACTERES_MAX_PAGE, maintenant = () => Date.now() } = {}) {
  if (typeof telecharger !== 'function') throw echec(503, 'ia-recherche', 'Lecture des pages web indisponible sur ce serveur.');
  let url = verifierAdresseHttps(adresse);
  const fin = maintenant() + delai;
  for (let saut = 0; saut <= REDIRECTIONS_MAX_PAGE; saut++) {
    if (resoudre) {
      let ips;
      try {
        ips = await resoudre(url.hostname.replace(/^\[|\]$/g, ''));
      } catch {
        throw echec(422, 'ia-page', 'Page injoignable.');
      }
      if (!Array.isArray(ips) || ips.length === 0 || ips.some(ip => ipInterdite(ip))) throw refus();
    }
    const reste = fin - maintenant();
    if (reste <= 0) throw echec(504, 'ia-page-delai', 'La page met trop de temps à répondre.');
    let r;
    try {
      r = await telecharger(url.href, { delai: reste, max, types: TYPES_PAGE, agent: AGENT });
    } catch (e) {
      if (e?.code === 'apercu-adresse') throw refus();
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw echec(504, 'ia-page-delai', 'La page met trop de temps à répondre.');
      throw echec(422, 'ia-page', 'Page injoignable.');
    }
    if (r.statut >= 300 && r.statut < 400 && r.location) {
      let suivante;
      try {
        suivante = new URL(r.location, url);
      } catch {
        throw refus();
      }
      url = verifierAdresseHttps(suivante.href);
      continue;
    }
    if (r.statut < 200 || r.statut >= 300 || !TYPES_PAGE.test(r.type ?? '') || !r.corps) throw echec(422, 'ia-page', 'Page injoignable.');
    const html = /html|xml/i.test(r.type ?? '');
    return { url: url.href, titre: html ? titreHtml(r.corps) : '', texte: html ? htmlEnTexte(r.corps, caracteres) : String(r.corps).slice(0, caracteres) };
  }
  throw echec(422, 'ia-page', 'Page injoignable.');
}

/** Lit plusieurs pages (au plus `pagesMax`, une à la fois) ; rend `{ pages, echecs }` sans jamais lever. */
export async function recupererPages(adresses, options = {}) {
  const pagesMax = options.pagesMax ?? PAGES_MAX;
  const pages = [];
  const echecs = [];
  const vues = new Set();
  for (const a of adresses) {
    if (pages.length + echecs.length >= pagesMax * 2 || pages.length >= pagesMax) break;
    const brut = typeof a === 'string' ? a : a?.url;
    if (!brut || vues.has(brut)) continue;
    vues.add(brut);
    try {
      const p = await recupererPage(brut, options);
      if (p.texte) pages.push(p);
      else echecs.push({ url: String(brut).slice(0, 300), raison: 'vide' });
    } catch (e) {
      echecs.push({ url: String(brut).slice(0, 300), raison: e?.code ?? 'ia-page' });
    }
  }
  return { pages, echecs };
}
