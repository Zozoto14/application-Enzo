/**
 * Tâches (V2) : suivi du temps.
 *
 *  - Minuteur sur une tâche : UN SEUL actif à la fois par personne (démarrer
 *    sur une tâche arrête celui qui tournait ailleurs et note son temps). Le
 *    minuteur est un champ daté de la tâche (`chronoF` pour le Fondateur,
 *    `chronoA` pour l'ami) : il passe d'un appareil à l'autre par la
 *    synchronisation existante, et seuls le démarrage et l'arrêt écrivent —
 *    jamais chaque seconde (l'affichage compte tout seul).
 *  - Saisie manuelle (jour, minutes, note), estimation (minutes) contre réel.
 *  - Relevé hebdomadaire par projet ou par étiquette, export CSV.
 *
 * Les entrées de temps sont fusionnées élément par élément (comme la
 * checklist) : deux appareils qui notent chacun du temps gardent tout.
 */

import { ajouterJours, jourDe } from './dates';
import {
  BORNES,
  borneHistorique,
  ErreurTaches,
  evenement,
  horodatage,
  nouvelId,
  tachesVivantes,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type EntreeTemps,
  type Tache,
} from './modele';

export const CHAMP_CHRONO: Record<Auteur, 'chronoF' | 'chronoA'> = { fondateur: 'chronoF', ami: 'chronoA' };
/** Moins de 30 s au minuteur : rien n'est noté (démarrage par erreur). */
export const SEUIL_MINUTEUR_MS = 30_000;
/** Un minuteur oublié ne compte pas plus de 12 h d'affilée. */
export const MAX_MINUTEUR_MS = 12 * 3_600_000;

export const tempsVivants = (t: Tache): EntreeTemps[] => Object.values(t.temps ?? {}).filter(e => !e.supprime).sort((a, b) => a.jour.localeCompare(b.jour) || a.id.localeCompare(b.id));
export const tempsPasse = (t: Tache, qui?: Auteur): number => tempsVivants(t).filter(e => !qui || e.auteur === qui).reduce((n, e) => n + e.minutes, 0);

/** « 1 h 05 », « 45 min ». */
export function dureeLisible(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** « 01:02:03 » (minuteur en cours). */
export function chronoLisible(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
}

/** Lit « 1h30 », « 1 h 30 », « 90 », « 90 min », « 1,5 h », « 0:45 » en minutes. */
export function lireDuree(texte: string): number | undefined {
  const t = texte.trim().toLowerCase().replace(',', '.');
  if (!t) return undefined;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:eures?)?\s*(\d{1,2})?\s*(?:min)?$/))) return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  if ((m = t.match(/^(\d+)\s*(?:min|minutes?|mn)?$/))) return Number(m[1]);
  return undefined;
}

/** Tâche dont le minuteur de `qui` tourne (la plus récente si deux appareils en ont lancé chacun un). */
export function minuteurActif(d: DonneesTaches, qui: Auteur): { tache: Tache; debut: number } | undefined {
  const champ = CHAMP_CHRONO[qui];
  let r: { tache: Tache; debut: number } | undefined;
  for (const t of tachesVivantes(d)) {
    const v = t[champ];
    if (!v) continue;
    const debut = Date.parse(v);
    if (!r || debut > r.debut) r = { tache: t, debut };
  }
  return r;
}

function changerTache(d: DonneesTaches, t: Tache, champs: Record<string, unknown>, ctx: Contexte, extra?: { temps?: Record<string, EntreeTemps>; evt?: string }): DonneesTaches {
  const h = { ...t.h };
  const suivante: Record<string, unknown> = { ...t };
  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur === undefined) delete suivante[cle];
    else suivante[cle] = valeur;
    h[cle] = horodatage(ctx.maintenant, ctx.auteur, t.h[cle]);
  }
  let r = { ...(suivante as unknown as Tache), h, ...(extra?.temps ? { temps: extra.temps } : {}) };
  if (extra?.evt) r = { ...r, historique: borneHistorique([...r.historique, evenement(ctx, extra.evt)]) };
  return { ...d, taches: { ...d.taches, [t.id]: r } };
}

function nouvelleEntree(ctx: Contexte, jour: string, minutes: number, debut?: string, note?: string): EntreeTemps {
  return {
    id: nouvelId('d', ctx.maintenant, ctx.alea),
    auteur: ctx.auteur,
    jour,
    minutes: Math.min(24 * 60, Math.max(0, Math.round(minutes))),
    ...(debut ? { debut } : {}),
    ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}),
    h: horodatage(ctx.maintenant, ctx.auteur),
  };
}

/** Arrête le minuteur de l'auteur sur cette tâche et note le temps (au moins 1 min, rien sous 30 s). */
export function arreterMinuteur(d: DonneesTaches, tacheId: string, ctx: Contexte): { donnees: DonneesTaches; minutes: number } {
  const t = d.taches[tacheId];
  const champ = CHAMP_CHRONO[ctx.auteur];
  const debutIso = t?.[champ];
  if (!t || !debutIso) return { donnees: d, minutes: 0 };
  const debut = Date.parse(debutIso);
  const duree = Math.min(MAX_MINUTEUR_MS, Math.max(0, ctx.maintenant - debut));
  if (duree < SEUIL_MINUTEUR_MS) return { donnees: changerTache(d, t, { [champ]: undefined }, ctx), minutes: 0 };
  const minutes = Math.max(1, Math.round(duree / 60_000));
  const e = nouvelleEntree(ctx, jourDe(debut), minutes, debutIso);
  return { donnees: changerTache(d, t, { [champ]: undefined }, ctx, { temps: { ...t.temps, [e.id]: e }, evt: `Temps noté : ${dureeLisible(minutes)}` }), minutes };
}

/** Démarre le minuteur sur une tâche ; celui qui tournait ailleurs (même personne) est arrêté et noté. */
export function demarrerMinuteur(d: DonneesTaches, tacheId: string, ctx: Contexte): { donnees: DonneesTaches; arrete?: { tache: Tache; minutes: number } } {
  const t = d.taches[tacheId];
  if (!vivant(t)) throw new ErreurTaches('Tâche introuvable.');
  const champ = CHAMP_CHRONO[ctx.auteur];
  let x = d;
  let arrete: { tache: Tache; minutes: number } | undefined;
  for (const autre of Object.values(d.taches)) {
    if (autre.id === tacheId || !autre[champ]) continue;
    const r = arreterMinuteur(x, autre.id, ctx);
    x = r.donnees;
    if (vivant(autre)) arrete = { tache: autre, minutes: r.minutes };
  }
  if (x.taches[tacheId][champ]) return { donnees: x, ...(arrete ? { arrete } : {}) };
  return { donnees: changerTache(x, x.taches[tacheId], { [champ]: new Date(ctx.maintenant).toISOString() }, ctx), ...(arrete ? { arrete } : {}) };
}

export function ajouterTemps(d: DonneesTaches, tacheId: string, saisie: { jour: string; minutes: number; note?: string }, ctx: Contexte): DonneesTaches {
  const t = d.taches[tacheId];
  if (!vivant(t)) throw new ErreurTaches('Tâche introuvable.');
  if (!Number.isFinite(saisie.minutes) || saisie.minutes <= 0) throw new ErreurTaches('Indiquez une durée (ex. 45 min, 1h30).');
  if (saisie.minutes > 24 * 60) throw new ErreurTaches('Une saisie ne dépasse pas 24 h.');
  const e = nouvelleEntree(ctx, saisie.jour, saisie.minutes, undefined, saisie.note);
  return { ...d, taches: { ...d.taches, [t.id]: { ...t, temps: { ...t.temps, [e.id]: e }, historique: borneHistorique([...t.historique, evenement(ctx, `Temps saisi : ${dureeLisible(e.minutes)}`)]) } } };
}

export function supprimerTemps(d: DonneesTaches, tacheId: string, id: string, ctx: Contexte): DonneesTaches {
  const t = d.taches[tacheId];
  const e = t?.temps[id];
  if (!t || !e) throw new ErreurTaches('Saisie introuvable.');
  if (e.auteur !== ctx.auteur && ctx.auteur !== 'fondateur') throw new ErreurTaches('Vous ne pouvez retirer que votre temps.');
  return { ...d, taches: { ...d.taches, [t.id]: { ...t, temps: { ...t.temps, [id]: { ...e, supprime: true, h: horodatage(ctx.maintenant, ctx.auteur, e.h) } } } } };
}

// ------------------------------------------------------------------ Relevé et export

export type AxeReleve = 'projet' | 'etiquette';

export interface LigneReleve {
  cle: string;
  libelle: string;
  couleur?: string;
  /** Minutes par jour (7 jours, lundi d'abord). */
  jours: number[];
  total: number;
}

export interface Releve {
  debut: string;
  jours: string[];
  lignes: LigneReleve[];
  totalJours: number[];
  total: number;
  /** Tâches avec une estimation : estimé contre réel (tout le temps passé, pas seulement la semaine). */
  estimations: Array<{ tacheId: string; titre: string; estimation: number; reel: number }>;
}

/** Relevé de la semaine commençant `debut` (lundi), par projet ou par étiquette ; `qui` : le temps d'une seule personne. */
export function releveHebdo(d: DonneesTaches, debut: string, axe: AxeReleve, qui?: Auteur): Releve {
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(debut, i));
  const index = new Map(jours.map((j, i) => [j, i]));
  const lignes = new Map<string, LigneReleve>();
  const ligne = (cle: string, libelle: string, couleur?: string) => {
    let l = lignes.get(cle);
    if (!l) lignes.set(cle, (l = { cle, libelle, ...(couleur ? { couleur } : {}), jours: Array(7).fill(0), total: 0 }));
    return l;
  };
  const estimations: Releve['estimations'] = [];
  for (const t of tachesVivantes(d)) {
    for (const e of tempsVivants(t)) {
      if (qui && e.auteur !== qui) continue;
      const i = index.get(e.jour);
      if (i === undefined) continue;
      const cles: Array<[string, string, string?]> =
        axe === 'projet'
          ? [[t.projetId, d.projets[t.projetId]?.nom ?? 'Projet', d.projets[t.projetId]?.couleur]]
          : t.etiquettes.length
            ? t.etiquettes.map(x => [x, `#${x}`] as [string, string])
            : [['~', 'Sans étiquette']];
      for (const [cle, libelle, couleur] of cles) {
        const l = ligne(cle, libelle, couleur);
        l.jours[i] += e.minutes;
        l.total += e.minutes;
      }
    }
    if (t.estimation) {
      const reel = tempsPasse(t, qui);
      if (reel > 0 || t.estimation) estimations.push({ tacheId: t.id, titre: t.titre, estimation: t.estimation, reel });
    }
  }
  const tries = [...lignes.values()].sort((a, b) => b.total - a.total || a.libelle.localeCompare(b.libelle));
  // Par étiquette, une tâche à deux étiquettes compte dans les deux : le total vient des entrées elles-mêmes.
  const totalJours = Array(7).fill(0) as number[];
  for (const t of tachesVivantes(d)) for (const e of tempsVivants(t)) if ((!qui || e.auteur === qui) && index.has(e.jour)) totalJours[index.get(e.jour)!] += e.minutes;
  return {
    debut,
    jours,
    lignes: tries,
    totalJours,
    total: totalJours.reduce((n, m) => n + m, 0),
    estimations: estimations.sort((a, b) => b.reel / b.estimation - a.reel / a.estimation).slice(0, 50),
  };
}

const champCsv = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Export CSV (séparateur « ; », pour Excel en français) des temps entre deux jours inclus. */
export function exporterTempsCsv(d: DonneesTaches, du: string, au: string, noms: Record<Auteur, string>): string {
  const lignes = [['date', 'projet', 'liste', 'tache', 'etiquettes', 'personne', 'minutes', 'heures', 'estimation_minutes', 'note'].join(';')];
  const entrees: Array<[EntreeTemps, Tache]> = [];
  for (const t of tachesVivantes(d)) for (const e of tempsVivants(t)) if (e.jour >= du && e.jour <= au) entrees.push([e, t]);
  entrees.sort((a, b) => a[0].jour.localeCompare(b[0].jour) || a[1].titre.localeCompare(b[1].titre));
  for (const [e, t] of entrees) {
    lignes.push(
      [
        e.jour,
        d.projets[t.projetId]?.nom ?? '',
        d.listes[t.listeId]?.nom ?? '',
        t.titre.slice(0, BORNES.titre),
        t.etiquettes.join(' '),
        noms[e.auteur],
        String(e.minutes),
        (e.minutes / 60).toFixed(2).replace('.', ','),
        t.estimation ? String(t.estimation) : '',
        e.note ?? '',
      ]
        .map(champCsv)
        .join(';'),
    );
  }
  return `﻿${lignes.join('\r\n')}\r\n`;
}
