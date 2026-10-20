/**
 * Enregistre les slash commands du bot Esport auprès de Discord (remplace
 * toute la liste : PUT /applications/{id}/commands), et, si demandé, met à
 * jour son identité : description de l'application (« À propos »), avatar et
 * bannière (PATCH /applications/@me et /users/@me), adresse des interactions.
 *
 *   DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… node esport/outils/discord-commandes.mjs
 *        [--identite]          description, avatar et bannière (docs/esport/bot/)
 *        [--adresse https://applibourse-esport.<vous>.workers.dev]   Interactions Endpoint URL
 *        [--essai]             affiche ce qui serait envoyé, sans rien envoyer
 *
 * Le jeton n'est lu que dans l'environnement (jamais en argument, jamais
 * affiché). Sans jeton ni identifiant : message, puis sortie sans erreur
 * (étape facultative du workflow Esport).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { definitionsCommandes } from '../noyau/discord/bot/commandes.mjs';

const API = 'https://discord.com/api/v10';
const racine = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Image PNG en data URI (format attendu par Discord pour avatar, icône et bannière). */
export function imageDataUri(chemin) {
  return `data:image/png;base64,${readFileSync(chemin).toString('base64')}`;
}

/**
 * Prépare les appels (méthode, chemin, corps) sans les faire : testable sans réseau.
 * `identite` : contenu de docs/esport/bot/identite.json.
 */
export function appelsDiscord({ applicationId, identite, avecIdentite = false, adresse, images = {} }) {
  const appels = [{ methode: 'PUT', chemin: `/applications/${applicationId}/commands`, corps: definitionsCommandes(), quoi: 'commandes' }];
  const app = {};
  if (avecIdentite && identite) {
    // Description de l'application = « À propos » du profil du bot.
    app.description = String(identite.aPropos ?? identite.description).slice(0, 400);
    if (images.avatar) app.icon = images.avatar;
    if (images.banniere) app.cover_image = images.banniere;
  }
  if (adresse) app.interactions_endpoint_url = `${String(adresse).replace(/\/+$/, '')}/discord/interactions`;
  if (Object.keys(app).length) appels.push({ methode: 'PATCH', chemin: '/applications/@me', corps: app, quoi: 'application' });
  if (avecIdentite && (images.avatar || images.banniere)) {
    appels.push({ methode: 'PATCH', chemin: '/users/@me', corps: { ...(images.avatar ? { avatar: images.avatar } : {}), ...(images.banniere ? { banner: images.banniere } : {}) }, quoi: 'profil du bot' });
  }
  return appels;
}

export async function executer({ env = process.env, args = process.argv.slice(2), fetch: requete = globalThis.fetch, journal = console.log } = {}) {
  const applicationId = String(env.DISCORD_APPLICATION_ID ?? '').trim();
  const jeton = String(env.DISCORD_BOT_TOKEN ?? '').trim();
  const essai = args.includes('--essai');
  const i = args.indexOf('--adresse');
  const adresse = i >= 0 ? args[i + 1] : undefined;
  if (!essai && (!/^\d{5,25}$/.test(applicationId) || !jeton)) {
    journal('Bot Discord : DISCORD_APPLICATION_ID ou DISCORD_BOT_TOKEN absent, commandes non enregistrées (étape facultative, voir docs/esport/bot-discord.md).');
    return { fait: false };
  }
  const identite = JSON.parse(readFileSync(join(racine, 'docs/esport/bot/identite.json'), 'utf8'));
  const avecIdentite = args.includes('--identite');
  const images = {};
  if (avecIdentite) {
    for (const [cle, fichier] of [['avatar', identite.avatar], ['banniere', identite.banniere]]) {
      const chemin = join(racine, fichier);
      if (existsSync(chemin)) images[cle] = imageDataUri(chemin);
      else journal(`(${fichier} absent : lancez « node esport/outils/discord-identite.mjs » pour le fabriquer)`);
    }
  }
  const appels = appelsDiscord({ applicationId: applicationId || '000000000000000000', identite, avecIdentite, adresse, images });
  if (essai) {
    for (const a of appels) journal(`${a.methode} ${a.chemin} (${a.quoi})`, a.quoi === 'commandes' ? JSON.stringify(a.corps.map(c => c.name)) : Object.keys(a.corps).join(', '));
    return { fait: false, appels };
  }
  let erreurs = 0;
  for (const a of appels) {
    const r = await requete(`${API}${a.chemin}`, {
      method: a.methode,
      headers: { Authorization: `Bot ${jeton}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://github.com/Zozoto14/application-Enzo, 1)' },
      body: JSON.stringify(a.corps),
    });
    if (r.ok) {
      journal(`OK : ${a.quoi}${a.quoi === 'commandes' ? ` (${a.corps.length} commandes)` : ''}.`);
      continue;
    }
    erreurs++;
    // Message de Discord, sans jamais réafficher le jeton.
    const texte = (await r.text().catch(() => '')).slice(0, 400).replaceAll(jeton, '***');
    journal(`ÉCHEC : ${a.quoi} (HTTP ${r.status}) ${texte}`);
    if (r.status === 401) journal('Le jeton du bot est refusé : régénérez-le (Bot › Reset Token) et reposez DISCORD_BOT_TOKEN.');
  }
  return { fait: erreurs === 0, erreurs };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await executer();
  if (r.erreurs) process.exitCode = 1;
}
