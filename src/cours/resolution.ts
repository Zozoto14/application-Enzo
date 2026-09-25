/**
 * Retrouver le symbole Yahoo d'une valeur à partir de son ISIN.
 *
 * Un export de courtier donne l'ISIN et le nom, jamais le symbole. Sans
 * symbole, pas de cours ni d'historique : on le cherche donc tout seul, en
 * préférant la cotation à Paris, où vit un PEA. Quand l'ISIN ne donne rien,
 * on tente le nom. Aucun symbole n'est inventé : sans résultat, la valeur
 * reste à régler à la main dans les paramètres.
 */

import type { Titre } from '../core/domain/types';
import { chercherSymboles, type CandidatSymbole } from './symboles';

export type Chercher = (requete: string) => Promise<{ candidats: readonly CandidatSymbole[] }>;

/** Le candidat le plus plausible : Paris d'abord, action ou ETF plutôt qu'option ou fonds. */
export function meilleurCandidat(candidats: readonly CandidatSymbole[]): CandidatSymbole | undefined {
  const utiles = candidats.filter(candidat => !candidat.type || ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(candidat.type));
  return utiles.find(candidat => candidat.paris) ?? utiles[0];
}

export interface ResultatResolution {
  /** Titre → symbole trouvé. */
  trouves: Map<string, string>;
  /** Noms des valeurs restées sans symbole. */
  introuvables: string[];
}

export async function resoudreSymboles(
  titres: readonly Titre[],
  chercher: Chercher = requete => chercherSymboles(requete),
): Promise<ResultatResolution> {
  const trouves = new Map<string, string>();
  const introuvables: string[] = [];

  for (const titre of titres) {
    if (titre.ticker?.trim()) {
      continue;
    }
    let candidat: CandidatSymbole | undefined;
    for (const requete of [titre.isin, titre.nom].filter(Boolean)) {
      try {
        candidat = meilleurCandidat((await chercher(requete)).candidats);
      } catch {
        candidat = undefined;
      }
      if (candidat) {
        break;
      }
    }
    if (candidat) {
      trouves.set(titre.id, candidat.symbole);
    } else {
      introuvables.push(titre.nom);
    }
  }
  return { trouves, introuvables };
}
