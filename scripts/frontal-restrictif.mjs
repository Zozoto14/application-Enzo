/**
 * Faux frontal d'hébergement mutualisé (LiteSpeed / ModSecurity d'o2switch) pour les e2e : il
 * REFUSE les PATCH, PUT et DELETE, et le préliminaire CORS qui les annonce (page HTML 405, sans
 * en-têtes CORS : le navigateur n'y voit qu'une erreur réseau, comme en production). Tout le
 * reste (GET, POST, OPTIONS d'un POST) est transmis tel quel au serveur Esport.
 *
 *   const frontal = await demarrerFrontalRestrictif({ cible: esport.url, port: 8899 });
 *   frontal.url ; frontal.refus (méthodes coupées) ; await frontal.fermer();
 */

import http from 'node:http';

export const METHODES_BLOQUEES = ['PATCH', 'PUT', 'DELETE'];

export async function demarrerFrontalRestrictif({ cible, port }) {
  const refus = [];
  const destination = new URL(cible);
  const serveur = http.createServer((req, res) => {
    const annoncee = String(req.headers['access-control-request-method'] ?? '').toUpperCase();
    if (METHODES_BLOQUEES.includes(req.method) || (req.method === 'OPTIONS' && METHODES_BLOQUEES.includes(annoncee))) {
      refus.push(`${req.method === 'OPTIONS' ? `OPTIONS(${annoncee})` : req.method} ${req.url}`);
      req.resume();
      res.writeHead(405, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>405 Method Not Allowed</h1>LiteSpeed (simulé)</body></html>');
      return;
    }
    const amont = http.request(
      { host: destination.hostname, port: destination.port, method: req.method, path: req.url, headers: { ...req.headers, host: destination.host } },
      r => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    amont.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html>502</html>');
    });
    req.pipe(amont);
  });
  await new Promise(ok => serveur.listen(port, ok));
  return { url: `http://localhost:${port}`, refus, fermer: () => new Promise(ok => serveur.close(() => ok())) };
}
