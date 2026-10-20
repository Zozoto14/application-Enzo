/**
 * Stockage de fichiers (PDF de résumés, logos… à partir de la phase 3),
 * derrière une interface simple :
 *
 *   deposer(cle, octets, { type })  → void
 *   lire(cle)                       → { octets, type } ou null
 *   supprimer(cle)                  → void
 *
 * Adaptateurs : R2 (bucket privé `esport-fichiers`) sur Cloudflare ; mémoire
 * pour les tests ; disque (serveur local, et vrai serveur) ; S3 plus tard
 * (même interface, voir docs/esport/migration-serveur.md).
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

/**
 * Dossier sur le disque (Node) : serveur local, et premier pas d'un vrai
 * serveur. Le type est gardé à côté (`<clé>.type`). Le dossier doit rester
 * hors de tout répertoire servi publiquement.
 */
export async function stockageDisque(dossier) {
  const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
  const { dirname, join, resolve, sep } = await import('node:path');
  const racine = resolve(dossier);
  const chemin = cle => {
    exigerCle(cle);
    const c = resolve(join(racine, cle));
    if (!c.startsWith(racine + sep)) throw new Error('Clé de fichier invalide.');
    return c;
  };
  return {
    async deposer(cle, octets, { type = 'application/octet-stream' } = {}) {
      const c = chemin(cle);
      await mkdir(dirname(c), { recursive: true });
      await writeFile(c, octets);
      await writeFile(`${c}.type`, type);
    },
    async lire(cle) {
      const c = chemin(cle);
      try {
        const octets = new Uint8Array(await readFile(c));
        const type = await readFile(`${c}.type`, 'utf8').catch(() => 'application/octet-stream');
        return { octets, type };
      } catch (e) {
        if (e?.code === 'ENOENT') return null;
        throw e;
      }
    },
    async supprimer(cle) {
      const c = chemin(cle);
      await rm(c, { force: true });
      await rm(`${c}.type`, { force: true });
    },
  };
}
