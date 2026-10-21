/**
 * Configuration du serveur Esport autonome, lue dans l'environnement :
 * variables de « Setup Node.js App » et/ou fichier ~/.appdashboard/esport.env
 * (HORS du dépôt et de public_html ; chemin modifiable par ESPORT_ENV).
 *
 *   CLE_ESPORT        clé de session (obligatoire ; la même que sur Cloudflare garde les sessions ouvertes)
 *   DATABASE_URL      postgres://utilisateur:motdepasse@localhost:5432/base (ou PGHOST, PGUSER, PGPASSWORD, PGDATABASE)
 *   RELAIS_URL        adresse du relais qui valide les jetons (https://relais.appdashboard.fr)
 *   FICHIERS_DIR      dossier des PDF et miniatures (défaut ~/esport-fichiers, jamais dans public_html)
 *   URL_PUBLIQUE      adresse publique du serveur (https://esport.appdashboard.fr)
 *   CREATION_TEAMS    « fondateur » (défaut) ou « tous »
 *   CLE_DISCORD, LIEN_APP, DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN : comme sur le Worker.
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM : récapitulatif e-mail (facultatif, docs/emails.md).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { chargerEnv, fichierEnvParDefaut } from './commun.mjs';
import { configSmtp } from './courriel-smtp.mjs';

export function chargerConfigEsport(env = process.env) {
  const fichier = chargerEnv(env.ESPORT_ENV || fichierEnvParDefaut('esport'), env);
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
  };
}

/** Problèmes de configuration bloquants (messages en français simple). */
export function problemesConfig(c) {
  const p = [];
  if (!c.cleSession || c.cleSession.length < 32) p.push('CLE_ESPORT absente ou trop courte (64 caractères conseillés).');
  if (!c.baseConfiguree) p.push('Base PostgreSQL non configurée : DATABASE_URL (ou PGHOST, PGUSER, PGPASSWORD, PGDATABASE).');
  if (!/^https?:\/\//.test(c.relais)) p.push('RELAIS_URL absente : adresse du relais (https://relais.appdashboard.fr).');
  return p;
}
