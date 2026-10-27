/**
 * Processus de fond de l'IA locale (lancé par lanceur.mjs : par l'app quand un travail est demandé, par le
 * cron en secours). Il exécute les travaux de l'assistant des profils de jeu (brouillons, vérifications)
 * avec le moteur local, hors de l'app Passenger (qui peut être endormie pendant un calcul de plusieurs
 * minutes) :
 *
 *  - UN seul processus de fond (verrou etat/travailleur.verrou : pid, battement toutes les 30 s) ;
 *  - le moteur (llama-server) est démarré au premier travail, gardé tant que des travaux arrivent, et
 *    ARRÊTÉ après `inactiviteMs` sans travail (5 min par défaut) : le processus se termine alors ;
 *  - durée de vie bornée (IA_LOCALE_DUREE_TRAVAILLEUR_MIN) : il passe la main, le cron en relance un ;
 *  - au plus une vérification automatique due par passage (comme le cron en mode API).
 *
 * `executerTravailleur` est injectable (services, horloge, pause) pour les tests.
 */

import { closeSync, mkdirSync, openSync, rmSync, utimesSync, writeSync } from 'node:fs';
import { setPriority } from 'node:os';
import { pathToFileURL } from 'node:url';
import { cheminsIaLocale } from './installation.mjs';
import { travailleurActif } from './lanceur.mjs';

const attendre = ms => new Promise(ok => setTimeout(ok, ms));
export const PAUSE_SONDAGE_MS = 15_000;

/**
 * Boucle : `jeux.tacheCron({ executionLocale: true })` tant qu'il y a du travail, puis attente de nouveaux
 * travaux jusqu'à `inactiviteMs`. Rend `{ travaux, passages, raison }`. Le moteur est toujours arrêté à la fin.
 */
export async function executerTravailleur({ jeux, local, inactiviteMs = 5 * 60_000, dureeMaxMs = 60 * 60_000, horloge = () => Date.now(), dormir = attendre, arret = () => false, battement = () => undefined, apresTravail = async () => undefined, journal = console }) {
  const debut = horloge();
  let dernierTravail = debut;
  let travaux = 0;
  let passages = 0;
  let raison = 'inactivite';
  try {
    for (;;) {
      if (arret()) {
        raison = 'arret';
        break;
      }
      if (horloge() - debut >= dureeMaxMs) {
        raison = 'duree';
        break;
      }
      battement();
      // Premier passage : au plus une vérification automatique due ; ensuite, seulement les travaux demandés.
      const r = await jeux.tacheCron({ executionLocale: true, limite: passages === 0 ? 1 : 0 });
      passages += 1;
      if (r.raison === 'mode-api' || r.raison === 'locale-absente' || r.raison === 'non-installee' || r.raison === 'cle-absente') {
        raison = r.raison;
        break;
      }
      if (r.n > 0) {
        travaux += r.n;
        dernierTravail = horloge();
        await apresTravail().catch(() => undefined);
        continue;
      }
      if (horloge() - dernierTravail >= inactiviteMs) break;
      // Moteur gardé chaud pendant l'attente (son propre minuteur d'inactivité l'arrête au besoin).
      await dormir(Math.min(PAUSE_SONDAGE_MS, Math.max(1000, inactiviteMs)));
    }
  } catch (e) {
    raison = 'erreur';
    journal.error?.(`${new Date(horloge()).toISOString()} IA locale (processus de fond) : ${e?.code ?? e?.message ?? e}`);
  } finally {
    await local?.arreter?.();
  }
  return { travaux, passages, raison };
}

// ------------------------------------------------------------------ Verrou du processus de fond

export function prendreVerrouTravailleur(chemin, pid = process.pid) {
  if (!travailleurActif(chemin)) rmSync(chemin, { force: true });
  try {
    const fd = openSync(chemin, 'wx', 0o600);
    writeSync(fd, String(pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function toucherVerrouTravailleur(chemin) {
  try {
    const t = new Date();
    utimesSync(chemin, t, t);
  } catch {
    // Verrou disparu : sans conséquence.
  }
}

// ------------------------------------------------------------------ Lancement direct

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    setPriority(19);
  } catch {
    // Le lanceur passe déjà par « nice -n 19 ».
  }
  const { chargerConfigEsport } = await import('../config.mjs');
  const { creerIaLocale } = await import('./service.mjs');
  const { nettoyerOrphelinIaLocale } = await import('./gestionnaire.mjs');
  const config = chargerConfigEsport();
  const reglages = config.iaLocale;
  const horodatage = () => new Date().toISOString();
  if (!reglages?.installation?.installe) {
    console.log(`${horodatage()} IA locale : ${reglages?.installation?.raison ?? 'non installée'}, rien à faire.`);
    process.exit(0);
  }
  const c = cheminsIaLocale(reglages.dossier);
  mkdirSync(c.etat, { recursive: true, mode: 0o700 });
  if (!prendreVerrouTravailleur(c.verrouTravailleur)) {
    console.log(`${horodatage()} IA locale : un processus de fond travaille déjà.`);
    process.exit(0);
  }
  let arreter = false;
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => (arreter = true));
  const veille = setInterval(() => toucherVerrouTravailleur(c.verrouTravailleur), 30_000);
  veille.unref();
  const { basePostgres, optionsDepuisEnv } = await import('../../adaptateurs/postgres.mjs');
  const { resoudreNode, telechargeurNode } = await import('../../adaptateurs/apercuNode.mjs');
  const { servicesJeux } = await import('../../noyau/jeux/service.mjs');
  const { distribuer } = await import('../../noyau/evenements.mjs');
  const base = await basePostgres({ ...optionsDepuisEnv(), max: 2 });
  const local = creerIaLocale(reglages, { role: 'travailleur' });
  try {
    nettoyerOrphelinIaLocale({ dossier: reglages.dossier });
    const jeux = servicesJeux({ base, socle: {}, ia: { config: config.ia, telecharger: telechargeurNode(), resoudre: resoudreNode, local }, travauxIa: 'synchrone' });
    const bilan = await executerTravailleur({
      jeux,
      local,
      inactiviteMs: reglages.inactiviteMs,
      dureeMaxMs: reglages.dureeTravailleurMs,
      arret: () => arreter,
      battement: () => toucherVerrouTravailleur(c.verrouTravailleur),
      apresTravail: () => distribuer(base, { maintenant: Date.now() }),
    });
    console.log(`${horodatage()} IA locale : ${bilan.travaux} travail(aux) fait(s), fin (${bilan.raison}).`);
  } catch (e) {
    console.error(`${horodatage()} IA locale : erreur`, e?.message ?? e);
    process.exitCode = 1;
  } finally {
    clearInterval(veille);
    await local?.arreter?.();
    await base.fermer();
    rmSync(c.verrouTravailleur, { force: true });
  }
}
