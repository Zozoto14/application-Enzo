/**
 * L'IA locale est-elle UTILISABLE sur cet hébergement ?
 *
 * Sur o2switch (journaux du 29/10), le moteur llama-server (binaire externe lancé depuis le dossier personnel) est
 * arrêté de force par l'hébergeur (SIGKILL que nos programmes n'ont pas envoyé) au chargement ou quelques secondes
 * après le début du calcul, sans dépassement de mémoire ni de processeur (LVE : 0 « fault ») : surveillance
 * anti-minage probable. Insister ne sert à rien et bloque les autres moteurs pendant les délais d'attente.
 *
 * Chaque arrêt de force IMPRÉVU (SIGKILL reçu sans qu'aucun de nos processus ne l'ait envoyé) est compté dans
 * etat/hebergement.json, partagé par tous les processus (app, processus de fond, transcription). Au bout de
 * `max` arrêts de suite (IA_LOCALE_TUES_MAX, 2 par défaut), l'IA locale est marquée « indisponible sur cet
 * hébergement » : elle reste dans la configuration et dans les ordres de repli, mais elle est SAUTÉE (le moteur
 * suivant répond), et l'Administration IA l'explique. Une requête réussie remet le compteur à zéro ; pour
 * réessayer après un changement chez l'hébergeur : `rm ~/.appdashboard/ia-locale/etat/hebergement.json` (ou
 * relancer installer-ia-locale.sh, qui l'efface).
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cheminsIaLocale } from './installation.mjs';

export const TUES_MAX_DEFAUT = 2;
const GARDES = 5;

const lire = chemin => {
  try {
    const j = JSON.parse(readFileSync(chemin, 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
};

function ecrire(chemin, objet) {
  const tmp = `${chemin}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(objet), { mode: 0o600 });
  renameSync(tmp, chemin);
}

/**
 * État lu : `{ tues, indisponible, depuis, derniers: [{ le, phase, pid }] }` (tout à zéro si rien n'a été noté).
 * `max` : nombre d'arrêts de force à partir duquel l'IA locale est déclarée indisponible.
 */
export function lireHebergement(dossier, { max = TUES_MAX_DEFAUT } = {}) {
  const j = lire(cheminsIaLocale(dossier).hebergement) ?? {};
  const tues = Number.isInteger(j.tues) && j.tues > 0 ? j.tues : 0;
  const derniers = Array.isArray(j.derniers) ? j.derniers.filter(x => x && typeof x.le === 'string').slice(-GARDES) : [];
  return { tues, max, indisponible: tues >= max, depuis: tues >= max ? (j.depuis ?? derniers[derniers.length - 1]?.le ?? null) : null, derniers };
}

/** Un arrêt de force de plus (`phase` : « pendant le chargement », « PENDANT une requête »…). Rend le nouvel état et `bascule` (vient de devenir indisponible). */
export function noterTueExterne(dossier, { phase = '', pid = null, le = new Date().toISOString(), max = TUES_MAX_DEFAUT } = {}) {
  const c = cheminsIaLocale(dossier);
  const avant = lireHebergement(dossier, { max });
  const tues = avant.tues + 1;
  const derniers = [...avant.derniers, { le, phase: String(phase).slice(0, 60), pid: Number.isInteger(pid) ? pid : null }].slice(-GARDES);
  const indisponible = tues >= max;
  const depuis = indisponible ? (avant.depuis ?? le) : null;
  try {
    mkdirSync(c.etat, { recursive: true, mode: 0o700 });
    ecrire(c.hebergement, { tues, derniers, depuis });
  } catch {
    // Disque plein : l'état n'est pas gardé, la prochaine fois recomptera.
  }
  return { tues, max, indisponible, depuis, derniers, bascule: indisponible && !avant.indisponible };
}

/** Requête réussie : le compteur repart de zéro (rien n'est écrit s'il était déjà à zéro). */
export function reinitialiserHebergement(dossier) {
  const c = cheminsIaLocale(dossier);
  if (!lire(c.hebergement)) return false;
  rmSync(c.hebergement, { force: true });
  return true;
}

/** Explication pour l'app et le journal (sans chemin du serveur). */
export const messageIndisponible = h =>
  `IA locale indisponible sur cet hébergement : son moteur a été arrêté de force (SIGKILL) ${h.tues} fois par l’hébergeur. Elle est sautée dans l’ordre de repli (voir Administration IA).`;
