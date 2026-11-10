/**
 * Routes HTTP des rôles temporaires (branchées par api.mjs, après l'authentification ; droits contrôlés dans les
 * services) :
 *
 *   GET    /teams/:t/roles-temporaires              réglages (si autorisé), octrois actifs, droits
 *   PUT    /teams/:t/roles-temporaires/reglages     réglages de la team (discord.manage)
 *   GET    /teams/:t/roles-temporaires/discord      rôles et salons du serveur Discord, position du bot
 *   GET    /teams/:t/roles-temporaires/membres?q=   recherche d'une personne du serveur Discord
 *   POST   /teams/:t/roles-temporaires              donner (ou prolonger) : { membreId, membreNom, dureeH, raison }
 *   POST   /teams/:t/roles-temporaires/:id/prolonger  { dureeH }
 *   DELETE /teams/:t/roles-temporaires/:id          retirer tout de suite
 *
 *   GET    /roles-temp/config                       vue d'ensemble des teams et commandes /role-temp
 *   PUT    /roles-temp/config/commandes             commandes activées et rôles Discord autorisés
 *   GET    /roles-temp/discord                      rôles du serveur du club
 */

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesRolesTemp({ rt, acteur, chemin, methode: m, url, lireCorps, limite }) {
  const t = /^\/teams\/([^/]+)\/roles-temporaires(\/.*)?$/.exec(chemin);
  if (t) {
    const teamId = segment(t[1]);
    const p = (t[2] ?? '').split('/').filter(Boolean).map(segment);
    if (p.length === 0) {
      if (m === 'GET') return rt.etat(acteur, teamId);
      if (m === 'POST') {
        await limite('tickets_discord', acteur.compte);
        return rt.donner(acteur, teamId, await lireCorps());
      }
    }
    if (p.length === 1 && p[0] === 'reglages' && m === 'PUT') {
      await limite('tickets_discord', acteur.compte);
      return rt.changerReglages(acteur, teamId, await lireCorps());
    }
    if (p.length === 1 && p[0] === 'discord' && m === 'GET') {
      await limite('tickets_discord', acteur.compte);
      return rt.discord(acteur, teamId);
    }
    if (p.length === 1 && p[0] === 'membres' && m === 'GET') {
      await limite('tickets_discord', acteur.compte);
      return rt.membres(acteur, teamId, url?.searchParams?.get('q'));
    }
    if (p.length === 2 && p[1] === 'prolonger' && m === 'POST') {
      await limite('tickets_discord', acteur.compte);
      return rt.prolonger(acteur, teamId, p[0], await lireCorps());
    }
    if (p.length === 1 && m === 'DELETE') {
      await limite('tickets_discord', acteur.compte);
      return rt.retirer(acteur, teamId, p[0]);
    }
    return undefined;
  }
  if (chemin !== '/roles-temp' && !chemin.startsWith('/roles-temp/')) return undefined;
  const p = chemin.split('/').slice(2);
  if (p.length === 1 && p[0] === 'config' && m === 'GET') return rt.config(acteur);
  if (p.length === 2 && p[0] === 'config' && p[1] === 'commandes' && m === 'PUT') return rt.changerCommandes(acteur, await lireCorps());
  if (p.length === 1 && p[0] === 'discord' && m === 'GET') {
    await limite('tickets_discord', acteur.compte);
    return rt.discordClub(acteur);
  }
  return undefined;
}
