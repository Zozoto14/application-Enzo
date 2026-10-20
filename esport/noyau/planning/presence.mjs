/**
 * Présence : statistiques et export CSV. Fonctions PURES.
 *
 *  - réponse (RSVP, donnée à l'avance par le joueur) : oui | non | peut_etre |
 *    sans_reponse, avec, en option, « je serai en retard de X min » ou
 *    « absent : motif » ;
 *  - présence réelle (constatée par le staff) : present | retard | absent |
 *    excuse | inconnu (« non marqué »), avec les minutes de retard et le motif
 *    en option.
 *
 * DÉFINITIONS (affichées telles quelles dans l'app, docs/esport/planning.md) :
 *  - seuls les CONVOQUÉS comptent ; un membre non convoqué venu quand même
 *    (`hors`, ajouté par le staff) est compté à part (`enPlus`), jamais dans les taux ;
 *  - marqués = séances où il était convoqué ET dont la présence est marquée
 *    (présent, en retard, absent ou excusé) ; une séance non marquée n'entre
 *    dans aucun taux ;
 *  - taux de présence = (présents + retards) / marqués ;
 *  - ponctualité = présents / (présents + retards) ;
 *  - série d'absences = absences (absent ou excusé) consécutives, de la plus
 *    récente séance marquée en remontant ; `serieMax` : la plus longue ;
 *  - tendance = taux de la seconde moitié de la période − taux de la première.
 */

import { partiesLocales, deux } from './temps.mjs';

export const RSVP = ['oui', 'non', 'peut_etre', 'sans_reponse'];
export const REELS = ['present', 'absent', 'excuse', 'retard', 'inconnu'];
export const MARQUES_REELLES = ['present', 'retard', 'absent', 'excuse'];
/** Retard : 1 à 600 minutes (annoncé ou constaté). */
export const RETARD_MAX = 600;

function compteur() {
  return {
    evenements: 0,
    marques: 0,
    nonMarques: 0,
    present: 0,
    retard: 0,
    absent: 0,
    excuse: 0,
    enPlus: 0,
    minutesRetard: 0,
    retardsChronometres: 0,
    rsvpOui: 0,
    rsvpPeutEtre: 0,
    rsvpNon: 0,
    rsvpRepondus: 0,
  };
}

function ajouter(c, l) {
  if (l.hors) {
    if (l.reel === 'present' || l.reel === 'retard') c.enPlus++;
    return;
  }
  c.evenements++;
  if (l.rsvp && l.rsvp !== 'sans_reponse') c.rsvpRepondus++;
  if (l.rsvp === 'oui') c.rsvpOui++;
  if (l.rsvp === 'peut_etre') c.rsvpPeutEtre++;
  if (l.rsvp === 'non') c.rsvpNon++;
  if (!MARQUES_REELLES.includes(l.reel)) {
    c.nonMarques++;
    return;
  }
  c.marques++;
  c[l.reel]++;
  if (l.reel === 'retard' && Number.isInteger(l.retardMinutes) && l.retardMinutes > 0) {
    c.minutesRetard += l.retardMinutes;
    c.retardsChronometres++;
  }
}

const tauxDe = c => (c.marques > 0 ? (c.present + c.retard) / c.marques : null);

function finir(c) {
  return {
    ...c,
    taux: tauxDe(c),
    ponctualite: c.present + c.retard > 0 ? c.present / (c.present + c.retard) : null,
    retardMoyen: c.retardsChronometres > 0 ? Math.round(c.minutesRetard / c.retardsChronometres) : null,
    tauxReponse: c.evenements > 0 ? c.rsvpRepondus / c.evenements : null,
  };
}

/** Séries d'absences sur des lignes triées par date : `{ serie, serieMax }` (seules les séances convoquées et marquées comptent). */
export function seriesAbsences(lignes) {
  let serieMax = 0;
  let courante = 0;
  for (const l of lignes) {
    if (l.hors || !MARQUES_REELLES.includes(l.reel)) continue;
    if (l.reel === 'absent' || l.reel === 'excuse') courante++;
    else courante = 0;
    serieMax = Math.max(serieMax, courante);
  }
  return { serie: courante, serieMax };
}

/** Tendance : taux après `milieu` − taux avant (null s'il manque une moitié). */
export function tendance(lignes, milieu) {
  const avant = compteur();
  const apres = compteur();
  for (const l of lignes) ajouter(l.debut < milieu ? avant : apres, l);
  const a = tauxDe(avant);
  const b = tauxDe(apres);
  return a === null || b === null ? null : b - a;
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

/** Compteur fini d'une liste de lignes (fiche d'un joueur, une séance). */
export function compter(lignes) {
  const c = compteur();
  for (const l of lignes) ajouter(c, l);
  return finir(c);
}

/**
 * Statistiques sur des lignes `{ compte, type, debut (ms), rsvp, reel,
 * retardMinutes?, hors? }` (une par membre et par occurrence, triées par
 * date). `milieu` (ms) : pour la tendance. Rend `{ global, joueurs, parType, parPeriode }`.
 */
export function statistiques(lignes, { fuseau = 'UTC', granularite = 'mois', milieu } = {}) {
  const global = compteur();
  const joueurs = new Map();
  const types = new Map();
  const periodes = new Map();
  const parJoueur = new Map();
  const dans = (m, cle) => {
    if (!m.has(cle)) m.set(cle, compteur());
    return m.get(cle);
  };
  for (const l of lignes) {
    ajouter(global, l);
    ajouter(dans(joueurs, l.compte), l);
    if (!parJoueur.has(l.compte)) parJoueur.set(l.compte, []);
    parJoueur.get(l.compte).push(l);
    if (l.hors) continue;
    ajouter(dans(types, l.type), l);
    ajouter(dans(periodes, periodeDe(l.debut, fuseau, granularite)), l);
  }
  return {
    global: finir(global),
    joueurs: [...joueurs].map(([compte, c]) => {
      const siennes = parJoueur.get(compte) ?? [];
      return { compte, ...finir(c), ...seriesAbsences(siennes), tendance: milieu === undefined ? null : tendance(siennes, milieu) };
    }),
    parType: [...types].map(([type, c]) => ({ type, ...finir(c) })),
    parPeriode: [...periodes].sort(([a], [b]) => a.localeCompare(b)).map(([periode, c]) => ({ periode, ...finir(c) })),
  };
}

/** Minutes de retard saisies : entier de 1 à RETARD_MAX, ou null (vide). `undefined` : illisible. */
export function lireMinutes(v) {
  if (v === null || v === '' || v === 0) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > RETARD_MAX) return undefined;
  return n;
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
