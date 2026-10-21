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
 *   PUT|DELETE          /teams/:t/review/:id/reperes/:r/reaction           réagir (👍 / 👎) au repère, retirer
 *   PUT|DELETE          /teams/:t/review/:id/reperes/:r/commentaires/:c/reaction  réagir au commentaire, retirer
 *   POST                /teams/:t/review/:id/video/lien                    lien signé (2 h) de la vidéo déposée
 *   POST                /teams/:t/review/envois                            envoi d'une vidéo par morceaux (medias/service.mjs)
 *   GET|DELETE          /teams/:t/review/envois/:e                         état (reprise), annulation
 *   PUT                 /teams/:t/review/envois/:e/morceaux/:i             un morceau (binaire, X-Sha256)
 *   POST                /teams/:t/review/envois/:e/fin                     fin de l'envoi { sha256 }
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

/**
 * Envoi par morceaux (vidéo d'une review, enregistrement d'une réunion) : `p` = segments après
 * « envois ». Partagé avec les routes des résumés.
 */
export async function routesEnvois({ medias, acteur, teamId, usage, p, methode, requete, lireCorps }) {
  const [e, sous, indice] = p;
  const n = p.length;
  if (n === 0 && methode === 'POST') return medias.debuterEnvoi(acteur, teamId, usage, await lireCorps());
  if (n === 1 && methode === 'GET') return medias.etatEnvoi(acteur, teamId, usage, e);
  if (n === 1 && methode === 'DELETE') return medias.annulerEnvoi(acteur, teamId, usage, e);
  if (n === 3 && sous === 'morceaux' && methode === 'PUT') return medias.recevoirMorceau(acteur, teamId, usage, e, indice, requete);
  if (n === 2 && sous === 'fin' && methode === 'POST') return medias.terminerEnvoi(acteur, teamId, usage, e, await lireCorps());
  throw echec(404, 'route', 'Adresse inconnue.');
}

export async function routesReview({ review, scouting, medias, acteur, chemin, methode, url, requete, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/(review|scouting)(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, section, reste = ''] = m;
  const p = reste.split('/').filter(Boolean).map(segment);
  const n = p.length;

  if (section === 'review') {
    if (p[0] === 'envois' && medias) return routesEnvois({ medias, acteur, teamId, usage: 'review', p: p.slice(1), methode, requete, lireCorps });
    const [id, sous, repere, , commentaire] = p;
    if (n === 0 && methode === 'GET') return review.liste(acteur, teamId);
    if (n === 0 && methode === 'POST') return review.creer(acteur, teamId, await lireCorps());
    if (n === 1 && methode === 'GET') return review.detail(acteur, teamId, id);
    if (n === 1 && methode === 'PATCH') return review.modifier(acteur, teamId, id, await lireCorps());
    if (n === 1 && methode === 'DELETE') return review.supprimer(acteur, teamId, id);
    if (n === 2 && sous === 'export.md' && methode === 'GET') return fichier(await review.exporter(acteur, teamId, id), url);
    if (n === 3 && sous === 'video' && p[2] === 'lien' && methode === 'POST') {
      const { chemin: lien, expire } = await review.lienVideo(acteur, teamId, id);
      const prefixe = url.pathname.startsWith('/api/esport') ? '/api/esport' : '';
      return { url: `${url.origin}${prefixe}${lien}`, expire: new Date(expire).toISOString() };
    }
    if (n === 2 && sous === 'reperes' && methode === 'POST') return review.ajouterRepere(acteur, teamId, id, await lireCorps());
    if (n === 3 && sous === 'reperes' && methode === 'PATCH') return review.modifierRepere(acteur, teamId, id, repere, await lireCorps());
    if (n === 3 && sous === 'reperes' && methode === 'DELETE') return review.supprimerRepere(acteur, teamId, id, repere);
    if (n === 4 && sous === 'reperes' && p[3] === 'commentaires' && methode === 'POST') return review.commenter(acteur, teamId, id, repere, await lireCorps());
    if (n === 5 && sous === 'reperes' && p[3] === 'commentaires' && methode === 'DELETE') return review.supprimerCommentaire(acteur, teamId, id, repere, commentaire);
    if (n === 4 && sous === 'reperes' && p[3] === 'reaction' && (methode === 'PUT' || methode === 'DELETE')) {
      return review.reagir(acteur, teamId, id, repere, undefined, methode === 'DELETE' ? { valeur: null } : await lireCorps());
    }
    if (n === 6 && sous === 'reperes' && p[3] === 'commentaires' && p[5] === 'reaction' && (methode === 'PUT' || methode === 'DELETE')) {
      return review.reagir(acteur, teamId, id, repere, commentaire, methode === 'DELETE' ? { valeur: null } : await lireCorps());
    }
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
