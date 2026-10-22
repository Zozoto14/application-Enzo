/**
 * Serveur Esport LOCAL (Node 22, sans Cloudflare) : même API que le Worker,
 * base SQLite (fichier ou mémoire), et, sauf `--relais`, un relais de
 * développement en mémoire (le vrai relais/worker.mjs) avec un jeton maître
 * de développement. Sert au développement, aux tests de bout en bout, et de
 * point de départ pour un vrai serveur (docs/esport/migration-serveur.md).
 *
 *   node esport/outils/serveur-local.mjs [--port 8790] [--base esport/esport-local.db]
 *        [--relais https://applibourse-relais.<vous>.workers.dev] [--graines]
 *
 * Variables : ESPORT_CLE (clé de session ; tirée au hasard sinon),
 * ESPORT_JETON_DEV (jeton maître du relais de développement).
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { baseSqliteMigree } from '../adaptateurs/sqlite.mjs';
import { stockageDisque, stockageMemoire } from '../adaptateurs/stockage.mjs';
import { creerApi } from '../noyau/api.mjs';
import { verificateurRelais } from '../noyau/authentification.mjs';
import { traiterFile } from '../noyau/discord/file.mjs';
import { debutsDiscord, rappelsDiscord } from '../noyau/discord/rappels.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { rappelsPresence } from '../noyau/planning/rappels.mjs';
import { envoyerFlux } from '../serveur/commun.mjs';
import { configMedias, nettoyerEnvois } from '../noyau/medias/service.mjs';

function kvMemoire() {
  const donnees = new Map();
  return { get: async c => (donnees.has(c) ? donnees.get(c) : null), put: async (c, v) => void donnees.set(c, v), delete: async c => void donnees.delete(c) };
}

/**
 * Démarre le serveur. Options : `port`, `base` (chemin SQLite ou ':memory:'),
 * `relais` (adresse d'un relais réel) OU `jetonDev` (relais en mémoire),
 * `cle`, `creationTeams`, `graines`, `fetchDiscord` (envoi vers Discord, simulé en test),
 * `cleDiscord`, `lienApp`, `discordBot` ({ applicationId, publicKey, jetonBot }), `medias` ({ plafond, tailleMorceau } :
 * vidéos déposées). Rend `{ url, base, envRelais, fermer }`.
 */
export async function demarrerServeurEsport({
  port = 8790,
  base: chemin = ':memory:',
  relais,
  jetonDev = process.env.ESPORT_JETON_DEV ?? `jeton-dev-${randomBytes(12).toString('hex')}`,
  cle = process.env.ESPORT_CLE ?? randomBytes(32).toString('hex'),
  creationTeams = 'fondateur',
  graines = false,
  hote = '127.0.0.1',
  fetchDiscord,
  cleDiscord = process.env.ESPORT_CLE_DISCORD,
  lienApp = process.env.ESPORT_LIEN_APP ?? '',
  discordBot = { applicationId: process.env.DISCORD_APPLICATION_ID, publicKey: process.env.DISCORD_PUBLIC_KEY, jetonBot: process.env.DISCORD_BOT_TOKEN },
  medias = configMedias(process.env),
  // Transcription sur le serveur (tests de bout en bout : déclarée « installée », processus simulé).
  transcriptionServeur,
} = {}) {
  const base = await baseSqliteMigree(chemin);
  // Fichiers (PDF des résumés) : à côté de la base SQLite (dossier `<base>.fichiers/`), en mémoire sinon.
  const stockage = chemin === ':memory:' ? stockageMemoire() : await stockageDisque(`${chemin}.fichiers`);
  let envRelais;
  let verifierJeton;
  if (relais) {
    verifierJeton = verificateurRelais({ adresse: relais });
  } else {
    const relaisWorker = (await import('../../relais/worker.mjs')).default;
    envRelais = { JETON: jetonDev, BOITE: kvMemoire() };
    verifierJeton = verificateurRelais({ liaison: { fetch: (url, init) => relaisWorker.fetch(new Request(url, init), envRelais) } });
  }
  if (graines) {
    const { semer } = await import('./graines.mjs');
    const existe = await base.premier('SELECT id FROM teams LIMIT 1', []);
    if (!existe) await semer(base, { stockage });
  }
  const traiter = creerApi({ base, stockage, cleSession: cle, verifierJeton, creationTeams, cleDiscord, fetchDiscord, lienApp, discordBot, medias, ...(transcriptionServeur ? { transcriptionServeur } : {}) });
  // Cron du Worker (rappels de présence, d'échéance et Discord, événements en attente, file Discord), toutes les 15 minutes.
  const cron = setInterval(() => {
    void (async () => {
      const { rappelsEcheances } = await import('../noyau/objectifs.mjs');
      await rappelsPresence(base, { maintenant: Date.now() });
      await rappelsEcheances(base, { maintenant: Date.now() });
      await rappelsDiscord(base, { maintenant: Date.now() });
      await debutsDiscord(base, { maintenant: Date.now() });
      await distribuer(base, { maintenant: Date.now() });
      await traiterFile(base, { cle: cleDiscord || cle, fetch: fetchDiscord, maintenant: Date.now(), lienApp, jetonBot: discordBot?.jetonBot });
      // Rétention : journal (durée choisie par chaque team), événements traités, compteurs de débit.
      const { purgerJournal } = await import('../noyau/journal.mjs');
      const { purgerLimites } = await import('../noyau/limites.mjs');
      await purgerJournal(base, { maintenant: Date.now() });
      await purgerLimites(base, Date.now());
      await nettoyerEnvois(base, stockage, { maintenant: Date.now() });
    })().catch(e => console.error('[esport] cron local', e));
  }, 15 * 60 * 1000);
  cron.unref?.();
  const serveur = http.createServer(async (req, res) => {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const entetes = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '' };
    try {
      const reponse = await traiter(
        new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
          method: req.method,
          headers: entetes,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux),
        }),
      );
      res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
      if (req.method === 'HEAD' || !reponse.body) res.end();
      else await envoyerFlux(reponse.body, res);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erreur: String(e?.message ?? e) }));
    }
  });
  await new Promise(ok => serveur.listen(port, hote, ok));
  return {
    url: `http://localhost:${port}`,
    base,
    stockage,
    envRelais,
    jetonDev: envRelais ? jetonDev : undefined,
    fermer: () => {
      clearInterval(cron);
      return new Promise(ok => serveur.close(() => ok()));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const option = nom => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const s = await demarrerServeurEsport({
    port: Number(option('--port') ?? 8790),
    base: option('--base') ?? 'esport/esport-local.db',
    relais: option('--relais'),
    graines: args.includes('--graines'),
    creationTeams: args.includes('--creation-tous') ? 'tous' : 'fondateur',
  });
  console.log(`Esport local : ${s.url} (santé : ${s.url}/sante)`);
  if (s.jetonDev) {
    const { jetonDeProfil } = await import('../../relais/worker.mjs');
    console.log(`Relais de développement en mémoire. Jeton maître (Fondateur) : ${s.jetonDev}`);
    console.log(`Jeton de profil de Léa (lea12345) : ${await jetonDeProfil(s.jetonDev, 'lea12345')}`);
  }
}
