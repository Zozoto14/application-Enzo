/**
 * Notifications sur l'ordinateur.
 *
 * Sur le téléphone, un réveil en arrière-plan fait tourner `executerReveil`.
 * Sur l'ordinateur, c'est l'application ouverte qui s'en charge, chaque
 * minute : mêmes briefings, mêmes alertes de seuil, affichés par Windows.
 * S'y ajoute une alerte propre au bureau : le portefeuille qui bouge
 * fortement pendant la séance.
 */

import { Decimal } from '../core/money/decimal';
import type { CoursDate } from '../core/performance/serie';
import type { EtatPortefeuille } from '../core/portfolio/engine';
import { valoriserPositions } from '../core/portfolio/valorisation';
import type { SeuilAlerte } from './briefing';
import type { CanalNotifications } from './envoi';
import { ETAT_PERSISTE_VIDE, type EtatPersiste } from './reveil';

export interface PontNotifications {
  notifier(titre: string, corps: string): Promise<boolean>;
}

/** Canal qui passe par le processus principal d'Electron. */
export function canalBureau(pont: PontNotifications): CanalNotifications {
  return {
    disponible: true,
    // Windows ne demande pas d'autorisation à une application installée.
    demanderPermission: async () => true,
    afficher: async notification => {
      const affichee = await pont.notifier(notification.titre, notification.corps);
      if (!affichee) {
        throw new Error('Notifications non prises en charge par le système.');
      }
    },
    annuler: async () => undefined,
  };
}

/** Seuils saisis dans l'écran Alertes, tels qu'enregistrés (texte libre). */
export function seuilsDepuisJson(brut: string | undefined): SeuilAlerte[] {
  let saisis: Record<string, { haut?: string; bas?: string }> = {};
  try {
    saisis = JSON.parse(brut ?? '{}');
  } catch {
    return [];
  }
  const lire = (texte: string | undefined) => {
    if (!texte?.trim()) return undefined;
    try {
      const valeur = Decimal.de(texte.trim().replace(/\s/g, '').replace(',', '.'));
      return valeur.estPositif() ? valeur : undefined;
    } catch {
      return undefined;
    }
  };
  return Object.entries(saisis)
    .map(([titreId, seuil]) => ({ titreId, haut: lire(seuil.haut), bas: lire(seuil.bas) }))
    .filter(seuil => seuil.haut || seuil.bas);
}

export function etatDepuisJson(brut: string | undefined): EtatPersiste {
  try {
    const lu = JSON.parse(brut ?? '') as Partial<EtatPersiste>;
    return {
      briefingsEnvoyes: Array.isArray(lu.briefingsEnvoyes) ? lu.briefingsEnvoyes : [],
      valeurPrecedente: typeof lu.valeurPrecedente === 'string' ? lu.valeurPrecedente : undefined,
      coursPrecedents: lu.coursPrecedents && typeof lu.coursPrecedents === 'object' ? lu.coursPrecedents : {},
    };
  } catch {
    return ETAT_PERSISTE_VIDE;
  }
}

/** Seuil de variation par défaut, en pourcentage de la séance. */
export const SEUIL_VARIATION_DEFAUT = 2;

/** Lit le seuil de variation enregistré ; « 0 » ou vide la désactive. */
export function seuilVariation(brut: string | undefined): number {
  if (brut === undefined) return SEUIL_VARIATION_DEFAUT;
  const valeur = Number(brut.replace(',', '.'));
  return Number.isFinite(valeur) && valeur > 0 ? valeur : 0;
}

/** Variation du portefeuille sur la dernière séance, en % des titres détenus. */
export function variationSeance(
  etat: EtatPortefeuille,
  cours: ReadonlyMap<string, Decimal>,
  historique: ReadonlyMap<string, readonly CoursDate[]>,
): number | undefined {
  const { valorisees } = valoriserPositions(etat.positions, cours);
  let veille = 0;
  let aujourdhui = 0;
  for (const position of valorisees) {
    const serie = historique.get(position.titreId);
    if (!serie || serie.length < 2) continue;
    const precedent = serie[serie.length - 2].cloture.toNumber();
    const dernier = serie[serie.length - 1].cloture.toNumber();
    if (precedent <= 0 || dernier <= 0) continue;
    const valeur = position.valeurMarche.toNumber();
    aujourdhui += valeur;
    veille += valeur * (precedent / dernier);
  }
  return veille > 0 ? (aujourdhui / veille - 1) * 100 : undefined;
}

/**
 * Alerte « forte séance », une fois par jour et par sens : prévenir d'une
 * baisse de 2 % à chaque actualisation de dix secondes serait insupportable.
 */
export function alerteVariation(
  variation: number | undefined,
  seuil: number,
  date: string,
  dejaEnvoyees: ReadonlySet<string>,
): { identifiant: string; titre: string; corps: string } | undefined {
  if (variation === undefined || seuil <= 0 || Math.abs(variation) < seuil) {
    return undefined;
  }
  const sens = variation > 0 ? 'hausse' : 'baisse';
  const identifiant = `variation-${sens}-${date}`;
  if (dejaEnvoyees.has(identifiant)) {
    return undefined;
  }
  const texte = `${variation > 0 ? '+' : ''}${variation.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
  return {
    identifiant,
    titre: sens === 'hausse' ? `Belle séance : ${texte}` : `Séance difficile : ${texte}`,
    corps: `Votre portefeuille ${sens === 'hausse' ? 'progresse' : 'recule'} de ${texte.replace(/^[+-]/, '')} sur la séance.`,
  };
}
