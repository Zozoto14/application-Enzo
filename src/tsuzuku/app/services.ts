/**
 * Assemblage du moteur pour un profil : réseau de la plateforme, stockage de
 * la base du profil, catalogue, bibliothèque, sources.
 *
 * Une instance par profil ouvert (jamais partagée) : le cache du catalogue et
 * la bibliothèque appartiennent au profil.
 */

import { DepotBibliotheque, type Stockage } from '../moteur/bibliotheque';
import { creerCatalogue, type Catalogue, type OptionsCatalogue } from '../moteur/catalogue';
import { echec } from '../moteur/erreurs';
import { creerClient, type ClientSur } from '../moteur/reseau';
import type { ContexteResolution } from '../moteur/resolution';
import { importerSources, type DefinitionSource } from '../moteur/sources';
import type { ChoixReseau } from '../plateforme/reseau';
import { CLES } from '../plateforme/stockage';
import { ecrireReglages, lireReglages, type ReglagesTsuzuku } from './reglages';

export interface ServicesTsuzuku {
  plateforme: ChoixReseau['plateforme'];
  /** Faux sur le site : pas de lecture de pages tierces (CORS). */
  lectureSources: boolean;
  /** Rang administrateur : sources et import. */
  estAdmin: boolean;
  stockage: Stockage;
  client: ClientSur;
  ctx: ContexteResolution;
  catalogue: Catalogue;
  depot: DepotBibliotheque;
  reglages(): Promise<ReglagesTsuzuku>;
  enregistrerReglages(r: ReglagesTsuzuku): Promise<void>;
  /** Sources actives pour ce profil : les siennes (administrateur) ou la copie de l'administrateur (ami). */
  sources(): Promise<DefinitionSource[]>;
  /** Réservé à l'administrateur : la règle est ici, pas seulement dans l'écran. */
  enregistrerSources(liste: readonly DefinitionSource[]): Promise<void>;
  /** Prévient le processus principal (Electron) qu'un lecteur va être affiché en iframe. */
  declarerLecteur(url: string): Promise<boolean>;
}

export interface OptionsServices {
  choix: Pick<ChoixReseau, 'plateforme' | 'reseau' | 'lectureSources' | 'pont'>;
  stockage: Stockage;
  estAdmin: boolean;
  journal?: (message: string) => void;
  /** Réglages fins du catalogue (horloge, attente) : tests. */
  catalogue?: Partial<OptionsCatalogue>;
}

export function creerServices({ choix, stockage, estAdmin, journal, catalogue }: OptionsServices): ServicesTsuzuku {
  const client = creerClient(choix.reseau);
  const reglages = async () => lireReglages(await stockage.lire(CLES.reglages));
  return {
    plateforme: choix.plateforme,
    lectureSources: choix.lectureSources,
    estAdmin,
    stockage,
    client,
    ctx: { client, journal },
    catalogue: creerCatalogue({ client, cleTmdb: async () => (await reglages()).cleTmdb || null, journal, ...catalogue }),
    depot: new DepotBibliotheque(stockage, CLES.bibliotheque),
    reglages,
    enregistrerReglages: r => stockage.ecrire(CLES.reglages, ecrireReglages(r)),
    async sources() {
      const texte = await stockage.lire(estAdmin ? CLES.sources : CLES.sourcesAdmin);
      if (!texte) {
        return [];
      }
      try {
        return importerSources(JSON.parse(texte)).sources;
      } catch {
        return [];
      }
    },
    async enregistrerSources(liste) {
      if (!estAdmin) {
        throw echec('Les sources sont réservées à l’administrateur.', 'configuration', 403);
      }
      await stockage.ecrire(CLES.sources, JSON.stringify(liste));
    },
    async declarerLecteur(url) {
      try {
        return (await choix.pont?.lecteur?.(url)) ?? true;
      } catch {
        return false;
      }
    },
  };
}
