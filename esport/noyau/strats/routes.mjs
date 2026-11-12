/**
 * Routes HTTP des strats et du playbook (phase 6), branchées par api.mjs.
 * Rendent `undefined` si l'adresse ne les concerne pas.
 *
 *   GET  /partage/strats/<jeton>                       page HTML en lecture seule (sans session ; ?format=json)
 *
 *   GET|POST          /teams/:t/strats                 liste (?carte&side&type&tag&q), création
 *   GET|PUT|PATCH|DELETE /teams/:t/strats/:id          détail (document), enregistrement, métadonnées, suppression (corbeille)
 *   POST              /teams/:t/strats/supprimer       { ids } : supprimer plusieurs strats (50 au plus)
 *   GET               /teams/:t/strats/corbeille       strats supprimées depuis moins de 30 jours
 *   POST              /teams/:t/strats/:id/restaurer   sortir une strat de la corbeille
 *   POST              /teams/:t/strats/:id/dupliquer
 *   GET               /teams/:t/strats/:id/versions    historique ; …/versions/:revision : un document
 *   GET|POST          /teams/:t/strats/:id/partages    liens de lecture seule ; DELETE …/partages/:p : révoquer
 *
 *   GET|POST          /teams/:t/playbook               liste (?q&carte&side&type&statut&tag&favoris=1), création
 *   PATCH|DELETE      /teams/:t/playbook/:id
 *   POST              /teams/:t/playbook/:id/restaurer  annuler le retrait d'une entrée (30 jours)
 */

import { ENTETES_SECURITE } from '../entetes.mjs';
import { echec } from '../outils.mjs';
import { CSP_PAGE_STRAT, pageStrat } from './svg.mjs';

/** Corps d’un enregistrement : document (384 Ko) et miniature (256 Ko en base64). */
export const TAILLE_MAX_CORPS_STRAT = 1024 * 1024;

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

/** Page publique de partage : CSP stricte (aucun script), jamais dans un cadre, jamais indexée. */
const ENTETES_PAGE = {
  ...ENTETES_SECURITE,
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': CSP_PAGE_STRAT,
};

/** Route publique (avant la session). */
export async function routePubliqueStrats({ strats, chemin, methode, url }) {
  const m = /^\/partage\/strats\/([^/]+)$/.exec(chemin);
  if (!m || methode !== 'GET') return undefined;
  const lu = await strats.lirePartage(segment(m[1]));
  if (url.searchParams.get('format') === 'json') return { lectureSeule: true, ...lu };
  return new Response(pageStrat({ titre: lu.titre, type: lu.type, notes: lu.notes, doc: lu.donnees, libelleType: lu.libelleType }), { status: 200, headers: ENTETES_PAGE });
}

/** Routes de team (session déjà vérifiée). `lireCorps(max)` : corps JSON borné. */
export async function routesStrats({ strats, playbook, acteur, chemin, methode, url, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/(strats|playbook)(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, section, reste = ''] = m;
  const morceaux = reste.split('/').filter(Boolean).map(segment);
  const [a, b, c] = morceaux;
  const n = morceaux.length;
  const q = Object.fromEntries(url.searchParams.entries());
  const prefixe = url.pathname.startsWith('/api/esport') ? '/api/esport' : '';
  const options = { origine: `${url.origin}${prefixe}` };

  if (section === 'strats') {
    if (n === 0 && methode === 'GET') return { strats: await strats.liste(acteur, teamId, q, options) };
    if (n === 0 && methode === 'POST') return strats.creer(acteur, teamId, await lireCorps(TAILLE_MAX_CORPS_STRAT), options);
    if (n === 1 && a === 'corbeille' && methode === 'GET') return { strats: await strats.corbeille(acteur, teamId, options) };
    if (n === 1 && a === 'supprimer' && methode === 'POST') return strats.supprimerLot(acteur, teamId, (await lireCorps())?.ids);
    if (n === 1 && methode === 'GET') return strats.detail(acteur, teamId, a, options);
    if (n === 1 && methode === 'PUT') return strats.enregistrer(acteur, teamId, a, await lireCorps(TAILLE_MAX_CORPS_STRAT), options);
    if (n === 1 && methode === 'PATCH') return strats.modifier(acteur, teamId, a, await lireCorps(), options);
    if (n === 1 && methode === 'DELETE') return strats.supprimer(acteur, teamId, a);
    if (n === 2 && b === 'restaurer' && methode === 'POST') return strats.restaurer(acteur, teamId, a, options);
    if (n === 2 && b === 'dupliquer' && methode === 'POST') return strats.dupliquer(acteur, teamId, a, await lireCorps(), options);
    if (n === 2 && b === 'versions' && methode === 'GET') return { versions: await strats.versions(acteur, teamId, a) };
    if (n === 3 && b === 'versions' && methode === 'GET') return strats.version(acteur, teamId, a, c);
    if (n === 2 && b === 'partages' && methode === 'GET') return { partages: await strats.partages(acteur, teamId, a) };
    if (n === 2 && b === 'partages' && methode === 'POST') return strats.creerPartage(acteur, teamId, a, await lireCorps(), options);
    if (n === 3 && b === 'partages' && methode === 'DELETE') return strats.revoquerPartage(acteur, teamId, a, c);
    throw echec(404, 'route', 'Adresse inconnue.');
  }
  if (n === 0 && methode === 'GET') return playbook.liste(acteur, teamId, { ...q, favoris: q.favoris === '1' }, options);
  if (n === 0 && methode === 'POST') return playbook.creer(acteur, teamId, await lireCorps(), options);
  if (n === 1 && methode === 'PATCH') return playbook.modifier(acteur, teamId, a, await lireCorps(), options);
  if (n === 1 && methode === 'DELETE') return playbook.supprimer(acteur, teamId, a);
  if (n === 2 && b === 'restaurer' && methode === 'POST') return playbook.restaurer(acteur, teamId, a, options);
  throw echec(404, 'route', 'Adresse inconnue.');
}
