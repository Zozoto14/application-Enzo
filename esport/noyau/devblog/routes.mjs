/**
 * Routes HTTP du devblog (branchées par api.mjs, après l'authentification) ; droits contrôlés dans le service.
 *
 *   GET|POST            /devblog                       liste (publiés ; brouillons en plus pour les gestionnaires) ; nouveau brouillon
 *   GET                 /devblog/nouveautes            dernier devblog publié pas encore vu par ce compte (ou null)
 *   GET|PUT             /devblog/salons                salons Discord possibles, cochés par défaut, salon du bot, nouveau webhook
 *   POST                /devblog/ia/traduire           { fr } → { en } (proposition à relire)
 *   GET|PATCH|DELETE    /devblog/:id                   détail ; { date?, version?, fr?, en?, statut? } ; suppression
 *   POST                /devblog/:id/vu                « J'ai compris » (fenêtre Nouveautés)
 *   GET|POST            /devblog/:id/discord           aperçu et état (?here=0|1) ; { cibles, mentionHere? } publier / corriger
 *   POST                /devblog/:id/tout-publier      « 🚀 Tout publier » : app + salons { cibles, mentionHere? }
 *   PUT|DELETE          /devblog/:id/programmation     { le, cibles?, mentionHere? } publication programmée ; annulation
 *   GET|PUT             /devblog/auto                  mode automatique : réglages, prochain passage, journal (?attente=1)
 *   POST                /devblog/auto/generer          « Générer maintenant » (brouillon de test)
 */

import { echec } from '../outils.mjs';

const TAILLE_MAX_DEVBLOG = 128 * 1024;

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesDevblog({ dv, acteur, chemin, methode: m, url, lireCorps, limite }) {
  if (chemin !== '/devblog' && !chemin.startsWith('/devblog/')) return undefined;
  if (chemin === '/devblog') {
    if (m === 'GET') return dv.liste(acteur);
    if (m === 'POST') return dv.creer(acteur, await lireCorps(TAILLE_MAX_DEVBLOG));
  }
  if (chemin === '/devblog/nouveautes' && m === 'GET') return dv.nouveautes(acteur);
  if (chemin === '/devblog/salons') {
    if (m === 'GET') return dv.salons(acteur);
    if (m === 'PUT') return dv.reglerSalons(acteur, await lireCorps());
  }
  if (chemin === '/devblog/ia/traduire' && m === 'POST') {
    const corps = await lireCorps(TAILLE_MAX_DEVBLOG);
    await limite('devblog_ia', acteur.compte);
    return dv.traduire(acteur, corps);
  }
  if (chemin === '/devblog/auto') {
    if (m === 'GET') return dv.lireAuto(acteur, { attente: url.searchParams.get('attente') === '1' });
    if (m === 'PUT') return dv.reglerAuto(acteur, await lireCorps());
  }
  if (chemin === '/devblog/auto/generer' && m === 'POST') {
    await limite('devblog_ia', acteur.compte);
    return dv.generer(acteur);
  }
  const e = /^\/devblog\/([^/]+)(?:\/(vu|discord|tout-publier|programmation))?$/.exec(chemin);
  if (e) {
    const id = segment(e[1]);
    if (!e[2]) {
      if (m === 'GET') return dv.detail(acteur, id);
      if (m === 'PATCH') return dv.modifier(acteur, id, await lireCorps(TAILLE_MAX_DEVBLOG));
      if (m === 'DELETE') return dv.supprimer(acteur, id);
    }
    if (e[2] === 'vu' && m === 'POST') return dv.marquerVu(acteur, id);
    if (e[2] === 'tout-publier' && m === 'POST') {
      const corps = await lireCorps();
      await limite('devblog_discord', acteur.compte);
      return dv.toutPublier(acteur, id, corps);
    }
    if (e[2] === 'programmation') {
      if (m === 'PUT') return dv.programmer(acteur, id, await lireCorps());
      if (m === 'DELETE') return dv.annulerProgrammation(acteur, id);
    }
    if (e[2] === 'discord') {
      if (m === 'GET') return dv.etatDiscord(acteur, id, { here: url.searchParams.get('here') !== '0' });
      if (m === 'POST') {
        const corps = await lireCorps();
        await limite('devblog_discord', acteur.compte);
        return dv.publierDiscord(acteur, id, corps);
      }
    }
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
