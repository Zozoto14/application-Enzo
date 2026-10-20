/**
 * Routes HTTP de la review vidéo et du scouting (phase 5), branchées par
 * api.mjs. Session déjà vérifiée ; appartenance, module et permission sont
 * contrôlés dans review/service.mjs et scouting/service.mjs.
 *
 *   GET|POST            /teams/:t/review                                   liste, création (url YouTube)
 *   GET|PATCH|DELETE    /teams/:t/review/:id                               détail (repères, commentaires), titre, suppression
 *   GET                 /teams/:t/review/:id/export.md                     export Markdown (?format=json : enveloppe JSON)
 *   POST                /teams/:t/review/:id/reperes                       ajouter un repère
 *   PATCH|DELETE        /teams/:t/review/:id/reperes/:r                    modifier, supprimer
 *   POST                /teams/:t/review/:id/reperes/:r/commentaires       commenter
 *   DELETE              /teams/:t/review/:id/reperes/:r/commentaires/:c    supprimer un commentaire
 *
 *   GET|POST            /teams/:t/scouting/adversaires                     liste, création
 *   GET|PATCH|DELETE    /teams/:t/scouting/adversaires/:a                  fiche complète, modification, suppression
 *   POST|PATCH|DELETE   /teams/:t/scouting/adversaires/:a/joueurs[/:x]    joueurs adverses
 *   POST|PATCH|DELETE   /teams/:t/scouting/adversaires/:a/tendances[/:x]  tendances par map et side
 *   POST|PATCH|DELETE   /teams/:t/scouting/adversaires/:a/vods[/:x]       VODs
 *   POST                /teams/:t/scouting/adversaires/:a/vods/:x/review   ouvrir en review vidéo (crée ou lie)
 */

import { ENTETES_FICHIER, disposition } from '../entetes.mjs';
import { echec } from '../outils.mjs';



function fichier(f, url) {
  if (url.searchParams.get('format') === 'json') return f;
  return new Response(f.contenu, { status: 200, headers: { ...ENTETES_FICHIER, 'Content-Type': f.type, 'Content-Disposition': disposition(f.nom) } });
}

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesReview({ review, scouting, acteur, chemin, methode, url, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/(review|scouting)(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, section, reste = ''] = m;
  const p = reste.split('/').filter(Boolean).map(segment);
  const n = p.length;

  if (section === 'review') {
    const [id, sous, repere, , commentaire] = p;
    if (n === 0 && methode === 'GET') return review.liste(acteur, teamId);
    if (n === 0 && methode === 'POST') return review.creer(acteur, teamId, await lireCorps());
    if (n === 1 && methode === 'GET') return review.detail(acteur, teamId, id);
    if (n === 1 && methode === 'PATCH') return review.modifier(acteur, teamId, id, await lireCorps());
    if (n === 1 && methode === 'DELETE') return review.supprimer(acteur, teamId, id);
    if (n === 2 && sous === 'export.md' && methode === 'GET') return fichier(await review.exporter(acteur, teamId, id), url);
    if (n === 2 && sous === 'reperes' && methode === 'POST') return review.ajouterRepere(acteur, teamId, id, await lireCorps());
    if (n === 3 && sous === 'reperes' && methode === 'PATCH') return review.modifierRepere(acteur, teamId, id, repere, await lireCorps());
    if (n === 3 && sous === 'reperes' && methode === 'DELETE') return review.supprimerRepere(acteur, teamId, id, repere);
    if (n === 4 && sous === 'reperes' && p[3] === 'commentaires' && methode === 'POST') return review.commenter(acteur, teamId, id, repere, await lireCorps());
    if (n === 5 && sous === 'reperes' && p[3] === 'commentaires' && methode === 'DELETE') return review.supprimerCommentaire(acteur, teamId, id, repere, commentaire);
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  // scouting
  if (p[0] !== 'adversaires') throw echec(404, 'route', 'Adresse inconnue.');
  const [, a, sous, x, action] = p;
  if (n === 1 && methode === 'GET') return scouting.liste(acteur, teamId);
  if (n === 1 && methode === 'POST') return scouting.creer(acteur, teamId, await lireCorps());
  if (n === 2 && methode === 'GET') return scouting.detail(acteur, teamId, a);
  if (n === 2 && methode === 'PATCH') return scouting.modifier(acteur, teamId, a, await lireCorps());
  if (n === 2 && methode === 'DELETE') return scouting.supprimer(acteur, teamId, a);
  const types = { joueurs: ['ajouterJoueur', 'modifierJoueur', 'supprimerJoueur'], tendances: ['ajouterTendance', 'modifierTendance', 'supprimerTendance'], vods: ['ajouterVod', 'modifierVod', 'supprimerVod'] };
  if (types[sous]) {
    const [ajout, modif, suppr] = types[sous];
    if (n === 3 && methode === 'POST') return scouting[ajout](acteur, teamId, a, await lireCorps());
    if (n === 4 && methode === 'PATCH') return scouting[modif](acteur, teamId, a, x, await lireCorps());
    if (n === 4 && methode === 'DELETE') return scouting[suppr](acteur, teamId, a, x);
    if (n === 5 && sous === 'vods' && action === 'review' && methode === 'POST') return scouting.ouvrirVodEnReview(acteur, teamId, a, x, await lireCorps());
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
