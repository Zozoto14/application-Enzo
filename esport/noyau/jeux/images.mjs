/**
 * Images des profils de jeu (migration 0075) : fonds des maps de l'éditeur de strats, DÉPOSÉS par le
 * Fondateur dans Administration › Jeux (aucune image officielle n'est livrée avec l'app).
 *
 *  - dépôt : `POST /jeux/:cle/images` { type, donnees (base64), nom } — JPEG, PNG ou WebP vérifiés aux
 *    octets, 12 Mo au plus, 8192 px de côté au plus ; permission `jeux.gerer` ;
 *  - octets : interface de stockage du serveur (disque en production), comme les fichiers du Drive ;
 *  - lecture : lien signé (6 h) `GET /jeux/images/<id>?c&exp&sig`, délivré avec le profil à qui peut le
 *    lire (gestionnaire, ou membre d'une team du jeu) ;
 *  - une image n'est jamais effacée tant que son profil existe (une ancienne version peut la citer) ; la
 *    suppression du profil emporte ses images (lignes, puis octets).
 */

import { cheminSigne, empreinteSha256, verifierLien } from '../fichiers.mjs';
import { reponseFichierStocke } from '../medias/lecture.mjs';
import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { dimensionsImage } from '../cm/visuels/images.mjs';

export const TAILLE_MAX_IMAGE_JEU = 12 * 1024 * 1024;
export const COTE_MAX_IMAGE_JEU = 8192;
export const DUREE_LIEN_IMAGE_JEU_MS = 6 * 60 * 60 * 1000;
export const TYPES_IMAGE_JEU = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const EXTENSIONS = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Base64 (standard, ou adresse « data: ») → octets ; null si illisible ou trop gros. */
export function octetsDepuisBase64(texte, max = TAILLE_MAX_IMAGE_JEU) {
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s+/g, '');
  if (!t || t.length > Math.ceil((max * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  return new Uint8Array(Buffer.from(t, 'base64'));
}

/** Vérifie une image déposée : type annoncé = contenu réel, taille, dimensions. Rend `{ octets, format, largeur, hauteur }`. */
export function verifierImageJeu({ type, donnees }) {
  const format = TYPES_IMAGE_JEU[type];
  if (!format) throw echec(415, 'image-format', 'Image : JPEG, PNG ou WebP.');
  const octets = octetsDepuisBase64(donnees);
  if (!octets || octets.length === 0) throw echec(400, 'image-illisible', 'Image illisible.');
  if (octets.length > TAILLE_MAX_IMAGE_JEU) throw echec(413, 'image-trop-grosse', 'Image trop lourde (12 Mo au plus).');
  const d = dimensionsImage(octets);
  if (!d || d.format !== format) throw echec(415, 'image-format', 'Le contenu n’est pas une image JPEG, PNG ou WebP du type annoncé.');
  if (!(d.largeur >= 16 && d.hauteur >= 16 && d.largeur <= COTE_MAX_IMAGE_JEU && d.hauteur <= COTE_MAX_IMAGE_JEU)) throw echec(400, 'image-dimensions', 'Image : de 16 à 8192 pixels de côté.');
  return { octets, format, largeur: d.largeur, hauteur: d.hauteur };
}

/** Identifiants des images citées par des données de profil (maps). */
export const imagesCitees = donnees => [...new Set((donnees?.cartes ?? []).map(c => c.fichier).filter(Boolean))];

export function servicesImagesJeux({ base, stockage, cleSession, maintenant = () => Date.now() }) {
  /** Dépose une image (le gestionnaire est déjà vérifié) ; rend sa description et un lien signé. */
  async function deposer(acteur, cleJeu, corps, { origine = '' } = {}) {
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
    const { octets, format, largeur, hauteur } = verifierImageJeu(corps ?? {});
    const id = nouvelId();
    const cle = `jeux/${cleJeu}/images/${nouvelId()}.${EXTENSIONS[format]}`;
    const type = Object.keys(TYPES_IMAGE_JEU).find(k => TYPES_IMAGE_JEU[k] === format);
    const nom = texteNettoye(corps?.nom, 120).replace(/[\\/:*?"<>|]/g, '_') || `image.${EXTENSIONS[format]}`;
    await stockage.deposer(cle, octets, { type });
    try {
      await base.executer(
        'INSERT INTO jeu_images (id, jeu_cle, cle_stockage, type_mime, taille, largeur, hauteur, nom_original, empreinte, depose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, cleJeu, cle, type, octets.length, largeur, hauteur, nom, await empreinteSha256(octets), acteur.compte, iso(maintenant())],
      );
    } catch (e) {
      await stockage.supprimer(cle).catch(() => undefined);
      throw e;
    }
    return { id, largeur, hauteur, type, taille: octets.length, nom, ...(await lien(id, acteur.compte, origine)) };
  }

  async function lien(id, compte, origine = '') {
    if (!cleSession) return { url: null, expire: null };
    const { chemin, expire } = await cheminSigne(cleSession, { fichierId: id, compte, maintenant: maintenant(), duree: DUREE_LIEN_IMAGE_JEU_MS, genre: 'jeu' });
    return { url: `${origine}${chemin}`, expire: iso(expire) };
  }

  /** Liens signés des images citées par un profil : `{ [id]: { url, expire, largeur, hauteur } }`. */
  async function liens(cleJeu, donnees, compte, origine = '') {
    const ids = imagesCitees(donnees);
    if (ids.length === 0 || !stockage) return {};
    const lignes = await base.tous(`SELECT id, largeur, hauteur FROM jeu_images WHERE jeu_cle = ? AND supprime_le IS NULL AND id IN (${ids.map(() => '?').join(', ')})`, [cleJeu, ...ids]);
    const sortie = {};
    for (const l of lignes) sortie[l.id] = { ...(await lien(l.id, compte, origine)), largeur: Number(l.largeur), hauteur: Number(l.hauteur) };
    return sortie;
  }

  /** Lecture par lien signé (sans session) : signature valide, image présente. */
  async function servir(id, params, requete) {
    if (!MOTIF_UUID.test(String(id))) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    await verifierLien(cleSession, id, params, maintenant(), { genre: 'jeu' });
    const f = await base.premier('SELECT * FROM jeu_images WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!f || !stockage) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const reponse = await reponseFichierStocke({ stockage, f, requete, telecharger: false, nom: f.nom_original });
    if (!reponse) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return reponse;
  }

  /** Suppression d'un profil : ses images (instructions SQL à joindre au lot, puis octets à effacer). */
  async function preparerPurge(cleJeu) {
    const lignes = await base.tous('SELECT cle_stockage FROM jeu_images WHERE jeu_cle = ?', [cleJeu]);
    return {
      instructions: [{ sql: 'DELETE FROM jeu_images WHERE jeu_cle = ?', params: [cleJeu] }],
      effacer: async () => {
        if (stockage) for (const l of lignes) await stockage.supprimer(l.cle_stockage).catch(() => undefined);
      },
    };
  }

  return { deposer, liens, servir, preparerPurge };
}
