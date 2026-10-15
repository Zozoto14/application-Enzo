/**
 * Source du Journal automatique pour Tâches (contrat `hub/journal/contrat.ts`) :
 * tâches terminées et créées ce jour-là, lues dans les données locales du
 * profil (le Fondateur : les siennes ; un membre : la copie partagée et ses
 * projets personnels). Aucune écriture.
 */

import type { EvenementJournal, SourceJournal } from '../hub/journal/contrat';
import type { ContexteHub } from '../hub/types';
import { roleTaches } from './acces';
import { heureDe, jourDe } from './dates';
import { estTerminee, tachesVivantes, type DonneesTaches } from './modele';
import { donneesPour, lirePerso } from './resume';

export const ID_SOURCE_TACHES = 'taches';

function duJour(d: DonneesTaches, jour: string, prefixe: string): EvenementJournal[] {
  const sortie: EvenementJournal[] = [];
  for (const t of tachesVivantes(d)) {
    const projet = d.projets[t.projetId]?.nom;
    if (estTerminee(d, t) && t.termineLe) {
      const ms = Date.parse(t.termineLe);
      if (Number.isFinite(ms) && jourDe(ms) === jour) {
        sortie.push({ id: `${prefixe}${t.id}:fin`, source: ID_SOURCE_TACHES, famille: 'taches', genre: 'tache-terminee', jour, heure: heureDe(ms), titre: t.titre, ...(projet ? { groupe: projet } : {}) });
      }
    }
    // Les tâches posées par une app reliée (relances, abonnements…) ne sont pas des créations de l'utilisateur.
    if (!t.source && t.creeLe) {
      const ms = Date.parse(t.creeLe);
      if (Number.isFinite(ms) && jourDe(ms) === jour) {
        sortie.push({ id: `${prefixe}${t.id}:cree`, source: ID_SOURCE_TACHES, famille: 'taches', genre: 'tache-creee', jour, heure: heureDe(ms), titre: t.titre, ...(projet ? { groupe: projet } : {}) });
      }
    }
  }
  return sortie;
}

export function evenementsTaches(jour: string, contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil'>): EvenementJournal[] {
  const role = roleTaches(contexte);
  if (!role || !contexte.baseProfil) return [];
  const perso = role === 'ami' ? lirePerso(contexte.baseProfil) : undefined;
  return [...duJour(donneesPour(role, contexte.baseProfil), jour, ''), ...(perso ? duJour(perso, jour, 'p:') : [])];
}

export const SOURCE_TACHES: SourceJournal = {
  id: ID_SOURCE_TACHES,
  nom: 'Tâches',
  famille: 'taches',
  lire: (jour, contexte) => evenementsTaches(jour, contexte),
};
