/**
 * Tâches (V2) : passe des liens avec les autres apps, lancée par le hub
 * (toutes les 5 min au plus, et à l'ouverture de Tâches). Fondateur seul ;
 * chaque lien seulement s'il est activé dans les réglages de Tâches et si le
 * compte ouvert a bien accès à l'app (Prospects et Abonnements : services de
 * l'administration du compte historique). N'écrit que s'il y a du nouveau.
 */

import { chargerDonnees } from '../../hub/admin/donnees';
import { comptesSuivis, peutVoirAbonnements } from '../../hub/abonnements/actionsAbo';
import type { ContexteHub } from '../../hub/types';
import { accesProspects, lireCarnet } from '../../prospects/acces';
import type { Contexte, DonneesTaches } from '../modele';
import { abonnementsVoulus } from './abonnements';
import { lienActif, synchroniserSource } from './commun';
import { portefeuilleVoulu, type RappelsPortefeuille } from './portefeuille';
import { relancesVoulues } from './prospects';

export type SourcesLiens = Pick<ContexteHub, 'profil' | 'profils' | 'admin'> & { rappelsPortefeuille?: RappelsPortefeuille };

export interface BilanLiens {
  donnees: DonneesTaches;
  creees: number;
  terminees: number;
}

export function synchroniserLiens(d: DonneesTaches, sources: SourcesLiens, ctx: Contexte, aujourdhui: string): BilanLiens {
  if (ctx.auteur !== 'fondateur') return { donnees: d, creees: 0, terminees: 0 };
  let x = d;
  let creees = 0;
  let terminees = 0;
  const ajouter = (r: { donnees: DonneesTaches; creees: number; terminees: number }) => {
    x = r.donnees;
    creees += r.creees;
    terminees += r.terminees;
  };
  try {
    if (lienActif(x, 'prospects') && accesProspects(sources)) {
      const carnet = lireCarnet(sources);
      if (carnet) ajouter(synchroniserSource(x, 'prospects', relancesVoulues(carnet, aujourdhui), ctx, { fermerAbsentes: true }));
    }
  } catch {
    // Carnet illisible : réessayé au tour suivant.
  }
  try {
    if (lienActif(x, 'abonnements') && sources.admin && sources.profil && peutVoirAbonnements(sources.profil)) {
      const abo = chargerDonnees(sources.admin.stockage).abonnements;
      const suivis = comptesSuivis(sources.profil, sources.profils?.tous ?? []);
      ajouter(synchroniserSource(x, 'abonnements', abonnementsVoulus(abo, suivis, aujourdhui), ctx, { fermerAbsentes: true }));
    }
  } catch {
    // Données d'administration illisibles : réessayé au tour suivant.
  }
  if (lienActif(x, 'portefeuille') && sources.rappelsPortefeuille) {
    ajouter(synchroniserSource(x, 'portefeuille', portefeuilleVoulu(sources.rappelsPortefeuille, aujourdhui), ctx, { fermerAbsentes: false }));
  }
  return { donnees: x, creees, terminees };
}
