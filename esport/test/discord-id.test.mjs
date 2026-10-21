/**
 * Discord ID des membres (migration 0015) : obligatoire à la création d'un compte Esport (« Créer un
 * compte », « Ajouter à une team », validation d'une demande), validé (17 à 20 chiffres), unique,
 * modifiable par le Fondateur SEUL (403 pour tout autre rôle, Propriétaire compris), visible dans
 * l'annuaire (badge « manquant » côté app), exporté (RGPD) et effacé avec le compte ; le bot pingue
 * les convoqués avec, la liaison /lier vérifiée primant. Récapitulatif e-mail (réglage, chiffrement,
 * envoi par la tâche cron vers un faux SMTP local).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { traiterFile } from '../noyau/discord/file.mjs';
import { membresTeam } from '../noyau/discord/convoques.mjs';
import { lireDiscordId } from '../noyau/discordId.mjs';
import { tacheRecap } from '../noyau/recap.mjs';
import { configSmtp, creerEnvoyeur } from '../serveur/courriel-smtp.mjs';
import { decoderMessage, fauxSmtp } from '../../relais/test-smtp/faux-smtp.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';

const APP = '424242424242424242';
const JETON_BOT = 'jeton-bot-de-test-jamais-reel';
const G1 = '700000000000000001';
const SALON = '710000000000000001';
const ID = { lea: '412345678901234567', tom: '412345678901234568', tomLier: '800000000000000002', zoe: '412345678901234570', admin: '800000000000000009' };
const MEMBRES = { bob12345: { pseudo: 'Bob', role: 'proprietaire' }, max12345: { pseudo: 'Max', role: 'manager' }, coach123: { pseudo: 'Zed', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' }, tom12345: { pseudo: 'Tom', role: 'remplacant' } };
const hexa = o => Buffer.from(o).toString('hex');

let smtp;
before(async () => {
  smtp = await fauxSmtp();
});
after(() => smtp.fermer());

async function preparer() {
  const appels = [];
  let n = 0;
  const fetchDiscord = async (url, init) => {
    appels.push({ url: String(url), methode: init.method, corps: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST' && /\/channels\/\d+\/messages$/.test(url)) return new Response(JSON.stringify({ id: `90000000000000${String(++n).padStart(4, '0')}` }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const paire = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publique = hexa(await crypto.subtle.exportKey('raw', paire.publicKey));
  const b = await banc({ fetchDiscord, discordBot: { applicationId: APP, publicKey: publique, jetonBot: JETON_BOT } });
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const f = A.sessions.fondateur;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const commande = async (qui, nom, options, permissions = '0') => {
    const texte = JSON.stringify({ type: 2, token: 't', guild_id: G1, channel_id: SALON, channel: { id: SALON, name: 'scrims' }, member: { user: { id: qui, username: 'x' }, permissions }, data: { name: nom, options: Object.entries(options).map(([name, value]) => ({ name, value })) } });
    const h = String(Math.floor(b.horloge.t / 1000));
    const sig = hexa(await crypto.subtle.sign('Ed25519', paire.privateKey, new TextEncoder().encode(h + texte)));
    return (await b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': h, 'Content-Type': 'application/json' }, body: texte }))).json();
  };
  return { b, A, f, api, appels, commande, fetchDiscord };
}

test('Discord ID : validation (17 à 20 chiffres, mention collée acceptée), obligatoire si demandé', () => {
  assert.equal(lireDiscordId(' 412345678901234567 '), '412345678901234567');
  assert.equal(lireDiscordId('<@!412345678901234567>'), '412345678901234567');
  assert.equal(lireDiscordId(''), null);
  assert.throws(() => lireDiscordId('', { obligatoire: true }), e => e.code === 'discord-id-requis');
  for (const mauvais of ['1234', '0123456789012345678', '12345678901234567890123', 'abc12345678901234567', 'Léa#1234']) {
    assert.throws(() => lireDiscordId(mauvais), e => e.code === 'discord-id' && e.statut === 400, mauvais);
  }
});

test('Discord ID : obligatoire à « Créer un compte » (vérification comprise) et à « Ajouter à une team » d’un nouveau compte ; unique', async () => {
  const { A, f, api } = await preparer();
  const corps = (plus = {}) => ({ compte: 'zoe12345', pseudo: 'Zoé', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }], ...plus });
  let r = await api('/comptes', f, { methode: 'POST', corps: { ...corps(), verifier: true } });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'discord-id-requis');
  assert.equal((await api('/comptes', f, { methode: 'POST', corps: corps({ discordId: '12' }) })).corps.code, 'discord-id');
  assert.equal((await api('/comptes', f, { methode: 'POST', corps: corps({ discordId: ID.zoe, verifier: true }) })).statut, 200);
  r = await api('/comptes', f, { methode: 'POST', corps: corps({ discordId: `<@${ID.zoe}>` }) });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.discordId, ID.zoe);
  // Même Discord ID pour un autre compte : 409 (vérification comprise).
  r = await api('/comptes', f, { methode: 'POST', corps: corps({ compte: 'ian12345', pseudo: 'Ian', discordId: ID.zoe, verifier: true }) });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'discord-id-pris');
  // « Ajouter à une team » d'un compte du hub sans fiche Esport : Discord ID obligatoire aussi.
  r = await api('/comptes/neuf12345/teams', f, { methode: 'POST', corps: { pseudo: 'Neuf', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }] } });
  assert.equal(r.corps.code, 'discord-id-requis');
  r = await api('/comptes/neuf12345/teams', f, { methode: 'POST', corps: { pseudo: 'Neuf', discordId: '412345678901234599', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.discordId, '412345678901234599');
});

test('Discord ID : modifiable par le Fondateur SEUL — 403 pour Propriétaire, Manager, le membre lui-même', async () => {
  const { A, f, api } = await preparer();
  for (const [qui, jeton] of [['propriétaire', A.sessions.bob12345], ['manager', A.sessions.max12345], ['le membre', A.sessions.lea12345]]) {
    const r = await api('/comptes/lea12345/discord-id', jeton, { methode: 'PUT', corps: { discordId: ID.lea } });
    assert.equal(r.statut, 403, qui);
  }
  let annuaire = (await api('/membres', A.sessions.bob12345)).corps;
  assert.equal(annuaire.peutModifierDiscordId, false);
  assert.equal(annuaire.comptes.find(c => c.compte === 'lea12345').discordId, null, 'membre existant sans ID : badge « manquant » côté app');
  let r = await api('/comptes/lea12345/discord-id', f, { methode: 'PUT', corps: { discordId: ID.lea } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.discordId, ID.lea);
  annuaire = (await api('/membres', A.sessions.max12345)).corps;
  assert.equal(annuaire.comptes.find(c => c.compte === 'lea12345').discordId, ID.lea, 'visible de ceux qui voient les membres');
  assert.equal((await api('/membres', f)).corps.peutModifierDiscordId, true);
  assert.equal((await api('/comptes/tom12345/discord-id', f, { methode: 'PUT', corps: { discordId: ID.lea } })).statut, 409, 'unique');
  assert.equal((await api('/comptes/tom12345/discord-id', f, { methode: 'PUT', corps: { discordId: 'pas un id' } })).statut, 400);
  assert.equal((await api('/comptes/inconnu12/discord-id', f, { methode: 'PUT', corps: { discordId: ID.tom } })).statut, 404);
  r = await api('/comptes/lea12345/discord-id', f, { methode: 'PUT', corps: { discordId: null } });
  assert.equal(r.corps.discordId, null, 'le Fondateur peut le retirer');
});

test('Discord ID : proposé dans une demande de compte, repris à la validation', async () => {
  const { b, A, f, api } = await preparer();
  // Léa reçoit members.create (rôle Joueur) : elle peut proposer un compte.
  const joueur = A.roles.joueur;
  await b.base.executer("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'members.create') ON CONFLICT DO NOTHING", [joueur.id]);
  const demande = (plus = {}) => ({ teamId: A.teamId, roleId: joueur.id, pseudo: 'Noa', email: 'noa@exemple.fr', ...plus });
  assert.equal((await api('/comptes/demandes', A.sessions.lea12345, { methode: 'POST', corps: demande({ discordId: 'faux' }) })).statut, 400);
  const d = await api('/comptes/demandes', A.sessions.lea12345, { methode: 'POST', corps: demande({ discordId: '512345678901234567' }) });
  assert.equal(d.statut, 200, JSON.stringify(d.corps));
  assert.equal(d.corps.discordId, '512345678901234567');
  const liste = (await api('/comptes/demandes', f)).corps.demandes;
  assert.equal(liste[0].discordId, '512345678901234567');
  const affectations = [{ teamId: A.teamId, roleId: joueur.id }];
  assert.equal((await api('/comptes', f, { methode: 'POST', corps: { compte: 'noa12345', pseudo: 'Noa', affectations, demandeId: d.corps.id } })).corps.code, 'discord-id-requis', 'obligatoire à la validation');
  const v = await api('/comptes', f, { methode: 'POST', corps: { compte: 'noa12345', pseudo: 'Noa', discordId: '512345678901234567', affectations, demandeId: d.corps.id } });
  assert.equal(v.statut, 200, JSON.stringify(v.corps));
  assert.equal(v.corps.discordId, '512345678901234567');
});

test('bot : pingue les convoqués par leur Discord ID ; la liaison /lier vérifiée prime', async () => {
  const { b, A, f, api, appels, commande, fetchDiscord } = await preparer();
  await commande(ID.admin, 'esport-lier-serveur', { code: (await api(`/teams/${A.teamId}/discord/bot/code`, A.sessions.max12345, { methode: 'POST' })).corps.code }, '8');
  // Léa : Discord ID saisi par le Fondateur, pas de /lier. Tom : un ID saisi ET une liaison /lier (autre compte Discord).
  await api('/comptes/lea12345/discord-id', f, { methode: 'PUT', corps: { discordId: ID.lea } });
  await api('/comptes/tom12345/discord-id', f, { methode: 'PUT', corps: { discordId: ID.tom } });
  await commande(ID.tomLier, 'lier', { code: (await api('/moi/discord/code', A.sessions.tom12345, { methode: 'POST' })).corps.code });
  const membres = await membresTeam(b.base, A.teamId);
  const de = c => membres.find(m => m.compte === c);
  assert.equal(de('lea12345').discordId, ID.lea);
  assert.equal(de('lea12345').discordLie, false);
  assert.equal(de('tom12345').discordId, ID.tomLier, '/lier prime sur le champ');
  assert.equal(de('max12345').discordId, null);
  const avant = appels.length;
  const r = await api(`/teams/${A.teamId}/planning`, A.sessions.coach123, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim ID', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00', convocation: { groupes: [], membres: ['lea12345', 'tom12345'] } } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  await traiterFile(b.base, { cle: CLE, fetch: fetchDiscord, maintenant: b.horloge.t, jetonBot: JETON_BOT });
  const annonce = appels.slice(avant).find(a => a.methode === 'POST' && a.url.endsWith(`/channels/${SALON}/messages`) && /Scrim ID/.test(JSON.stringify(a.corps)));
  assert.ok(annonce, JSON.stringify(appels.slice(avant).map(a => a.url)));
  assert.deepEqual(annonce.corps.content.split(' ').sort(), [`<@${ID.lea}>`, `<@${ID.tomLier}>`].sort());
  assert.deepEqual([...annonce.corps.allowed_mentions.users].sort(), [ID.lea, ID.tomLier].sort());
  assert.deepEqual(annonce.corps.allowed_mentions.parse, []);
});

test('Discord ID : RGPD — dans l’export, effacé avec le compte', async () => {
  const { b, A, f, api } = await preparer();
  await api('/comptes/lea12345/discord-id', f, { methode: 'PUT', corps: { discordId: ID.lea } });
  assert.equal((await api('/moi/export', A.sessions.lea12345)).corps.profil.discordId, ID.lea);
  assert.equal((await api('/admin/comptes/lea12345/export', f)).corps.profil.discordId, ID.lea);
  assert.equal((await api('/moi', A.sessions.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.equal(await b.base.premier('SELECT id FROM comptes WHERE discord_id = ?', [ID.lea]), null);
  await api('/comptes/tom12345/discord-id', f, { methode: 'PUT', corps: { discordId: ID.tom } });
  assert.equal((await api('/admin/comptes/tom12345/hub', f, { methode: 'DELETE' })).statut, 200);
  assert.equal(await b.base.premier('SELECT id FROM comptes WHERE discord_id = ?', [ID.tom]), null);
});

test('récapitulatif e-mail : désactivé par défaut, adresse chiffrée et masquée, envoi par le cron vers un faux SMTP', async () => {
  const { b, A, f, api } = await preparer();
  const lea = A.sessions.lea12345;
  assert.deepEqual((await api('/moi/recap-courriel', lea)).corps, { actif: false, frequence: 'quotidien', adresse: null, dernierEnvoi: null });
  assert.equal((await api('/moi/recap-courriel', lea, { methode: 'PUT', corps: { actif: true, adresse: 'pas une adresse' } })).statut, 400);
  const r = await api('/moi/recap-courriel', lea, { methode: 'PUT', corps: { actif: true, adresse: 'lea@exemple.fr', frequence: 'quotidien' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.adresse, 'l***@e***.fr');
  const ligne = await b.base.premier('SELECT * FROM courriel_recap WHERE compte_id = ?', ['lea12345']);
  assert.ok(ligne.adresse_chiffree.startsWith('cr1.'));
  assert.ok(!JSON.stringify(ligne).includes('lea@exemple.fr'), 'chiffrée au repos');
  // Une notification importante (nouvel événement) arrive, non lue.
  await api(`/teams/${A.teamId}/planning`, A.sessions.coach123, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim récap', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
  const envoyer = await creerEnvoyeur(configSmtp(smtp.env));
  try {
    b.horloge.t += 60_000;
    const avant = smtp.messages.length;
    const bilan = await tacheRecap(b.base, { cle: CLE, envoyer, maintenant: b.horloge.t, lienApp: 'https://appdashboard.fr' });
    assert.equal(bilan.envoyes, 1, JSON.stringify(bilan));
    assert.deepEqual(smtp.messages[avant].a, ['lea@exemple.fr']);
    const m = decoderMessage(smtp.messages[avant].donnees);
    assert.match(m.entetes, /Subject: =\?UTF-8\?Q\?Esport_=3A_votre_r=C3=A9capitulatif/);
    assert.match(m.texte, /Scrim récap/);
    // Déjà envoyé aujourd'hui : rien de plus.
    assert.equal((await tacheRecap(b.base, { cle: CLE, envoyer, maintenant: b.horloge.t + 3_600_000 })).envoyes, 0);
  } finally {
    envoyer.fermer();
  }
  // Désactiver efface l'adresse.
  await api('/moi/recap-courriel', lea, { methode: 'PUT', corps: { actif: false } });
  assert.equal(await b.base.premier('SELECT * FROM courriel_recap WHERE compte_id = ?', ['lea12345']), null);
  void f;
});
