/**
 * Salons de match fiables et synchronisés en quasi temps réel (migration 0079, docs/esport/evenements.md) : file d'envoi
 * persistante (ordre par salon, réessais avec attente croissante, plafond d'actions puis suite au passage suivant, aucun
 * doublon grâce au nonce, refus de permission → surcharge réparée puis échec noté et alerte, « Renvoyer »), contrôle et
 * réparation des accès, avertissement « Intégrer des liens », « Mise à jour » regroupées sur 30 s (phase, stream, statut),
 * accueil supprimé à la main reposté, empreinte d'avant 0079 reprise sans annonce, avis signés du site (valide, expiré,
 * rejoué, mauvaise signature, inconnu), anti-rebond, boucle rapide tenue sans Gateway. Faux site et faux Discord.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CAT, CAP_A, CAP_B, EC, L1, M1, SILENCE, T1, activer, lignes, messagesDe, monter, synchro } from './salons-match-aide.mjs';
import { changementsMatch, classerEnvoi, attenteReessai, creerSalonsMatch, DROITS_EQUIPE, nonceEnvoi } from '../noyau/evenements-club/salons-match.mjs';
import { creerBoucleSalonsMatch } from '../noyau/evenements-club/boucle-salons.mjs';
import { lireAvis, signerPoussee } from '../noyau/site-lz/poussee.mjs';
import { distribuer } from '../noyau/evenements.mjs';

const CLE = 'cle-du-pont-de-test-0123456789abcdef-xyz';
const INTEGRER = 1n << 14n;
const envois = async k => k.b.base.tous('SELECT * FROM club_salons_match_envois WHERE evenement_id = ? ORDER BY salon_match_id, ordre', [k.id]);
const postsMessages = (k, salon) => k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === `/channels/${salon}/messages`);
const attendre = ms => new Promise(ok => setTimeout(ok, ms));

/** Un seul match (le lobby retiré du site) : salons et messages faciles à suivre. */
async function monterUn(options = {}) {
  const k = await monter(options);
  k.site.tables.tournament_lobbies = [];
  k.site.tables.tournament_lobby_entries = [];
  return k;
}

async function alertes(k, compte = 'principal') {
  await distribuer(k.b.base, { maintenant: k.b.horloge.t });
  const r = await k.api('/notifications/centre?limite=100', await k.b.session(compte));
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.liste.filter(n => n.type === 'salon-match-alerte');
}

test('outils : classement des réponses, attente croissante, nonce stable, changements (phase, stream, statut)', () => {
  assert.equal(classerEnvoi({ ok: true }).etat, 'envoye');
  assert.equal(classerEnvoi({ ok: false, statut: 429 }).etat, 'limite');
  assert.deepEqual(classerEnvoi({ ok: false, statut: 0 }), { etat: 'reessai', raison: 'discord-injoignable' });
  assert.deepEqual(classerEnvoi({ ok: false, statut: 502 }), { etat: 'reessai', raison: 'discord-502' });
  assert.deepEqual(classerEnvoi({ ok: false, statut: 403, code: 50013 }), { etat: 'refus', raison: 'permission-50013' });
  assert.deepEqual(classerEnvoi({ ok: false, statut: 403, code: 50001 }), { etat: 'refus', raison: 'acces-50001' });
  assert.equal(classerEnvoi({ ok: false, statut: 404, code: 10003 }).etat, 'disparu');
  assert.deepEqual(classerEnvoi({ ok: false, statut: 400, code: 50035 }), { etat: 'echec', raison: 'discord-400-50035' });
  assert.deepEqual([1, 2, 3, 20].map(attenteReessai), [5_000, 10_000, 20_000, 600_000]);
  assert.equal(nonceEnvoi('a:accueil:1'), nonceEnvoi('a:accueil:1'));
  assert.ok(nonceEnvoi('a:accueil:1').length <= 25);
  const m = { genre: 'match', round: 1, position: 1, groupe: null, bracket: 'winner', label: null, phase: 'Phase 1', equipes: ['a', 'b'], prevu: null, stream: null, statut: 'pending', staff: [] };
  const e = JSON.stringify({ v: 2, prevu: null, equipes: ['a', 'b'], titre: [1, 1, null, 'winner', null, 'Phase 1'], staff: [], stream: null, statut: 'pending' });
  assert.deepEqual(changementsMatch(e, m).quoi, []);
  assert.deepEqual(changementsMatch(e, { ...m, phase: 'Demi-finales', stream: 'https://twitch.tv/x', statut: 'live' }).quoi, ['maj_titre', 'maj_stream', 'maj_statut']);
  // Devenu terminé : annoncé par le résultat (embed modifié, pas de « Mise à jour »).
  assert.deepEqual(changementsMatch(e, { ...m, statut: 'finished' }), { quoi: [], embed: true, horaire: false });
  // Empreinte d'avant 0079 (tableau) : seuls ses champs comptent.
  assert.deepEqual(changementsMatch(JSON.stringify([null, ['a', 'b'], 1, 1, null, 'winner', null]), { ...m, stream: 'https://x' }).quoi, []);
});

test('file : Discord en panne → réessai avec attente, ordre gardé par salon, même nonce ; embed de l’accueil en attente remplacé', async () => {
  const k = await monterUn();
  // Discord répond 500 au message d'accueil, puis le réseau coupe au premier réessai.
  k.discord.programme.push({ si: (m, c) => m === 'POST' && /\/messages$/.test(c), statut: 500, corps: { message: 'Internal Server Error' } });
  await activer(k);
  const [l] = await lignes(k);
  assert.equal(l.statut, 'ouvert');
  assert.equal(messagesDe(k, l.salon_id).length, 0);
  let [acc] = await envois(k);
  assert.equal(acc.genre, 'accueil');
  assert.equal(acc.statut, 'attente');
  assert.equal(acc.erreur, 'discord-500');
  assert.equal(acc.prochain_le, new Date(k.b.horloge.t + 5_000).toISOString());
  // Le stream est ajouté sur le site pendant ce temps : l'accueil (pas encore parti) prend le nouvel embed.
  k.site.tables.tournament_matches[0].stream_url = 'https://twitch.tv/lignezero';
  k.discord.programme.push(Object.assign(new Error('réseau coupé'), { si: (m, c) => m === 'POST' && /\/messages$/.test(c) }));
  await synchro(k);
  assert.equal(messagesDe(k, l.salon_id).length, 0, 'pas encore dû');
  k.b.horloge.t += 6_000;
  await synchro(k);
  [acc] = await envois(k);
  assert.equal(acc.erreur, 'discord-injoignable');
  assert.equal(acc.essais, 2);
  assert.equal(acc.prochain_le, new Date(k.b.horloge.t + 10_000).toISOString(), 'attente croissante');
  k.b.horloge.t += 11_000;
  await synchro(k);
  const msgs = messagesDe(k, l.salon_id);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].embeds[0].description, /twitch\.tv\/lignezero/);
  const essais = postsMessages(k, l.salon_id).map(a => a.corps.nonce);
  assert.equal(essais.length, 3);
  assert.equal(new Set(essais).size, 1, 'même nonce à chaque essai');
  assert.equal((await lignes(k))[0].message_id, msgs[0].id);
  // « Mise à jour » (stream) : derrière l'accueil, 30 s après le changement.
  k.b.horloge.t += 15_000;
  await synchro(k);
  assert.equal(messagesDe(k, l.salon_id).length, 2);
  assert.match(messagesDe(k, l.salon_id)[1].content, /Mise à jour du match : lien du stream/);
  const v = (await k.api(k.sm)).corps;
  assert.deepEqual(v.salons[0].envois, { envoyes: 2, attente: 0, echecs: 0, raisons: [] });
  assert.equal(v.envois.envoyes, 2);
});

test('file : réponse perdue (Discord a posté) → réessai sans doublon grâce au nonce', async () => {
  const k = await monterUn();
  const vrai = k.discord.fetch;
  let perdue = false;
  // Le premier message est bien posté par Discord, mais la réponse se perd (délai dépassé côté app).
  const fetchPerte = async (url, init) => {
    const r = await vrai(url, init);
    if (!perdue && init?.method === 'POST' && /\/channels\/\d+\/messages$/.test(new URL(String(url)).pathname)) {
      perdue = true;
      throw new Error('délai dépassé');
    }
    return r;
  };
  const sm = creerSalonsMatch({ base: k.b.base, site: k.site, fetch: fetchPerte, jetonBot: 'jeton-bot-de-test-jamais-reel', botId: k.APP, maintenant: () => k.b.horloge.t, journal: SILENCE });
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  await k.b.base.executer('UPDATE club_evenements SET salons_match = ? WHERE id = ?', [JSON.stringify({ actif: true, categorieId: CAT }), k.id]);
  await sm.synchroniser(k.id);
  const [l] = await lignes(k);
  assert.equal(messagesDe(k, l.salon_id).length, 1, 'posté par Discord');
  assert.equal((await envois(k))[0].statut, 'attente', 'l’app ne le sait pas');
  k.b.horloge.t += 6_000;
  await sm.synchroniser(k.id);
  assert.equal(messagesDe(k, l.salon_id).length, 1, 'pas de doublon');
  assert.equal((await envois(k))[0].statut, 'envoye');
  // Passages rejoués : une seule ligne de file par message (clé stable).
  await sm.synchroniser(k.id);
  await sm.synchroniser(k.id);
  const toutes = await envois(k);
  assert.equal(new Set(toutes.map(e => e.cle)).size, toutes.length);
  assert.equal(toutes.length, 1);
});

test('file : plafond d’actions atteint → la suite part au passage suivant, dans l’ordre ; limite de débit → attente annoncée', async () => {
  const k = await monterUn();
  await activer(k);
  const [l] = await lignes(k);
  const t = new Date(k.b.horloge.t).toISOString();
  for (let i = 1; i <= 60; i++) {
    await k.b.base.executer("INSERT INTO club_salons_match_envois (id, cle, evenement_id, salon_match_id, genre, methode, corps, ordre, statut, essais, prochain_le, cree_le, maj_le) VALUES (?, ?, ?, ?, 'alerte', 'post', ?, ?, 'attente', 0, ?, ?, ?)", [`env-${i}`, `${l.id}:alerte:${l.envois_seq + i}`, k.id, l.id, JSON.stringify({ content: `n${i}`, allowed_mentions: { parse: [] } }), l.envois_seq + i, t, t, t]);
  }
  await k.b.base.executer('UPDATE club_salons_match SET envois_seq = envois_seq + 60 WHERE id = ?', [l.id]);
  const sm = k.b.traiter.salonsMatch;
  await sm.viderEnvoisDus();
  const apres1 = messagesDe(k, l.salon_id).filter(m => /^n\d+$/.test(m.content ?? '')).length;
  assert.equal(apres1, 40, 'plafond de 40 actions');
  assert.equal((await envois(k)).filter(e => e.statut === 'attente').length, 20);
  // Limite de débit : arrêt net, l'envoi suivant attend le délai annoncé par Discord.
  k.discord.programme.push({ si: (m, c) => m === 'POST' && /\/messages$/.test(c), statut: 429, corps: { retry_after: 30, global: false } });
  await sm.viderEnvoisDus();
  const bloque = (await envois(k)).find(e => e.statut === 'attente' && e.erreur === 'limite-debit');
  assert.ok(bloque);
  assert.equal(bloque.prochain_le, new Date(k.b.horloge.t + 30_000).toISOString());
  k.b.horloge.t += 31_000;
  await sm.viderEnvoisDus();
  const contenus = messagesDe(k, l.salon_id).map(m => m.content).filter(c => /^n\d+$/.test(c ?? ''));
  assert.deepEqual(contenus, Array.from({ length: 60 }, (_, i) => `n${i + 1}`), 'tous, dans l’ordre');
});

test('refus de permission → surcharge du bot réparée et nouvel essai, puis échec noté, alerte, « Renvoyer les messages en échec »', async () => {
  const k = await monterUn();
  const refus = { si: (m, c) => m === 'POST' && /\/messages$/.test(c), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } };
  k.discord.programme.push(refus, { si: (m, c) => m === 'PUT' && /\/permissions\//.test(c), statut: 204 }, refus);
  await activer(k);
  const [l] = await lignes(k);
  assert.ok(k.discord.appels.some(a => a.methode === 'PUT' && a.chemin === `/channels/${l.salon_id}/permissions/${k.APP}` && (BigInt(a.corps.allow) & INTEGRER) === INTEGRER), 'surcharge du bot réparée');
  const [acc] = await envois(k);
  assert.equal(acc.statut, 'echec');
  assert.equal(acc.erreur, 'permission-50013');
  let v = (await k.api(k.sm)).corps;
  assert.deepEqual(v.salons[0].envois, { envoyes: 0, attente: 0, echecs: 1, raisons: [{ genre: 'accueil', raison: 'permission-50013' }] });
  const recues = await alertes(k);
  assert.ok(recues.some(n => n.charge.code === 'envoi-permission' && n.cible.match === `m:${M1}`), JSON.stringify(recues.map(n => n.charge)));
  // Les droits corrigés sur Discord : « Renvoyer les messages en échec ».
  const r = await k.api(`${k.sm}/renvoyer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.renvoyes, 1);
  assert.equal(messagesDe(k, l.salon_id).length, 1);
  v = (await k.api(`${k.sm}/etat`)).corps;
  assert.deepEqual(v.salons[0].envois, { envoyes: 1, attente: 0, echecs: 0, raisons: [] });
  assert.equal((await lignes(k))[0].message_id, messagesDe(k, l.salon_id)[0].id);
});

test('accès : surcharges du bot et des équipes vérifiées à chaque passage (une fois par minute) et complétées', async () => {
  const k = await monterUn();
  await activer(k);
  const [l] = await lignes(k);
  const salon = k.discord.etat.salons.get(l.salon_id);
  // Quelqu'un a retiré « Intégrer des liens » au bot et l'accès d'Alpha ; un rôle « Caster » ajouté à la main reste.
  salon.permission_overwrites = salon.permission_overwrites.filter(o => o.id !== k.roles.ALP).map(o => (o.id === k.APP ? { ...o, allow: String(1n << 10n) } : o));
  salon.permission_overwrites.push({ id: '760000000000000001', type: 0, allow: String(1n << 10n), deny: '0' });
  k.b.horloge.t += 60_000;
  const v = await synchro(k);
  assert.equal(v.etat.acces, 2);
  const o = id => k.discord.etat.salons.get(l.salon_id).permission_overwrites.find(x => x.id === id);
  assert.equal((BigInt(o(k.APP).allow) & INTEGRER), INTEGRER);
  assert.equal(o(k.roles.ALP).allow, DROITS_EQUIPE);
  assert.ok(o('760000000000000001'), 'surcharge ajoutée à la main gardée');
  // Rien ne manque : aucun PATCH de plus (et pas avant une minute).
  const patchs = () => k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${l.salon_id}`).length;
  const n = patchs();
  k.b.horloge.t += 60_000;
  await synchro(k);
  assert.equal(patchs(), n);
});

test('bot sans « Intégrer des liens » sur le serveur : avertissement dans le passage et alerte (les embeds seraient vides)', async () => {
  const k = await monterUn();
  const roles = [{ id: k.GUILD, name: '@everyone', permissions: '1024', position: 0 }, { id: '720000000000000002', name: 'Esport HQ', permissions: String((1n << 4n) | (1n << 10n) | (1n << 11n) | (1n << 15n) | (1n << 16n) | (1n << 28n)), managed: true, position: 3 }];
  k.discord.programme.push({ si: (m, c) => m === 'GET' && c === `/guilds/${k.GUILD}/roles`, statut: 200, corps: roles });
  const v = await activer(k);
  assert.ok(v.etat.avertissements.includes('embed-manquant'), JSON.stringify(v.etat.avertissements));
  assert.ok(v.etat.avertissements.includes('mentions-joueurs'));
  assert.ok((await alertes(k)).some(n => n.charge.code === 'embed-manquant'));
});

test('mises à jour regroupées sur 30 s : horaire puis stream et statut « en cours » → embed modifié à chaque fois, un seul message', async () => {
  const k = await monterUn();
  await activer(k);
  const [l] = await lignes(k);
  const editions = () => k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${l.salon_id}/messages/${l.message_id}`);
  k.site.tables.tournament_matches[0].scheduled_at = '2026-10-20T13:00:00.000Z';
  await synchro(k);
  k.b.horloge.t += 10_000;
  Object.assign(k.site.tables.tournament_matches[0], { stream_url: 'https://twitch.tv/lz', status: 'live' });
  await synchro(k);
  assert.equal(editions().length, 2, 'embed modifié à chaque changement');
  assert.match(editions()[1].corps.embeds[0].description, /en cours/);
  assert.match(editions()[1].corps.embeds[0].description, /twitch\.tv\/lz/);
  assert.equal(messagesDe(k, l.salon_id).length, 1, 'pas encore de « Mise à jour »');
  k.b.horloge.t += 21_000;
  await synchro(k);
  const msgs = messagesDe(k, l.salon_id);
  assert.equal(msgs.length, 2, 'un seul message pour les trois changements');
  assert.match(msgs[1].content, /Mise à jour du match : horaire, lien du stream, statut \(en cours\)/);
  assert.ok(msgs[1].allowed_mentions.users.includes(CAP_A) && msgs[1].allowed_mentions.users.includes(CAP_B));
  // Phase renommée sur le site : titre de l'embed suivi.
  k.site.tables.tournament_stages = [{ id: '66666666-6666-4666-8666-000000000009', tournament_id: T1, kind: 'bracket', name: 'Demi-finales', sort_order: 0 }];
  Object.assign(k.site.tables.tournament_matches[0], { stage_id: '66666666-6666-4666-8666-000000000009', bracket: null });
  k.b.horloge.t += 1_000;
  await synchro(k);
  assert.match(editions().at(-1).corps.embeds[0].title, /Demi-finales/);
  // Un résultat juste après : la « Mise à jour » en attente part d'abord, puis le résultat (ordre lisible).
  Object.assign(k.site.tables.tournament_matches[0], { status: 'finished', score_a: 2, score_b: 0, winner_id: k.site.tables.tournament_matches[0].team_a_id });
  await synchro(k);
  const fin = messagesDe(k, l.salon_id).slice(2).map(m => m.content.split('\n')[0]);
  assert.match(fin[0], /Mise à jour du match : phase/);
  assert.match(fin[1], /Résultat enregistré/);
});

test('accueil supprimé à la main : la modification de l’embed le reposte ; empreinte d’avant 0079 reprise sans annonce', async () => {
  const k = await monterUn();
  await activer(k);
  let [l] = await lignes(k);
  k.discord.etat.messages.set(l.salon_id, []);
  k.site.tables.tournament_matches[0].scheduled_at = '2026-10-20T15:00:00.000Z';
  await synchro(k);
  const msgs = messagesDe(k, l.salon_id);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].embeds[0].description, new RegExp(`<t:${Date.parse('2026-10-20T15:00:00.000Z') / 1000}:F>`));
  [l] = await lignes(k);
  assert.equal(l.message_id, msgs[0].id, 'nouvel accueil');
  k.b.horloge.t += 31_000;
  await synchro(k);
  assert.match(messagesDe(k, l.salon_id).at(-1).content, /Mise à jour du match : horaire/);
  // Ancienne empreinte (tableau) identique aux champs d'alors : réécrite au nouveau format, rien n'est annoncé.
  await k.b.base.executer('UPDATE club_salons_match SET empreinte = ? WHERE id = ?', [JSON.stringify(['2026-10-20T15:00:00.000Z', [k.site.tables.tournament_matches[0].team_a_id, k.site.tables.tournament_matches[0].team_b_id].sort(), 1, 1, null, 'winner', null]), l.id]);
  const avant = k.discord.appels.length;
  k.b.horloge.t += 40_000;
  await synchro(k);
  assert.equal(k.discord.appels.filter((a, i) => i >= avant && a.methode !== 'GET').length, 0);
  assert.equal(JSON.parse((await lignes(k))[0].empreinte).v, 2);
});

// ------------------------------------------------------------------ Avis signés du site

async function monterPoussee(options = {}) {
  const k = await monter({ clesPontSite: [CLE], antiRebondSalons: 30, ...options });
  await activer(k);
  k.pousser = async (corps, { cle = CLE, horodatage = k.b.horloge.t, nonce = randomBytes(18).toString('base64url'), signature, prefixe = '' } = {}) => {
    const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
    const sig = signature ?? signerPoussee(cle, { horodatage: String(horodatage), nonce, corps: texte });
    const r = await k.b.traiter(new Request(`https://esport.test${prefixe}/site-lz/evenement`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Adresse-Client': '203.0.113.9', 'x-lz-horodatage': String(horodatage), 'x-lz-nonce': nonce, 'x-lz-signature': sig }, body: texte }));
    return { statut: r.status, corps: await r.json() };
  };
  return k;
}

test('avis du site : signature valide → matchs annoncés relus et traités ; expiré, rejoué, mauvaise signature → 401 ; inconnu → ignoré', async () => {
  // Vecteur commun avec le site (api/test/pousse.test.mjs du dépôt site-ligne-zero) : même calcul des deux côtés.
  assert.equal(signerPoussee(CLE, { horodatage: '1793000000000', nonce: 'nonce-de-test-0123456789', corps: JSON.stringify({ tournoi: '11111111-1111-4111-8111-111111111111', matchs: ['44444444-4444-4444-8444-000000000001'] }) }), '4y7w-w1mPSWPsrZFZM77wN8hfkdnJj6YsHaoO_6GFiA');
  const k = await monterPoussee();
  const sm = k.b.traiter.salonsMatch;
  const lm = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  k.site.tables.tournament_matches[0].scheduled_at = '2026-10-20T16:00:00.000Z';
  const ok = await k.pousser({ tournoi: T1, matchs: [M1] }, { prefixe: '/api/esport' });
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  assert.deepEqual(ok.corps, { ok: true, evenements: 1 });
  await sm.attendrePoussees();
  const edit = k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${lm.salon_id}/messages/${lm.message_id}`);
  assert.equal(edit.length, 1, 'embed modifié par l’avis, sans attendre la relecture');
  const etat = (await k.api(`${k.sm}/etat`)).corps;
  assert.equal(etat.etat.origine, 'poussee');
  assert.equal((await k.b.base.premier('SELECT COUNT(*) AS n FROM site_lz_pousses WHERE traite_le IS NULL', [])).n, 0);
  // Refus.
  const vieux = await k.pousser({ tournoi: T1, matchs: [M1] }, { horodatage: k.b.horloge.t - 6 * 60_000 });
  assert.equal(vieux.statut, 401);
  assert.match(vieux.corps.erreur, /horloge/);
  const nonce = randomBytes(18).toString('base64url');
  assert.equal((await k.pousser({ tournoi: T1, matchs: [M1] }, { nonce })).statut, 200);
  const rejeu = await k.pousser({ tournoi: T1, matchs: [M1] }, { nonce });
  assert.equal(rejeu.statut, 401);
  assert.match(rejeu.corps.erreur, /rejeu/);
  const faux = await k.pousser({ tournoi: T1, matchs: [M1] }, { cle: 'une-autre-cle-de-test-0123456789abcdefgh' });
  assert.equal(faux.statut, 401);
  assert.match(faux.corps.erreur, /signature/);
  const sansEntetes = await k.pousser({ tournoi: T1 }, { signature: '' });
  assert.equal(sansEntetes.statut, 401);
  // Corps modifié après signature : refusé.
  const h = String(k.b.horloge.t);
  const n2 = randomBytes(18).toString('base64url');
  const sig = signerPoussee(CLE, { horodatage: h, nonce: n2, corps: JSON.stringify({ tournoi: T1, matchs: [M1] }) });
  assert.equal((await k.pousser({ tournoi: T1, matchs: [L1] }, { nonce: n2, signature: sig })).statut, 401);
  // Avis signés mais inconnus : acceptés et ignorés (déploiement dans n'importe quel ordre).
  assert.deepEqual((await k.pousser({ tournoi: '99999999-9999-4999-8999-999999999999', matchs: [M1] })).corps, { ok: true, evenements: 0 });
  assert.deepEqual((await k.pousser('{"version":3,"quoi":"autre"}')).corps, { ok: true, ignore: true, evenements: 0 });
  await sm.attendrePoussees();
  assert.deepEqual(lireAvis(JSON.stringify({ tournoi: T1, matchs: ['x', M1, M1] })), { tournoi: T1, matchs: [M1], lobbies: [], tout: false });
  assert.equal(lireAvis(JSON.stringify({ tournoi: T1 })).tout, true);
});

test('avis du site : clé du pont absente sur l’hébergement → 503 (le site garde l’avis et réessaie)', async () => {
  const k = await monter();
  const r = await k.b.traiter(new Request('https://esport.test/site-lz/evenement', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Adresse-Client': '203.0.113.9', 'x-lz-horodatage': String(k.b.horloge.t), 'x-lz-nonce': 'nonce-de-test-0123456789', 'x-lz-signature': 'x' }, body: '{}' }));
  assert.equal(r.status, 503);
});

test('anti-rebond : plusieurs avis rapprochés → une seule synchronisation, matchs annoncés traités en premier ; attente maximale', async () => {
  const k = await monterPoussee({ antiRebondSalons: 60 });
  const sm = k.b.traiter.salonsMatch;
  k.site.lectures.length = 0;
  for (const corps of [{ tournoi: T1, matchs: [M1] }, { tournoi: T1, lobbies: [L1] }, { tournoi: T1, matchs: [M1] }]) assert.equal((await k.pousser(corps)).statut, 200);
  assert.equal(k.site.lectures.filter(t => t === 'tournament_matches').length, 0, 'rien avant l’anti-rebond');
  await attendre(200);
  await sm.attendrePoussees();
  assert.equal(k.site.lectures.filter(t => t === 'tournament_matches').length, 1, 'une seule relecture pour trois avis');
  // Avis en continu : traités au plus tard après l'attente maximale (jamais repoussés sans fin).
  const sm2 = creerSalonsMatch({ base: k.b.base, site: k.site, fetch: k.discord.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', botId: k.APP, maintenant: () => k.b.horloge.t, journal: SILENCE, antiRebondMs: 50, antiRebondMaxMs: 120 });
  k.site.lectures.length = 0;
  for (let i = 0; i < 10; i++) {
    await sm2.recevoirPoussee({ tournoi: T1, matchs: [M1] });
    await attendre(30);
  }
  await sm2.attendrePoussees();
  assert.ok(k.site.lectures.filter(t => t === 'tournament_matches').length >= 2, 'traité pendant la rafale');
});

test('boucle rapide : tenue par un seul processus sans Gateway (tickets désactivés), relecture toutes les 60 s, avis restés en base repris', async () => {
  const k = await monterUn();
  await activer(k);
  assert.equal(k.b.traiter.ticketsGateway.tachesMeneur, undefined, 'plus liée à la Gateway');
  const sm = k.b.traiter.salonsMatch;
  const b1 = creerBoucleSalonsMatch({ base: k.b.base, salonsMatch: sm, maintenant: () => k.b.horloge.t, identifiant: 'p1', journal: SILENCE });
  const b2 = creerBoucleSalonsMatch({ base: k.b.base, salonsMatch: sm, maintenant: () => k.b.horloge.t, identifiant: 'p2', journal: SILENCE });
  const [l] = await lignes(k);
  const editions = () => k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${l.salon_id}/messages/${l.message_id}`).length;
  k.site.tables.tournament_matches[0].scheduled_at = '2026-10-20T17:00:00.000Z';
  const r1 = await b1.passage();
  assert.equal(r1.meneur, true);
  assert.deepEqual(r1.relecture, { evenements: 1, enCours: 1 });
  assert.equal(editions(), 1, 'relu sans Gateway');
  assert.equal((await b2.passage()).meneur, false, 'un seul meneur');
  // 30 s plus tard : pas de relecture (60 s), mais la « Mise à jour » due part (file).
  k.b.horloge.t += 31_000;
  const r2 = await b1.passage();
  assert.equal(r2.relecture, null);
  assert.equal(r2.envoyes, 1);
  assert.match(messagesDe(k, l.salon_id).at(-1).content, /Mise à jour du match : horaire/);
  // Avis du site noté par un processus arrêté avant de le traiter : repris par la boucle.
  k.site.tables.tournament_matches[0].team_b_id = EC;
  await k.b.base.executer('INSERT INTO site_lz_pousses (id, evenement_id, cles, recu_le) VALUES (?, ?, ?, ?)', ['avis-1', k.id, JSON.stringify([`m:${M1}`]), new Date(k.b.horloge.t).toISOString()]);
  k.b.horloge.t += 5_000;
  const r3 = await b1.passage();
  assert.equal(r3.poussees, 1);
  assert.equal(editions(), 2);
  assert.ok(k.discord.etat.salons.get(l.salon_id).permission_overwrites.some(o => o.id === k.roles.CHA));
  // Relecture suivante à 60 s.
  k.b.horloge.t += 30_000;
  assert.deepEqual((await b1.passage()).relecture, { evenements: 1, enCours: 1 });
  await b1.arreter();
  assert.equal((await b2.passage()).meneur, true, 'bail rendu à l’arrêt');
  await b2.arreter();
});
