/**
 * Données de l'Administration partagées entre les appareils de
 * l'administrateur (PC, site, téléphone) : réglages, notes privées, journal,
 * connexions déjà reportées, robustesse du mot de passe.
 *
 * Découpage pour la fusion (fusionLww.ts) :
 *  - `reglages`, `robustesse`, `note:<id>` : dernier gagnant (une note
 *    effacée voyage comme suppression datée) ;
 *  - `journal` : UNION par identifiant d'événement (`idEvenement`), bornée par
 *    la rétention et la taille réglées ;
 *  - `vues` (connexions déjà reportées) : maximum par compte, pour qu'une
 *    connexion ne soit pas reportée deux fois ;
 *  - `prospect:<id>` (une fiche de l'app Prospects), `prospects-modeles` :
 *    dernier gagnant (une fiche supprimée voyage comme suppression datée) ;
 *  - `contact:<id>` (adresse e-mail et invitations envoyées d'un compte),
 *    `modele-invitation` : dernier gagnant (un contact oublié à la suppression
 *    du compte voyage comme suppression datée).
 *
 * Le document voyage scellé par la clé de synchronisation de l'administrateur
 * (`cleDerivee('synchro')`), dans son espace `p/principal/` : ni un ami ni
 * le relais ne le lisent.
 */

import { borner, unionJournaux, type EvenementAudit } from './journal';
import { lireDonnees, type DonneesAdmin } from './donnees';
import type { Fusions, Valeurs } from '../../sync/relais/fusionLww';
import { abonnementsDepuisEntites, entitesAbonnements, FUSIONS_ABONNEMENTS } from '../abonnements/abonnements';
import { entitesProspects, prospectsDepuisEntites } from '../../prospects/prospects';

export function entitesDonnees(d: DonneesAdmin): Valeurs {
  const e: Valeurs = { reglages: d.reglages, journal: d.journal, vues: d.connexionsVues };
  for (const [id, note] of Object.entries(d.notes)) e[`note:${id}`] = note;
  for (const [id, contact] of Object.entries(d.contacts)) e[`contact:${id}`] = contact;
  if (d.modeleInvitation) e['modele-invitation'] = d.modeleInvitation;
  if (d.robustesse) e.robustesse = d.robustesse;
  // Abonnements : une entité par compte (`abo:<id>`, historique fusionné par union) + les réglages (dernier gagnant).
  Object.assign(e, entitesAbonnements(d.abonnements));
  // Prospects : une entité par fiche (`prospect:<id>`, dernier gagnant, suppression datée) + les modèles.
  Object.assign(e, entitesProspects(d.prospects));
  return e;
}

export function donneesDepuisEntites(e: Valeurs, maintenant: number): DonneesAdmin {
  const notes: Record<string, unknown> = {};
  const contacts: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(e)) {
    if (cle.startsWith('note:')) notes[cle.slice(5)] = valeur;
    if (cle.startsWith('contact:')) contacts[cle.slice(8)] = valeur;
  }
  const d = lireDonnees(
    JSON.stringify({
      reglages: e.reglages,
      journal: e.journal,
      connexionsVues: e.vues,
      notes,
      contacts,
      modeleInvitation: e['modele-invitation'],
      robustesse: e.robustesse,
      abonnements: abonnementsDepuisEntites(e),
      prospects: prospectsDepuisEntites(e),
    }),
  );
  return { ...d, journal: borner(d.journal, maintenant, d.reglages.retentionJours, d.reglages.tailleJournal) };
}

/** Fusions par union, bornées par les réglages d'ici (le même borne des deux côtés une fois les réglages alignés). */
export function fusionsDonnees(reglages: DonneesAdmin['reglages'], maintenant: number): Fusions {
  return {
    ...FUSIONS_ABONNEMENTS,
    journal: (a, b) =>
      borner(unionJournaux(a as EvenementAudit[], b as EvenementAudit[]), maintenant, reglages.retentionJours, reglages.tailleJournal),
    vues: (a, b) => {
      const max: Record<string, number> = { ...(a as Record<string, number>) };
      for (const [id, n] of Object.entries((b as Record<string, number>) ?? {})) {
        if (typeof n === 'number' && n > (max[id] ?? -1)) max[id] = n;
      }
      return Object.fromEntries(Object.keys(max).sort().map(id => [id, max[id]]));
    },
  };
}
