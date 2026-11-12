/**
 * Différences entre deux versions d'un profil de jeu, et changements PROPOSÉS par l'IA (fonctions pures).
 *
 *  - `resumeDifferences(avant, apres)` : par section, les éléments ajoutés, modifiés, retirés (historique) ;
 *  - `normaliserChangements(profil, brut)` : la liste de changements rendue par l'IA (donnée NON FIABLE)
 *    → changements valides, contre le profil courant : section connue, opération cohérente (on ne
 *    modifie ni ne retire un élément absent ; un ajout d'un élément existant devient une modification),
 *    valeur validée par le schéma, sources https publiques, textes bornés ; les changements sans effet
 *    sont retirés ; une seule proposition par élément ;
 *  - `appliquerChangement(donnees, changement)` : applique UN changement accepté (ou lève 409 s'il ne
 *    s'applique plus : élément retiré ou ajouté entre-temps).
 */

import { echec, texteLong } from '../outils.mjs';
import { Invalide, MAX_ELEMENTS, SECTIONS_LISTES, SECTIONS_OBJETS, lireElement, lireObjet, lireSources, reporterChampsLocaux, sansChampsLocaux, validerDonnees } from './schema.mjs';

export const OPERATIONS = ['ajout', 'modification', 'retrait'];
export const CONFIANCES = ['basse', 'moyenne', 'haute'];
export const CHANGEMENTS_MAX = 50;

const pareil = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Résumé des différences : `{ section: { ajouts: [nom], modifications: [nom], retraits: [nom] } | true }`. */
export function resumeDifferences(avant, apres) {
  const resume = {};
  for (const section of SECTIONS_LISTES) {
    const a = new Map((avant?.[section] ?? []).map(e => [e.cle, e]));
    const b = new Map((apres?.[section] ?? []).map(e => [e.cle, e]));
    const ajouts = [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k).nom);
    const retraits = [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k).nom);
    const modifications = [...b.keys()].filter(k => a.has(k) && !pareil(a.get(k), b.get(k))).map(k => b.get(k).nom);
    if (ajouts.length || retraits.length || modifications.length) resume[section] = { ajouts, modifications, retraits };
  }
  for (const section of [...SECTIONS_OBJETS, 'libelles', 'sources']) {
    if (!pareil(avant?.[section] ?? null, apres?.[section] ?? null)) resume[section] = true;
  }
  return resume;
}

/** Libellé court d'un changement pour le journal (« cartes : ajout de Corrode »). */
export function nomElement(section, valeur, cle) {
  if (SECTIONS_OBJETS.includes(section)) return section;
  return valeur?.nom ?? cle ?? '?';
}

/**
 * Changements bruts de l'IA → changements propres `{ section, operation, cle, avant, apres, justification,
 * sources, confiance }` + avertissements. `profil` : données courantes (validées).
 */
export function normaliserChangements(profil, brut) {
  const avertissements = [];
  const liste = Array.isArray(brut) ? brut : Array.isArray(brut?.changements) ? brut.changements : [];
  if (liste.length > CHANGEMENTS_MAX) avertissements.push({ chemin: 'changements', raison: 'trop-elements' });
  const sortie = [];
  const vus = new Set();
  liste.slice(0, CHANGEMENTS_MAX).forEach((c, i) => {
    const chemin = `changements.${i}`;
    try {
      if (!c || typeof c !== 'object') throw new Invalide(chemin, 'objet');
      const section = String(c.section ?? '');
      let operation = String(c.operation ?? '');
      if (!SECTIONS_LISTES.includes(section) && !SECTIONS_OBJETS.includes(section)) throw new Invalide(`${chemin}.section`, 'section');
      if (!OPERATIONS.includes(operation)) throw new Invalide(`${chemin}.operation`, 'operation');
      let cle = null;
      let avant = null;
      let apres = null;
      if (SECTIONS_OBJETS.includes(section)) {
        if (operation !== 'modification') throw new Invalide(`${chemin}.operation`, 'operation');
        avant = profil[section] ?? null;
        apres = lireObjet(section, { ...(avant ?? {}), ...(c.valeur && typeof c.valeur === 'object' ? c.valeur : {}) });
      } else {
        const existants = new Map(profil[section].map(e => [e.cle, e]));
        if (operation === 'retrait') {
          cle = typeof c.cle === 'string' ? c.cle : c.valeur?.cle;
          if (!existants.has(cle)) throw new Invalide(`${chemin}.cle`, 'element-absent');
          avant = existants.get(cle);
        } else {
          // Les champs propres au club (images déposées, calibrages, callouts, capacités) ne viennent jamais de l'IA.
          const brutValeur = c.valeur && typeof c.valeur === 'object' ? sansChampsLocaux(section, { ...c.valeur }) : null;
          if (!brutValeur) throw new Invalide(`${chemin}.valeur`, 'objet');
          if (typeof c.cle === 'string' && !brutValeur.cle) brutValeur.cle = c.cle;
          // On ne modifie qu'un élément qui existe (vérifié avant la valeur : la raison reste claire).
          if (operation === 'modification' && !existants.has(brutValeur.cle)) throw new Invalide(`${chemin}.cle`, 'element-absent');
          // Modification : la valeur proposée complète l'élément existant (champs absents conservés).
          const cleVisee = typeof brutValeur.cle === 'string' ? brutValeur.cle : null;
          const base = operation === 'modification' && cleVisee && existants.has(cleVisee) ? existants.get(cleVisee) : {};
          apres = lireElement(section, { ...base, ...brutValeur }, `${chemin}.valeur`);
          cle = apres.cle;
          if (operation === 'ajout' && existants.has(cle)) operation = 'modification';
          if (operation === 'modification' && !existants.has(cle)) throw new Invalide(`${chemin}.cle`, 'element-absent');
          if (operation === 'ajout' && existants.size >= MAX_ELEMENTS[section]) throw new Invalide(chemin, 'trop-elements');
          avant = existants.get(cle) ?? null;
        }
      }
      if (operation !== 'retrait' && pareil(avant, apres)) return;
      const cleUnique = `${section}:${cle ?? ''}`;
      if (vus.has(cleUnique)) throw new Invalide(chemin, 'doublon');
      vus.add(cleUnique);
      sortie.push({
        section,
        operation,
        cle,
        avant,
        apres,
        justification: texteLong(c.justification, 500),
        sources: lireSources(c.sources, { max: 5 }),
        confiance: CONFIANCES.includes(c.confiance) ? c.confiance : 'moyenne',
      });
    } catch (e) {
      if (!(e instanceof Invalide)) throw e;
      avertissements.push({ chemin: e.chemin, raison: e.raison });
    }
  });
  return { changements: sortie, avertissements };
}

/**
 * Applique un changement (éventuellement corrigé par le Fondateur : `apres`) aux données ; rend les
 * nouvelles données validées. Lève 409 `proposition-obsolete` s'il ne s'applique plus.
 */
export function appliquerChangement(donnees, { section, operation, cle, apres }) {
  const obsolete = () => echec(409, 'proposition-obsolete', 'Ce changement ne s’applique plus : le profil a changé depuis.');
  const d = structuredClone(donnees);
  if (SECTIONS_OBJETS.includes(section)) {
    if (operation !== 'modification') throw obsolete();
    d[section] = apres;
  } else if (SECTIONS_LISTES.includes(section)) {
    const i = d[section].findIndex(e => e.cle === cle);
    if (operation === 'ajout') {
      if (i >= 0) throw obsolete();
      d[section].push(apres);
    } else if (operation === 'modification') {
      if (i < 0) throw obsolete();
      d[section][i] = apres;
    } else {
      if (i < 0) throw obsolete();
      d[section].splice(i, 1);
    }
  } else throw obsolete();
  return validerDonnees(reporterChampsLocaux(donnees, d)).donnees;
}
