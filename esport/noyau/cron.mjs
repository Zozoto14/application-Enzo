/**
 * Tâches planifiées de l'Esport (toutes les 5 minutes par une tâche cron sur le serveur Node) : rappels de présence, d'échéance des tâches et J-1/H-1 Discord,
 * débuts d'événements, événements en attente (nouvel essai), file d'envoi Discord (réessais), purge de
 * rétention (journal selon la durée de chaque team, événements traités), agrégation journalière et rétention (90 jours)
 * des statistiques d'usage, ménage des compteurs de débit
 * et des tentatives anciennes, envois de vidéos inachevés (plus de 24 h), transcriptions demandées à une
 * API externe (désactivé par défaut). Lancé par esport/serveur/cron.mjs.
 *
 * Chaque étape est isolée : une erreur est consignée (rapport) sans empêcher les suivantes.
 */

import { traiterFile } from './discord/file.mjs';
import { debutsDiscord, rappelsDiscord } from './discord/rappels.mjs';
import { distribuer } from './evenements.mjs';
import { purgerJournal } from './journal.mjs';
import { purgerLimites } from './limites.mjs';
import { rappelsEcheances } from './objectifs.mjs';
import { rappelsPresence } from './planning/rappels.mjs';
import { nettoyerEnvois, servicesMedias } from './medias/service.mjs';
import { servicesResumes } from './resumes.mjs';
import { agregerUsage, purgerUsage } from './usage/collecte.mjs';
import { rappelsSponsors } from './sponsors/rappels.mjs';
import { rappelsReseaux } from './reseaux/rappels.mjs';
import { traiterAnnoncesReseaux } from './reseaux/annonces.mjs';
import { releverAutomatiquement } from './reseaux/adaptateurs.mjs';
import { purgerCorbeilleDrive, verifierAlerteDrive } from './cm/drive/service.mjs';
import { configDrive } from './cm/drive/regles.mjs';

/**
 * Rend `[{ tache, ok, erreur? }]`. Options : `cle` (CLE_DISCORD sinon CLE_ESPORT), `lienApp`, `jetonBot`, `fetch`,
 * `maintenant`, `stockage` (fichiers : ménage des envois), `cleSession`, `transcriptionExterne` et
 * `fetchTranscription` (API de transcription facultative), `adaptateursReseaux` (relevés automatiques des
 * statistiques des réseaux : aucun en V1, voir reseaux/adaptateurs.mjs), `drive` (quota du Drive CM, regles.mjs).
 */
export async function tachesPlanifiees(base, { cle, lienApp, jetonBot, fetch, maintenant = () => Date.now(), journal = console, stockage, cleSession, transcriptionExterne, fetchTranscription, adaptateursReseaux = [], drive = configDrive() } = {}) {
  const transcrire = async () => {
    if (!transcriptionExterne?.actif || !stockage) return 0;
    const socle = { contexteTeam: async () => { throw new Error('Contexte indisponible dans le cron.'); } };
    const medias = servicesMedias({ base, stockage, cleSession, maintenant, socle });
    return servicesResumes({ base, stockage, cleSession, maintenant, socle, medias, transcriptionExterne, fetchTranscription }).traiterTranscriptionsExternes();
  };
  const etapes = [
    ['rappels de présence', () => rappelsPresence(base, { maintenant: maintenant() })],
    ['rappels d’échéance', () => rappelsEcheances(base, { maintenant: maintenant() })],
    ['rappels Discord', () => rappelsDiscord(base, { maintenant: maintenant() })],
    ['débuts Discord', () => debutsDiscord(base, { maintenant: maintenant() })],
    // Sponsors : prochaines actions, contreparties à faire avant l'échéance, contrats en fin de préavis.
    ['rappels Sponsors', () => rappelsSponsors(base, { maintenant: maintenant() })],
    // Réseaux (page de l'espace CM) : relevés automatiques (adaptateurs d'API, aucun en V1), rappels J+1 / J+7.
    ['relevés automatiques des réseaux', () => releverAutomatiquement(base, { adaptateurs: adaptateursReseaux, maintenant: maintenant() })],
    ['rappels Réseaux', () => rappelsReseaux(base, { maintenant: maintenant() })],
    ['événements en attente', () => distribuer(base, { maintenant: maintenant(), limite: 500 })],
    ['file Discord', () => traiterFile(base, { cle, maintenant: maintenant(), lienApp, jetonBot, ...(fetch ? { fetch } : {}) })],
    ['annonces Réseaux', () => traiterAnnoncesReseaux(base, { cle, maintenant: maintenant(), lienApp, jetonBot, stockage, ...(fetch ? { fetch } : {}) })],
    ['rétention du journal', () => purgerJournal(base, { maintenant: maintenant() })],
    // Statistiques d'usage : agrégation des jours terminés (une fois par jour), puis détail brut de plus de 90 jours effacé.
    ['agrégation de l’usage', () => agregerUsage(base, { maintenant: maintenant() })],
    ['rétention de l’usage', () => purgerUsage(base, { maintenant: maintenant() })],
    ['limites de débit', () => purgerLimites(base, maintenant())],
    ['tentatives anciennes', () => base.executer('DELETE FROM tentatives WHERE maj_le < ?', [new Date(maintenant() - 7 * 86_400_000).toISOString()])],
    ['envois inachevés', () => nettoyerEnvois(base, stockage, { maintenant: maintenant() })],
    // Drive de la section CM : corbeille de plus de 30 jours effacée (octets compris), alerte d'espace à 80 %.
    ['corbeille du Drive', () => purgerCorbeilleDrive(base, stockage, { maintenant: maintenant() })],
    ['espace du Drive', () => verifierAlerteDrive(base, { quota: drive?.quota, maintenant: maintenant() })],
    ['transcriptions externes', transcrire],
  ];
  const rapport = [];
  for (const [tache, faire] of etapes) {
    try {
      await faire();
      rapport.push({ tache, ok: true });
    } catch (e) {
      journal.error(`[esport] cron : ${tache}`, e);
      rapport.push({ tache, ok: false, erreur: String(e?.message ?? e) });
    }
  }
  return rapport;
}
