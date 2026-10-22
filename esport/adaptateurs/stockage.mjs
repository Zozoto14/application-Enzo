/**
 * Stockage de fichiers (PDF de résumés, miniatures, vidéos et enregistrements),
 * derrière une interface simple :
 *
 *   deposer(cle, octets, { type })  → void
 *   lire(cle)                       → { octets, type } ou null
 *   supprimer(cle)                  → void
 *
 * Gros fichiers (vidéos, envoi par morceaux, lecture par plages) :
 *
 *   debuterEnvoi(cle, { type })                          → jeton (texte)
 *   ecrireMorceau(cle, { jeton, indice, decalage, octets }) → étiquette (texte)
 *   terminerEnvoi(cle, { jeton, etiquettes, type })      → void (le fichier devient lisible)
 *   abandonnerEnvoi(cle, { jeton })                      → void
 *   lireTranche(cle, debut, fin)                         → { flux | octets, taille } ou null (fin incluse)
 *   tailleDe(cle)                                        → nombre d'octets ou null
 *
 * Les morceaux arrivent dans l'ordre (indice 0, 1, 2…) ; seul le dernier peut être plus court.
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
    // Envoi par morceaux : « multipart upload » de R2 (parties de 5 Mio au moins, sauf la dernière).
    async debuterEnvoi(cle, { type = 'application/octet-stream' } = {}) {
      exigerCle(cle);
      const envoi = await bucket.createMultipartUpload(cle, { httpMetadata: { contentType: type } });
      return envoi.uploadId;
    },
    async ecrireMorceau(cle, { jeton, indice, octets }) {
      exigerCle(cle);
      const partie = await bucket.resumeMultipartUpload(cle, jeton).uploadPart(indice + 1, octets);
      return JSON.stringify({ partNumber: partie.partNumber, etag: partie.etag });
    },
    async terminerEnvoi(cle, { jeton, etiquettes }) {
      exigerCle(cle);
      await bucket.resumeMultipartUpload(cle, jeton).complete(etiquettes.map(e => JSON.parse(e)));
    },
    async abandonnerEnvoi(cle, { jeton }) {
      exigerCle(cle);
      await bucket
        .resumeMultipartUpload(cle, jeton)
        .abort()
        .catch(() => undefined);
    },
    async lireTranche(cle, debut, fin) {
      exigerCle(cle);
      const objet = await bucket.get(cle, { range: { offset: debut, length: fin - debut + 1 } });
      if (!objet) return null;
      return { flux: objet.body, taille: objet.size };
    },
    async tailleDe(cle) {
      exigerCle(cle);
      const objet = await bucket.head(cle);
      return objet ? objet.size : null;
    },
  };
}

export function stockageMemoire() {
  const objets = new Map();
  const envois = new Map();
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
      envois.delete(cle);
    },
    async debuterEnvoi(cle) {
      exigerCle(cle);
      envois.set(cle, []);
      return 'memoire';
    },
    async ecrireMorceau(cle, { indice, octets }) {
      exigerCle(cle);
      const morceaux = envois.get(cle);
      if (!morceaux) throw new Error('Envoi inconnu.');
      morceaux[indice] = new Uint8Array(octets);
      return String(indice);
    },
    async terminerEnvoi(cle, { type = 'application/octet-stream' } = {}) {
      exigerCle(cle);
      const morceaux = envois.get(cle) ?? [];
      const total = morceaux.reduce((n, m) => n + m.length, 0);
      const octets = new Uint8Array(total);
      let i = 0;
      for (const m of morceaux) {
        octets.set(m, i);
        i += m.length;
      }
      envois.delete(cle);
      objets.set(cle, { octets, type });
    },
    async abandonnerEnvoi(cle) {
      exigerCle(cle);
      envois.delete(cle);
    },
    async lireTranche(cle, debut, fin) {
      exigerCle(cle);
      const o = objets.get(cle);
      if (!o) return null;
      return { octets: o.octets.slice(debut, fin + 1), taille: o.octets.length };
    },
    async tailleDe(cle) {
      exigerCle(cle);
      return objets.get(cle)?.octets.length ?? null;
    },
    taille: () => objets.size,
    envoisOuverts: () => envois.size,
  };
}

/**
 * Dossier sur le disque (Node) : serveur local, et premier pas d'un vrai
 * serveur. Le type est gardé à côté (`<clé>.type`). Le dossier doit rester
 * hors de tout répertoire servi publiquement.
 */
export async function stockageDisque(dossier) {
  const { mkdir, open, readFile, rename, rm, stat, writeFile } = await import('node:fs/promises');
  const { createReadStream } = await import('node:fs');
  const { Readable } = await import('node:stream');
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
      await rm(`${c}.partiel`, { force: true });
    },
    // Envoi par morceaux : un fichier `<clé>.partiel`, écrit morceau par morceau à sa place, renommé à la fin.
    async debuterEnvoi(cle) {
      const c = chemin(cle);
      await mkdir(dirname(c), { recursive: true });
      await writeFile(`${c}.partiel`, new Uint8Array(0));
      return 'disque';
    },
    async ecrireMorceau(cle, { decalage, octets }) {
      const c = chemin(cle);
      const f = await open(`${c}.partiel`, 'r+');
      try {
        let ecrit = 0;
        while (ecrit < octets.length) {
          const { bytesWritten } = await f.write(octets, ecrit, octets.length - ecrit, decalage + ecrit);
          ecrit += bytesWritten;
        }
        await f.truncate(decalage + octets.length);
      } finally {
        await f.close();
      }
      return '';
    },
    async terminerEnvoi(cle, { type = 'application/octet-stream' } = {}) {
      const c = chemin(cle);
      await rename(`${c}.partiel`, c);
      await writeFile(`${c}.type`, type);
    },
    async abandonnerEnvoi(cle) {
      const c = chemin(cle);
      await rm(`${c}.partiel`, { force: true });
    },
    async lireTranche(cle, debut, fin) {
      const c = chemin(cle);
      let taille;
      try {
        taille = (await stat(c)).size;
      } catch (e) {
        if (e?.code === 'ENOENT') return null;
        throw e;
      }
      // Lecture en flux : le serveur n'a jamais toute la vidéo en mémoire.
      return { flux: Readable.toWeb(createReadStream(c, { start: debut, end: Math.min(fin, taille - 1) })), taille };
    },
    /** Chemin du fichier sur le disque (transcription sur le serveur : lecture directe par ffmpeg). */
    cheminLocal(cle) {
      return chemin(cle);
    },
    async tailleDe(cle) {
      try {
        return (await stat(chemin(cle))).size;
      } catch (e) {
        if (e?.code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}
