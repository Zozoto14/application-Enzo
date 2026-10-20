/**
 * Service Discord de l'Esport (phase 4) : webhook de la team (un seul, chiffré
 * au repos, jamais renvoyé en clair), message de test, réglage de chaque type
 * de notification (activation, modèle, mention de rôle).
 *
 * Contrôles, dans l'ordre : session (api.mjs) → appartenance à la team
 * (contexteTeam) → module `discord` activé → permission `discord.manage`.
 * Tout l'écran Discord exige cette permission : le webhook est un secret.
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, nouvelId } from '../outils.mjs';
import { EVENEMENTS_DISCORD, evenementDiscord, exemples, textesEvenement } from './catalogue.mjs';
import { lireLangue, texte as T } from '../langues.mjs';
import { chiffrerWebhook, dechiffrerWebhook, finDeWebhook, masquerWebhook, validerUrlWebhook } from './chiffrement.mjs';
import { posterWebhook, reglageEffectif } from './file.mjs';
import { apercuModele, construireCharge, lireRoleMention, validerModele } from './messages.mjs';

export const MODULE_DISCORD = 'discord';
const INTERVALLE_TEST_MS = 10_000;

export function servicesDiscord({ base, maintenant = () => Date.now(), noyau, cle, fetch: fetchDiscord = (...a) => globalThis.fetch(...a) }) {
  async function contexte(acteur, teamId) {
    const ctx = await noyau.contexteTeam(acteur, teamId);
    noyau.exiger(ctx, 'discord.manage');
    return ctx;
  }

  const ligneWebhook = teamId => base.premier('SELECT * FROM discord_webhooks WHERE team_id = ?', [teamId]);

  function webhookPublic(w) {
    if (!w) return { configure: false };
    return {
      configure: true,
      masque: masquerWebhook(w.fin),
      creeLe: w.cree_le,
      majLe: w.maj_le,
      dernierSucces: w.dernier_succes_le ?? null,
      dernierEchec: w.dernier_echec_le ?? null,
      invalide: Boolean(w.invalide_le),
      bloqueJusqua: w.bloque_jusqua && Date.parse(w.bloque_jusqua) > maintenant() ? w.bloque_jusqua : null,
    };
  }

  /** État complet de l'écran Discord. */
  async function etat(acteur, teamId) {
    const ctx = await contexte(acteur, teamId);
    const actifs = ctx.modules;
    // Libellés et descriptions : langue de l'utilisateur ; modèles par défaut et aperçus : langue des messages de la team.
    const langueUi = lireLangue(acteur.langue) ?? 'fr';
    const langueTeam = lireLangue(ctx.team.langue_discord) ?? 'fr';
    const lignes = await base.tous('SELECT * FROM discord_notification_settings WHERE team_id = ?', [teamId]);
    const parametres = EVENEMENTS_DISCORD.map(def => {
      const r = reglageEffectif(def, lignes.find(l => l.cle === def.cle), langueTeam);
      const disponible = def.modules.every(m => actifs.has(m));
      const ui = textesEvenement(def, langueUi);
      return {
        cle: def.cle,
        libelle: ui.libelle,
        description: ui.description,
        modules: def.modules,
        disponible,
        actif: disponible && r.actif,
        modele: r.modele,
        modeleDefaut: textesEvenement(def, langueTeam).modele,
        personnalise: r.personnalise,
        roleMention: r.roleMention,
        variables: Object.entries(ui.variables).map(([nom, description]) => ({ nom, description })),
        apercu: apercuModele(r.modele, langueTeam),
      };
    });
    const envois = await base.tous(
      'SELECT id, cle, statut, essais, derniere_erreur, prochain_essai_le, cree_le, envoye_le FROM discord_file WHERE team_id = ? ORDER BY cree_le DESC, id LIMIT 20',
      [teamId],
    );
    const compte = await base.premier(
      "SELECT SUM(CASE WHEN statut = 'attente' THEN 1 ELSE 0 END) AS attente, SUM(CASE WHEN statut = 'abandonne' THEN 1 ELSE 0 END) AS abandonnes FROM discord_file WHERE team_id = ?",
      [teamId],
    );
    return {
      webhook: webhookPublic(await ligneWebhook(teamId)),
      langue: langueTeam,
      parametres,
      exemples: exemples(langueTeam),
      file: { enAttente: Number(compte?.attente ?? 0), abandonnes: Number(compte?.abandonnes ?? 0) },
      envois: envois.map(e => ({
        id: e.id,
        cle: e.cle,
        libelle: evenementDiscord(e.cle) ? textesEvenement(evenementDiscord(e.cle), langueUi).libelle : e.cle,
        statut: e.statut,
        essais: Number(e.essais),
        erreur: e.derniere_erreur ?? null,
        prochainEssai: e.statut === 'attente' ? e.prochain_essai_le : null,
        creeLe: e.cree_le,
        envoyeLe: e.envoye_le ?? null,
      })),
    };
  }

  async function definirWebhook(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    const url = validerUrlWebhook(corps?.url);
    const t = maintenant();
    const chiffre = await chiffrerWebhook(cle, teamId, url);
    const existant = await ligneWebhook(teamId);
    await base.lot([
      {
        sql: `INSERT INTO discord_webhooks (team_id, url_chiffree, fin, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (team_id) DO UPDATE SET url_chiffree = excluded.url_chiffree, fin = excluded.fin, maj_le = excluded.maj_le,
                bloque_jusqua = NULL, invalide_le = NULL, dernier_echec_le = NULL`,
        params: [teamId, chiffre, finDeWebhook(url), acteur.compte, iso(t), iso(t)],
      },
      // Jamais l'adresse (ni sa fin) dans l'événement : le journal est lisible par d'autres rôles.
      evenement('discord.webhook_set', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: { remplace: Boolean(existant), team: ctx.team.nom }, maintenant: t }),
    ]);
    return webhookPublic(await ligneWebhook(teamId));
  }

  async function supprimerWebhook(acteur, teamId) {
    await contexte(acteur, teamId);
    const t = maintenant();
    const existant = await ligneWebhook(teamId);
    if (!existant) throw echec(404, 'webhook-absent', 'Aucun webhook Discord n’est configuré pour cette team.');
    await base.lot([
      { sql: 'DELETE FROM discord_webhooks WHERE team_id = ?', params: [teamId] },
      { sql: "UPDATE discord_file SET statut = 'abandonne', derniere_erreur = 'Webhook supprimé', verrou_jusqua = NULL, maj_le = ? WHERE team_id = ? AND statut = 'attente'", params: [iso(t), teamId] },
      evenement('discord.webhook_removed', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: {}, maintenant: t }),
    ]);
    return { ok: true };
  }

  /** Message de test, envoyé tout de suite (pas de file) : le résultat revient à l'écran. */
  async function tester(acteur, teamId) {
    const ctx = await contexte(acteur, teamId);
    const w = await ligneWebhook(teamId);
    if (!w) throw echec(409, 'webhook-absent', 'Enregistrez d’abord l’adresse du webhook.');
    const t = maintenant();
    if (w.dernier_test_le && t - Date.parse(w.dernier_test_le) < INTERVALLE_TEST_MS) {
      const e = echec(429, 'trop-vite', 'Un test vient d’être envoyé : patientez quelques secondes.');
      e.attente = Math.ceil((INTERVALLE_TEST_MS - (t - Date.parse(w.dernier_test_le))) / 1000);
      throw e;
    }
    const langueTeam = lireLangue(ctx.team.langue_discord) ?? 'fr';
    const url = await dechiffrerWebhook(cle, teamId, w.url_chiffree);
    if (!url) throw echec(409, 'webhook-illisible', 'L’adresse enregistrée est illisible (clé de chiffrement changée) : saisissez-la à nouveau.');
    await base.executer('UPDATE discord_webhooks SET dernier_test_le = ? WHERE team_id = ?', [iso(t), teamId]);
    const r = await posterWebhook(fetchDiscord, url, construireCharge(T(langueTeam, 'test.message', { team: ctx.team.nom }), { nomTeam: ctx.team.nom, titre: T(langueTeam, 'test.titre'), cle: 'test', langue: langueTeam }));
    if (!r.ok) {
      await base.executer('UPDATE discord_webhooks SET dernier_echec_le = ?, invalide_le = CASE WHEN ? = 1 THEN ? ELSE invalide_le END WHERE team_id = ?', [iso(t), r.webhookPerdu ? 1 : 0, iso(t), teamId]);
      if (r.statut === 429) {
        const e = echec(429, 'discord-occupe', 'Discord limite le débit : réessayez dans un instant.');
        e.attente = r.retryApresS;
        throw e;
      }
      throw echec(502, r.webhookPerdu ? 'webhook-refuse' : 'discord-echec', r.webhookPerdu ? 'Discord ne reconnaît plus ce webhook : recréez-le dans Discord puis saisissez la nouvelle adresse.' : `Discord n’a pas accepté le message de test (${r.motif}).`);
    }
    await base.lot([
      { sql: 'UPDATE discord_webhooks SET dernier_succes_le = ?, invalide_le = NULL WHERE team_id = ?', params: [iso(t), teamId] },
      evenement('discord.test_sent', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: {}, maintenant: t }),
    ]);
    return { ok: true };
  }

  async function majParametre(acteur, teamId, cleEvenement, corps) {
    const ctx = await contexte(acteur, teamId);
    const def = evenementDiscord(cleEvenement);
    if (!def) throw echec(404, 'discord-evenement', 'Type de notification inconnu.');
    const ligne = await base.premier('SELECT * FROM discord_notification_settings WHERE team_id = ? AND cle = ?', [teamId, cleEvenement]);
    const avant = reglageEffectif(def, ligne, lireLangue(ctx.team.langue_discord) ?? 'fr');
    const manquants = def.modules.filter(m => !ctx.modules.has(m));
    let actif = avant.actif;
    if (corps?.actif !== undefined) {
      if (typeof corps.actif !== 'boolean') throw echec(400, 'actif', 'Activation : vrai ou faux.');
      if (corps.actif && manquants.length > 0) {
        throw echec(409, 'module-absent', `Cette notification demande le module ${manquants.join(', ')}, qui n’est pas activé pour cette team.`);
      }
      actif = corps.actif;
    }
    const modele = corps?.modele !== undefined ? validerModele(cleEvenement, corps.modele) : (ligne?.modele ?? null);
    const roleMention = corps?.roleMention !== undefined ? lireRoleMention(corps.roleMention) : (ligne?.role_mention ?? null);
    const t = maintenant();
    const champs = [];
    if (actif !== avant.actif) champs.push('actif');
    if (modele !== (ligne?.modele ?? null)) champs.push('modele');
    if (roleMention !== (ligne?.role_mention ?? null)) champs.push('roleMention');
    await base.lot([
      {
        sql: `INSERT INTO discord_notification_settings (team_id, cle, actif, modele, role_mention, maj_le) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (team_id, cle) DO UPDATE SET actif = excluded.actif, modele = excluded.modele, role_mention = excluded.role_mention, maj_le = excluded.maj_le`,
        params: [teamId, cleEvenement, actif ? 1 : 0, modele, roleMention, iso(t)],
      },
      ...(champs.length > 0
        ? [evenement('discord.settings_changed', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: nouvelId(), charge: { notification: cleEvenement, champs, actif }, maintenant: t })]
        : []),
    ]);
    return (await etat(acteur, teamId)).parametres.find(p => p.cle === cleEvenement);
  }

  /** `PUT /teams/:t/discord/langue` { langue } : langue des messages Discord de la team (français par défaut). */
  async function majLangue(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    const langue = lireLangue(corps?.langue);
    if (!langue) throw echec(400, 'langue', 'Langue : fr ou en.');
    const avant = lireLangue(ctx.team.langue_discord) ?? 'fr';
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE teams SET langue_discord = ? WHERE id = ?', params: [langue, teamId] },
      ...(langue !== avant
        ? [evenement('discord.settings_changed', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: nouvelId(), charge: { notification: 'langue', champs: ['langue'], langue }, maintenant: t })]
        : []),
    ]);
    return { langue };
  }

  return { etat, definirWebhook, supprimerWebhook, tester, majParametre, majLangue };
}
