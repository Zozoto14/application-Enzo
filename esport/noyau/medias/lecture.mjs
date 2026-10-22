/**
 * Lecture d'un fichier privé par lien signé, avec les requêtes « Range » (réponse 206) : c'est ce que
 * fait la balise <video> pour avancer, reculer ou reprendre sans tout télécharger. Les octets sont lus
 * EN FLUX dans le stockage (disque) : le serveur n'a jamais toute la vidéo en mémoire.
 */

import { ENTETES_SECURITE, disposition } from '../entetes.mjs';

/** En-têtes d'un fichier lu par lien signé (PDF, vidéo) : jamais dans un cadre, jamais mis en cache. */
export const ENTETES_LIEN = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
  'Cache-Control': 'private, no-store',
  ...ENTETES_SECURITE,
  // Pas de « sandbox » : Chrome refuserait d'afficher le PDF.
  'Content-Security-Policy': "frame-ancestors 'none'",
};

/** Au plus 64 Mio par réponse : le navigateur redemande la suite tout seul. */
export const TRANCHE_MAX = 64 * 1024 * 1024;

/**
 * Lit l'en-tête Range (`bytes=a-b`, `bytes=a-`, `bytes=-n` ; seule la première plage compte).
 * Rend `null` sans en-tête, `'invalide'` si la plage est impossible, sinon `{ debut, fin }` (fin incluse).
 */
export function lirePlage(entete, taille) {
  if (!entete) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*(?:,.*)?$/i.exec(String(entete));
  if (!m || (m[1] === '' && m[2] === '')) return 'invalide';
  let debut;
  let fin;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return 'invalide';
    debut = Math.max(0, taille - n);
    fin = taille - 1;
  } else {
    debut = Number(m[1]);
    fin = m[2] === '' ? taille - 1 : Math.min(Number(m[2]), taille - 1);
    if (!Number.isSafeInteger(debut) || !Number.isSafeInteger(fin)) return 'invalide';
  }
  if (taille === 0 || debut >= taille || fin < debut) return 'invalide';
  return { debut, fin: Math.min(fin, debut + TRANCHE_MAX - 1) };
}

/**
 * Réponse d'un fichier du stockage : entier (200) ou une plage (206), 416 si la plage est impossible.
 * `f` : ligne de `fichiers` ; `nom` : nom affiché ; `telecharger` : pièce jointe plutôt qu'affichage.
 */
export async function reponseFichierStocke({ stockage, f, requete, telecharger }) {
  const base = { ...ENTETES_LIEN, 'Content-Type': f.type_mime, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition(f.nom_original, !telecharger) };
  const tete = requete.method === 'HEAD';
  if (typeof stockage.lireTranche !== 'function') {
    // Adaptateur sans lecture par plage : le fichier entier (petits fichiers).
    const objet = await stockage.lire(f.cle_stockage);
    if (!objet) return null;
    return new Response(tete ? null : objet.octets, { status: 200, headers: { ...base, 'Content-Length': String(objet.octets.length) } });
  }
  const taille = (await stockage.tailleDe?.(f.cle_stockage)) ?? Number(f.taille);
  if (taille == null) return null;
  const plage = lirePlage(requete.headers.get('Range'), taille);
  if (plage === 'invalide') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${taille}` } });
  const debut = plage ? plage.debut : 0;
  const fin = plage ? plage.fin : taille - 1;
  const entetes = { ...base, 'Content-Length': String(fin - debut + 1), ...(plage ? { 'Content-Range': `bytes ${debut}-${fin}/${taille}` } : {}) };
  if (tete) return new Response(null, { status: plage ? 206 : 200, headers: entetes });
  if (taille === 0) return new Response(new Uint8Array(0), { status: 200, headers: entetes });
  const tranche = await stockage.lireTranche(f.cle_stockage, debut, fin);
  if (!tranche) return null;
  return new Response(tranche.flux ?? tranche.octets, { status: plage ? 206 : 200, headers: entetes });
}
