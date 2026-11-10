/**
 * Import manuel d'un fichier d'export de sources Tsuzuku (Sources.tsx). À part de gestion.ts : la vérification des
 * sélecteurs CSS charge l'analyseur HTML, inutile au démarrage du hub (docs/performance.md).
 */

import { erreursSelecteurs } from '../moteur/assistant';
import { echec } from '../moteur/erreurs';
import { importerSources, type DefinitionSource } from '../moteur/sources';

export interface ImportSources {
  sources: DefinitionSource[];
  /** Entrées refusées (adresse non publique, sélecteur invalide, illisible). */
  ecartees: number;
  /** Sources déjà présentes (même identifiant), non dupliquées. */
  doublons: number;
}

/**
 * Lit un export (ou un ancien `sources.json`, ou un tableau) : chaque source
 * passe le schéma du moteur (adresse publique) et la compilation de ses
 * sélecteurs ; les doublons (même identifiant qu'une existante) sont ignorés.
 */
export function importerExportSources(texte: string, existantes: readonly DefinitionSource[]): ImportSources {
  let brut: unknown;
  try {
    brut = JSON.parse(String(texte ?? '').trim());
  } catch {
    throw echec('Fichier illisible : ce n’est pas un JSON de sources.', 'configuration', 400);
  }
  const { sources, ecartees } = importerSources(brut);
  const valides = sources.filter(s => erreursSelecteurs(s).length === 0);
  const ids = new Set(existantes.map(s => s.id));
  const nouvelles = valides.filter(s => !ids.has(s.id));
  return { sources: nouvelles, ecartees: ecartees + (sources.length - valides.length), doublons: valides.length - nouvelles.length };
}
