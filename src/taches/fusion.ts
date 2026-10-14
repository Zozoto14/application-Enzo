/**
 * Tâches : fusion de deux copies (appareils du Fondateur, Fondateur ↔ ami).
 *
 *  - entité par entité, puis CHAMP par champ : l'horodatage le plus récent
 *    l'emporte (« ISO|auteur ») ; à égalité, la valeur la plus grande dans
 *    l'ordre canonique (les deux côtés choisissent la même) ;
 *  - une suppression est le champ `supprime` (pierre tombale datée) : plus
 *    récente qu'une modification, elle gagne ; une restauration plus récente
 *    la défait ;
 *  - checklist, commentaires et temps passé : élément par élément ; historique : union
 *    (identifiants), bornée aux 100 derniers événements.
 *
 * La fusion est commutative, associative et idempotente : quel que soit
 * l'ordre des échanges, toutes les copies convergent, et deux modifications
 * de champs différents d'une même tâche (Fondateur et ami) sont gardées
 * toutes les deux. Deux modifications du MÊME champ : la plus récente gagne,
 * l'ancienne valeur d'un titre ou d'une description reste dans l'historique.
 */

import {
  borneHistorique,
  type Commentaire,
  type DonneesTaches,
  type ElementChecklist,
  type EntreeJournal,
  type EntreeTemps,
  type Projet,
  type Entite,
  type Horodatages,
  type Tache,
} from './modele';

function canonique(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonique);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .filter(k => (v as Record<string, unknown>)[k] !== undefined)
        .map(k => [k, canonique((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Forme canonique en texte (clés triées) : sert aux égalités et aux départages. */
export const texteCanonique = (v: unknown): string => JSON.stringify(canonique(v)) ?? '~';

const SPECIAUX = new Set(['id', 'h', 'checklist', 'commentaires', 'historique', 'temps']);

/** Projet : champs par champ, historique par union. */
export function fusionnerProjet(a: Projet, b: Projet): Projet {
  if (a === b) return a;
  const base = fusionnerEntite(a, b);
  const historique = borneHistorique([...(a.historique ?? []), ...(b.historique ?? [])]);
  const r = { ...base } as Projet;
  delete r.historique;
  return historique.length ? { ...r, historique } : r;
}

/** Fusion champ par champ de deux versions d'une même entité. */
export function fusionnerEntite<T extends Entite>(a: T, b: T): T {
  if (a === b) return a;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const r: Record<string, unknown> = { id: a.id };
  const h: Horodatages = {};
  const champs = new Set([...Object.keys(ra), ...Object.keys(rb), ...Object.keys(a.h ?? {}), ...Object.keys(b.h ?? {})]);
  for (const c of [...champs].sort()) {
    if (SPECIAUX.has(c)) continue;
    const ha = a.h?.[c] ?? '';
    const hb = b.h?.[c] ?? '';
    let prendreB: boolean;
    if (ha !== hb) prendreB = hb > ha;
    else prendreB = texteCanonique(rb[c]) > texteCanonique(ra[c]);
    const v = prendreB ? rb[c] : ra[c];
    const hh = prendreB ? hb : ha;
    if (v !== undefined) r[c] = v;
    if (hh) h[c] = hh;
  }
  r.h = h;
  return r as unknown as T;
}

function fusionnerElements<E extends { id: string; h: string }>(a: Record<string, E>, b: Record<string, E>): Record<string, E> {
  const r: Record<string, E> = {};
  for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[id];
    const y = b[id];
    if (!x || !y) {
      r[id] = (x ?? y)!;
      continue;
    }
    r[id] = x.h !== y.h ? (y.h > x.h ? y : x) : texteCanonique(y) > texteCanonique(x) ? y : x;
  }
  return r;
}

export function fusionnerTache(a: Tache, b: Tache): Tache {
  if (a === b) return a;
  const base = fusionnerEntite(a, b);
  return {
    ...base,
    checklist: fusionnerElements<ElementChecklist>(a.checklist ?? {}, b.checklist ?? {}),
    commentaires: fusionnerElements<Commentaire>(a.commentaires ?? {}, b.commentaires ?? {}),
    temps: fusionnerElements<EntreeTemps>(a.temps ?? {}, b.temps ?? {}),
    historique: borneHistorique([...(a.historique ?? []), ...(b.historique ?? [])]),
  };
}

export function fusionnerCollection<T extends Entite>(a: Record<string, T>, b: Record<string, T>, f: (x: T, y: T) => T = fusionnerEntite): Record<string, T> {
  const r: Record<string, T> = {};
  for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[id];
    const y = b[id];
    r[id] = x && y ? f(x, y) : (x ?? y)!;
  }
  return r;
}

/** Fusion complète de deux copies des données (appareils du Fondateur). */
export function fusionnerDonnees(a: DonneesTaches, b: DonneesTaches): DonneesTaches {
  return {
    v: 1,
    espaces: fusionnerCollection(a.espaces, b.espaces),
    projets: fusionnerCollection(a.projets, b.projets, fusionnerProjet),
    listes: fusionnerCollection(a.listes, b.listes),
    taches: fusionnerCollection(a.taches, b.taches, fusionnerTache),
    vues: fusionnerCollection(a.vues, b.vues),
    reglages: fusionnerEntite(a.reglages, b.reglages),
    journal: fusionnerElements<EntreeJournal>(a.journal ?? {}, b.journal ?? {}),
  };
}

export const memesDonnees = (a: DonneesTaches, b: DonneesTaches): boolean => texteCanonique(a) === texteCanonique(b);
