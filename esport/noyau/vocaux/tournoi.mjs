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
import { MODELE_STAFF_DEFAUT, nomSalon } from './reglages.mjs';
import { supprimerLigne } from './salons.mjs';
import { tv2 } from './textes.mjs';
import { idsSup, libelleStaff, lireSup } from '../evenements-club/staff-sup.mjs';

/** Rôle staff de l'événement et rôles staff supplémentaires (rôles existants ; plus aucun une fois l'événement nettoyé). */
export async function rolesStaffEvenement(base, evenementId) {
  const v = await base.premier('SELECT staff_role_id, staff_roles_sup, roles_supprimes_le FROM club_evenements WHERE id = ?', [evenementId]);
  if (!v) return [];
  const sup = v.roles_supprimes_le ? [] : idsSup(v.staff_roles_sup);
  return [v.staff_role_id, ...sup].filter(Boolean).map(String);
}

/**
 * Rôles qui ouvrent un salon d'un hub d'événement (verrouillé) : salon d'équipe → le rôle de l'équipe, le rôle staff
 * de l'événement et les rôles autorisés du hub (casters, admins) ; salon du staff (sans équipe) → le rôle staff de
 * l'événement et les rôles autorisés du hub (les rôles des équipes n'y entrent pas, sauf invités en amis). Les rôles du
 * staff des salons vocaux sont ajoutés par surchargesSalon.
 */
export async function rolesEquipe(ctx, s) {
  const hub = ctx.reglages?.hubs?.find(h => h.id === s?.hubId);
  if (s?.equipeId) {
    const e = await ctx.base.premier('SELECT role_id, evenement_id FROM club_evenement_equipes WHERE id = ?', [s.equipeId]);
    const staff = e?.evenement_id ? await rolesStaffEvenement(ctx.base, e.evenement_id) : [];
    return [...new Set([e?.role_id, ...staff, ...(hub?.rolesAutorises ?? [])].filter(Boolean))];
  }
  if (!s?.tournoiId) return [];
  return [...new Set([...(await rolesStaffEvenement(ctx.base, s.tournoiId)), ...(hub?.rolesAutorises ?? [])].filter(Boolean))];
}

/** « TAG Nom » de l'équipe d'un salon (panneau). */
export async function equipeDe(base, s) {
  if (!s?.equipeId) return '';
  const e = await base.premier('SELECT nom, tag FROM club_evenement_equipes WHERE id = ?', [s.equipeId]);
  return e ? `${e.tag} ${e.nom}`.trim() : '';
}

/**
 * Arrivée dans un hub d'événement (moteur.mjs) : `membre` = `{ id, nom, roles }` (rôles donnés par l'événement vocal).
 * `outils` : `{ creerSalon, deplacer }` du moteur. Rôle d'une équipe → salon de l'équipe (prioritaire) ; sinon rôle
 * du staff → salon du staff de la personne ; sinon refus (déconnecté, MP). Rend `'cree' | 'deplace' | 'staff' |
 * 'refuse' | null`.
 */
export async function gererHubTournoi(ctx, hub, membre, { creerSalon, deplacer }) {
  const { base } = ctx;
  const equipes = await base.tous('SELECT id, nom, tag, role_id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL ORDER BY position', [hub.tournoiId]);
  const roles = Array.isArray(membre.roles) ? membre.roles : [];
  const equipe = equipes.find(e => roles.includes(e.role_id));
  if (!equipe) {
    // Pas d'équipe, mais du staff (rôle staff de l'événement, rôle autorisé en plus du hub, rôle du staff des salons
    // vocaux) : son propre salon (modèle « {role} — {pseudo} » : {role} = libellé court du rôle qui donne l'accès,
    // staff-sup.mjs `libelleStaff`), un par personne, contrôles ordinaires.
    const staff = [...(await rolesStaffEvenement(base, hub.tournoiId)), ...(hub.rolesAutorises ?? []), ...(ctx.reglages?.rolesStaff ?? [])].filter(Boolean);
    if (staff.some(r => roles.includes(String(r)))) {
      const sien = await base.premier('SELECT salon_id FROM vocaux_salons WHERE tournoi_id = ? AND hub_id = ? AND equipe_id IS NULL AND proprietaire_id = ? ORDER BY cree_le LIMIT 1', [hub.tournoiId, hub.id, membre.id]);
      if (sien) {
        const d = await deplacer(ctx, membre.id, sien.salon_id);
        if (d.ok) return 'deplace';
        if (d.statut !== 404 && d.code !== 10003) return null;
        await supprimerLigne(base, sien.salon_id);
      }
      const v = await base.premier('SELECT nom, staff_role_id, staff_roles_sup, roles_supprimes_le FROM club_evenements WHERE id = ?', [hub.tournoiId]);
      const l = libelleStaff({ roles, sup: v?.roles_supprimes_le ? [] : lireSup(v?.staff_roles_sup), staffRoleId: v?.staff_role_id, hub, rolesStaff: ctx.reglages?.rolesStaff ?? [], etiquettesStaff: ctx.reglages?.etiquettesStaff ?? {}, nomsRoles: ctx.cache?.roles ?? new Map(), nomEvenement: v?.nom ?? '' });
      const s = await creerSalon(ctx, hub, membre, { nom: nomSalon(hub.modeleStaff || MODELE_STAFF_DEFAUT, { pseudo: membre.nom || membre.id, role: l?.label ?? 'Staff' }), tournoiId: hub.tournoiId, equipeId: null });
      return s ? 'staff' : null;
    }
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
