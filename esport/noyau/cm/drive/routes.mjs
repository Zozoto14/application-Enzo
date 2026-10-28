/**
 * Routes du Drive de la section CM (branchées par cm/routes.mjs, après l'authentification ; les deux liens
 * signés le sont par api.mjs, sans session). Les droits sont contrôlés dans le service.
 *
 *   GET|HEAD          /cm/drive/contenu/<élément>.<version>?c&exp&sig     fichier par lien signé
 *   GET|HEAD          /cm/drive/zip/<dossier>?c&exp&sig                   dossier en ZIP par lien signé
 *
 *   GET               /cm/drive/portees                                   portées, droits, quota, réglages
 *   GET               /cm/drive?portee&dossier                            contenu d'un dossier (racine sans dossier)
 *   GET               /cm/drive/arbre?portee ; /cm/drive/filtres?portee ; /cm/drive/recherche?portee&q&genre&tag&auteur&du&au&favoris&dossier
 *   PATCH|DELETE      /cm/drive/tags { portee, tag, nom } ; ?portee&tag   renommer / retirer une étiquette de tous les fichiers (gérer)
 *   GET               /cm/drive/elements/:id                              où est un élément (lien interne)
 *   POST|GET|PUT|DEL  /cm/drive/portees/:p/envois…                        envoi par morceaux (usage « drive »)
 *   POST              /cm/drive/fichiers { portee, dossierId, envoi, nom?, tags? }
 *   GET|PATCH|DELETE  /cm/drive/fichiers/:id                              détail ; renommer, déplacer, étiqueter ; corbeille
 *   POST              /cm/drive/fichiers/:id/(copier|lien|versions)
 *   POST|DELETE       /cm/drive/fichiers/:id/versions/:v/restaurer ; /cm/drive/fichiers/:id/versions/:v
 *   POST              /cm/drive/dossiers { portee, parentId, nom, restreint? }
 *   PATCH|DELETE      /cm/drive/dossiers/:id ; POST /cm/drive/dossiers/:id/zip
 *   GET               /cm/drive/corbeille?portee ; POST /cm/drive/corbeille/vider { portee }
 *   POST|DELETE       /cm/drive/corbeille/:id/restaurer ; /cm/drive/corbeille/:id
 *   POST              /cm/drive/lot { action, elements, dossierId?, portee? } ; POST /cm/drive/favoris { genre, id, favori }
 *   GET|PUT           /cm/drive/reglages                                  rangement automatique (gérer, club)
 */

import { echec } from '../../outils.mjs';
import { routesEnvois } from '../../review/routes.mjs';

const prefixeDe = url => `${url.origin}${url.pathname.startsWith('/api/esport') ? '/api/esport' : ''}`;
const lienComplet = (url, { chemin, expire, ...reste }) => ({ url: `${prefixeDe(url)}${chemin}`, expire: new Date(expire).toISOString(), ...reste });

const decoder = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

/** Liens signés du Drive (sans session) : `undefined` si la route n'est pas la sienne. */
export async function routeDriveSignee(drive, url, requete) {
  const chemin = url.pathname.replace(/^\/api\/esport(?=\/|$)/, '');
  const c = /^\/cm\/drive\/contenu\/([^/]+)$/.exec(chemin);
  if (c) return drive.servirContenu(decoder(c[1]), url.searchParams, requete);
  const z = /^\/cm\/drive\/zip\/([^/]+)$/.exec(chemin);
  if (z) return drive.servirZip(decoder(z[1]), url.searchParams, requete);
  throw echec(404, 'route', 'Adresse inconnue.');
}

export async function routesDrive({ drive, medias, acteur, p, methode: m, url, requete, lireCorps, limite }) {
  const n = p.length;
  const q = url.searchParams;
  const [, b, c, d, e] = p;
  const origine = prefixeDe(url);
  const portee = q.get('portee') || undefined;

  if (n === 1 && m === 'GET') return drive.lister(acteur, { portee, dossier: q.get('dossier') || undefined, origine });
  if (n === 2 && b === 'portees' && m === 'GET') return drive.portees(acteur);
  if (n === 2 && b === 'arbre' && m === 'GET') return drive.arborescence(acteur, { portee });
  if (n === 2 && b === 'filtres' && m === 'GET') return drive.filtres(acteur, { portee });
  if (n === 2 && b === 'recherche' && m === 'GET') {
    const f = Object.fromEntries(['q', 'genre', 'tag', 'auteur', 'du', 'au', 'dossier'].map(k => [k, q.get(k) || undefined]));
    return drive.rechercher(acteur, { ...f, portee, favoris: q.get('favoris') === '1', origine });
  }
  if (n === 2 && b === 'tags') {
    if (m === 'PATCH') return drive.renommerTag(acteur, await lireCorps());
    if (m === 'DELETE') return drive.supprimerTag(acteur, { portee, tag: q.get('tag') || undefined });
  }
  if (n === 3 && b === 'elements' && m === 'GET') return drive.element(acteur, c);
  if (b === 'portees' && c && d === 'envois' && medias) return routesEnvois({ medias, acteur, teamId: c, usage: 'drive', p: p.slice(4), methode: m, requete, lireCorps });
  if (n === 2 && b === 'reglages') {
    if (m === 'GET') return drive.reglages(acteur);
    if (m === 'PUT') return drive.changerReglages(acteur, await lireCorps());
  }
  if (b === 'fichiers') {
    if (n === 2 && m === 'POST') {
      const corps = await lireCorps();
      await limite('cm_drive', acteur.compte);
      return drive.ajouter(acteur, corps, { origine });
    }
    if (n === 3 && m === 'GET') return drive.detail(acteur, c, { origine });
    if (n === 3 && m === 'PATCH') return drive.modifierFichier(acteur, c, await lireCorps());
    if (n === 3 && m === 'DELETE') return drive.mettreFichierALaCorbeille(acteur, c);
    if (n === 4 && d === 'copier' && m === 'POST') return drive.copierFichier(acteur, c, await lireCorps());
    if (n === 4 && d === 'lien' && m === 'POST') return lienComplet(url, await drive.lien(acteur, c, await lireCorps()));
    if (n === 4 && d === 'versions' && m === 'POST') {
      const corps = await lireCorps();
      await limite('cm_drive', acteur.compte);
      return drive.nouvelleVersion(acteur, c, corps);
    }
    if (n === 6 && d === 'versions' && p[5] === 'restaurer' && m === 'POST') return drive.restaurerVersion(acteur, c, e);
    if (n === 5 && d === 'versions' && m === 'DELETE') return drive.supprimerVersion(acteur, c, e);
  }
  if (b === 'dossiers') {
    if (n === 2 && m === 'POST') return drive.creerDossier(acteur, await lireCorps());
    if (n === 3 && m === 'PATCH') return drive.modifierDossier(acteur, c, await lireCorps());
    if (n === 3 && m === 'DELETE') return drive.mettreDossierALaCorbeille(acteur, c);
    if (n === 4 && d === 'zip' && m === 'POST') {
      await limite('cm_drive_zip', acteur.compte);
      return lienComplet(url, await drive.lienZip(acteur, c));
    }
  }
  if (b === 'corbeille') {
    if (n === 2 && m === 'GET') return drive.corbeille(acteur, { portee });
    if (n === 3 && c === 'vider' && m === 'POST') return drive.viderCorbeille(acteur, await lireCorps());
    if (n === 4 && d === 'restaurer' && m === 'POST') return drive.restaurer(acteur, c);
    if (n === 3 && m === 'DELETE') return drive.supprimerDefinitivement(acteur, c);
  }
  if (n === 2 && b === 'lot' && m === 'POST') return drive.enLot(acteur, await lireCorps());
  if (n === 2 && b === 'favoris' && m === 'POST') return drive.favori(acteur, await lireCorps());
  throw echec(404, 'route', 'Adresse inconnue.');
}
