/**
 * Source du Journal automatique pour Prospects (contrat
 * `hub/journal/contrat.ts`) : les contacts et relances notés ce jour-là dans
 * le carnet. Réservée au Fondateur, seul à voir le carnet (`lireCarnet`).
 * Lecture seule ; l'adresse e-mail n'est jamais recopiée dans le journal.
 */

import type { EvenementJournal, SourceJournal } from '../hub/journal/contrat';
import { lireCarnet } from './acces';

export const ID_SOURCE_PROSPECTS = 'prospects';

export const SOURCE_PROSPECTS: SourceJournal = {
  id: ID_SOURCE_PROSPECTS,
  nom: 'Prospects',
  famille: 'prospects',
  lire(jour, contexte) {
    const carnet = lireCarnet(contexte);
    if (!carnet) return [];
    const sortie: EvenementJournal[] = [];
    for (const p of Object.values(carnet.prospects)) {
      for (const c of p.historique) {
        if (c.date !== jour) continue;
        const nom = p.nom || p.entreprise || 'Prospect';
        sortie.push({
          id: `${p.id}:${c.id}`,
          source: ID_SOURCE_PROSPECTS,
          famille: 'prospects',
          genre: 'relance-prospect',
          jour,
          titre: p.entreprise && p.nom ? `${nom} (${p.entreprise})` : nom,
          ...(c.note ? { detail: c.note.slice(0, 200) } : {}),
          groupe: p.statut,
        });
      }
    }
    return sortie;
  },
};
