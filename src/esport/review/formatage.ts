/**
 * Mise en forme d'un texte en Markdown limité depuis une barre d'outils ou un
 * raccourci. Fonctions PURES : texte et sélection en entrée, texte et nouvelle
 * sélection en sortie (testées).
 *
 *  - gras `**…**`, italique `*…*`, barré `~~…~~`, surlignage `==…==`, code en ligne `` `…` ``
 *    (second appui = retrait) ; couleur `{{rouge|…}}` (huit couleurs prédéfinies) ;
 *  - lignes : titres `#` à `###`, puces `- `, liste numérotée `1. `, cases `- [ ] `, citation `> `
 *    (le même format une seconde fois retire le préfixe ; un autre le remplace) ;
 *  - bloc de code (```), séparateur `---`, lien `[texte](https://)` ;
 *  - insertion (emoji, mention) ; Entrée dans une liste (`continuerListe`), Tab / Maj+Tab (`indenter`) ;
 *  - historique annuler / rétablir.
 * Sans sélection, un texte d'exemple est inséré puis sélectionné. Pas de souligné :
 * le Markdown limité ne l'a pas (le raccourci Ctrl/Cmd+U applique le barré).
 */

import { tr } from '../i18n';
import { COULEURS, type Couleur } from './markdown';

export interface Selection {
  start: number;
  end: number;
}

export interface Edition {
  texte: string;
  selection: Selection;
}

export type FormatMarque = 'gras' | 'italique' | 'barre' | 'surligne' | 'code';
export type FormatLigne = 'titre1' | 'titre2' | 'titre3' | 'liste' | 'numerotee' | 'case' | 'citation';
export type Format = FormatMarque | FormatLigne | 'bloc' | 'separateur' | 'lien' | `couleur:${Couleur}`;

const MARQUES = { gras: '**', italique: '*', barre: '~~', surligne: '==', code: '`' } as const;
const EXEMPLES = { get gras() {
      return tr('review.formatage.texte_en_gras');
    }, get italique() {
      return tr('review.formatage.texte_en_italique');
    }, get barre() {
      return tr('review.formatage.texte_barre');
    }, get surligne() {
      return tr('review.formatage.texte_surligne');
    }, get code() {
      return tr('review.formatage.code');
    } } as const;

const borner = (texte: string, s: Selection): Selection => {
  const a = Math.max(0, Math.min(texte.length, Math.min(s.start, s.end)));
  const b = Math.max(0, Math.min(texte.length, Math.max(s.start, s.end)));
  return { start: a, end: b };
};

/** Entoure (ou désentoure) la sélection d'une marque (`**` gras, `*` italique). */
export function entourer(texte: string, sel: Selection, format: FormatMarque): Edition {
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

/** Entoure (ou désentoure) la sélection de `{{couleur|…}}` ; une autre couleur déjà posée est remplacée. */
export function colorer(texte: string, sel: Selection, couleur: Couleur): Edition {
  let { start, end } = borner(texte, sel);
  while (start < end && /\s/.test(texte[start])) start++;
  while (end > start && /\s/.test(texte[end - 1])) end--;
  const avant = texte.slice(0, start);
  const apres = texte.slice(end);
  const choisi = texte.slice(start, end);
  const ouvrant = `{{${couleur}|`;
  const autour = /\{\{([a-z]{1,10})\|$/.exec(avant);
  if (choisi && autour && apres.startsWith('}}') && (COULEURS as readonly string[]).includes(autour[1])) {
    const base = avant.length - autour[0].length;
    if (autour[1] === couleur) return { texte: avant.slice(0, base) + choisi + apres.slice(2), selection: { start: base, end: base + choisi.length } };
    return { texte: avant.slice(0, base) + ouvrant + choisi + apres, selection: { start: base + ouvrant.length, end: base + ouvrant.length + choisi.length } };
  }
  const contenu = choisi || tr('review.formatage.texte_en_couleur');
  return { texte: `${avant}${ouvrant}${contenu}}}${apres}`, selection: { start: start + ouvrant.length, end: start + ouvrant.length + contenu.length } };
}

type Genre = FormatLigne | 'rien';
const PREFIXE = /^(\s*)(?:(#{1,3})\s+|(>)\s?|([-*])\s+\[[ xX]\]\s+|([-*])\s+|(\d{1,3}[.)])\s+)/;

function genreDe(ligne: string): { genre: Genre; indent: string; reste: string } {
  const m = PREFIXE.exec(ligne);
  if (!m) return { genre: 'rien', indent: /^\s*/.exec(ligne)![0], reste: ligne.replace(/^\s*/, '') };
  const genre: Genre = m[2] ? (`titre${m[2].length}` as Genre) : m[3] ? 'citation' : m[4] ? 'case' : m[5] ? 'liste' : 'numerotee';
  return { genre, indent: m[1], reste: ligne.slice(m[0].length) };
}

/** Pose (ou retire, si toutes les lignes l'ont déjà) le préfixe de ligne ; un autre préfixe est remplacé. */
export function basculerLignes(texte: string, sel: Selection, format: FormatLigne): Edition {
  const { start, end } = borner(texte, sel);
  const debut = texte.lastIndexOf('\n', start - 1) + 1;
  const finLigne = texte.indexOf('\n', end);
  const fin = finLigne === -1 ? texte.length : finLigne;
  const lignes = texte.slice(debut, fin).split('\n');
  const lu = lignes.map(genreDe);
  const concernees = lu.filter((l, i) => lignes[i].trim() !== '' || lignes.length === 1);
  const toutes = concernees.length > 0 && concernees.every(l => l.genre === format);
  const enliste = format === 'liste' || format === 'numerotee' || format === 'case';
  let numero = 0;
  const nouvelles = lignes.map((l, i) => {
    if (l.trim() === '' && lignes.length > 1) return l;
    const { genre, indent, reste } = lu[i];
    if (toutes) return reste;
    // Même genre : inchangé (la numérotation est reprise plus bas).
    const retrait = enliste ? indent : '';
    numero++;
    if (format === 'liste') return genre === 'liste' ? l : `${retrait}- ${reste}`;
    if (format === 'case') return genre === 'case' ? l : `${retrait}- [ ] ${reste}`;
    if (format === 'numerotee') return `${retrait}${numero}. ${reste}`;
    if (format === 'citation') return genre === 'citation' ? l : `> ${reste}`;
    const niveau = format.slice(5);
    return genre === format ? l : `${'#'.repeat(Number(niveau))} ${reste}`;
  });
  const bloc = nouvelles.join('\n');
  const resultat = texte.slice(0, debut) + bloc + texte.slice(fin);
  if (start === end && !toutes) {
    const decalage = bloc.length - (fin - debut);
    return { texte: resultat, selection: { start: Math.max(debut, start + decalage), end: Math.max(debut, start + decalage) } };
  }
  return { texte: resultat, selection: { start: debut, end: debut + bloc.length } };
}

/** Ajoute (ou retire, si toutes l'ont déjà) la puce `- ` aux lignes touchées par la sélection. */
export const basculerListe = (texte: string, sel: Selection): Edition => basculerLignes(texte, sel, 'liste');

/** Bloc de code ``` autour de la sélection (ou retiré s'il l'entoure déjà). */
export function blocCode(texte: string, sel: Selection): Edition {
  const { start, end } = borner(texte, sel);
  const avant = texte.slice(0, start);
  const apres = texte.slice(end);
  const choisi = texte.slice(start, end);
  const dedans = /(^|\n)```[^\n]*\n$/.exec(avant);
  if (dedans && /^\n?```(\n|$)/.test(apres)) {
    const sansFin = apres.replace(/^\n?```/, '');
    const base = avant.length - (dedans[0].length - dedans[1].length);
    return { texte: avant.slice(0, base) + choisi + sansFin, selection: { start: base, end: base + choisi.length } };
  }
  const contenu = choisi || tr('review.formatage.code');
  const lead = avant === '' || avant.endsWith('\n') ? '' : '\n';
  const trail = apres === '' || apres.startsWith('\n') ? '' : '\n';
  const ouverture = `${avant}${lead}\`\`\`\n`;
  return { texte: `${ouverture}${contenu}\n\`\`\`${trail}${apres}`, selection: { start: ouverture.length, end: ouverture.length + contenu.length } };
}

/** Séparateur `---` sur sa propre ligne, après la ligne du curseur (une ligne vide avant : sinon Markdown y verrait un titre). */
export function separateur(texte: string, sel: Selection): Edition {
  const { end } = borner(texte, sel);
  const f = texte.indexOf('\n', end);
  const fin = f === -1 ? texte.length : f;
  const avant = texte.slice(0, fin);
  const apres = texte.slice(fin);
  const lead = avant === '' || avant.endsWith('\n\n') ? '' : avant.endsWith('\n') ? '\n' : '\n\n';
  const queue = apres === '' ? '\n' : '';
  const nouveau = `${avant}${lead}---${queue}${apres}`;
  const pos = avant.length + lead.length + 3 + queue.length;
  return { texte: nouveau, selection: { start: pos, end: pos } };
}

/** Lien : `[sélection](https://)`, l'adresse sélectionnée pour être remplacée (une adresse sélectionnée devient la cible). */
export function insererLien(texte: string, sel: Selection): Edition {
  const { start, end } = borner(texte, sel);
  const choisi = texte.slice(start, end).trim();
  if (/^https?:\/\/\S+$/i.test(choisi)) {
    const libelle = tr('strats.strats.lien');
    return { texte: `${texte.slice(0, start)}[${libelle}](${choisi})${texte.slice(end)}`, selection: { start: start + 1, end: start + 1 + libelle.length } };
  }
  const libelle = texte.slice(start, end).replace(/[[\]\n]/g, ' ').trim() || 'lien';
  const adresse = 'https://';
  const morceau = `[${libelle}](${adresse})`;
  const debutAdresse = start + libelle.length + 3;
  return { texte: texte.slice(0, start) + morceau + texte.slice(end), selection: { start: debutAdresse, end: debutAdresse + adresse.length } };
}

/** Remplace la sélection par `chaine` (emoji, mention) ; le curseur se place après. */
export function inserer(texte: string, sel: Selection, chaine: string): Edition {
  const { start, end } = borner(texte, sel);
  const pos = start + chaine.length;
  return { texte: texte.slice(0, start) + chaine + texte.slice(end), selection: { start: pos, end: pos } };
}

const CARACTERES_MENTION = 'A-Za-z\\u00c0-\\u00ff0-9_.-';
/** Pseudo utilisable après « @ » : lettres, chiffres, _ . - (le reste retiré). */
export const pseudoMention = (pseudo: string): string => pseudo.replace(new RegExp(`[^${CARACTERES_MENTION}]`, 'g'), '');

/** « @ka » juste avant le curseur ? Renvoie la position du « @ » et ce qui est tapé après. */
export function mentionEnCours(texte: string, curseur: number): { debut: number; requete: string } | undefined {
  const avant = texte.slice(0, Math.max(0, curseur));
  const m = new RegExp(`(^|[\\s(])@([${CARACTERES_MENTION}]{0,32})$`).exec(avant);
  if (!m) return undefined;
  return { debut: avant.length - m[2].length - 1, requete: m[2] };
}

/** Remplace « @req » par « @pseudo » suivi d'une espace. */
export function choisirMention(texte: string, curseur: number, pseudo: string): Edition | undefined {
  const en = mentionEnCours(texte, curseur);
  const nom = pseudoMention(pseudo);
  if (!en || !nom) return undefined;
  const ajout = `@${nom} `;
  return { texte: texte.slice(0, en.debut) + ajout + texte.slice(curseur), selection: { start: en.debut + ajout.length, end: en.debut + ajout.length } };
}

const LISTE_ENTREE = /^(\s*)(?:(>[ \t]?)|([-*])\s+(\[[ xX]\]\s+)?|(\d{1,3})([.)])\s+)(.*)$/;

/**
 * Entrée dans une liste (ou une citation) : curseur sans sélection, texte AVANT l'insertion du retour à la ligne.
 * Continue la liste (puce, numéro suivant, case décochée, `> `) ; sur un élément vide, sort de la liste (un
 * retrait en moins pour un élément imbriqué). Undefined : le retour à la ligne normal s'applique.
 */
export function continuerListe(texte: string, sel: Selection): Edition | undefined {
  const { start, end } = borner(texte, sel);
  if (start !== end) return undefined;
  const debut = texte.lastIndexOf('\n', start - 1) + 1;
  const f = texte.indexOf('\n', start);
  const fin = f === -1 ? texte.length : f;
  const ligne = texte.slice(debut, fin);
  const m = LISTE_ENTREE.exec(ligne);
  if (!m) return undefined;
  const contenu = m[7];
  const longueurPrefixe = m[0].length - contenu.length;
  if (start - debut < longueurPrefixe) return undefined;
  const [, indent, citation, puce, caseMd, numero, delim] = m;
  if (contenu.trim() === '' && start === fin) {
    if (indent.length >= 2) {
      const moins = indent.slice(0, -2);
      const prefixe = ligne.slice(indent.length, longueurPrefixe);
      const nouveau = moins + prefixe;
      return { texte: texte.slice(0, debut) + nouveau + texte.slice(fin), selection: { start: debut + nouveau.length, end: debut + nouveau.length } };
    }
    return { texte: texte.slice(0, debut) + texte.slice(fin), selection: { start: debut, end: debut } };
  }
  const prefixe = citation ? '> ' : puce ? `${puce} ${caseMd ? '[ ] ' : ''}` : `${Number(numero) + 1}${delim} `;
  const ajout = `\n${indent}${prefixe}`;
  return { texte: texte.slice(0, start) + ajout + texte.slice(start), selection: { start: start + ajout.length, end: start + ajout.length } };
}

/** Tab (+1) ou Maj+Tab (−1) : retrait de 2 espaces (jusqu'à 3 niveaux) des lignes de liste touchées. Undefined si aucune n'est une liste. */
export function indenter(texte: string, sel: Selection, sens: 1 | -1): Edition | undefined {
  const { start, end } = borner(texte, sel);
  const debut = texte.lastIndexOf('\n', start - 1) + 1;
  const f = texte.indexOf('\n', end);
  const fin = f === -1 ? texte.length : f;
  const lignes = texte.slice(debut, fin).split('\n');
  const estListe = (l: string) => /^\s*(?:[-*]|\d{1,3}[.)])\s+/.test(l);
  if (!lignes.some(estListe)) return undefined;
  let premier = 0;
  let total = 0;
  const nouvelles = lignes.map((l, i) => {
    if (!estListe(l)) return l;
    const retrait = /^ */.exec(l)![0].length;
    let delta = 0;
    if (sens === 1) delta = retrait >= 6 ? 0 : 2;
    else delta = -Math.min(2, retrait);
    if (i === 0) premier = delta;
    total += delta;
    return delta > 0 ? '  ' + l : l.slice(-delta);
  });
  const bloc = nouvelles.join('\n');
  const resultat = texte.slice(0, debut) + bloc + texte.slice(fin);
  if (start === end) {
    const p = Math.max(debut, start + premier);
    return { texte: resultat, selection: { start: p, end: p } };
  }
  return { texte: resultat, selection: { start: Math.max(debut, start + premier), end: end + total } };
}

export function appliquerFormat(texte: string, sel: Selection, format: Format): Edition {
  switch (format) {
    case 'gras':
    case 'italique':
    case 'barre':
    case 'surligne':
    case 'code':
      return entourer(texte, sel, format);
    case 'liste':
    case 'numerotee':
    case 'case':
    case 'citation':
    case 'titre1':
    case 'titre2':
    case 'titre3':
      return basculerLignes(texte, sel, format);
    case 'bloc':
      return blocCode(texte, sel);
    case 'separateur':
      return separateur(texte, sel);
    case 'lien':
      return insererLien(texte, sel);
    default:
      return colorer(texte, sel, format.slice('couleur:'.length) as Couleur);
  }
}

type ToucheClavier = { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };
export type ActionClavier = Format | 'annuler' | 'retablir';

/**
 * Raccourci clavier → action : Ctrl/Cmd+B gras, I italique, U barré (pas de souligné en Markdown limité),
 * Maj+X barré, K lien, Maj+7 liste numérotée, Maj+8 liste à puces (touche physique, quel que soit le clavier),
 * Z annuler, Maj+Z ou Y rétablir. Undefined sinon.
 */
export function actionDuRaccourci(e: ToucheClavier): ActionClavier | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined;
  const k = (e.key ?? '').toLowerCase();
  if (e.shiftKey) {
    if (k === 'x') return 'barre';
    if (k === 'z') return 'retablir';
    if (e.code === 'Digit7' || e.code === 'Numpad7' || k === '7' || k === '&') return 'numerotee';
    if (e.code === 'Digit8' || e.code === 'Numpad8' || k === '8' || k === '*') return 'liste';
    return undefined;
  }
  switch (k) {
    case 'b':
      return 'gras';
    case 'i':
      return 'italique';
    case 'u':
      return 'barre';
    case 'k':
      return 'lien';
    case 'z':
      return 'annuler';
    case 'y':
      return 'retablir';
  }
  return undefined;
}

/** Raccourci de mise en forme seulement (sans annuler / rétablir), ou undefined. */
export function formatDuRaccourci(e: ToucheClavier): Format | undefined {
  const a = actionDuRaccourci(e);
  return a === 'annuler' || a === 'retablir' ? undefined : a;
}

// ---------------------------------------------------------------- Historique annuler / rétablir

export interface EtatNote {
  texte: string;
  selection: Selection;
}
export interface Historique {
  passe: EtatNote[];
  futur: EtatNote[];
}
export const HISTORIQUE_MAX = 200;
export const historiqueVide = (): Historique => ({ passe: [], futur: [] });

/** Garde l'état d'AVANT une modification. `regrouper` : la frappe continue la précédente (un seul pas d'annulation). */
export function enregistrer(h: Historique, avant: EtatNote, regrouper = false): Historique {
  if (regrouper && h.passe.length > 0) return { passe: h.passe, futur: [] };
  return { passe: [...h.passe, avant].slice(-HISTORIQUE_MAX), futur: [] };
}

export function annulerEdition(h: Historique, courant: EtatNote): { historique: Historique; etat: EtatNote } | undefined {
  const etat = h.passe[h.passe.length - 1];
  if (!etat) return undefined;
  return { historique: { passe: h.passe.slice(0, -1), futur: [...h.futur, courant] }, etat };
}

export function retablirEdition(h: Historique, courant: EtatNote): { historique: Historique; etat: EtatNote } | undefined {
  const etat = h.futur[h.futur.length - 1];
  if (!etat) return undefined;
  return { historique: { passe: [...h.passe, courant], futur: h.futur.slice(0, -1) }, etat };
}
