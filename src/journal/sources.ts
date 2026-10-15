/**
 * Sources du Journal automatique : une par app, remplie côté hôte (le contrat
 * est dans `hub/journal/contrat.ts`). **Ajouter une source = l'ajouter ici.**
 * La « boîte » reçoit les événements des apps sans source (coach de décisions,
 * météo…) : voir `hub/journal/boite.ts`.
 */

import { SOURCE_ABONNEMENTS } from '../hub/abonnements/sourceJournal';
import { lireBoite, SOURCE_BOITE } from '../hub/journal/boite';
import type { SourceJournal } from '../hub/journal/contrat';
import { SOURCE_PORTEFEUILLE } from '../app/sourceJournalPortefeuille';
import { SOURCE_OFFICE } from '../claudeOffice/sourceJournal';
import { SOURCE_PROSPECTS } from '../prospects/sourceJournal';
import { SOURCE_TACHES } from '../taches/sourceJournal';
import { SOURCE_TSUZUKU } from '../tsuzuku/app/sourceJournal';

export const SOURCE_BOITE_JOURNAL: SourceJournal = {
  id: SOURCE_BOITE,
  nom: 'Autres apps',
  famille: 'autre',
  lire: (jour, contexte) => lireBoite(contexte.baseProfil, jour),
};

export const SOURCES_JOURNAL: readonly SourceJournal[] = [SOURCE_TACHES, SOURCE_OFFICE, SOURCE_TSUZUKU, SOURCE_PORTEFEUILLE, SOURCE_ABONNEMENTS, SOURCE_PROSPECTS, SOURCE_BOITE_JOURNAL];
