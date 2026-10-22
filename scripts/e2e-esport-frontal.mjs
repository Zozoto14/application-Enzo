/**
 * Test de bout en bout : frontal mutualisé (o2switch : LiteSpeed / ModSecurity) qui REFUSE les
 * PATCH, PUT et DELETE et leur préliminaire CORS (scripts/frontal-restrictif.mjs).
 *
 * Le vrai client de l'app (src/esport/client.ts, planning/api.ts, ressources/api.ts, empaquetés
 * par esbuild) tourne dans Chromium (CORS réel) et parle au serveur Esport local À TRAVERS ce
 * frontal. On vérifie que :
 *  - le frontal coupe bien un PATCH direct (le navigateur n'y voit qu'une erreur réseau) ;
 *  - modifier les permissions d'un rôle, modifier une tâche, modifier un événement du planning,
 *    changer les réglages du planning (PUT) et supprimer une ressource marchent quand même
 *    (POST + X-Methode, annoncé par le serveur : « surcharge-methode ») ;
 *  - le serveur a bien appliqué chaque changement (relu sans frontal).
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-frontal.mjs
 */

import http from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { demarrerFrontalRestrictif } from './frontal-restrictif.mjs';
import { chargerPlaywright, racine } from './mobile-outils.mjs';

const JETON = 'jeton-e2e-esport-frontal-0123456789ab';
const PORT_ESPORT = 8862;
const PORT_FRONTAL = 8863;
const PORT_SITE = 5311;
const log = (...a) => console.log('[e2e-esport-frontal]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const frontal = await demarrerFrontalRestrictif({ cible: esport.url, port: PORT_FRONTAL });

// Le client de l'app, tel quel, exposé à la page.
const paquet = await build({
  stdin: {
    contents: "export { clientEsport } from './src/esport/client'; export { apiPlanning } from './src/esport/planning/api'; export { apiRessources } from './src/esport/ressources/api';",
    resolveDir: racine,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'Esport',
  platform: 'browser',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
const code = paquet.outputFiles[0].text;
const site = http.createServer((req, res) => {
  if (req.url === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(code);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><title>frontal</title><script src="/client.js"></script>');
});
await new Promise(ok => site.listen(PORT_SITE, ok));

/** Appel direct au serveur (sans frontal) : préparation et relecture. */
async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  log('préparation (API directe) : team, tâche, événement, ressource');
  const sess = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sess, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const team = (await api('/teams', sess, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const t = `/teams/${team.id}`;
  const coach = (await api(`${t}/roles`, sess)).corps.roles.find(r => r.cle === 'coach');
  const tache = (await api(`${t}/taches`, sess, { methode: 'POST', corps: { titre: 'Revoir la VOD' } })).corps;
  const evenement = (await api(`${t}/planning`, sess, { methode: 'POST', corps: { type: 'training', titre: 'Entraînement', date: '2026-11-20', heureDebut: '20:00', heureFin: '22:00' } })).corps;
  const ressource = (await api(`${t}/ressources`, sess, { methode: 'POST', corps: { genre: 'note', titre: 'Routine', description: 'Échauffement' } })).corps;
  verifier(Boolean(team?.id && coach?.id && tache?.id && evenement?.id && ressource?.id), `données prêtes ${JSON.stringify({ tache: tache?.id ?? tache, evenement: evenement?.id ?? evenement, ressource: ressource?.id ?? ressource })}`);

  const page = await (await navigateur.newContext()).newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  await page.goto(`http://localhost:${PORT_SITE}/`);
  await page.waitForFunction(() => Boolean(globalThis.Esport?.clientEsport));

  log('le frontal coupe un PATCH direct');
  const direct = await page.evaluate(async ({ adresse, chemin }) => {
    try {
      const r = await fetch(`${adresse}${chemin}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return `statut ${r.status}`;
    } catch (e) {
      return `réseau : ${e.name}`;
    }
  }, { adresse: frontal.url, chemin: `${t}/roles/${coach.id}` });
  verifier(direct.startsWith('réseau'), `PATCH direct à travers le frontal : ${direct} (« injoignable » avant la correction)`);

  log('le client de l’app, à travers le frontal');
  const voulues = coach.permissions.filter(p => p !== 'strats.create');
  const resultats = await page.evaluate(
    async ({ adresse, jeton, teamId, roleId, voulues, tacheId, evenementId, ressourceId }) => {
      const { clientEsport, apiPlanning, apiRessources } = globalThis.Esport;
      const c = clientEsport({ adresse, jetonRelais: jeton });
      const essai = async f => {
        try {
          await f();
          return 'ok';
        } catch (e) {
          return `${e.code ?? e.name} : ${e.message}`;
        }
      };
      return {
        role: await essai(() => c.modifierRole(teamId, roleId, { permissions: voulues })),
        tache: await essai(() => c.modifierTache(teamId, tacheId, { titre: 'Revoir la VOD (fait)' })),
        evenement: await essai(() => apiPlanning(c, teamId).modifier(evenementId, { titre: 'Entraînement décalé', heureDebut: '21:00' })),
        reglagesPlanning: await essai(() => apiPlanning(c, teamId).changerReglages({ rappelHeures: 2 })),
        ressource: await essai(() => apiRessources(c).supprimer(teamId, ressourceId)),
        profil: await essai(() => c.majProfil({ pseudo: 'Fondateur Bis' })),
      };
    },
    { adresse: frontal.url, jeton: JETON, teamId: team.id, roleId: coach.id, voulues, tacheId: tache.id, evenementId: evenement.id, ressourceId: ressource.id },
  );
  for (const [nom, r] of Object.entries(resultats)) verifier(r === 'ok', `${nom} : ${r}`);

  log('relecture sans frontal : chaque changement est appliqué');
  const coachApres = (await api(`${t}/roles`, sess)).corps.roles.find(r => r.cle === 'coach');
  verifier(!coachApres.permissions.includes('strats.create') && coachApres.modifie === true, 'rôle Coach : « Strats : Créer » retirée');
  const taches = (await api(`${t}/taches`, sess)).corps;
  const listeTaches = Array.isArray(taches) ? taches : (taches.taches ?? []);
  verifier(listeTaches.some(x => x.id === tache.id && x.titre === 'Revoir la VOD (fait)'), 'tâche renommée');
  const ev = (await api(`${t}/planning/${evenement.id}`, sess)).corps;
  verifier((ev.evenement ?? ev).titre === 'Entraînement décalé', 'événement du planning modifié');
  verifier((await api(`${t}/ressources/${ressource.id}`, sess)).statut === 404, 'ressource supprimée');
  verifier(frontal.refus.length >= 1 && frontal.refus.every(r => r.startsWith('PATCH') || r.startsWith('OPTIONS(PATCH)')), `seul le PATCH direct a été coupé par le frontal (${frontal.refus.join(', ')})`);
} catch (e) {
  echecs++;
  console.error(e);
} finally {
  await navigateur.close();
  await frontal.fermer();
  site.close();
  await esport.fermer?.();
}
console.log(echecs === 0 ? 'e2e frontal Esport : tout est bon' : `e2e frontal Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
