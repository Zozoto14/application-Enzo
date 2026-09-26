/**
 * Carnet de thèses : pour chaque valeur, pourquoi on l'a achetée, où l'on
 * vise, et à quel niveau on se promet de tout relire.
 *
 * On écrit sa thèse à froid ; le carnet la ressort au moment où l'émotion
 * pousse à agir — objectif atteint, ou cours qui plonge.
 */

import type { Decimal } from '../../core/money/decimal';

export interface These {
  pourquoi: string;
  /** Ce qui me ferait vendre, en toutes lettres. */
  venteSi: string;
  /** Objectif de cours, dans la devise de cotation. */
  objectif?: number;
  /** Seuil sous lequel je relis ma thèse. */
  revoirSous?: number;
  /** Date d'écriture (ISO) et cours à ce moment-là. */
  ecriteLe: string;
  coursEcriture?: number;
}

export type Carnet = Record<string, These>;

export function carnetDepuisJson(brut: string | undefined): Carnet {
  if (!brut) return {};
  try {
    const valeur: unknown = JSON.parse(brut);
    return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Carnet) : {};
  } catch {
    return {};
  }
}

export type EtatThese = 'objectif-atteint' | 'a-revoir' | 'en-cours' | 'sans-cours';

export interface LigneCarnet {
  titreId: string;
  nom: string;
  these?: These;
  cours?: number;
  etat: EtatThese;
  /** Chemin parcouru vers l'objectif, de 0 à 1, depuis le cours d'écriture. */
  progression?: number;
  /** Variation depuis l'écriture de la thèse, en %. */
  depuisEcriture?: number;
}

export function etatThese(these: These | undefined, cours: number | undefined): EtatThese {
  if (cours === undefined) return 'sans-cours';
  if (these?.objectif && cours >= these.objectif) return 'objectif-atteint';
  if (these?.revoirSous && cours <= these.revoirSous) return 'a-revoir';
  return 'en-cours';
}

export function construireCarnet(
  valeurs: ReadonlyArray<{ titreId: string; nom: string }>,
  carnet: Carnet,
  cours: ReadonlyMap<string, Decimal>,
): LigneCarnet[] {
  return valeurs.map(({ titreId, nom }) => {
    const these = carnet[titreId];
    const actuel = cours.get(titreId)?.toNumber();
    const depart = these?.coursEcriture;
    const progression =
      these?.objectif && depart !== undefined && actuel !== undefined && these.objectif !== depart
        ? Math.max(0, Math.min(1, (actuel - depart) / (these.objectif - depart)))
        : undefined;
    return {
      titreId,
      nom,
      these,
      cours: actuel,
      etat: etatThese(these, actuel),
      progression,
      depuisEcriture: depart && actuel !== undefined ? (actuel / depart - 1) * 100 : undefined,
    };
  });
}

/** Rappels à envoyer : une fois par franchissement et par niveau. */
export function rappelsCarnet(
  lignes: readonly LigneCarnet[],
  dejaEnvoyes: ReadonlySet<string>,
): Array<{ identifiant: string; titre: string; corps: string }> {
  const rappels: Array<{ identifiant: string; titre: string; corps: string }> = [];
  for (const ligne of lignes) {
    if (!ligne.these || ligne.cours === undefined) continue;
    const pourquoi = ligne.these.pourquoi.trim();
    const rappelThese = pourquoi ? `Votre thèse : « ${pourquoi.slice(0, 140)}${pourquoi.length > 140 ? '…' : ''} »` : '';
    if (ligne.etat === 'objectif-atteint') {
      const identifiant = `carnet-objectif-${ligne.titreId}-${ligne.these.objectif}`;
      if (!dejaEnvoyes.has(identifiant)) {
        rappels.push({
          identifiant,
          titre: `🎯 ${ligne.nom} a atteint votre objectif de ${ligne.these.objectif}`,
          corps: `${rappelThese} Est-elle toujours valable, ou est-il temps d’agir ?`.trim(),
        });
      }
    } else if (ligne.etat === 'a-revoir') {
      const identifiant = `carnet-revoir-${ligne.titreId}-${ligne.these.revoirSous}`;
      if (!dejaEnvoyes.has(identifiant)) {
        rappels.push({
          identifiant,
          titre: `⚠️ ${ligne.nom} passe sous ${ligne.these.revoirSous} : relisez votre thèse`,
          corps: `${rappelThese}${ligne.these.venteSi ? ` Vous vendriez si : ${ligne.these.venteSi}` : ''}`.trim(),
        });
      }
    }
  }
  return rappels;
}
