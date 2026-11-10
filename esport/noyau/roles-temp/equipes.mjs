/**
 * Rôles temporaires : de quelle(s) team(s) est la personne qui tape la commande ? (docs/esport/bot-discord.md)
 *
 * Le compte Esport est celui lié par /lier (`discord_comptes`). Une team convient quand :
 *  - la personne y est membre ACTIF avec un rôle autorisé à donner le rôle temporaire (réglages de la team : Coach,
 *    Manager et Propriétaire par défaut), ou est le Fondateur (toutes les teams) ;
 *  - ses rôles temporaires sont activés avec un rôle Discord choisi ;
 *  - la team est sur le serveur Discord de l'interaction.
 * Feuille sur la base, sans réseau.
 */

import { lireGeneral } from '../tickets/reglages.mjs';
import { guildDeEquipe, lireReglagesEquipe, rolesAutorisesDeEquipe } from './reglages.mjs';

/**
 * Rend `{ lie, compte, superAdmin, equipes: [{ id, nom, reglages }], raison }`.
 * `raison` (équipes vides) : 'lier' (compte non lié), 'pas_autorise', 'non_configure', 'autre_serveur'.
 */
export async function equipesDuMembre(base, discordUserId, guildId) {
  const lien = await base.premier('SELECT dc.compte_id, dc.super_admin FROM discord_comptes dc JOIN comptes c ON c.id = dc.compte_id WHERE dc.discord_user_id = ?', [discordUserId]);
  if (!lien) return { lie: false, compte: null, superAdmin: false, equipes: [], raison: 'lier' };
  const superAdmin = Number(lien.super_admin) === 1;
  const general = await lireGeneral(base);
  const lignes = superAdmin
    ? (await base.tous('SELECT id, nom FROM teams WHERE supprimee_le IS NULL AND archivee_le IS NULL ORDER BY nom', [])).map(t => ({ team_id: t.id, nom: t.nom, role_id: null }))
    : await base.tous(
        `SELECT m.team_id, t.nom, m.role_id FROM membres m JOIN teams t ON t.id = m.team_id
          WHERE m.compte_id = ? AND m.statut = 'actif' AND t.supprimee_le IS NULL AND t.archivee_le IS NULL ORDER BY t.nom`,
        [lien.compte_id],
      );
  const autorisees = [];
  for (const l of lignes) {
    const reglages = await lireReglagesEquipe(base, l.team_id);
    if (superAdmin || (await rolesAutorisesDeEquipe(base, l.team_id, reglages)).has(l.role_id)) autorisees.push({ id: l.team_id, nom: l.nom, reglages });
  }
  const configurees = autorisees.filter(e => e.reglages.actif && e.reglages.roleId);
  const equipes = [];
  for (const e of configurees) if ((await guildDeEquipe(base, e.id, general)) === guildId) equipes.push(e);
  const raison = equipes.length ? null : !autorisees.length ? 'pas_autorise' : !configurees.length ? 'non_configure' : 'autre_serveur';
  return { lie: true, compte: lien.compte_id, superAdmin, equipes, raison };
}

/**
 * Team visée : l'option `equipe` (identifiant ou nom, sans tenir compte de la casse), sinon l'unique team possible.
 * Rend `{ equipe }` ou `{ erreur: 'equipe_inconnue' | 'equipe_ambigue' }`.
 */
export function choisirEquipe(equipes, choix) {
  if (choix) {
    const voulu = String(choix).toLocaleLowerCase('fr');
    const e = equipes.find(x => x.id === choix || x.nom.toLocaleLowerCase('fr') === voulu);
    return e ? { equipe: e } : { erreur: 'equipe_inconnue' };
  }
  return equipes.length === 1 ? { equipe: equipes[0] } : { erreur: 'equipe_ambigue' };
}
