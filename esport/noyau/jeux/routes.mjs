/**
 * Routes HTTP des profils de jeu (branchées par api.mjs, après l'authentification) :
 *
 *   GET    /jeux                                  profils actifs (?tous=1 : tous, gestionnaire)
 *   POST   /jeux                                  créer un profil (jeux.gerer)
 *   GET    /jeux/:cle                             profil complet
 *   PATCH  /jeux/:cle                             modifier (nouvelle version ; `version` attendue)
 *   DELETE /jeux/:cle                             supprimer (aucune team ne l'utilise)
 *   POST   /jeux/:cle/archiver                    { archive } (plus proposé à la création de team)
 *   GET    /jeux/:cle/versions                    historique ; GET /jeux/:cle/versions/:n ; POST …/:n/restaurer
 *   PUT    /jeux/:cle/maj                         { majAuto, frequenceJours } (vérification automatique)
 *   POST   /jeux/:cle/verifier                    vérification manuelle (IA)
 *   GET    /jeux/propositions                     différences proposées (?jeu=&statut=)
 *   POST   /jeux/:cle/propositions/decider        { acceptees, refusees, corrections }
 *   GET    /jeux/ia                               état de l'IA (mode, IA locale, fournisseur, modèle, clé présente/absente, quota)
 *   PUT    /jeux/ia/reglages                      mode (local, api, local-api), plafonds mensuels, automatique (Fondateur)
 *   POST   /jeux/ia/test                          test de connexion { cible?: local | api } (Fondateur) : résultat, ou
 *                                                  { enCours, test: { id } } s'il dure plus de 10 s (tâche de fond)
 *   GET    /jeux/ia/test/:id                      résultat d'un test lancé en tâche de fond
 *   GET|PUT /jeux/ia/gestionnaires                délégation de jeux.gerer (Fondateur)
 *   POST   /jeux/ia/brouillons                    « Préparer avec l'IA »
 *   GET    /jeux/ia/travaux                       brouillons et vérifications (?genre=&jeu=)
 *   GET    /jeux/ia/travaux/:id                   détail (brouillon complet)
 *   POST   /jeux/ia/travaux/:id/valider           le Fondateur valide le brouillon corrigé
 *   DELETE /jeux/ia/travaux/:id                   abandonner
 *   POST   /jeux/:cle/importer                    images des maps et échelle téléchargées par le serveur (jeux.gerer) { version, urls?, remplacer? }
 *   POST   /jeux/:cle/images                      dépôt d'une image (fond de map) { type, donnees base64, nom } (jeux.gerer)
 *   GET    /jeux/images/:id?c&exp&sig             image par lien signé (sans session, routeImageJeu)
 *   GET    /teams/:id/jeu                         profil du jeu de la team (tout membre)
 *
 * Les profils rendus portent `images` : liens signés (6 h) des images citées par les maps.
 */

import { echec } from '../outils.mjs';

/** Corps d'un dépôt d'image : 12 Mo en base64, avec de la marge. */
export const TAILLE_MAX_CORPS_IMAGE_JEU = 17 * 1024 * 1024;
/** Corps d'un profil (1 Mo de données, avec l'en-tête). */
const TAILLE_MAX_CORPS_PROFIL = 1024 * 1024 + 8192;

/** Image d'un profil par lien signé (avant la session). */
export async function routeImageJeu(jeux, url, requete) {
  const f = /^\/jeux\/images\/([^/]+)$/.exec(url.pathname.replace(/^\/api\/esport(?=\/|$)/, ''));
  if (!f) return undefined;
  return jeux.servirImage(decodeURIComponent(f[1]), url.searchParams, requete);
}

/** Les liens signés d'images sont relatifs : préfixés ici par l'adresse du serveur. */
function prefixer(r, origine) {
  const fixer = images => {
    if (!images || typeof images !== 'object') return;
    for (const v of Object.values(images)) if (v?.url && v.url.startsWith('/')) v.url = `${origine}${v.url}`;
  };
  if (r && typeof r === 'object') {
    fixer(r.images);
    fixer(r.jeu?.images);
    if (typeof r.url === 'string' && r.url.startsWith('/jeux/images/')) r.url = `${origine}${r.url}`;
  }
  return r;
}

export async function routesJeux(params) {
  const r = await routesJeuxBrutes(params);
  const { url } = params;
  return prefixer(r, `${url.origin}${url.pathname.startsWith('/api/esport') ? '/api/esport' : ''}`);
}

async function routesJeuxBrutes({ jeux, acteur, chemin, methode: m, url, lireCorps, limite }) {
  const tj = /^\/teams\/([^/]+)\/jeu$/.exec(chemin);
  if (tj && m === 'GET') return jeux.pourTeam(acteur, decodeURIComponent(tj[1]));
  if (chemin !== '/jeux' && !chemin.startsWith('/jeux/')) return undefined;
  const q = url.searchParams;
  const p = chemin.split('/').slice(2).map(decodeURIComponent);

  if (p.length === 0) {
    if (m === 'GET') return jeux.liste(acteur, { tous: q.get('tous') === '1' });
    if (m === 'POST') return jeux.creer(acteur, await lireCorps(TAILLE_MAX_CORPS_PROFIL));
  }
  if (p[0] === 'propositions' && p.length === 1 && m === 'GET') return jeux.propositions(acteur, { jeu: q.get('jeu') || undefined, statut: q.get('statut') || undefined });
  if (p[0] === 'ia') {
    if (p.length === 1 && m === 'GET') return jeux.etatIa(acteur);
    if (p[1] === 'reglages' && p.length === 2 && m === 'PUT') return jeux.reglerIa(acteur, await lireCorps());
    if (p[1] === 'test' && p.length === 2 && m === 'POST') {
      const corps = await lireCorps();
      await limite('ia', acteur.compte);
      return jeux.testerIa(acteur, corps);
    }
    if (p[1] === 'test' && p.length === 3 && m === 'GET') return jeux.etatTestIa(acteur, p[2]);
    if (p[1] === 'gestionnaires' && p.length === 2) {
      if (m === 'GET') return jeux.gestionnaires(acteur);
      if (m === 'PUT') return jeux.reglerGestionnaires(acteur, await lireCorps());
    }
    if (p[1] === 'brouillons' && p.length === 2 && m === 'POST') {
      const corps = await lireCorps();
      await limite('ia', acteur.compte);
      return jeux.lancerBrouillon(acteur, corps);
    }
    if (p[1] === 'travaux') {
      if (p.length === 2 && m === 'GET') return jeux.travaux(acteur, { genre: q.get('genre') || undefined, jeu: q.get('jeu') || undefined });
      if (p.length === 3 && m === 'GET') return jeux.travail(acteur, p[2]);
      if (p.length === 3 && m === 'DELETE') return jeux.abandonnerTravail(acteur, p[2]);
      if (p.length === 4 && p[3] === 'valider' && m === 'POST') return jeux.validerBrouillon(acteur, p[2], await lireCorps(TAILLE_MAX_CORPS_PROFIL));
    }
    throw echec(404, 'route', 'Adresse inconnue.');
  }
  const cle = p[0];
  if (p.length === 1) {
    if (m === 'GET') return jeux.detail(acteur, cle);
    if (m === 'PATCH') return jeux.modifier(acteur, cle, await lireCorps(TAILLE_MAX_CORPS_PROFIL));
    if (m === 'DELETE') return jeux.supprimer(acteur, cle);
  }
  if (p[1] === 'archiver' && p.length === 2 && m === 'POST') return jeux.archiver(acteur, cle, await lireCorps());
  if (p[1] === 'importer' && p.length === 2 && m === 'POST') {
    const corps = await lireCorps();
    await limite('ia', acteur.compte);
    return jeux.importerCartes(acteur, cle, corps);
  }
  if (p[1] === 'images' && p.length === 2 && m === 'POST') return jeux.deposerImage(acteur, cle, await lireCorps(TAILLE_MAX_CORPS_IMAGE_JEU));
  if (p[1] === 'maj' && p.length === 2 && m === 'PUT') return jeux.reglerMaj(acteur, cle, await lireCorps());
  if (p[1] === 'verifier' && p.length === 2 && m === 'POST') {
    await limite('ia', acteur.compte);
    return jeux.lancerVerification(acteur, cle);
  }
  if (p[1] === 'versions') {
    if (p.length === 2 && m === 'GET') return jeux.versions(acteur, cle);
    if (p.length === 3 && m === 'GET') return jeux.version(acteur, cle, p[2]);
    if (p.length === 4 && p[3] === 'restaurer' && m === 'POST') return jeux.restaurer(acteur, cle, p[2], await lireCorps());
  }
  if (p[1] === 'propositions' && p[2] === 'decider' && p.length === 3 && m === 'POST') return jeux.deciderPropositions(acteur, cle, await lireCorps(512 * 1024));
  throw echec(404, 'route', 'Adresse inconnue.');
}
