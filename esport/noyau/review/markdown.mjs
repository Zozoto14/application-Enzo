/**
 * Notes de review : Markdown LIMITÉ, nettoyé côté serveur.
 *
 * Sous-ensemble accepté (rendu par l'app avec ses propres composants, jamais
 * en HTML brut) : paragraphes, **gras**, *italique*, `code`, listes à puces
 * (- ou *) et numérotées (1.), titres (# à ###), liens [texte](https://…).
 *
 * `nettoyerNote` est la défense côté serveur (et rend l'export Markdown sûr
 * dans n'importe quel lecteur) :
 *  - caractères de contrôle et de direction retirés ;
 *  - tout HTML neutralisé : `<` et `>` deviennent `&lt;` et `&gt;` (un lecteur
 *    Markdown les affiche tels quels, sans jamais créer de balise) ;
 *  - images retirées (`![x](…)` → `x`), définitions de liens retirées ;
 *  - liens : seulement http(s) ; sinon le texte seul reste (`javascript:`, `data:`…).
 * L'opération est idempotente.
 */

export const NOTE_MAX = 4000;

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
  // Images : on garde le texte alternatif.
  t = t.replace(/!\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1');
  // Définitions de liens ([id]: url) : retirées.
  t = t.replace(/^[ \t]*\[[^\]\n]+\]:[^\n]*$/gm, '');
  // Liens [texte](cible) : cible http(s) seulement.
  t = t.replace(/\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g, (m, texte, cible) => (lienSur(cible) ? `[${texte}](${cible.trim()})` : texte));
  // HTML : jamais de balise.
  t = t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
