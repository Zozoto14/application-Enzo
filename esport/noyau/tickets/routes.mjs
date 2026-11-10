/**
 * Routes HTTP des tickets (branchées par api.mjs, après l'authentification). Droits contrôlés dans les services
 * (acces.mjs : 404 sans tickets.voir ni tickets.configurer ; 403 sans la permission voulue ; catégorie du ticket
 * vérifiée pour chaque ticket).
 *
 *   GET           /tickets/moi ; /tickets/etat
 *   GET           /tickets/config ; /tickets/config/discord[?serveur=<id> : serveur choisi, pas encore enregistré]
 *   PUT           /tickets/config/(general|messages|horaires|commandes|bienvenue) ; POST /tickets/config/bienvenue/test
 *   POST          /tickets/config/categories ; PATCH|DELETE /tickets/config/categories/:id ; PUT …/categories/ordre
 *   POST          /tickets/config/categories/defaut { cles }   (catégories par défaut cochées, doublons de nom ignorés)
 *   POST          /tickets/config/panneaux ; PATCH|DELETE /tickets/config/panneaux/:id
 *   POST          /tickets/config/panneaux/defaut { modele, evenement?, categorieId?, ajouterManquantes? } (jamais publié)
 *   GET           /tickets/config/panneaux/:id/apercu ; POST …/:id/publier
 *   POST          /tickets/config/liste-noire ; DELETE /tickets/config/liste-noire/:discordId
 *   POST          /tickets/rgpd/(export|effacer) { discordId }   (Fondateur)
 *   GET           /tickets?statut&categorie&priorite&responsable&auteur&du&au&q ; /tickets/compteur ; /tickets/stats
 *   GET           /tickets/avis?categorie&note&du&au&responsable&tri   (tickets.gerer, ou configurer : ses catégories)
 *   POST          /tickets/supprimer { ids, garderAvis } ; /tickets/:id/supprimer { garderAvis }   (ticket FERMÉ : salon Discord supprimé,
 *                 ticket lisible 30 j dans « Supprimés ») ; /tickets/:id/restaurer { rouvrir } ; /tickets/:id/effacer { garderAvis }
 *                 (ticket supprimé : effacement définitif tout de suite)
 *   GET|PUT       /tickets/preferences (MP Discord)
 *   GET           /tickets/:id ; /tickets/:id/assignables ; /tickets/:id/transcript ; /tickets/:id/mentionnables?q
 *   POST          /tickets/:id/(lu|messages|notes|liaison|mentionner) ; /tickets/:id/pieces/:piece/lien
 *   POST          /tickets/:id/(prendre|liberer|attente|statut|priorite|fermer|rouvrir|assigner|categorie|ajouter|retirer|permanent)
 *   GET           /tickets/pieces/:piece?c&exp&sig  (lien signé, sans session)
 */

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

const MOTIF_ID = /^[0-9a-f-]{36}$/;
/** Réponse depuis l'app : jusqu'à 3 pièces jointes (5 Mo en tout) encodées en base64 dans le JSON. */
const TAILLE_REPONSE = 7 * 1024 * 1024 + 64 * 1024;

/** Pièce jointe d'un ticket par lien signé (sans session ; l'accès au ticket est revérifié). */
export async function routePieceTicket(tk, url, requete) {
  const p = /^\/tickets\/pieces\/([^/]+)$/.exec(url.pathname.replace(/^\/api\/esport(?=\/|$)/, ''));
  if (!p) return undefined;
  return tk.vue.servirPiece(p[1], url.searchParams, requete);
}

export async function routesTickets({ tk, acteur, chemin, methode: m, url, lireCorps, limite }) {
  if (chemin !== '/tickets' && !chemin.startsWith('/tickets/')) return undefined;
  const p = chemin.split('/').slice(2).map(segment);
  const n = p.length;
  const [a, b, c, d] = p;
  const cf = tk.config;

  if (n === 1 && a === 'moi' && m === 'GET') return cf.moi(acteur);
  if (n === 1 && a === 'etat' && m === 'GET') return cf.etat(acteur);
  const v = tk.vue;
  const q = url.searchParams;
  if (n === 0 && m === 'GET') return v.liste(acteur, Object.fromEntries(['statut', 'categorie', 'priorite', 'responsable', 'auteur', 'du', 'au', 'q'].map(k => [k, q.get(k) || undefined])));
  if (n === 1 && a === 'compteur' && m === 'GET') return v.compteur(acteur);
  if (n === 1 && a === 'stats' && m === 'GET') return v.stats(acteur, { du: q.get('du') || undefined, au: q.get('au') || undefined });
  if (n === 1 && a === 'avis' && m === 'GET') return v.avis(acteur, Object.fromEntries(['categorie', 'note', 'du', 'au', 'responsable', 'tri'].map(k => [k, q.get(k) || undefined])));
  if (n === 1 && a === 'supprimer' && m === 'POST') return v.supprimerPlusieurs(acteur, await lireCorps());
  if (n === 1 && a === 'preferences') {
    if (m === 'GET') return v.preferences(acteur);
    if (m === 'PUT') return v.changerPreferences(acteur, await lireCorps());
  }
  if (MOTIF_ID.test(a ?? '')) {
    if (n === 1 && m === 'GET') return v.detail(acteur, a);
    if (n === 2 && b === 'lu' && m === 'POST') return v.marquerLu(acteur, a);
    if (n === 2 && b === 'messages' && m === 'POST') {
      await limite('tickets_reponse', acteur.compte);
      return v.repondre(acteur, a, await lireCorps(TAILLE_REPONSE));
    }
    if (n === 2 && b === 'notes' && m === 'POST') return v.noter(acteur, a, await lireCorps());
    if (n === 2 && b === 'liaison' && m === 'POST') return v.lier(acteur, a, await lireCorps());
    if (n === 2 && b === 'assignables' && m === 'GET') return v.assignables(acteur, a);
    if (n === 2 && b === 'mentionnables' && m === 'GET') {
      // Lecture des rôles (et recherche de membres) sur Discord : comptée comme les autres lectures du serveur.
      await limite('tickets_discord', acteur.compte);
      return v.mentionnables(acteur, a, { q: q.get('q') || undefined });
    }
    if (n === 2 && b === 'mentionner' && m === 'POST') return v.mentionner(acteur, a, await lireCorps());
    if (n === 2 && b === 'transcript' && m === 'GET') {
      await limite('export', acteur.compte);
      return v.transcript(acteur, a, { langue: acteur.langue });
    }
    if (n === 4 && b === 'pieces' && d === 'lien' && m === 'POST') {
      const lien = await v.lienPiece(acteur, a, c, { telecharger: q.get('telecharger') === '1' });
      return { url: `${url.origin}${url.pathname.startsWith('/api/esport') ? '/api/esport' : ''}${lien.chemin}`, expire: lien.expire };
    }
    if (n === 2 && b === 'supprimer' && m === 'POST') return v.supprimer(acteur, a, await lireCorps());
    if (n === 2 && b === 'restaurer' && m === 'POST') return v.restaurer(acteur, a, await lireCorps());
    if (n === 2 && b === 'effacer' && m === 'POST') return v.effacer(acteur, a, await lireCorps());
    if (n === 2 && m === 'POST') return v.action(acteur, a, b, await lireCorps());
  }

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
      return cf.discord(acteur, { serveur: q.get('serveur') || undefined });
    }
    if (n === 2 && m === 'PUT') {
      if (b === 'general') return cf.changerGeneral(acteur, await lireCorps());
      if (b === 'messages') return cf.changerMessages(acteur, await lireCorps(128 * 1024));
      if (b === 'horaires') return cf.changerHoraires(acteur, await lireCorps());
      if (b === 'commandes') return cf.changerCommandes(acteur, await lireCorps());
      if (b === 'bienvenue') {
        await limite('tickets_discord', acteur.compte);
        return cf.changerBienvenue(acteur, await lireCorps());
      }
    }
    if (n === 3 && b === 'bienvenue' && c === 'test' && m === 'POST') {
      await limite('tickets_discord', acteur.compte);
      return cf.testerBienvenue(acteur);
    }
    if (b === 'categories') {
      if (n === 2 && m === 'POST') return cf.ajouterCategorie(acteur, await lireCorps());
      if (n === 3 && c === 'ordre' && m === 'PUT') return cf.ordonnerCategories(acteur, await lireCorps());
      if (n === 3 && c === 'defaut' && m === 'POST') return cf.ajouterModeles(acteur, await lireCorps());
      if (n === 3 && m === 'PATCH') return cf.modifierCategorie(acteur, c, await lireCorps());
      if (n === 3 && m === 'DELETE') return cf.supprimerCategorie(acteur, c);
    }
    if (b === 'panneaux') {
      if (n === 2 && m === 'POST') return cf.ajouterPanneau(acteur, await lireCorps());
      if (n === 3 && c === 'defaut' && m === 'POST') return cf.creerPanneauModele(acteur, await lireCorps());
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
