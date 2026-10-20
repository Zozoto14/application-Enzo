/**
 * Mise en forme d'un texte en Markdown limité depuis une barre d'outils ou un
 * raccourci (Ctrl/Cmd+B, Ctrl/Cmd+I). Fonctions PURES : texte et sélection en
 * entrée, texte et nouvelle sélection en sortie (testées).
 *
 *  - gras : entoure la sélection de `**…**` (ou les retire si elle l'est déjà) ;
 *  - italique : `*…*` ;
 *  - liste : préfixe `- ` chaque ligne touchée (ou le retire) ;
 *  - lien : `[texte](https://)`, l'adresse sélectionnée pour être tapée.
 * Sans sélection, un texte d'exemple est inséré puis sélectionné.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface Edition {
  texte: string;
  selection: Selection;
}

export type Format = 'gras' | 'italique' | 'liste' | 'lien';

const MARQUES = { gras: '**', italique: '*' } as const;
const EXEMPLES = { gras: 'texte en gras', italique: 'texte en italique' } as const;

const borner = (texte: string, s: Selection): Selection => {
  const a = Math.max(0, Math.min(texte.length, Math.min(s.start, s.end)));
  const b = Math.max(0, Math.min(texte.length, Math.max(s.start, s.end)));
  return { start: a, end: b };
};

/** Entoure (ou désentoure) la sélection d'une marque (`**` gras, `*` italique). */
export function entourer(texte: string, sel: Selection, format: 'gras' | 'italique'): Edition {
  const m = MARQUES[format];
  let { start, end } = borner(texte, sel);
  // Espaces en bord de sélection laissés dehors (« **mot** », pas « **mot **»).
  while (start < end && /\s/.test(texte[start])) start++;
  while (end > start && /\s/.test(texte[end - 1])) end--;
  const choisi = texte.slice(start, end);
  const avant = texte.slice(0, start);
  const apres = texte.slice(end);
  const n = m.length;
  // Déjà entouré (marques à l'extérieur de la sélection) : on retire. Pour l'italique, on ne confond pas avec du gras.
  const autour = (x: string) => avant.endsWith(x) && apres.startsWith(x);
  const exterieur = autour(m) && (format === 'gras' || !autour('**') || autour('***'));
  if (choisi && exterieur) {
    return { texte: avant.slice(0, -n) + choisi + apres.slice(n), selection: { start: start - n, end: end - n } };
  }
  // Marques à l'intérieur de la sélection (« **mot** » sélectionné en entier) : on retire.
  const dans = (x: string) => choisi.length > 2 * x.length && choisi.startsWith(x) && choisi.endsWith(x);
  if (dans(m) && (format === 'gras' || !dans('**') || dans('***'))) {
    const dedans = choisi.slice(n, -n);
    return { texte: avant + dedans + apres, selection: { start, end: start + dedans.length } };
  }
  const contenu = choisi || EXEMPLES[format];
  return { texte: `${avant}${m}${contenu}${m}${apres}`, selection: { start: start + n, end: start + n + contenu.length } };
}

/** Ajoute (ou retire, si toutes l'ont déjà) la puce `- ` aux lignes touchées par la sélection. */
export function basculerListe(texte: string, sel: Selection): Edition {
  const { start, end } = borner(texte, sel);
  const debut = texte.lastIndexOf('\n', start - 1) + 1;
  const finLigne = texte.indexOf('\n', end);
  const fin = finLigne === -1 ? texte.length : finLigne;
  const lignes = texte.slice(debut, fin).split('\n');
  const puce = /^\s{0,3}[-*]\s+/;
  const toutes = lignes.every(l => puce.test(l) || l.trim() === '');
  const nouvelles = toutes ? lignes.map(l => l.replace(puce, '')) : lignes.map(l => (l.trim() === '' && lignes.length > 1 ? l : puce.test(l) ? l : `- ${l}`));
  const bloc = nouvelles.join('\n');
  const resultat = texte.slice(0, debut) + bloc + texte.slice(fin);
  if (start === end && !toutes) {
    const decalage = bloc.length - (fin - debut);
    return { texte: resultat, selection: { start: start + decalage, end: start + decalage } };
  }
  return { texte: resultat, selection: { start: debut, end: debut + bloc.length } };
}

/** Lien : `[sélection](https://)`, l'adresse sélectionnée pour être remplacée. */
export function insererLien(texte: string, sel: Selection): Edition {
  const { start, end } = borner(texte, sel);
  const libelle = texte.slice(start, end).replace(/[[\]\n]/g, ' ').trim() || 'lien';
  const adresse = 'https://';
  const morceau = `[${libelle}](${adresse})`;
  const debutAdresse = start + libelle.length + 3;
  return { texte: texte.slice(0, start) + morceau + texte.slice(end), selection: { start: debutAdresse, end: debutAdresse + adresse.length } };
}

export function appliquerFormat(texte: string, sel: Selection, format: Format): Edition {
  switch (format) {
    case 'gras':
    case 'italique':
      return entourer(texte, sel, format);
    case 'liste':
      return basculerListe(texte, sel);
    case 'lien':
      return insererLien(texte, sel);
  }
}

/** Raccourci clavier → format (Ctrl/Cmd+B gras, Ctrl/Cmd+I italique), ou undefined. */
export function formatDuRaccourci(e: { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Format | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return undefined;
  const k = (e.key ?? '').toLowerCase();
  if (k === 'b') return 'gras';
  if (k === 'i') return 'italique';
  return undefined;
}
