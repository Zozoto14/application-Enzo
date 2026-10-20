/**
 * Notes de review : Markdown LIMITÉ, nettoyé côté serveur.
 *
 * Sous-ensemble accepté (rendu par l'app avec ses propres composants, jamais
 * en HTML brut) : paragraphes, **gras**, *italique*, ~~barré~~, ==surlignage==,
 * {{couleur|texte}} (couleurs prédéfinies seulement, COULEURS), @mentions,
 * `code` et blocs de code (```), citations (>), séparateur (---), listes à
 * puces (- ou *), numérotées (1.) et cases (- [ ] / - [x]), titres (# à ###),
 * liens [texte](https://…).
 *
 * `nettoyerNote` est la défense côté serveur (et rend l'export Markdown sûr
 * dans n'importe quel lecteur) :
 *  - caractères de contrôle et de direction retirés ;
 *  - tout HTML neutralisé : `<` et `>` deviennent `&lt;` et `&gt;` (un lecteur
 *    Markdown les affiche tels quels, sans jamais créer de balise) ;
 *  - images retirées (`![x](…)` → `x`), définitions de liens retirées ;
 *  - liens : seulement http(s) ; sinon le texte seul reste (`javascript:`, `data:`…) ;
 *  - {{couleur|texte}} : couleur hors liste = le texte seul ;
 *  - blocs de code : le contenu n'est touché que par la neutralisation du HTML ;
 *  - le `>` d'une citation en début de ligne reste tel quel (Markdown valide,
 *    sans danger : le reste de la ligne est neutralisé).
 * L'opération est idempotente.
 */

export const NOTE_MAX = 8000;

/** Couleurs de texte autorisées ({{nom|texte}}) : même liste que src/esport/review/markdown.ts. */
export const COULEURS = ['rouge', 'orange', 'jaune', 'vert', 'bleu', 'violet', 'rose', 'gris'];

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩​-‏﻿]/g;

/** Cible d'un lien Markdown sûre (http ou https, sans espace) ? */
export function lienSur(cible) {
  return /^https?:\/\/[^\s<>"'`\\]{1,2000}$/i.test(String(cible ?? '').trim());
}

export function nettoyerNote(valeur, max = NOTE_MAX) {
  let t = String(valeur ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROLES, '');
  // Entités numériques ou nommées qui reconstruiraient une balise : décodées d'abord, neutralisées ensuite.
  t = t.replace(/&#(x[0-9a-f]+|\d+);?/gi, (m, n) => {
    const code = n[0] === 'x' || n[0] === 'X' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return code === 60 ? '<' : code === 62 ? '>' : code === 38 ? '&' : code === 34 ? '"' : code === 39 ? "'" : m.replace('&', '&amp;');
  });
  // Blocs de code (```) : le contenu n'est que neutralisé ; le reste est nettoyé ligne de texte par segment.
  const segments = [];
  let courant = [];
  let dansCode = false;
  for (const ligne of t.split('\n')) {
    if (/^\s{0,3}```/.test(ligne) && (!dansCode || /^\s{0,3}```\s*$/.test(ligne))) {
      if (!dansCode) {
        if (courant.length) segments.push({ code: false, lignes: courant });
        courant = [];
      }
      courant.push(ligne);
      if (dansCode) {
        segments.push({ code: true, lignes: courant });
        courant = [];
      }
      dansCode = !dansCode;
    } else courant.push(ligne);
  }
  if (courant.length) segments.push({ code: dansCode, lignes: courant });
  t = segments
    .map(seg => {
      if (seg.code) return seg.lignes.map(l => l.replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n');
      let x = seg.lignes.join('\n');
      // Images : on garde le texte alternatif.
      x = x.replace(/!\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1');
      // Définitions de liens ([id]: url) : retirées.
      x = x.replace(/^[ \t]*\[[^\]\n]+\]:[^\n]*$/gm, '');
      // Liens [texte](cible) : cible http(s) seulement.
      x = x.replace(/\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g, (m, texte, cible) => (lienSur(cible) ? `[${texte}](${cible.trim()})` : texte));
      // Couleurs {{nom|texte}} : seulement les couleurs prédéfinies (sinon le texte seul), sans accolade imbriquée.
      for (let i = 0; i < 3; i++) x = x.replace(/\{\{([^{}|\n]{0,60})\|([^{}\n]*)\}\}/g, (m, nom, texte) => (COULEURS.includes(nom) ? `{{${nom}|${texte}}}` : texte));
      // HTML : jamais de balise. Le « > » de citation en début de ligne est gardé (Markdown valide).
      return x
        .split('\n')
        .map(l => {
          const c = /^(\s{0,3}>[ \t]?)(.*)$/.exec(l);
          const echapper = v => v.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return c ? c[1] + echapper(c[2]) : echapper(l);
        })
        .join('\n');
    })
    .join('\n');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** Texte brut d'une ligne (titre, pseudo) pour l'export : sans retour à la ligne ni balise. */
export function ligneSure(valeur, max = 200) {
  return String(valeur ?? '')
    .replace(CONTROLES, ' ')
    .replace(/\s+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()
    .slice(0, max);
}
