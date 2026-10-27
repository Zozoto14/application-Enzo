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
 *   GET    /jeux/ia                               état de l'IA (fournisseur, modèle, clé présente/absente, quota)
 *   PUT    /jeux/ia/reglages                      plafonds mensuels, automatique (Fondateur)
 *   POST   /jeux/ia/test                          test de connexion (Fondateur)
 *   GET|PUT /jeux/ia/gestionnaires                délégation de jeux.gerer (Fondateur)
 *   POST   /jeux/ia/brouillons                    « Préparer avec l'IA »
 *   GET    /jeux/ia/travaux                       brouillons et vérifications (?genre=&jeu=)
 *   GET    /jeux/ia/travaux/:id                   détail (brouillon complet)
 *   POST   /jeux/ia/travaux/:id/valider           le Fondateur valide le brouillon corrigé
 *   DELETE /jeux/ia/travaux/:id                   abandonner
 *   GET    /teams/:id/jeu                         profil du jeu de la team (tout membre)
 */

import { echec } from '../outils.mjs';

export async function routesJeux({ jeux, acteur, chemin, methode: m, url, lireCorps, limite }) {
  const tj = /^\/teams\/([^/]+)\/jeu$/.exec(chemin);
  if (tj && m === 'GET') return jeux.pourTeam(acteur, decodeURIComponent(tj[1]));
  if (chemin !== '/jeux' && !chemin.startsWith('/jeux/')) return undefined;
  const q = url.searchParams;
  const p = chemin.split('/').slice(2).map(decodeURIComponent);

  if (p.length === 0) {
    if (m === 'GET') return jeux.liste(acteur, { tous: q.get('tous') === '1' });
    if (m === 'POST') return jeux.creer(acteur, await lireCorps(256 * 1024 + 4096));
  }
  if (p[0] === 'propositions' && p.length === 1 && m === 'GET') return jeux.propositions(acteur, { jeu: q.get('jeu') || undefined, statut: q.get('statut') || undefined });
  if (p[0] === 'ia') {
    if (p.length === 1 && m === 'GET') return jeux.etatIa(acteur);
    if (p[1] === 'reglages' && p.length === 2 && m === 'PUT') return jeux.reglerIa(acteur, await lireCorps());
    if (p[1] === 'test' && p.length === 2 && m === 'POST') {
      await limite('ia', acteur.compte);
      return jeux.testerIa(acteur);
    }
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
      if (p.length === 4 && p[3] === 'valider' && m === 'POST') return jeux.validerBrouillon(acteur, p[2], await lireCorps(256 * 1024 + 4096));
    }
    throw echec(404, 'route', 'Adresse inconnue.');
  }
  const cle = p[0];
  if (p.length === 1) {
    if (m === 'GET') return jeux.detail(acteur, cle);
    if (m === 'PATCH') return jeux.modifier(acteur, cle, await lireCorps(256 * 1024 + 4096));
    if (m === 'DELETE') return jeux.supprimer(acteur, cle);
  }
  if (p[1] === 'archiver' && p.length === 2 && m === 'POST') return jeux.archiver(acteur, cle, await lireCorps());
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
