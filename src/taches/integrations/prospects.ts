/**
 * Lien Tâches ↔ Prospects (Fondateur seul) : chaque relance prévue d'une fiche
 * (dans les 30 prochains jours, ou en retard) devient une tâche du projet
 * « Prospects » ; une relance notée (ou la fiche close, « ne plus
 * contacter ») termine la tâche ; cocher la tâche note le contact dans
 * Prospects. Module isolé : Prospects n'en sait rien et n'est pas modifié.
 */

import { ajouterJours, modifierProspect, noterContact, nouvelId, STATUTS_CLOS, type DonneesProspects, type Prospect } from '../../prospects/prospects';
import type { Tache } from '../modele';
import type { Voulue } from './commun';

export const HORIZON_RELANCES_JOURS = 30;
export const NOTE_CONTACT = 'Relance faite (cochée dans Tâches).';

const nomDe = (p: Prospect) => p.nom || p.entreprise || p.email || 'un prospect';

/** Clé stable d'une relance : la fiche et le jour prévu (une nouvelle date = une nouvelle tâche). */
export const cleRelance = (p: Pick<Prospect, 'id' | 'relance'>) => `${p.id}|${p.relance}`;

export function relancesVoulues(carnet: DonneesProspects, aujourdhui: string): Voulue[] {
  const limite = ajouterJours(aujourdhui, HORIZON_RELANCES_JOURS);
  return Object.values(carnet.prospects)
    .filter(p => p.relance && p.relance <= limite && !STATUTS_CLOS.includes(p.statut) && !p.nePlusContacter)
    .sort((a, b) => a.relance!.localeCompare(b.relance!) || a.id.localeCompare(b.id))
    .slice(0, 500)
    .map(p => ({
      cle: cleRelance(p),
      titre: `Relancer ${nomDe(p)}`,
      description: [p.entreprise && p.nom ? p.entreprise : '', p.email, p.telephone, 'Ouvrez Prospects pour écrire ou noter le contact.'].filter(Boolean).join('\n'),
      echeance: { jour: p.relance! },
      etiquettes: ['prospects'],
    }));
}

/**
 * La tâche d'une relance est cochée : le contact est noté dans Prospects (une
 * seule fois — seulement si la fiche attend toujours CETTE relance), et la
 * relance est levée. Rend le carnet tel quel sinon.
 */
export function noterRelanceFaite(carnet: DonneesProspects, t: Pick<Tache, 'source'>, aujourdhui: string, maintenant: number, alea?: () => number): DonneesProspects {
  if (t.source?.app !== 'prospects') return carnet;
  const [id, jour] = t.source.cle.split('|');
  const p = carnet.prospects[id];
  if (!p || p.relance !== jour) return carnet;
  return modifierProspect(
    carnet,
    id,
    x => {
      const suivant: Prospect = { ...noterContact(x, { date: aujourdhui, note: NOTE_CONTACT }, nouvelId(maintenant, alea)) };
      delete suivant.relance;
      return suivant;
    },
    maintenant,
  );
}
