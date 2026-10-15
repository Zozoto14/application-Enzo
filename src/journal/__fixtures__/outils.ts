/** Données d'exemple pour les tests du journal (aucun nom de site réel : séries et projets fictifs). */

import type { EvenementJournal } from '../../hub/journal/contrat';
import type { BaseJournal } from '../modele';

export const JOUR = '2026-10-13';

export function baseMemoire(initial: Record<string, string> = {}): BaseJournal & { m: Map<string, string>; ecritures: string[] } {
  const m = new Map(Object.entries(initial));
  const ecritures: string[] = [];
  return {
    m,
    ecritures,
    lire: c => m.get(c),
    ecrire: (c, v) => {
      ecritures.push(c);
      m.set(c, v);
    },
  };
}

type Brut = Omit<EvenementJournal, 'jour' | 'source'> & { jour?: string; source?: string };
export const ev = (e: Brut): EvenementJournal => ({ jour: JOUR, source: 'test', ...e });

/** Une journée bien remplie, un peu de chaque app. */
export function journeeRemplie(jour = JOUR): EvenementJournal[] {
  const j = (e: Omit<Brut, 'jour'>) => ev({ ...e, jour });
  return [
    j({ id: 't1', famille: 'taches', genre: 'tache-terminee', heure: '09:10', titre: 'Relire le contrat Atelier Lune', groupe: 'Clients' }),
    j({ id: 't2', famille: 'taches', genre: 'tache-terminee', heure: '10:30', titre: 'Envoyer la facture', groupe: 'Clients' }),
    j({ id: 't3', famille: 'taches', genre: 'tache-terminee', heure: '11:00', titre: 'Ranger le dossier', groupe: 'Clients' }),
    j({ id: 't4', famille: 'taches', genre: 'tache-creee', heure: '15:00', titre: 'Préparer la réunion', groupe: 'Clients' }),
    j({ id: 's1', famille: 'office', genre: 'session-office', heure: '12:00', titre: 'Ajouter le journal automatique au hub', groupe: 'application-exemple', nombre: 95, detail: '4 demandes' }),
    j({ id: 'e1', famille: 'tsuzuku', genre: 'episode-vu', heure: '21:00', titre: 'Aventure du Phare', groupe: 'Aventure du Phare', nombre: 4 }),
    j({ id: 'e2', famille: 'tsuzuku', genre: 'episode-vu', heure: '21:25', titre: 'Aventure du Phare', groupe: 'Aventure du Phare', nombre: 5 }),
    j({ id: 'e3', famille: 'tsuzuku', genre: 'episode-vu', heure: '21:50', titre: 'Aventure du Phare', groupe: 'Aventure du Phare', nombre: 6 }),
    j({ id: 'o1', famille: 'portefeuille', genre: 'operation-bourse', titre: 'ETF Monde exemple', groupe: 'ACHAT', nombre: 10, montant: 1234.5 }),
    j({ id: 'v1', famille: 'portefeuille', genre: 'variation-portefeuille', titre: 'Variation du portefeuille', pourcentage: 1.25, montant: 310.2 }),
    j({ id: 'a1', famille: 'abonnements', genre: 'paiement-abonnement', titre: 'Léa', montant: 45 }),
    j({ id: 'r1', famille: 'prospects', genre: 'relance-prospect', titre: 'Zoé Durand (Studio exemple)' }),
    j({ id: 'd1', famille: 'decisions', genre: 'decision', heure: '17:00', titre: 'Garder le plan d’épargne mensuel', poids: 75 }),
    j({ id: 'm1', famille: 'meteo', genre: 'meteo', titre: 'Ensoleillé, 19 °C' }),
  ];
}
