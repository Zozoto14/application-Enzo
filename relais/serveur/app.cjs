// Fichier de démarrage pour Passenger (o2switch « Setup Node.js App » › Application startup file :
// serveur/app.cjs, racine de l'application : application-enzo/relais).
// Si le code ne se charge même pas (erreur de syntaxe, module manquant), l'erreur est aussi écrite dans
// ~/logs/relais.log (JOURNAL_FICHIER si posé dans Setup Node.js App) : sinon elle ne serait visible nulle part.
globalThis.__appdashboardDemarrer = 'relais';
import('./app.mjs').catch(e => {
  console.error('[relais] chargement impossible :', e);
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const fichier = process.env.JOURNAL_FICHIER || path.join(require('node:os').homedir(), 'logs', 'relais.log');
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.appendFileSync(fichier, `${new Date().toISOString()} ERROR [relais] chargement impossible (pid ${process.pid}, Node ${process.versions.node}) : ${(e && e.stack) || e}\n`);
  } catch {
    // journal impossible : la console reste
  }
  process.exit(1);
});
