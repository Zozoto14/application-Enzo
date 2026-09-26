/**
 * Rappel de versement mensuel : « c'est le 5, vous versez vos 200 € ? »
 *
 * Le rappel part une fois par mois, le jour choisi (ou le premier jour où
 * l'application est ouverte ensuite), à partir de 9 heures. Il propose la
 * répartition qui rapproche le portefeuille de sa cible, sans rien vendre.
 */

import type { AchatConseille } from './objectifs';

export interface ReglageVersement {
  actif: boolean;
  /** Jour du mois, de 1 à 28. */
  jour: number;
  montant: number;
  compteId?: string;
}

export const REGLAGE_VERSEMENT_DEFAUT: ReglageVersement = { actif: false, jour: 5, montant: 200 };

export function reglageVersementDepuisJson(brut: string | undefined): ReglageVersement {
  if (!brut) return REGLAGE_VERSEMENT_DEFAUT;
  try {
    const lu = JSON.parse(brut) as Partial<ReglageVersement>;
    return {
      actif: Boolean(lu.actif),
      jour: Math.min(28, Math.max(1, Math.round(Number(lu.jour) || 5))),
      montant: Number(lu.montant) > 0 ? Number(lu.montant) : 200,
      compteId: typeof lu.compteId === 'string' ? lu.compteId : undefined,
    };
  } catch {
    return REGLAGE_VERSEMENT_DEFAUT;
  }
}

export function identifiantVersement(maintenant: Date): string {
  return `versement-${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}`;
}

/** Le rappel du mois est-il dû maintenant ? */
export function versementDu(reglage: ReglageVersement, maintenant: Date, dejaEnvoyes: ReadonlySet<string>): boolean {
  return (
    reglage.actif &&
    maintenant.getDate() >= reglage.jour &&
    maintenant.getHours() >= 9 &&
    !dejaEnvoyes.has(identifiantVersement(maintenant))
  );
}

const euros = (valeur: number) => `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;

export function messageVersement(
  reglage: ReglageVersement,
  achats: readonly AchatConseille[],
): { titre: string; corps: string } {
  const utiles = achats.filter(achat => achat.montant >= 1).sort((a, b) => b.montant - a.montant).slice(0, 3);
  return {
    titre: `💰 C’est le ${reglage.jour} : vous versez vos ${euros(reglage.montant)} ?`,
    corps: utiles.length
      ? `Pour rester sur votre cible : ${utiles.map(achat => `${achat.nom} +${euros(achat.montant)}`).join(' · ')}.`
      : 'Ouvrez AppliBourse pour saisir le versement du mois.',
  };
}

/** Date du jour au format de saisie, JJ/MM/AAAA. */
export function dateSaisie(iso: string): string {
  return iso.split('-').reverse().join('/');
}
