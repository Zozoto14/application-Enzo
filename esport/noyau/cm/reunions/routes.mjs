/**
 * Routes des réunions de l'équipe CM (docs/esport/cm-reunions.md), branchées par cm/routes.mjs (session ouverte) :
 *
 *   GET               /cm/reunions/moi                               droits, profil, équipe CM (statuts), à répondre
 *   GET|POST          /cm/reunions                                   agenda (?du&au&annulees) ; créer
 *   GET|PATCH         /cm/reunions/:id                               détail (notes si permis) ; modifier
 *   POST              /cm/reunions/:id/annuler { motif, occurrence? }
 *   PUT               /cm/reunions/:id/reponse ; PUT …/notes ; POST …/taches
 *   PATCH|DELETE      /cm/reunions/taches/:id ; POST …/carte { tableauId, listeId? }
 *   POST              /cm/reunions/creneaux                          « Trouver un créneau »
 *   GET               /cm/reunions/equipe/grille?semaine&fuseau&pas  disponibilités de l'équipe superposées
 *   GET               /cm/reunions/comptes?q                         comptes à inviter
 *   PUT               /cm/reunions/statut                            statut du moment
 *   GET               /cm/reunions/dispos/moi ; PUT …/moi/regles ; POST …/moi/exceptions ; DELETE …/moi/exceptions/:id
 *   GET|POST          /cm/reunions/rdv ; PATCH|DELETE /cm/reunions/rdv/:id ; POST /cm/reunions/rdv/creneaux/:id/reserver
 *   GET               /cm/reunions/export.ics
 *   GET|POST          /cm/reunions/ical ; DELETE /cm/reunions/ical/:id
 *
 * Sans session : GET /cm-reunions/ical/<jeton>.ics (abonnement, jeton révocable).
 */

import { ENTETES_FICHIER, disposition } from '../../entetes.mjs';
import { echec } from '../../outils.mjs';

function fichier(f, url, enLigne = false) {
  if (url.searchParams.get('format') === 'json') return f;
  return new Response(f.contenu, { status: 200, headers: { ...ENTETES_FICHIER, 'Content-Type': f.type, 'Content-Disposition': disposition(f.nom, enLigne) } });
}

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

/** Abonnement iCal sans session : `undefined` si la route n'est pas la sienne. */
export async function routePubliqueReunions(reunions, { chemin, methode, url }) {
  const m = /^\/cm-reunions\/ical\/([^/]+)\.ics$/.exec(chemin);
  if (!m || methode !== 'GET' || !reunions) return undefined;
  return fichier(await reunions.icsAbonnement(segment(m[1])), url, true);
}

export async function routesReunions({ reunions: r, acteur, p, methode: m, url, lireCorps, limite }) {
  const n = p.length;
  const [, b, c, d] = p;
  const q = url.searchParams;
  const params = Object.fromEntries(q.entries());
  if (n === 1 && m === 'GET') return r.agenda(acteur, params);
  if (n === 1 && m === 'POST') {
    const corps = await lireCorps();
    await limite('cm_reunion', acteur.compte);
    return r.creer(acteur, corps);
  }
  if (n === 2 && b === 'moi' && m === 'GET') return r.moi(acteur);
  if (n === 2 && b === 'creneaux' && m === 'POST') return r.trouverCreneaux(acteur, await lireCorps());
  if (n === 2 && b === 'comptes' && m === 'GET') return r.comptes(acteur, { q: q.get('q') || '' });
  if (n === 2 && b === 'statut' && m === 'PUT') return r.changerStatut(acteur, await lireCorps());
  if (n === 2 && b === 'export.ics' && m === 'GET') return fichier(await r.exportIcs(acteur), url);
  if (n === 3 && b === 'equipe' && c === 'grille' && m === 'GET') return r.grilleEquipe(acteur, params);
  if (b === 'dispos' && c === 'moi') {
    if (n === 3 && m === 'GET') return r.mesDispos(acteur, params);
    if (n === 4 && d === 'regles' && m === 'PUT') return r.remplacerRegles(acteur, await lireCorps());
    if (n === 4 && d === 'exceptions' && m === 'POST') return r.ajouterException(acteur, await lireCorps());
    if (n === 5 && d === 'exceptions' && m === 'DELETE') return r.supprimerException(acteur, p[4]);
  }
  if (b === 'ical') {
    if (n === 2 && m === 'GET') return r.jetonsIcal(acteur);
    if (n === 2 && m === 'POST') return r.creerJetonIcal(acteur, await lireCorps());
    if (n === 3 && m === 'DELETE') return r.revoquerJetonIcal(acteur, c);
  }
  if (b === 'rdv') {
    if (n === 2 && m === 'GET') return r.rdv(acteur);
    if (n === 2 && m === 'POST') {
      const corps = await lireCorps();
      await limite('cm_reunion', acteur.compte);
      return r.creerOffre(acteur, corps);
    }
    if (n === 3 && m === 'PATCH') return r.modifierOffre(acteur, c, await lireCorps());
    if (n === 3 && m === 'DELETE') return r.supprimerOffre(acteur, c);
    if (n === 5 && c === 'creneaux' && p[4] === 'reserver' && m === 'POST') return r.reserver(acteur, d, await lireCorps());
  }
  if (b === 'taches' && c) {
    if (n === 3 && m === 'PATCH') return r.modifierTache(acteur, c, await lireCorps());
    if (n === 3 && m === 'DELETE') return r.supprimerTache(acteur, c);
    if (n === 4 && d === 'carte' && m === 'POST') return r.tacheVersCarte(acteur, c, await lireCorps());
  }
  if (b && n === 2) {
    if (m === 'GET') return r.detail(acteur, b);
    if (m === 'PATCH') return r.modifier(acteur, b, await lireCorps());
  }
  if (b && n === 3 && m === 'POST' && c === 'annuler') return r.annuler(acteur, b, await lireCorps());
  if (b && n === 3 && m === 'PUT' && c === 'reponse') return r.repondre(acteur, b, await lireCorps());
  if (b && n === 3 && m === 'PUT' && c === 'notes') return r.ecrireNotes(acteur, b, await lireCorps());
  if (b && n === 3 && m === 'POST' && c === 'taches') return r.ajouterTache(acteur, b, await lireCorps());
  throw echec(404, 'route', 'Adresse inconnue.');
}
