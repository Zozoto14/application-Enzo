/**
 * Écriture du rapport sur l'appareil.
 *
 * Le rapport est déposé dans le dossier Documents de l'application, qu'iOS
 * expose dans Fichiers quand `UIFileSharingEnabled` est posé (session Mac,
 * étape 4). De là, Safari l'ouvre, et la feuille de partage l'imprime en PDF.
 *
 * Ce détour vaut mieux qu'un module natif d'impression de plus : le chemin est
 * plus long d'un geste, mais il ne coûte aucune dépendance, et un document
 * HTML se relit dans dix ans là où un PDF généré par une bibliothèque
 * abandonnée ne se regénère plus.
 */

import type { SystemeFichiers } from '../fichiers/systeme';
import type { Rapport } from './annuel';

export const DOSSIER_RAPPORTS = 'rapports';

function dossier(fichiers: SystemeFichiers): string {
  return `${fichiers.dossierDocuments}/${DOSSIER_RAPPORTS}`;
}

export interface RapportEcrit {
  chemin: string;
  nom: string;
}

/** Écrit le rapport et rend son chemin, pour l'annoncer à l'utilisateur. */
export async function ecrireRapport(
  fichiers: SystemeFichiers,
  rapport: Rapport,
): Promise<RapportEcrit> {
  const repertoire = dossier(fichiers);
  await fichiers.creerDossier(repertoire);

  const chemin = `${repertoire}/${rapport.nom}`;
  // Un rapport porte le nom de son annee : le regenerer remplace l'ancien,
  // ce qui est voulu — deux versions d'un meme rapport fiscal sont un piege.
  await fichiers.ecrireTexte(chemin, rapport.html);

  return { chemin, nom: rapport.nom };
}

/** Rapports déjà écrits, du plus récent au plus ancien. */
export async function listerRapports(
  fichiers: SystemeFichiers,
): Promise<readonly string[]> {
  const repertoire = dossier(fichiers);
  try {
    const noms = await fichiers.lister(repertoire);
    return noms.filter(nom => nom.endsWith('.html')).sort().reverse();
  } catch {
    // Dossier absent : aucun rapport, pas une erreur.
    return [];
  }
}
