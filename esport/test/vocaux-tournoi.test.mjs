/**
 * Équipes d'un tournoi et rôles Discord (vocaux/tournoi.mjs, migration 0063) : lecture des réponses des tickets
 * d'inscription (Discord ID, mention, @pseudo, Embark ID), import (propositions, membres absents, recherche par nom
 * exact), équipes à la main, création des rôles (modèle, non mentionnable, couleur) et attribution aux membres présents
 * (bilan : absents, sans ID), rejouable ; suppression (bouton, cron : tournoi terminé, N heures après la fin) ;
 * droits ; export et RGPD. Faux Discord REST, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { lireLigneMembre, lireReponsesInscription, nomRole, tachesTournoisDiscord } from '../noyau/vocaux/tournoi.mjs';
import { effacementParDiscord } from '../noyau/tickets/rgpd.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const J1 = '810000000000000101';
const J2 = '810000000000000102';
const J3 = '810000000000000103';
const COACH = '810000000000000104';
const ABSENT = '810000000000000199';

test('lecture d’une ligne : Discord ID, mention, @pseudo, Embark ID, puces et séparateurs', () => {
  assert.deepEqual(lireLigneMembre(`${J1} — Kira#1234`), { poste: 'joueur', discordId: J1, nom: '', embarkId: 'Kira#1234', brut: `${J1} — Kira#1234` });
  assert.deepEqual({ ...lireLigneMembre(`1. <@!${J2}> - Nox#0042`, 'remplacant'), brut: undefined }, { poste: 'remplacant', discordId: J2, nom: '', embarkId: 'Nox#0042', brut: undefined });
  const p = lireLigneMembre('Joueur 3 : @zoe | Zoe#9876');
  assert.deepEqual([p.discordId, p.nom, p.embarkId], [null, 'zoe', 'Zoe#9876']);
  const q = lireLigneMembre(`Discord: ${J3} Embark: Max#1111`);
  assert.deepEqual([q.discordId, q.nom, q.embarkId], [J3, '', 'Max#1111']);
});

test('lecture des réponses du formulaire « Inscription The Nuke End » ; problèmes signalés', () => {
  const r = lireReponsesInscription([
    { id: 'equipe', libelle: { fr: 'Nom de l’équipe' }, valeur: ' Ligne  Zéro ' },
    { id: 'tag', libelle: { fr: 'TAG' }, valeur: 'lz0' },
    { id: 'joueurs', libelle: { fr: 'Joueurs 1 à 3' }, valeur: `${J1} — Kira#1234\n<@${J2}> - Nox#0042\n@zoe — Zoe#9876` },
    { id: 'coach', libelle: { fr: 'Coach' }, valeur: `${COACH} — Coach#0001` },
    { id: 'remplacants', libelle: { fr: 'Remplaçants' }, valeur: 'aucun' },
  ]);
  assert.deepEqual([r.nom, r.tag], ['Ligne Zéro', 'LZ0']);
  assert.deepEqual(r.membres.map(m => [m.poste, m.discordId]), [['joueur', J1], ['joueur', J2], ['joueur', null], ['coach', COACH]]);
  assert.deepEqual(r.problemes, ['sans_id']);
  // Libellés seulement (autre formulaire), anglais.
  const en = lireReponsesInscription([{ id: 'a', libelle: { en: 'Team name' }, valeur: 'Alpha' }, { id: 'b', libelle: { en: 'Team TAG' }, valeur: 'ALP' }, { id: 'c', libelle: { en: 'Players' }, valeur: J1 }, { id: 'd', libelle: { en: 'Subs' }, valeur: J2 }]);
  assert.deepEqual([en.nom, en.tag, en.membres.map(m => m.poste)], ['Alpha', 'ALP', ['joueur', 'remplacant']]);
  assert.deepEqual(lireReponsesInscription([]).problemes, ['nom', 'tag', 'joueurs']);
  assert.equal(nomRole('{tag} {nom}', { tag: 'LZ0', nom: 'Ligne Zéro' }), 'LZ0 Ligne Zéro');
  assert.equal(nomRole('[{tag}] @everyone', { tag: 'A' }), '[A] everyone');
});

async function monter() {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  const team = await teamAvecMembres(k.b, { nom: 'Organisation', membres: { coach123: { pseudo: 'Zed', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const t = await k.api(`/teams/${team.teamId}/tournois`, undefined, { methode: 'POST', corps: { nom: 'The Nuke End', debut: '2026-11-21', fin: '2026-11-22' } });
  assert.equal(t.statut, 200, JSON.stringify(t.corps));
  const tournoiId = t.corps.tournoi?.id ?? t.corps.id;
  const chemin = `/teams/${team.teamId}/tournois/${tournoiId}/discord`;
  return { ...k, team, tournoiId, chemin };
}

async function ticketInscription(k, categorieId, numero, reponses, statut = 'resolu') {
  const t = '2026-11-10T10:00:00.000Z';
  await k.b.base.executer(
    "INSERT INTO tickets (id, numero, categorie_id, statut, priorite, auteur_discord_id, auteur_nom, langue, reponses, ouvert_le, maj_le, derniere_activite_le, liaison) VALUES (?, ?, ?, ?, 'moyen', ?, 'Capitaine', 'fr', ?, ?, ?, ?, '{}')",
    [`00000000-0000-4000-8000-00000000000${numero}`, numero, categorieId, statut, J1, JSON.stringify(reponses), t, t, t],
  );
}

test('import depuis les tickets : propositions (absents, recherche par nom exact, déjà importé) ; équipes enregistrées et corrigées', async () => {
  const k = await monter();
  const cat = await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Inscription The Nuke End', en: 'The Nuke End registration' }, modeleNom: 'nuke-{numero}' } });
  const categorieId = cat.corps.id;
  k.discord.etat.absents.add(ABSENT);
  await ticketInscription(k, categorieId, 1, [
    { id: 'equipe', valeur: 'Ligne Zéro' },
    { id: 'tag', valeur: 'LZ0' },
    { id: 'joueurs', valeur: `${J1} — Kira#1234\n${ABSENT} — Ghost#0000\n@Zoé — Zoe#9876` },
    { id: 'coach', valeur: '' },
  ]);
  await ticketInscription(k, categorieId, 2, [{ id: 'equipe', valeur: 'Bravo' }, { id: 'tag', valeur: 'BRV' }, { id: 'joueurs', valeur: `${J2}\n${J3}\n@inconnu` }], 'ouvert');
  const i = await k.api(`${k.chemin}/import`, undefined, { methode: 'POST', corps: { categorieId } });
  assert.equal(i.statut, 200, JSON.stringify(i.corps));
  const [a, b] = i.corps.propositions;
  assert.deepEqual([a.numero, a.nom, a.tag, a.statut], [1, 'Ligne Zéro', 'LZ0', 'resolu']);
  assert.deepEqual(a.membres.map(m => m.present), [true, false, true]);
  assert.equal(a.membres[2].discordId, '800000000000000077', 'Zoé trouvée par son nom affiché exact');
  assert.deepEqual(a.problemes, ['absents']);
  assert.deepEqual(b.problemes, ['sans_id']);
  // Enregistrer les deux équipes, Bravo corrigée (membre sans ID retiré, coach ajouté à la main).
  const e = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { equipes: [{ nom: a.nom, tag: a.tag, ticketId: a.ticketId, membres: a.membres.map(({ poste, discordId, nom, embarkId }) => ({ poste, discordId, nom, embarkId })) }, { nom: 'Bravo', tag: 'BRV', ticketId: b.ticketId, membres: [{ poste: 'joueur', discordId: J2 }, { poste: 'joueur', discordId: J3 }, { poste: 'coach', discordId: COACH, nom: 'Coach B' }] }] },
  });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  assert.deepEqual(e.corps.equipes.map(x => [x.tag, x.membres.length]), [['LZ0', 3], ['BRV', 3]]);
  // Deuxième import : déjà là. TAG en double refusé ; Discord ID invalide refusé.
  assert.deepEqual((await k.api(`${k.chemin}/import`, undefined, { methode: 'POST', corps: { categorieId } })).corps.propositions.map(p => p.deja), [true, true]);
  assert.equal((await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Copie', tag: 'lz0' } })).statut, 409);
  assert.equal((await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'X', tag: 'XX', membres: [{ discordId: '123' }] } })).statut, 400);
  // Modifier : nom et membres.
  const bravo = e.corps.equipes.find(x => x.tag === 'BRV');
  const m = await k.api(`${k.chemin}/equipes/${bravo.id}`, undefined, { methode: 'PATCH', corps: { nom: 'Bravo Six', membres: [{ poste: 'joueur', discordId: J2 }, { poste: 'joueur', discordId: J3 }] } });
  assert.equal(m.corps.equipes.find(x => x.id === bravo.id).nom, 'Bravo Six');
  // Droits : un joueur de la team (pas tournois.gerer) n'a rien ; l'import exige de voir la catégorie.
  assert.equal((await k.api(k.chemin, k.team.sessions.lea12345)).statut, 403);
});

test('créer les rôles : un par équipe (modèle, non mentionnable, couleur), donné aux présents ; bilan ; rejouable ; supprimer', async () => {
  const k = await monter();
  await k.api(k.chemin, undefined, { methode: 'PUT', corps: { modeleRole: '{tag} | {nom}', couleur: '#E4572E', suppressionH: 12 } });
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { equipes: [{ nom: 'Ligne Zéro', tag: 'LZ0', membres: [{ discordId: J1 }, { discordId: ABSENT, nom: 'Ghost' }, { nom: 'Sans ID' }] }, { nom: 'Bravo', tag: 'BRV', membres: [{ discordId: J2 }] }] } });
  k.discord.etat.absents.add(ABSENT);
  const r = await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const creations = k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === `/guilds/${k.GUILD}/roles`);
  assert.deepEqual(creations.map(c => c.corps.name), ['LZ0 | Ligne Zéro', 'BRV | Bravo']);
  assert.deepEqual([creations[0].corps.mentionable, creations[0].corps.permissions, creations[0].corps.color], [false, '0', 0xe4572e]);
  assert.deepEqual([r.corps.bilan.creees, r.corps.bilan.attribues], [2, 2]);
  assert.deepEqual(r.corps.bilan.absents.map(x => x.discordId), [ABSENT]);
  assert.deepEqual(r.corps.bilan.sansId.map(x => x.nom), ['Sans ID']);
  assert.equal(r.corps.bilan.hierarchie.ok, true);
  const lz = r.corps.equipes.find(e => e.tag === 'LZ0');
  assert.ok(lz.roleId);
  assert.deepEqual(lz.membres.map(m => m.roleStatut), ['attribue', 'absent', null]);
  assert.ok(r.corps.reglages.rolesCreesLe);
  // Rejoué : aucun rôle recréé, seuls les manquants retentés (l'absent est arrivé sur le serveur).
  k.discord.etat.absents.delete(ABSENT);
  const r2 = await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.deepEqual([r2.corps.bilan.creees, r2.corps.bilan.attribues], [0, 1]);
  // Rôle du bot trop bas : refus expliqué (403, Missing Permissions).
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Charlie', tag: 'CHR', membres: [{ discordId: J3 }] } });
  k.discord.programme.push({ si: (m, c) => m === 'PUT' && c.includes(`/members/${J3}/roles/`), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  const r3 = await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.deepEqual(r3.corps.bilan.refus.map(x => [x.quoi, x.code]), [['attribution', 50013]]);
  // Supprimer : rôles effacés sur Discord, plus d'identifiant gardé.
  const ids = r3.corps.equipes.map(e => e.roleId);
  const s = await k.api(`${k.chemin}/roles/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s.corps.nettoyage.roles, 3);
  for (const id of ids) assert.ok(k.discord.appels.some(a => a.methode === 'DELETE' && a.chemin === `/guilds/${k.GUILD}/roles/${id}`));
  assert.ok(s.corps.equipes.every(e => !e.roleId));
  assert.ok(s.corps.reglages.rolesSupprimesLe);
  // Sans vocaux.configurer : la liste reste gérable, pas les rôles.
  const manager = await k.compteAvec('gest1234', 'Gest', ['tickets.voir']);
  assert.ok(manager);
});

test('cron : rôles supprimés quand le tournoi est terminé, ou N heures après sa date de fin', async () => {
  const k = await monter();
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Ligne Zéro', tag: 'LZ0', membres: [{ discordId: J1 }] } });
  await k.api(k.chemin, undefined, { methode: 'PUT', corps: { suppressionH: 24 } });
  await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  const ctx = { jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: k.discord.fetch };
  // Fin le 22/11 : le 23/11 à 12 h, pas encore (fin de journée + 24 h) ; le 24/11 à 1 h, oui.
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-23T12:00:00Z') }), 0);
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-24T01:00:00Z') }), 1);
  assert.equal((await k.b.base.premier('SELECT role_id FROM tournoi_equipes', [])).role_id, null);
  // Recréés, puis tournoi marqué « terminé » : supprimés au passage suivant, quelle que soit la date.
  await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  await k.b.base.executer("UPDATE tournois SET statut = 'termine' WHERE id = ?", [k.tournoiId]);
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-21T12:00:00Z') }), 1);
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-21T12:05:00Z') }), 0, 'déjà fait');
  assert.ok(['tournoi_discord', 'tournoi_equipes', 'tournoi_equipe_membres'].every(t => TABLES.some(([n]) => n === t)));
  assert.ok(effacementParDiscord([J1]).some(i => i.sql.includes('tournoi_equipe_membres')));
});

// ------------------------------------------------------------------ Hub vocal du tournoi (étape 4)

const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const CAT = '710000000000000050';
const HUB_T = '710000000000000052';
const STAFF = '720000000000000001';
const CASTER = '720000000000000060';
const R1 = '720000000000000071';
const R2 = '720000000000000072';
const TOURNOI = '11111111-2222-4333-8444-555555555555';
const PV_CONNECT = 1n << 20n;
const silencieux = { error() {}, warn() {} };

async function monterHub() {
  const { baseMigree } = await import('./base.mjs');
  const { fauxDiscordRest } = await import('./tickets-aide.mjs');
  const { creerMoteurVocaux } = await import('../noyau/vocaux/moteur.mjs');
  const { creerBotVocaux } = await import('../noyau/vocaux/bot.mjs');
  const base = await baseMigree();
  const t = '2026-11-20T10:00:00.000Z';
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: false, guildId: GUILD, guildNom: 'Club', langue: 'fr' }), t]);
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['vocaux', JSON.stringify({ actif: true, hubs: [{ id: HUB_T, nom: 'Vocal équipe The Nuke End', modeleNom: '{tag} — {nom}', limite: 0, verrouille: true, tournoiId: TOURNOI, rolesAutorises: [CASTER] }], rolesStaff: [STAFF], delaiSuppressionS: 5, maxParMembre: 1, quandProprietairePart: 'transferer' }), t]);
  for (const [id, nom, tag, role, pos] of [['e1', 'Ligne Zéro', 'LZ0', R1, 0], ['e2', 'Bravo', 'BRV', R2, 1]]) {
    await base.executer('INSERT INTO tournoi_equipes (id, tournoi_id, team_id, nom, tag, role_id, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [`00000000-0000-4000-8000-0000000000${id === 'e1' ? '01' : '02'}`, TOURNOI, 'team', nom, tag, role, pos, t, t]);
  }
  const rest = fauxDiscordRest();
  rest.etat.salons.set(CAT, { id: CAT, type: 4, name: 'The Nuke End', guild_id: GUILD, position: 2, permission_overwrites: [] });
  rest.etat.salons.set(HUB_T, { id: HUB_T, type: 2, name: 'Vocal équipe The Nuke End', guild_id: GUILD, parent_id: CAT, position: 3, permission_overwrites: [] });
  for (const r of [R1, R2]) rest.etat.roles.set(r, { id: r, name: r === R1 ? 'LZ0 Ligne Zéro' : 'BRV Bravo' });
  const moteur = creerMoteurVocaux({ base, fetch: rest.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', botId: () => BOT, delaiMs: 60, journal: silencieux });
  await moteur.evenement('GUILD_CREATE', { id: GUILD, channels: [...rest.etat.salons.values()], voice_states: [], members: [] });
  const bot = creerBotVocaux({ base, fetch: rest.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', botId: BOT });
  return { base, rest, moteur, bot };
}

const vsT = (userId, channelId, nom, roles = []) => ({ guild_id: GUILD, user_id: userId, channel_id: channelId, member: { user: { id: userId, username: nom.toLowerCase() }, nick: nom, roles } });
const creationsT = rest => rest.appels.filter(a => a.methode === 'POST' && a.chemin === `/guilds/${GUILD}/channels`);

test('hub du tournoi : sans rôle d’équipe → déconnecté et prévenu en MP ; avec : salon de l’équipe verrouillé sur son rôle', async () => {
  const k = await monterHub();
  // Personne sans équipe : déconnectée du hub, MP d'explication, aucun salon.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J3, HUB_T, 'Intrus', ['720000000000000999']));
  assert.equal(creationsT(k.rest).length, 0);
  assert.deepEqual(k.rest.appels.find(a => a.chemin === `/guilds/${GUILD}/members/${J3}`).corps, { channel_id: null });
  assert.equal(k.rest.appels.find(a => a.chemin === '/users/@me/channels').corps.recipient_id, J3);
  const mp = k.rest.etat.mp.at(-1);
  assert.match(mp.content, /réservé aux équipes inscrites au tournoi/);
  // Joueur de Ligne Zéro : salon « LZ0 — Ligne Zéro », verrouillé : @everyone refusé, rôle de l'équipe, staff et casters admis.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, HUB_T, 'Kira', [R1]));
  const [c] = creationsT(k.rest);
  assert.equal(c.corps.name, 'LZ0 — Ligne Zéro');
  const de = id => c.corps.permission_overwrites.find(o => o.id === id);
  assert.equal(BigInt(de(GUILD).deny) & PV_CONNECT, PV_CONNECT);
  for (const id of [R1, STAFF, CASTER, J1]) assert.equal(BigInt(de(id).allow) & PV_CONNECT, PV_CONNECT, id);
  assert.ok(!de(R2), 'l’autre équipe n’entre pas');
  const salon = [...k.rest.etat.salons.values()].find(s => s.name === 'LZ0 — Ligne Zéro').id;
  const ligne = await k.base.premier('SELECT tournoi_id, equipe_id, verrouille FROM vocaux_salons WHERE salon_id = ?', [salon]);
  assert.deepEqual([ligne.tournoi_id, Number(ligne.verrouille)], [TOURNOI, 1]);
  // Panneau : ni renommer ni déverrouiller (boutons grisés), pas de liste d'amis.
  const panneau = k.rest.etat.messages.get(salon)[0];
  const boutons = panneau.components.flatMap(r => r.components);
  assert.equal(boutons.find(b => b.custom_id === `vc:r:${salon}`).disabled, true);
  assert.equal(boutons.find(b => b.custom_id === `vc:u:${salon}`).disabled, true);
  assert.ok(!boutons.some(b => b.custom_id === `vc:a:${salon}`));
  assert.match(panneau.embeds[0].description, /équipe \*\*LZ0 Ligne Zéro\*\*/);
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, salon, 'Kira', [R1]));
  // Coéquipier : déplacé dans le salon de l'équipe, pas de deuxième salon ; l'autre équipe a le sien.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J2, HUB_T, 'Nox', [R1]));
  assert.equal(creationsT(k.rest).length, 1);
  assert.deepEqual(k.rest.appels.filter(a => a.chemin === `/guilds/${GUILD}/members/${J2}`).at(-1).corps, { channel_id: salon });
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J2, salon, 'Nox', [R1]));
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(COACH, HUB_T, 'Zed', [R2]));
  assert.equal(creationsT(k.rest).length, 2);
  assert.equal(creationsT(k.rest)[1].corps.name, 'BRV — Bravo');
  // Les joueurs ne peuvent ni déverrouiller ni renommer ; ils peuvent expulser.
  const clic = (id, extra = {}) => ({ type: 3, guild_id: GUILD, channel_id: salon, locale: 'fr', member: { user: { id: J1 }, roles: [R1], permissions: '0' }, data: { custom_id: id, ...extra } });
  assert.match((await k.bot.interaction(clic(`vc:u:${salon}`))).data.content, /reste verrouillé sur le rôle de l’équipe/);
  assert.match((await k.bot.interaction(clic(`vc:r:${salon}`))).data.content, /nom d’un salon d’équipe de tournoi est fixe/);
  const voc = { type: 2, guild_id: GUILD, channel_id: salon, locale: 'fr', member: { user: { id: J1 }, roles: [R1], permissions: '0' }, data: { name: 'voc', options: [{ type: 1, name: 'deverrouiller', options: [] }] } };
  assert.match((await k.bot.interaction(voc)).data.content, /reste verrouillé/);
  assert.match((await k.bot.interaction(clic(`vc:ks:${salon}`, { values: [J2] }))).data.content, /expulsé/);
  // Verrouiller (recalcul des surcharges) garde le rôle de l'équipe et les casters.
  await k.bot.interaction(clic(`vc:l:${salon}`));
  const patch = k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1);
  assert.ok([R1, CASTER].every(id => BigInt(patch.corps.permission_overwrites.find(o => o.id === id).allow) & PV_CONNECT));
  k.moteur.arreter();
});

test('fin du tournoi : rôles et salons des équipes supprimés ensemble', async () => {
  const k = await monterHub();
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, HUB_T, 'Kira', [R1]));
  const salon = [...k.rest.etat.salons.values()].find(s => s.name === 'LZ0 — Ligne Zéro').id;
  const { nettoyerTournoi } = await import('../noyau/vocaux/tournoi.mjs');
  const r = await nettoyerTournoi({ base: k.base, fetch: k.rest.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', guildId: GUILD, maintenant: () => Date.now() }, TOURNOI);
  assert.deepEqual([r.roles, r.salons, r.echecs.length], [2, 1, 0]);
  assert.ok(!k.rest.etat.salons.has(salon));
  assert.equal(k.rest.etat.roles.size, 0);
  assert.equal((await k.base.tous('SELECT * FROM vocaux_salons', [])).length, 0);
  k.moteur.arreter();
});

test('application : hub lié à un tournoi (tournoi existant exigé), tournois proposés', async () => {
  const k = await monter();
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Ligne Zéro', tag: 'LZ0' } });
  const r0 = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: true, hubs: [{ id: HUB_T, tournoiId: TOURNOI }] } });
  assert.equal(r0.statut, 400, 'tournoi inconnu');
  const c = await k.api('/vocaux/config');
  assert.deepEqual(c.corps.tournois.map(t => t.nom), ['The Nuke End']);
  const r = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: true, hubs: [{ id: HUB_T, tournoiId: k.tournoiId, rolesAutorises: [CASTER], verrouille: false }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual([r.corps.reglages.hubs[0].verrouille, r.corps.reglages.hubs[0].modeleNom, r.corps.reglages.hubs[0].rolesAutorises], [true, '{tag} — {nom}', [CASTER]]);
  assert.deepEqual((await k.api(k.chemin)).corps.hubs.map(h => h.id), [HUB_T]);
});
