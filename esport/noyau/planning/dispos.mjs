/**
 * Disponibilités : intervalles et heatmap créneaux × jours. Fonctions PURES.
 *
 * Données d'un joueur :
 *  - règles récurrentes par jour de la semaine (`jour` ISO, `debut`/`fin` en
 *    « HH:MM » muraux, `type` disponible|indisponible, `fuseau` de saisie) :
 *    une heure murale n'est pas un instant, elle est convertie en UTC date par
 *    date (changement d'heure compris) ;
 *  - exceptions datées (`debut`/`fin` : instants UTC), prioritaires sur les règles.
 *
 * Libre sur [s, e[ : le créneau est entièrement couvert par
 *   ((règles disponibles − règles indisponibles) ∪ exceptions disponibles) − exceptions indisponibles.
 */

import { ajouterJours, dateLocale, instantMural, jourSemaine, lireHeure, texteDate, texteHeure } from './temps.mjs';

export const TYPES_DISPO = ['disponible', 'indisponible'];
export const PAS_AUTORISES = [30, 60];

// ------------------------------------------------------------------ Intervalles [s, e[ en ms

export function union(liste) {
  const tri = liste.filter(i => i.e > i.s).sort((a, b) => a.s - b.s);
  const sortie = [];
  for (const i of tri) {
    const der = sortie[sortie.length - 1];
    if (der && i.s <= der.e) der.e = Math.max(der.e, i.e);
    else sortie.push({ s: i.s, e: i.e });
  }
  return sortie;
}

export function soustraire(a, b) {
  const moins = union(b);
  const sortie = [];
  for (const i of union(a)) {
    let morceaux = [{ s: i.s, e: i.e }];
    for (const m of moins) {
      morceaux = morceaux.flatMap(p => {
        if (m.e <= p.s || m.s >= p.e) return [p];
        const reste = [];
        if (m.s > p.s) reste.push({ s: p.s, e: m.s });
        if (m.e < p.e) reste.push({ s: m.e, e: p.e });
        return reste;
      });
    }
    sortie.push(...morceaux);
  }
  return union(sortie);
}

export const couvre = (intervalles, s, e) => intervalles.some(i => i.s <= s && i.e >= e);

/** Règles → intervalles UTC concrets qui touchent [du, au[. */
export function intervallesRegles(regles, du, au) {
  const sortie = [];
  for (const r of regles) {
    const fuseau = r.fuseau || 'UTC';
    const debut = typeof r.debut === 'number' ? r.debut : lireHeure(r.debut);
    let fin = typeof r.fin === 'number' ? r.fin : lireHeure(r.fin);
    if (debut === undefined || fin === undefined) continue;
    if (fin <= debut) fin += 1440; // créneau qui passe minuit
    const premier = ajouterJours(dateLocale(fuseau, du), -1);
    const dernier = ajouterJours(dateLocale(fuseau, au), 1);
    for (let d = premier; texteDate(d) <= texteDate(dernier); d = ajouterJours(d, 1)) {
      if (jourSemaine(d) !== Number(r.jour)) continue;
      const s = instantMural(fuseau, d, debut);
      const e = instantMural(fuseau, d, fin);
      if (e > du && s < au) sortie.push({ s, e, type: r.type });
    }
  }
  return sortie;
}

/** Intervalles libres d'un joueur sur [du, au[. */
export function libresDe({ regles = [], exceptions = [] }, du, au) {
  const r = intervallesRegles(regles, du, au);
  const x = exceptions.map(e => ({ s: typeof e.debut === 'number' ? e.debut : Date.parse(e.debut), e: typeof e.fin === 'number' ? e.fin : Date.parse(e.fin), type: e.type }));
  const base = soustraire(
    r.filter(i => i.type === 'disponible'),
    r.filter(i => i.type === 'indisponible'),
  );
  const avecExceptions = union([...base, ...x.filter(i => i.type === 'disponible')]);
  return soustraire(avecExceptions, x.filter(i => i.type === 'indisponible'));
}

/**
 * Heatmap d'une semaine, dans le fuseau d'affichage :
 *  - `lundi` : date civile `{ annee, mois, jour }` ; `pas` : 30 ou 60 minutes ;
 *  - `joueurs` : `[{ compte, regles, exceptions }]` ; `seuil` : effectif minimum.
 * Rend `{ jours, creneaux, cellules[jour][creneau] }` ; une cellule vaut
 * `{ debut, fin, n, comptes, atteint }`, ou `null` si l'heure n'existe pas ce
 * jour-là (passage à l'heure d'été).
 */
export function heatmap({ lundi, fuseau, pas = 60, joueurs, seuil }) {
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const creneaux = Array.from({ length: 1440 / pas }, (_, i) => i * pas);
  const du = instantMural(fuseau, jours[0], 0);
  const au = instantMural(fuseau, jours[6], 1440);
  const libres = joueurs.map(j => ({ compte: j.compte, intervalles: libresDe(j, du, au) }));
  const cellules = jours.map(d =>
    creneaux.map(m => {
      const s = instantMural(fuseau, d, m);
      const e = instantMural(fuseau, d, m + pas);
      // Heure qui n'existe pas (02:00 → 03:00 le jour du passage à l'heure d'été).
      if (e <= s || texteDate(dateLocale(fuseau, s)) !== texteDate(d)) return null;
      const comptes = libres.filter(l => couvre(l.intervalles, s, e)).map(l => l.compte);
      return { debut: new Date(s).toISOString(), fin: new Date(e).toISOString(), n: comptes.length, comptes, atteint: comptes.length >= seuil };
    }),
  );
  return { jours: jours.map(texteDate), creneaux: creneaux.map(texteHeure), cellules };
}

/**
 * Plages propices : créneaux CONSÉCUTIFS d'un même jour où l'effectif minimum
 * est libre, fusionnés (pour proposer un événement d'un bloc).
 */
export function plagesPropices(carte) {
  const sortie = [];
  carte.cellules.forEach((ligne, i) => {
    let courante;
    for (const c of ligne) {
      if (c?.atteint) {
        if (courante && courante.fin === c.debut) {
          courante.fin = c.fin;
          courante.n = Math.min(courante.n, c.n);
        } else {
          courante = { jour: carte.jours[i], debut: c.debut, fin: c.fin, n: c.n };
          sortie.push(courante);
        }
      } else courante = undefined;
    }
  });
  return sortie;
}
