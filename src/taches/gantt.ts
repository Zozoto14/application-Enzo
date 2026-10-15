/**
 * Chronologie (Gantt) de Tâches (V3), calculs purs.
 *
 *  - Une barre par tâche : de son début (`debut`) à son échéance ; une tâche
 *    avec seulement une échéance (ou seulement un début) tient sur un jour ;
 *    un jalon est un point (losange) à son échéance. Sans aucune date, la
 *    tâche est listée à part (« À planifier »).
 *  - Dépendances « fin → début » (`dependances` : les tâches à finir avant).
 *    Elle est violée si la suivante commence le jour où (ou avant que) la
 *    précédente finit. « Décaler les suivantes » repousse les tâches
 *    concernées, en gardant leur durée, de proche en proche.
 *  - Échelles : jour, semaine, mois (largeur d'un jour en pixels).
 */

import { ajouterJours, ecartJours, MOIS } from './dates';
import { ErreurTaches, estTerminee, listesDe, modifierTache, type Contexte, type DonneesTaches, type Tache } from './modele';

export type Zoom = 'jour' | 'semaine' | 'mois';
export const LIBELLES_ZOOM: Record<Zoom, string> = { jour: 'Jour', semaine: 'Semaine', mois: 'Mois' };
/** Largeur d'un jour (px) selon l'échelle. */
export const LARGEUR_JOUR: Record<Zoom, number> = { jour: 48, semaine: 20, mois: 7 };

export interface Barre {
  tache: Tache;
  debut: string;
  fin: string;
  jalon: boolean;
  terminee: boolean;
}

/** Début et fin d'une tâche dans la chronologie (undefined : pas de date). */
export function bornes(t: Pick<Tache, 'debut' | 'echeance' | 'jalon'>): { debut: string; fin: string } | undefined {
  const fin = t.echeance?.jour ?? t.debut;
  if (!fin) return undefined;
  if (t.jalon) return { debut: fin, fin };
  const debut = t.debut && t.debut <= fin ? t.debut : fin;
  return { debut, fin };
}

export function barres(d: DonneesTaches, taches: readonly Tache[]): { barres: Barre[]; sansDate: Tache[] } {
  const r: Barre[] = [];
  const sansDate: Tache[] = [];
  for (const t of taches) {
    const b = bornes(t);
    if (!b) sansDate.push(t);
    else r.push({ tache: t, ...b, jalon: Boolean(t.jalon), terminee: estTerminee(d, t) });
  }
  r.sort((a, b) => a.debut.localeCompare(b.debut) || a.fin.localeCompare(b.fin) || a.tache.titre.localeCompare(b.tache.titre));
  return { barres: r, sansDate };
}

export interface GroupeGantt {
  cle: string;
  titre: string;
  couleur?: string;
  barres: Barre[];
}

/** Regroupe par projet, puis par liste (si le projet en a plusieurs). */
export function groupesGantt(d: DonneesTaches, liste: readonly Barre[]): GroupeGantt[] {
  const parCle = new Map<string, GroupeGantt>();
  for (const b of liste) {
    const p = d.projets[b.tache.projetId];
    const plusieurs = listesDe(d, b.tache.projetId).length > 1;
    const l = d.listes[b.tache.listeId];
    const cle = plusieurs ? `${b.tache.projetId}/${b.tache.listeId}` : b.tache.projetId;
    if (!parCle.has(cle)) parCle.set(cle, { cle, titre: `${p?.nom ?? 'Projet'}${plusieurs ? ` › ${l?.nom ?? 'Liste'}` : ''}`, couleur: p?.couleur, barres: [] });
    parCle.get(cle)!.barres.push(b);
  }
  return [...parCle.values()].sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
}

export interface Lien {
  de: string;
  vers: string;
  viole: boolean;
}

/** Dépendances entre tâches présentes dans la chronologie, et si elles sont respectées. */
export function liens(d: DonneesTaches, taches: readonly Tache[]): Lien[] {
  const presents = new Set(taches.map(t => t.id));
  const r: Lien[] = [];
  for (const t of taches) {
    for (const de of t.dependances ?? []) {
      if (!presents.has(de)) continue;
      r.push({ de, vers: t.id, viole: dependanceViolee(d, de, t.id) });
    }
  }
  return r;
}

/** « Fin → début » non respecté : la suivante commence avant le lendemain de la fin de la précédente. */
export function dependanceViolee(d: DonneesTaches, avant: string, apres: string): boolean {
  const a = d.taches[avant];
  const b = d.taches[apres];
  if (!a || !b || a.supprime || b.supprime || estTerminee(d, a)) return false;
  const ba = bornes(a);
  const bb = bornes(b);
  if (!ba || !bb) return false;
  return bb.debut <= ba.fin;
}

/** Dépendances violées d'une tâche (ses prédécesseurs qui finissent trop tard). */
export function violationsDe(d: DonneesTaches, id: string): string[] {
  return (d.taches[id]?.dependances ?? []).filter(x => dependanceViolee(d, x, id));
}

/** Déplace une tâche de `jours` (début et échéance ensemble). */
export function deplacer(d: DonneesTaches, id: string, jours: number, ctx: Contexte): DonneesTaches {
  const t = d.taches[id];
  if (!t) throw new ErreurTaches('Tâche introuvable.');
  if (!jours) return d;
  const b = bornes(t);
  if (!b) throw new ErreurTaches('Donnez d’abord une date à cette tâche.');
  return modifierTache(
    d,
    id,
    {
      ...(t.debut ? { debut: ajouterJours(t.debut, jours) } : {}),
      ...(t.echeance ? { echeance: { ...t.echeance, jour: ajouterJours(t.echeance.jour, jours) } } : {}),
    },
    ctx,
  );
}

/** Étire une barre : son début ou sa fin (jamais l'un après l'autre). */
export function etirer(d: DonneesTaches, id: string, cote: 'debut' | 'fin', jours: number, ctx: Contexte): DonneesTaches {
  const t = d.taches[id];
  if (!t) throw new ErreurTaches('Tâche introuvable.');
  const b = bornes(t);
  if (!b || !jours) return d;
  if (cote === 'debut') {
    const debut = ajouterJours(b.debut, jours);
    if (debut > b.fin) throw new ErreurTaches('Le début ne peut pas passer après l’échéance.');
    return modifierTache(d, id, { debut, ...(t.echeance ? {} : { echeance: { jour: b.fin } }) }, ctx);
  }
  const fin = ajouterJours(b.fin, jours);
  if (fin < b.debut) throw new ErreurTaches('L’échéance ne peut pas passer avant le début.');
  return modifierTache(d, id, { echeance: { ...(t.echeance ?? {}), jour: fin }, ...(t.debut ? {} : { debut: b.debut }) }, ctx);
}

/**
 * Repousse les tâches qui dépendent de `id` (et leurs suivantes) pour
 * qu'elles commencent le lendemain de la fin de leur prédécesseur, en
 * gardant leur durée. Rend les tâches décalées.
 */
export function decalerSuivantes(d: DonneesTaches, id: string, ctx: Contexte): { donnees: DonneesTaches; decalees: string[] } {
  let x = d;
  const decalees: string[] = [];
  const file = [id];
  let tours = 0;
  while (file.length && tours++ < 500) {
    const courant = file.shift()!;
    const bc = x.taches[courant] ? bornes(x.taches[courant]) : undefined;
    if (!bc) continue;
    for (const t of Object.values(x.taches)) {
      if (t.supprime || !(t.dependances ?? []).includes(courant)) continue;
      const bt = bornes(t);
      if (!bt || bt.debut > bc.fin) continue;
      const ecart = ecartJours(bt.debut, ajouterJours(bc.fin, 1));
      x = deplacer(x, t.id, ecart, ctx);
      if (!decalees.includes(t.id)) decalees.push(t.id);
      file.push(t.id);
    }
  }
  return { donnees: x, decalees };
}

/** Ajoute (ou retire) une dépendance « fin → début ». */
export function basculerDependance(d: DonneesTaches, apres: string, avant: string, ctx: Contexte): DonneesTaches {
  const t = d.taches[apres];
  if (!t) throw new ErreurTaches('Tâche introuvable.');
  if (apres === avant) throw new ErreurTaches('Une tâche ne dépend pas d’elle-même.');
  const l = t.dependances ?? [];
  return modifierTache(d, apres, { dependances: l.includes(avant) ? l.filter(x => x !== avant) : [...l, avant] }, ctx);
}

export interface Echelle {
  debut: string;
  fin: string;
  jours: number;
  largeurJour: number;
  /** Repères en haut de la chronologie. */
  reperes: Array<{ jour: string; texte: string; fort: boolean }>;
}

/** Fenêtre affichée : toutes les barres, aujourd'hui, une marge de chaque côté. */
export function echelle(liste: readonly Barre[], zoom: Zoom, aujourdhui: string): Echelle {
  const marge = zoom === 'jour' ? 3 : zoom === 'semaine' ? 7 : 20;
  let debut = ajouterJours(aujourdhui, -marge);
  let fin = ajouterJours(aujourdhui, marge * 2);
  for (const b of liste) {
    if (b.debut < ajouterJours(debut, marge)) debut = ajouterJours(b.debut, -marge);
    if (b.fin > ajouterJours(fin, -marge)) fin = ajouterJours(b.fin, marge);
  }
  // Une échelle commence un lundi (semaine) ou un 1er du mois (mois).
  if (zoom !== 'jour') {
    const j = new Date(`${debut}T12:00:00`);
    if (zoom === 'semaine') debut = ajouterJours(debut, -((j.getDay() + 6) % 7));
    else debut = `${debut.slice(0, 8)}01`;
  }
  const jours = Math.min(800, ecartJours(debut, fin) + 1);
  const reperes: Echelle['reperes'] = [];
  for (let i = 0; i < jours; i++) {
    const jour = ajouterJours(debut, i);
    const date = new Date(`${jour}T12:00:00`);
    const premierDuMois = jour.endsWith('-01');
    if (zoom === 'jour') reperes.push({ jour, texte: `${['di', 'lu', 'ma', 'me', 'je', 've', 'sa'][date.getDay()]} ${date.getDate()}`, fort: date.getDay() === 1 || premierDuMois });
    else if (zoom === 'semaine' && date.getDay() === 1) reperes.push({ jour, texte: `${date.getDate()} ${MOIS[date.getMonth()].slice(0, 4)}.`, fort: premierDuMois || date.getDate() <= 7 });
    else if (zoom === 'mois' && premierDuMois) reperes.push({ jour, texte: `${MOIS[date.getMonth()]} ${date.getFullYear()}`, fort: true });
  }
  return { debut, fin: ajouterJours(debut, jours - 1), jours, largeurJour: LARGEUR_JOUR[zoom], reperes };
}

/** Position (px) d'un jour dans l'échelle. */
export const position = (e: Echelle, jour: string): number => ecartJours(e.debut, jour) * e.largeurJour;
