/**
 * Configuration du serveur Esport autonome, lue dans l'environnement :
 * variables de « Setup Node.js App » et/ou fichier ~/.appdashboard/esport.env
 * (HORS du dépôt et de public_html ; chemin modifiable par ESPORT_ENV).
 *
 *   CLE_ESPORT        clé de session (obligatoire ; ne pas la changer : sessions et liens de partage en dépendent)
 *   TICKETS_GATEWAY   « non » : pas de connexion Gateway pour les tickets (relecture de secours par le cron)
 *   DATABASE_URL      postgres://utilisateur:motdepasse@localhost:5432/base (ou PGHOST, PGUSER, PGPASSWORD, PGDATABASE)
 *   RELAIS_URL        adresse du relais qui valide les jetons (https://relais.appdashboard.fr)
 *   FICHIERS_DIR      dossier des PDF et miniatures (défaut ~/esport-fichiers, jamais dans public_html)
 *   URL_PUBLIQUE      adresse publique du serveur (https://esport.appdashboard.fr)
 *   CREATION_TEAMS    « fondateur » (défaut) ou « tous »
 *   CLE_DISCORD, LIEN_APP, DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN : Discord (docs/esport/bot-discord.md).
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM : récapitulatif e-mail (facultatif, docs/emails.md).
 *   ESPORT_VIDEO_MAX       plafond d'une vidéo ou d'un enregistrement déposé (« 10G » par défaut)
 *   ESPORT_TAILLE_MORCEAU  taille des morceaux d'envoi (« 8M » par défaut, de 1 à 64 Mio) : sous la limite
 *                          de corps de requête de l'hébergeur (docs/esport/videos.md)
 *   ESPORT_DRIVE_QUOTA     espace total du Drive de la section CM (« 20G » par défaut ; alerte à 80 %)
 *   ESPORT_DRIVE_FICHIER_MAX  plafond d'un fichier du Drive (« 2G »), ESPORT_DRIVE_ZIP_MAX : dossier en ZIP (« 2G »)
 *   TRANSCRIPTION_API, TRANSCRIPTION_API_CLE… : transcription par une API externe, désactivée par défaut
 *                          (docs/esport/resumes.md)
 *   IA_API_URL, IA_API_CLE, IA_MODELE, IA_FOURNISSEUR, IA_RECHERCHE : assistant IA des profils de jeu
 *                          (facultatif ; sans clé, tout se fait à la main) : docs/esport/profils-jeu.md
 *   IA_LOCALE_DOSSIER, IA_LOCALE_MODELE, IA_LOCALE_THREADS… : IA LOCALE (llama.cpp sur le serveur, à la place
 *                          ou en secours de la clé d'API), installée par installer-ia-locale.sh : docs/esport/ia-locale.md
 *   TRANSCRIPTION_MODE, TRANSCRIPTION_QUALITE, TRANSCRIPTION_THREADS_WHISPER, TRANSCRIPTION_CORRECTION… :
 *                          transcription sur le serveur (whisper.cpp, repli ONNX), installée par
 *                          installer-transcription.sh : docs/esport/transcription.md
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { chargerEnv, fichierEnvParDefaut } from './commun.mjs';
import { configSmtp } from './courriel-smtp.mjs';
import { configMedias } from '../noyau/medias/service.mjs';
import { configDrive } from '../noyau/cm/drive/regles.mjs';
import { lireModeTempsReel } from '../noyau/temps-reel/service.mjs';
import { configTranscriptionExterne } from '../noyau/medias/transcription.mjs';
import { configTranscriptionServeur } from '../noyau/medias/fileTranscription.mjs';
import { dossierModelesParDefaut, etatInstallation } from './transcription/moteur.mjs';
import * as connecteurIa from '../noyau/ia/connecteur.mjs';
import { chargerIaLocale } from './ia-locale/service.mjs';
import { lireHebergement } from './ia-locale/hebergement.mjs';

/**
 * Réglages de la transcription sur le serveur, avec l'état de l'installation (moteurs et modèles prêts ?
 * qualités disponibles, vitesses mesurées) et la post-correction (IA locale installée ? `iaLocale`).
 */
export function chargerTranscriptionServeur(env = process.env, iaLocale = null) {
  const c = configTranscriptionServeur(env);
  if (!c.dossierModeles) c.dossierModeles = dossierModelesParDefaut();
  const etat = etatInstallation(c);
  // Relecture (tâche CONFIDENTIELLE « correction », noyau/ia/confidentialite.mjs) : IA LOCALE seule, installée et pas
  // déclarée « indisponible sur cet hébergement ». Une clé d'API ne suffit pas : elle ne sert que si le Fondateur a
  // explicitement autorisé l'envoi de cette tâche à un service externe (réglage en base, lu par resumes.mjs).
  const api = connecteurIa.configIa(env);
  let localPrete = Boolean(iaLocale?.installation?.installe);
  if (localPrete && iaLocale?.dossier) {
    try {
      localPrete = !lireHebergement(iaLocale.dossier, { max: iaLocale.tuesMax }).indisponible;
    } catch {
      // État illisible : l'IA locale est supposée utilisable (le répartiteur refusera proprement sinon).
    }
  }
  const relecture = c.correction !== 'non';
  return {
    ...c,
    disponible: etat.installe,
    raison: etat.raison ?? null,
    qualites: etat.qualites,
    vitesses: etat.vitesses,
    correctionDisponible: relecture && localPrete,
    // Une API est configurée : utilisable pour la relecture SEULEMENT si le Fondateur l'a autorisé (base).
    correctionApi: relecture && (Boolean(api.actif) || Boolean(api.secondaire?.actif)),
  };
}

export function chargerConfigEsport(env = process.env) {
  const fichier = chargerEnv(env.ESPORT_ENV || fichierEnvParDefaut('esport'), env);
  const iaLocale = chargerIaLocale(env);
  return {
    fichierEnv: fichier,
    cleSession: env.CLE_ESPORT || '',
    relais: (env.RELAIS_URL || '').replace(/\/+$/, ''),
    dossierFichiers: env.FICHIERS_DIR || join(homedir(), 'esport-fichiers'),
    urlPublique: env.URL_PUBLIQUE || undefined,
    creationTeams: env.CREATION_TEAMS === 'tous' ? 'tous' : 'fondateur',
    cleDiscord: env.CLE_DISCORD || undefined,
    lienApp: env.LIEN_APP || '',
    discordBot: { applicationId: env.DISCORD_APPLICATION_ID, publicKey: env.DISCORD_PUBLIC_KEY, jetonBot: env.DISCORD_BOT_TOKEN },
    // E-mails (récapitulatif Esport, docs/emails.md) : mêmes variables SMTP que relais.env, facultatives.
    smtp: configSmtp(env),
    baseConfiguree: Boolean(env.DATABASE_URL || env.PGDATABASE || env.PGHOST),
    medias: configMedias(env),
    // Drive de la section CM : ESPORT_DRIVE_QUOTA, ESPORT_DRIVE_FICHIER_MAX, ESPORT_DRIVE_ZIP_MAX (docs/esport/drive.md).
    drive: configDrive(env),
    transcriptionExterne: configTranscriptionExterne(env),
    transcriptionServeur: chargerTranscriptionServeur(env, iaLocale),
    // Assistant IA des profils de jeu : la clé reste dans une fermeture (jamais sérialisée).
    ia: connecteurIa.configIa(env),
    // IA locale (llama.cpp) : réglages et état de l'installation (~/.appdashboard/ia-locale).
    iaLocale,
    // Temps réel (docs/esport/temps-reel.md) : TEMPS_REEL=sse (défaut) | attente | sondage (repli sûr : aucune
    // connexion tenue) ; TEMPS_REEL_MAX : connexions tenues par processus (30 par défaut).
    tempsReel: configTempsReel(env),
    // Tickets Discord (docs/esport/tickets.md) : TICKETS_GATEWAY=non coupe la connexion Gateway (relecture REST de
    // secours par le cron seulement), sans rien changer d'autre.
    ticketsGateway: !/^(non|0|false|off)$/i.test(String(env.TICKETS_GATEWAY ?? '').trim()),
  };
}

/** Réglages du temps réel lus dans l'environnement. */
export function configTempsReel(env = process.env) {
  const max = Number(env.TEMPS_REEL_MAX);
  return { mode: lireModeTempsReel(env.TEMPS_REEL), ...(Number.isInteger(max) && max >= 0 && max <= 500 ? { maxTotal: max } : {}) };
}

/** Problèmes de configuration bloquants (messages en français simple). */
export function problemesConfig(c) {
  const p = [];
  if (!c.cleSession || c.cleSession.length < 32) p.push('CLE_ESPORT absente ou trop courte (64 caractères conseillés).');
  if (!c.baseConfiguree) p.push('Base PostgreSQL non configurée : DATABASE_URL (ou PGHOST, PGUSER, PGPASSWORD, PGDATABASE).');
  if (!/^https?:\/\//.test(c.relais)) p.push('RELAIS_URL absente : adresse du relais (https://relais.appdashboard.fr).');
  return p;
}
