/**
 * Récurrence des événements du planning : la RÈGLE est stockée, les
 * occurrences sont CALCULÉES à la demande. Fonctions PURES.
 *
 * Règle (JSON, colonne `recurrence`) :
 *   { "freq": "hebdo", "intervalle": 1, "jours": [2, 4], "jusqua": "2026-12-20", "nombre": null }
 *  - `jours` : jours ISO (1 = lundi … 7 = dimanche), dans le fuseau de l'événement ;
 *  - `intervalle` : toutes les 1 à 4 semaines ;
 *  - fin : `jusqua` (date locale incluse) et/ou `nombre` d'occurrences, sinon sans fin.
 *
 * L'heure murale de la première occurrence (`debut`, dans le fuseau de
 * l'événement) est gardée pour toutes : 20:00 à Paris reste 20:00 à Paris de
 * part et d'autre du changement d'heure. La durée (fin − début) est constante.
 *
 * Chaque occurrence a une CLÉ stable : l'instant UTC (ISO) de son début
 * d'origine. Les exceptions (occurrence déplacée, renommée ou annulée) et les
 * présences s'y rattachent.
 */

import { ajouterJours, dateLocale, ecartJours, instantMural, jourSemaine, lireDate, lundiDe, partiesLocales, texteDate } from './temps.mjs';

export const FREQUENCES = ['hebdo'];
export const NOMBRE_MAX = 200;
/** Garde-fou : jamais plus d'occurrences calculées par appel. */
export const OCCURRENCES_MAX = 1000;
/** Une occurrence ne se déplace pas de plus de 30 jours (au-delà : en créer une autre). */
export const DEPLACEMENT_MAX_MS = 30 * 86_400_000;

/**
 * Règle saisie → règle propre, ou `null` (pas de récurrence). Lève une
 * `Error` lisible si la règle est invalide. `jourDefaut` : jour ISO du début.
 */
export function lireRecurrence(saisie, jourDefaut) {
  if (saisie === null || saisie === undefined || saisie === false) return null;
  if (typeof saisie !== 'object' || Array.isArray(saisie)) throw new Error('Récurrence illisible.');
  const freq = saisie.freq ?? 'hebdo';
  if (!FREQUENCES.includes(freq)) throw new Error('Récurrence : seule la fréquence hebdomadaire est prise en charge.');
  const intervalle = Number(saisie.intervalle ?? 1);
  if (!Number.isInteger(intervalle) || intervalle < 1 || intervalle > 4) throw new Error('Récurrence : toutes les 1 à 4 semaines.');
  const jours = [...new Set(Array.isArray(saisie.jours) && saisie.jours.length ? saisie.jours.map(Number) : [jourDefaut])].sort((a, b) => a - b);
  if (!jours.every(j => Number.isInteger(j) && j >= 1 && j <= 7)) throw new Error('Récurrence : jours de 1 (lundi) à 7 (dimanche).');
  let jusqua = null;
  if (saisie.jusqua) {
    const d = lireDate(saisie.jusqua);
    if (!d) throw new Error('Récurrence : date de fin invalide (AAAA-MM-JJ).');
    jusqua = texteDate(d);
  }
  let nombre = null;
  if (saisie.nombre !== undefined && saisie.nombre !== null && saisie.nombre !== '') {
    nombre = Number(saisie.nombre);
    if (!Number.isInteger(nombre) || nombre < 1 || nombre > NOMBRE_MAX) throw new Error(`Récurrence : 1 à ${NOMBRE_MAX} occurrences.`);
  }
  return { freq, intervalle, jours, jusqua, nombre };
}

/**
 * Occurrences d'un événement qui chevauchent [du, au[ (ms), avant exceptions :
 * `[{ cle, debut, fin }]` (ms ; `cle` : ISO du début d'origine), triées.
 * `evenement` : `{ debut, fin, fuseau, recurrence }` (debut/fin ISO ou ms ;
 * recurrence : objet ou texte JSON).
 */
export function occurrencesBrutes(evenement, du, au) {
  const debut = typeof evenement.debut === 'number' ? evenement.debut : Date.parse(evenement.debut);
  const fin = typeof evenement.fin === 'number' ? evenement.fin : Date.parse(evenement.fin);
  const duree = Math.max(0, fin - debut);
  const regle = typeof evenement.recurrence === 'string' ? JSON.parse(evenement.recurrence) : evenement.recurrence;
  if (!regle) return debut < au && debut + duree > du ? [{ cle: new Date(debut).toISOString(), debut, fin: debut + duree }] : [];

  const fuseau = evenement.fuseau || 'UTC';
  const local = partiesLocales(fuseau, debut);
  const minutes = local.heure * 60 + local.minute;
  const date0 = dateLocale(fuseau, debut);
  const ancre = lundiDe(date0);
  const fin_ = regle.jusqua ? lireDate(regle.jusqua) : undefined;
  const pas = 7 * regle.intervalle;

  // Sans limite en nombre, on saute directement aux semaines utiles.
  let semaine = 0;
  if (!regle.nombre) {
    const depart = dateLocale(fuseau, du - duree - 2 * 86_400_000);
    const ecart = ecartJours(ancre, depart);
    if (ecart > 0) semaine = Math.floor(ecart / pas) * pas;
  }
  const sortie = [];
  let compte = 0;
  for (let tours = 0; tours < 2000; tours++, semaine += pas) {
    for (const j of regle.jours) {
      const date = ajouterJours(ancre, semaine + j - 1);
      if (ecartJours(date0, date) < 0) continue;
      if (fin_ && ecartJours(fin_, date) > 0) return sortie;
      compte++;
      if (regle.nombre && compte > regle.nombre) return sortie;
      const t = instantMural(fuseau, date, minutes);
      if (t >= au) return sortie;
      if (t + duree > du) {
        sortie.push({ cle: new Date(t).toISOString(), debut: t, fin: t + duree });
        if (sortie.length >= OCCURRENCES_MAX) return sortie;
      }
    }
  }
  return sortie;
}

/**
 * Occurrences effectives sur [du, au[ : exceptions appliquées (annulée →
 * retirée ; déplacée → nouvelles dates ; titre, description, lieu remplacés).
 * `exceptions` : Map cle → `{ annulee, titre, description, debut, fin, lieu, convocation }`.
 */
export function occurrences(evenement, du, au, exceptions = new Map()) {
  const marge = DEPLACEMENT_MAX_MS + 86_400_000;
  const sortie = [];
  for (const o of occurrencesBrutes(evenement, du - marge, au + marge)) {
    const x = exceptions.get(o.cle);
    if (x && Number(x.annulee) === 1) continue;
    const debut = x?.debut ? Date.parse(x.debut) : o.debut;
    const fin = x?.fin ? Date.parse(x.fin) : o.fin;
    if (!(debut < au && fin > du)) continue;
    sortie.push({
      cle: o.cle,
      debut,
      fin,
      modifiee: Boolean(x),
      titre: x?.titre ?? null,
      description: x?.description ?? null,
      lieu: x?.lieu ?? null,
      // Convocation propre à cette date (JSON), sinon celle de la série.
      convocation: x?.convocation ?? null,
    });
  }
  return sortie.sort((a, b) => a.debut - b.debut);
}

/** La clé désigne-t-elle bien une occurrence (d'origine) de l'événement ? */
export function estOccurrence(evenement, cle) {
  const t = Date.parse(cle);
  if (Number.isNaN(t)) return false;
  return occurrencesBrutes(evenement, t, t + 1).some(o => o.cle === new Date(t).toISOString());
}

/** Veille locale d'une occurrence (pour couper une série « à partir de celle-ci »). */
export function veilleLocale(fuseau, ms) {
  return texteDate(ajouterJours(dateLocale(fuseau, ms), -1));
}

export { jourSemaine };
