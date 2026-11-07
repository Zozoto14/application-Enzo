/**
 * Routes HTTP des salons vocaux temporaires (branchées par api.mjs, après l'authentification ; permission
 * `vocaux.configurer` contrôlée dans les services) :
 *
 *   GET  /vocaux/config            réglages, commandes /voc, connexion, salons temporaires ouverts
 *   PUT  /vocaux/config            réglages (activation, hubs, rôles du staff, délai, salons par membre…)
 *   PUT  /vocaux/config/commandes  commandes /voc activées et rôles autorisés
 *   GET  /vocaux/discord           salons vocaux, catégories, salons écrits, rôles, permissions du bot
 *
 * Équipes d'un tournoi et rôles Discord (tournoi.mjs ; tournois.gerer, et vocaux.configurer pour Discord) :
 *   GET|PUT  /teams/:t/tournois/:id/discord                  équipes, réglages (modèle des rôles, couleur, délai…)
 *   POST     /teams/:t/tournois/:id/discord/equipes          { equipes: [...] } ajout
 *   PATCH|DELETE /teams/:t/tournois/:id/discord/equipes/:e   modifier ; supprimer (son rôle aussi)
 *   POST     /teams/:t/tournois/:id/discord/import           { categorieId } propositions lues dans les tickets
 *   POST     /teams/:t/tournois/:id/discord/roles            créer les rôles et les donner (bilan)
 *   POST     /teams/:t/tournois/:id/discord/roles/supprimer  supprimer les rôles et les salons des équipes
 */

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesVocaux({ vc, eq, acteur, chemin, methode: m, lireCorps, limite }) {
  const t = eq ? /^\/teams\/([^/]+)\/tournois\/([^/]+)\/discord(\/.*)?$/.exec(chemin) : null;
  if (t) {
    const [, teamId, id, reste = ''] = t.map(x => (x === undefined ? undefined : segment(x)));
    const p = reste.split('/').filter(Boolean).map(segment);
    if (p.length === 0 && m === 'GET') return eq.lire(acteur, teamId, id);
    if (p.length === 0 && m === 'PUT') return eq.changerReglages(acteur, teamId, id, await lireCorps());
    if (p[0] === 'equipes') {
      if (p.length === 1 && m === 'POST') return eq.ajouterEquipes(acteur, teamId, id, await lireCorps(256 * 1024));
      if (p.length === 2 && m === 'PATCH') return eq.modifierEquipe(acteur, teamId, id, p[1], await lireCorps());
      if (p.length === 2 && m === 'DELETE') return eq.supprimerEquipe(acteur, teamId, id, p[1]);
    }
    if (p.length === 1 && p[0] === 'import' && m === 'POST') {
      await limite('tickets_discord', acteur.compte);
      return eq.importer(acteur, teamId, id, await lireCorps());
    }
    if (p[0] === 'roles' && m === 'POST') {
      await limite('tickets_discord', acteur.compte);
      if (p.length === 1) return eq.creerRoles(acteur, teamId, id);
      if (p.length === 2 && p[1] === 'supprimer') return eq.supprimerRoles(acteur, teamId, id);
    }
    return undefined;
  }
  if (chemin !== '/vocaux' && !chemin.startsWith('/vocaux/')) return undefined;
  const p = chemin.split('/').slice(2);
  if (p.length === 1 && p[0] === 'config') {
    if (m === 'GET') return vc.config(acteur);
    if (m === 'PUT') return vc.changer(acteur, await lireCorps());
  }
  if (p.length === 2 && p[0] === 'config' && p[1] === 'commandes' && m === 'PUT') return vc.changerCommandes(acteur, await lireCorps());
  if (p.length === 1 && p[0] === 'discord' && m === 'GET') {
    await limite('tickets_discord', acteur.compte);
    return vc.discord(acteur);
  }
  return undefined;
}
