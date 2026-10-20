/**
 * Routes HTTP du planning, des disponibilités et de la présence. Appelées
 * par le routeur principal (api.mjs) ; rendent `undefined` si l'adresse ne
 * les concerne pas.
 *
 *   GET  /ical/<jeton>.ics                                   abonnement (sans session : jeton révocable)
 *   GET|POST           /teams/:t/planning                    liste (?debut&fin&fuseau&types&membre), création
 *   GET                /teams/:t/planning/accueil            prochains événements, alertes de présence
 *   GET|PUT            /teams/:t/planning/reglages           effectif minimum, rappel
 *   GET                /teams/:t/planning/export.ics         export iCal (?format=json : enveloppe JSON)
 *   GET|POST           /teams/:t/planning/ical               mes abonnements iCal ; nouveau
 *   DELETE             /teams/:t/planning/ical/:id           révoquer
 *   GET|PATCH|DELETE   /teams/:t/planning/:e                 détail, série, suppression (?portee&occurrence)
 *   PATCH              /teams/:t/planning/:e/occurrences/:o  une occurrence
 *   PUT                /teams/:t/planning/:e/occurrences/:o/rsvp
 *   GET|PUT            /teams/:t/planning/:e/occurrences/:o/presence
 *   GET                /teams/:t/presence/stats              (?debut&fin&types&granularite)
 *   GET                /teams/:t/presence/export.csv
 *   GET                /teams/:t/presence/a-marquer         séances commencées à marquer (staff)
 *   GET                /teams/:t/presence/historique        par séance (?debut&fin|periode&types)
 *   GET                /teams/:t/presence/joueurs/:c        fiche d'un joueur (« moi » : la sienne)
 *   GET                /teams/:t/dispos/moi ; PUT …/moi/regles ; POST …/moi/exceptions ; DELETE …/moi/exceptions/:id
 *   GET                /teams/:t/dispos/carte                heatmap (?semaine&fuseau&pas)
 */

import { ENTETES_FICHIER, disposition } from '../entetes.mjs';

/** Fichier : brut (Content-Disposition) ou, avec ?format=json, enveloppe `{ nom, type, contenu }`. */
function fichier(f, url, enLigne = false) {
  if (url.searchParams.get('format') === 'json') return f;
  return new Response(f.contenu, {
    status: 200,
    headers: { ...ENTETES_FICHIER, 'Content-Type': f.type, 'Content-Disposition': disposition(f.nom, enLigne) },
  });
}

const parametres = url => Object.fromEntries(url.searchParams.entries());
const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

/** Route publique (avant la session). */
export async function routePublique({ p, chemin, methode, url }) {
  const m = /^\/ical\/([^/]+)\.ics$/.exec(chemin);
  if (m && methode === 'GET') return fichier(await p.icsAbonnement(segment(m[1])), url, true);
  return undefined;
}

/** Routes de team (session obligatoire, déjà vérifiée). */
export async function routesPlanning({ p, acteur, chemin, methode, url, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/(planning|presence|dispos)(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, section, reste = ''] = m;
  const morceaux = reste.split('/').filter(Boolean).map(segment);
  const q = parametres(url);
  const [a, b, c, d] = morceaux;
  const n = morceaux.length;

  if (section === 'planning') {
    if (n === 0 && methode === 'GET') return p.liste(acteur, teamId, q);
    if (n === 0 && methode === 'POST') return p.creer(acteur, teamId, await lireCorps());
    if (n === 1 && a === 'accueil' && methode === 'GET') return p.accueil(acteur, teamId, q);
    if (n === 1 && a === 'reglages' && methode === 'GET') return p.lireReglages(acteur, teamId);
    if (n === 1 && a === 'reglages' && methode === 'PUT') return p.changerReglages(acteur, teamId, await lireCorps());
    if (n === 1 && a === 'export.ics' && methode === 'GET') return fichier(await p.exportIcs(acteur, teamId), url);
    if (a === 'ical') {
      if (n === 1 && methode === 'GET') return { abonnements: await p.jetonsIcal(acteur, teamId) };
      if (n === 1 && methode === 'POST') return p.creerJetonIcal(acteur, teamId, await lireCorps());
      if (n === 2 && methode === 'DELETE') return p.revoquerJetonIcal(acteur, teamId, b);
    }
    if (n === 1 && methode === 'GET') return p.detail(acteur, teamId, a);
    if (n === 1 && methode === 'PATCH') return p.modifier(acteur, teamId, a, await lireCorps());
    if (n === 1 && methode === 'DELETE') return p.supprimer(acteur, teamId, a, { portee: q.portee, occurrence: q.occurrence });
    if (b === 'occurrences' && c) {
      if (n === 3 && methode === 'PATCH') return p.modifierOccurrence(acteur, teamId, a, c, await lireCorps());
      if (n === 3 && methode === 'DELETE') return p.supprimer(acteur, teamId, a, { portee: 'occurrence', occurrence: c });
      if (n === 4 && d === 'rsvp' && methode === 'PUT') return p.repondre(acteur, teamId, a, c, await lireCorps());
      if (n === 4 && d === 'presence' && methode === 'GET') return p.presenceOccurrence(acteur, teamId, a, c);
      if (n === 4 && d === 'presence' && methode === 'PUT') return p.marquer(acteur, teamId, a, c, await lireCorps());
    }
  }
  if (section === 'presence') {
    if (n === 1 && a === 'stats' && methode === 'GET') return p.stats(acteur, teamId, q);
    if (n === 1 && a === 'export.csv' && methode === 'GET') return fichier(await p.exportCsv(acteur, teamId, q), url);
    if (n === 1 && a === 'a-marquer' && methode === 'GET') return p.aMarquer(acteur, teamId, q);
    if (n === 1 && a === 'historique' && methode === 'GET') return p.historique(acteur, teamId, q);
    if (n === 2 && a === 'joueurs' && methode === 'GET') return p.fichePresence(acteur, teamId, b, q);
  }
  if (section === 'dispos') {
    if (n === 1 && a === 'moi' && methode === 'GET') return p.mesDispos(acteur, teamId, q);
    if (n === 2 && a === 'moi' && b === 'regles' && methode === 'PUT') return p.remplacerRegles(acteur, teamId, await lireCorps());
    if (n === 2 && a === 'moi' && b === 'exceptions' && methode === 'POST') return p.ajouterException(acteur, teamId, await lireCorps());
    if (n === 3 && a === 'moi' && b === 'exceptions' && methode === 'DELETE') return p.supprimerException(acteur, teamId, c);
    if (n === 1 && a === 'carte' && methode === 'GET') return p.carte(acteur, teamId, q);
  }
  return undefined;
}
