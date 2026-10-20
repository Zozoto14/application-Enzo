/**
 * Présence : statistiques et export CSV. Fonctions PURES.
 *
 *  - RSVP (réponse à l'avance, par le joueur) : oui | non | peut_etre | sans_reponse ;
 *  - présence réelle (marquée par le staff) : present | absent | excuse | retard | inconnu.
 *
 * Taux de présence = (présent + en retard) / (marqués − excusés). Un excusé
 * ne compte ni pour ni contre ; un événement non marqué (inconnu) n'entre
 * pas dans le taux. Ponctualité = présent / (présent + en retard).
 */

import { partiesLocales, deux } from './temps.mjs';

export const RSVP = ['oui', 'non', 'peut_etre', 'sans_reponse'];
export const REELS = ['present', 'absent', 'excuse', 'retard', 'inconnu'];

function compteur() {
  return { evenements: 0, marques: 0, present: 0, retard: 0, absent: 0, excuse: 0, rsvpOui: 0, rsvpRepondus: 0 };
}

function ajouter(c, l) {
  c.evenements++;
  if (l.rsvp && l.rsvp !== 'sans_reponse') c.rsvpRepondus++;
  if (l.rsvp === 'oui') c.rsvpOui++;
  if (!l.reel || l.reel === 'inconnu') return;
  c.marques++;
  c[l.reel]++;
}

function finir(c) {
  const comptables = c.marques - c.excuse;
  return {
    ...c,
    taux: comptables > 0 ? (c.present + c.retard) / comptables : null,
    ponctualite: c.present + c.retard > 0 ? c.present / (c.present + c.retard) : null,
    tauxReponse: c.evenements > 0 ? c.rsvpRepondus / c.evenements : null,
  };
}

/** Période d'un instant dans un fuseau : « 2026-10 » (mois) ou « 2026-S43 » (semaine ISO). */
export function periodeDe(ms, fuseau, granularite = 'mois') {
  const l = partiesLocales(fuseau, ms);
  if (granularite !== 'semaine') return `${l.annee}-${deux(l.mois)}`;
  // Semaine ISO : le jeudi de la semaine donne l'année.
  const jeudi = new Date(Date.UTC(l.annee, l.mois - 1, l.jour + 4 - l.jourSemaine));
  const annee = jeudi.getUTCFullYear();
  const semaine = Math.ceil(((jeudi - Date.UTC(annee, 0, 1)) / 86_400_000 + 1) / 7);
  return `${annee}-S${deux(semaine)}`;
}

/**
 * Statistiques sur des lignes `{ compte, type, debut (ms), rsvp, reel }` (une
 * par joueur et par occurrence). Rend `{ global, joueurs, parType, parPeriode }`.
 */
export function statistiques(lignes, { fuseau = 'UTC', granularite = 'mois' } = {}) {
  const global = compteur();
  const joueurs = new Map();
  const types = new Map();
  const periodes = new Map();
  const dans = (m, cle) => {
    if (!m.has(cle)) m.set(cle, compteur());
    return m.get(cle);
  };
  for (const l of lignes) {
    ajouter(global, l);
    ajouter(dans(joueurs, l.compte), l);
    ajouter(dans(types, l.type), l);
    ajouter(dans(periodes, periodeDe(l.debut, fuseau, granularite)), l);
  }
  return {
    global: finir(global),
    joueurs: [...joueurs].map(([compte, c]) => ({ compte, ...finir(c) })),
    parType: [...types].map(([type, c]) => ({ type, ...finir(c) })),
    parPeriode: [...periodes].sort(([a], [b]) => a.localeCompare(b)).map(([periode, c]) => ({ periode, ...finir(c) })),
  };
}

// ------------------------------------------------------------------ CSV

/** Champ CSV : guillemets doublés ; formule neutralisée (=, +, -, @ en tête : injection dans un tableur). */
export function champCsv(valeur) {
  let t = valeur === null || valeur === undefined ? '' : String(valeur);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

/** Texte CSV (séparateur virgule, fin de ligne CRLF, BOM UTF-8 pour les tableurs). */
export function csv(entetes, lignes) {
  return `﻿${[entetes, ...lignes].map(l => l.map(champCsv).join(',')).join('\r\n')}\r\n`;
}
