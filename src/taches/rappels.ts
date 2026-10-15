/**
 * Rappels des tâches : à l'échéance ou X minutes / heures / jours avant.
 *
 * Évalués sur l'appareil (pas de serveur) tant que l'app tourne : le hub les
 * réévalue toutes les 30 s. Anti-répétition : chaque rappel a une clé
 * (tâche, échéance, délai) retenue une fois déclenché — il ne repart pas, même
 * si l'évaluation tourne cent fois ; une échéance déplacée donne une nouvelle
 * clé (le rappel repartira pour la nouvelle date). Un rappel manqué de plus de
 * 24 h (appareil éteint) est abandonné plutôt qu'envoyé en retard.
 *
 * Seules les tâches ouvertes rappellent : chez le Fondateur, les siennes et
 * celles de personne ; chez l'ami, celles qui lui sont assignées.
 */

import { heureValide, instantDe } from './dates';
import { estTerminee, pourQui, tachesVivantes, type Auteur, type DonneesTaches } from './modele';

export const TOLERANCE_RAPPEL_MS = 24 * 3_600_000;
const DUREE_MEMOIRE_MS = 40 * 86_400_000;
const MAX_NON_LUS = 50;

export interface AlerteRappel {
  cle: string;
  tacheId: string;
  titre: string;
  texte: string;
  /** Instant du déclenchement (ISO). */
  date: string;
  /** Genre de notification (V2) : échéance, rappel, retard, ami… */
  type?: string;
}

export interface EtatRappels {
  /** Clé → date du déclenchement : jamais deux fois. */
  vus: Record<string, string>;
  nonLus: AlerteRappel[];
  /** Dernière évaluation (ISO) : absente au premier passage sur l'appareil (rien n'est rattrapé). */
  depuis?: string;
  /** Par tâche partagée : dernière trace de l'autre déjà vue (horodatage). */
  autres?: Record<string, string>;
}

export const etatRappelsVide = (): EtatRappels => ({ vus: {}, nonLus: [] });

export function lireEtatRappels(brut: string | null | undefined): EtatRappels {
  try {
    const o = brut ? (JSON.parse(brut) as Partial<EtatRappels>) : {};
    const vus: Record<string, string> = {};
    for (const [c, d] of Object.entries(o.vus && typeof o.vus === 'object' ? o.vus : {})) if (typeof d === 'string' && c.length < 120) vus[c] = d;
    const nonLus = (Array.isArray(o.nonLus) ? o.nonLus : [])
      .filter((a): a is AlerteRappel => Boolean(a) && typeof a.cle === 'string' && typeof a.tacheId === 'string' && typeof a.titre === 'string' && typeof a.texte === 'string' && typeof a.date === 'string')
      .slice(-MAX_NON_LUS);
    const autres: Record<string, string> = {};
    for (const [c, h] of Object.entries(o.autres && typeof o.autres === 'object' ? o.autres : {})) if (typeof h === 'string' && c.length <= 48 && h.length <= 40) autres[c] = h;
    return { vus, nonLus, ...(typeof o.depuis === 'string' ? { depuis: o.depuis } : {}), ...(Object.keys(autres).length ? { autres } : {}) };
  } catch {
    return etatRappelsVide();
  }
}

export function libelleDelai(minutes: number): string {
  if (minutes === 0) return 'À l’échéance';
  if (minutes < 60) return `${minutes} min avant`;
  if (minutes < 1440) return `${minutes / 60 === Math.round(minutes / 60) ? minutes / 60 : (minutes / 60).toFixed(1)} h avant`;
  const j = minutes / 1440;
  return `${Number.isInteger(j) ? j : j.toFixed(1)} j avant`;
}

function texteRappel(minutes: number, heure: string | undefined): string {
  const a = heure && heureValide(heure) ? ` (${heure.replace(':', ' h ')})` : '';
  if (minutes === 0) return `C’est l’échéance${a}`;
  if (minutes < 60) return `Échéance dans ${minutes} min${a}`;
  if (minutes < 1440) return `Échéance dans ${Math.round(minutes / 60)} h${a}`;
  const j = Math.round(minutes / 1440);
  return j === 1 ? `Échéance demain${a}` : `Échéance dans ${j} jours${a}`;
}

/** Rappels dus maintenant pour `qui`, et l'état qui les retient. */
export function evaluerRappels(d: DonneesTaches, etat: EtatRappels, maintenant: number, qui: Auteur): { nouvelles: AlerteRappel[]; etat: EtatRappels } {
  const vus = { ...etat.vus };
  const nouvelles: AlerteRappel[] = [];
  for (const t of tachesVivantes(d)) {
    if (!t.echeance || !t.rappels.length || estTerminee(d, t)) continue;
    // Le Fondateur : ses tâches et celles de personne ; l'ami : seulement celles qui lui sont assignées.
    if (!pourQui(t, qui)) continue;
    const echeance = instantDe(t.echeance.jour, t.echeance.heure);
    for (const m of t.rappels) {
      const declenche = echeance - m * 60_000;
      if (declenche > maintenant || maintenant - declenche > TOLERANCE_RAPPEL_MS) continue;
      const cle = `${t.id}|${t.echeance.jour}T${t.echeance.heure ?? ''}|${m}`;
      if (vus[cle]) continue;
      vus[cle] = new Date(maintenant).toISOString();
      nouvelles.push({ cle, tacheId: t.id, titre: t.titre, texte: texteRappel(m, t.echeance.heure), date: new Date(declenche).toISOString() });
    }
  }
  const limite = new Date(maintenant - DUREE_MEMOIRE_MS).toISOString();
  for (const [c, date] of Object.entries(vus)) if (date < limite) delete vus[c];
  return { nouvelles, etat: { vus, nonLus: [...etat.nonLus, ...nouvelles].slice(-MAX_NON_LUS) } };
}

export const marquerRappelsLus = (etat: EtatRappels): EtatRappels => ({ ...etat, nonLus: [] });
