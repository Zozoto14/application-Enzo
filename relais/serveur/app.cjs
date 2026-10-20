// Fichier de démarrage pour Passenger (o2switch « Setup Node.js App » › Application startup file :
// serveur/app.cjs, racine de l'application : application-enzo/relais).
globalThis.__appdashboardDemarrer = 'relais';
import('./app.mjs').catch(e => {
  console.error('[relais] chargement impossible :', e);
  process.exit(1);
});
