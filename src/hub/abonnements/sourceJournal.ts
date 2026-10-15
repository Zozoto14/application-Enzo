/**
 * Source du Journal automatique pour Abonnements (contrat
 * `hub/journal/contrat.ts`) : les paiements reçus ce jour-là. Réservée à qui
 * voit l'app (les Fondateurs) : les données sont celles de la base
 * d'administration, jamais celles d'un autre rang. Lecture seule.
 */

import type { EvenementJournal, SourceJournal } from '../journal/contrat';
import { chargerDonnees } from '../admin/donnees';
import { autorise } from '../admin/roles';
import { comptesSuivis } from './actionsAbo';

export const ID_SOURCE_ABONNEMENTS = 'abonnements';

export const SOURCE_ABONNEMENTS: SourceJournal = {
  id: ID_SOURCE_ABONNEMENTS,
  nom: 'Abonnements',
  famille: 'abonnements',
  lire(jour, contexte) {
    const services = contexte.admin;
    const acteur = contexte.profil;
    if (!services || !acteur || !autorise(acteur, 'abonnements-voir').ok) return [];
    const donnees = chargerDonnees(services.stockage).abonnements;
    const noms = new Map(comptesSuivis(acteur, contexte.profils?.tous ?? []).map(p => [p.id, p.nom]));
    const sortie: EvenementJournal[] = [];
    for (const [id, compte] of Object.entries(donnees.comptes)) {
      const nom = noms.get(id);
      if (!nom) continue;
      for (const p of compte.paiements) {
        if (p.date !== jour) continue;
        sortie.push({
          id: `${id}:${p.id}`,
          source: ID_SOURCE_ABONNEMENTS,
          famille: 'abonnements',
          genre: 'paiement-abonnement',
          jour,
          titre: nom,
          montant: (p.montant + p.remise) / 100,
          ...(p.remise > 0 ? { detail: 'geste commercial inclus' } : {}),
        });
      }
    }
    return sortie;
  },
};
