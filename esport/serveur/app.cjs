// Fichier de démarrage pour Passenger (o2switch « Setup Node.js App » › Application startup file :
// serveur/app.cjs). Passenger charge un fichier CommonJS ; le serveur, lui, est un module ES.
globalThis.__appdashboardDemarrer = 'esport';
import('./app.mjs').catch(e => {
  console.error('[esport] chargement impossible :', e);
  process.exit(1);
});
