/**
 * Espaces des comptes sur le relais : `/p/<id>/boite/<nom>`.
 *
 * Chaque objet voyage dans une enveloppe au format des dépôts
 * (`{ format, version, appareil: <nom>, date, charge }`) ; `charge` est du
 * texte : un document JSON, ou des octets en base 64. Ce module ne chiffre
 * rien lui-même : ce qu'on y dépose est déjà opaque (annuaire), scellé par la
 * clé maîtresse d'un compte (coffre, portefeuille) ou par sa clé de synchro
 * (données d'administration).
 */

import { depuisBase64, versBase64 } from './chiffrement';
import type { Liaison } from './liaison';
import { ErreurRelais, appeler } from './synchroniser';

type Fetch = typeof fetch;

export interface ObjetEspace {
  date: string;
  charge: string;
}

export interface Espaces {
  lister(id: string): Promise<Record<string, { date: string; taille: number }>>;
  /** L'objet, ou rien s'il n'existe pas. */
  lire(id: string, nom: string): Promise<ObjetEspace | undefined>;
  deposer(id: string, nom: string, charge: string, date: string): Promise<void>;
  supprimer(id: string, nom: string): Promise<void>;
}

const chemin = (id: string, nom?: string) =>
  `/p/${encodeURIComponent(id)}/boite${nom === undefined ? '' : `/${encodeURIComponent(nom)}`}`;

export function espacesDuRelais(liaison: Liaison, requete: Fetch = fetch): Espaces {
  const verifier = (reponse: Response, quoi: string) => {
    if (reponse.status === 403) {
      throw new ErreurRelais('Ce code de liaison ne donne pas accès à ce compte.', 403);
    }
    if (!reponse.ok) {
      throw new ErreurRelais(`Le relais a répondu ${reponse.status} (${quoi}).`, reponse.status);
    }
  };
  return {
    async lister(id) {
      const reponse = await appeler(liaison, chemin(id), {}, requete);
      verifier(reponse, 'liste');
      const corps = (await reponse.json()) as { objets?: Record<string, { date: string; taille: number }> };
      return corps.objets ?? {};
    },
    async lire(id, nom) {
      const reponse = await appeler(liaison, chemin(id, nom), {}, requete);
      if (reponse.status === 404) {
        return undefined;
      }
      verifier(reponse, nom);
      const enveloppe = (await reponse.json()) as { date?: unknown; charge?: unknown };
      if (typeof enveloppe.date !== 'string' || typeof enveloppe.charge !== 'string') {
        throw new ErreurRelais(`Dépôt illisible sur le relais (${nom}).`);
      }
      return { date: enveloppe.date, charge: enveloppe.charge };
    },
    async deposer(id, nom, charge, date) {
      const corps = JSON.stringify({ format: 'applibourse-relais', version: 1, appareil: nom, date, charge });
      const reponse = await appeler(liaison, chemin(id, nom), { methode: 'PUT', corps }, requete);
      verifier(reponse, nom);
    },
    async supprimer(id, nom) {
      const reponse = await appeler(liaison, chemin(id, nom), { methode: 'DELETE' }, requete);
      if (reponse.status !== 404) {
        verifier(reponse, nom);
      }
    },
  };
}

export const octetsEnCharge = (octets: Uint8Array): string => versBase64(octets);
export const chargeEnOctets = (charge: string): Uint8Array => depuisBase64(charge);
