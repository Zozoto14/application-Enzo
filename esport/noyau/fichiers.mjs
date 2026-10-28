/**
 * Fichiers privés de l'Esport (PDF des résumés de réunion) : validation,
 * nom de stockage aléatoire, liens signés temporaires.
 *
 * Les octets passent par l'interface de stockage (adaptateurs/stockage.mjs :
 * disque, mémoire, ou S3 plus tard). Rien n'est jamais public : un fichier
 * se lit soit par une route qui vérifie les droits, soit par un lien signé
 * (HMAC-SHA256 avec CLE_ESPORT) valable quelques minutes, délivré par une
 * route qui a elle-même vérifié les droits.
 */

import { base64url, egal, echec, hexa, nouvelId, texteNettoye } from './outils.mjs';

export const TAILLE_MAX_PDF = 20 * 1024 * 1024;
export const TYPE_PDF = 'application/pdf';
export const DUREE_LIEN_MS = 5 * 60 * 1000;
const encodeur = new TextEncoder();
/** « %PDF- » : les octets magiques d'un PDF. */
const MAGIQUE_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** Le type annoncé (en-tête Content-Type, paramètres ignorés) est-il application/pdf ? */
export function typeAnnoncePdf(contentType) {
  return String(contentType ?? '').split(';')[0].trim().toLowerCase() === TYPE_PDF;
}

/** Les octets commencent-ils exactement par « %PDF- » ? (aucun préambule toléré) */
export function octetsPdf(octets) {
  if (!(octets instanceof Uint8Array) || octets.length < 8) return false;
  return MAGIQUE_PDF.every((o, i) => octets[i] === o);
}

/** Avant de lire le corps : type annoncé et taille annoncée. */
export function verifierEntetesPdf({ contentType, tailleAnnoncee = 0 }) {
  if (!typeAnnoncePdf(contentType)) throw echec(415, 'type-fichier', 'Seuls les fichiers PDF (application/pdf) sont acceptés.');
  if (Number(tailleAnnoncee) > TAILLE_MAX_PDF) throw echec(413, 'fichier-trop-gros', 'PDF trop volumineux : 20 Mo au plus.');
}

/**
 * Valide un PDF déposé : type annoncé, taille (annoncée puis réelle) et
 * octets magiques. Lève une erreur métier (415, 413, 400) sinon.
 */
export function validerPdf({ contentType, octets, tailleAnnoncee = 0 }) {
  verifierEntetesPdf({ contentType, tailleAnnoncee });
  if (octets && octets.length > TAILLE_MAX_PDF) throw echec(413, 'fichier-trop-gros', 'PDF trop volumineux : 20 Mo au plus.');
  if (!octets || octets.length === 0) throw echec(400, 'fichier-vide', 'Fichier vide.');
  if (!octetsPdf(octets)) throw echec(415, 'pdf-invalide', 'Ce fichier n’est pas un vrai PDF.');
}

/** Lit le corps binaire d'une requête, en refusant au-delà de `max` octets (sans tout charger). */
export async function lireOctets(requete, max = TAILLE_MAX_PDF) {
  const annoncee = Number(requete.headers.get('Content-Length') ?? 0);
  if (annoncee > max) throw echec(413, 'fichier-trop-gros', 'PDF trop volumineux : 20 Mo au plus.');
  if (!requete.body) return new Uint8Array();
  const lecteur = requete.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      throw echec(413, 'fichier-trop-gros', 'PDF trop volumineux : 20 Mo au plus.');
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) {
    octets.set(m, i);
    i += m.length;
  }
  return octets;
}

/** Nom de stockage aléatoire (jamais le nom d'origine) : teams/<team>/resumes/<uuid>.pdf */
export function cleStockageResume(teamId) {
  return `teams/${teamId}/resumes/${nouvelId()}.pdf`;
}

/** Nom d'origine affichable et sûr (en-tête Content-Disposition), toujours en .pdf. */
export function nomOriginal(brut) {
  let nom = '';
  try {
    nom = decodeURIComponent(String(brut ?? ''));
  } catch {
    nom = String(brut ?? '');
  }
  nom = texteNettoye(nom, 120).replace(/[\\/:*?"<>|]/g, '_');
  if (!nom) nom = 'resume.pdf';
  if (!/\.pdf$/i.test(nom)) nom = `${nom}.pdf`;
  return nom;
}

export async function empreinteSha256(octets) {
  return hexa(await globalThis.crypto.subtle.digest('SHA-256', octets));
}

async function signer(secret, texte) {
  if (typeof secret !== 'string' || secret.length < 32) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé de session (CLE_ESPORT).');
  const cle = await globalThis.crypto.subtle.importKey('raw', encodeur.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await globalThis.crypto.subtle.sign('HMAC', cle, encodeur.encode(texte)));
}

/**
 * Genres de liens signés : `fichier` (table `fichiers`, route `/fichiers/<id>`), `cm` (table `cm_fichiers`,
 * route `/cm/fichiers/<id>`, section CM), `drive` et `drive-zip` (Drive de la section CM). Le genre entre dans la signature : un lien de l'un ne vaut rien
 * pour l'autre.
 */
const GENRES_LIEN = {
  fichier: { signature: 'fichier', chemin: '/fichiers/' },
  cm: { signature: 'cm-fichier', chemin: '/cm/fichiers/' },
  // Drive CM (migration 0027) : une version d'un fichier du Drive (`<élément>.<version>`), et un dossier en ZIP.
  drive: { signature: 'cm-drive', chemin: '/cm/drive/contenu/' },
  'drive-zip': { signature: 'cm-drive-zip', chemin: '/cm/drive/zip/' },
};

/** Chemin signé `/fichiers/<id>?c=<compte>&exp=<ms>&sig=…` (à préfixer par l'adresse du serveur). */
export async function cheminSigne(secret, { fichierId, compte, maintenant, duree = DUREE_LIEN_MS, telecharger = false, genre = 'fichier' }) {
  const g = GENRES_LIEN[genre];
  const exp = maintenant + duree;
  const sig = await signer(secret, `${g.signature}|${fichierId}|${compte}|${exp}|${telecharger ? 1 : 0}`);
  const p = new URLSearchParams({ c: compte, exp: String(exp), ...(telecharger ? { t: '1' } : {}), sig });
  return { chemin: `${g.chemin}${fichierId}?${p.toString()}`, expire: exp };
}

/** Vérifie un lien signé ; rend `{ fichierId, compte, telecharger }` ou lève 403/410. */
export async function verifierLien(secret, fichierId, params, maintenant, { genre = 'fichier' } = {}) {
  const g = GENRES_LIEN[genre];
  const compte = params.get('c') ?? '';
  const exp = Number(params.get('exp'));
  const telecharger = params.get('t') === '1';
  const sig = params.get('sig') ?? '';
  if (!compte || !Number.isFinite(exp) || !sig) throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
  if (!egal(sig, await signer(secret, `${g.signature}|${fichierId}|${compte}|${exp}|${telecharger ? 1 : 0}`))) throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
  if (exp <= maintenant) throw echec(410, 'lien-expire', 'Ce lien a expiré : rouvrez le résumé depuis l’app.');
  return { fichierId, compte, telecharger };
}
