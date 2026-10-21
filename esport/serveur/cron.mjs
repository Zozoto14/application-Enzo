/**
 * Tâches planifiées de l'Esport (les mêmes que le cron du Worker : rappels, file Discord, purge du
 * journal…), plus la purge des clés expirées du relais. Lancé par une tâche cron cPanel toutes les
 * 5 minutes :
 *
 *   node /home/jayo8828/application-enzo/esport/serveur/cron.mjs >> /home/jayo8828/logs/esport-cron.log 2>&1
 *
 * Verrou : si l'exécution précédente tourne encore, celle-ci s'arrête aussitôt (pas de double envoi).
 */

import { mkdirSync, openSync, closeSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { basePostgres, optionsDepuisEnv } from '../adaptateurs/postgres.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { tacheRecap } from '../noyau/recap.mjs';
import { creerEnvoyeur } from './courriel-smtp.mjs';
import { purgerKvExpire } from '../../relais/serveur/kv-postgres.mjs';
import { chargerConfigEsport } from './config.mjs';

/** Exécute une fois toutes les tâches ; rend le rapport. */
export async function executerCron(base, config, { fetch, maintenant, creerTransport } = {}) {
  const rapport = await tachesPlanifiees(base, { cle: config.cleDiscord || config.cleSession, lienApp: config.lienApp, jetonBot: config.discordBot?.jetonBot, fetch, maintenant });
  // Récapitulatif e-mail (Node seulement : SMTP de esport.env) ; sans SMTP, rien n'est fait.
  if (config.smtp) {
    const envoyer = await creerEnvoyeur(config.smtp, { creerTransport });
    try {
      const b = await tacheRecap(base, { cle: config.cleDiscord || config.cleSession, envoyer, maintenant: maintenant ? maintenant() : Date.now(), lienApp: config.lienApp });
      rapport.push({ tache: 'récapitulatifs e-mail', ok: b.echecs === 0, n: b.envoyes, ...(b.echecs ? { erreur: `${b.echecs} échec(s)` } : {}) });
    } catch (e) {
      rapport.push({ tache: 'récapitulatifs e-mail', ok: false, erreur: String(e?.code ?? 'erreur') });
    } finally {
      envoyer?.fermer?.();
    }
  }
  try {
    const n = await purgerKvExpire(base, maintenant ? maintenant() : Date.now());
    rapport.push({ tache: 'clés expirées du relais', ok: true, n });
  } catch (e) {
    rapport.push({ tache: 'clés expirées du relais', ok: false, erreur: String(e?.message ?? e) });
  }
  return rapport;
}

/** Verrou simple par fichier (créé en exclusif) ; un verrou de plus de 30 minutes est considéré mort. */
function prendreVerrou(chemin) {
  mkdirSync(join(chemin, '..'), { recursive: true });
  try {
    if (Date.now() - statSync(chemin).mtimeMs > 30 * 60_000) rmSync(chemin, { force: true });
  } catch {
    // Pas de verrou.
  }
  try {
    const fd = openSync(chemin, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = chargerConfigEsport();
  const verrou = join(homedir(), '.appdashboard', 'esport-cron.verrou');
  if (!prendreVerrou(verrou)) {
    console.log(`${new Date().toISOString()} cron Esport : exécution précédente encore en cours, rien à faire.`);
    process.exit(0);
  }
  const base = await basePostgres({ ...optionsDepuisEnv(), max: 2 });
  try {
    const rapport = await executerCron(base, config);
    const echecs = rapport.filter(r => !r.ok);
    console.log(`${new Date().toISOString()} cron Esport : ${rapport.length - echecs.length}/${rapport.length} tâches faites${echecs.length ? ` ; ÉCHECS : ${echecs.map(e => `${e.tache} (${e.erreur})`).join(' ; ')}` : ''}`);
    if (echecs.length) process.exitCode = 1;
  } finally {
    await base.fermer();
    rmSync(verrou, { force: true });
  }
}
