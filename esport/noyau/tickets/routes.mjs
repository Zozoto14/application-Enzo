/**
 * Routes HTTP des tickets (branchées par api.mjs, après l'authentification). Droits contrôlés dans les services
 * (acces.mjs : 404 sans tickets.voir ni tickets.configurer ; 403 sans la permission voulue ; catégorie du ticket
 * vérifiée pour chaque ticket).
 *
 *   GET           /tickets/moi ; /tickets/etat
 *   GET           /tickets/config ; /tickets/config/discord
 *   PUT           /tickets/config/(general|messages|horaires|commandes)
 *   POST          /tickets/config/categories ; PATCH|DELETE /tickets/config/categories/:id ; PUT …/categories/ordre
 *   POST          /tickets/config/panneaux ; PATCH|DELETE /tickets/config/panneaux/:id
 *   GET           /tickets/config/panneaux/:id/apercu ; POST …/:id/publier
 *   POST          /tickets/config/liste-noire ; DELETE /tickets/config/liste-noire/:discordId
 *   POST          /tickets/rgpd/(export|effacer) { discordId }   (Fondateur)
 */

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesTickets({ tk, acteur, chemin, methode: m, lireCorps, limite }) {
  if (chemin !== '/tickets' && !chemin.startsWith('/tickets/')) return undefined;
  const p = chemin.split('/').slice(2).map(segment);
  const n = p.length;
  const [a, b, c, d] = p;
  const cf = tk.config;

  if (n === 1 && a === 'moi' && m === 'GET') return cf.moi(acteur);
  if (n === 1 && a === 'etat' && m === 'GET') return cf.etat(acteur);

  // RGPD d'une personne sans compte (Discord ID) : le Fondateur seul.
  if (n === 2 && a === 'rgpd' && m === 'POST') {
    await limite('export', acteur.compte);
    if (b === 'export') return tk.rgpd.exporter(acteur, await lireCorps());
    if (b === 'effacer') return tk.rgpd.effacer(acteur, await lireCorps());
  }
  if (a === 'config') {
    if (n === 1 && m === 'GET') return cf.config(acteur);
    if (n === 2 && b === 'discord' && m === 'GET') {
      await limite('tickets_discord', acteur.compte);
      return cf.discord(acteur);
    }
    if (n === 2 && m === 'PUT') {
      if (b === 'general') return cf.changerGeneral(acteur, await lireCorps());
      if (b === 'messages') return cf.changerMessages(acteur, await lireCorps(128 * 1024));
      if (b === 'horaires') return cf.changerHoraires(acteur, await lireCorps());
      if (b === 'commandes') return cf.changerCommandes(acteur, await lireCorps());
    }
    if (b === 'categories') {
      if (n === 2 && m === 'POST') return cf.ajouterCategorie(acteur, await lireCorps());
      if (n === 3 && c === 'ordre' && m === 'PUT') return cf.ordonnerCategories(acteur, await lireCorps());
      if (n === 3 && m === 'PATCH') return cf.modifierCategorie(acteur, c, await lireCorps());
      if (n === 3 && m === 'DELETE') return cf.supprimerCategorie(acteur, c);
    }
    if (b === 'panneaux') {
      if (n === 2 && m === 'POST') return cf.ajouterPanneau(acteur, await lireCorps());
      if (n === 3 && m === 'PATCH') return cf.modifierPanneau(acteur, c, await lireCorps());
      if (n === 3 && m === 'DELETE') return cf.supprimerPanneau(acteur, c);
      if (n === 4 && d === 'apercu' && m === 'GET') return cf.apercuPanneau(acteur, c);
      if (n === 4 && d === 'publier' && m === 'POST') {
        await limite('tickets_discord', acteur.compte);
        return cf.publierPanneau(acteur, c);
      }
    }
    if (b === 'liste-noire') {
      if (n === 2 && m === 'POST') return cf.ajouterListeNoire(acteur, await lireCorps());
      if (n === 3 && m === 'DELETE') return cf.retirerListeNoire(acteur, c);
    }
  }
  return undefined;
}
