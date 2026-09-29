/**
 * Fusion automatique entre appareils : le plus récent gagne, et une
 * suppression voyage aussi.
 *
 * La fusion manuelle d'archives (../fusion.ts) garde la version locale et
 * signale le désaccord : c'est juste quand on fusionne à la main, une fois.
 * Ici la synchronisation tourne seule toutes les deux minutes ; un conflit
 * signalé à chaque tour ne serait qu'un bruit. On retient donc, pour chaque
 * entrée, **quand** elle a changé pour la dernière fois, et la version la
 * plus récente l'emporte partout.
 *
 * Personne n'enregistre ces dates au moment de la modification : on les
 * déduit en comparant, à chaque tour, l'état de la base à celui du tour
 * précédent (`connus`). Une entrée qui a changé depuis a été modifiée ici ;
 * une entrée qui a disparu a été supprimée ici, et sa suppression part vers
 * les autres appareils (`supprimes`) pour qu'elle n'y renaisse pas.
 */

import type { PiloteSqlite } from '../../db/pilote';
import {
  ORDRE_ECRITURE,
  VERSION_CHARGE,
  decouper,
  ecrireEntite,
  empreinte,
  estGenreV2,
  estUnion,
  extraireEntites,
  genreConnu,
  supprimerEntite,
  unionVues,
  type Entites,
} from './entites';

/** Au-delà, une suppression est oubliée : tous les appareils l'ont vue. */
export const DUREE_SUPPRESSIONS_JOURS = 365;

export interface InfoAppareil {
  nom: string;
  plateforme: string;
  /** Date d'expiration de la signature (app iPhone installée par AltStore). */
  expireLe?: string;
  /** Dernier dépôt de cet appareil sur le relais. */
  vuLe?: string;
  /** Version du format de charge que cet appareil écrit et comprend (absente : 1, ancien). */
  versionCharge?: number;
}

/**
 * File d'envoi explicite : ce qui a changé ici et n'est pas encore parti
 * sur le relais. Elle se vide seulement quand un envoi a réussi en entier.
 */
export interface EnAttente {
  /** Entrées modifiées ou supprimées ici depuis le dernier envoi réussi. */
  cles: string[];
  /** Date du premier changement non envoyé. */
  depuisLe: string;
  /** Date du premier échec d'envoi de cette file. */
  premierEchec?: string;
  /** Nombre de tours échoués depuis. */
  essais: number;
  motif?: string;
}

export interface EtatSynchro {
  /** Empreinte de chaque entrée au tour précédent. */
  connus: Record<string, string>;
  /** Dernière modification connue de chaque entrée. */
  dates: Record<string, string>;
  /** Suppressions, avec leur date. */
  supprimes: Record<string, string>;
  /** Date du dernier dépôt lu, par appareil. */
  lus: Record<string, string>;
  /** Ce que les autres appareils disent d'eux-mêmes. */
  appareils: Record<string, InfoAppareil>;
  /** Empreinte du dernier envoi, pour ne pas renvoyer la même chose. */
  dernierEnvoi?: string;
  /** Date du dernier dépôt réussi (délai minimal entre deux dépôts). */
  dernierDepotLe?: string;
  /** Dernière réparation de l'index du relais (au plus une par heure). */
  reparationIndexLe?: string;
  /** Empreinte du dernier coffre déposé. */
  coffreEnvoye?: string;
  derniereSynchro?: string;
  /** Changements locaux pas encore envoyés (voir EnAttente). */
  enAttente?: EnAttente;
}

export const etatVide = (): EtatSynchro => ({ connus: {}, dates: {}, supprimes: {}, lus: {}, appareils: {} });

export function etatDepuisJson(brut: string | undefined): EtatSynchro {
  try {
    const lu = brut ? JSON.parse(brut) : {};
    return { ...etatVide(), ...(lu && typeof lu === 'object' ? lu : {}) };
  } catch {
    return etatVide();
  }
}

/** Contenu déchiffré d'un dépôt. */
export interface Charge {
  /** Version du format (absente : charge d'un ancien appareil, six genres). */
  version?: number;
  entites: Entites;
  dates: Record<string, string>;
  supprimes: Record<string, string>;
  appareil: InfoAppareil;
}

const plusRecent = (a: string | undefined, b: string | undefined) => ((a ?? '') >= (b ?? '') ? a : b);

/**
 * Note les changements faits sur cet appareil depuis le tour précédent.
 * Renvoie un nouvel état ; la base n'est pas touchée.
 */
export function noterChangementsLocaux(etat: EtatSynchro, entites: Entites, maintenant: string): EtatSynchro {
  const dates = { ...etat.dates };
  const supprimes = { ...etat.supprimes };
  const connus: Record<string, string> = {};
  const changees = new Set<string>();
  for (const [cle, valeur] of Object.entries(entites)) {
    connus[cle] = empreinte(valeur);
    if (etat.connus[cle] !== connus[cle]) {
      dates[cle] = maintenant;
      delete supprimes[cle];
      changees.add(cle);
    }
  }
  for (const cle of Object.keys(etat.connus)) {
    if (!(cle in entites)) {
      if (estUnion(cle)) {
        // Une version vue ne se « désvoit » jamais : pas de suppression à diffuser.
        delete dates[cle];
        continue;
      }
      supprimes[cle] = maintenant;
      delete dates[cle];
      changees.add(cle);
    }
  }
  const limite = new Date(Date.parse(maintenant) - DUREE_SUPPRESSIONS_JOURS * 86_400_000).toISOString();
  for (const [cle, date] of Object.entries(supprimes)) {
    if (date < limite) {
      delete supprimes[cle];
    }
  }
  let enAttente = etat.enAttente;
  if (changees.size > 0) {
    enAttente = {
      ...(enAttente ?? { depuisLe: maintenant, essais: 0 }),
      cles: [...new Set([...(enAttente?.cles ?? []), ...changees])].sort(),
    };
  }
  return { ...etat, connus, dates, supprimes, enAttente };
}

export interface BilanFusion {
  ajoutes: number;
  modifies: number;
  supprimes: number;
  /** Entrées refusées par la base, avec la raison. */
  echecs: Array<{ cle: string; motif: string }>;
}

/**
 * Applique le dépôt d'un autre appareil à la base.
 *
 * Tout se fait dans une transaction ; une entrée refusée par la base (une
 * valeur créée des deux côtés avec le même ISIN, par exemple) est comptée
 * dans `echecs` sans empêcher les autres.
 */
export function appliquerCharge(
  pilote: PiloteSqlite,
  etat: EtatSynchro,
  charge: Charge,
): { etat: EtatSynchro; bilan: BilanFusion } {
  const locales = extraireEntites(pilote);
  // Charge d'un ancien appareil (sans version) ou d'un plus récent : on lit ce qu'on connaît.
  const entitesRecues = Object.fromEntries(Object.entries(charge.entites ?? {}).filter(([cle]) => genreConnu(cle)));
  const suppressionsRecues = Object.fromEntries(
    Object.entries(charge.supprimes ?? {}).filter(([cle]) => genreConnu(cle) && !estUnion(cle)),
  );
  const datesRecues = charge.dates ?? {};
  const dates = { ...etat.dates };
  const supprimes = { ...etat.supprimes };
  const bilan: BilanFusion = { ajoutes: 0, modifies: 0, supprimes: 0, echecs: [] };

  // Valeur connue ici sous un autre identifiant : on la retrouve par ISIN.
  const parIsin = new Map<string, string>();
  for (const [cle, valeur] of Object.entries(locales)) {
    if (cle.startsWith('titre:')) {
      parIsin.set(String((valeur as { isin?: string }).isin), decouper(cle).id);
    }
  }
  const alias = new Map<string, string>();
  for (const [cle, valeur] of Object.entries(entitesRecues)) {
    if (cle.startsWith('titre:') && !(cle in locales)) {
      const local = parIsin.get(String((valeur as { isin?: string }).isin));
      if (local) {
        alias.set(decouper(cle).id, local);
      }
    }
  }
  const versLocal = (titreId: string) => alias.get(titreId) ?? titreId;

  const tenter = (cle: string, action: () => void): boolean => {
    try {
      action();
      return true;
    } catch (erreur) {
      bilan.echecs.push({ cle, motif: erreur instanceof Error ? erreur.message : String(erreur) });
      return false;
    }
  };

  pilote.transaction(() => {
    // Les suppressions d'abord, des dépendants vers ce dont ils dépendent.
    const suppressions = Object.entries(suppressionsRecues).sort(
      ([a], [b]) => ORDRE_ECRITURE.indexOf(decouper(b).genre) - ORDRE_ECRITURE.indexOf(decouper(a).genre),
    );
    for (const [cle, date] of suppressions) {
      if ((dates[cle] ?? '') > date) {
        continue; // Modifiée ici après sa suppression là-bas : on la garde.
      }
      if (cle in locales && tenter(cle, () => supprimerEntite(pilote, cle))) {
        bilan.supprimes++;
      }
      supprimes[cle] = plusRecent(supprimes[cle], date)!;
      delete dates[cle];
    }

    const arrivees = Object.entries(entitesRecues).sort(
      ([a], [b]) => ORDRE_ECRITURE.indexOf(decouper(a).genre) - ORDRE_ECRITURE.indexOf(decouper(b).genre),
    );
    for (const [cle, valeur] of arrivees) {
      const date = datesRecues[cle] ?? '';
      if (estUnion(cle)) {
        // Union : ni date ni suppression ; on n'écrit que s'il y a du nouveau.
        const fusion = unionVues(locales[cle], valeur);
        if (locales[cle] === undefined || empreinte(fusion) !== empreinte(locales[cle])) {
          if (tenter(cle, () => ecrireEntite(pilote, cle, fusion, versLocal))) {
            if (locales[cle] === undefined) {
              bilan.ajoutes++;
            } else {
              bilan.modifies++;
            }
          }
        }
        dates[cle] = plusRecent(dates[cle], date) ?? date;
        continue;
      }
      if (alias.has(decouper(cle).id) && cle.startsWith('titre:')) {
        continue; // Déjà présente ici sous son identifiant local.
      }
      if ((supprimes[cle] ?? '') >= date && supprimes[cle] !== undefined) {
        continue; // Supprimée ici après cette version.
      }
      const locale = locales[cle];
      if (locale !== undefined && empreinte(locale) === empreinte(valeur)) {
        dates[cle] = plusRecent(dates[cle], date)!;
        continue;
      }
      if (locale !== undefined && (dates[cle] ?? '') >= date) {
        continue; // La version d'ici est la plus récente.
      }
      let ecrite = false;
      if (tenter(cle, () => (ecrite = ecrireEntite(pilote, cle, valeur, versLocal)))) {
        if (!ecrite) {
          continue; // Refusée sans erreur (valeur invalide) : ni compte ni date.
        }
        if (locale === undefined) {
          bilan.ajoutes++;
        } else {
          bilan.modifies++;
        }
        dates[cle] = date;
        delete supprimes[cle];
      }
    }
  });

  // Ce qui vient d'arriver n'est pas un changement local : on le note connu.
  const connus: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(extraireEntites(pilote))) {
    connus[cle] = empreinte(valeur);
  }
  return { etat: { ...etat, connus, dates, supprimes }, bilan };
}

/**
 * Ce que cet appareil dépose sur le relais.
 *
 * `nouveauxGenres` : émettre aussi les genres de la version 2 (préférences du
 * hub, thèmes, nouveautés vues). Faux tant qu'un autre appareil du relais
 * n'a pas déclaré les comprendre : il les ignorerait, mais mieux vaut ne pas
 * les lui envoyer avant la mise à jour.
 */
export function chargeLocale(
  pilote: PiloteSqlite,
  etat: EtatSynchro,
  appareil: InfoAppareil,
  nouveauxGenres = true,
): Charge {
  const entites = extraireEntites(pilote);
  const dates: Record<string, string> = {};
  for (const cle of Object.keys(entites)) {
    if (!nouveauxGenres && estGenreV2(cle)) {
      delete entites[cle];
    } else if (etat.dates[cle]) {
      dates[cle] = etat.dates[cle];
    }
  }
  const supprimes = Object.fromEntries(
    Object.entries(etat.supprimes).filter(([cle]) => !estUnion(cle) && (nouveauxGenres || !estGenreV2(cle))),
  );
  return {
    ...(nouveauxGenres ? { version: VERSION_CHARGE } : {}),
    entites,
    dates,
    supprimes,
    appareil: { ...appareil, versionCharge: VERSION_CHARGE },
  };
}

/**
 * Peut-on émettre les genres de la version 2 ? Oui si tous les autres
 * appareils du relais (l'index) sont connus et déclarent la version 2.
 */
export function autresComprennentV2(
  etat: EtatSynchro,
  index: Record<string, unknown>,
  moi: string,
  idCoffre: string,
): boolean {
  return Object.keys(index)
    .filter(autre => autre !== moi && autre !== idCoffre)
    .every(autre => (etat.appareils[autre]?.versionCharge ?? 1) >= VERSION_CHARGE && autre in etat.appareils);
}
