/**
 * Compression gzip des réponses JSON du relais Node (version 10). Les enveloppes chiffrées sont en
 * base 64 dans du JSON : gzip en retire environ un quart. Jamais pour un flux (SSE : chaque événement
 * doit partir tout de suite), une réponse déjà encodée, une petite réponse, ou un client qui ne
 * l'accepte pas.
 */

import { gzipSync } from 'node:zlib';

export const SEUIL_COMPRESSION = 1024;

export async function compresser(requete, reponse) {
  const type = reponse.headers.get('Content-Type') ?? '';
  if (
    !reponse.body ||
    requete.method === 'HEAD' ||
    !/\bgzip\b/i.test(requete.headers.get('Accept-Encoding') ?? '') ||
    !/^application\/json/i.test(type) ||
    reponse.headers.has('Content-Encoding') ||
    // Réponse tenue ouverte (attente longue : battements puis JSON) : jamais retenue pour la compresser.
    reponse.headers.get('X-Accel-Buffering') === 'no'
  ) {
    return reponse;
  }
  const octets = new Uint8Array(await reponse.arrayBuffer());
  const entetes = new Headers(reponse.headers);
  entetes.append('Vary', 'Accept-Encoding');
  if (octets.length < SEUIL_COMPRESSION) return new Response(octets, { status: reponse.status, statusText: reponse.statusText, headers: entetes });
  const gz = gzipSync(octets, { level: 5 });
  entetes.set('Content-Encoding', 'gzip');
  entetes.set('Content-Length', String(gz.length));
  return new Response(gz, { status: reponse.status, statusText: reponse.statusText, headers: entetes });
}
