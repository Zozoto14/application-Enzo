/**
 * Tâches planifiées de l'Esport (toutes les 5 minutes par une tâche cron sur le serveur Node) : rappels de présence, d'échéance des tâches et J-1/H-1 Discord,
 * rappels des réunions de l'équipe CM (in-app et MP du bot),
 * débuts d'événements, événements en attente (nouvel essai), file d'envoi Discord (réessais), purge de
 * rétention (journal selon la durée de chaque team, événements traités, semaines de disponibilités personnalisées), agrégation journalière et rétention (90 jours)
 * des statistiques d'usage, ménage des compteurs de débit
 * et des tentatives anciennes, envois de vidéos inachevés (plus de 24 h), transcriptions demandées à une
 * API externe (désactivé par défaut), tickets Discord (relecture de secours, cycle de vie), salons de match des événements. Lancé par esport/serveur/cron.mjs.
 *
 * Chaque étape est isolée : une erreur est consignée (rapport) sans empêcher les suivantes.
 */

import { traiterFile } from './discord/file.mjs';
import { debutsDiscord, rappelsDiscord } from './discord/rappels.mjs';
import { distribuer } from './evenements.mjs';
import { purgerJournal } from './journal.mjs';
import { purgerNotifications } from './notifications/centre.mjs';
import { purgerLimites } from './limites.mjs';
import { rappelsEcheances } from './objectifs.mjs';
import { rappelsPresence } from './planning/rappels.mjs';
import { purgerDisposSemaines } from './planning/dispos.mjs';
import { nettoyerEnvois, servicesMedias } from './medias/service.mjs';
import { servicesResumes } from './resumes.mjs';
import { agregerUsage, purgerUsage } from './usage/collecte.mjs';
import { rappelsSponsors } from './sponsors/rappels.mjs';
import { rappelsReseaux } from './reseaux/rappels.mjs';
import { traiterAnnoncesReseaux } from './reseaux/annonces.mjs';
import { traiterDevblogDiscord } from './devblog/discord.mjs';
import { publierProgrammes } from './devblog/auto.mjs';
import { releverAutomatiquement } from './reseaux/adaptateurs.mjs';
import { purgerCorbeilleDrive, verifierAlerteDrive } from './cm/drive/service.mjs';
import { purgerCorbeilleStrats } from './strats/service.mjs';
import { purgerCorbeilleLineups } from './lineups/service.mjs';
import { purgerCorbeillePlans } from './plans/service.mjs';
import { configDrive } from './cm/drive/regles.mjs';
import { rappelsReunions } from './cm/reunions/rappels.mjs';
import { traiterMpReunions } from './cm/reunions/mp.mjs';
import { tachesTickets } from './tickets/cron.mjs';
import { tachesEvenementsDiscord } from './evenements-club/discord.mjs';
import { servicesEvenements } from './evenements-club/service.mjs';
import { clientSite, configSite } from './site-lz/client.mjs';
import { creerPontSite } from './site-lz/pont.mjs';
import { creerSalonsMatch } from './evenements-club/salons-match.mjs';
import { expirerRolesTemp } from './roles-temp/moteur.mjs';

/**
 * Rend `[{ tache, ok, erreur? }]`. Options : `cle` (CLE_DISCORD sinon CLE_ESPORT), `lienApp`, `jetonBot`, `fetch`,
 * `maintenant`, `stockage` (fichiers : ménage des envois), `cleSession`, `transcriptionExterne` et
 * `fetchTranscription` (API de transcription facultative), `adaptateursReseaux` (relevés automatiques des
 * statistiques des réseaux : aucun en V1, voir reseaux/adaptateurs.mjs), `drive` (quota du Drive CM, regles.mjs).
 */
export async function tachesPlanifiees(base, { cle, lienApp, jetonBot, fetch, maintenant = () => Date.now(), journal = console, stockage, cleSession, transcriptionExterne, fetchTranscription, adaptateursReseaux = [], drive = configDrive(), tickets, siteLz = null } = {}) {
  let rapportTickets = null;
  let rapportSalons = null;
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
    // Réunions de l'équipe CM (migration 0039) : rappel avant chaque réunion (in-app, puis MP du bot ci-dessous).
    ['rappels des réunions CM', () => rappelsReunions(base, { maintenant: maintenant() })],
    ['événements en attente', () => distribuer(base, { maintenant: maintenant(), limite: 500 })],
    ['file Discord', () => traiterFile(base, { cle, maintenant: maintenant(), lienApp, jetonBot, ...(fetch ? { fetch } : {}) })],
    ['MP des réunions CM', () => traiterMpReunions(base, { maintenant: maintenant(), lienApp, jetonBot, ...(fetch ? { fetch } : {}) })],
    // Tickets Discord : relecture de secours si aucun processus ne tient la Gateway, puis cycle de vie (avertissements,
    // fermetures automatiques, salons archivés supprimés, rétention).
    ['tickets', async () => (rapportTickets = await tachesTickets(base, { jetonBot, maintenant, stockage, ...(fetch ? { fetch } : {}), ...(tickets ? { cycle: tickets(base) } : {}) }))],
    // Événements du club : rôles Discord des équipes (et leurs salons vocaux) supprimés à la fin (migration 0064).
    ['rôles Discord des événements', () => tachesEvenementsDiscord(base, { jetonBot, maintenant, ...(fetch ? { fetch } : {}) })],
    // Site LigneZero : équipes des événements liés à un tournoi du site, synchronisées dans les deux sens.
    ['équipes du site LigneZero', async () => {
      const site = siteLz ?? clientSite(() => configSite());
      if (!site.configure) return { evenements: 0 };
      const ev = servicesEvenements({ base, maintenant, fetch: fetch ?? ((...a) => globalThis.fetch(...a)), jetonBot, journal });
      const pont = creerPontSite({ base, ev, site, maintenant, journal });
      ev.brancherPont(pont);
      return pont.tacheCron();
    }],
    // Salons de match Discord (migration 0073) : matchs du tournoi lié, rappels, résultats, suppressions avec historique.
    // `enCours` : événements en cours (serveur/cron.mjs réveille alors l'app, dont la boucle relit toutes les 60 s).
    ['salons de match', async () => (rapportSalons = await creerSalonsMatch({ base, site: siteLz ?? clientSite(() => configSite()), fetch: fetch ?? ((...a) => globalThis.fetch(...a)), jetonBot, maintenant, journal }).tacheCron())],
    // Rôles Discord temporaires (migration 0066) : rôles arrivés à échéance retirés (réessais : limite de débit, hiérarchie).
    ['rôles Discord temporaires', () => expirerRolesTemp(base, { jetonBot, maintenant, ...(fetch ? { fetch } : {}) })],
    ['annonces Réseaux', () => traiterAnnoncesReseaux(base, { cle, maintenant: maintenant(), lienApp, jetonBot, stockage, ...(fetch ? { fetch } : {}) })],
    // Devblog : brouillons programmés publiés à l'heure (app, puis file Discord envoyée juste après).
    ['devblog programmé', () => publierProgrammes(base, { maintenant: maintenant() })],
    ['devblog Discord', () => traiterDevblogDiscord(base, { cle, maintenant: maintenant(), jetonBot, ...(fetch ? { fetch } : {}) })],
    ['rétention du journal', () => purgerJournal(base, { maintenant: maintenant() })],
    // Centre de notifications : fil, lectures et notifications personnelles de plus de 90 jours.
    ['rétention des notifications', () => purgerNotifications(base, { maintenant: maintenant() })],
    // Statistiques d'usage : agrégation des jours terminés (une fois par jour), puis détail brut de plus de 90 jours effacé.
    ['agrégation de l’usage', () => agregerUsage(base, { maintenant: maintenant() })],
    ['rétention de l’usage', () => purgerUsage(base, { maintenant: maintenant() })],
    // Disponibilités semaine par semaine (migration 0062) : semaines finies depuis plus de 8 semaines effacées.
    ['rétention des semaines de disponibilités', () => purgerDisposSemaines(base, { maintenant: maintenant() })],
    ['limites de débit', () => purgerLimites(base, maintenant())],
    ['tentatives anciennes', () => base.executer('DELETE FROM tentatives WHERE maj_le < ?', [new Date(maintenant() - 7 * 86_400_000).toISOString()])],
    ['envois inachevés', () => nettoyerEnvois(base, stockage, { maintenant: maintenant() })],
    // Drive de la section CM : corbeille de plus de 30 jours effacée (octets compris), alerte d'espace à 80 %.
    ['corbeille du Drive', () => purgerCorbeilleDrive(base, stockage, { maintenant: maintenant() })],
    // Strats : corbeille de plus de 30 jours effacée (strats, miniatures, entrées du playbook retirées).
    ['corbeille des strats', () => purgerCorbeilleStrats(base, stockage, { maintenant: maintenant() })],
    // Lineups : corbeille de plus de 30 jours effacée (lineups, images et vidéos, favoris, liens avec les strats).
    ['corbeille des lineups', () => purgerCorbeilleLineups(base, stockage, { maintenant: maintenant() })],
    ['corbeille des plans de match', () => purgerCorbeillePlans(base, { maintenant: maintenant() })],
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
  // Tickets : le cron serveur réveille l'app quand plus aucun processus ne tient la Gateway (serveur/cron.mjs).
  rapport.tickets = rapportTickets;
  rapport.salonsMatch = rapportSalons;
  return rapport;
}
