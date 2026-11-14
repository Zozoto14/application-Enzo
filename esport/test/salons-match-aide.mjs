/**
 * Aides des tests des salons de match (salons-match.test.mjs, salons-match-fiables.test.mjs) : faux site LigneZero (tournoi,
 * équipes, joueurs, match 1v1, lobby à 3 équipes), événement lié avec rôles Discord, faux Discord. Jamais de réseau réel.
 */

import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { oublierLimites } from '../noyau/tickets/discord.mjs';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const EA = '22222222-2222-4222-8222-00000000000a';
export const EB = '22222222-2222-4222-8222-00000000000b';
export const EC = '22222222-2222-4222-8222-00000000000c';
export const ED = '22222222-2222-4222-8222-00000000000d';
export const M1 = '44444444-4444-4444-8444-000000000001';
export const L1 = '55555555-5555-4555-8555-000000000001';
export const CAT = '710000000000000099';
export const CAP_A = '810000000000000201';
export const J_A = '810000000000000202';
export const CAP_B = '810000000000000203';
export const CAP_C = '810000000000000204';
export const STAFF = '810000000000000299';
export const SILENCE = { error() {}, warn() {}, log() {} };

export function fauxSite() {
  const tables = {
    tournaments: [{ id: T1, name: 'The Nuke End', status: 'running', created_at: '2026-11-02' }],
    tournament_teams: [
      { id: EA, tournament_id: T1, name: 'Alpha', tag: 'ALP' },
      { id: EB, tournament_id: T1, name: 'Bravo', tag: 'BRV' },
      { id: EC, tournament_id: T1, name: 'Charlie', tag: 'CHA' },
    ],
    tournament_players: [
      { id: 'p1', team_id: EA, pseudo: 'CapA', role: null, is_captain: true, discord_id: CAP_A, embark_id: null, sort_order: 0 },
      { id: 'p2', team_id: EA, pseudo: 'Joueur', role: null, is_captain: false, discord_id: J_A, embark_id: null, sort_order: 1 },
      { id: 'p3', team_id: EB, pseudo: 'CapB', role: null, is_captain: true, discord_id: CAP_B, embark_id: null, sort_order: 0 },
      { id: 'p4', team_id: EC, pseudo: 'CapC', role: null, is_captain: true, discord_id: CAP_C, embark_id: null, sort_order: 0 },
    ],
    tournament_stages: [],
    tournament_matches: [{ id: M1, tournament_id: T1, stage_id: null, bracket: 'winner', round: 1, position: 1, group_label: null, team_a_id: EA, team_b_id: EB, score_a: null, score_b: null, winner_id: null, status: 'pending', scheduled_at: '2026-10-20T12:00:00.000Z', stream_url: null }],
    tournament_lobbies: [{ id: L1, tournament_id: T1, round: 1, position: 1, label: null, status: 'pending', scheduled_at: '2026-10-20T14:00:00.000Z', stream_url: null }],
    tournament_match_staff_discord: [],
    tournament_match_mapban: [],
    tournament_lobby_entries: [
      { id: 'e1', lobby_id: L1, team_id: EA, placement: null, points: 0, dnf: false, sort_order: 0 },
      { id: 'e2', lobby_id: L1, team_id: EB, placement: null, points: 0, dnf: false, sort_order: 1 },
      { id: 'e3', lobby_id: L1, team_id: EC, placement: null, points: 0, dnf: false, sort_order: 2 },
    ],
  };
  let n = 0;
  const filtre = filters => r => filters.every(f => (f.op === 'in' ? f.val.includes(r[f.col]) : r[f.col] === f.val));
  return {
    tables,
    configure: true,
    urlSite: 'https://lz.appdashboard.fr',
    lectures: [],
    async lister(t, filters = []) {
      this.lectures.push(t);
      return structuredClone((tables[t] ?? []).filter(filtre(filters)));
    },
    inserer: async (t, rows) => rows.map(r => (tables[t].push({ id: `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`, ...r }), structuredClone(tables[t].at(-1)))),
    modifier: async (t, id, v) => [Object.assign(tables[t].find(x => x.id === id), v)],
    supprimer: async (t, id) => {
      tables[t] = tables[t].filter(x => x.id !== id);
    },
    supprimerOu: async (t, col, val) => {
      tables[t] = tables[t].filter(x => x[col] !== val);
    },
  };
}

export async function monter(options = {}) {
  oublierLimites();
  const site = fauxSite();
  const k = await bancTickets({ banc, siteLz: site, ...options });
  k.discord.etat.salons.set(CAT, { id: CAT, type: 4, name: 'Matchs', guild_id: k.GUILD, permission_overwrites: [], position: 5 });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club', langue: 'fr' } });
  const e = await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'The Nuke End', debut: '2026-10-20', fin: '2026-10-21' } });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  const id = e.corps.evenement.id;
  const chemin = `/evenements/${id}`;
  // Lien au tournoi : les équipes du site sont reprises dans l'événement (rôles Discord créés automatiquement).
  const lie = await k.api(`${chemin}/site`, undefined, { methode: 'PUT', corps: { tournoiId: T1 } });
  assert.equal(lie.statut, 200, JSON.stringify(lie.corps));
  const st = await k.api(`${chemin}/staff`, undefined, { methode: 'POST', corps: { discordId: STAFF, nom: 'Arbitre' } });
  assert.equal(st.statut, 200, JSON.stringify(st.corps));
  const fiche = (await k.api(chemin)).corps;
  const roles = Object.fromEntries(fiche.equipes.map(x => [x.tag, x.roleId]));
  assert.ok(roles.ALP && roles.BRV && roles.CHA, JSON.stringify(roles));
  const r = { ...k, site, id, chemin, sm: `${chemin}/salons-match`, roles, staffRole: fiche.evenement.discord.staffRoleId, jeton: k.fondateur };
  // Session du Fondateur rouverte après un saut d'horloge (les sessions expirent).
  r.api = async (c, jeton, options = {}) => {
    if (!jeton) r.jeton = await k.b.session('principal');
    return k.b.appel(c, { jeton: jeton ?? r.jeton, ...options });
  };
  return r;
}

export const salonsCrees = k => k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === `/guilds/${k.GUILD}/channels`);
export const messagesDe = (k, salonId) => k.discord.etat.messages.get(salonId) ?? [];
export const lignes = async k => k.b.base.tous('SELECT * FROM club_salons_match WHERE evenement_id = ? ORDER BY cree_le, site_match_id', [k.id]);
export const synchro = async k => {
  const r = await k.api(`${k.sm}/synchro`, undefined, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
};
export const activer = async (k, extra = {}) => {
  const r = await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: true, categorieId: CAT, ...extra } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
};

