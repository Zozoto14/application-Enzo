/**
 * Tâches : recherche, filtres, tris, regroupements, « Ma journée » et
 * calendrier. Pur (le jour courant est passé en paramètre).
 */

import { ajouterJours, debutSemaine, ecartJours, instantDe, sansAccents } from './dates';
import {
  LIBELLES_PRIORITE,
  PRIORITES,
  RANG_PRIORITE,
  estTerminee,
  statutDe,
  statutsDe,
  tachesVivantes,
  type DonneesTaches,
  type Filtres,
  type Groupe,
  type Tache,
  type Tri,
} from './modele';

export function correspond(t: Tache, recherche: string): boolean {
  const mots = sansAccents(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const foin = sansAccents([t.titre, t.description, ...t.etiquettes.map(e => `#${e}`), ...Object.values(t.checklist).filter(e => !e.supprime).map(e => e.texte)].join(' '));
  return mots.every(m => foin.includes(m));
}

export function filtrer(d: DonneesTaches, taches: readonly Tache[], f: Filtres, aujourdhui: string): Tache[] {
  const finSemaine = ajouterJours(aujourdhui, 7);
  return taches.filter(t => {
    if (!correspond(t, f.recherche)) return false;
    const ferme = estTerminee(d, t);
    if (!f.terminees && ferme) return false;
    if (f.statuts.length && !f.statuts.includes(t.statut)) return false;
    if (f.priorites.length && !f.priorites.includes(t.priorite)) return false;
    if (f.etiquettes.length && !f.etiquettes.some(e => t.etiquettes.includes(e))) return false;
    if (f.assigne === 'personne' && t.assigne) return false;
    if ((f.assigne === 'fondateur' || f.assigne === 'ami') && t.assigne !== f.assigne) return false;
    const jour = t.echeance?.jour;
    switch (f.echeance) {
      case 'retard':
        return Boolean(jour && jour < aujourdhui && !ferme);
      case 'aujourdhui':
        return jour === aujourdhui;
      case 'semaine':
        return Boolean(jour && jour >= aujourdhui && jour <= finSemaine);
      case 'sans':
        return !jour;
      default:
        return true;
    }
  });
}

export const filtresActifs = (f: Filtres): number =>
  (f.recherche.trim() ? 1 : 0) + (f.statuts.length ? 1 : 0) + (f.priorites.length ? 1 : 0) + (f.etiquettes.length ? 1 : 0) + (f.assigne !== 'tous' ? 1 : 0) + (f.echeance !== 'toutes' ? 1 : 0) + (f.terminees ? 0 : 1);

const cleEcheance = (t: Tache) => (t.echeance ? instantDe(t.echeance.jour, t.echeance.heure) : Number.MAX_SAFE_INTEGER);

export function trier(d: DonneesTaches, taches: readonly Tache[], tri: Tri): Tache[] {
  const r = [...taches];
  const departage = (a: Tache, b: Tache) => a.ordre - b.ordre || a.creeLe.localeCompare(b.creeLe) || a.id.localeCompare(b.id);
  switch (tri) {
    case 'echeance':
      return r.sort((a, b) => cleEcheance(a) - cleEcheance(b) || RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite] || departage(a, b));
    case 'priorite':
      return r.sort((a, b) => RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite] || cleEcheance(a) - cleEcheance(b) || departage(a, b));
    case 'titre':
      return r.sort((a, b) => sansAccents(a.titre).localeCompare(sansAccents(b.titre)) || departage(a, b));
    case 'creation':
      return r.sort((a, b) => b.creeLe.localeCompare(a.creeLe) || departage(a, b));
    case 'statut': {
      const rang = (t: Tache) => statutsDe(d, t.projetId).findIndex(s => s.id === t.statut);
      return r.sort((a, b) => rang(a) - rang(b) || departage(a, b));
    }
    default:
      return r.sort(departage);
  }
}

export const LIBELLES_TRI: Record<Tri, string> = { manuel: 'Ordre manuel', echeance: 'Échéance', priorite: 'Priorité', titre: 'Titre', creation: 'Plus récentes', statut: 'Statut' };
export const LIBELLES_GROUPE: Record<Groupe, string> = { statut: 'Statut', priorite: 'Priorité', echeance: 'Échéance', aucun: 'Aucun' };

export interface GroupeTaches {
  cle: string;
  titre: string;
  couleur?: string;
  taches: Tache[];
}

export type Tranche = 'retard' | 'aujourdhui' | 'demain' | 'semaine' | 'plus-tard' | 'sans';
export const LIBELLES_TRANCHE: Record<Tranche, string> = { retard: 'En retard', aujourdhui: 'Aujourd’hui', demain: 'Demain', semaine: '7 prochains jours', 'plus-tard': 'Plus tard', sans: 'Sans échéance' };

export function trancheDe(t: Tache, aujourdhui: string, ferme = false): Tranche {
  const j = t.echeance?.jour;
  if (!j) return 'sans';
  if (j < aujourdhui) return ferme ? 'aujourdhui' : 'retard';
  const e = ecartJours(aujourdhui, j);
  if (e === 0) return 'aujourdhui';
  if (e === 1) return 'demain';
  if (e <= 7) return 'semaine';
  return 'plus-tard';
}

/** Regroupe des tâches déjà triées ; les groupes vides de statut restent (colonnes, glisser). */
export function grouper(d: DonneesTaches, taches: readonly Tache[], groupe: Groupe, aujourdhui: string, projetId?: string): GroupeTaches[] {
  if (groupe === 'aucun') return [{ cle: 'tout', titre: 'Toutes les tâches', taches: [...taches] }];
  if (groupe === 'priorite') {
    return PRIORITES.map(p => ({ cle: p, titre: LIBELLES_PRIORITE[p], taches: taches.filter(t => t.priorite === p) })).filter(g => g.taches.length > 0);
  }
  if (groupe === 'echeance') {
    const ordre: Tranche[] = ['retard', 'aujourdhui', 'demain', 'semaine', 'plus-tard', 'sans'];
    return ordre.map(c => ({ cle: c, titre: LIBELLES_TRANCHE[c], taches: taches.filter(t => trancheDe(t, aujourdhui, estTerminee(d, t)) === c) })).filter(g => g.taches.length > 0);
  }
  // Statut : ceux du projet (dans l'ordre), ou par nom tous projets confondus.
  if (projetId) {
    return statutsDe(d, projetId).map(s => ({ cle: s.id, titre: s.nom, couleur: s.couleur, taches: taches.filter(t => t.statut === s.id) }));
  }
  const groupes = new Map<string, GroupeTaches>();
  for (const t of taches) {
    const s = statutDe(d, t);
    const cle = s.ferme ? '~ferme' : sansAccents(s.nom);
    const g = groupes.get(cle) ?? { cle, titre: s.nom, couleur: s.couleur, taches: [] };
    g.taches.push(t);
    groupes.set(cle, g);
  }
  return [...groupes.values()].sort((a, b) => (a.cle === '~ferme' ? 1 : b.cle === '~ferme' ? -1 : 0));
}

// ------------------------------------------------------------------ Ma journée

export interface Journee {
  retard: Tache[];
  aujourdhui: Tache[];
  choisies: Tache[];
  aVenir: Tache[];
}

/**
 * « Ma journée » : en retard, dû aujourd'hui, choisi pour aujourd'hui, à venir
 * sur 7 jours. Chaque tâche n'apparaît qu'une fois ; seules les tâches
 * ouvertes, assignées à `qui` ou à personne.
 */
export function maJournee(d: DonneesTaches, aujourdhui: string, qui?: 'fondateur' | 'ami', taches: readonly Tache[] = tachesVivantes(d)): Journee {
  const fin = ajouterJours(aujourdhui, 7);
  const ouvertes = taches.filter(t => !estTerminee(d, t) && (!qui || !t.assigne || t.assigne === qui));
  const tri = (l: Tache[]) => trier(d, l, 'echeance');
  const vus = new Set<string>();
  const prendre = (l: Tache[]) => {
    const r = l.filter(t => !vus.has(t.id));
    r.forEach(t => vus.add(t.id));
    return tri(r);
  };
  const retard = prendre(ouvertes.filter(t => t.echeance && t.echeance.jour < aujourdhui));
  const duAujourdhui = prendre(ouvertes.filter(t => t.echeance?.jour === aujourdhui));
  const choisies = prendre(ouvertes.filter(t => t.pourAujourdhui === aujourdhui));
  const aVenir = prendre(ouvertes.filter(t => t.echeance && t.echeance.jour > aujourdhui && t.echeance.jour <= fin));
  return { retard, aujourdhui: duAujourdhui, choisies, aVenir };
}

// ------------------------------------------------------------------ Calendrier

/** Les 6 semaines (42 jours) affichées pour le mois qui contient `jour`. */
export function grilleMois(jour: string): string[] {
  const premier = `${jour.slice(0, 8)}01`;
  const debut = debutSemaine(premier);
  return Array.from({ length: 42 }, (_, i) => ajouterJours(debut, i));
}

export const grilleSemaine = (jour: string): string[] => Array.from({ length: 7 }, (_, i) => ajouterJours(debutSemaine(jour), i));

export function tachesParJour(taches: readonly Tache[], jours: readonly string[]): Record<string, Tache[]> {
  const r: Record<string, Tache[]> = Object.fromEntries(jours.map(j => [j, [] as Tache[]]));
  for (const t of taches) {
    const j = t.echeance?.jour;
    if (j && r[j]) r[j].push(t);
  }
  for (const j of Object.keys(r)) r[j].sort((a, b) => (a.echeance?.heure ?? '99').localeCompare(b.echeance?.heure ?? '99') || RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite] || a.id.localeCompare(b.id));
  return r;
}
