/**
 * Fournisseur de cours piloté par configuration.
 *
 * Un fournisseur se décrit par un gabarit d'URL et des chemins JSON. Corriger
 * le mapping après avoir vu une vraie réponse ne demande donc pas de toucher
 * au code, ce qui évite de figer dans des fonctions une forme de réponse
 * qu'on n'a jamais observée.
 */

import type {
  CheminJson,
  CoursRecupere,
  DemandeCours,
  EchecCours,
  FournisseurCours,
  OptionsRecuperation,
  ResultatCours,
} from './fournisseur';
import { ErreurFournisseur, lireChemin, versCours } from './fournisseur';

export interface ConfigFournisseur {
  id: string;
  libelle: string;
  /** Vrai tant que le mapping n'a pas été confronté à une vraie réponse. */
  provisoire?: boolean;
  cleRequise: boolean;
  /** Gabarit d'URL ; `{symboles}` et `{cle}` y sont remplacés. */
  urlGabarit: string;
  /** Nombre de symboles par appel. 1 signifie un appel par titre. */
  symbolesParAppel: number;
  separateurSymboles: string;
  /** Chemin vers la liste des cotations ; vide si la racine en est une. */
  cheminListe: CheminJson;
  /** Chemin vers le cours, relatif à chaque élément de la liste. */
  cheminCours: CheminJson;
  /** Chemin vers le symbole, pour rattacher chaque cotation à sa demande. */
  cheminSymbole?: CheminJson;
  /** Chemin vers la date de cotation, si le fournisseur la donne. */
  cheminDate?: CheminJson;
}

function construireUrl(
  config: ConfigFournisseur,
  symboles: readonly string[],
  cle: string | undefined,
): string {
  if (config.cleRequise && !cle) {
    throw new ErreurFournisseur(
      `${config.libelle} exige une clé d'API : renseignez-la dans les réglages.`,
    );
  }
  return config.urlGabarit
    .replace('{symboles}', symboles.map(encodeURIComponent).join(config.separateurSymboles))
    .replace('{cle}', encodeURIComponent(cle ?? ''));
}

function decouperEnLots<T>(elements: readonly T[], taille: number): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < elements.length; i += Math.max(1, taille)) {
    lots.push(elements.slice(i, i + Math.max(1, taille)));
  }
  return lots;
}

/** Normalise une date de cotation, quel que soit le format rendu. */
function versDate(valeur: unknown, defaut: string): string {
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valeur)) {
    return valeur.slice(0, 10);
  }
  if (typeof valeur === 'number' && Number.isFinite(valeur)) {
    // Horodatage en secondes chez la plupart des fournisseurs, en
    // millisecondes chez certains : on tranche sur l'ordre de grandeur.
    const millisecondes = valeur > 1e11 ? valeur : valeur * 1000;
    const date = new Date(millisecondes);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  return defaut;
}

export function fournisseurConfigurable(config: ConfigFournisseur): FournisseurCours {
  return {
    id: config.id,
    libelle: config.libelle,
    provisoire: config.provisoire,
    cleRequise: config.cleRequise,

    async recuperer(
      demandes: readonly DemandeCours[],
      options: OptionsRecuperation = {},
    ): Promise<ResultatCours> {
      const cours: CoursRecupere[] = [];
      const echecs: EchecCours[] = [];
      const aujourdhui = options.aujourdhui ?? new Date().toISOString().slice(0, 10);
      const appeler = options.recuperer ?? fetch;

      for (const lot of decouperEnLots(demandes, config.symbolesParAppel)) {
        const url = construireUrl(
          config,
          lot.map(demande => demande.symbole),
          options.cle,
        );

        let charge: unknown;
        try {
          const reponse = await appeler(url);
          if (!reponse.ok) {
            throw new ErreurFournisseur(
              `réponse ${reponse.status} du fournisseur`,
            );
          }
          charge = await reponse.json();
        } catch (erreur) {
          // Tout le lot échoue, mais les autres lots continuent : une coupure
          // réseau ne doit pas priver de cours les titres déjà récupérés.
          const raison = erreur instanceof Error ? erreur.message : String(erreur);
          for (const demande of lot) {
            echecs.push({ titreId: demande.titreId, symbole: demande.symbole, raison });
          }
          continue;
        }

        const brute = lireChemin(charge, config.cheminListe);
        const elements = Array.isArray(brute) ? brute : [brute];

        for (const demande of lot) {
          const element =
            lot.length === 1
              ? elements[0]
              : elements.find(candidat => {
                  const symbole = config.cheminSymbole
                    ? lireChemin(candidat, config.cheminSymbole)
                    : undefined;
                  return (
                    typeof symbole === 'string' &&
                    symbole.toUpperCase() === demande.symbole.toUpperCase()
                  );
                });

          const valeur = versCours(lireChemin(element, config.cheminCours));
          if (!valeur) {
            echecs.push({
              titreId: demande.titreId,
              symbole: demande.symbole,
              raison: 'cours absent ou illisible dans la réponse',
            });
            continue;
          }

          cours.push({
            titreId: demande.titreId,
            cours: valeur,
            date: config.cheminDate
              ? versDate(lireChemin(element, config.cheminDate), aujourdhui)
              : aujourdhui,
          });
        }
      }

      return { cours, echecs };
    },
  };
}
