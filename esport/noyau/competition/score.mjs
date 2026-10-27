/**
 * Résultats : règles de score tirées du PROFIL DE JEU de la team et validation d'une saisie. Fonctions
 * PURES (aucune base, aucun réseau) : testées sous Node, réutilisées par le service, les bilans et le
 * résumé publiable.
 *
 * Deux systèmes :
 *  - « série » (deux équipes) : un BO de manches (maps, games). Chaque manche se valide selon le type
 *    de score du profil :
 *      rounds   : rounds pour gagner (13), rounds par mi-temps (12, deux mi-temps), prolongations
 *                 (à égalité à rounds-1 partout, victoire avec `ecart` rounds d'écart, 2 par défaut) ;
 *                 détail par mi-temps et prolongations facultatif, cohérent avec le total ;
 *      points   : points pour gagner (le vainqueur les atteint, le perdant non) ;
 *      manches  : chaque manche est gagnée ou perdue (score facultatif) ; la série se gagne avec
 *                 `manchesGagnantes` manches ;
 *      aucun    : (profil sans système de score) scores libres, le plus grand gagne.
 *    La série se gagne avec ⌊BO/2⌋+1 manches ; aucune manche après la décision ; BO pair : nul possible.
 *  - « classement » (format à plus de deux équipes, ou score de type placement) : une ou plusieurs
 *    manches où l'équipe finit à une place (points donnés, ou tirés du barème du profil) ; classement
 *    des autres équipes facultatif. Place finale : saisie, ou calculée (une seule manche ; ou classement
 *    complet de chaque manche → total des points).
 *
 * Une saisie invalide lève 400 `score-invalide` avec `details: { chemin, raison }` (raisons stables,
 * traduites par l'app).
 */

import { echec, texteNettoye } from '../outils.mjs';

export const SYSTEMES = ['serie', 'classement'];
export const ISSUES = ['victoire', 'defaite', 'nul'];
export const BO_DEFAUT = [1, 2, 3, 5, 7];
export const MAX_MANCHES = 20;
export const MAX_EQUIPES = 64;
const MAX_ROUNDS = 200;
const MAX_POINTS = 1_000_000;

export class ScoreInvalide extends Error {
  constructor(chemin, raison) {
    super(`${chemin} : ${raison}`);
    this.chemin = chemin;
    this.raison = raison;
  }
}

/** Erreur HTTP d'une saisie invalide. */
export function erreurScore(e) {
  const err = echec(400, 'score-invalide', 'Score invalide.');
  err.details = { chemin: e.chemin, raison: e.raison };
  return err;
}

const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function entier(v, chemin, min, max, { facultatif = false } = {}) {
  if (facultatif && (v === undefined || v === null || v === '')) return null;
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new ScoreInvalide(chemin, 'nombre');
  return n;
}

function paire(v, chemin, max) {
  if (!Array.isArray(v) || v.length !== 2) throw new ScoreInvalide(chemin, 'paire');
  return [entier(v[0], `${chemin}.0`, 0, max), entier(v[1], `${chemin}.1`, 0, max)];
}

const issueDe = (a, b) => (a > b ? 'victoire' : a < b ? 'defaite' : 'nul');

// ------------------------------------------------------------------ Règles du profil

/**
 * Règle de score d'un match pour le profil `donnees` (validé par jeux/schema.mjs) et le format choisi.
 * `systeme` : seulement si le profil n'a ni format ni score (« Autre jeu ») ; sinon il est déduit.
 * Rend `{ systeme, format, score, boPermis, equipes, joueursMax }`. Format inconnu : 400.
 */
export function regleDuProfil(donnees, formatCle, systemeDemande) {
  const formats = Array.isArray(donnees?.formats) ? donnees.formats : [];
  let format = null;
  if (formatCle !== undefined && formatCle !== null && formatCle !== '') {
    format = formats.find(f => f.cle === formatCle) ?? null;
    if (!format) throw new ScoreInvalide('formatCle', 'format');
  } else format = formats[0] ?? null;
  const score = estObjet(donnees?.score) ? donnees.score : null;
  let systeme;
  if (format && format.equipes > 2) systeme = 'classement';
  else if (score?.type === 'placement') systeme = 'classement';
  else if (format || score) systeme = 'serie';
  else systeme = systemeDemande === 'classement' ? 'classement' : 'serie';
  const bareme = Array.isArray(score?.bareme) ? score.bareme : [];
  const equipes = format?.equipes > 2 ? format.equipes : systeme === 'classement' ? (bareme.length ? Math.max(...bareme.map(b => b.place)) : null) : 2;
  const remplacants = Number.isInteger(donnees?.roster?.remplacants) ? donnees.roster.remplacants : 0;
  const parEquipe = format?.joueursParEquipe ?? donnees?.roster?.titulaires ?? null;
  return {
    systeme,
    format,
    score,
    boPermis: format?.bo?.length ? format.bo : BO_DEFAUT,
    equipes,
    joueursMax: parEquipe ? Math.min(30, parEquipe + remplacants) : 12,
  };
}

/** BO d'une série : celui demandé (permis par le format), sinon le premier du format (manches : 2M-1). */
export function boDeSerie(regle, bo) {
  if (bo !== undefined && bo !== null && bo !== '') {
    const n = entier(bo, 'bo', 1, MAX_MANCHES);
    if (!regle.boPermis.includes(n)) throw new ScoreInvalide('bo', 'bo');
    return n;
  }
  if (regle.score?.type === 'manches' && regle.score.manchesGagnantes) {
    const n = 2 * regle.score.manchesGagnantes - 1;
    if (regle.boPermis.includes(n)) return n;
  }
  return regle.boPermis[0] ?? 1;
}

/** Manches à gagner pour remporter la série. */
export const manchesPourGagner = (regle, bo) => (regle.score?.type === 'manches' && regle.score.manchesGagnantes ? regle.score.manchesGagnantes : Math.floor(bo / 2) + 1);

// ------------------------------------------------------------------ Une manche (série)

/**
 * Manche jouée au score en rounds. `m` : { nous, eux } et/ou { miTemps: [[n, e], [n, e]],
 * prolongations: [n, e] }. Rend `{ nous, eux, issue, detail }`.
 */
export function validerRounds(m, score, chemin = 'manche') {
  const RG = score.roundsGagnants;
  const RPM = score.roundsParMiTemps ?? null;
  const OT = Boolean(score.prolongations?.active);
  const E = score.prolongations?.ecart ?? 2;
  const detail = {};
  let nous;
  let eux;
  let reg = null;
  let ot = [0, 0];
  if (m.miTemps !== undefined && m.miTemps !== null) {
    if (!Array.isArray(m.miTemps) || m.miTemps.length < 1 || m.miTemps.length > 2) throw new ScoreInvalide(`${chemin}.miTemps`, 'mi-temps');
    const halves = m.miTemps.map((h, i) => paire(h, `${chemin}.miTemps.${i}`, MAX_ROUNDS));
    if (RPM) {
      halves.forEach((h, i) => {
        if (h[0] + h[1] > RPM) throw new ScoreInvalide(`${chemin}.miTemps.${i}`, 'mi-temps-trop');
      });
      if (halves[1] && halves[1][0] + halves[1][1] > 0 && halves[0][0] + halves[0][1] !== RPM) throw new ScoreInvalide(`${chemin}.miTemps.0`, 'mi-temps-incomplete');
    }
    reg = [halves.reduce((s, h) => s + h[0], 0), halves.reduce((s, h) => s + h[1], 0)];
    detail.miTemps = halves;
  }
  if (m.prolongations !== undefined && m.prolongations !== null) {
    ot = paire(m.prolongations, `${chemin}.prolongations`, MAX_ROUNDS);
    if (ot[0] + ot[1] > 0) {
      if (!OT) throw new ScoreInvalide(`${chemin}.prolongations`, 'prolongations-absentes');
      detail.prolongations = ot;
    }
  }
  if (reg) {
    nous = reg[0] + ot[0];
    eux = reg[1] + ot[1];
    if ((m.nous !== undefined && m.nous !== null && m.nous !== '' && entier(m.nous, `${chemin}.nous`, 0, MAX_ROUNDS) !== nous) || (m.eux !== undefined && m.eux !== null && m.eux !== '' && entier(m.eux, `${chemin}.eux`, 0, MAX_ROUNDS) !== eux)) {
      throw new ScoreInvalide(`${chemin}.nous`, 'total-incoherent');
    }
  } else {
    nous = entier(m.nous, `${chemin}.nous`, 0, MAX_ROUNDS);
    eux = entier(m.eux, `${chemin}.eux`, 0, MAX_ROUNDS);
    if (ot[0] + ot[1] > 0) reg = [nous - ot[0], eux - ot[1]];
  }
  const w = Math.max(nous, eux);
  const l = Math.min(nous, eux);
  if (nous === eux) {
    // Égalité : seulement sans prolongations, quand toutes les mi-temps sont jouées et que personne n'a gagné.
    if (!OT && RPM && nous + eux === 2 * RPM && nous < RG) return { nous, eux, issue: 'nul', detail };
    throw new ScoreInvalide(chemin, 'egalite');
  }
  if (w < RG) throw new ScoreInvalide(chemin, 'rounds-insuffisants');
  const prolongation = OT && l >= RG - 1;
  if (!prolongation) {
    if (ot[0] + ot[1] > 0) throw new ScoreInvalide(`${chemin}.prolongations`, 'prolongations-inutiles');
    if (w !== RG) throw new ScoreInvalide(chemin, 'rounds-trop');
    if (RPM && w + l > 2 * RPM) throw new ScoreInvalide(chemin, 'rounds-trop');
  } else {
    // Prolongations : à (rounds-1) partout, jusqu'à `ecart` rounds d'écart (14-12, 15-13… pour Valorant).
    if (w - l !== E) throw new ScoreInvalide(chemin, 'ecart-prolongations');
    if (reg && (reg[0] !== RG - 1 || reg[1] !== RG - 1)) throw new ScoreInvalide(`${chemin}.miTemps`, 'prolongations-sans-egalite');
    detail.enProlongations = true;
  }
  return { nous, eux, issue: issueDe(nous, eux), detail };
}

/** Manche d'une série selon le type de score du profil. */
export function validerMancheSerie(m, regle, chemin = 'manche') {
  if (!estObjet(m)) throw new ScoreInvalide(chemin, 'objet');
  const type = regle.score?.type;
  if (type === 'rounds' && regle.score.roundsGagnants) return validerRounds(m, regle.score, chemin);
  const aScore = m.nous !== undefined && m.nous !== null && m.nous !== '' && m.eux !== undefined && m.eux !== null && m.eux !== '';
  if (type === 'points') {
    const nous = entier(m.nous, `${chemin}.nous`, 0, MAX_POINTS);
    const eux = entier(m.eux, `${chemin}.eux`, 0, MAX_POINTS);
    const P = regle.score.pointsCible;
    if (P) {
      if (Math.max(nous, eux) < P) throw new ScoreInvalide(chemin, 'points-insuffisants');
      if (Math.min(nous, eux) >= P) throw new ScoreInvalide(chemin, 'points-trop');
    }
    return { nous, eux, issue: issueDe(nous, eux), detail: {} };
  }
  if (type === 'manches' && !aScore) {
    if (!ISSUES.includes(m.issue)) throw new ScoreInvalide(`${chemin}.issue`, 'issue');
    return { nous: null, eux: null, issue: m.issue, detail: {} };
  }
  // Score libre (profil sans système de score, ou manche gagnée avec son score) : le plus grand gagne.
  if (!aScore) {
    if (!ISSUES.includes(m.issue)) throw new ScoreInvalide(`${chemin}.nous`, 'score-requis');
    return { nous: null, eux: null, issue: m.issue, detail: {} };
  }
  const nous = entier(m.nous, `${chemin}.nous`, 0, MAX_POINTS);
  const eux = entier(m.eux, `${chemin}.eux`, 0, MAX_POINTS);
  const issue = issueDe(nous, eux);
  if (m.issue !== undefined && m.issue !== null && m.issue !== issue) throw new ScoreInvalide(`${chemin}.issue`, 'issue-incoherente');
  return { nous, eux, issue, detail: {} };
}

/**
 * Série complète : `manches` (déjà validées : { issue }), `bo`, `forfait` ('pour' | 'contre').
 * Rend `{ issue, nous, eux }` (manches gagnées de part et d'autre).
 */
export function issueSerie(manches, regle, bo, forfait = null) {
  if (forfait === 'pour') return { issue: 'victoire', nous: null, eux: null };
  if (forfait === 'contre') return { issue: 'defaite', nous: null, eux: null };
  if (manches.length === 0) throw new ScoreInvalide('manches', 'manches-requises');
  if (manches.length > bo) throw new ScoreInvalide('manches', 'manches-trop');
  const besoin = manchesPourGagner(regle, bo);
  let nous = 0;
  let eux = 0;
  manches.forEach((m, i) => {
    if (nous >= besoin || eux >= besoin) throw new ScoreInvalide(`manches.${i}`, 'manche-apres-decision');
    if (m.issue === 'victoire') nous++;
    else if (m.issue === 'defaite') eux++;
  });
  if (nous >= besoin) return { issue: 'victoire', nous, eux };
  if (eux >= besoin) return { issue: 'defaite', nous, eux };
  // Personne n'a atteint le nombre de manches : toutes jouées (BO pair, manches nulles) → nul ou au plus grand.
  if (manches.length < bo) throw new ScoreInvalide('manches', 'serie-incomplete');
  return { issue: issueDe(nous, eux), nous, eux };
}

// ------------------------------------------------------------------ Classement (plusieurs équipes)

/** Points d'une place selon le barème du profil (null : pas de barème pour cette place). */
export function pointsDuBareme(regle, place) {
  const b = (regle.score?.bareme ?? []).find(x => x.place === place);
  return b ? b.points : null;
}

/**
 * Manche d'un classement. `m` : { place, points?, classement?: [{ id?, nom, place, points? }] } (autres
 * équipes, facultatif). Rend `{ place, points, classement }`.
 */
export function validerMancheClassement(m, regle, chemin = 'manche') {
  if (!estObjet(m)) throw new ScoreInvalide(chemin, 'objet');
  const max = regle.equipes ?? MAX_EQUIPES;
  const place = entier(m.place, `${chemin}.place`, 1, max);
  let points = entier(m.points, `${chemin}.points`, -MAX_POINTS, MAX_POINTS, { facultatif: true });
  if (points === null) points = pointsDuBareme(regle, place);
  const classement = [];
  if (m.classement !== undefined && m.classement !== null) {
    if (!Array.isArray(m.classement) || m.classement.length > max - 1) throw new ScoreInvalide(`${chemin}.classement`, 'classement');
    const places = new Set([place]);
    m.classement.forEach((x, i) => {
      const c = `${chemin}.classement.${i}`;
      if (!estObjet(x)) throw new ScoreInvalide(c, 'objet');
      const p = entier(x.place, `${c}.place`, 1, max);
      if (places.has(p)) throw new ScoreInvalide(`${c}.place`, 'place-en-double');
      places.add(p);
      let pts = entier(x.points, `${c}.points`, -MAX_POINTS, MAX_POINTS, { facultatif: true });
      if (pts === null) pts = pointsDuBareme(regle, p);
      const nom = texteNettoye(x.nom, 60);
      const id = typeof x.id === 'string' && x.id ? x.id : null;
      if (!nom && !id) throw new ScoreInvalide(`${c}.nom`, 'equipe');
      classement.push({ id, nom, place: p, points: pts });
    });
    classement.sort((a, b) => a.place - b.place);
  }
  return { place, points, classement };
}

/** Clé d'une équipe d'un classement (adversaire connu, sinon nom). */
const cleEquipe = x => x.id ?? `nom:${x.nom.toLowerCase()}`;

/**
 * Classement final d'une série de manches. `placeFinale` saisie (prioritaire) ; sinon une seule
 * manche → sa place ; sinon classement complet et identique de chaque manche → rang au total des
 * points (à égalité, meilleure place moyenne). Rend `{ place, points, participants }`.
 */
export function classementFinal(manches, regle, { placeFinale, participants } = {}) {
  if (manches.length === 0 && (placeFinale === undefined || placeFinale === null || placeFinale === '')) throw new ScoreInvalide('manches', 'manches-requises');
  const totalNous = manches.some(m => m.points !== null) ? manches.reduce((s, m) => s + (m.points ?? 0), 0) : null;
  const nbParticipants = entier(participants, 'participants', 2, 10_000, { facultatif: true });
  if (placeFinale !== undefined && placeFinale !== null && placeFinale !== '') {
    const place = entier(placeFinale, 'placeFinale', 1, nbParticipants ?? 10_000);
    return { place, points: totalNous, participants: nbParticipants };
  }
  if (manches.length === 1) return { place: manches[0].place, points: totalNous, participants: nbParticipants ?? (manches[0].classement.length ? manches[0].classement.length + 1 : null) };
  // Plusieurs manches : il faut le classement complet (mêmes équipes, avec leurs points) de chacune.
  const equipes = manches[0].classement.map(cleEquipe).sort();
  const complet =
    equipes.length > 0 &&
    manches.every(m => m.points !== null && m.classement.length === equipes.length && m.classement.every(x => x.points !== null) && m.classement.map(cleEquipe).sort().join('|') === equipes.join('|'));
  if (!complet) throw new ScoreInvalide('placeFinale', 'place-finale-requise');
  const totaux = new Map([['__nous', { points: totalNous, places: manches.reduce((s, m) => s + m.place, 0) }]]);
  for (const m of manches) {
    for (const x of m.classement) {
      const t = totaux.get(cleEquipe(x)) ?? { points: 0, places: 0 };
      t.points += x.points;
      t.places += x.place;
      totaux.set(cleEquipe(x), t);
    }
  }
  const nous = totaux.get('__nous');
  const devant = [...totaux.entries()].filter(([k, t]) => k !== '__nous' && (t.points > nous.points || (t.points === nous.points && t.places < nous.places))).length;
  return { place: devant + 1, points: totalNous, participants: nbParticipants ?? equipes.length + 1 };
}

// ------------------------------------------------------------------ Saisie complète

/**
 * Valide le score d'un résultat. `saisie` : { bo?, manches: [...], forfait?, placeFinale?, participants? }.
 * Les références (cartes, modes) sont contrôlées par l'appelant. Rend la forme stockée :
 *   { systeme, bo, manches: [{ ...validée }], issue, manchesNous, manchesEux, place, points, participants, forfait }
 * Lève `ScoreInvalide`.
 */
export function calculerScore(regle, saisie) {
  const brutes = saisie?.manches ?? [];
  if (!Array.isArray(brutes) || brutes.length > MAX_MANCHES) throw new ScoreInvalide('manches', 'manches-trop');
  const forfait = saisie?.forfait === 'pour' || saisie?.forfait === 'contre' ? saisie.forfait : null;
  if (saisie?.forfait !== undefined && saisie.forfait !== null && saisie.forfait !== '' && !forfait) throw new ScoreInvalide('forfait', 'forfait');
  if (regle.systeme === 'classement') {
    if (forfait) throw new ScoreInvalide('forfait', 'forfait');
    const bo = entier(saisie?.bo, 'bo', 1, MAX_MANCHES, { facultatif: true });
    if (bo !== null && brutes.length > bo) throw new ScoreInvalide('manches', 'manches-trop');
    const manches = brutes.map((m, i) => validerMancheClassement(m, regle, `manches.${i}`));
    const f = classementFinal(manches, regle, { placeFinale: saisie?.placeFinale, participants: saisie?.participants });
    return { systeme: 'classement', bo, manches, issue: null, manchesNous: null, manchesEux: null, place: f.place, points: f.points, participants: f.participants, forfait: null };
  }
  const bo = boDeSerie(regle, saisie?.bo);
  const manches = forfait ? [] : brutes.map((m, i) => validerMancheSerie(m, regle, `manches.${i}`));
  const s = issueSerie(manches, regle, bo, forfait);
  return { systeme: 'serie', bo, manches, issue: s.issue, manchesNous: s.nous, manchesEux: s.eux, place: null, points: null, participants: null, forfait };
}

/** Score affiché d'un résultat : « 2-1 » (série), « 13-11 » (BO1 en rounds), « 1er · 42 pts » se fait côté texte. */
export function scoreCourt(r) {
  if (r.systeme === 'classement') return r.place ? `#${r.place}` : '';
  if (r.forfait) return r.forfait === 'pour' ? 'FF (W)' : 'FF (L)';
  const m = r.manches ?? [];
  if (r.bo === 1 && m.length === 1 && m[0].nous !== null && m[0].nous !== undefined) return `${m[0].nous}-${m[0].eux}`;
  if (r.manchesNous !== null && r.manchesNous !== undefined) return `${r.manchesNous}-${r.manchesEux}`;
  return '';
}
