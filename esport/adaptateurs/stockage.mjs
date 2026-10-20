/**
 * Stockage de fichiers (PDF de résumés, logos… à partir de la phase 3),
 * derrière une interface simple :
 *
 *   deposer(cle, octets, { type })  → void
 *   lire(cle)                       → { octets, type } ou null
 *   supprimer(cle)                  → void
 *
 * Adaptateurs : R2 (bucket privé `esport-fichiers`) maintenant ; mémoire
 * pour les tests ; disque ou S3 sur un vrai serveur plus tard (même
 * interface, voir docs/esport/migration-serveur.md).
 */

const MOTIF_CLE = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

function exigerCle(cle) {
  if (typeof cle !== 'string' || !MOTIF_CLE.test(cle) || cle.includes('..')) throw new Error('Clé de fichier invalide.');
}

export function stockageR2(bucket) {
  return {
    async deposer(cle, octets, { type = 'application/octet-stream' } = {}) {
      exigerCle(cle);
      await bucket.put(cle, octets, { httpMetadata: { contentType: type } });
    },
    async lire(cle) {
      exigerCle(cle);
      const objet = await bucket.get(cle);
      if (!objet) return null;
      return { octets: new Uint8Array(await objet.arrayBuffer()), type: objet.httpMetadata?.contentType ?? 'application/octet-stream' };
    },
    async supprimer(cle) {
      exigerCle(cle);
      await bucket.delete(cle);
    },
  };
}

export function stockageMemoire() {
  const objets = new Map();
  return {
    async deposer(cle, octets, { type = 'application/octet-stream' } = {}) {
      exigerCle(cle);
      objets.set(cle, { octets: new Uint8Array(octets), type });
    },
    async lire(cle) {
      exigerCle(cle);
      return objets.get(cle) ?? null;
    },
    async supprimer(cle) {
      exigerCle(cle);
      objets.delete(cle);
    },
    taille: () => objets.size,
  };
}
