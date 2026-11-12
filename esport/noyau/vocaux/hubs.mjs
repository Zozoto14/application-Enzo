/**
 * Salons vocaux temporaires (docs/esport/vocaux.md, « Options de chaque hub ») : ce que le bot gère sur le salon du HUB
 * lui-même et sur la place des salons créés.
 *
 *  - Hub caché (`masquerHub`) : le bot gère les surcharges du salon du hub. @everyone : « Voir le salon » refusé ; admis
 *    (voir, se connecter) : pour un hub d'événement, les rôles des équipes de l'événement, son rôle staff et les rôles
 *    autorisés en plus du hub ; pour un hub ordinaire, ses « rôles qui peuvent utiliser ce hub » ; dans les deux cas les
 *    rôles du staff des salons vocaux, et le bot (voir, se connecter, déplacer, gérer). Les surcharges d'ORIGINE du hub
 *    sont gardées (`tickets_reglages`, clé `vocaux_hubs_origine` : { hubId: [surcharges] }) quand l'option s'active, et
 *    rendues au hub quand elle se désactive, quand le hub est retiré ou l'événement supprimé. Les salons créés partent
 *    de ces surcharges d'origine (pas de celles qui cachent le hub).
 *  - Resynchronisation : à chaque enregistrement des réglages (Bot Esport HQ, fiche d'un événement), quand les rôles
 *    d'un événement changent (équipe ajoutée, retirée, rôle recréé, rôle staff) et à la fin ou la suppression de
 *    l'événement. Au mieux : un refus de Discord est noté au journal du serveur, rien n'est bloqué.
 *  - Placement (`placerSousHub`) : Discord ignore souvent `position` à la création. Après le déplacement du membre
 *    (chemin critique inchangé), un seul `PATCH /guilds/{g}/channels` range, dans la catégorie du hub, ses salons
 *    temporaires JUSTE SOUS LE HUB, du plus récent au plus ancien (le nouveau salon tout de suite sous le hub) ; seuls
 *    les salons dont la position change sont envoyés. Positions lues dans le cache de la Gateway.
 */

import { rest } from '../tickets/discord.mjs';
import { iso, jsonOu } from '../outils.mjs';
import { hubMasque } from './reglages.mjs';
import { DROITS_PASSE_PARTOUT, PV, appliquerSurcharges, salonsDuServeur } from './salons.mjs';
import { rolesEquipe, rolesStaffEvenement } from './tournoi.mjs';

export const CLE_ORIGINES = 'vocaux_hubs_origine';
const ENTRER = PV.VOIR | PV.CONNECTER;
/** Droits du bot sur le salon du hub (voir, se connecter, déplacer les membres, gérer le salon). */
const DROITS_BOT_HUB = PV.VOIR | PV.CONNECTER | PV.DEPLACER | PV.GERER_SALONS;

const propre = o => ({ id: String(o.id), type: Number(o.type) === 1 ? 1 : 0, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') });

export async function lireOrigines(base) {
  const l = await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [CLE_ORIGINES]);
  const v = jsonOu(l?.valeur, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

async function ecrireOrigines(base, origines, t) {
  await base.executer(
    'INSERT INTO tickets_reglages (cle, valeur, maj_par, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
    [CLE_ORIGINES, JSON.stringify(origines), null, iso(t)],
  );
}

/** Rôles admis dans un hub caché (voir l'en-tête). */
export async function rolesAdmisHub(base, hub, reglages) {
  const roles = [...(reglages?.rolesStaff ?? [])];
  if (hub.tournoiId) {
    for (const e of await base.tous('SELECT role_id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL ORDER BY position', [hub.tournoiId])) roles.push(String(e.role_id));
    roles.push(...(await rolesStaffEvenement(base, hub.tournoiId)));
    roles.push(...(hub.rolesAutorises ?? []));
  } else roles.push(...(hub.rolesHub ?? []));
  return [...new Set(roles.filter(Boolean))];
}

/** Surcharges du hub caché : celles d'origine, @everyone sans « voir », admis et bot avec. */
export function surchargesHubMasque(origine, { guildId, botId, admis, rolesPasse = [] }) {
  const m = new Map((origine ?? []).map(o => [String(o.id), { ...propre(o), allow: BigInt(o.allow ?? '0'), deny: BigInt(o.deny ?? '0') }]));
  const regler = (id, type, allow = 0n, deny = 0n) => {
    const o = m.get(id) ?? { id, type, allow: 0n, deny: 0n };
    o.allow = (o.allow | allow) & ~deny;
    o.deny = (o.deny | deny) & ~allow;
    m.set(id, o);
  };
  regler(guildId, 0, 0n, PV.VOIR);
  for (const r of admis) if (r !== guildId) regler(r, 0, ENTRER);
  if (botId) regler(botId, 1, DROITS_BOT_HUB);
  // Rôles passe-partout (Goat) : voient et rejoignent aussi un hub caché (droits limités, vocaux.md).
  for (const r of rolesPasse) if (r && r !== guildId) regler(r, 0, DROITS_PASSE_PARTOUT);
  return [...m.values()].map(o => ({ id: o.id, type: o.type, allow: o.allow.toString(), deny: o.deny.toString() }));
}

/**
 * Applique l'option « cacher le hub » aux hubs des réglages (`seulement` : ids de hubs à traiter, sinon tous), et rend
 * leurs surcharges d'origine aux hubs qui ne sont plus cachés (option coupée, hub retiré ou changé de salon).
 * `ctx` : `base`, `fetch`, `jetonBot`, `guildId`, `botId`, `maintenant`, `journal`. Rend `{ caches, rendus, echecs }`.
 */
export async function synchroniserHubs(ctx, reglages, { seulement = null } = {}) {
  const b = { caches: 0, rendus: 0, echecs: [] };
  if (!ctx?.jetonBot || !ctx.guildId) return b;
  const { base } = ctx;
  const t = ctx.maintenant?.() ?? Date.now();
  const origines = await lireOrigines(base);
  let change = false;
  const masques = (reglages?.hubs ?? []).filter(hubMasque);
  const viser = id => !seulement || seulement.includes(id);
  // Hubs qui ne sont plus cachés : surcharges d'origine rendues.
  for (const id of Object.keys(origines)) {
    if (masques.some(h => h.id === id) || !viser(id)) continue;
    const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/channels/${id}`, { permission_overwrites: origines[id] }, { raison: 'Esport HQ : hub vocal de nouveau visible' });
    if (r.ok || r.statut === 404 || r.code === 10003) {
      delete origines[id];
      change = true;
      if (r.ok) b.rendus++;
    } else b.echecs.push({ hub: id, quoi: 'rendre', statut: r.statut, code: r.code ?? null });
  }
  for (const hub of masques) {
    if (!viser(hub.id)) continue;
    if (!origines[hub.id]) {
      const g = await rest(ctx.fetch, ctx.jetonBot, 'GET', `/channels/${hub.id}`);
      if (!g.ok) {
        b.echecs.push({ hub: hub.id, quoi: 'lire', statut: g.statut, code: g.code ?? null });
        continue;
      }
      origines[hub.id] = (g.corps?.permission_overwrites ?? []).map(propre);
      change = true;
    }
    const admis = await rolesAdmisHub(base, hub, reglages);
    const surcharges = surchargesHubMasque(origines[hub.id], { guildId: ctx.guildId, botId: ctx.botId, admis, rolesPasse: reglages?.rolesPassePartout ?? [] });
    const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/channels/${hub.id}`, { permission_overwrites: surcharges }, { raison: 'Esport HQ : hub vocal réservé' });
    if (r.ok) b.caches++;
    else b.echecs.push({ hub: hub.id, quoi: 'cacher', statut: r.statut, code: r.code ?? null });
  }
  if (change) await ecrireOrigines(base, origines, t);
  if (b.echecs.length) ctx.journal?.warn?.('[esport] vocaux : surcharges des hubs refusées par Discord', JSON.stringify(b.echecs));
  return b;
}

/**
 * Rend leurs surcharges d'origine à des hubs (ids) et les oublie : hubs retirés (événement supprimé). Au mieux.
 */
export async function rendreHubs(ctx, ids) {
  return synchroniserHubs(ctx, { hubs: [] }, { seulement: ids });
}

/** Resynchronise les hubs cachés d'un événement (rôles des équipes ou rôle staff changés). */
export async function resynchroniserHubsEvenement(ctx, reglages, evenementId) {
  const ids = (reglages?.hubs ?? []).filter(h => h.tournoiId === evenementId && hubMasque(h)).map(h => h.id);
  if (!ids.length) return null;
  return synchroniserHubs(ctx, reglages, { seulement: ids });
}

/** Salons « vocaux » au sens du tri de Discord (vocal, scène) : rangés après les salons écrits d'une catégorie. */
export const VOCAUX = new Set([2, 13]);
/** Salons « écrits » au sens du tri de Discord (texte, annonces, forum, médias) : un même groupe de positions. */
export const ECRITS = new Set([0, 5, 15, 16]);

/**
 * Positions à envoyer pour ranger les salons temporaires d'un hub juste sous lui (voir l'en-tête). `salons` : salons du
 * cache (id, type, parent_id, position) ; `groupe` : ids des salons temporaires du hub, du plus récent au plus ancien.
 * `types` : groupe de tri de Discord du repère (vocaux par défaut ; ECRITS pour les salons de match sous un salon
 * écrit). Rend `[{ id, position }]` (seulement ce qui change), vide s'il n'y a rien à faire.
 */
export function positionsSousHub(salons, hub, groupe, types = VOCAUX) {
  const parent = hub.parent_id ?? null;
  const freres = salons
    .filter(c => (c.parent_id ?? null) === parent && types.has(Number(c.type)))
    .map(c => ({ id: String(c.id), position: Number(c.position ?? 0) }))
    .sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const iHub = freres.findIndex(c => c.id === String(hub.id));
  if (iHub < 0) return [];
  const dansGroupe = new Set(groupe.filter(id => freres.some(c => c.id === id)));
  if (!dansGroupe.size) return [];
  const reste = freres.filter(c => !dansGroupe.has(c.id));
  const j = reste.findIndex(c => c.id === String(hub.id));
  const ordre = [...reste.slice(0, j + 1).map(c => c.id), ...groupe.filter(id => dansGroupe.has(id)), ...reste.slice(j + 1).map(c => c.id)];
  // Positions : celles du hub et de ce qui le suit, renumérotées de façon croissante à partir de la plus basse (seuls
  // les salons dont la position change sont envoyés ; ceux au-dessus du hub ne bougent pas).
  const avant = new Map(freres.map(c => [c.id, c.position]));
  const debut = ordre.indexOf(String(hub.id));
  const sortie = [];
  // Salons du groupe : chacun juste après le précédent ; salons qui suivent : gardent leur position si elle suffit.
  let p = avant.get(String(hub.id));
  for (let i = debut + 1; i < ordre.length; i++) {
    const id = ordre[i];
    const voulu = dansGroupe.has(id) ? p + 1 : Math.max(p + 1, avant.get(id));
    p = voulu;
    if (avant.get(id) !== voulu) sortie.push({ id, position: voulu });
  }
  return sortie;
}

/**
 * Range les salons temporaires d'un hub juste sous lui (après le déplacement du membre ; au mieux). `cache` : cache de
 * la Gateway (`salons` : Map). 429 : un seul nouvel essai après le délai annoncé (5 s au plus).
 */
export async function placerSousHub(ctx, cache, hub, attendre = ms => new Promise(r => setTimeout(r, ms))) {
  const hubSalon = cache.salons.get(hub.id);
  if (!hubSalon) return { ok: false, motif: 'hub-absent' };
  const lignes = (await salonsDuServeur(ctx.base, ctx.guildId)).filter(s => s.hubId === hub.id);
  const groupe = lignes.sort((a, b) => (a.creeLe < b.creeLe ? 1 : a.creeLe > b.creeLe ? -1 : 0)).map(s => s.salonId);
  const positions = positionsSousHub([...cache.salons.values()], hubSalon, groupe);
  if (!positions.length) return { ok: true, positions };
  let r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/guilds/${ctx.guildId}/channels`, positions, { raison: 'Esport HQ : salon vocal temporaire sous son hub' });
  if (r.statut === 429) {
    await attendre(Math.min(5000, Math.max(250, (r.retryApresS ?? 1) * 1000)));
    r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/guilds/${ctx.guildId}/channels`, positions, { raison: 'Esport HQ : salon vocal temporaire sous son hub' });
  }
  if (r.ok) for (const x of positions) if (cache.salons.has(x.id)) cache.salons.set(x.id, { ...cache.salons.get(x.id), position: x.position });
  return { ok: r.ok, statut: r.statut, positions };
}

/**
 * Après un enregistrement des réglages (Bot Esport HQ, fiche d'un événement, suppression d'un événement) : hubs cachés
 * ou rendus, et surcharges des salons verrouillés déjà ouverts recalculées pour les hubs dont l'option « visibles mais
 * pas joignables » a changé. Au mieux (journal du serveur). `ctx` : comme `synchroniserHubs`.
 */
export async function apresReglages(ctx, avant, apres) {
  const bilan = await synchroniserHubs(ctx, apres);
  if (!ctx?.jetonBot || !ctx.guildId) return bilan;
  const changes = (apres?.hubs ?? []).filter(h => Boolean(avant?.hubs?.find(x => x.id === h.id)?.visibleNonJoignable) !== Boolean(h.visibleNonJoignable)).map(h => h.id);
  if (!changes.length) return bilan;
  const c = { ...ctx, reglages: apres };
  c.rolesEquipe = s => rolesEquipe(c, s);
  for (const s of await salonsDuServeur(ctx.base, ctx.guildId)) {
    if (!changes.includes(s.hubId) || !s.verrouille) continue;
    try {
      await appliquerSurcharges(c, s);
      bilan.salons = (bilan.salons ?? 0) + 1;
    } catch (e) {
      ctx.journal?.warn?.('[esport] vocaux : surcharges d’un salon ouvert refusées', s.salonId, e?.cle ?? e?.message ?? e);
    }
  }
  return bilan;
}
