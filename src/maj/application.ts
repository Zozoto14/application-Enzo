/**
 * Application d'une mise à jour sur l'appareil.
 *
 * Le dossier `maj-active/` du dossier Documents contient, quand une mise à
 * jour est installée : le paquet JavaScript, son manifeste, et parfois un
 * marqueur `en-essai`.
 *
 * Ce marqueur est le filet de sécurité. Le code natif le pose juste avant de
 * charger un paquet mis à jour, et c'est à ce paquet de l'effacer une fois
 * démarré. S'il est encore là au démarrage suivant, c'est que le précédent
 * n'a jamais abouti : la mise à jour est écartée et l'application repart sur
 * le paquet d'origine.
 *
 * Sans ce mécanisme, une mise à jour qui plante au démarrage condamnerait
 * l'application — et il n'y aurait plus de Mac pour reconstruire un binaire.
 */

import { systemeDepuisRnfs, type SystemeFichiers } from '../fichiers/systeme';
import { CLE_PUBLIQUE_MAJ } from './cle-publique';
import {
  ErreurMiseAJour,
  verifierPaquet,
  type Manifeste,
  type ResultatVerification,
} from './manifeste';

export interface EtatMiseAJour {
  /** Version actuellement chargée. 1 pour le paquet d'origine. */
  version: number;
  /** Vrai si une mise à jour est installée par-dessus le paquet d'origine. */
  miseAJourActive: boolean;
  /** Vrai si le démarrage en cours est un essai non encore confirmé. */
  enEssai: boolean;
  notes?: string;
  date?: string;
}

/** Version du paquet livré avec le binaire. */
export const VERSION_ORIGINE = 1;

const NOM_DOSSIER = 'maj-active';
const NOM_PAQUET = 'main.jsbundle';
const NOM_MANIFESTE = 'manifeste.json';
const NOM_MARQUEUR = 'en-essai';

export class GestionnaireMiseAJour {
  private readonly dossier: string;

  constructor(
    private readonly fichiers: SystemeFichiers,
    private readonly clePublique: string = CLE_PUBLIQUE_MAJ,
  ) {
    this.dossier = `${fichiers.dossierDocuments}/${NOM_DOSSIER}`;
  }

  private chemin(nom: string): string {
    return `${this.dossier}/${nom}`;
  }

  private async manifesteInstalle(): Promise<Manifeste | undefined> {
    if (!(await this.fichiers.existe(this.chemin(NOM_MANIFESTE)))) {
      return undefined;
    }
    try {
      return JSON.parse(
        await this.fichiers.lireTexte(this.chemin(NOM_MANIFESTE)),
      ) as Manifeste;
    } catch {
      return undefined;
    }
  }

  async etat(): Promise<EtatMiseAJour> {
    const manifeste = await this.manifesteInstalle();
    const enEssai = await this.fichiers.existe(this.chemin(NOM_MARQUEUR));

    if (!manifeste) {
      return { version: VERSION_ORIGINE, miseAJourActive: false, enEssai };
    }
    return {
      version: manifeste.version,
      miseAJourActive: true,
      enEssai,
      notes: manifeste.notes,
      date: manifeste.date,
    };
  }

  /**
   * Confirme que le démarrage a abouti.
   * À appeler une fois l'application réellement affichée, pas avant : c'est
   * tout l'intérêt du marqueur.
   */
  async confirmerDemarrage(): Promise<void> {
    if (await this.fichiers.existe(this.chemin(NOM_MARQUEUR))) {
      await this.fichiers.supprimer(this.chemin(NOM_MARQUEUR));
    }
  }

  /**
   * Vérifie puis installe un paquet déposé sur l'appareil.
   * Rien n'est écrit tant que la vérification n'a pas abouti.
   */
  async installer(
    cheminPaquet: string,
    cheminManifeste: string,
  ): Promise<ResultatVerification> {
    if (!(await this.fichiers.existe(cheminPaquet))) {
      return { valide: false, motif: 'Paquet introuvable à cet emplacement.' };
    }
    if (!(await this.fichiers.existe(cheminManifeste))) {
      return { valide: false, motif: 'Manifeste introuvable à cet emplacement.' };
    }

    let manifeste: Manifeste;
    try {
      manifeste = JSON.parse(await this.fichiers.lireTexte(cheminManifeste)) as Manifeste;
    } catch {
      return { valide: false, motif: 'Manifeste illisible : ce n’est pas du JSON.' };
    }

    const paquet = await this.fichiers.lireBinaire(cheminPaquet);
    const actuel = await this.etat();
    const verification = verifierPaquet(paquet, manifeste, {
      clePublique: this.clePublique,
      versionInstallee: actuel.version,
    });

    if (!verification.valide) {
      return verification;
    }

    // Le paquet est écrit avant le manifeste : si l'écriture est interrompue,
    // l'absence de manifeste fait retomber sur le paquet d'origine plutôt que
    // de laisser un couple incohérent.
    await this.fichiers.creerDossier(this.dossier);
    await this.fichiers.ecrireBinaire(this.chemin(NOM_PAQUET), paquet);
    await this.fichiers.ecrireTexte(
      this.chemin(NOM_MANIFESTE),
      JSON.stringify(manifeste),
    );

    return { valide: true };
  }

  /** Revient au paquet livré avec le binaire. */
  async revenirAOrigine(): Promise<void> {
    for (const nom of [NOM_PAQUET, NOM_MANIFESTE, NOM_MARQUEUR]) {
      if (await this.fichiers.existe(this.chemin(nom))) {
        await this.fichiers.supprimer(this.chemin(nom));
      }
    }
  }
}

/**
 * Construit le gestionnaire à partir de react-native-fs, s'il est disponible.
 * Renvoie `undefined` sinon : sur un binaire compilé sans ce module, la mise
 * à jour hors Mac est impossible, et l'interface doit le dire.
 */
export function gestionnaireDepuisFs(
  moduleFs: unknown,
): GestionnaireMiseAJour | undefined {
  const systeme = systemeDepuisRnfs(moduleFs);
  return systeme ? new GestionnaireMiseAJour(systeme) : undefined;
}

export type { SystemeFichiers };
export { ErreurMiseAJour };
