/**
 * Ce qui s'exécute à chaque réveil en arrière-plan.
 *
 * iOS accorde une poignée de secondes, à un moment qu'il choisit, et coupe
 * sans prévenir au-delà. Trois règles en découlent, qui expliquent la forme
 * de ce fichier :
 *
 * 1. **Ne rien faire de coûteux pour rien.** Si aucun briefing n'est dû et
 *    qu'aucun seuil n'est surveillé, on rend la main sans toucher au réseau.
 * 2. **Ne jamais échouer bruyamment.** Une panne réseau ou un module absent
 *    donnent un motif, pas une exception : une tâche qui plante est une tâche
 *    qu'iOS réveille de moins en moins.
 * 3. **Marquer comme traité même quand on se tait.** Un briefing silencieux
 *    — la valeur n'a pas bougé — est un briefing fait. Sans cette marque, on
 *    rappellerait les cours à chaque réveil pendant quatre heures.
 *
 * Toutes les dépendances entrent par paramètre : ce module se teste sans
 * téléphone, sans réseau et sans horloge réelle.
 */

import { Decimal } from '../core/money/decimal';
import type { Titre } from '../core/domain/types';
import type { EtatPortefeuille } from '../core/portfolio/engine';
import { alertesDeclenchees, composerBriefing, type SeuilAlerte } from './briefing';
import type { CanalNotifications } from './envoi';
import {
  briefingsDus,
  identifiantBriefing,
  jourDe,
  type Planning,
  type MomentBriefing,
} from './planification';

/** Ce que le réveil relit et réécrit d'une fois sur l'autre. */
export interface EtatPersiste {
  /** Identifiants des briefings déjà traités, envoyés ou volontairement tus. */
  briefingsEnvoyes: readonly string[];
  /** Dernière valeur annoncée, pour mesurer l'évolution. Décimal sérialisé. */
  valeurPrecedente?: string;
  /** Derniers cours connus, pour juger d'un franchissement. */
  coursPrecedents: Readonly<Record<string, string>>;
}

export const ETAT_PERSISTE_VIDE: EtatPersiste = {
  briefingsEnvoyes: [],
  coursPrecedents: {},
};

export interface DependancesReveil {
  maintenant: Date;
  planning: Planning;
  seuils: readonly SeuilAlerte[];
  etatPersiste: EtatPersiste;
  canal: CanalNotifications;
  /** Portefeuille et référentiel, relus à chaud. */
  lirePortefeuille(): Promise<{ etat: EtatPortefeuille; titres: readonly Titre[] }>;
  /** Rafraîchit les cours. Peut échouer : le réveil doit y survivre. */
  rafraichirCours(): Promise<ReadonlyMap<string, Decimal>>;
  /** Persiste le nouvel état. Appelé une seule fois, à la fin. */
  enregistrer(etat: EtatPersiste): Promise<void>;
  toleranceMinutes?: number;
  /** Envoyer le briefing même sans mouvement (ordinateur). */
  toujoursParler?: boolean;
}

export type MotifSilence =
  | 'rien-a-faire'
  | 'canal-indisponible'
  | 'permission-refusee'
  | 'portefeuille-illisible';

export interface ResultatReveil {
  briefingsEnvoyes: string[];
  /** Briefings dus mais sans rien à dire : traités, non envoyés. */
  briefingsTus: string[];
  alertesEnvoyees: string[];
  /** Affichages refusés par le système, avec leur motif. */
  echecs: string[];
  /** Renseigné quand rien n'a été envoyé, pour le journal de diagnostic. */
  motif?: MotifSilence;
  /** Vrai si le rafraîchissement des cours a échoué et qu'on a pris les derniers connus. */
  coursPerimes: boolean;
}

/**
 * Un horaire changé rend son briefing du jour à nouveau possible : sans
 * cela, déplacer le briefing du matin de 10:00 à 11:25 après qu'il est
 * passé ne donne rien avant le lendemain.
 */
export function oublierBriefingsModifies(
  etat: EtatPersiste,
  avant: Planning,
  apres: Planning,
  maintenant: Date,
): EtatPersiste {
  const jour = jourDe(maintenant);
  const aOublier = (['matin', 'soir'] as const)
    .filter(moment => {
      const a = avant[jour];
      const b = apres[jour];
      return (a?.actif ? a[moment] : undefined) !== (b?.actif ? b[moment] : undefined);
    })
    .map(moment => identifiantBriefing(maintenant, moment));
  return aOublier.length === 0
    ? etat
    : { ...etat, briefingsEnvoyes: etat.briefingsEnvoyes.filter(id => !aOublier.includes(id)) };
}

/** Jours de briefings conservés dans l'état persisté. */
const RETENTION_JOURS = 2;

/**
 * Élague les identifiants trop anciens.
 *
 * Sans cela la liste grossit indéfiniment dans les réglages. Deux jours
 * suffisent : au-delà, la tolérance a de toute façon expiré.
 */
export function elaguerEnvoyes(
  identifiants: readonly string[],
  maintenant: Date,
  jours = RETENTION_JOURS,
): string[] {
  const limite = new Date(maintenant.getTime());
  limite.setDate(limite.getDate() - jours);

  return identifiants.filter(identifiant => {
    const correspondance = /(\d{4})-(\d{2})-(\d{2})/.exec(identifiant);
    if (!correspondance) {
      // Un identifiant qu'on ne sait pas dater, on le garde : le perdre
      // ferait renvoyer une notification déjà vue.
      return true;
    }
    const date = new Date(
      Number(correspondance[1]),
      Number(correspondance[2]) - 1,
      Number(correspondance[3]),
    );
    return date >= limite;
  });
}

function dateIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function coursDepuisJson(brut: Readonly<Record<string, string>>): Map<string, Decimal> {
  const cours = new Map<string, Decimal>();
  for (const [titreId, valeur] of Object.entries(brut)) {
    try {
      cours.set(titreId, Decimal.de(valeur));
    } catch {
      // Un cours illisible vaut cours inconnu : on ne juge pas de
      // franchissement sur une valeur qu'on n'a pas su relire.
    }
  }
  return cours;
}

function coursVersJson(cours: ReadonlyMap<string, Decimal>): Record<string, string> {
  const brut: Record<string, string> = {};
  for (const [titreId, valeur] of cours) {
    brut[titreId] = valeur.toString();
  }
  return brut;
}

/**
 * Un tour de réveil complet.
 *
 * Ne lève jamais : toute panne se traduit par un motif et un état persisté
 * cohérent.
 */
export async function executerReveil(
  deps: DependancesReveil,
): Promise<ResultatReveil> {
  const {
    maintenant,
    planning,
    seuils,
    etatPersiste,
    canal,
    toleranceMinutes,
  } = deps;

  const resultat: ResultatReveil = {
    briefingsEnvoyes: [],
    briefingsTus: [],
    alertesEnvoyees: [],
    echecs: [],
    coursPerimes: false,
  };

  const dejaEnvoyes = new Set(etatPersiste.briefingsEnvoyes);
  const dus = briefingsDus(planning, maintenant, { dejaEnvoyes, toleranceMinutes });
  const seuilsActifs = seuils.filter(seuil => seuil.haut || seuil.bas);

  // Règle 1 : rien à faire, on rend la main sans toucher au réseau.
  if (dus.length === 0 && seuilsActifs.length === 0) {
    resultat.motif = 'rien-a-faire';
    return resultat;
  }

  if (!canal.disponible) {
    resultat.motif = 'canal-indisponible';
    return resultat;
  }

  if (!(await canal.demanderPermission())) {
    resultat.motif = 'permission-refusee';
    return resultat;
  }

  let portefeuille: { etat: EtatPortefeuille; titres: readonly Titre[] };
  try {
    portefeuille = await deps.lirePortefeuille();
  } catch {
    resultat.motif = 'portefeuille-illisible';
    return resultat;
  }

  const coursPrecedents = coursDepuisJson(etatPersiste.coursPrecedents);

  let cours: ReadonlyMap<string, Decimal>;
  try {
    cours = await deps.rafraichirCours();
  } catch {
    // Règle 2 : on continue avec les derniers cours connus. Le briefing
    // mesurant l'évolution, une valeur inchangée le rendra muet de lui-même.
    cours = coursPrecedents;
    resultat.coursPerimes = true;
  }

  const date = dateIso(maintenant);
  let valeurPrecedente = etatPersiste.valeurPrecedente
    ? tenterDecimal(etatPersiste.valeurPrecedente)
    : undefined;

  for (const du of dus) {
    const identifiant = identifiantBriefing(maintenant, du.moment as MomentBriefing);
    const briefing = composerBriefing({
      moment: du.moment,
      etat: portefeuille.etat,
      titres: portefeuille.titres,
      cours,
      valeurPrecedente,
      date,
      coursPrecedents,
      toujours: deps.toujoursParler,
    });

    if (!briefing) {
      // Règle 3 : un briefing muet est un briefing fait.
      resultat.briefingsTus.push(identifiant);
      dejaEnvoyes.add(identifiant);
      continue;
    }

    try {
      await canal.afficher({
        identifiant,
        titre: briefing.titre,
        corps: briefing.corps,
      });
      resultat.briefingsEnvoyes.push(identifiant);
      dejaEnvoyes.add(identifiant);
      valeurPrecedente = briefing.valeur;
    } catch (erreur) {
      // L'affichage a échoué : on ne marque rien, le prochain réveil
      // retentera tant que la tolérance court.
      resultat.echecs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }

  // Les alertes sont indépendantes du planning : un franchissement ne se
  // produit pas aux heures qui nous arrangent.
  const alertes = alertesDeclenchees(
    seuilsActifs,
    cours,
    coursPrecedents,
    portefeuille.titres,
    date,
  );

  for (const alerte of alertes) {
    if (dejaEnvoyes.has(alerte.identifiant)) {
      continue;
    }
    try {
      await canal.afficher({
        identifiant: alerte.identifiant,
        titre: alerte.titre,
        corps: alerte.corps,
      });
      resultat.alertesEnvoyees.push(alerte.identifiant);
      dejaEnvoyes.add(alerte.identifiant);
    } catch (erreur) {
      // Idem : sans marque, l'alerte repartira au prochain réveil.
      resultat.echecs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }

  await deps.enregistrer({
    briefingsEnvoyes: elaguerEnvoyes([...dejaEnvoyes], maintenant),
    valeurPrecedente: valeurPrecedente?.toString(),
    // On ne mémorise les cours que s'ils sont frais : écraser les cours
    // précédents par eux-mêmes ferait perdre le point de comparaison.
    coursPrecedents: resultat.coursPerimes
      ? etatPersiste.coursPrecedents
      : coursVersJson(cours),
  });

  return resultat;
}

function tenterDecimal(valeur: string): Decimal | undefined {
  try {
    return Decimal.de(valeur);
  } catch {
    return undefined;
  }
}
