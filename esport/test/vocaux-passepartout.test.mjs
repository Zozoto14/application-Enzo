/**
 * Rôle Goat / rôles passe-partout des salons vocaux (docs/esport/vocaux.md, « Accès à toutes les vocs ») : création du
 * rôle SANS permission, surcharges (voir, se connecter, parler, partager l'écran, détection de la voix, rien d'autre) sur
 * les salons du bot (temporaires, verrouillés, équipe, staff, hubs cachés) et sur tout salon vocal du serveur, nouveaux
 * salons, dérive, retrait qui rend l'état d'origine, travail borné. Faux Discord, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets, fauxDiscordRest } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerMoteurVocaux } from '../noyau/vocaux/moteur.mjs';
import { validerVocaux, VOCAUX_DEFAUT } from '../noyau/vocaux/reglages.mjs';
import { DROITS_PASSE_PARTOUT, PV, surchargesSalon } from '../noyau/vocaux/salons.mjs';
import { surchargesHubMasque } from '../noyau/vocaux/hubs.mjs';
import { LIMITE_REQUETES, lireSuivi, synchroniserPasse } from '../noyau/vocaux/passepartout.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const CAT = '710000000000000050';
const HUB = '710000000000000051';
const V1 = '710000000000000061';
const V2 = '710000000000000062';
const SCENE = '710000000000000063';
const TEXTE = '710000000000000064';
const GOAT = '720000000000000777';
const AUTRE = '720000000000000888';
const STAFF = '720000000000000001';
const U1 = '810000000000000001';
const silencieux = { error() {}, warn() {}, info() {} };
const VC = PV.VOIR | PV.CONNECTER;
const ADMIN = 1n << 3n;
const MUTE = 1n << 22n;
const DEAFEN = 1n << 23n;
const INTERDITS = ADMIN | PV.GERER_SALONS | PV.DEPLACER | MUTE | DEAFEN | PV.GERER_ROLES | (1n << 5n) /* gérer le serveur */;
const a = (o, id) => BigInt(o.find(x => x.id === id)?.allow ?? '0');
const d = (o, id) => BigInt(o.find(x => x.id === id)?.deny ?? '0');
const ov = (etat, id) => etat.salons.get(id).permission_overwrites ?? [];

test('droits du passe-partout : voir, se connecter, parler, partager l’écran, détection de la voix, jamais d’administration ni de déplacement', () => {
  assert.equal(DROITS_PASSE_PARTOUT, PV.VOIR | PV.CONNECTER | PV.PARLER | PV.FLUX | PV.VAD);
  assert.equal(DROITS_PASSE_PARTOUT & INTERDITS, 0n);
});

test('réglages : rôles passe-partout (liste d’identifiants), option « tous les salons » activée par défaut', () => {
  const s = validerVocaux({ rolesPassePartout: [GOAT, GOAT, AUTRE] }, { ...VOCAUX_DEFAUT });
  assert.deepEqual(s.rolesPassePartout, [GOAT, AUTRE]);
  assert.equal(s.passePartoutTous, true);
  assert.equal(validerVocaux({ passePartoutTous: false }, s).passePartoutTous, false);
  assert.throws(() => validerVocaux({ rolesPassePartout: ['pas-un-id'] }, s), /Liste d’identifiants/);
});

test('salon du bot : le passe-partout entre partout (ouvert, verrouillé, équipe, staff) sans rien d’autre que ses droits', () => {
  const base = [{ id: GUILD, type: 0, allow: '0', deny: String(PV.VOIR) }, { id: GOAT, type: 0, allow: '0', deny: String(VC) }];
  const ctx = { guildId: GUILD, botId: BOT, rolesStaff: [STAFF], rolesPasse: [GOAT] };
  const cas = {
    ouvert: { verrouille: false, proprietaireId: U1, amis: [], basePermissions: base },
    verrouille: { verrouille: true, proprietaireId: U1, amis: [], basePermissions: base },
    equipe: { verrouille: true, equipeId: 'e1', tournoiId: 't1', proprietaireId: U1, amis: [], basePermissions: base },
    staff: { verrouille: true, equipeId: null, tournoiId: 't1', proprietaireId: U1, amis: [], basePermissions: base },
  };
  for (const [nom, s] of Object.entries(cas)) {
    for (const visible of [false, true]) {
      const o = surchargesSalon(s, { ...ctx, rolesEquipe: ['720000000000000123'], visibleNonJoignable: visible });
      assert.equal(a(o, GOAT), DROITS_PASSE_PARTOUT, `${nom} : droits exacts`);
      assert.equal(d(o, GOAT) & DROITS_PASSE_PARTOUT, 0n, `${nom} : aucun refus restant (même copié du hub)`);
      assert.equal(a(o, GOAT) & INTERDITS, 0n, `${nom} : jamais d’administration`);
    }
  }
  // Verrouillé : @everyone refusé, le passe-partout entre quand même.
  const o = surchargesSalon(cas.verrouille, ctx);
  assert.equal(d(o, GUILD) & VC, VC);
  assert.equal(a(o, GOAT) & VC, VC);
  // @everyone n'est jamais traité comme un rôle passe-partout.
  assert.equal(a(surchargesSalon(cas.ouvert, { ...ctx, rolesPasse: [GUILD] }), GUILD), 0n);
  // Hub caché : visible et joignable pour le passe-partout.
  const h = surchargesHubMasque([], { guildId: GUILD, botId: BOT, admis: [STAFF], rolesPasse: [GOAT] });
  assert.equal(d(h, GUILD) & PV.VOIR, PV.VOIR);
  assert.equal(a(h, GOAT), DROITS_PASSE_PARTOUT);
});

async function application() {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  const s = k.discord.etat.salons;
  s.set(CAT, { id: CAT, type: 4, name: 'Vocaux', guild_id: k.GUILD, position: 2, permission_overwrites: [] });
  s.set(HUB, { id: HUB, type: 2, name: 'Créer un salon', guild_id: k.GUILD, parent_id: CAT, position: 3, permission_overwrites: [] });
  // V1 : surcharge existante du rôle (voir autorisé, parler refusé) ; V2 : aucune ; scène et texte.
  s.set(V1, { id: V1, type: 2, name: 'Général', guild_id: k.GUILD, parent_id: CAT, position: 4, permission_overwrites: [{ id: GOAT, type: 0, allow: String(PV.VOIR), deny: String(PV.PARLER) }, { id: STAFF, type: 0, allow: '1024', deny: '0' }] });
  s.set(V2, { id: V2, type: 2, name: 'Chill', guild_id: k.GUILD, parent_id: CAT, position: 5, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: String(VC) }] });
  s.set(SCENE, { id: SCENE, type: 13, name: 'Scène', guild_id: k.GUILD, parent_id: CAT, position: 6, permission_overwrites: [] });
  s.set(TEXTE, { id: TEXTE, type: 0, name: 'général-texte', guild_id: k.GUILD, parent_id: CAT, position: 7, permission_overwrites: [] });
  return k;
}
const puts = (k, id) => k.discord.appels.filter(x => (x.methode === 'PUT' || x.methode === 'DELETE') && x.chemin.startsWith(`/channels/${id}/permissions/`));
const config = async k => (await k.api('/vocaux/config')).corps;

test('créer le rôle Goat : aucune permission, non affiché à part, non mentionnable, sous le bot ; ajouté à la liste et appliqué', async () => {
  const k = await application();
  const r = await k.api('/vocaux/goat', undefined, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const creation = k.discord.appels.find(x => x.methode === 'POST' && x.chemin === `/guilds/${k.GUILD}/roles`);
  assert.deepEqual(creation.corps, { name: 'Goat', permissions: '0', color: 0xf1c40f, hoist: false, mentionable: false });
  const id = r.corps.roleCree.id;
  assert.equal(r.corps.roleCree.nom, 'Goat');
  assert.deepEqual(r.corps.reglages.rolesPassePartout, [id]);
  // Placé sous le rôle du bot (position 3 dans le faux serveur → 2).
  const pos = k.discord.appels.find(x => x.methode === 'PATCH' && x.chemin === `/guilds/${k.GUILD}/roles`);
  assert.deepEqual(pos.corps, [{ id, position: 2 }]);
  assert.equal(r.corps.roleCree.positionne, true);
  // Appliqué tout de suite aux salons vocaux (option « tous » par défaut), texte exclu.
  for (const salon of [HUB, V1, V2, SCENE]) assert.equal(a(ov(k.discord.etat, salon), id) & DROITS_PASSE_PARTOUT, DROITS_PASSE_PARTOUT, salon);
  assert.equal(puts(k, TEXTE).length, 0);
  assert.equal(r.corps.etat.passePartout.echecs.length, 0);
  assert.equal(r.corps.etat.passePartout.cibles, 4);
  assert.equal(r.corps.etat.passePartout.couverts, 4);
  // Nom et couleur modifiables ; couleur invalide refusée.
  const r2 = await k.api('/vocaux/goat', undefined, { methode: 'POST', corps: { nom: 'Légende @everyone', couleur: '#ff8800' } });
  assert.equal(r2.statut, 200, JSON.stringify(r2.corps));
  const c2 = k.discord.appels.filter(x => x.methode === 'POST' && x.chemin === `/guilds/${k.GUILD}/roles`).at(-1).corps;
  assert.deepEqual([c2.name, c2.color, c2.permissions], ['Légende everyone', 0xff8800, '0']);
  assert.equal((await k.api('/vocaux/goat', undefined, { methode: 'POST', corps: { couleur: 'rouge' } })).statut, 400);
  // Sans la permission : refus.
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api('/vocaux/goat', voir.jeton, { methode: 'POST', corps: {} })).statut, 403);
});

test('tous les salons vocaux du serveur : surcharge du rôle seulement, d’autres surcharges intactes ; retrait : état d’origine rendu', async () => {
  const k = await application();
  const r = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { rolesPassePartout: [GOAT] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  for (const salon of [HUB, V1, V2, SCENE]) {
    const o = ov(k.discord.etat, salon);
    assert.equal(a(o, GOAT) & DROITS_PASSE_PARTOUT, DROITS_PASSE_PARTOUT, salon);
    assert.equal(a(o, GOAT) & INTERDITS, 0n, `${salon} : aucun bit d’administration`);
    assert.equal(d(o, GOAT) & DROITS_PASSE_PARTOUT, 0n);
  }
  assert.ok(!puts(k, TEXTE).length, 'salon texte jamais touché');
  // Surcharge existante du rôle : voir gardé, « parler » n'est plus refusé ; autres rôles et @everyone intacts.
  assert.equal(a(ov(k.discord.etat, V1), STAFF), 1024n);
  assert.deepEqual(ov(k.discord.etat, V2).find(o => o.id === GUILD), { id: GUILD, type: 0, allow: '0', deny: String(VC) });
  assert.equal(r.corps.etat.passePartout.ajoutes, 4);
  assert.equal(Object.keys(await lireSuivi(k.b.base)).length, 4);
  // Déjà en place : rien de plus n'est envoyé.
  const avant = k.discord.appels.length;
  await k.api('/vocaux/passe-partout/synchroniser', undefined, { methode: 'POST', corps: {} });
  assert.equal(k.discord.appels.slice(avant).filter(x => x.methode === 'PUT').length, 0);
  // Le rôle quitte la liste : états d'origine rendus (V1 : voir autorisé, parler refusé ; V2 : plus de surcharge du rôle).
  const r2 = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { rolesPassePartout: [] } });
  assert.equal(r2.statut, 200);
  const g1 = ov(k.discord.etat, V1).find(o => o.id === GOAT);
  assert.deepEqual([g1.allow, g1.deny], [String(PV.VOIR), String(PV.PARLER)]);
  for (const salon of [HUB, V2, SCENE]) assert.ok(!ov(k.discord.etat, salon).some(o => o.id === GOAT), salon);
  assert.deepEqual(ov(k.discord.etat, V2), [{ id: GUILD, type: 0, allow: '0', deny: String(VC) }]);
  assert.deepEqual(await lireSuivi(k.b.base), {});
});

test('option « tous les salons » coupée : seuls les hubs gardent l’accès, le reste est rendu', async () => {
  const k = await application();
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { rolesPassePartout: [GOAT] } });
  const r = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { passePartoutTous: false, hubs: [{ id: HUB }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(a(ov(k.discord.etat, HUB), GOAT) & DROITS_PASSE_PARTOUT, DROITS_PASSE_PARTOUT, 'hub : gardé');
  for (const salon of [V2, SCENE]) assert.ok(!ov(k.discord.etat, salon).some(o => o.id === GOAT), salon);
  assert.deepEqual(Object.keys(await lireSuivi(k.b.base)), [HUB]);
});

test('hub caché : le passe-partout le voit et le rejoint ; retiré de la liste, il ne reste rien', async () => {
  const k = await application();
  const R = '720000000000000088';
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, masquerHub: true, rolesHub: [R] }], rolesPassePartout: [GOAT] } });
  const o = ov(k.discord.etat, HUB);
  assert.equal(d(o, k.GUILD) & PV.VOIR, PV.VOIR, 'caché pour @everyone');
  assert.equal(a(o, GOAT) & DROITS_PASSE_PARTOUT, DROITS_PASSE_PARTOUT);
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { rolesPassePartout: [] } });
  assert.ok(!ov(k.discord.etat, HUB).some(x => x.id === GOAT));
});

async function moteurAvecGoat({ reglages = {}, vocaux = true } = {}) {
  const base = await baseMigree();
  const t = new Date().toISOString();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: false, guildId: GUILD, langue: 'fr' }), t]);
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['vocaux', JSON.stringify({ actif: vocaux, hubs: [{ id: HUB, nom: 'Créer un salon', modeleNom: 'Salon de {pseudo}', verrouille: true }], rolesStaff: [STAFF], delaiSuppressionS: 5, maxParMembre: 1, rolesPassePartout: [GOAT], ...reglages }), t]);
  const rest = fauxDiscordRest();
  rest.etat.salons.set(CAT, { id: CAT, type: 4, name: 'Vocaux', guild_id: GUILD, position: 2, permission_overwrites: [] });
  rest.etat.salons.set(HUB, { id: HUB, type: 2, name: 'Créer un salon', guild_id: GUILD, parent_id: CAT, position: 3, permission_overwrites: [{ id: GOAT, type: 0, allow: '0', deny: String(VC) }] });
  rest.etat.salons.set(V1, { id: V1, type: 2, name: 'Général', guild_id: GUILD, parent_id: CAT, position: 4, permission_overwrites: [] });
  const moteur = creerMoteurVocaux({ base, fetch: rest.fetch, jetonBot: JETON, botId: () => BOT, delaiMs: 60, journal: silencieux });
  await moteur.evenement('GUILD_CREATE', { id: GUILD, channels: [...rest.etat.salons.values()], voice_states: [], members: [] });
  await moteur.attendre();
  return { base, rest, moteur };
}
const vs = (userId, channelId) => ({ guild_id: GUILD, user_id: userId, channel_id: channelId, member: { user: { id: userId, username: 'lea' }, nick: 'Léa', roles: [] } });
const putsM = (rest, id) => rest.appels.filter(x => (x.methode === 'PUT' || x.methode === 'DELETE') && x.chemin.startsWith(`/channels/${id}/permissions/`));

test('connexion : salons existants rattrapés (même un hub qui refusait le rôle) ; salon texte jamais touché', async () => {
  const k = await moteurAvecGoat();
  for (const id of [HUB, V1]) assert.equal(a(k.rest.etat.salons.get(id).permission_overwrites, GOAT) & DROITS_PASSE_PARTOUT, DROITS_PASSE_PARTOUT, id);
  assert.equal(d(k.rest.etat.salons.get(HUB).permission_overwrites, GOAT) & DROITS_PASSE_PARTOUT, 0n, 'le refus du hub est levé pour ce rôle');
  const etat = JSON.parse((await k.base.premier("SELECT valeur FROM tickets_etat WHERE cle = 'vocaux'", [])).valeur);
  assert.equal(etat.passePartout.cibles, 2);
  assert.deepEqual(etat.passePartout.echecs, []);
  k.moteur.arreter();
});

test('salon temporaire verrouillé créé par le bot : le passe-partout y est déjà admis à la création ; membre déplacé', async () => {
  const k = await moteurAvecGoat();
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB));
  await k.moteur.attendre();
  const cree = k.rest.appels.find(x => x.methode === 'POST' && x.chemin === `/guilds/${GUILD}/channels`);
  const o = cree.corps.permission_overwrites;
  assert.equal(d(o, GUILD) & VC, VC, 'salon verrouillé');
  assert.equal(a(o, GOAT), DROITS_PASSE_PARTOUT);
  assert.equal(a(o, GOAT) & INTERDITS, 0n);
  k.moteur.arreter();
});

test('création refusée (permissions du bot manquantes) : nouvel essai sans le passe-partout plutôt que pas de salon', async () => {
  const k = await moteurAvecGoat();
  k.rest.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${GUILD}/channels`, statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB));
  await k.moteur.attendre();
  const essais = k.rest.appels.filter(x => x.methode === 'POST' && x.chemin === `/guilds/${GUILD}/channels`);
  assert.equal(essais.length, 2);
  assert.ok(essais[0].corps.permission_overwrites.some(x => x.id === GOAT));
  assert.ok(a(essais[1].corps.permission_overwrites, STAFF) & VC, 'second essai : surcharges ordinaires du salon (staff admis)');
  assert.equal((await k.base.tous('SELECT salon_id FROM vocaux_salons', [])).length, 1, 'le salon existe');
  k.moteur.arreter();
});

test('nouveau salon vocal créé par une personne (CHANNEL_CREATE) : accès posé tout de suite ; texte ou option coupée : rien', async () => {
  const k = await moteurAvecGoat();
  const N = '710000000000000070';
  const nouveau = { id: N, type: 2, name: 'Nouveau', guild_id: GUILD, parent_id: CAT, position: 9, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: String(VC) }] };
  k.rest.etat.salons.set(N, structuredClone(nouveau));
  await k.moteur.evenement('CHANNEL_CREATE', nouveau);
  await k.moteur.attendre();
  const p = putsM(k.rest, N);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].corps, { type: 0, allow: DROITS_PASSE_PARTOUT.toString(), deny: '0' });
  assert.equal(p[0].chemin, `/channels/${N}/permissions/${GOAT}`);
  // Salon écrit : ignoré.
  await k.moteur.evenement('CHANNEL_CREATE', { id: TEXTE, type: 0, name: 'x', guild_id: GUILD, permission_overwrites: [] });
  await k.moteur.attendre();
  assert.equal(putsM(k.rest, TEXTE).length, 0);
  k.moteur.arreter();

  const k2 = await moteurAvecGoat({ reglages: { passePartoutTous: false } });
  await k2.moteur.evenement('CHANNEL_CREATE', nouveau);
  await k2.moteur.attendre();
  assert.equal(putsM(k2.rest, N).length, 0, 'option coupée : seuls les hubs');
  k2.moteur.arreter();
});

test('dérive : surcharge retirée à la main, rattrapée au passage périodique ; refus de Discord notés et non réessayés tout de suite', async () => {
  const k = await moteurAvecGoat();
  const avant = putsM(k.rest, V1).length;
  // Retrait à la main (CHANNEL_UPDATE avec le cache de la Gateway à jour).
  const sans = { ...k.rest.etat.salons.get(V1), permission_overwrites: [] };
  k.rest.etat.salons.set(V1, sans);
  await k.moteur.evenement('CHANNEL_UPDATE', structuredClone(sans));
  await k.moteur.passage();
  await k.moteur.attendre();
  assert.equal(putsM(k.rest, V1).length, avant + 1);
  // Discord refuse sur un salon (le bot n'y gère pas les permissions) : noté, les autres salons continuent.
  const N = '710000000000000071';
  const ferme = { id: N, type: 2, name: 'Réservé', guild_id: GUILD, parent_id: CAT, position: 9, permission_overwrites: [] };
  k.rest.etat.salons.set(N, structuredClone(ferme));
  k.rest.programme.push({ si: (m, c) => m === 'PUT' && c.startsWith(`/channels/${N}/permissions/`), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  await k.moteur.evenement('CHANNEL_CREATE', ferme);
  await k.moteur.attendre();
  const etat = JSON.parse((await k.base.premier("SELECT valeur FROM tickets_etat WHERE cle = 'vocaux'", [])).valeur);
  assert.deepEqual(etat.passePartout.echecs, [{ id: N, nom: 'Réservé', statut: 403, code: 50013 }]);
  // Alerte pour ceux qui configurent les salons vocaux (notification `vocal-alerte`) : accès passe-partout refusé.
  const alerte = await k.base.tous("SELECT entite_id, charge FROM evenements WHERE type = 'alerte.vocal'", []);
  assert.equal(alerte.length, 1);
  assert.equal(alerte[0].entite_id, 'vocal:passe-partout:hierarchie');
  assert.deepEqual([JSON.parse(alerte[0].charge).code, JSON.parse(alerte[0].charge).quoi, JSON.parse(alerte[0].charge).nombre], ['hierarchie', 'passe-partout', 1]);
  const essais = putsM(k.rest, N).length;
  await k.moteur.passage();
  await k.moteur.attendre();
  assert.equal(putsM(k.rest, N).length, essais, 'pas de nouvel essai avant 10 minutes');
  k.moteur.arreter();
});

test('travail borné : au plus LIMITE_REQUETES requêtes par passage, le reste au suivant ; arrêt au premier 429', async () => {
  const base = await baseMigree();
  const rest = fauxDiscordRest();
  const salons = [];
  for (let i = 0; i < 5; i++) {
    const id = `71000000000000${String(100 + i)}`;
    const salon = { id, type: 2, name: `v${i}`, guild_id: GUILD, permission_overwrites: [] };
    rest.etat.salons.set(id, salon);
    salons.push(salon);
  }
  const ctx = { base, fetch: rest.fetch, jetonBot: JETON, guildId: GUILD, botId: BOT, maintenant: () => Date.now(), journal: silencieux };
  const reglages = { ...VOCAUX_DEFAUT, hubs: [], rolesPassePartout: [GOAT, AUTRE], passePartoutTous: true };
  assert.ok(LIMITE_REQUETES >= 50);
  const b1 = await synchroniserPasse(ctx, reglages, { salons, limite: 4 });
  assert.equal(b1.ajoutes, 4);
  assert.ok(b1.reste > 0);
  const b2 = await synchroniserPasse(ctx, reglages, { salons, limite: 4 });
  const b3 = await synchroniserPasse(ctx, reglages, { salons, limite: 4 });
  assert.equal(b1.ajoutes + b2.ajoutes + b3.ajoutes, 10, '5 salons x 2 rôles, sans doublon');
  assert.equal(b3.reste, 0);
  // Premier 429 : arrêt, rien d'autre envoyé.
  const rest2 = fauxDiscordRest();
  const s2 = salons.map(s => ({ ...s, permission_overwrites: [] }));
  for (const s of s2) rest2.etat.salons.set(s.id, s);
  rest2.programme.push({ si: (m, c) => m === 'PUT', statut: 429, corps: { retry_after: 600, global: false }, entetes: { 'Retry-After': '600' } });
  const b4 = await synchroniserPasse({ ...ctx, fetch: rest2.fetch, base: await baseMigree() }, { ...reglages, rolesPassePartout: [GOAT] }, { salons: s2 });
  assert.equal(b4.limiteDebit, true);
  assert.equal(rest2.appels.filter(x => x.methode === 'PUT').length, 1);
});

test('rôle retiré de la liste : sa surcharge disparaît des salons temporaires ouverts, recalculée sans lui', async () => {
  const k = await application();
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, verrouille: true }], rolesPassePartout: [GOAT] } });
  const SALON = '910000000000000005';
  // Salon ouvert, dont la surcharge du hub (copiée à la création) incluait le passe-partout.
  k.discord.etat.salons.set(SALON, { id: SALON, type: 2, guild_id: k.GUILD, parent_id: CAT, permission_overwrites: [] });
  const t = new Date().toISOString();
  await k.b.base.executer("INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, verrouille, base_permissions, cree_le, maj_le) VALUES (?, ?, ?, ?, 1, ?, ?, ?)", [SALON, k.GUILD, HUB, U1, JSON.stringify([{ id: GOAT, type: 0, allow: DROITS_PASSE_PARTOUT.toString(), deny: '0' }]), t, t]);
  await k.api('/vocaux/passe-partout/synchroniser', undefined, { methode: 'POST', corps: {} });
  const patch = () => k.discord.appels.filter(x => x.methode === 'PATCH' && x.chemin === `/channels/${SALON}`);
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { rolesPassePartout: [] } });
  const o = patch().at(-1).corps.permission_overwrites;
  assert.ok(!o.some(x => x.id === GOAT), 'plus de surcharge du rôle');
  assert.equal(d(o, k.GUILD) & VC, VC, 'salon toujours verrouillé');
});
