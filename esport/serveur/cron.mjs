/**
 * Tâches planifiées de l'Esport (esport/noyau/cron.mjs : rappels, file Discord, purge du
 * journal…), plus la purge des clés expirées du relais et le lancement du processus de transcription
 * sur le serveur (esport/serveur/transcription/, s'il est installé et que des réunions attendent). Lancé par une tâche cron cPanel toutes les
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
import { stockageDisque } from '../adaptateurs/stockage.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { tacheRecap } from '../noyau/recap.mjs';
import { creerEnvoyeur } from './courriel-smtp.mjs';
import { purgerKvExpire } from '../../relais/serveur/kv-postgres.mjs';
import { chargerConfigEsport } from './config.mjs';
import { lancerTravailleur } from './transcription/lanceur.mjs';
import { nettoyerOrphelinIaLocale } from './ia-locale/gestionnaire.mjs';
import { creerIaLocale } from './ia-locale/service.mjs';
import { journalIaLocaleParDefaut } from './ia-locale/installation.mjs';
import { lancerTravailleurIaLocale } from './ia-locale/lanceur.mjs';
import { resoudreNode, telechargeurNode } from '../adaptateurs/apercuNode.mjs';
import { servicesJeux } from '../noyau/jeux/service.mjs';
import { distribuer } from '../noyau/evenements.mjs';

/** Exécute une fois toutes les tâches ; rend le rapport. `lancer` : lanceur de la transcription (tests). */
export async function executerCron(base, config, { fetch, maintenant, stockage, creerTransport, lancer = lancerTravailleur, fetchIa, telechargerPages, lancerIaLocale = lancerTravailleurIaLocale } = {}) {
  const fichiers = stockage ?? (config.dossierFichiers ? await stockageDisque(config.dossierFichiers) : undefined);
  const rapport = await tachesPlanifiees(base, {
    cle: config.cleDiscord || config.cleSession,
    lienApp: config.lienApp,
    jetonBot: config.discordBot?.jetonBot,
    fetch,
    maintenant,
    stockage: fichiers,
    cleSession: config.cleSession,
    transcriptionExterne: config.transcriptionExterne,
    ...(config.drive ? { drive: config.drive } : {}),
  });
  // Récapitulatif e-mail (Node seulement : SMTP de esport.env) ; sans SMTP, rien n'est fait.
  if (config.smtp) {
    const envoyer = await creerEnvoyeur(config.smtp, { creerTransport });
    try {
      const b = await tacheRecap(base, { cle: config.cleDiscord || config.cleSession, envoyer, maintenant: maintenant ? maintenant() : Date.now(), lienApp: config.lienApp });
      rapport.push({ tache: 'récapitulatifs e-mail', ok: b.echecs === 0, n: b.envoyes, ...(b.echecs ? { erreur: `${b.echecs} échec(s)` } : {}) });
    } catch (e) {
      rapport.push({ tache: 'récapitulatifs e-mail', ok: false, erreur: String(e?.code ?? 'erreur') });
    } finally {
      await envoyer?.fermer?.();
    }
  }
  // Profils de jeu : vérification automatique limitée (au plus une par passage, plafond mensuel), si l'IA est configurée.
  // IA locale : le cron ne calcule pas lui-même ; il arrête un moteur orphelin et lance le processus de fond.
  try {
    if (config.iaLocale?.installation?.installe) {
      const n = await nettoyerOrphelinIaLocale({ dossier: config.iaLocale.dossier, journal: journalIaLocaleParDefaut(), role: 'cron' });
      if (n.nettoye) rapport.push({ tache: 'IA locale : moteur orphelin', ok: true, n: n.pid ? 1 : 0 });
    }
    const local = creerIaLocale(config.iaLocale, { role: 'cron', lancer: lancerIaLocale });
    const jeux = servicesJeux({
      base,
      ...(maintenant ? { maintenant } : {}),
      socle: {},
      ia: { config: config.ia, telecharger: telechargerPages ?? telechargeurNode(), resoudre: telechargerPages ? undefined : resoudreNode, ...(fetchIa ? { fetch: fetchIa } : {}), ...(local ? { local } : {}) },
      travauxIa: 'synchrone',
    });
    const r = await jeux.tacheCron();
    // Notifications (« mises à jour proposées ») tout de suite, sans attendre le passage suivant.
    if (r.n) await distribuer(base, { maintenant: maintenant ? maintenant() : Date.now() });
    let etat = r.raison;
    if (r.raison === 'ia-locale' && r.aFaire > 0) etat = `ia-locale : ${(await local.lancerTravailleur()).raison}`;
    rapport.push({ tache: 'profils de jeu (IA)', ok: true, n: r.n, ...(etat ? { etat } : {}) });
  } catch (e) {
    rapport.push({ tache: 'profils de jeu (IA)', ok: false, erreur: String(e?.code ?? e?.message ?? e) });
  }
  // Transcription sur le serveur : processus de fond détaché (un seul à la fois), si des réunions attendent.
  if (config.transcriptionServeur?.disponible) {
    try {
      const r = await lancer({ base, config, ...(maintenant ? { maintenant } : {}) });
      rapport.push({ tache: 'transcription serveur', ok: true, n: r.n ?? 0, etat: r.raison });
    } catch (e) {
      rapport.push({ tache: 'transcription serveur', ok: false, erreur: String(e?.message ?? e) });
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
