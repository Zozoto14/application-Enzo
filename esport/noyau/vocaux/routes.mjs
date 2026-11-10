/**
 * Routes HTTP des salons vocaux temporaires (branchées par api.mjs, après l'authentification ; permission
 * `vocaux.configurer` contrôlée dans les services) :
 *
 *   GET  /vocaux/config            réglages, commandes /voc, connexion, salons temporaires ouverts
 *   PUT  /vocaux/config            réglages (activation, hubs, rôles du staff, délai, salons par membre…)
 *   PUT  /vocaux/config/commandes  commandes /voc activées et rôles autorisés
 *   GET  /vocaux/discord           salons vocaux, catégories, salons écrits, rôles, permissions du bot
 *
 * Les équipes des événements du club et leurs rôles Discord : esport/noyau/evenements-club/ (routes /evenements).
 */

export async function routesVocaux({ vc, acteur, chemin, methode: m, lireCorps, limite }) {
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
