/**
 * Routes HTTP du module Lineups (migration 0082), branchées par api.mjs AVANT celles des strats (la lecture
 * `/teams/:t/strats/:id/lineups` est servie ici). Rendent `undefined` si l'adresse ne les concerne pas.
 *
 *   GET|POST            /teams/:t/lineups                      liste (?carte&personnage&capacite&side&zone&tag&statut&favoris=1&q), création
 *   GET                 /teams/:t/lineups/corbeille            lineups supprimés depuis moins de 30 jours
 *   GET|PATCH|DELETE    /teams/:t/lineups/:id                  fiche, correction (statut : valider), suppression (corbeille)
 *   POST                /teams/:t/lineups/:id/restaurer        sortir un lineup de la corbeille
 *   PUT|DELETE          /teams/:t/lineups/:id/favori           favori du compte
 *   POST                /teams/:t/lineups/:id/medias           { envoi, role } : rattacher un fichier envoyé
 *   PATCH|DELETE        /teams/:t/lineups/:id/medias/:m        rôle et ordre d'une image, retrait d'un média
 *   PUT|DELETE          /teams/:t/lineups/:id/strats/:s        lier (étape facultative) ou délier une strat
 *   POST|GET|PUT|DELETE /teams/:t/lineups/envois…              envoi d'un fichier par morceaux (medias/service.mjs)
 *
 *   GET                 /teams/:t/strats/:id/lineups           lineups d'une strat (éditeur de strats, bloc « Lineups liés »)
 */

import { echec } from '../outils.mjs';
import { routesEnvois } from '../review/routes.mjs';

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesLineups({ lineups, medias, acteur, chemin, methode, url, requete, lireCorps }) {
  const prefixe = url.pathname.startsWith('/api/esport') ? '/api/esport' : '';
  const options = { origine: `${url.origin}${prefixe}` };
  // Lecture pour l'éditeur de strats : les lineups liés à une strat.
  const deStrat = /^\/teams\/([^/]+)\/strats\/([^/]+)\/lineups$/.exec(chemin);
  if (deStrat) {
    if (methode === 'GET') return lineups.lineupsDeStrat(acteur, deStrat[1], segment(deStrat[2]), options);
    throw echec(404, 'route', 'Adresse inconnue.');
  }
  const m = /^\/teams\/([^/]+)\/lineups(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, reste = ''] = m;
  const p = reste.split('/').filter(Boolean).map(segment);
  const [a, b, c] = p;
  const n = p.length;
  if (a === 'envois' && medias) return routesEnvois({ medias, acteur, teamId, usage: 'lineup', p: p.slice(1), methode, requete, lireCorps });
  const q = Object.fromEntries(url.searchParams.entries());
  if (n === 0 && methode === 'GET') return lineups.liste(acteur, teamId, { ...q, favoris: q.favoris === '1' }, options);
  if (n === 0 && methode === 'POST') return lineups.creer(acteur, teamId, await lireCorps(), options);
  if (n === 1 && a === 'corbeille' && methode === 'GET') return { lineups: await lineups.corbeille(acteur, teamId) };
  if (n === 1 && methode === 'GET') return lineups.detail(acteur, teamId, a, options);
  if (n === 1 && methode === 'PATCH') return lineups.modifier(acteur, teamId, a, await lireCorps(), options);
  if (n === 1 && methode === 'DELETE') return lineups.supprimer(acteur, teamId, a);
  if (n === 2 && b === 'restaurer' && methode === 'POST') return lineups.restaurer(acteur, teamId, a, options);
  if (n === 2 && b === 'favori' && (methode === 'PUT' || methode === 'DELETE')) return lineups.favori(acteur, teamId, a, methode === 'PUT');
  if (n === 2 && b === 'medias' && methode === 'POST') return lineups.ajouterMedia(acteur, teamId, a, await lireCorps(), options);
  if (n === 3 && b === 'medias' && methode === 'PATCH') return lineups.modifierMedia(acteur, teamId, a, c, await lireCorps(), options);
  if (n === 3 && b === 'medias' && methode === 'DELETE') return lineups.retirerMedia(acteur, teamId, a, c, options);
  if (n === 3 && b === 'strats' && methode === 'PUT') return lineups.lierStrat(acteur, teamId, a, c, await lireCorps(), options);
  if (n === 3 && b === 'strats' && methode === 'DELETE') return lineups.delierStrat(acteur, teamId, a, c, options);
  throw echec(404, 'route', 'Adresse inconnue.');
}
