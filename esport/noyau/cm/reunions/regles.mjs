/**
 * Réunions de l'équipe CM : règles PURES (sans base). Voir docs/esport/cm-reunions.md.
 *
 *  - disponibilités d'un membre : ses créneaux hebdomadaires (heures murales dans leur fuseau) et ses exceptions
 *    datées (absence, congé : indisponible ; disponible en plus), converties par planning/dispos.mjs ;
 *  - « Trouver un créneau » (`proposerCreneaux`) : les meilleurs créneaux où tous (ou le plus) de participants sont
 *    libres, en tenant compte de leurs disponibilités, de leurs exceptions, de leurs réunions existantes et de leur
 *    fuseau (heures de journée raisonnables DANS LE FUSEAU DE CHACUN) ;
 *  - statut du moment (`statutEffectif`) : statut choisi (non expiré), sinon absent (exception en cours), sinon
 *    « en réunion » (occupé), sinon disponible ;
 *  - découpage d'une plage de rendez-vous en créneaux (`decouperPlage`).
 */

import { couvre, libresDe, union } from '../../planning/dispos.mjs';
import { partiesLocales } from '../../planning/temps.mjs';

export const REPONSES = Object.freeze(['attente', 'accepte', 'peut_etre', 'refuse', 'propose']);
export const STATUTS = Object.freeze(['disponible', 'occupe', 'absent', 'ne_pas_deranger']);
export const LIEUX = Object.freeze(['aucun', 'discord', 'lien', 'lieu']);
export const TYPES_EXCEPTION = Object.freeze(['absence', 'conge', 'disponible']);
export const DUREES_RAPPEL = Object.freeze([5, 10, 15, 30, 60, 120, 1440]);
export const MINUTE = 60_000;
export const JOUR_MS = 86_400_000;
/** Heures « de journée » par défaut d'un membre, dans SON fuseau, quand il n'a saisi aucun créneau. */
export const JOURNEE_DEFAUT = Object.freeze({ debut: 9 * 60, fin: 22 * 60 });

/** Exceptions de la réunion CM → exceptions de planning/dispos.mjs (absence, congé : indisponible). */
export const exceptionsDispo = exceptions =>
  exceptions.map(x => ({ debut: x.debut, fin: x.fin, type: x.type === 'disponible' ? 'disponible' : 'indisponible' }));

/** Intervalles [s, e[ (ms) où le membre est disponible sur [du, au[, ou `null` s'il n'a saisi aucun créneau. */
export function disponibilitesDe({ regles = [], exceptions = [] }, du, au) {
  if (!regles.length && !exceptions.some(x => x.type === 'disponible')) return null;
  return libresDe({ regles, exceptions: exceptionsDispo(exceptions) }, du, au);
}

/** Absences (exceptions absence / congé) en intervalles. */
export const absencesDe = exceptions =>
  union(exceptions.filter(x => x.type !== 'disponible').map(x => ({ s: Date.parse(x.debut), e: Date.parse(x.fin) })));

const chevauche = (liste, s, e) => liste.some(i => i.s < e && i.e > s);

/** Minutes depuis minuit d'un instant dans un fuseau. */
function minutesLocales(fuseau, ms) {
  const l = partiesLocales(fuseau, ms);
  return l.heure * 60 + l.minute;
}

/**
 * État d'un participant sur [s, e[ : 'libre', 'occupe' (réunion existante), 'absent' (absence, congé, ou en dehors
 * de ses créneaux), 'inconnu' (aucun créneau saisi, mais dans ses heures de journée : compté libre, signalé).
 * `p` : `{ compte, fuseau, regles, exceptions, occupes: [{ s, e }] }` ; `cache` : intervalles précalculés.
 */
export function etatParticipant(p, s, e, cache) {
  if (chevauche(cache.absences, s, e)) return 'absent';
  if (chevauche(cache.occupes, s, e)) return 'occupe';
  if (cache.dispos) return couvre(cache.dispos, s, e) ? 'libre' : 'absent';
  // Aucun créneau saisi : journée raisonnable dans son fuseau (pas en pleine nuit chez lui).
  const fuseau = p.fuseau || 'UTC';
  const a = minutesLocales(fuseau, s);
  const b = minutesLocales(fuseau, e - 1) + 1;
  return a >= JOURNEE_DEFAUT.debut && b <= JOURNEE_DEFAUT.fin && b > a ? 'inconnu' : 'absent';
}

/**
 * Meilleurs créneaux pour une réunion de `duree` minutes entre `du` et `au` (ms), par pas de `pas` minutes.
 * `participants` : `[{ compte, fuseau, regles, exceptions, occupes }]` ; `fuseau` : celui de l'organisateur, qui
 * borne la recherche à ses heures `heureMin`–`heureMax` (minutes ; défaut 8:00–22:00).
 * Rend au plus `max` propositions, triées : le plus de participants libres, puis le moins d'inconnus, puis le plus
 * tôt ; deux propositions ne se chevauchent pas. Chaque proposition : `{ debut, fin, libres, inconnus, occupes,
 * absents, n, total, tous }`.
 */
export function proposerCreneaux({ participants, du, au, duree, pas = 30, fuseau = 'UTC', heureMin = 8 * 60, heureMax = 22 * 60, max = 8, maintenant = 0 }) {
  const dureeMs = duree * MINUTE;
  const pasMs = pas * MINUTE;
  const caches = participants.map(p => ({
    p,
    cache: {
      absences: absencesDe(p.exceptions ?? []),
      occupes: union((p.occupes ?? []).map(o => ({ s: o.s, e: o.e }))),
      dispos: disponibilitesDe(p, du - JOUR_MS, au + JOUR_MS),
    },
  }));
  const candidats = [];
  const depart = Math.ceil(Math.max(du, maintenant) / pasMs) * pasMs;
  for (let s = depart; s + dureeMs <= au && candidats.length < 5000; s += pasMs) {
    const e = s + dureeMs;
    const a = minutesLocales(fuseau, s);
    const b = minutesLocales(fuseau, e - 1) + 1;
    if (a < heureMin || b > heureMax || b <= a) continue;
    const r = { debut: s, fin: e, libres: [], inconnus: [], occupes: [], absents: [] };
    for (const { p, cache } of caches) {
      const etat = etatParticipant(p, s, e, cache);
      ({ libre: r.libres, inconnu: r.inconnus, occupe: r.occupes, absent: r.absents })[etat].push(p.compte);
    }
    r.n = r.libres.length + r.inconnus.length;
    r.total = participants.length;
    r.tous = r.n === r.total;
    if (r.n > 0) candidats.push(r);
  }
  candidats.sort((x, y) => y.n - x.n || x.inconnus.length - y.inconnus.length || x.debut - y.debut);
  const choisis = [];
  for (const c of candidats) {
    if (choisis.some(x => x.debut < c.fin && x.fin > c.debut)) continue;
    choisis.push(c);
    if (choisis.length >= max) break;
  }
  return choisis.map(c => ({ ...c, debut: new Date(c.debut).toISOString(), fin: new Date(c.fin).toISOString() }));
}

/**
 * Statut du moment d'un membre : `{ statut, message, auto }`. Choisi (et pas expiré) d'abord ; sinon absent si une
 * absence est en cours, occupé s'il est en réunion, disponible sinon (`auto` : déduit, pas choisi).
 */
export function statutEffectif({ profil, exceptions = [], enReunion = false }, maintenant) {
  const jusqua = profil?.statut_jusqua ? Date.parse(profil.statut_jusqua) : null;
  if (profil?.statut && (!jusqua || jusqua > maintenant)) return { statut: profil.statut, message: profil.message ?? '', jusqua: profil.statut_jusqua ?? null, auto: false };
  if (absencesDe(exceptions).some(i => i.s <= maintenant && i.e > maintenant)) return { statut: 'absent', message: '', jusqua: null, auto: true };
  if (enReunion) return { statut: 'occupe', message: '', jusqua: null, auto: true };
  return { statut: 'disponible', message: '', jusqua: null, auto: true };
}

/** Découpe [debut, fin[ (ms) en créneaux de `duree` minutes consécutifs (au plus `max`). */
export function decouperPlage(debut, fin, duree, max = 60) {
  const sortie = [];
  for (let s = debut; s + duree * MINUTE <= fin && sortie.length < max; s += duree * MINUTE) sortie.push({ debut: s, fin: s + duree * MINUTE });
  return sortie;
}
