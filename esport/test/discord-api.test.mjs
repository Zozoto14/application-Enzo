/**
 * Discord (phase 4) par l'API, sans réseau réel : webhook jamais renvoyé en
 * clair, message de test, réglages par événement, branchement des événements
 * des phases 1 à 3, rappels J-1 / H-1 du cron, file d'envoi (réessais, limite
 * de débit 429, abandon, journal), permissions et isolation entre teams, et un
 * parcours de bout en bout vers un faux serveur Discord local (node:http).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ESSAIS_MAX, traiterFile } from '../noyau/discord/file.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { rappelsDiscord } from '../noyau/discord/rappels.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { ordreInsertion } from './base.mjs';
import { ID, JETON, URL_TEST } from './discord-aide.mjs';

const URL_B = `https://discord.com/api/webhooks/987654321098765432/ZyXwVvUuTtSsRrQqPpOoNnMmLlKk9876543210-_wxyz`;
const ROLE = '555666777888999000';
const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};

/** Faux Discord : réponses programmées (sinon 204), appels enregistrés. */
function fauxDiscord() {
  const appels = [];
  const programme = [];
  const fetch = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body), init });
    const r = programme.length > 0 ? programme.shift() : { statut: 204 };
    if (r instanceof Error) throw r;
    return new Response(r.corps === undefined ? null : JSON.stringify(r.corps), { status: r.statut, headers: r.entetes ?? {} });
  };
  return { appels, programme, fetch, contenus: () => appels.map(a => texteCharge(a.corps)) };
}

async function preparer({ discord = fauxDiscord(), ...optionsTeam } = {}) {
  const b = await banc({ fetchDiscord: discord.fetch });
  await ordreInsertion(b.base, ['journal', 'discord_file']);
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES, ...optionsTeam });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'manager' } } });
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const d = `/teams/${A.teamId}/discord`;
  const webhook = (jeton = A.sessions.max12345, url = URL_TEST, team = A.teamId) => api(`/teams/${team}/discord/webhook`, jeton, { methode: 'PUT', corps: { url } });
  const parametre = (cle, corps, jeton = A.sessions.max12345, team = A.teamId) => api(`/teams/${team}/discord/parametres/${cle}`, jeton, { methode: 'PUT', corps });
  const evenementPlanning = (corps = {}, jeton = A.sessions.coach123, team = A.teamId) =>
    api(`/teams/${team}/planning`, jeton, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim Faucons', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00', ...corps } });
  const journal = async (teamId = A.teamId, filtre = 'discord.delivery%') => (await b.base.tous('SELECT action, meta, acteur_id FROM journal WHERE team_id = ? AND action LIKE ? ORDER BY cree_le, rowid', [teamId, filtre])).map(l => ({ ...l, meta: JSON.parse(l.meta) }));
  const file = (teamId = A.teamId) => b.base.tous('SELECT * FROM discord_file WHERE team_id = ? ORDER BY rowid', [teamId]);
  return { b, A, B, discord, api, d, webhook, parametre, evenementPlanning, journal, file, s: { ...A.sessions, bob12345: B.sessions.bob12345 } };
}

const traiter = (p, maintenant = p.b.horloge.t, extra = {}) => traiterFile(p.b.base, { cle: CLE, fetch: p.discord.fetch, maintenant, ...extra });
const plus = (p, ms) => p.b.horloge.t + ms;

// ------------------------------------------------------------------ Webhook : jamais en clair

test('webhook : enregistré chiffré, renvoyé seulement masqué, absent des réponses, de la base, du journal et de l’export', async () => {
  const p = await preparer();
  assert.equal((await p.api(p.d, p.s.max12345)).corps.webhook.configure, false);
  const r = await p.webhook();
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.masque, '…/abcd');
  assert.equal(r.corps.configure, true);

  const etat = await p.api(p.d, p.s.max12345);
  assert.equal(etat.corps.webhook.masque, '…/abcd');
  for (const texte of [JSON.stringify(r.corps), JSON.stringify(etat.corps)]) {
    assert.ok(!texte.includes(JETON) && !texte.includes(ID) && !texte.includes('discord.com/api'), 'ni jeton, ni identifiant, ni adresse');
  }

  // Au repos : chiffré.
  const ligne = await p.b.base.premier('SELECT * FROM discord_webhooks WHERE team_id = ?', [p.A.teamId]);
  assert.match(ligne.url_chiffree, /^dw1\./);
  assert.ok(!JSON.stringify(ligne).includes(JETON) && !JSON.stringify(ligne).includes(ID));
  assert.equal(ligne.fin, 'abcd');

  // Ni dans le bus, ni dans le journal (lisible par d'autres rôles), ni dans l'export de la base.
  await p.b.appel('/teams', { jeton: p.s.fondateur });
  const evs = JSON.stringify(await p.b.base.tous('SELECT * FROM evenements', []));
  const jr = JSON.stringify(await p.b.base.tous('SELECT * FROM journal', []));
  assert.ok(!evs.includes(JETON) && !jr.includes(JETON));
  const exp = await p.api('/admin/export', p.s.fondateur);
  assert.equal(exp.statut, 200);
  assert.ok(!JSON.stringify(exp.corps).includes(JETON), 'l’export garde l’adresse chiffrée');
  assert.equal(exp.corps.tables.discord_webhooks.length, 1);

  // Journal : l'enregistrement est consigné, sans l'adresse.
  await distribuer(p.b.base, { maintenant: p.b.horloge.t });
  assert.deepEqual((await p.journal(p.A.teamId, 'discord.webhook%')).map(l => l.action), ['discord.webhook_set']);
});

test('webhook : une adresse invalide est refusée (400) sans être répétée ; remplacer garde un seul webhook par team', async () => {
  const p = await preparer();
  for (const url of ['http://discord.com/api/webhooks/123456789012345678/' + JETON, 'https://evil.example/x', '', null]) {
    const r = await p.webhook(p.s.max12345, url);
    assert.equal(r.statut, 400);
    assert.equal(r.corps.code, 'webhook-url');
    assert.ok(!JSON.stringify(r.corps).includes('evil'));
  }
  assert.equal((await p.webhook()).statut, 200);
  const r = await p.webhook(p.s.max12345, URL_B);
  assert.equal(r.corps.masque, '…/wxyz');
  assert.equal((await p.b.base.tous('SELECT * FROM discord_webhooks WHERE team_id = ?', [p.A.teamId])).length, 1);
  assert.equal((await p.api(`${p.d}/webhook`, p.s.max12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await p.api(p.d, p.s.max12345)).corps.webhook.configure, false);
  assert.equal((await p.api(`${p.d}/webhook`, p.s.max12345, { methode: 'DELETE' })).corps.code, 'webhook-absent');
});

test('webhook : chiffré avec CLE_DISCORD quand elle existe ; secret changé → webhook illisible, abandon consigné, à ressaisir', async () => {
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, cleDiscord: 'cle-discord-separee-0123456789abcdef-xyz' });
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const r = await b.appel(`/teams/${teamId}/discord/webhook`, { methode: 'PUT', jeton: sessions.max12345, corps: { url: URL_TEST } });
  assert.equal(r.statut, 200);
  const t = await b.appel(`/teams/${teamId}/discord/test`, { methode: 'POST', jeton: sessions.max12345 });
  assert.equal(t.statut, 200, JSON.stringify(t.corps));
  assert.equal(discord.appels[0].url, URL_TEST, 'déchiffré avec la bonne clé');
  // Message en file puis clé perdue : abandon propre, journalisé, aucun envoi.
  discord.programme.push({ statut: 500 });
  await b.appel(`/teams/${teamId}/planning`, { methode: 'POST', jeton: sessions.coach123, corps: { type: 'scrim', titre: 'Scrim', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
  const avant = discord.appels.length;
  const res = await traiterFile(b.base, { cle: 'autre-secret-completement-different-0123456789', fetch: discord.fetch, maintenant: b.horloge.t + 120_000 });
  assert.equal(res.abandonnes, 1);
  assert.equal(discord.appels.length, avant, 'rien n’est envoyé');
  const j = await b.base.tous("SELECT meta FROM journal WHERE action = 'discord.delivery_abandoned'", []);
  assert.match(j[0].meta, /illisible/);
});

// ------------------------------------------------------------------ Message de test

test('message de test : envoyé tout de suite au webhook, sans mention ; erreurs de Discord expliquées sans fuite', async () => {
  const p = await preparer();
  assert.equal((await p.api(`${p.d}/test`, p.s.max12345, { methode: 'POST' })).corps.code, 'webhook-absent');
  await p.webhook();
  const r = await p.api(`${p.d}/test`, p.s.max12345, { methode: 'POST' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(p.discord.appels.length, 1);
  assert.equal(p.discord.appels[0].url, URL_TEST);
  assert.match(texteCharge(p.discord.appels[0].corps), /Message de test.*Team Alpha/);
  assert.equal(p.discord.appels[0].corps.content, undefined, 'sans rôle : aucun texte qui mentionne');
  assert.equal(p.discord.appels[0].corps.embeds.length, 1, 'un embed');
  assert.deepEqual(p.discord.appels[0].corps.allowed_mentions, { parse: [] });

  // Pas de rafale de tests.
  const vite = await p.api(`${p.d}/test`, p.s.max12345, { methode: 'POST' });
  assert.equal(vite.statut, 429);
  assert.equal(vite.corps.code, 'trop-vite');
  assert.ok(vite.corps.attente >= 1);
  p.b.horloge.t += 11_000;
  const max = await p.b.session('max12345');

  // Webhook supprimé côté Discord : message clair, webhook marqué invalide.
  p.discord.programme.push({ statut: 404, corps: { message: `Unknown Webhook ${URL_TEST}`, code: 10015 } });
  const perdu = await p.api(`${p.d}/test`, max, { methode: 'POST' });
  assert.equal(perdu.statut, 502);
  assert.equal(perdu.corps.code, 'webhook-refuse');
  assert.ok(!JSON.stringify(perdu.corps).includes(JETON));
  assert.equal((await p.api(p.d, max)).corps.webhook.invalide, true);

  p.b.horloge.t += 11_000;
  const max2 = await p.b.session('max12345');
  p.discord.programme.push({ statut: 429, corps: { retry_after: 4.2 } });
  const limite = await p.api(`${p.d}/test`, max2, { methode: 'POST' });
  assert.equal(limite.statut, 429);
  assert.equal(limite.corps.attente, 5);
  assert.equal(limite.entetes.get('Retry-After'), '5');

  p.b.horloge.t += 11_000;
  const max3 = await p.b.session('max12345');
  p.discord.programme.push(new TypeError('fetch failed'));
  const casse = await p.api(`${p.d}/test`, max3, { methode: 'POST' });
  assert.equal(casse.statut, 502);
  assert.equal(casse.corps.code, 'discord-echec');
  // Une adresse corrigée remet le webhook en service.
  p.b.horloge.t += 11_000;
  const max4 = await p.b.session('max12345');
  await p.webhook(max4, URL_B);
  assert.equal((await p.api(p.d, max4)).corps.webhook.invalide, false);
});

// ------------------------------------------------------------------ Réglages

test('réglages : un type de message par événement du plan, valeurs par défaut, aperçu, variables', async () => {
  const p = await preparer();
  const { parametres } = (await p.api(p.d, p.s.max12345)).corps;
  assert.deepEqual(
    parametres.map(x => x.cle),
    ['event_created', 'reminder_d1', 'reminder_h1', 'event_now', 'rsvp_relance', 'rsvp_missing', 'summary_published', 'summary_submitted', 'task_assigned', 'task_due', 'member_joined', 'account_requested', 'role_changed', 'review_created', 'strat_created', 'playbook_validated'],
  );
  const creation = parametres.find(x => x.cle === 'event_created');
  assert.deepEqual([creation.actif, creation.personnalise, creation.roleMention, creation.disponible], [true, false, null, true]);
  assert.ok(creation.variables.some(v => v.nom === 'titre') && creation.variables.some(v => v.nom === 'lien'));
  assert.match(creation.apercu, /Scrim contre les Faucons/);
  assert.equal(parametres.find(x => x.cle === 'rsvp_missing').actif, false, 'RSVP manquant : désactivé par défaut (un message par joueur)');
  assert.equal(parametres.find(x => x.cle === 'review_created').disponible, true, 'preset complet : le module Review vidéo est actif');
});

test('réglages : activer, modèle personnalisé, rôle à mentionner ; validations (variable, rôle, type)', async () => {
  const p = await preparer();
  let r = await p.parametre('rsvp_missing', { actif: true, modele: 'Hé {membre}, réponds pour {titre} !', roleMention: ROLE });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual([r.corps.actif, r.corps.personnalise, r.corps.roleMention, r.corps.modele], [true, true, ROLE, 'Hé {membre}, réponds pour {titre} !']);
  assert.match(r.corps.apercu, /Hé Max, réponds pour Scrim contre les Faucons/);

  assert.equal((await p.parametre('rsvp_missing', { modele: 'Salut {pirate}' })).corps.code, 'variable-inconnue');
  for (const role of ['@everyone', '@here', 'everyone', '<@&555666777>', 'abc']) {
    const x = await p.parametre('rsvp_missing', { roleMention: role });
    assert.equal(x.statut, 400, role);
    assert.equal(x.corps.code, 'role-mention');
  }
  assert.equal((await p.parametre('rsvp_missing', { modele: 'x'.repeat(501) })).corps.code, 'modele-long');
  assert.equal((await p.parametre('rsvp_missing', { actif: 'oui' })).corps.code, 'actif');
  assert.equal((await p.parametre('inconnu', { actif: true })).statut, 404);
  // Rien n'a bougé après les refus.
  const etat = (await p.api(p.d, p.s.max12345)).corps.parametres.find(x => x.cle === 'rsvp_missing');
  assert.deepEqual([etat.roleMention, etat.modele], [ROLE, 'Hé {membre}, réponds pour {titre} !']);

  // Modèle vide et rôle vide : retour aux valeurs par défaut.
  r = await p.parametre('rsvp_missing', { modele: '', roleMention: '' });
  assert.deepEqual([r.corps.personnalise, r.corps.roleMention], [false, null]);
  // Changements consignés (type, champs), sans le contenu du modèle.
  await distribuer(p.b.base, { maintenant: p.b.horloge.t });
  const j = await p.journal(p.A.teamId, 'discord.settings_changed');
  assert.equal(j.length, 2);
  assert.deepEqual(j[0].meta.champs.sort(), ['actif', 'modele', 'roleMention']);
});

test('réglages : « review créée » désactivée quand le module Review vidéo est absent', async () => {
  const p = await preparer({ preset: 'personnalise', modules: ['activity_log', 'planning', 'discord'] });
  const review = (await p.api(p.d, p.s.max12345)).corps.parametres.find(x => x.cle === 'review_created');
  assert.deepEqual([review.disponible, review.actif], [false, false]);
  const r = await p.parametre('review_created', { actif: true });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'module-absent');
  // Même si l'événement arrive (phase 5 pas activée pour cette team), rien n'est mis en file.
  await p.webhook();
  await p.b.base.executer("INSERT INTO evenements (id, type, team_id, acteur_id, entite_type, entite_id, charge, cree_le, essais) VALUES ('ev-review', 'review.created', ?, 'max12345', 'review', 'r1', '{\"titre\":\"VOD Ascent\"}', ?, 0)", [p.A.teamId, new Date(p.b.horloge.t).toISOString()]);
  await distribuer(p.b.base, { maintenant: p.b.horloge.t });
  assert.equal((await p.file()).length, 0);
});

// ------------------------------------------------------------------ Branchement des événements des phases 1 à 3

test('événements : planning, membres, rôles, tâches et résumés mis en file selon les réglages, avec leurs variables', async () => {
  const p = await preparer();
  await p.webhook();
  await p.parametre('member_joined', { actif: true });
  await p.parametre('role_changed', { actif: true });
  await p.parametre('task_due', { actif: true });
  await p.parametre('summary_submitted', { actif: true });

  // Phase 2 : planning.
  assert.equal((await p.evenementPlanning()).statut, 200);
  // Phase 1 : rôle changé.
  const membres = (await p.api(`/teams/${p.A.teamId}/membres`, p.s.fondateur)).corps.membres;
  const lea = membres.find(m => m.compte === 'lea12345');
  assert.equal((await p.api(`/teams/${p.A.teamId}/membres/${lea.id}`, p.s.fondateur, { methode: 'PATCH', corps: { roleId: p.A.roles.analyste.id } })).statut, 200);
  // Phase 3 : tâche assignée, dépôt de réunion.
  assert.equal((await p.api(`/teams/${p.A.teamId}/taches`, p.s.coach123, { methode: 'POST', corps: { titre: 'Revoir les retakes', assigne: 'lea12345', echeance: '2026-10-25' } })).statut, 200);
  assert.equal((await p.api(`/teams/${p.A.teamId}/resumes`, p.s.lea12345, { methode: 'POST', corps: { lien: 'https://youtu.be/abc123', typeId: '00000000-0000-4000-8000-000000000001', dateReunion: '2026-10-19', titre: 'Réunion du lundi' } })).statut, 200);

  const contenus = p.discord.contenus();
  assert.equal(contenus.length, 4, JSON.stringify(contenus));
  assert.match(contenus.find(c => c.includes('Nouvel événement')), /Scrim Faucons \(Scrim\), le jeudi 22 octobre à 20:30/);
  assert.match(contenus.find(c => c.includes('passe de')), /\*\*Léa\*\* passe de Joueur à Analyste \(par Fondateur\)/);
  assert.match(contenus.find(c => c.includes('Nouvelle tâche')), /Nouvelle tâche\*\* pour Léa : Revoir les retakes, pour le 25\/10\/2026/);
  assert.match(contenus.find(c => c.includes('Réunion à résumer')), /Réunion du lundi \(Hebdo, 19\/10\/2026\), déposée par Léa/);
  for (const a of p.discord.appels) assert.equal(a.url, URL_TEST);
  assert.ok((await p.file()).every(f => f.statut === 'envoye'));

  // Membre rejoint : compte créé depuis l'Esport (invitation directe), annoncé à sa première session.
  const avant = p.discord.contenus().length;
  const pre = await p.api('/comptes', p.s.fondateur, { methode: 'POST', corps: { compte: 'nou12345', pseudo: 'Nouveau', affectations: [{ teamId: p.A.teamId, roleId: p.A.roles.joueur.id }] } });
  assert.equal(pre.statut, 200);
  assert.equal(p.discord.contenus().length, avant, 'rien d’annoncé tant que le compte n’est pas connecté');
  await p.b.session('nou12345');
  assert.match(p.discord.contenus().at(-1), /\*\*Nouveau\*\* a rejoint Team Alpha \(Joueur\)/);
});

test('événements : un type désactivé, ou sans webhook, ou module Discord coupé, ne met rien en file', async () => {
  const p = await preparer();
  // Sans webhook.
  await p.evenementPlanning({ titre: 'Sans webhook' });
  assert.equal((await p.file()).length, 0);
  await p.webhook();
  // Type désactivé.
  await p.parametre('event_created', { actif: false });
  await p.evenementPlanning({ titre: 'Désactivé' });
  assert.equal((await p.file()).length, 0);
  // Réactivé.
  await p.parametre('event_created', { actif: true });
  await p.evenementPlanning({ titre: 'Activé' });
  assert.equal((await p.file()).length, 1);
  // Module Discord désactivé pour la team : plus de file, plus d'écran.
  await p.api(`/teams/${p.A.teamId}/modules`, p.s.fondateur, { methode: 'PUT', corps: { modules: { discord: false } } });
  await p.evenementPlanning({ titre: 'Module coupé' });
  assert.equal((await p.file()).length, 1);
  assert.equal((await p.api(p.d, p.s.fondateur)).corps.code, 'module-desactive');
  assert.equal(p.discord.appels.length, 1);
});

test('événements : le résumé d’une réunion « staff » n’est jamais publié sur Discord ; celui d’une réunion d’équipe l’est', async () => {
  const p = await preparer();
  await p.webhook();
  const pdf = new TextEncoder().encode('%PDF-1.7\n% résumé\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  for (const [typeId, titre] of [['00000000-0000-4000-8000-000000000004', 'Réunion staff secrète'], ['00000000-0000-4000-8000-000000000001', 'Hebdo public']]) {
    const dep = await p.api(`/teams/${p.A.teamId}/resumes`, p.s.lea12345, { methode: 'POST', corps: { lien: 'https://youtu.be/abc123', typeId, dateReunion: '2026-10-19', titre } });
    if (dep.statut !== 200) {
      // Les Joueurs ne peuvent pas toujours déposer un type staff : le Manager le fait.
      const bis = await p.api(`/teams/${p.A.teamId}/resumes`, p.s.max12345, { methode: 'POST', corps: { lien: 'https://youtu.be/abc123', typeId, dateReunion: '2026-10-19', titre } });
      assert.equal(bis.statut, 200, JSON.stringify(bis.corps));
      dep.corps = bis.corps;
    }
    const r = await p.b.envoyer(`/teams/${p.A.teamId}/resumes/${dep.corps.id}/pdf`, { jeton: p.s.max12345, octets: pdf, nom: 'r.pdf' });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
  }
  const contenus = p.discord.contenus();
  assert.equal(contenus.length, 1, JSON.stringify(contenus));
  assert.match(contenus[0], /Résumé publié\*\* : Hebdo public/);
  assert.ok(!contenus.join().includes('secrète'));
});

test('événements : mentions injectées dans un titre neutralisées ; la mention de rôle configurée est la seule autorisée', async () => {
  const p = await preparer();
  await p.webhook();
  await p.parametre('event_created', { roleMention: ROLE, modele: 'Nouveau : {titre} {acteur}' });
  await p.evenementPlanning({ titre: '@everyone <@&111222333> @here Scrim' });
  const a = p.discord.appels.at(-1).corps;
  assert.equal(a.content, `<@&${ROLE}>`, 'seule la mention du rôle est dans le texte');
  const texte = texteCharge(a);
  assert.match(texte, /Nouveau :/);
  assert.ok(!/@everyone|@here/i.test(texte) && !texte.includes('<@&111222333>'), texte);
  assert.deepEqual(a.allowed_mentions, { parse: [], roles: [ROLE] });
  assert.ok(JSON.stringify(a.embeds).length <= 6000);
  // Sans rôle : aucune mention possible.
  await p.parametre('event_created', { roleMention: null });
  await p.evenementPlanning({ titre: '@everyone encore' });
  assert.deepEqual(p.discord.appels.at(-1).corps.allowed_mentions, { parse: [] });
});

test('{lien} : adresse de l’app donnée par le serveur ; vide sinon', async () => {
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, lienApp: 'https://app.exemple/esport' });
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  await b.appel(`/teams/${teamId}/discord/webhook`, { methode: 'PUT', jeton: sessions.max12345, corps: { url: URL_TEST } });
  await b.appel(`/teams/${teamId}/discord/parametres/event_created`, { methode: 'PUT', jeton: sessions.max12345, corps: { modele: 'Voir {lien} pour {titre}' } });
  await b.appel(`/teams/${teamId}/planning`, { methode: 'POST', jeton: sessions.coach123, corps: { type: 'scrim', titre: 'Scrim', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
  const corps = discord.appels[0].corps;
  assert.equal(corps.embeds[0].description, 'Voir https://app.exemple/esport pour Scrim');
  assert.equal(corps.embeds[0].url, 'https://app.exemple/esport', 'titre de l’embed : lien vers l’app');
  assert.equal(corps.components[0].components[0].url, 'https://app.exemple/esport', 'bouton « Ouvrir dans l’app »');
});

// ------------------------------------------------------------------ Rappels J-1 / H-1 (cron)

test('cron : rappel J-1 puis H-1, une seule fois par occurrence, selon les réglages', async () => {
  const p = await preparer();
  await p.webhook();
  await p.parametre('event_created', { actif: false });
  // Mercredi 21 octobre 08:00 à Paris = 06:00Z, soit 20 h après l'horloge (10:00Z le 20).
  assert.equal((await p.evenementPlanning({ titre: 'Match du matin', type: 'match', date: '2026-10-21', heureDebut: '08:00', heureFin: '09:00' })).statut, 200);
  assert.equal(p.discord.appels.length, 0);

  const t0 = p.b.horloge.t;
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: t0 }), 1, 'J-1');
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: t0 }), 0, 'une seule fois');
  await distribuer(p.b.base, { maintenant: t0 });
  await traiter(p, t0);
  assert.equal(p.discord.appels.length, 1);
  assert.match(p.discord.contenus()[0], /Rappel\*\* : Match du matin \(Match\) commence dans 20 h, le mercredi 21 octobre à 08:00/);

  // 50 minutes avant : H-1 (pas de second J-1).
  const h1 = Date.parse('2026-10-21T06:00:00.000Z') - 50 * 60_000;
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: h1 }), 1, 'H-1');
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: h1 + 60_000 }), 0);
  await distribuer(p.b.base, { maintenant: h1 });
  await traiter(p, h1);
  assert.match(p.discord.contenus()[1], /C’est bientôt\*\* : Match du matin \(Match\) commence dans 50 min, à 08:00/);

  // Les rappels passent aussi par le bus : consignés dans le journal d'activité.
  const actions = (await p.b.base.tous("SELECT action FROM journal WHERE team_id = ? AND action LIKE 'event.reminder%'", [p.A.teamId])).map(l => l.action).sort();
  assert.deepEqual(actions, ['event.reminder_d1', 'event.reminder_h1']);
});

test('cron : rappels désactivés, événement de moins de 2 h (H-1 seulement), annulé ou passé, team sans webhook', async () => {
  const p = await preparer();
  const t0 = p.b.horloge.t;
  // Pas de webhook : rien.
  await p.evenementPlanning({ titre: 'Match X', date: '2026-10-21', heureDebut: '08:00', heureFin: '09:00' });
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: t0 }), 0);
  await p.webhook();
  await p.parametre('reminder_d1', { actif: false });
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: t0 }), 0, 'J-1 désactivé, H-1 pas encore');
  await p.parametre('reminder_d1', { actif: true });
  await p.parametre('reminder_h1', { actif: false });
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: t0 }), 1, 'J-1 seul');
  // Événement dans 90 min : H-1 uniquement (pas de J-1 « dans 1 h 30 » qui ferait doublon).
  const p2 = await preparer();
  await p2.webhook();
  await p2.evenementPlanning({ titre: 'Bientôt', date: '2026-10-20', heureDebut: '13:30', heureFin: '14:30' }); // 11:30Z
  const debut = Date.parse('2026-10-20T11:30:00.000Z');
  assert.equal(await rappelsDiscord(p2.b.base, { maintenant: debut - 90 * 60_000 }), 0);
  assert.equal(await rappelsDiscord(p2.b.base, { maintenant: debut - 55 * 60_000 }), 1);
  assert.equal(await rappelsDiscord(p2.b.base, { maintenant: debut + 60_000 }), 0, 'déjà commencé');
  // Occurrence annulée : pas de rappel.
  const p3 = await preparer();
  await p3.webhook();
  const ev = await p3.evenementPlanning({ titre: 'Annulé', date: '2026-10-21', heureDebut: '08:00', heureFin: '09:00' });
  await p3.api(`/teams/${p3.A.teamId}/planning/${ev.corps.id}`, p3.s.coach123, { methode: 'DELETE' });
  assert.equal(await rappelsDiscord(p3.b.base, { maintenant: p3.b.horloge.t }), 0);
});

// ------------------------------------------------------------------ File : réessais, 429, abandon, journal

test('file : réessais avec attente croissante, abandon après N essais, chaque échec et l’abandon consignés', async () => {
  const p = await preparer();
  await p.webhook();
  for (let i = 0; i < ESSAIS_MAX + 2; i++) p.discord.programme.push({ statut: 503, corps: { message: `boom ${URL_TEST}` } });
  assert.equal((await p.evenementPlanning()).statut, 200);
  // Premier essai tout de suite (après la requête) : échec, nouvel essai plus tard.
  let f = (await p.file())[0];
  assert.deepEqual([f.statut, Number(f.essais), f.derniere_erreur], ['attente', 1, 'Erreur de Discord (HTTP 503)']);
  assert.equal(p.discord.appels.length, 1);
  assert.equal(Date.parse(f.prochain_essai_le) - p.b.horloge.t, 60_000, 'première attente : 1 min');
  // Trop tôt : rien.
  assert.equal((await traiter(p, plus(p, 30_000))).envoyes + p.discord.appels.length - 1, 0);

  const attentes = [60, 300, 900, 3600, 10_800];
  let t = Date.parse(f.prochain_essai_le);
  for (let n = 2; n <= ESSAIS_MAX; n++) {
    await traiter(p, t);
    f = (await p.file())[0];
    assert.equal(Number(f.essais), n);
    if (n < ESSAIS_MAX) {
      assert.equal(f.statut, 'attente');
      assert.equal(Date.parse(f.prochain_essai_le) - t, attentes[n - 1] * 1000, `attente après l’échec ${n}`);
      t = Date.parse(f.prochain_essai_le);
    }
  }
  assert.equal(f.statut, 'abandonne', 'abandon au dernier essai');
  assert.equal(p.discord.appels.length, ESSAIS_MAX);
  // Plus rien ensuite.
  await traiter(p, t + 86_400_000 * 2);
  assert.equal(p.discord.appels.length, ESSAIS_MAX);

  const j = await p.journal();
  assert.deepEqual(j.map(l => l.action), [...Array(ESSAIS_MAX - 1).fill('discord.delivery_failed'), 'discord.delivery_abandoned']);
  assert.deepEqual(j[0].meta, { cle: 'event_created', essai: 1, sur: ESSAIS_MAX, motif: 'Erreur de Discord (HTTP 503)' });
  assert.equal(j.at(-1).meta.essais, ESSAIS_MAX);
  assert.ok(!JSON.stringify(j).includes(JETON) && !JSON.stringify(j).includes('boom'), 'ni le webhook ni la réponse de Discord dans le journal');
  assert.equal((await p.api(p.d, p.s.max12345)).corps.file.abandonnes, 1);
  // Le journal d'activité de l'app le montre au Manager.
  const page = await p.api(`/teams/${p.A.teamId}/journal?action=discord.delivery_abandoned`, p.s.max12345);
  assert.equal(page.statut, 200);
});

test('file : un réseau coupé puis rétabli finit par envoyer, une seule fois', async () => {
  const p = await preparer();
  await p.webhook();
  p.discord.programme.push(new TypeError('fetch failed'), { statut: 500 });
  await p.evenementPlanning();
  let f = (await p.file())[0];
  assert.deepEqual([f.statut, Number(f.essais), f.derniere_erreur], ['attente', 1, 'Discord injoignable']);
  await traiter(p, Date.parse(f.prochain_essai_le));
  await traiter(p, plus(p, 3600_000));
  await traiter(p, plus(p, 3600_000 * 2));
  f = (await p.file())[0];
  assert.deepEqual([f.statut, Number(f.essais)], ['envoye', 3]);
  assert.equal(p.discord.appels.length, 3);
  await traiter(p, plus(p, 86_400_000));
  assert.equal(p.discord.appels.length, 3, 'jamais deux fois');
});

test('file : limite de débit (429) → on attend retry_after pour toute la team, sans compter d’essai', async () => {
  const p = await preparer();
  await p.webhook();
  p.discord.programme.push({ statut: 429, corps: { retry_after: 2.5, global: false }, entetes: { 'Retry-After': '7' } });
  const t1 = p.b.horloge.t;
  await p.evenementPlanning({ titre: 'Un' });
  p.b.horloge.t += 1000; // deux événements du même instant n'ont pas d'ordre garanti
  await p.evenementPlanning({ titre: 'Deux', date: '2026-10-23' });
  assert.equal(p.discord.appels.length, 1, 'le second message attend la fin de la limite, sans appeler Discord');
  let [un, deux] = await p.file();
  assert.deepEqual([un.statut, Number(un.essais), un.derniere_erreur], ['attente', 0, 'Limite de débit de Discord']);
  assert.deepEqual([deux.statut, Number(deux.essais)], ['attente', 0]);
  assert.equal(Date.parse(un.prochain_essai_le) - t1, 7000, 'le plus long de l’en-tête et du corps');
  assert.equal(Date.parse(deux.prochain_essai_le), Date.parse(un.prochain_essai_le));
  assert.equal((await p.api(p.d, p.s.max12345)).corps.webhook.bloqueJusqua, un.prochain_essai_le);

  await traiter(p, t1 + 6000);
  assert.equal(p.discord.appels.length, 1, 'avant la fin : silence');
  await traiter(p, t1 + 7001);
  assert.equal(p.discord.appels.length, 3);
  assert.deepEqual((await p.file()).map(f => [f.statut, Number(f.essais)]), [['envoye', 1], ['envoye', 1]], 'le 429 n’a consommé aucun essai');
  assert.equal((await p.journal()).filter(l => l.action.startsWith('discord.delivery')).length, 0, 'une limite de débit n’est pas un échec');
});

test('file : un 429 de l’équipe A ne retarde pas l’équipe B', async () => {
  const p = await preparer();
  await p.webhook();
  await p.webhook(p.s.bob12345, URL_B, p.B.teamId);
  p.discord.programme.push({ statut: 429, corps: { retry_after: 30 } });
  await p.evenementPlanning({ titre: 'Scrim A' });
  await p.evenementPlanning({ titre: 'Scrim B' }, p.s.bob12345, p.B.teamId);
  assert.deepEqual(p.discord.appels.map(a => a.url), [URL_TEST, URL_B]);
  assert.equal((await p.file(p.B.teamId))[0].statut, 'envoye');
  assert.equal((await p.file(p.A.teamId))[0].statut, 'attente');
});

test('file : refus définitif (webhook supprimé côté Discord, requête refusée) → abandon immédiat, webhook marqué invalide', async () => {
  const p = await preparer();
  await p.webhook();
  p.discord.programme.push({ statut: 404, corps: { code: 10015 } });
  await p.evenementPlanning();
  const f = (await p.file())[0];
  assert.deepEqual([f.statut, Number(f.essais)], ['abandonne', 1]);
  assert.equal((await p.api(p.d, p.s.max12345)).corps.webhook.invalide, true);
  assert.deepEqual((await p.journal()).map(l => l.action), ['discord.delivery_abandoned']);
  assert.match((await p.journal())[0].meta.motif, /supprimé/);
  p.discord.programme.push({ statut: 400, corps: { content: ['trop long'] } });
  await p.evenementPlanning({ titre: 'Autre' });
  assert.equal(p.discord.appels.length, 2);
  assert.equal((await p.file())[1].statut, 'abandonne', 'jamais de réessai sur un 400');
});

test('file : un message périmé (24 h) est abandonné ; un rappel l’est dès que l’événement a commencé', async () => {
  const p = await preparer();
  await p.webhook();
  p.discord.programme.push({ statut: 500 });
  await p.evenementPlanning();
  await traiter(p, plus(p, 25 * 3_600_000));
  const f = (await p.file())[0];
  assert.equal(f.statut, 'abandonne');
  assert.match(f.derniere_erreur, /périmé/);
  assert.equal(p.discord.appels.length, 1);
});

test('file : mise en file idempotente (événement rejoué) et un seul envoi quand deux traitements se croisent', async () => {
  const p = await preparer();
  await p.webhook();
  p.discord.programme.push({ statut: 500 });
  await p.evenementPlanning();
  // Rejeu du bus : toujours une seule ligne en file.
  await p.b.base.executer("UPDATE evenements SET traite_le = NULL, essais = 0 WHERE type = 'event.created'", []);
  await distribuer(p.b.base, { maintenant: p.b.horloge.t });
  assert.equal((await p.file()).length, 1);
  // Deux traitements simultanés : le bail n'en laisse passer qu'un.
  const t = plus(p, 61_000);
  await Promise.all([traiter(p, t), traiter(p, t)]);
  assert.equal(p.discord.appels.length, 2, 'un premier échec + un seul nouvel essai');
});

test('file : webhook supprimé, team supprimée → messages en attente abandonnés, secret effacé', async () => {
  const p = await preparer();
  await p.webhook();
  p.discord.programme.push({ statut: 500 });
  await p.evenementPlanning();
  await p.api(`${p.d}/webhook`, p.s.max12345, { methode: 'DELETE' });
  assert.equal((await p.file())[0].statut, 'abandonne');
  await traiter(p, plus(p, 3600_000));
  assert.equal(p.discord.appels.length, 1);

  // Team supprimée : webhook et file purgés par l'abonné.
  await p.webhook();
  p.discord.programme.push({ statut: 500 });
  await p.evenementPlanning({ titre: 'Encore' });
  assert.equal((await p.api(`/teams/${p.A.teamId}`, p.s.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.equal((await p.b.base.tous('SELECT * FROM discord_webhooks WHERE team_id = ?', [p.A.teamId])).length, 0);
  assert.equal((await p.b.base.tous('SELECT * FROM discord_file WHERE team_id = ?', [p.A.teamId])).length, 0);
});

// ------------------------------------------------------------------ Permissions et isolation

test('permissions : discord.manage requise partout (Manager et Fondateur oui ; Coach, Analyste, Joueur, Remplaçant 403)', async () => {
  const p = await preparer();
  await p.webhook();
  const routes = [
    ['GET', p.d, undefined],
    ['PUT', `${p.d}/webhook`, { url: URL_B }],
    ['DELETE', `${p.d}/webhook`, undefined],
    ['POST', `${p.d}/test`, undefined],
    ['PUT', `${p.d}/parametres/event_created`, { actif: false }],
  ];
  for (const compte of ['coach123', 'ana12345', 'lea12345', 'tom12345']) {
    for (const [methode, chemin, corps] of routes) {
      const r = await p.api(chemin, p.s[compte], { methode, corps });
      assert.equal(r.statut, 403, `${compte} ${methode} ${chemin}`);
      assert.equal(r.corps.code, 'permission');
    }
  }
  // Rien n'a changé, rien n'a été envoyé.
  assert.equal(p.discord.appels.length, 0);
  assert.equal((await p.api(p.d, p.s.max12345)).corps.webhook.masque, '…/abcd');
  assert.equal((await p.api(p.d, p.s.max12345)).corps.parametres.find(x => x.cle === 'event_created').actif, true);
  // Le Manager et le Fondateur y accèdent.
  assert.equal((await p.api(p.d, p.s.max12345)).statut, 200);
  assert.equal((await p.api(p.d, p.s.fondateur)).statut, 200);
  // Sans session : 401.
  assert.equal((await p.b.appel(p.d)).statut, 401);
  // La permission peut être donnée à un rôle personnalisé.
  const role = await p.api(`/teams/${p.A.teamId}/roles`, p.s.fondateur, { methode: 'POST', corps: { nom: 'Community', couleur: '#ff8800', permissions: ['discord.manage'] } });
  assert.equal(role.statut, 200, JSON.stringify(role.corps));
  const lea = (await p.api(`/teams/${p.A.teamId}/membres`, p.s.fondateur)).corps.membres.find(m => m.compte === 'lea12345');
  await p.api(`/teams/${p.A.teamId}/membres/${lea.id}`, p.s.fondateur, { methode: 'PATCH', corps: { roleId: role.corps.id } });
  assert.equal((await p.api(p.d, p.s.lea12345)).statut, 200);
});

test('isolation : un membre de la team B ne voit ni ne change rien de la team A ; chaque événement va au webhook de SA team', async () => {
  const p = await preparer();
  await p.webhook();
  await p.webhook(p.s.bob12345, URL_B, p.B.teamId);
  // Bob (Manager de B) est un étranger pour A : 404, comme une team inexistante.
  for (const [methode, chemin, corps] of [
    ['GET', p.d, undefined],
    ['PUT', `${p.d}/webhook`, { url: URL_B }],
    ['DELETE', `${p.d}/webhook`, undefined],
    ['POST', `${p.d}/test`, undefined],
    ['PUT', `${p.d}/parametres/event_created`, { actif: false }],
  ]) {
    const r = await p.api(chemin, p.s.bob12345, { methode, corps });
    assert.equal(r.statut, 404, `${methode} ${chemin}`);
    assert.equal(r.corps.code, 'team-introuvable');
  }
  assert.equal((await p.api(p.d, p.s.max12345)).corps.webhook.masque, '…/abcd');
  assert.equal((await p.api(`/teams/${p.B.teamId}/discord`, p.s.bob12345)).corps.webhook.masque, '…/wxyz');
  // Max (Manager de A) n'est rien pour B.
  assert.equal((await p.api(`/teams/${p.B.teamId}/discord`, p.s.max12345)).statut, 404);
  // Réglages indépendants.
  await p.parametre('event_created', { modele: 'Modèle A : {titre}' });
  assert.equal((await p.api(`/teams/${p.B.teamId}/discord`, p.s.bob12345)).corps.parametres.find(x => x.cle === 'event_created').personnalise, false);
  // Chaque événement part vers le webhook de sa team, avec le nom de sa team.
  await p.evenementPlanning({ titre: 'Pour A' });
  await p.evenementPlanning({ titre: 'Pour B' }, p.s.bob12345, p.B.teamId);
  const vers = Object.fromEntries(p.discord.appels.map(a => [texteCharge(a.corps).includes('Pour A') || texteCharge(a.corps).includes('Modèle A') ? 'A' : 'B', a.url]));
  assert.deepEqual(vers, { A: URL_TEST, B: URL_B });
  assert.equal(p.discord.appels.length, 2);
  // Une team sans le module Discord : 404.
  assert.equal((await p.api(p.d, p.s.max12345)).statut, 200);
});

test('module : une team sans le module Discord répond 404 « module désactivé » (même au Fondateur)', async () => {
  const p = await preparer({ preset: 'minimal' });
  for (const [methode, chemin] of [['GET', p.d], ['PUT', `${p.d}/webhook`], ['POST', `${p.d}/test`], ['PUT', `${p.d}/parametres/event_created`]]) {
    const r = await p.api(chemin, p.s.fondateur, { methode, corps: methode === 'GET' ? undefined : { url: URL_TEST } });
    assert.equal(r.statut, 404, chemin);
    assert.equal(r.corps.code, 'module-desactive');
  }
});

// ------------------------------------------------------------------ Bout en bout, faux serveur Discord local

test('e2e : webhook → message de test → un événement du planning est livré à un faux serveur Discord local', async () => {
  const recus = [];
  const serveur = createServer((requete, reponse) => {
    let corps = '';
    requete.on('data', c => (corps += c));
    requete.on('end', () => {
      recus.push({ methode: requete.method, chemin: requete.url, type: requete.headers['content-type'], corps: JSON.parse(corps) });
      reponse.writeHead(204).end();
    });
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const { port } = serveur.address();
  // Le seul « réseau » de l'Esport vers Discord : redirigé vers le serveur local (l'adresse enregistrée reste celle de Discord).
  let panne = false;
  const fetchLocal = async (url, init) => {
    if (panne) throw new TypeError('fetch failed');
    return fetch(String(url).replace('https://discord.com', `http://127.0.0.1:${port}`), { ...init, redirect: 'manual' });
  };
  try {
    const p = await preparer({ discord: { ...fauxDiscord(), fetch: fetchLocal } });
    assert.equal((await p.webhook()).statut, 200);
    assert.equal((await p.parametre('event_created', { roleMention: ROLE })).statut, 200);

    const test = await p.api(`${p.d}/test`, p.s.max12345, { methode: 'POST' });
    assert.equal(test.statut, 200, JSON.stringify(test.corps));
    assert.equal(recus.length, 1);
    assert.deepEqual([recus[0].methode, recus[0].chemin, recus[0].type], ['POST', `/api/webhooks/${ID}/${JETON}`, 'application/json']);
    assert.match(texteCharge(recus[0].corps), /Message de test/);

    // Le Coach ajoute un scrim : l'abonné Discord le met en file, la requête l'envoie.
    const ev = await p.evenementPlanning({ titre: 'Scrim e2e', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' });
    assert.equal(ev.statut, 200);
    assert.equal(recus.length, 2);
    assert.equal(recus[1].corps.content, `<@&${ROLE}>`);
    assert.equal(recus[1].corps.embeds[0].description, '**Nouvel événement** : Scrim e2e (Scrim), le jeudi 22 octobre à 20:30.');
    assert.equal(recus[1].corps.embeds[0].color, 0x7c3aed, 'couleur du type « scrim »');
    assert.match(recus[1].corps.embeds[0].title, /⚔️ Scrim · Scrim e2e/);
    assert.deepEqual(recus[1].corps.allowed_mentions, { parse: [], roles: [ROLE] });
    assert.match(recus[1].corps.username, /Team Alpha/);
    assert.equal((await p.file())[0].statut, 'envoye');
    const etat = (await p.api(p.d, p.s.max12345)).corps;
    assert.equal(etat.envois[0].statut, 'envoye');
    assert.ok(etat.webhook.dernierSucces);
    assert.ok(!JSON.stringify(etat).includes(JETON));

    // Discord tombe : le message attend ; Discord revient : le cron le livre.
    panne = true;
    await p.evenementPlanning({ titre: 'Hors ligne', date: '2026-10-23' });
    const [, attente] = await p.file();
    assert.deepEqual([attente.statut, Number(attente.essais)], ['attente', 1]);
    assert.equal(recus.length, 2);
    panne = false;
    await traiterFile(p.b.base, { cle: CLE, fetch: fetchLocal, maintenant: Date.parse(attente.prochain_essai_le) });
    assert.equal(recus.length, 3);
    assert.match(texteCharge(recus[2].corps), /Hors ligne/);
    assert.equal((await p.file())[1].statut, 'envoye');
  } finally {
    serveur.closeAllConnections();
    serveur.close();
  }
});
