/**
 * Routes HTTP des modules « Tournois » et « Résultats », branchées par api.mjs. Session déjà vérifiée ;
 * appartenance, module et permission sont contrôlés dans tournois.mjs et resultats.mjs.
 *
 *   GET|POST          /teams/:t/tournois                         liste (?statut) ; créer (tournois.gerer)
 *   GET|PATCH|DELETE  /teams/:t/tournois/:id                     fiche, matchs, roster ; modifier ; supprimer
 *   PUT               /teams/:t/tournois/:id/roster              { titulaires, remplacants }
 *   POST              /teams/:t/tournois/:id/inscription         inscrire ({ annuler: true } : désinscrire)
 *   POST              /teams/:t/tournois/:id/checkin             check-in
 *   POST              /teams/:t/tournois/:id/matchs              ajouter un match (parcours) ; PATCH|DELETE …/matchs/:m
 *   GET               /teams/:t/tournois/:id/resume?langue=      résumé publiable (tournois.voir)
 *   GET               /teams/:t/tournois/matchs/:m/resume        résumé publiable d'une annonce de match
 *
 *   GET|POST          /teams/:t/resultats                        historique filtré + bilans (?jeu&tournoi&adversaire&du&au&carte&genre&issue) ; saisir
 *   GET               /teams/:t/resultats/formulaire             règles du jeu, maps, personnages, membres, matchs à saisir
 *   GET               /teams/:t/resultats/adversaires/:a         vue par adversaire
 *   GET|PATCH|DELETE  /teams/:t/resultats/:id                    détail ; modifier ; supprimer (resultats.saisir)
 *   GET               /teams/:t/resultats/:id/resume?langue=     résumé publiable (resultats.voir)
 *
 *   GET|POST          /teams/:t/competition/adversaires          noms (tournois.voir ou resultats.voir) ; création rapide
 *   GET               /teams/:t/competition/accueil              prochains matchs, tournois à venir, derniers résultats
 */

import { echec } from '../outils.mjs';
import { lireLangue } from '../langues.mjs';
import { MODULE_RESULTATS, MODULE_TOURNOIS, exigerModule, exigerUuid } from './commun.mjs';
import { resumeAnnonce, resumeResultat, resumeTournoi } from './resume.mjs';

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesCompetition({ tournois, resultats, socle, base, acteur, chemin, methode, url, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/(tournois|resultats|competition)(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, module, reste = ''] = m;
  const p = reste.split('/').filter(Boolean).map(segment);
  const n = p.length;
  const q = url.searchParams;
  const langue = lireLangue(q.get('langue')) ?? acteur.langue ?? 'fr';

  if (module === 'competition') {
    if (n === 1 && p[0] === 'adversaires' && methode === 'GET') return resultats.adversaires(acteur, teamId);
    if (n === 1 && p[0] === 'adversaires' && methode === 'POST') return resultats.creerAdversaire(acteur, teamId, await lireCorps());
    if (n === 1 && p[0] === 'accueil' && methode === 'GET') return resultats.accueil(acteur, teamId);
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  if (module === 'tournois') {
    if (n === 0 && methode === 'GET') return tournois.liste(acteur, teamId, { statut: q.get('statut') || undefined });
    if (n === 0 && methode === 'POST') return tournois.creer(acteur, teamId, await lireCorps());
    if (n === 3 && p[0] === 'matchs' && p[2] === 'resume' && methode === 'GET') {
      const ctx = await socle.contexteTeam(acteur, teamId);
      exigerModule(ctx, MODULE_TOURNOIS, 'tournois.voir');
      exigerUuid(p[1], 'match');
      const r = await resumeAnnonce(base, teamId, p[1], { langue });
      if (!r) throw echec(404, 'match-introuvable', 'Match introuvable.');
      return r;
    }
    const [id, a, b] = p;
    if (n === 1 && methode === 'GET') return tournois.detail(acteur, teamId, id);
    if (n === 1 && methode === 'PATCH') return tournois.modifier(acteur, teamId, id, await lireCorps());
    if (n === 1 && methode === 'DELETE') return tournois.supprimer(acteur, teamId, id);
    if (n === 2 && a === 'roster' && methode === 'PUT') return tournois.changerRoster(acteur, teamId, id, await lireCorps());
    if (n === 2 && a === 'inscription' && methode === 'POST') return tournois.inscrire(acteur, teamId, id, await lireCorps());
    if (n === 2 && a === 'checkin' && methode === 'POST') return tournois.checkin(acteur, teamId, id);
    if (n === 2 && a === 'matchs' && methode === 'POST') return tournois.ajouterMatch(acteur, teamId, id, await lireCorps());
    if (n === 3 && a === 'matchs' && methode === 'PATCH') return tournois.modifierMatch(acteur, teamId, id, b, await lireCorps());
    if (n === 3 && a === 'matchs' && methode === 'DELETE') return tournois.supprimerMatch(acteur, teamId, id, b);
    if (n === 2 && a === 'resume' && methode === 'GET') {
      await tournois.detail(acteur, teamId, id);
      const r = await resumeTournoi(base, teamId, id, { langue });
      if (!r) throw echec(404, 'tournoi-introuvable', 'Tournoi introuvable.');
      return r;
    }
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  // Résultats
  if (n === 0 && methode === 'GET') {
    return resultats.liste(acteur, teamId, {
      jeu: q.get('jeu') || undefined,
      tournoi: q.get('tournoi') || undefined,
      adversaire: q.get('adversaire') || undefined,
      du: q.get('du') || undefined,
      au: q.get('au') || undefined,
      carte: q.get('carte') || undefined,
      genre: q.get('genre') || undefined,
      issue: q.get('issue') || undefined,
    });
  }
  if (n === 0 && methode === 'POST') return resultats.creer(acteur, teamId, await lireCorps());
  if (n === 1 && p[0] === 'formulaire' && methode === 'GET') return resultats.formulaire(acteur, teamId);
  if (n === 2 && p[0] === 'adversaires' && methode === 'GET') return resultats.vueAdversaire(acteur, teamId, p[1]);
  const [id, a] = p;
  if (n === 1 && methode === 'GET') return resultats.detail(acteur, teamId, id);
  if (n === 1 && methode === 'PATCH') return resultats.modifier(acteur, teamId, id, await lireCorps());
  if (n === 1 && methode === 'DELETE') return resultats.supprimer(acteur, teamId, id);
  if (n === 2 && a === 'resume' && methode === 'GET') {
    const ctx = await resultats.contexte(acteur, teamId, 'resultats.voir');
    await resultats.resultatDeTeam(ctx, id);
    const r = await resumeResultat(base, teamId, id, { langue });
    if (!r) throw echec(404, 'resultat-introuvable', 'Résultat introuvable.');
    return r;
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}

export { MODULE_RESULTATS, MODULE_TOURNOIS };
