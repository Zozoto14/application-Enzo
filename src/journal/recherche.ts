/**
 * Recherche dans le journal : texte écrit par l'app et notes personnelles,
 * sans tenir compte de la casse ni des accents ; tous les mots demandés
 * doivent se trouver dans la page. Pur.
 */

import type { PageJournal } from './modele';

export const normaliser = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface Resultat {
  jour: string;
  /** Extrait autour du premier mot trouvé. */
  extrait: string;
  /** Où : « note » (écrite par l'utilisateur) ou « page ». */
  dans: 'note' | 'page';
  epingle: boolean;
}

/** Tout le texte d'une page, un morceau par ligne. */
export function textesDePage(p: PageJournal): string[] {
  return [
    p.auto.accroche,
    p.auto.intro,
    ...p.auto.sections.flatMap(s => [s.titre, ...s.paragraphes]),
    ...p.auto.chiffres.map(c => `${c.libelle} ${c.valeur}`),
    p.auto.marquant?.texte ?? '',
    p.auto.cloture,
  ].filter(Boolean);
}

function extraitAutour(texte: string, mot: string): string {
  const propre = texte.replace(/\s+/g, ' ');
  const i = normaliser(propre).indexOf(mot);
  if (i < 0) return propre.slice(0, 100);
  const debut = Math.max(0, i - 40);
  const fin = Math.min(propre.length, i + mot.length + 70);
  return `${debut > 0 ? '…' : ''}${propre.slice(debut, fin).trim()}${fin < propre.length ? '…' : ''}`;
}

/** Pages qui contiennent tous les mots de `requete`, les plus récentes d'abord. */
export function chercher(pages: readonly PageJournal[], requete: string, max = 60): Resultat[] {
  const mots = normaliser(requete).split(/\s+/).filter(m => m.length > 0);
  if (mots.length === 0) return [];
  const sortie: Resultat[] = [];
  for (const p of [...pages].sort((a, b) => (a.jour < b.jour ? 1 : -1))) {
    const note = p.note ?? '';
    const autres = textesDePage(p);
    const tout = normaliser([note, ...autres].join('\n'));
    if (!mots.every(m => tout.includes(m))) continue;
    const dansNote = mots.every(m => normaliser(note).includes(m)) || (note !== '' && normaliser(note).includes(mots[0]));
    const source = dansNote ? note : autres.find(t => normaliser(t).includes(mots[0])) ?? autres[0] ?? '';
    sortie.push({ jour: p.jour, extrait: extraitAutour(source, mots[0]), dans: dansNote ? 'note' : 'page', epingle: p.epingle === true });
    if (sortie.length >= max) break;
  }
  return sortie;
}
