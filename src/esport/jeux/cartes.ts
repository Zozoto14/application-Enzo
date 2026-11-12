/**
 * Maps détaillées d'un profil de jeu (pures, testées) : callouts (polygones nommés), repères (sites,
 * spawns, cashouts, coffres), étages, calibrage de l'échelle, image déposée. Repère : carré de 1000
 * (celui des strats), l'image y est cadrée sans déformation. Clés uniques dans leur liste.
 */

import { calibrer } from '../strats/modeles';
import type { CarteJeu, EchelleCarte, RepereCarte, TypeRepere, ZoneCarte } from './api';
import { cleDe } from './profil';

/** Clé unique dans `prises`, dérivée du nom (« A Main », « a-main-2 »…). */
export function cleUnique(nom: string, prises: Iterable<string>): string {
  const deja = new Set(prises);
  const base = cleDe(nom) || 'element';
  if (!deja.has(base)) return base;
  for (let i = 2; ; i++) {
    const c = `${base.slice(0, 36)}-${i}`;
    if (!deja.has(c)) return c;
  }
}

const arrondi = (n: number) => Math.round(Math.min(1010, Math.max(-10, n)) * 10) / 10;

/** Ajoute un callout (3 sommets au moins, 24 au plus). Rend la map inchangée sinon. */
export function ajouterZone(c: CarteJeu, nom: string, points: number[], couleur?: string): CarteJeu {
  const nomPropre = nom.trim().slice(0, 30);
  if (!nomPropre || points.length < 6 || points.length % 2 !== 0) return c;
  const zones = c.zones ?? [];
  const zone: ZoneCarte = { cle: cleUnique(nomPropre, zones.map(z => z.cle)), nom: nomPropre, points: points.slice(0, 48).map(arrondi), ...(couleur ? { couleur } : {}) };
  return { ...c, zones: [...zones, zone] };
}

export function ajouterRepere(c: CarteJeu, nom: string, type: TypeRepere, x: number, y: number, niveau?: number | null): CarteJeu {
  const nomPropre = nom.trim().slice(0, 30);
  if (!nomPropre) return c;
  const reperes = c.reperes ?? [];
  const r: RepereCarte = { cle: cleUnique(nomPropre, reperes.map(z => z.cle)), nom: nomPropre, type, x: arrondi(x), y: arrondi(y), ...(typeof niveau === 'number' ? { niveau } : {}) };
  return { ...c, reperes: [...reperes, r] };
}

export function ajouterNiveau(c: CarteJeu, nom: string): CarteJeu {
  const nomPropre = nom.trim().slice(0, 30);
  if (!nomPropre) return c;
  const niveaux = c.niveaux ?? [];
  return { ...c, niveaux: [...niveaux, { cle: cleUnique(nomPropre, niveaux.map(n => n.cle)), nom: nomPropre }] };
}

/** Retire un élément (callout, repère, étage) par sa clé ; une liste vide disparaît (champ facultatif). */
export function retirer(c: CarteJeu, liste: 'zones' | 'reperes' | 'niveaux', cle: string): CarteJeu {
  const reste = (c[liste] as Array<{ cle: string }> | undefined)?.filter(e => e.cle !== cle) ?? [];
  const copie = { ...c, [liste]: reste } as CarteJeu;
  if (reste.length === 0) delete copie[liste];
  return copie;
}

/** Renomme un callout ou un repère. */
export function renommer(c: CarteJeu, liste: 'zones' | 'reperes' | 'niveaux', cle: string, nom: string): CarteJeu {
  return { ...c, [liste]: (c[liste] as Array<{ cle: string; nom: string }> | undefined)?.map(e => (e.cle === cle ? { ...e, nom: nom.slice(0, 30) } : e)) } as CarteJeu;
}

/** Calibrage : deux points du repère et la distance réelle (m) ; null si les points ou la distance sont absurdes. */
export function echelleDepuis(points: number[], distance: number): EchelleCarte | null {
  const p = points.slice(0, 4).map(arrondi);
  const e = calibrer(p, distance);
  return e === null ? null : { pxParMetre: e, points: p, distance: Math.round(distance * 1000) / 1000 };
}

export function avecEchelle(c: CarteJeu, e: EchelleCarte | null): CarteJeu {
  const copie = { ...c };
  if (e) copie.echelle = e;
  else delete copie.echelle;
  return copie;
}

export function avecImage(c: CarteJeu, fichier: string | null): CarteJeu {
  const copie = { ...c };
  if (fichier) copie.fichier = fichier;
  else delete copie.fichier;
  return copie;
}
