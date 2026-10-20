/**
 * Notes : Markdown LIMITÉ, rendu SANS HTML brut.
 *
 * Sous-ensemble : paragraphes, **gras**, *italique*, ~~barré~~, ==surlignage==,
 * {{couleur|texte}} (huit couleurs prédéfinies, voir COULEURS), `code`, @mention,
 * blocs de code (```), citations (>), séparateur (---), listes à puces (- ou *),
 * numérotées (1.) et cases (- [ ] / - [x]) avec retraits, titres (# à ###),
 * liens [texte](https://…). Les images et le HTML n'existent pas.
 * `analyserMarkdown` produit un arbre que l'app transforme en composants
 * (React échappe tout texte : aucun `innerHTML`) ; `versHtml` produit le
 * HTML de l'impression PDF, avec échappement systématique. Le serveur
 * nettoie déjà les notes (esport/noyau/review/markdown.mjs) ; ce rendu reste
 * sûr devant un texte non nettoyé (couleur inconnue = texte seul, lien non
 * http(s) = texte seul).
 */

/** Couleurs de texte autorisées : la syntaxe maison {{nom|texte}} n'accepte que celles-ci (liste identique côté serveur). */
export const COULEURS = ['rouge', 'orange', 'jaune', 'vert', 'bleu', 'violet', 'rose', 'gris'] as const;
export type Couleur = (typeof COULEURS)[number];
export const estCouleur = (v: string): v is Couleur => (COULEURS as readonly string[]).includes(v);

export type Inline =
  | { t: 'texte'; v: string }
  | { t: 'gras'; v: Inline[] }
  | { t: 'italique'; v: Inline[] }
  | { t: 'barre'; v: Inline[] }
  | { t: 'surligne'; v: Inline[] }
  | { t: 'couleur'; c: Couleur; v: Inline[] }
  | { t: 'mention'; v: string }
  | { t: 'code'; v: string }
  | { t: 'lien'; v: Inline[]; href: string };

/** Élément de liste : niveau de retrait (0 à 3), numéro d'ordre dans son niveau, case (null = pas une case), ligne d'origine. */
export interface ItemListe {
  v: Inline[];
  niveau: number;
  ordonnee: boolean;
  numero: number;
  coche: boolean | null;
  ligne: number;
}

export type Bloc =
  | { t: 'paragraphe'; v: Inline[] }
  | { t: 'titre'; niveau: 1 | 2 | 3; v: Inline[] }
  | { t: 'liste'; ordonnee: boolean; v: Inline[][]; items: ItemListe[] }
  | { t: 'citation'; v: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'separateur' };

/** Cible d'un lien sûre : http(s) seulement, sans espace ni guillemet. */
export const lienSur = (cible: string): boolean => /^https?:\/\/[^\s<>"'`\\]{1,2000}$/i.test(cible.trim());

/** `&lt;` `&gt;` `&amp;` posés par le nettoyage serveur redeviennent des caractères (affichés, jamais interprétés). */
export const decoder = (t: string): string => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const LIEN = /^\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/;

export function analyserInline(texte: string, profondeur = 0): Inline[] {
  const sortie: Inline[] = [];
  let tampon = '';
  const vider = () => {
    if (tampon) sortie.push({ t: 'texte', v: decoder(tampon) });
    tampon = '';
  };
  let i = 0;
  while (i < texte.length) {
    const reste = texte.slice(i);
    let m: RegExpExecArray | null;
    if (profondeur < 3 && (m = /^\*\*([^\n]+?)\*\*/.exec(reste))) {
      vider();
      sortie.push({ t: 'gras', v: analyserInline(m[1], profondeur + 1) });
      i += m[0].length;
    } else if (profondeur < 3 && (m = /^~~([^\n]+?)~~/.exec(reste))) {
      vider();
      sortie.push({ t: 'barre', v: analyserInline(m[1], profondeur + 1) });
      i += m[0].length;
    } else if (profondeur < 3 && (m = /^==([^\n=][^\n]*?)==/.exec(reste))) {
      vider();
      sortie.push({ t: 'surligne', v: analyserInline(m[1], profondeur + 1) });
      i += m[0].length;
    } else if (profondeur < 3 && (m = /^\{\{([a-z]{1,10})\|([^\n]+?)\}\}/.exec(reste))) {
      vider();
      const dedans = analyserInline(m[2], profondeur + 1);
      if (estCouleur(m[1])) sortie.push({ t: 'couleur', c: m[1], v: dedans });
      else sortie.push(...dedans); // couleur inconnue : le texte seul
      i += m[0].length;
    } else if ((m = /^@[A-Za-z0-9À-ÿ_.-]{1,32}/.exec(reste)) && (i === 0 || /[\s(,;:!?]/.test(texte[i - 1]))) {
      vider();
      const mot = m[0].replace(/[.-]+$/, '');
      sortie.push({ t: 'mention', v: mot });
      i += mot.length;
    } else if (profondeur < 3 && (m = /^\*([^*\n]+?)\*/.exec(reste))) {
      vider();
      sortie.push({ t: 'italique', v: analyserInline(m[1], profondeur + 1) });
      i += m[0].length;
    } else if ((m = /^`([^`\n]+)`/.exec(reste))) {
      vider();
      sortie.push({ t: 'code', v: decoder(m[1]) });
      i += m[0].length;
    } else if ((m = LIEN.exec(reste))) {
      vider();
      const cible = m[2].trim();
      if (lienSur(cible)) sortie.push({ t: 'lien', v: analyserInline(m[1], profondeur + 1), href: cible });
      else sortie.push(...analyserInline(m[1], profondeur + 1)); // cible refusée : le texte seul
      i += m[0].length;
    } else {
      tampon += texte[i];
      i += 1;
    }
  }
  vider();
  return sortie;
}

const PUCE = /^(\s{0,8})([-*]|\d{1,3}[.)])\s+(.*)$/;
const CASE = /^\[([ xX])\]\s+(.*)$/;
const CITATION = /^\s{0,3}(?:>|&gt;)\s?(.*)$/;
const NIVEAU_MAX = 3;

export function analyserMarkdown(source: string): Bloc[] {
  const lignes = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocs: Bloc[] = [];
  let para: string[] = [];
  let cite: string[] = [];
  let liste: { ordonnee: boolean; items: { texte: string; niveau: number; ordonnee: boolean; coche: boolean | null; ligne: number }[] } | undefined;
  const fermerPara = () => {
    if (para.length) blocs.push({ t: 'paragraphe', v: analyserInline(para.join('\n')) });
    para = [];
  };
  const fermerCitation = () => {
    if (cite.length) blocs.push({ t: 'citation', v: analyserInline(cite.join('\n')) });
    cite = [];
  };
  const fermerListe = () => {
    if (liste) {
      const compteurs: number[] = [];
      const items: ItemListe[] = liste.items.map(it => {
        compteurs.length = it.niveau + 1;
        compteurs[it.niveau] = (compteurs[it.niveau] ?? 0) + 1;
        return { v: analyserInline(it.texte), niveau: it.niveau, ordonnee: it.ordonnee, numero: compteurs[it.niveau], coche: it.coche, ligne: it.ligne };
      });
      blocs.push({ t: 'liste', ordonnee: liste.ordonnee, v: items.map(x => x.v), items });
    }
    liste = undefined;
  };
  const fermerTout = () => {
    fermerPara();
    fermerCitation();
    fermerListe();
  };
  let code: string[] | undefined;
  for (let n = 0; n < lignes.length; n++) {
    const ligne = lignes[n];
    let m: RegExpExecArray | null;
    if (code) {
      if (/^\s{0,3}```\s*$/.test(ligne)) {
        blocs.push({ t: 'code', v: decoder(code.join('\n')) });
        code = undefined;
      } else code.push(ligne);
    } else if (/^\s{0,3}```/.test(ligne)) {
      fermerTout();
      code = [];
    } else if (ligne.trim() === '') {
      fermerTout();
    } else if ((m = /^\s{0,3}(#{1,3})\s+(.+)$/.exec(ligne))) {
      fermerTout();
      blocs.push({ t: 'titre', niveau: m[1].length as 1 | 2 | 3, v: analyserInline(m[2].trim()) });
    } else if (/^\s{0,3}-{3,}\s*$/.test(ligne)) {
      fermerTout();
      blocs.push({ t: 'separateur' });
    } else if ((m = CITATION.exec(ligne))) {
      fermerPara();
      fermerListe();
      cite.push(m[1].trim());
    } else if ((m = PUCE.exec(ligne))) {
      fermerPara();
      fermerCitation();
      const ordonnee = /^\d/.test(m[2]);
      const niveau = Math.min(NIVEAU_MAX, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
      if (liste && niveau === 0 && liste.ordonnee !== ordonnee) fermerListe();
      liste ??= { ordonnee, items: [] };
      const c = ordonnee ? null : CASE.exec(m[3]);
      liste.items.push({ texte: c ? c[2] : m[3], niveau, ordonnee, coche: c ? c[1] !== ' ' : null, ligne: n });
    } else {
      fermerCitation();
      fermerListe();
      para.push(ligne.trim());
    }
  }
  if (code) blocs.push({ t: 'code', v: decoder(code.join('\n')) });
  fermerTout();
  return blocs;
}

/** Coche ou décoche la case de la ligne `ligne` (0-based) du texte ; texte inchangé si ce n'est pas une case. */
export function basculerCase(source: string, ligne: number): string {
  const lignes = String(source ?? '').split('\n');
  const l = lignes[ligne];
  if (l === undefined) return source;
  const m = /^(\s*[-*]\s+\[)([ xX])(\]\s)/.exec(l);
  if (!m) return source;
  lignes[ligne] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + l.slice(m[0].length);
  return lignes.join('\n');
}

/** Échappement HTML (texte et attributs). */
export const echapperHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineHtml(liste: Inline[]): string {
  return liste
    .map(x => {
      switch (x.t) {
        case 'texte':
          return echapperHtml(x.v).replace(/\n/g, '<br>');
        case 'gras':
          return `<strong>${inlineHtml(x.v)}</strong>`;
        case 'italique':
          return `<em>${inlineHtml(x.v)}</em>`;
        case 'barre':
          return `<s>${inlineHtml(x.v)}</s>`;
        case 'surligne':
          return `<mark>${inlineHtml(x.v)}</mark>`;
        case 'couleur':
          return `<span class="c-${x.c}">${inlineHtml(x.v)}</span>`;
        case 'mention':
          return `<strong>${echapperHtml(x.v)}</strong>`;
        case 'code':
          return `<code>${echapperHtml(x.v)}</code>`;
        case 'lien':
          return `<a href="${echapperHtml(x.href)}" rel="noopener noreferrer">${inlineHtml(x.v)}</a>`;
      }
    })
    .join('');
}

/** HTML sûr d'un texte Markdown limité (impression PDF). */
export function versHtml(source: string): string {
  return analyserMarkdown(source)
    .map(b => {
      if (b.t === 'paragraphe') return `<p>${inlineHtml(b.v)}</p>`;
      if (b.t === 'titre') return `<h${b.niveau}>${inlineHtml(b.v)}</h${b.niveau}>`;
      if (b.t === 'citation') return `<blockquote>${inlineHtml(b.v)}</blockquote>`;
      if (b.t === 'code') return `<pre><code>${echapperHtml(b.v)}</code></pre>`;
      if (b.t === 'separateur') return '<hr>';
      const balise = b.ordonnee ? 'ol' : 'ul';
      const case_ = (c: boolean | null) => (c === null ? '' : c ? '&#9745; ' : '&#9744; ');
      return `<${balise}>${b.items.map(x => `<li style="margin-left:${x.niveau * 18}px">${case_(x.coche)}${inlineHtml(x.v)}</li>`).join('')}</${balise}>`;
    })
    .join('\n');
}
