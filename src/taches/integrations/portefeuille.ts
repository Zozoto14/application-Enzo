/**
 * Lien Tâches ↔ Portefeuille (Fondateur seul) : le rappel de versement
 * mensuel (s'il est activé dans le portefeuille) et les dividendes attendus à
 * vérifier deviennent des tâches du projet « Portefeuille ». Le portefeuille
 * ne fait que donner ces deux listes à l'hôte du hub (`ResumePortefeuille.taches`) ;
 * rien n'y est écrit depuis Tâches.
 */

import { ajouterJours } from '../dates';
import type { Voulue } from './commun';

export interface RappelsPortefeuille {
  versement?: { actif: boolean; jour: number; montant: number };
  /** Dividendes attendus (nom de la valeur, jour AAAA-MM-JJ, montant déjà mis en forme). */
  dividendes: ReadonlyArray<{ nom: string; date: string; montant?: string }>;
}

/** Le versement apparaît 3 jours avant son jour ; un dividende, 3 jours avant et jusqu'à 30 jours après sa date. */
export const AVANCE_JOURS = 3;
export const RETARD_DIVIDENDE_JOURS = 30;

const fr = (jour: string) => jour.split('-').reverse().join('/');

export function portefeuilleVoulu(r: RappelsPortefeuille | undefined, aujourdhui: string): Voulue[] {
  if (!r) return [];
  const voulues: Voulue[] = [];
  const v = r.versement;
  if (v?.actif && v.jour >= 1 && v.jour <= 28) {
    const jour = `${aujourdhui.slice(0, 8)}${String(v.jour).padStart(2, '0')}`;
    if (aujourdhui >= ajouterJours(jour, -AVANCE_JOURS)) {
      voulues.push({
        cle: `versement|${aujourdhui.slice(0, 7)}`,
        titre: `Versement mensuel : ${v.montant} €`,
        description: `Prévu le ${fr(jour)}. Le portefeuille propose la répartition qui le rapproche de sa cible.`,
        echeance: { jour },
        etiquettes: ['portefeuille'],
      });
    }
  }
  for (const d of r.dividendes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date > ajouterJours(aujourdhui, AVANCE_JOURS) || d.date < ajouterJours(aujourdhui, -RETARD_DIVIDENDE_JOURS)) continue;
    voulues.push({
      cle: `dividende|${d.nom}|${d.date}`.slice(0, 160),
      titre: `Vérifier le dividende de ${d.nom}`,
      description: `${d.montant ? `≈ ${d.montant}, ` : ''}attendu vers le ${fr(d.date)} (même période que l’an dernier). Vérifiez qu’il est arrivé et notez-le dans le portefeuille.`,
      echeance: { jour: d.date },
      etiquettes: ['dividendes'],
    });
  }
  return voulues.slice(0, 100);
}
