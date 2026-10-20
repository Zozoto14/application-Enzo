/**
 * Discord (phase 4), parties pures : chiffrement du webhook, validation et
 * masquage de l'adresse, modèles et variables, neutralisation des mentions,
 * charge envoyée à Discord, catalogue. Aucun réseau, aucune base.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chiffrerWebhook, dechiffrerWebhook, finDeWebhook, masquerWebhook, validerUrlWebhook } from '../noyau/discord/chiffrement.mjs';
import { CLES_EVENEMENTS_DISCORD, EVENEMENTS_DISCORD, TYPES_DISCORD, clesPourType } from '../noyau/discord/catalogue.mjs';
import { TYPES_EVENEMENTS } from '../noyau/evenements.mjs';
import { construireCharge, lireRoleMention, nettoyerTexteDiscord, rendreModele, validerModele, variablesDuModele } from '../noyau/discord/messages.mjs';
import { formaterDelai, formaterInstant, posterWebhook } from '../noyau/discord/file.mjs';

import { ID, JETON, URL_TEST } from './discord-aide.mjs';
const SECRET = 'secret-de-test-esport-0123456789abcdef-xyz';
const TEAM = '11111111-1111-4111-8111-111111111111';

// ------------------------------------------------------------------ Chiffrement

test('chiffrement : aller-retour, l’adresse n’apparaît pas dans le chiffré, IV différent à chaque fois', async () => {
  const a = await chiffrerWebhook(SECRET, TEAM, URL_TEST);
  const b = await chiffrerWebhook(SECRET, TEAM, URL_TEST);
  assert.match(a, /^dw1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b, 'IV aléatoire');
  assert.ok(!a.includes(JETON) && !a.includes(ID) && !a.includes('discord'));
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, a), URL_TEST);
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, b), URL_TEST);
});

test('chiffrement : mauvaise clé, autre team, chiffré altéré ou mal formé → illisible', async () => {
  const a = await chiffrerWebhook(SECRET, TEAM, URL_TEST);
  assert.equal(await dechiffrerWebhook(`${SECRET}-autre`, TEAM, a), undefined, 'autre secret');
  assert.equal(await dechiffrerWebhook(SECRET, '22222222-2222-4222-8222-222222222222', a), undefined, 'copié dans une autre team');
  const [v, iv, c] = a.split('.');
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, `${v}.${iv}.${c.slice(0, -2)}AA`), undefined, 'altéré');
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, `dw2.${iv}.${c}`), undefined, 'version inconnue');
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, 'n’importe quoi'), undefined);
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, null), undefined);
});

test('chiffrement : secret absent ou trop court → erreur de configuration (503), jamais de repli en clair', async () => {
  for (const secret of [undefined, '', 'court']) {
    await assert.rejects(chiffrerWebhook(secret, TEAM, URL_TEST), e => e.statut === 503 && e.code === 'non-configure');
  }
});

test('chiffrement : la clé AES est dérivée (contexte dédié), sans rapport avec la clé de session', async () => {
  const sujet = new TextEncoder().encode(SECRET);
  const hmac = await globalThis.crypto.subtle.importKey('raw', sujet, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  assert.ok(hmac, 'même secret, usage HMAC possible');
  const a = await chiffrerWebhook(SECRET, TEAM, URL_TEST);
  // Un secret séparé (CLE_DISCORD) donne une autre clé : l’ancien chiffré ne s’ouvre plus avec CLE_ESPORT seule.
  const b = await chiffrerWebhook(`${SECRET}-discord`, TEAM, URL_TEST);
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, b), undefined);
  assert.equal(await dechiffrerWebhook(`${SECRET}-discord`, TEAM, b), URL_TEST);
  assert.equal(await dechiffrerWebhook(SECRET, TEAM, a), URL_TEST);
});

// ------------------------------------------------------------------ Adresse

test('validation d’adresse : discord.com et discordapp.com acceptés (avec canary, ptb et version d’API)', () => {
  for (const url of [
    URL_TEST,
    `https://discordapp.com/api/webhooks/${ID}/${JETON}`,
    `https://canary.discord.com/api/webhooks/${ID}/${JETON}`,
    `https://ptb.discordapp.com/api/webhooks/${ID}/${JETON}`,
    `https://discord.com/api/v10/webhooks/${ID}/${JETON}`,
    `  ${URL_TEST}\n`,
  ]) {
    assert.equal(validerUrlWebhook(url), url.trim(), url);
  }
});

test('validation d’adresse : tout le reste est refusé, sans répéter la saisie', () => {
  const refusees = [
    undefined,
    null,
    '',
    42,
    {},
    URL_TEST.replace('https', 'http'),
    URL_TEST.replace('discord.com', 'discord.com.evil.example'),
    URL_TEST.replace('https://', 'https://discord.com@evil.example/#'),
    `https://evil.example/https://discord.com/api/webhooks/${ID}/${JETON}`,
    `${URL_TEST}?wait=true`,
    `${URL_TEST}#x`,
    `${URL_TEST}/`,
    `${URL_TEST}/slack`,
    `https://discord.com/api/webhooks/${ID}`,
    `https://discord.com/api/webhooks/abc/${JETON}`,
    `https://discord.com/api/webhooks/${ID}/court`,
    `https://discord.com/api/channels/${ID}/${JETON}`,
    `https://notdiscord.com/api/webhooks/${ID}/${JETON}`,
    `https://discord.com:8443/api/webhooks/${ID}/${JETON}`,
    'javascript:alert(1)',
    `https://discord.com/api/webhooks/${ID}/${JETON}${'a'.repeat(300)}`,
  ];
  for (const saisie of refusees) {
    assert.throws(
      () => validerUrlWebhook(saisie),
      e => e.statut === 400 && e.code === 'webhook-url' && !String(e.message).includes('evil') && !String(e.message).includes(JETON),
      String(saisie).slice(0, 60),
    );
  }
});

test('masquage : « …/ » suivi des 4 derniers caractères du jeton, jamais l’adresse', () => {
  assert.equal(masquerWebhook(URL_TEST), '…/abcd');
  assert.equal(finDeWebhook(URL_TEST), 'abcd');
  assert.equal(masquerWebhook('abcd'), '…/abcd');
  assert.ok(!masquerWebhook(URL_TEST).includes(ID));
});

// ------------------------------------------------------------------ Mentions

test('mentions : @everyone, @here et mentions <@…> neutralisées dans tout texte', () => {
  const ZERO = '​';
  const brut = 'Salut @everyone et @HERE, <@123456> <@!123456> <@&987654> <#555666> </cmd:1> <id:guide>';
  const net = nettoyerTexteDiscord(brut, 500);
  assert.ok(!/@everyone/i.test(net) && !/@here/i.test(net), net);
  assert.ok(!/<@/.test(net) && !/<#/.test(net) && !/<\//.test(net) && !/<id:/.test(net), net);
  assert.ok(net.includes(ZERO));
  // Longueur limitée, avec une ellipse ; contrôles retirés.
  assert.equal(nettoyerTexteDiscord('a'.repeat(50), 10).length, 10);
  assert.ok(nettoyerTexteDiscord('a'.repeat(50), 10).endsWith('…'));
  assert.equal(nettoyerTexteDiscord('a\u0000b‮c\r\nd', 20), 'abc\nd');
});

test('mention de rôle : identifiant numérique seulement ; @everyone, @here, texte ou court refusés', () => {
  assert.equal(lireRoleMention(undefined), null);
  assert.equal(lireRoleMention(null), null);
  assert.equal(lireRoleMention('  '), null);
  assert.equal(lireRoleMention(' 987654321012345678 '), '987654321012345678');
  for (const saisie of ['@everyone', '@here', 'everyone', '<@&987654321>', '@&987654321', '1234', '12345678901234567890123456', '123 456', 'abc123456']) {
    assert.throws(() => lireRoleMention(saisie), e => e.statut === 400 && e.code === 'role-mention', saisie);
  }
});

test('charge Discord : sans rôle, aucune mention ne notifie ; avec rôle, seul ce rôle est autorisé', () => {
  let c = construireCharge('Bonjour @everyone <@&111222333> <@42424>', { nomTeam: 'Les @everyone' });
  assert.deepEqual(c.allowed_mentions, { parse: [] });
  assert.ok(!/@everyone/i.test(c.content) && !/<@/.test(c.content));
  assert.ok(!/@everyone/i.test(c.username));
  c = construireCharge('Match ce soir', { roleId: '987654321012345678' });
  assert.equal(c.content, '<@&987654321012345678> Match ce soir');
  assert.deepEqual(c.allowed_mentions, { parse: [], roles: ['987654321012345678'] });
  // Un identifiant qui n’est pas numérique ne passe jamais (défense en profondeur, même si la base était altérée).
  c = construireCharge('x', { roleId: 'everyone' });
  assert.deepEqual(c.allowed_mentions, { parse: [] });
  assert.ok(!c.content.includes('<@&'));
  // Longueur : 2000 caractères au plus, mention comprise.
  c = construireCharge('é'.repeat(5000), { roleId: '987654321012345678' });
  assert.ok(c.content.length <= 2000);
  assert.equal(construireCharge('   ').content, 'Notification Esport');
});

// ------------------------------------------------------------------ Modèles et variables

test('modèles : variables remplacées, valeurs nettoyées (une ligne, courtes, sans mention)', () => {
  assert.deepEqual(variablesDuModele('{titre} {date} {titre} {x}'), ['titre', 'date', 'x']);
  assert.equal(rendreModele('{titre} le {date} à {heure}', { titre: 'Scrim', date: 'mardi 21 octobre', heure: '20:30' }), 'Scrim le mardi 21 octobre à 20:30');
  const rendu = rendreModele('Titre : {titre}', { titre: 'Bonjour @everyone\n<@&123456>\nligne 3' });
  assert.ok(!rendu.includes('\n') && !/@everyone/.test(rendu) && !/<@/.test(rendu), rendu);
  assert.equal(rendreModele('{titre}', { titre: 'x'.repeat(1000) }).length, 200);
  assert.equal(rendreModele('Voir {lien} fin', { lien: '' }), 'Voir fin', 'variable vide : espaces resserrés');
  assert.equal(rendreModele('a {inconnue} b', {}), 'a b');
  assert.equal(rendreModele('ligne 1\nligne 2', {}), 'ligne 1\nligne 2', 'les retours à la ligne du modèle sont gardés');
});

test('modèles : variables inconnues refusées avec la liste des permises ; vide = modèle par défaut ; longueur limitée', () => {
  assert.equal(validerModele('event_created', undefined), null);
  assert.equal(validerModele('event_created', null), null);
  assert.equal(validerModele('event_created', '   '), null);
  assert.equal(validerModele('event_created', ' Nouveau : {titre} à {heure} '), 'Nouveau : {titre} à {heure}');
  assert.throws(
    () => validerModele('event_created', 'Salut {pirate} et {titre}'),
    e => e.statut === 400 && e.code === 'variable-inconnue' && e.details.inconnues.join() === 'pirate' && e.details.permises.includes('titre'),
  );
  // Une variable d’un autre type de message n’est pas permise.
  assert.throws(() => validerModele('event_created', '{assigne}'), e => e.code === 'variable-inconnue');
  assert.throws(() => validerModele('event_created', 'x'.repeat(501)), e => e.code === 'modele-long');
  assert.throws(() => validerModele('inconnu', 'x'), e => e.statut === 404);
  // Les mentions du modèle sont neutralisées à l’enregistrement : seule la mention de rôle configurée existe.
  const m = validerModele('event_created', '@everyone {titre}');
  assert.ok(!/@everyone/.test(m));
});

test('catalogue : chaque modèle par défaut est valide, chaque type de message a son événement de domaine connu du bus', () => {
  assert.equal(new Set(CLES_EVENEMENTS_DISCORD).size, CLES_EVENEMENTS_DISCORD.length);
  for (const d of EVENEMENTS_DISCORD) {
    assert.equal(validerModele(d.cle, d.modele), d.modele, d.cle);
    assert.ok(d.modele.length <= 500);
    for (const t of d.types) {
      // `review.created` vient de la phase 5 (module Review vidéo) : il n’existe qu’avec elle.
      if (t !== 'review.created') assert.ok(TYPES_EVENEMENTS.includes(t), `${d.cle} : ${t}`);
    }
    for (const m of d.modules) assert.match(m, /^[a-z_]+$/);
  }
  for (const t of TYPES_DISCORD) assert.ok(TYPES_EVENEMENTS.includes(t), t);
  assert.deepEqual(clesPourType('event.created'), ['event_created']);
  assert.deepEqual(clesPourType('rien.du.tout'), []);
  // Le contrat de la liste du plan (7.10).
  for (const cle of ['event_created', 'reminder_d1', 'reminder_h1', 'rsvp_missing', 'summary_published', 'summary_submitted', 'task_assigned', 'task_due', 'member_joined', 'role_changed', 'review_created']) {
    assert.ok(CLES_EVENEMENTS_DISCORD.includes(cle), cle);
  }
  assert.deepEqual(EVENEMENTS_DISCORD.find(d => d.cle === 'review_created').modules, ['video_review']);
});

test('dates des messages : fuseau de la team, délais lisibles', () => {
  const t = formaterInstant('Europe/Paris', '2026-10-21T18:30:00.000Z');
  assert.equal(t.heure, '20:30');
  assert.match(t.date, /mercredi 21 octobre/);
  assert.equal(formaterInstant('Fuseau/Inconnu', '2026-10-21T18:30:00.000Z').heure, '18:30');
  assert.deepEqual(formaterInstant('Europe/Paris', 'pas une date'), { date: '', heure: '' });
  assert.equal(formaterDelai(30_000), 'maintenant');
  assert.equal(formaterDelai(45 * 60_000), 'dans 45 min');
  assert.equal(formaterDelai(20 * 3_600_000), 'dans 20 h');
  assert.equal(formaterDelai(72 * 3_600_000), 'dans 3 jours');
});

// ------------------------------------------------------------------ Envoi HTTP (fetch simulé)

const reponse = (statut, corps, entetes = {}) => new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: entetes });

test('envoi : 204 réussit ; 5xx et réseau sont à réessayer ; 404 et 400 sont définitifs ; aucune redirection suivie', async () => {
  const appels = [];
  const faux = suite => async (url, init) => {
    appels.push({ url, init });
    const r = suite.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  assert.deepEqual(await posterWebhook(faux([reponse(204)]), URL_TEST, { content: 'x' }), { ok: true, statut: 204 });
  assert.equal(appels[0].url, URL_TEST);
  assert.equal(appels[0].init.method, 'POST');
  assert.equal(appels[0].init.redirect, 'manual');
  assert.deepEqual(JSON.parse(appels[0].init.body), { content: 'x' });
  let r = await posterWebhook(faux([reponse(503, { message: URL_TEST })]), URL_TEST, {});
  assert.deepEqual([r.ok, r.statut, r.definitif], [false, 503, false]);
  assert.ok(!JSON.stringify(r).includes(JETON), 'la réponse de Discord n’est jamais reprise');
  r = await posterWebhook(faux([new TypeError('fetch failed')]), URL_TEST, {});
  assert.deepEqual([r.statut, r.definitif], [0, false]);
  assert.ok(!JSON.stringify(r).includes('fetch failed'));
  r = await posterWebhook(faux([reponse(404, { code: 10015 })]), URL_TEST, {});
  assert.deepEqual([r.definitif, r.webhookPerdu], [true, true]);
  r = await posterWebhook(faux([reponse(400, { message: 'bad' })]), URL_TEST, {});
  assert.deepEqual([r.definitif, r.webhookPerdu ?? false], [true, false]);
  r = await posterWebhook(faux([reponse(302, undefined, { Location: 'https://evil.example' })]), URL_TEST, {});
  assert.deepEqual([r.ok, r.definitif], [false, true], 'une redirection est refusée (4xx/3xx définitif)');
});

test('envoi : 429 lit retry_after (corps) et Retry-After (en-tête), le plus long gagne, borné à 1 h', async () => {
  const f = r => async () => r;
  let r = await posterWebhook(f(reponse(429, { retry_after: 2.4, global: false })), URL_TEST, {});
  assert.deepEqual([r.statut, r.retryApresS], [429, 3]);
  r = await posterWebhook(f(reponse(429, { retry_after: 1 }, { 'Retry-After': '9' })), URL_TEST, {});
  assert.equal(r.retryApresS, 9);
  r = await posterWebhook(f(new Response('pas du json', { status: 429 })), URL_TEST, {});
  assert.equal(r.retryApresS, 1, 'au moins une seconde');
  r = await posterWebhook(f(reponse(429, { retry_after: 99999 })), URL_TEST, {});
  assert.equal(r.retryApresS, 3600);
});
