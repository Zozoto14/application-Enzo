/**
 * Routes HTTP du module « Ressources », branchées par api.mjs. Session déjà vérifiée ; appartenance,
 * module et permission sont contrôlés dans ressources/service.mjs (et medias/service.mjs pour l'envoi).
 *
 *   GET|POST            /teams/:t/ressources                         fil (?categorie&tag&carte&agent&genre&auteur&niveau&favoris=1&q&file=1&miennes=1), publier / proposer
 *   POST                /teams/:t/ressources/vu                      canal vu (compteur « nouveau » remis à zéro)
 *   POST                /teams/:t/ressources/apercu                  aperçu d'un lien { url } (récupéré par le serveur, anti-SSRF)
 *   GET|PATCH           /teams/:t/ressources/reglages                propositions des joueurs, salon Discord dédié
 *   POST                /teams/:t/ressources/categories              créer ; PUT …/categories/ordre { ids } ; PATCH|DELETE …/categories/:c
 *   GET|PATCH|DELETE    /teams/:t/ressources/:id                     détail (commentaires), modifier, supprimer
 *   POST                /teams/:t/ressources/:id/valider|refuser     file de validation (staff)
 *   PUT|DELETE          /teams/:t/ressources/:id/favori              favori personnel
 *   PUT                 /teams/:t/ressources/:id/reactions           { emoji, actif }
 *   POST                /teams/:t/ressources/:id/commentaires        commenter ; DELETE …/commentaires/:c
 *   POST                /teams/:t/ressources/:id/fichier/lien        lien signé (2 h) du fichier déposé { telecharger? }
 *   POST                /teams/:t/ressources/:id/review              « Ouvrir en review vidéo »
 *   POST|GET|PUT|DELETE /teams/:t/ressources/envois…                 envoi d'un fichier par morceaux (medias/service.mjs)
 *
 *   GET                 /ressources/teams                            teams où publier (Esport global)
 *   POST                /ressources/multi                            même ressource dans plusieurs teams
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

const filtres = q => ({
  categorie: q.get('categorie') || undefined,
  tag: q.get('tag') || undefined,
  carte: q.get('carte') || undefined,
  agent: q.get('agent') || undefined,
  genre: q.get('genre') || undefined,
  auteur: q.get('auteur') || undefined,
  niveau: q.get('niveau') || undefined,
  favoris: q.get('favoris') === '1',
  q: q.get('q') || undefined,
  file: q.get('file') === '1',
  miennes: q.get('miennes') === '1',
});

export async function routesRessources({ ressources, medias, acteur, chemin, methode, url, requete, lireCorps, limite }) {
  if (chemin === '/ressources/teams' && methode === 'GET') return ressources.teamsPublication(acteur);
  if (chemin === '/ressources/multi' && methode === 'POST') return ressources.publierMulti(acteur, await lireCorps());

  const m = /^\/teams\/([^/]+)\/ressources(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, reste = ''] = m;
  const p = reste.split('/').filter(Boolean).map(segment);
  const n = p.length;
  const [a, b, c] = p;

  if (a === 'envois' && medias) return routesEnvois({ medias, acteur, teamId, usage: 'ressource', p: p.slice(1), methode, requete, lireCorps });
  if (n === 0 && methode === 'GET') return ressources.liste(acteur, teamId, filtres(url.searchParams));
  if (n === 0 && methode === 'POST') return ressources.creer(acteur, teamId, await lireCorps());
  if (n === 1 && a === 'vu' && methode === 'POST') return ressources.marquerVu(acteur, teamId);
  if (n === 1 && a === 'apercu' && methode === 'POST') {
    // Chaque aperçu fait une requête sortante : borné par compte.
    await limite('apercu', acteur.compte);
    return ressources.apercuLien(acteur, teamId, await lireCorps());
  }
  if (n === 1 && a === 'reglages') {
    if (methode === 'GET') return ressources.lireReglages(acteur, teamId);
    if (methode === 'PATCH') return ressources.changerReglages(acteur, teamId, await lireCorps());
  }
  if (a === 'categories') {
    if (n === 1 && methode === 'POST') return ressources.creerCategorie(acteur, teamId, await lireCorps());
    if (n === 2 && b === 'ordre' && methode === 'PUT') return ressources.ordonnerCategories(acteur, teamId, await lireCorps());
    if (n === 2 && methode === 'PATCH') return ressources.modifierCategorie(acteur, teamId, b, await lireCorps());
    if (n === 2 && methode === 'DELETE') return ressources.supprimerCategorie(acteur, teamId, b);
    throw echec(404, 'route', 'Adresse inconnue.');
  }
  if (n === 1 && methode === 'GET') return ressources.detail(acteur, teamId, a);
  if (n === 1 && methode === 'PATCH') return ressources.modifier(acteur, teamId, a, await lireCorps());
  if (n === 1 && methode === 'DELETE') return ressources.supprimer(acteur, teamId, a);
  if (n === 2 && b === 'valider' && methode === 'POST') return ressources.valider(acteur, teamId, a, await lireCorps());
  if (n === 2 && b === 'refuser' && methode === 'POST') return ressources.refuser(acteur, teamId, a, await lireCorps());
  if (n === 2 && b === 'favori' && (methode === 'PUT' || methode === 'DELETE')) return ressources.favori(acteur, teamId, a, methode === 'PUT');
  if (n === 2 && b === 'reactions' && methode === 'PUT') return ressources.reagir(acteur, teamId, a, await lireCorps());
  if (n === 2 && b === 'commentaires' && methode === 'POST') return ressources.commenter(acteur, teamId, a, await lireCorps());
  if (n === 3 && b === 'commentaires' && methode === 'DELETE') return ressources.supprimerCommentaire(acteur, teamId, a, c);
  if (n === 2 && b === 'review' && methode === 'POST') return ressources.ouvrirEnReview(acteur, teamId, a);
  if (n === 3 && b === 'fichier' && c === 'lien' && methode === 'POST') {
    const { chemin: lien, expire } = await ressources.lienFichier(acteur, teamId, a, await lireCorps());
    const prefixe = url.pathname.startsWith('/api/esport') ? '/api/esport' : '';
    return { url: `${url.origin}${prefixe}${lien}`, expire: new Date(expire).toISOString() };
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
