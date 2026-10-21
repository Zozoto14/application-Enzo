/**
 * Discord ID d'un membre Esport (migration 0015) : identifiant numérique de 17 à 20 chiffres (un
 * « snowflake » Discord), tel que donné par Discord › Paramètres › Avancés › Mode développeur, puis
 * clic droit sur le membre › « Copier l'identifiant de l'utilisateur ».
 *
 * La saisie tolère une mention collée (`<@123…>`, `<@!123…>`) et les espaces ; tout le reste est refusé
 * (400 `discord-id`), sans jamais recopier la saisie dans le message.
 */

import { echec } from './outils.mjs';

export const MOTIF_DISCORD_ID = /^[1-9]\d{16,19}$/;

/** Discord ID normalisé, ou `null` si absent et facultatif ; lève 400 sinon. */
export function lireDiscordId(valeur, { obligatoire = false } = {}) {
  const brut = typeof valeur === 'string' ? valeur.trim().replace(/^<@!?(\d+)>$/, '$1').replace(/\s+/g, '') : typeof valeur === 'number' ? String(valeur) : '';
  if (!brut) {
    if (obligatoire) throw echec(400, 'discord-id-requis', 'Le Discord ID est obligatoire : il permet au bot de pinger le joueur quand il est convoqué.');
    return null;
  }
  if (!MOTIF_DISCORD_ID.test(brut)) throw echec(400, 'discord-id', 'Discord ID invalide : 17 à 20 chiffres (Discord › Mode développeur › clic droit › Copier l’identifiant).');
  return brut;
}

/** Refuse un Discord ID déjà porté par un autre compte (409). */
export async function discordIdLibre(base, discordId, sauf = '') {
  if (!discordId) return;
  const pris = await base.premier('SELECT id FROM comptes WHERE discord_id = ? AND id <> ?', [discordId, sauf]);
  if (pris) throw echec(409, 'discord-id-pris', 'Ce Discord ID est déjà celui d’un autre membre de l’Esport.');
}
