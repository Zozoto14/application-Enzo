/**
 * Routes HTTP du trombinoscope (branchées par api.mjs, après l'authentification). Les droits sont contrôlés
 * dans le service (404 pour une fiche que l'on ne voit pas, 403 pour une écriture non permise).
 *
 *   GET                 /trombi                                   cartes visibles, droits, teams, jeux
 *   GET|PATCH           /trombi/fiches/:compte                    (« moi » : sa propre fiche)
 *   PUT|DELETE          /trombi/fiches/:compte/photo              { type, donnees, miniature } (base64)
 *   GET                 /trombi/fiches/:compte/texte              texte d'annonce { fr, en }
 *   PUT                 /trombi/fiches/:compte/badges             { badges: [{ id, portee? }] } (badges.mjs)
 *   GET|POST            /trombi/badges                            catalogue des badges ; créer { nom, couleur, icone? }
 *   PUT                 /trombi/badges/ordre                      { ids } (tout le catalogue, dans l'ordre)
 *   PATCH|DELETE        /trombi/badges/:id                        { nom?, couleur?, icone?, autoActif? } ; suppression définitive
 *   POST                /trombi/badges/:id/membres                { comptes, portee?, retirer? } (plusieurs membres d'un coup)
 */

import { echec } from '../outils.mjs';

/** Corps d'une photo : image (400 Ko) et miniature en base64, avec de la marge. */
const TAILLE_MAX_PHOTO = 800 * 1024;

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesTrombi({ tb, acteur, chemin, methode: m, lireCorps, limite }) {
  if (chemin !== '/trombi' && !chemin.startsWith('/trombi/')) return undefined;
  if (chemin === '/trombi' && m === 'GET') return tb.liste(acteur);
  // Badges (migration 0032).
  const bd = tb.badges;
  if (chemin === '/trombi/badges') {
    if (m === 'GET') return bd.lister(acteur);
    if (m === 'POST') {
      const corps = await lireCorps();
      await limite('trombi_badges', acteur.compte);
      return bd.creer(acteur, corps);
    }
  }
  if (chemin === '/trombi/badges/ordre' && m === 'PUT') return bd.ordonner(acteur, await lireCorps());
  const b = /^\/trombi\/badges\/([^/]+)(\/membres)?$/.exec(chemin);
  if (b) {
    const id = segment(b[1]);
    if (b[2] && m === 'POST') {
      const corps = await lireCorps();
      await limite('trombi_badges', acteur.compte);
      return bd.attribuerLot(acteur, id, corps);
    }
    if (!b[2] && m === 'PATCH') return bd.modifierBadge(acteur, id, await lireCorps());
    if (!b[2] && m === 'DELETE') return bd.supprimerBadge(acteur, id);
  }
  const f = /^\/trombi\/fiches\/([^/]+)(?:\/(photo|texte|badges))?$/.exec(chemin);
  if (f) {
    const compte = segment(f[1]);
    if (!f[2]) {
      if (m === 'GET') return tb.detail(acteur, compte);
      if (m === 'PATCH') {
        const corps = await lireCorps();
        await limite('trombi_fiche', acteur.compte);
        return tb.modifier(acteur, compte, corps);
      }
    }
    if (f[2] === 'photo') {
      if (m === 'PUT') {
        const corps = await lireCorps(TAILLE_MAX_PHOTO);
        await limite('trombi_photo', acteur.compte);
        return tb.changerPhoto(acteur, compte, corps);
      }
      if (m === 'DELETE') return tb.supprimerPhoto(acteur, compte);
    }
    if (f[2] === 'texte' && m === 'GET') return tb.texte(acteur, compte);
    if (f[2] === 'badges' && m === 'PUT') {
      const corps = await lireCorps();
      await limite('trombi_badges', acteur.compte);
      return tb.attribuerBadges(acteur, compte, corps);
    }
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
