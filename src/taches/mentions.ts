/**
 * Mentions « @prénom » dans les commentaires (V3).
 *
 * On mentionne une personne du projet (le Fondateur et les membres qui le
 * voient) par son prénom (« @Léa ») ou son nom entier sans espaces
 * (« @LéaMartin », « @lea-martin »), sans tenir compte des accents ni de la
 * casse. Le commentaire garde la liste des codes mentionnés (`mentions`) :
 * chacun est notifié selon SES réglages (type « mention »). On ne se
 * mentionne pas soi-même.
 */

import { sansAccents } from './dates';
import type { Auteur } from './modele';

export interface Personne {
  code: Auteur;
  nom: string;
}

const cles = (nom: string): string[] => {
  const n = sansAccents(nom).trim();
  const mots = n.split(/\s+/).filter(Boolean);
  return [...new Set([mots[0] ?? '', n.replace(/\s+/g, ''), n.replace(/\s+/g, '-')])].filter(Boolean);
};

const MOTIF = /(^|[\s(«"'])@([\p{L}\p{N}_-]{1,40})/gu;

/** Codes des personnes mentionnées dans un texte (dans l'ordre, sans doublon). */
export function trouverMentions(texte: string, personnes: readonly Personne[], moi?: Auteur): Auteur[] {
  const index = new Map<string, Auteur>();
  for (const p of personnes) for (const c of cles(p.nom)) if (!index.has(c)) index.set(c, p.code);
  const r: Auteur[] = [];
  for (const m of texte.matchAll(MOTIF)) {
    const mot = sansAccents(m[2]).replace(/[-_]+$/, '');
    const code = index.get(mot);
    if (code && code !== moi && !r.includes(code)) r.push(code);
  }
  return r;
}

/** Découpe un texte en morceaux, les mentions reconnues à part (pour les mettre en valeur). */
export function decouperMentions(texte: string, personnes: readonly Personne[]): Array<{ texte: string; mention?: Auteur }> {
  const index = new Map<string, Auteur>();
  for (const p of personnes) for (const c of cles(p.nom)) if (!index.has(c)) index.set(c, p.code);
  const r: Array<{ texte: string; mention?: Auteur }> = [];
  let dernier = 0;
  for (const m of texte.matchAll(MOTIF)) {
    const debut = (m.index ?? 0) + m[1].length;
    const code = index.get(sansAccents(m[2]).replace(/[-_]+$/, ''));
    if (!code) continue;
    if (debut > dernier) r.push({ texte: texte.slice(dernier, debut) });
    r.push({ texte: `@${m[2]}`, mention: code });
    dernier = debut + 1 + m[2].length;
  }
  if (dernier < texte.length) r.push({ texte: texte.slice(dernier) });
  return r;
}

/**
 * Suggestions pendant la saisie : si le texte finit par « @dé… », les
 * personnes dont le prénom commence ainsi (ou toutes, juste après « @ »).
 */
export function suggestionsMention(texte: string, personnes: readonly Personne[], moi?: Auteur): Personne[] {
  const m = /(?:^|\s)@([\p{L}\p{N}_-]{0,40})$/u.exec(texte);
  if (!m) return [];
  const debut = sansAccents(m[1]);
  return personnes.filter(p => p.code !== moi && cles(p.nom).some(c => c.startsWith(debut))).slice(0, 6);
}

/** Complète la mention en cours de saisie par le prénom choisi. */
export function completerMention(texte: string, p: Personne): string {
  const prenom = p.nom.trim().split(/\s+/)[0] || p.nom;
  return texte.replace(/@([\p{L}\p{N}_-]{0,40})$/u, `@${prenom} `);
}
