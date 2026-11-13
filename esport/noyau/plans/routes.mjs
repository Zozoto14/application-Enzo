/**
 * Routes HTTP du module Plan de match (migration 0083). Rendent `undefined` si l'adresse ne les concerne pas.
 *
 *   GET|POST          /teams/:t/plans                  liste (?statut&adversaire), création ({ depuis } : modèle ou plan recopié)
 *   GET               /teams/:t/plans/evenement        plan d'une occurrence du planning (?evenement&occurrence)
 *   GET               /teams/:t/plans/prochain         prochain plan lié à un événement à venir
 *   GET               /teams/:t/plans/liens            ce que l'éditeur peut lier (événements, adversaires, strats, lineups…)
 *   GET               /teams/:t/plans/corbeille        plans supprimés depuis moins de 30 jours
 *   GET|PATCH|DELETE  /teams/:t/plans/:id              plan, modification (statut compris), suppression (corbeille)
 *   PUT               /teams/:t/plans/:id/coches       cases cochées de la checklist
 *   POST              /teams/:t/plans/:id/dupliquer    copie, ou modèle ({ modele: true })
 *   POST              /teams/:t/plans/:id/debrief      événement « Review » du debrief ({ date, heureDebut, heureFin })
 *   POST              /teams/:t/plans/:id/restaurer    sortir un plan de la corbeille
 */

import { echec } from '../outils.mjs';

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesPlans({ plans, acteur, chemin, methode, url, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/plans(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, reste = ''] = m;
  const p = reste.split('/').filter(Boolean).map(segment);
  const [a, b] = p;
  const n = p.length;
  const q = Object.fromEntries(url.searchParams.entries());
  if (n === 0 && methode === 'GET') return plans.liste(acteur, teamId, q);
  if (n === 0 && methode === 'POST') return plans.creer(acteur, teamId, await lireCorps());
  if (n === 1 && methode === 'GET') {
    if (a === 'evenement') return plans.pourEvenement(acteur, teamId, q.evenement, q.occurrence);
    if (a === 'prochain') return plans.prochain(acteur, teamId);
    if (a === 'liens') return plans.liens(acteur, teamId);
    if (a === 'corbeille') return plans.corbeille(acteur, teamId);
    return plans.detail(acteur, teamId, a);
  }
  if (n === 1 && methode === 'PATCH') return plans.modifier(acteur, teamId, a, await lireCorps());
  if (n === 1 && methode === 'DELETE') return plans.supprimer(acteur, teamId, a);
  if (n === 2 && b === 'coches' && methode === 'PUT') return plans.cocher(acteur, teamId, a, await lireCorps());
  if (n === 2 && b === 'dupliquer' && methode === 'POST') return plans.dupliquer(acteur, teamId, a, await lireCorps());
  if (n === 2 && b === 'debrief' && methode === 'POST') return plans.debrief(acteur, teamId, a, await lireCorps());
  if (n === 2 && b === 'restaurer' && methode === 'POST') return plans.restaurer(acteur, teamId, a);
  throw echec(404, 'route', 'Adresse inconnue.');
}
