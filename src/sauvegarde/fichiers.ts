/**
 * Écriture et lecture des sauvegardes sur le disque.
 *
 * Une archive complète est trop volumineuse pour se coller à la main : elle
 * passe donc par un fichier, déposé dans le dossier Documents de
 * l'application. De là, iOS permet de le partager, l'envoyer, ou le laisser
 * synchroniser par Syncthing.
 *
 * Le nom porte la date, et les sauvegardes s'accumulent au lieu de s'écraser.
 * Une sauvegarde unique qui se réécrit à chaque export ne protège de rien :
 * si la dernière est corrompue ou vide, il ne reste plus rien derrière.
 */

import type { SystemeFichiers } from '../fichiers/systeme';
import type { Archive } from './archive';
import { decrireArchive } from './archive';

export const DOSSIER_SAUVEGARDES = 'sauvegardes';
const PREFIXE = 'applibourse-';
const EXTENSION = '.sauvegarde.json';

export class ErreurFichierSauvegarde extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurFichierSauvegarde';
  }
}

export interface SauvegardeSurDisque {
  nom: string;
  chemin: string;
  /** En-tête lisible, sans déchiffrement. */
  description: string;
  date: string;
}

function dossier(fichiers: SystemeFichiers): string {
  return `${fichiers.dossierDocuments}/${DOSSIER_SAUVEGARDES}`;
}

/** Nom de fichier d'une sauvegarde, horodaté pour rester unique et triable. */
export function nomDeFichier(date: string, suffixe?: string): string {
  const horodatage = date.replace(/[:.]/g, '-');
  return `${PREFIXE}${horodatage}${suffixe ? `-${suffixe}` : ''}${EXTENSION}`;
}

export async function ecrireSauvegarde(
  fichiers: SystemeFichiers,
  archive: Archive,
  suffixe?: string,
): Promise<SauvegardeSurDisque> {
  const repertoire = dossier(fichiers);
  await fichiers.creerDossier(repertoire);

  const nom = nomDeFichier(archive.date, suffixe);
  const chemin = `${repertoire}/${nom}`;
  await fichiers.ecrireTexte(chemin, JSON.stringify(archive, null, 2));

  return {
    nom,
    chemin,
    description: decrireArchive(archive),
    date: archive.date,
  };
}

/**
 * Liste les sauvegardes présentes, de la plus récente à la plus ancienne.
 * Une sauvegarde illisible est signalée dans sa description plutôt qu'omise :
 * la voir est le seul moyen de savoir qu'elle est à remplacer.
 */
export async function listerSauvegardes(
  fichiers: SystemeFichiers,
): Promise<SauvegardeSurDisque[]> {
  const repertoire = dossier(fichiers);
  const noms = (await fichiers.lister(repertoire)).filter(nom =>
    nom.endsWith(EXTENSION),
  );

  const sauvegardes: SauvegardeSurDisque[] = [];
  for (const nom of noms) {
    const chemin = `${repertoire}/${nom}`;
    try {
      const archive = JSON.parse(await fichiers.lireTexte(chemin)) as Archive;
      sauvegardes.push({
        nom,
        chemin,
        description: decrireArchive(archive),
        date: archive.date,
      });
    } catch {
      sauvegardes.push({
        nom,
        chemin,
        description: 'Fichier illisible : cette sauvegarde est à remplacer.',
        date: '',
      });
    }
  }

  return sauvegardes.sort((a, b) => (a.nom < b.nom ? 1 : -1));
}

export async function lireSauvegarde(
  fichiers: SystemeFichiers,
  chemin: string,
): Promise<Archive> {
  if (!(await fichiers.existe(chemin))) {
    throw new ErreurFichierSauvegarde('Fichier de sauvegarde introuvable.');
  }
  try {
    return JSON.parse(await fichiers.lireTexte(chemin)) as Archive;
  } catch {
    throw new ErreurFichierSauvegarde(
      'Fichier de sauvegarde illisible : ce n’est pas du JSON.',
    );
  }
}

export async function supprimerSauvegarde(
  fichiers: SystemeFichiers,
  chemin: string,
): Promise<void> {
  if (await fichiers.existe(chemin)) {
    await fichiers.supprimer(chemin);
  }
}
