/**
 * Notes de review : Markdown LIMITÉ, rendu SANS HTML brut.
 *
 * Sous-ensemble : paragraphes, **gras**, *italique*, `code`, listes à puces
 * (- ou *) et numérotées (1.), titres (# à ###), liens [texte](https://…).
 * `analyserMarkdown` produit un arbre que l'app transforme en composants
 * (React échappe tout texte : aucun `innerHTML`) ; `versHtml` produit le
 * HTML de l'impression PDF, avec échappement systématique. Le serveur
 * nettoie déjà les notes (esport/noyau/review/markdown.mjs) ; ce rendu reste
 * sûr même devant un texte non nettoyé.
 */

export type Inline =
  | { t: 'texte'; v: string }
  | { t: 'gras'; v: Inline[] }
  | { t: 'italique'; v: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'lien'; v: Inline[]; href: string };

export type Bloc =
  | { t: 'paragraphe'; v: Inline[] }
  | { t: 'titre'; niveau: 1 | 2 | 3; v: Inline[] }
  | { t: 'liste'; ordonnee: boolean; v: Inline[][] };

/** Cible d'un lien sûre : http(s) seulement, sans espace ni guillemet. */
export const lienSur = (cible: string): boolean => /^https?:\/\/[^\s<>"'`\\]{1,2000}$/i.test(cible.trim());

/** `&lt;` `&gt;` `&amp;` posés par le nettoyage serveur redeviennent des caractères (affichés, jamais interprétés). */
const decoder = (t: string): string => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

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

export function analyserMarkdown(source: string): Bloc[] {
  const lignes = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocs: Bloc[] = [];
  let para: string[] = [];
  let liste: { ordonnee: boolean; v: string[] } | undefined;
  const fermerPara = () => {
    if (para.length) blocs.push({ t: 'paragraphe', v: analyserInline(para.join('\n')) });
    para = [];
  };
  const fermerListe = () => {
    if (liste) blocs.push({ t: 'liste', ordonnee: liste.ordonnee, v: liste.v.map(x => analyserInline(x)) });
    liste = undefined;
  };
  for (const ligne of lignes) {
    let m: RegExpExecArray | null;
    if (ligne.trim() === '') {
      fermerPara();
      fermerListe();
    } else if ((m = /^\s{0,3}(#{1,3})\s+(.+)$/.exec(ligne))) {
      fermerPara();
      fermerListe();
      blocs.push({ t: 'titre', niveau: m[1].length as 1 | 2 | 3, v: analyserInline(m[2].trim()) });
    } else if ((m = /^\s{0,3}[-*]\s+(.+)$/.exec(ligne))) {
      fermerPara();
      if (liste && liste.ordonnee) fermerListe();
      liste ??= { ordonnee: false, v: [] };
      liste.v.push(m[1]);
    } else if ((m = /^\s{0,3}\d{1,3}[.)]\s+(.+)$/.exec(ligne))) {
      fermerPara();
      if (liste && !liste.ordonnee) fermerListe();
      liste ??= { ordonnee: true, v: [] };
      liste.v.push(m[1]);
    } else {
      fermerListe();
      para.push(ligne.trim());
    }
  }
  fermerPara();
  fermerListe();
  return blocs;
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
      const balise = b.ordonnee ? 'ol' : 'ul';
      return `<${balise}>${b.v.map(x => `<li>${inlineHtml(x)}</li>`).join('')}</${balise}>`;
    })
    .join('\n');
}
