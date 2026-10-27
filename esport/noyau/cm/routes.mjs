/**
 * Routes HTTP de la section CM (branchées par api.mjs, après l'authentification, sauf le fichier signé).
 * Les droits sont contrôlés dans les services (commun.mjs : portée club ou team).
 *
 *   GET|HEAD          /cm/fichiers/:id?c&exp&sig                 fichier CM par lien signé (sans session)
 *
 *   GET               /cm/moi                                    droits CM de l'acteur (navigation)
 *   GET               /cm/etat                                   versions des tableaux visibles, posts à valider
 *   GET|POST          /cm/tableaux                               tableaux visibles (?archives=1) ; créer (cm.gerer)
 *   GET|PATCH|DELETE  /cm/tableaux/:id                           tableau complet (?archives=1) ; modifier ; supprimer
 *   POST              /cm/tableaux/:id/(listes|etiquettes|cartes) créer une liste, une étiquette, une carte
 *   PATCH             /cm/listes/:id ; POST …/deplacer { index }
 *   PATCH|DELETE      /cm/etiquettes/:id
 *   GET|PATCH|DELETE  /cm/cartes/:id
 *   POST              /cm/cartes/:id/(deplacer|soumettre|valider|refuser|publier|depublier|checklists|commentaires|pieces)
 *   PATCH|DELETE      /cm/checklists/:id ; POST …/elements ; PATCH|DELETE /cm/elements/:id
 *   PATCH|DELETE      /cm/commentaires/:id ; DELETE /cm/pieces/:id ; POST /cm/pieces/:id/lien { telecharger }
 *   GET               /cm/a-valider ; /cm/calendrier?du&au&reseau ; /cm/recherche?q
 *   GET               /cm/teams/:t ; POST …/depots ; GET …/matchs ; GET …/resume?genre&id&prefixe ; GET …/membres
 *   GET|POST          /cm/teams/:t/clips ; GET /cm/clips?statut&team ; PATCH|DELETE /cm/clips/:id ; POST …/carte ; POST …/lien
 *   GET|POST          /cm/roles ; PATCH|DELETE /cm/roles/:id ; POST …/retablir
 *   GET|POST          /cm/affectations ; DELETE /cm/affectations/:id ; GET /cm/comptes
 *   GET|PUT           /cm/reglages ; GET /cm/journal?avant
 *   GET               /cm/import/portees ; POST /cm/import/trello/apercu ; POST /cm/import/trello
 *   POST|GET|PUT|DEL  /cm/portees/:p/envois…                     envoi d'un fichier par morceaux (portée club ou team)
 */

import { echec } from '../outils.mjs';
import { routesEnvois } from '../review/routes.mjs';
import { lireLangue } from '../langues.mjs';
import { TAILLE_MAX_TRELLO } from './trello.mjs';

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

const prefixeDe = url => `${url.origin}${url.pathname.startsWith('/api/esport') ? '/api/esport' : ''}`;
const lienComplet = (url, { chemin, expire }) => ({ url: `${prefixeDe(url)}${chemin}`, expire: new Date(expire).toISOString() });

/** Fichier CM par lien signé (sans session) : `undefined` si la route n'est pas la sienne. */
export async function routeFichierCm(cm, url, requete) {
  const f = /^\/cm\/fichiers\/([^/]+)$/.exec(url.pathname.replace(/^\/api\/esport(?=\/|$)/, ''));
  if (!f) return undefined;
  return cm.fichiers.servir(f[1], url.searchParams, requete);
}

export async function routesCm({ cm, medias, acteur, chemin, methode: m, url, requete, lireCorps, limite }) {
  if (chemin !== '/cm' && !chemin.startsWith('/cm/')) return undefined;
  const p = chemin.split('/').slice(2).map(segment);
  const n = p.length;
  const q = url.searchParams;
  const [a, b, c] = p;
  const origine = prefixeDe(url);
  const langue = lireLangue(q.get('langue')) ?? acteur.langue ?? 'fr';
  const { tableaux: tb, droits, equipe, clips, trello } = cm;

  if (n === 1 && a === 'moi' && m === 'GET') return droits.moi(acteur);
  if (n === 1 && a === 'etat' && m === 'GET') return tb.etat(acteur);
  if (n === 1 && a === 'a-valider' && m === 'GET') return tb.aValider(acteur);
  if (n === 1 && a === 'calendrier' && m === 'GET') return tb.calendrier(acteur, { du: q.get('du') || undefined, au: q.get('au') || undefined, reseau: q.get('reseau') || undefined });
  if (n === 1 && a === 'recherche' && m === 'GET') return tb.recherche(acteur, { q: q.get('q') || '' });

  if (a === 'portees' && b && c === 'envois' && medias) return routesEnvois({ medias, acteur, teamId: b, usage: 'cm', p: p.slice(3), methode: m, requete, lireCorps });

  if (a === 'tableaux') {
    if (n === 1 && m === 'GET') return tb.tableaux(acteur, { archives: q.get('archives') === '1' });
    if (n === 1 && m === 'POST') return tb.creerTableau(acteur, await lireCorps());
    if (n === 2 && m === 'GET') return tb.tableau(acteur, b, { archives: q.get('archives') === '1', origine });
    if (n === 2 && m === 'PATCH') return tb.modifierTableau(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return tb.supprimerTableau(acteur, b);
    if (n === 3 && c === 'listes' && m === 'POST') return tb.creerListe(acteur, b, await lireCorps());
    if (n === 3 && c === 'etiquettes' && m === 'POST') return tb.creerEtiquette(acteur, b, await lireCorps());
    if (n === 3 && c === 'cartes' && m === 'POST') return tb.creerCarte(acteur, b, await lireCorps());
  }
  if (a === 'listes') {
    if (n === 2 && m === 'PATCH') return tb.modifierListe(acteur, b, await lireCorps());
    if (n === 3 && c === 'deplacer' && m === 'POST') return tb.deplacerListe(acteur, b, await lireCorps());
  }
  if (a === 'etiquettes' && n === 2) {
    if (m === 'PATCH') return tb.modifierEtiquette(acteur, b, await lireCorps());
    if (m === 'DELETE') return tb.supprimerEtiquette(acteur, b);
  }
  if (a === 'cartes') {
    if (n === 2 && m === 'GET') return tb.carte(acteur, b, { origine, langue });
    if (n === 2 && m === 'PATCH') return tb.modifierCarte(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return tb.supprimerCarte(acteur, b);
    if (n === 3 && m === 'POST') {
      const corps = await lireCorps();
      if (c === 'deplacer') return tb.deplacerCarte(acteur, b, corps);
      if (c === 'soumettre') return tb.soumettre(acteur, b);
      if (c === 'valider') return tb.valider(acteur, b, corps);
      if (c === 'refuser') return tb.refuser(acteur, b, corps);
      if (c === 'publier') return tb.publier(acteur, b, corps);
      if (c === 'depublier') return tb.depublier(acteur, b);
      if (c === 'checklists') return tb.creerChecklist(acteur, b, corps);
      if (c === 'commentaires') return tb.commenter(acteur, b, corps);
      if (c === 'pieces') return tb.ajouterPiece(acteur, b, corps);
    }
  }
  if (a === 'checklists') {
    if (n === 2 && m === 'PATCH') return tb.modifierChecklist(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return tb.supprimerChecklist(acteur, b);
    if (n === 3 && c === 'elements' && m === 'POST') return tb.ajouterElement(acteur, b, await lireCorps());
  }
  if (a === 'elements' && n === 2) {
    if (m === 'PATCH') return tb.modifierElement(acteur, b, await lireCorps());
    if (m === 'DELETE') return tb.supprimerElement(acteur, b);
  }
  if (a === 'commentaires' && n === 2) {
    if (m === 'PATCH') return tb.modifierCommentaire(acteur, b, await lireCorps());
    if (m === 'DELETE') return tb.supprimerCommentaire(acteur, b);
  }
  if (a === 'pieces') {
    if (n === 2 && m === 'DELETE') return tb.supprimerPiece(acteur, b);
    if (n === 3 && c === 'lien' && m === 'POST') return lienComplet(url, await tb.lienPiece(acteur, b, await lireCorps()));
  }

  if (a === 'teams' && b) {
    if (n === 2 && m === 'GET') return equipe.page(acteur, b);
    if (n === 3 && c === 'depots' && m === 'POST') {
      const corps = await lireCorps();
      await limite('cm_depot', acteur.compte);
      return equipe.deposer(acteur, b, corps);
    }
    if (n === 3 && c === 'matchs' && m === 'GET') return equipe.matchs(acteur, b, { langue });
    if (n === 3 && c === 'resume' && m === 'GET') return equipe.prerempli(acteur, b, { genre: q.get('genre') || undefined, id: q.get('id') || undefined, prefixe: q.get('prefixe') || undefined });
    if (n === 3 && c === 'membres' && m === 'GET') return equipe.membres(acteur, b);
    if (n === 3 && c === 'clips' && m === 'GET') return clips.listeTeam(acteur, b, { statut: q.get('statut') || undefined });
    if (n === 3 && c === 'clips' && m === 'POST') {
      const corps = await lireCorps();
      await limite('cm_clip', acteur.compte);
      return clips.proposer(acteur, b, corps);
    }
  }
  if (a === 'clips') {
    if (n === 1 && m === 'GET') return clips.galerie(acteur, { statut: q.get('statut') || undefined, team: q.get('team') || undefined });
    if (n === 2 && m === 'PATCH') return clips.decider(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return clips.supprimer(acteur, b);
    if (n === 3 && c === 'carte' && m === 'POST') return clips.versCarte(acteur, b, await lireCorps());
    if (n === 3 && c === 'lien' && m === 'POST') return lienComplet(url, await clips.lienFichier(acteur, b, await lireCorps()));
  }

  if (a === 'roles') {
    if (n === 1 && m === 'GET') return droits.roles(acteur);
    if (n === 1 && m === 'POST') return droits.creerRole(acteur, await lireCorps());
    if (n === 2 && m === 'PATCH') return droits.modifierRole(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return droits.supprimerRole(acteur, b);
    if (n === 3 && c === 'retablir' && m === 'POST') return droits.retablirRole(acteur, b);
  }
  if (a === 'affectations') {
    if (n === 1 && m === 'GET') return droits.affectations(acteur);
    if (n === 1 && m === 'POST') return droits.affecter(acteur, await lireCorps());
    if (n === 2 && m === 'DELETE') return droits.retirerAffectation(acteur, b);
  }
  if (n === 1 && a === 'comptes' && m === 'GET') return droits.comptes(acteur);
  if (n === 1 && a === 'reglages') {
    if (m === 'GET') return droits.reglages(acteur);
    if (m === 'PUT') return droits.changerReglages(acteur, await lireCorps());
  }
  if (n === 1 && a === 'journal' && m === 'GET') return droits.journal(acteur, { avant: q.get('avant') || undefined });

  if (a === 'import') {
    if (n === 2 && b === 'portees' && m === 'GET') return trello.portees(acteur);
    if (b === 'trello' && m === 'POST' && (n === 2 || (n === 3 && c === 'apercu'))) {
      const corps = await lireCorps(TAILLE_MAX_TRELLO + 64 * 1024);
      await limite('cm_import', acteur.compte);
      return n === 3 ? trello.apercu(acteur, corps) : trello.importer(acteur, corps);
    }
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
