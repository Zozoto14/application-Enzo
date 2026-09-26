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
  decouper,
  ecrireEntite,
  empreinte,
  extraireEntites,
  supprimerEntite,
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
  derniereSynchro?: string;
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
  for (const [cle, valeur] of Object.entries(entites)) {
    connus[cle] = empreinte(valeur);
    if (etat.connus[cle] !== connus[cle]) {
      dates[cle] = maintenant;
      delete supprimes[cle];
    }
  }
  for (const cle of Object.keys(etat.connus)) {
    if (!(cle in entites)) {
      supprimes[cle] = maintenant;
      delete dates[cle];
    }
  }
  const limite = new Date(Date.parse(maintenant) - DUREE_SUPPRESSIONS_JOURS * 86_400_000).toISOString();
  for (const [cle, date] of Object.entries(supprimes)) {
    if (date < limite) {
      delete supprimes[cle];
    }
  }
  return { ...etat, connus, dates, supprimes };
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
  for (const [cle, valeur] of Object.entries(charge.entites)) {
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
    const suppressions = Object.entries(charge.supprimes).sort(
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

    const arrivees = Object.entries(charge.entites).sort(
      ([a], [b]) => ORDRE_ECRITURE.indexOf(decouper(a).genre) - ORDRE_ECRITURE.indexOf(decouper(b).genre),
    );
    for (const [cle, valeur] of arrivees) {
      const date = charge.dates[cle] ?? '';
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
      if (tenter(cle, () => ecrireEntite(pilote, cle, valeur, versLocal))) {
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

/** Ce que cet appareil dépose sur le relais. */
export function chargeLocale(pilote: PiloteSqlite, etat: EtatSynchro, appareil: InfoAppareil): Charge {
  const entites = extraireEntites(pilote);
  const dates: Record<string, string> = {};
  for (const cle of Object.keys(entites)) {
    if (etat.dates[cle]) {
      dates[cle] = etat.dates[cle];
    }
  }
  return { entites, dates, supprimes: { ...etat.supprimes }, appareil };
}
