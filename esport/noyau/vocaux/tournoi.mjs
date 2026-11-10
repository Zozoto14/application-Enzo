/**
 * Hub vocal d'un événement du club (docs/esport/vocaux.md, « Hub vocal d'un événement » ; docs/esport/evenements.md).
 *
 * Un hub des salons vocaux temporaires peut être lié à un ÉVÉNEMENT organisé par le club (Administration ›
 * Événements ; clé `tournoiId` du hub et colonne `vocaux_salons.tournoi_id` : l'identifiant de l'événement). Seuls
 * les membres qui ont le rôle d'une équipe de l'événement peuvent s'en servir (les autres sont déconnectés et
 * reçoivent un MP d'explication) ; le salon créé porte le nom de l'équipe (`{tag} — {nom}`) et reste VERROUILLÉ sur
 * son rôle (plus les rôles du staff et les rôles autorisés du hub : casters, admins) ; ni renommage, ni
 * déverrouillage ; UN salon par équipe à la fois (un coéquipier qui passe par le hub y est déplacé).
 * Les équipes, leurs rôles et le nettoyage de fin : esport/noyau/evenements-club/.
 */

import { rest } from '../tickets/discord.mjs';
import { nomSalon } from './reglages.mjs';
import { supprimerLigne } from './salons.mjs';
import { tv2 } from './textes.mjs';

/**
 * Rôles qui ouvrent le salon d'une équipe : son rôle, le rôle staff de l'événement, et les rôles autorisés du hub
 * (casters, admins).
 */
export async function rolesEquipe(ctx, s) {
  if (!s?.equipeId) return [];
  const e = await ctx.base.premier('SELECT e.role_id, v.staff_role_id FROM club_evenement_equipes e LEFT JOIN club_evenements v ON v.id = e.evenement_id WHERE e.id = ?', [s.equipeId]);
  const hub = ctx.reglages?.hubs?.find(h => h.id === s.hubId);
  return [...new Set([e?.role_id, e?.staff_role_id, ...(hub?.rolesAutorises ?? [])].filter(Boolean))];
}

/** « TAG Nom » de l'équipe d'un salon (panneau). */
export async function equipeDe(base, s) {
  if (!s?.equipeId) return '';
  const e = await base.premier('SELECT nom, tag FROM club_evenement_equipes WHERE id = ?', [s.equipeId]);
  return e ? `${e.tag} ${e.nom}`.trim() : '';
}

/**
 * Arrivée dans un hub d'événement (moteur.mjs) : `membre` = `{ id, nom, roles }` (rôles donnés par l'événement vocal).
 * `outils` : `{ creerSalon, deplacer }` du moteur. Rend `'cree' | 'deplace' | 'refuse' | null`.
 */
export async function gererHubTournoi(ctx, hub, membre, { creerSalon, deplacer }) {
  const { base } = ctx;
  const equipes = await base.tous('SELECT id, nom, tag, role_id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL ORDER BY position', [hub.tournoiId]);
  const roles = Array.isArray(membre.roles) ? membre.roles : [];
  const equipe = equipes.find(e => roles.includes(e.role_id));
  if (!equipe) {
    // Pas d'équipe : déconnecté du hub, et un MP explique pourquoi (au mieux : MP fermés, rien de plus).
    await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/guilds/${ctx.guildId}/members/${membre.id}`, { channel_id: null }, { raison: 'Esport HQ : hub réservé aux équipes de l’événement' });
    const t = await base.premier('SELECT nom FROM club_evenements WHERE id = ?', [hub.tournoiId]);
    const mp = await rest(ctx.fetch, ctx.jetonBot, 'POST', '/users/@me/channels', { recipient_id: membre.id });
    if (mp.ok && mp.corps?.id) await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${mp.corps.id}/messages`, { content: tv2('tournoi_refus', { tournoi: t?.nom ?? '' }, { mode: ctx.mode, langue: 'fr', max: 1900 }), allowed_mentions: { parse: [] } });
    return 'refuse';
  }
  // Un salon par équipe : s'il existe, le membre y est déplacé.
  const existant = await base.premier('SELECT salon_id FROM vocaux_salons WHERE equipe_id = ? ORDER BY cree_le LIMIT 1', [equipe.id]);
  if (existant) {
    const d = await deplacer(ctx, membre.id, existant.salon_id);
    if (d.ok) return 'deplace';
    if (d.statut !== 404 && d.code !== 10003) return null;
    await supprimerLigne(base, existant.salon_id);
  }
  const s = await creerSalon(ctx, hub, membre, { nom: nomSalon(hub.modeleNom, { tag: equipe.tag, nom: equipe.nom, pseudo: membre.nom }), tournoiId: hub.tournoiId, equipeId: equipe.id, equipe: `${equipe.tag} ${equipe.nom}`.trim() });
  return s ? 'cree' : null;
}
