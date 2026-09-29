/**
 * Système de fichiers de l'application de bureau, pour les sauvegardes.
 *
 * La fenêtre n'a pas accès au disque : elle nomme un fichier de sauvegarde,
 * et le processus principal le range dans « Documents\AppDashboard
 * Sauvegardes ». Les chemins sont donc logiques — « bureau:/sauvegardes/x »
 * — et seul leur dernier segment, le nom, traverse le pont.
 */

import type { SystemeFichiers } from './systeme';

export interface PontSauvegardes {
  dossier(): Promise<string>;
  lister(): Promise<string[]>;
  existe(nom: string): Promise<boolean>;
  lire(nom: string): Promise<string>;
  ecrire(nom: string, contenu: string): Promise<void>;
  supprimer(nom: string): Promise<void>;
  ouvrirDossier?(): Promise<boolean>;
}

export const RACINE_BUREAU = 'bureau:';

function nom(chemin: string): string {
  return chemin.split('/').filter(Boolean).pop() ?? '';
}

export function systemeDepuisBureau(pont: PontSauvegardes | undefined): SystemeFichiers | undefined {
  if (!pont) return undefined;
  // Les sauvegardes sont du JSON : le binaire n'a pas d'usage ici.
  const nonPrisEnCharge = async (): Promise<never> => {
    throw new Error('Fichier binaire non pris en charge pour les sauvegardes.');
  };
  return {
    dossierDocuments: RACINE_BUREAU,
    existe: chemin => pont.existe(nom(chemin)),
    lireTexte: chemin => pont.lire(nom(chemin)),
    lireBinaire: nonPrisEnCharge,
    ecrireTexte: (chemin, contenu) => pont.ecrire(nom(chemin), contenu),
    ecrireBinaire: nonPrisEnCharge,
    supprimer: chemin => pont.supprimer(nom(chemin)),
    // Le dossier existe toujours côté processus principal.
    creerDossier: async () => undefined,
    lister: () => pont.lister(),
  };
}
