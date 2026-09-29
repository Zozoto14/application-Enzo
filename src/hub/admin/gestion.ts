/**
 * Carnet d'un gestionnaire : les comptes qu'il a lui-même créés.
 *
 * C'est le choix d'isolation de ce rôle. L'annuaire ne nomme personne (les
 * prénoms sont scellés pour l'administrateur, et un prénom inconnu mène au
 * coffre leurre) : un gestionnaire ne reçoit donc jamais la liste des
 * comptes de l'appareil. Il ne connaît que les amis qu'il a créés, dont il a
 * saisi le prénom lui-même ; il les garde ici, dans SA base chiffrée, avec
 * l'identifiant opaque du compte. Pour tous les autres comptes, il n'a que
 * des chiffres sans prénom (tableau de bord).
 *
 * Alternative écartée : que l'administrateur « confie » des comptes existants
 * à un gestionnaire. Il faudrait lui transmettre leurs prénoms, donc soit
 * casser le leurre (un gestionnaire pourrait sonder les prénoms), soit sceller
 * pour lui avec une nouvelle clé — c'est-à-dire toucher à la cryptographie
 * (niveau 2, hors de cette version).
 */

const CLE_CARNET = 'gestion.comptes';
const MOTIF_ID = /^[a-z0-9]{6,16}$/;
export const MAX_CARNET = 200;

export interface EntreeCarnet {
  id: string;
  nom: string;
  /** AAAA-MM-JJ. */
  creeLe: string;
}

export const CLE_CARNET_GESTION = CLE_CARNET;

export function lireCarnet(brut: string | undefined | null): EntreeCarnet[] {
  if (!brut) {
    return [];
  }
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return [];
  }
  if (!Array.isArray(lu)) {
    return [];
  }
  const vus = new Set<string>();
  const carnet: EntreeCarnet[] = [];
  for (const e of lu) {
    if (!e || typeof e !== 'object') continue;
    const { id, nom, creeLe } = e as Record<string, unknown>;
    if (typeof id !== 'string' || !MOTIF_ID.test(id) || vus.has(id) || typeof nom !== 'string' || !nom.trim()) continue;
    vus.add(id);
    carnet.push({ id, nom: nom.trim().slice(0, 30), creeLe: typeof creeLe === 'string' ? creeLe.slice(0, 40) : '' });
  }
  return carnet.slice(-MAX_CARNET);
}

export function ecrireCarnet(carnet: readonly EntreeCarnet[]): string {
  return JSON.stringify(lireCarnet(JSON.stringify(carnet)));
}

export function ajouterAuCarnet(carnet: readonly EntreeCarnet[], entree: EntreeCarnet): EntreeCarnet[] {
  return lireCarnet(JSON.stringify([...carnet.filter(e => e.id !== entree.id), entree]));
}

export function retirerDuCarnet(carnet: readonly EntreeCarnet[], id: string): EntreeCarnet[] {
  return carnet.filter(e => e.id !== id);
}
