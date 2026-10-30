/**
 * Devblog (migration 0036, docs/esport/devblog.md) :
 *  - premier devblog posé en BROUILLON (jamais publié tout seul), invisible des membres ;
 *  - permissions : gestion réservée au Fondateur, délégable par devblog.gerer (désactivée par défaut, même pour
 *    le Second CEO) ;
 *  - fenêtre « Nouveautés » : une seule fois par compte (marque en base) ; un nouveau membre ne voit que le dernier ;
 *  - rendu Discord dans la DA (snapshot), découpage au-delà de 2000 caractères ;
 *  - publication : anglais puis fil « 🇫🇷 Version française », @here une seule fois (jamais dans le fil),
 *    idempotence, correction rééditée ;
 *  - IA : version anglaise proposée (texte du devblog seulement) ; RGPD, export / import.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { URL_TEST } from './discord-aide.mjs';
import { LIMITE_DISCORD, decouperDiscord, messagesDiscord, texteDiscord } from '../noyau/devblog/regles.mjs';
import { ID_PREMIER_DEVBLOG, PREMIER_DEVBLOG_EN, PREMIER_DEVBLOG_FR } from '../noyau/devblog/premier.mjs';
import { CONSIGNE_TRADUCTION, servicesDevblog } from '../noyau/devblog/service.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';
import { baseMigree } from './base.mjs';

const JETON_BOT = 'jeton-bot-de-test';
const SALON = '700000000000000001';

/** Faux Discord : chaque appel est noté ; les créations rendent un identifiant de message (et du salon). */
function fauxDiscord() {
  const appels = [];
  let n = 900000000000000000n;
  const fetch = async (url, init) => {
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ url: String(url), methode: init.method, corps, bot: Boolean(init.headers?.Authorization) });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (init.method === 'PATCH') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    n += 1n;
    return new Response(JSON.stringify({ id: String(n), channel_id: SALON }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { appels, fetch };
}

async function preparer({ bot = true } = {}) {
  const d = fauxDiscord();
  const b = await banc({ fetchDiscord: d.fetch, discordBot: bot ? { jetonBot: JETON_BOT } : {} });
  const A = await teamAvecMembres(b, { membres: { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const f = A.sessions.fondateur;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const ok = async (chemin, jeton, options) => {
    const r = await api(chemin, jeton, options);
    assert.equal(r.statut, 200, `${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  return { b, A, f, api, ok, d };
}

/** Publie le premier devblog dans l'app (le Fondateur l'a relu). */
async function publierPremier({ ok, f }) {
  return ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f, { methode: 'PATCH', corps: { statut: 'publie' } });
}

test('premier devblog : posé en brouillon (FR et EN), invisible des membres, jamais publié tout seul', async () => {
  const { A, f, api, ok } = await preparer();
  const l = await ok('/devblog', f);
  assert.equal(l.gestion, true);
  assert.equal(l.entrees.length, 1);
  const e = l.entrees[0];
  assert.equal(e.id, ID_PREMIER_DEVBLOG);
  assert.equal(e.statut, 'brouillon');
  assert.equal(e.publieLe, null);
  assert.equal(e.fr.sections.length, 6);
  assert.equal(e.en.sections.length, 6);
  assert.deepEqual(e.fr.sections.map(s => s.emoji), ['🎮', '📣', '👥', '🤖', '🧠', '🔧']);
  // Ton du devblog : pas de noms de fournisseurs ni de technologies.
  const tout = JSON.stringify([PREMIER_DEVBLOG_FR, PREMIER_DEVBLOG_EN]);
  for (const mot of ['whisper', 'Whisper', 'ONNX', 'NVIDIA', 'Mistral', 'gpt', 'PostgreSQL', 'SQLite', 'Node']) assert.ok(!tout.includes(mot), mot);
  // Membres : rien (ni liste, ni détail, ni fenêtre Nouveautés).
  const lea = A.sessions.lea12345;
  assert.deepEqual((await ok('/devblog', lea)).entrees, []);
  assert.equal((await api(`/devblog/${ID_PREMIER_DEVBLOG}`, lea)).statut, 404);
  assert.equal((await ok('/devblog/nouveautes', lea)).entree, null);
  assert.equal((await ok('/devblog/nouveautes', f)).entree, null);
  // Supprimé, il ne revient pas.
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f, { methode: 'DELETE' });
  assert.deepEqual((await ok('/devblog', f)).entrees, []);
});

test('permissions : Fondateur seul par défaut (Second CEO compris), délégable par devblog.gerer', async () => {
  const { b, A, f, api, ok } = await preparer();
  const max = A.sessions.max12345;
  assert.equal((await ok('/moi', f)).peutGererDevblog, true);
  assert.equal((await ok('/moi', max)).peutGererDevblog, false);
  for (const [chemin, methode, corps] of [
    ['/devblog', 'POST', {}],
    [`/devblog/${ID_PREMIER_DEVBLOG}`, 'PATCH', { statut: 'publie' }],
    [`/devblog/${ID_PREMIER_DEVBLOG}`, 'DELETE', undefined],
    ['/devblog/salons', 'GET', undefined],
    ['/devblog/salons', 'PUT', { defaut: [] }],
    ['/devblog/ia/traduire', 'POST', { fr: PREMIER_DEVBLOG_FR }],
  ]) {
    const r = await api(chemin, max, { methode, corps });
    assert.equal(r.statut, 403, `${methode} ${chemin}`);
  }
  // Second CEO : la permission n'est PAS cochée par défaut.
  const roles = (await ok('/roles-permissions', f)).globaux.roles;
  const sc = roles.find(r => r.cle === 'second_ceo');
  assert.ok(!sc.permissions.includes('devblog.gerer'));
  await ok(`/roles-permissions/globaux/${sc.id}/comptes`, f, { methode: 'POST', corps: { compte: 'max12345' } });
  assert.equal((await ok('/moi', max)).peutGererDevblog, false);
  assert.equal((await api('/devblog', max, { methode: 'POST', corps: {} })).statut, 403);
  // Rôle du club « Rédaction devblog » : délégation.
  const role = await ok('/roles-permissions/globaux', f, { methode: 'POST', corps: { nom: 'Rédaction devblog', couleur: '#22a879', permissions: ['devblog.gerer'] } });
  const id = (role.role ?? role.roles?.find(r => r.nom === 'Rédaction devblog') ?? (await ok('/roles-permissions', f)).globaux.roles.find(r => r.nom === 'Rédaction devblog')).id;
  await ok(`/roles-permissions/globaux/${id}/comptes`, f, { methode: 'POST', corps: { compte: 'max12345' } });
  assert.equal((await ok('/moi', max)).peutGererDevblog, true);
  const cree = await ok('/devblog', max, { methode: 'POST', corps: { fr: { titre: 'Petit correctif' } } });
  assert.equal(cree.entree.statut, 'brouillon');
  assert.equal((await ok('/devblog', max)).entrees.length, 2);
  // Publication : versions française ET anglaise complètes.
  const refus = await api(`/devblog/${cree.entree.id}`, max, { methode: 'PATCH', corps: { statut: 'publie' } });
  assert.equal(refus.statut, 400);
  assert.equal(refus.corps.code, 'devblog-vide');
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM devblog_entrees WHERE statut = 'publie'", [])).n, 0);
});

test('Nouveautés : une seule fois par compte (en base) ; un nouveau membre ne voit que le dernier devblog', async () => {
  const { b, A, f, api, ok } = await preparer();
  await publierPremier({ ok, f });
  const lea = A.sessions.lea12345;
  const n1 = await ok('/devblog/nouveautes', lea);
  assert.equal(n1.entree.id, ID_PREMIER_DEVBLOG);
  assert.equal(n1.entree.en.titre, 'New Update!');
  // Rouverte (nouvelle session, autre appareil) : toujours là tant que « J'ai compris » n'est pas touché.
  assert.equal((await ok('/devblog/nouveautes', await b.session('lea12345'))).entree.id, ID_PREMIER_DEVBLOG);
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}/vu`, lea, { methode: 'POST' });
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}/vu`, lea, { methode: 'POST' });
  assert.equal((await ok('/devblog/nouveautes', lea)).entree, null);
  assert.equal((await ok('/devblog/nouveautes', await b.session('lea12345'))).entree, null);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM devblog_vus WHERE compte_id = 'lea12345'", [])).n, 1);
  // Les autres comptes ne sont pas concernés par la marque de Léa.
  assert.equal((await ok('/devblog/nouveautes', A.sessions.max12345)).entree.id, ID_PREMIER_DEVBLOG);

  // Deuxième devblog publié plus tard : Léa le voit (une fois).
  b.horloge.t += 60_000;
  const deux = await ok('/devblog', f, { methode: 'POST', corps: { date: '2026-11-02', version: '2.1', fr: { titre: 'Correctifs', sections: [{ emoji: '🔧', titre: 'Corrections', puces: [{ nom: 'Planning', description: 'Plus rapide.' }] }] }, en: { titre: 'Fixes', sections: [{ emoji: '🔧', titre: 'Fixes', puces: [{ nom: 'Schedule', description: 'Faster.' }] }] } } });
  await ok(`/devblog/${deux.entree.id}`, f, { methode: 'PATCH', corps: { statut: 'publie' } });
  assert.equal((await ok('/devblog/nouveautes', lea)).entree.id, deux.entree.id);
  // Nouveau membre : seulement le DERNIER, jamais l'historique ; une fois vu, plus rien.
  const neo = await b.session('neo12345', 'Néo');
  const vue = await ok('/devblog/nouveautes', neo);
  assert.equal(vue.entree.id, deux.entree.id);
  assert.equal(vue.entree.version, '2.1');
  await ok(`/devblog/${deux.entree.id}/vu`, neo, { methode: 'POST' });
  assert.equal((await ok('/devblog/nouveautes', neo)).entree, null);
  // Historique (« Voir tous les devblogs ») : tous les publiés, du plus récent au plus ancien, pour tous les membres.
  assert.deepEqual((await ok('/devblog', neo)).entrees.map(e => e.id), [deux.entree.id, ID_PREMIER_DEVBLOG]);
  // Un brouillon ne se marque pas « vu » ; un devblog repassé en brouillon disparaît des Nouveautés.
  await ok(`/devblog/${deux.entree.id}`, f, { methode: 'PATCH', corps: { statut: 'brouillon' } });
  assert.equal((await api(`/devblog/${deux.entree.id}/vu`, lea, { methode: 'POST' })).statut, 404);
  assert.equal((await ok('/devblog/nouveautes', lea)).entree, null, 'le premier a déjà été vu par Léa');
});

// ------------------------------------------------------------------ Rendu Discord

test('rendu Discord : DA du devblog (snapshot), anglais avec @here à la fin, français sans mention', () => {
  const entree = {
    date: '2026-10-30',
    version: '',
    contenuFr: {
      titre: 'Nouvelle Mise à Jour !',
      intro: 'Salut à tous ! Voici ce qui change :',
      sections: [
        { emoji: '📊', titre: 'Nouvelles Fonctionnalités', puces: [{ nom: 'Page Statistiques', description: 'Un meilleur suivi global.' }, { nom: 'Gestion des rôles', description: 'Modifiez un rôle existant.' }] },
        { emoji: '🔧', titre: 'Technique & Corrections', puces: [{ nom: 'Bug fixes', description: 'Plus de stabilité. @everyone <@123456789>' }] },
      ],
      conclusion: 'Merci pour vos retours et bonne navigation sur appdashboard.fr ! 🚀',
    },
    contenuEn: {
      titre: 'New Update!',
      intro: 'Hi everyone! Here’s what’s new:',
      sections: [{ emoji: '📊', titre: 'New Features', puces: [{ nom: 'Statistics page', description: 'Better overall tracking.' }] }],
      conclusion: 'Thanks for your feedback! 🚀',
    },
  };
  const m = messagesDiscord(entree, { here: true });
  assert.deepEqual(m.en, ['🚀 DEVBLOG — New Update! 🛠️\n\nHi everyone! Here’s what’s new:\n\n📊 **New Features**\n• **Statistics page:** Better overall tracking.\n\nThanks for your feedback! 🚀 @here']);
  assert.deepEqual(m.fr, [
    '🚀 DEVBLOG — Nouvelle Mise à Jour ! 🛠️\n\nSalut à tous ! Voici ce qui change :\n\n📊 **Nouvelles Fonctionnalités**\n• **Page Statistiques :** Un meilleur suivi global.\n• **Gestion des rôles :** Modifiez un rôle existant.\n\n🔧 **Technique & Corrections**\n• **Bug fixes :** Plus de stabilité. @​everyone <​@123456789>\n\nMerci pour vos retours et bonne navigation sur appdashboard.fr ! 🚀',
  ]);
  // Version facultative : petite ligne sous le titre.
  assert.match(texteDiscord({ ...entree, version: '2.1', contenu: entree.contenuEn }, 'en'), /^🚀 DEVBLOG — New Update! 🛠️\n-# Version 2\.1 · 30 October 2026\n\n/);
  // Sans @here : aucune mention.
  assert.ok(!messagesDiscord(entree, { here: false }).en.join('').includes('@here'));
  // Premier devblog : DA respectée dans les deux langues.
  const p = messagesDiscord({ date: '2026-10-30', version: '', contenuFr: PREMIER_DEVBLOG_FR, contenuEn: PREMIER_DEVBLOG_EN }, { here: true });
  assert.ok(p.fr[0].startsWith('🚀 DEVBLOG — Nouvelle Mise à Jour ! 🛠️\n\nSalut à tous !'));
  assert.ok(p.fr.join('\n\n').includes('🎮 **Compétition & Jeux**\n• **Profils de jeu :** '));
  assert.ok(p.en.join('\n\n').includes('🎮 **Competition & Games**\n• **Game profiles:** '));
  assert.ok(p.en.at(-1).endsWith('enjoy browsing appdashboard.fr! 🚀 @here'));
  assert.equal(p.en.join('').match(/@here/g).length, 1);
  assert.ok(!p.fr.join('').includes('@here'));
  for (const x of [...p.en, ...p.fr]) assert.ok(x.length <= LIMITE_DISCORD);
});

test('découpage : au-delà de 2000 caractères, plusieurs messages propres (entre sections, puis lignes, puis mots)', () => {
  const sections = Array.from({ length: 8 }, (_, i) => ({ emoji: '✨', titre: `Section ${i + 1}`, puces: Array.from({ length: 6 }, (_, j) => ({ nom: `Ajout ${j + 1}`, description: `Une description assez longue pour remplir le message numéro ${i}-${j}, avec des mots en plus.` })) }));
  const contenu = { titre: 'Très grosse mise à jour', intro: 'Intro.', sections, conclusion: 'Merci !' };
  const m = messagesDiscord({ date: '2026-10-30', version: '', contenuFr: contenu, contenuEn: contenu }, { here: true });
  assert.ok(m.en.length >= 3, `${m.en.length} messages`);
  for (const x of m.en) assert.ok(x.length <= LIMITE_DISCORD && x.trim() === x && x.length > 0);
  // Coupé ENTRE les sections : chaque message (sauf le premier) commence par un titre de section ou la fin.
  for (const x of m.en.slice(1)) assert.match(x, /^(✨ \*\*Section \d\*\*|Merci)/);
  // Rien de perdu, rien d'ajouté.
  assert.equal(m.en.join('\n\n'), texteDiscord({ date: '2026-10-30', version: '', contenu }, 'en', { here: true }));
  assert.equal(m.en.join('').match(/@here/g).length, 1);
  assert.ok(m.en.at(-1).endsWith('@here'));
  // Un bloc plus long qu'un message : coupé entre les lignes, puis une ligne géante entre les mots.
  const enorme = `A\n\n${Array.from({ length: 60 }, (_, i) => `• ligne ${i} ${'x'.repeat(50)}`).join('\n')}\n\n${'mot '.repeat(800).trim()}`;
  const parts = decouperDiscord(enorme);
  for (const x of parts) assert.ok(x.length <= LIMITE_DISCORD);
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), enorme.replace(/\s+/g, ' '));
  assert.deepEqual(decouperDiscord(''), []);
});

// ------------------------------------------------------------------ Publication Discord

test('publication Discord : anglais puis fil 🇫🇷 Version française, @here une seule fois, idempotence, correction rééditée', async () => {
  const { b, A, f, api, ok, d } = await preparer();
  // Brouillon : pas de publication Discord.
  const sal = await ok('/devblog/salons', f, { methode: 'PUT', corps: { webhook: { nom: 'annonces-club', url: URL_TEST } } });
  const club = sal.salons.find(s => s.nom === 'annonces-club');
  assert.ok(club);
  assert.deepEqual(sal.defaut, [club.cle], 'le nouveau salon du club est coché par défaut');
  assert.ok(!JSON.stringify(sal).includes(URL_TEST.split('/').at(-1)), 'jeton du webhook jamais renvoyé');
  assert.equal((await api(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f, { methode: 'POST', corps: { cibles: [club.cle] } })).corps.code, 'devblog-brouillon');
  await publierPremier({ ok, f });

  // Aperçu avant envoi.
  const apercu = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f);
  assert.equal(apercu.pretAPublier, true);
  assert.ok(apercu.apercu.en.at(-1).endsWith('@here'));
  assert.ok(!(await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord?here=0`, f)).apercu.en.join('').includes('@here'));
  assert.equal((await api(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f, { methode: 'POST', corps: { cibles: ['salon:inconnu'] } })).corps.code, 'devblog-salon-inconnu');

  const r = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f, { methode: 'POST', corps: { cibles: [club.cle], mentionHere: true } });
  assert.deepEqual(r.resultats, [{ cible: club.cle, etat: 'publication' }]);
  const posts = d.appels.filter(a => a.methode === 'POST');
  const en = posts.filter(a => !a.url.includes('thread_id') && !a.url.includes('/threads'));
  const fil = posts.filter(a => a.url.includes('/threads'));
  const fr = posts.filter(a => a.url.includes('thread_id'));
  assert.equal(en.length, apercu.apercu.en.length);
  assert.equal(fil.length, 1);
  assert.equal(fr.length, apercu.apercu.fr.length);
  // Ordre : anglais, puis le fil (créé par le bot sur le PREMIER message anglais), puis le français dans le fil.
  assert.deepEqual(posts.map(a => (a.url.includes('/threads') ? 'fil' : a.url.includes('thread_id') ? 'fr' : 'en')), [...en.map(() => 'en'), 'fil', ...fr.map(() => 'fr')]);
  assert.ok(fil[0].bot);
  assert.match(fil[0].url, new RegExp(`/channels/${SALON}/messages/\\d+/threads$`));
  assert.ok(fil[0].corps.name.startsWith('🇫🇷 Version française · DEVBLOG — Nouvelle Mise à Jour !'));
  assert.deepEqual(en.map(a => a.corps.content), apercu.apercu.en);
  assert.deepEqual(fr.map(a => a.corps.content), apercu.apercu.fr);
  // Pas d'embed : du texte ; @here une seule fois, autorisé sur ce seul message.
  for (const a of posts.filter(x => x.corps?.content)) assert.equal(a.corps.embeds, undefined);
  const avecHere = posts.filter(a => a.corps?.content?.includes('@here'));
  assert.equal(avecHere.length, 1);
  assert.deepEqual(avecHere[0].corps.allowed_mentions, { parse: ['everyone'] });
  for (const a of [...en, ...fr].filter(a => a !== avecHere[0])) assert.deepEqual(a.corps.allowed_mentions, { parse: [] });
  for (const a of fr) assert.ok(!a.corps.content.includes('@here'));
  const etat = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f);
  assert.equal(etat.publications[0].statut, 'envoye');
  assert.equal(etat.publications[0].aJour, true);
  assert.equal(etat.publications[0].filFrancais, true);

  // Idempotence : republier sans changement ne poste rien.
  const avant = d.appels.length;
  const r2 = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f, { methode: 'POST', corps: { cibles: [club.cle] } });
  assert.deepEqual(r2.resultats, [{ cible: club.cle, etat: 'deja_publie' }]);
  await b.appel('/notifications/lues', { methode: 'POST', jeton: f, corps: {} });
  assert.equal(d.appels.length, avant);
  assert.equal((await b.base.premier('SELECT COUNT(*) AS n FROM devblog_discord', [])).n, 1);

  // Correction : le texte change → messages RÉÉDITÉS (aucun nouveau message, aucune mention).
  const e = (await ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f)).entree;
  e.en.intro = 'Hi everyone! A big update just landed. Here’s what’s new:';
  e.fr.intro = 'Salut à tous ! Une grosse mise à jour vient d’arriver. Voici ce qui change :';
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f, { methode: 'PATCH', corps: { fr: e.fr, en: e.en } });
  assert.equal((await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f)).publications[0].aJour, false);
  const r3 = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f, { methode: 'POST', corps: { cibles: [club.cle] } });
  assert.deepEqual(r3.resultats, [{ cible: club.cle, etat: 'correction' }]);
  const nouveaux = d.appels.slice(avant);
  assert.ok(nouveaux.length > 0);
  assert.ok(nouveaux.every(a => a.methode === 'PATCH'), JSON.stringify(nouveaux.map(a => a.methode)));
  assert.equal(nouveaux.length, apercu.apercu.en.length + apercu.apercu.fr.length);
  assert.ok(nouveaux.some(a => a.corps.content.includes('A big update just landed')));
  assert.ok(nouveaux.some(a => a.url.includes('thread_id') && a.corps.content.includes('vient d’arriver')));
  for (const a of nouveaux) assert.deepEqual(a.corps.allowed_mentions, { parse: [] });
  assert.equal((await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f)).publications[0].aJour, true);

  // Une team sans salon Discord (ni bot ni webhook) n'est pas proposée.
  assert.ok(!(await ok('/devblog/salons', f)).salons.some(s => s.cle === `team:${A.teamId}`));
});

test('publication Discord : sans bot, l’anglais part seul (fil français impossible, signalé) ; salon du bot sans jeton refusé', async () => {
  const { f, ok, d } = await preparer({ bot: false });
  const sal = await ok('/devblog/salons', f, { methode: 'PUT', corps: { webhook: { nom: 'annonces', url: URL_TEST } } });
  await publierPremier({ ok, f });
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f, { methode: 'POST', corps: { cibles: sal.defaut, mentionHere: false } });
  assert.ok(d.appels.length > 0);
  assert.ok(d.appels.every(a => !a.url.includes('thread')));
  assert.ok(d.appels.every(a => !a.corps.content.includes('@here')));
  const p = (await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f)).publications[0];
  assert.equal(p.statut, 'envoye');
  assert.equal(p.filFrancais, false);
  assert.match(p.erreur, /Version française non publiée/);
  // Salon lié au bot : identifiant numérique obligatoire.
  const refus = await (async () => {
    try {
      return await ok('/devblog/salons', f, { methode: 'PUT', corps: { salonBot: { id: '#annonces' } } });
    } catch (e) {
      return e;
    }
  })();
  assert.ok(refus instanceof Error);
  const bot = await ok('/devblog/salons', f, { methode: 'PUT', corps: { salonBot: { id: SALON, nom: 'annonces-bot' } } });
  assert.ok(bot.salons.some(s => s.cle === 'bot:club' && s.nom === 'annonces-bot'));
});

test('publication Discord par le bot (salon du club lié au bot) : nonce, fil, découpage long ; correction plus courte supprime le surplus', async () => {
  const { f, ok, d } = await preparer();
  await ok('/devblog/salons', f, { methode: 'PUT', corps: { salonBot: { id: SALON, nom: 'annonces' }, defaut: ['bot:club'] } });
  const sections = Array.from({ length: 8 }, (_, i) => ({ emoji: '✨', titre: `Section ${i + 1}`, puces: Array.from({ length: 6 }, (_, j) => ({ nom: `Ajout ${j + 1}`, description: `Une description assez longue pour remplir le message numéro ${i}-${j}, avec des mots en plus.` })) }));
  const long = { titre: 'Grosse mise à jour', intro: 'Intro.', sections, conclusion: 'Merci !' };
  const cree = await ok('/devblog', f, { methode: 'POST', corps: { fr: long, en: { ...long, titre: 'Big update' } } });
  const id = cree.entree.id;
  await ok(`/devblog/${id}`, f, { methode: 'PATCH', corps: { statut: 'publie' } });
  await ok(`/devblog/${id}/discord`, f, { methode: 'POST', corps: { cibles: ['bot:club'] } });
  const posts = d.appels.filter(a => a.methode === 'POST');
  assert.ok(posts.every(a => a.bot));
  const en = posts.filter(a => a.url.endsWith(`/channels/${SALON}/messages`));
  assert.ok(en.length >= 3);
  assert.ok(en.every(a => a.corps.nonce && a.corps.enforce_nonce === true && a.corps.username === undefined));
  assert.equal(new Set(posts.map(a => a.corps.nonce).filter(Boolean)).size, posts.filter(a => a.corps.nonce).length, 'un nonce par message');
  assert.equal(posts.filter(a => a.corps.content?.includes('@here')).length, 1);
  assert.ok(en.at(-1).corps.content.includes('@here'));
  // Correction plus courte : les morceaux en trop sont supprimés, les autres réédités.
  const avant = d.appels.length;
  await ok(`/devblog/${id}`, f, { methode: 'PATCH', corps: { fr: { ...long, sections: sections.slice(0, 1) }, en: { ...long, titre: 'Big update', sections: sections.slice(0, 1) } } });
  await ok(`/devblog/${id}/discord`, f, { methode: 'POST', corps: { cibles: ['bot:club'] } });
  const apres = d.appels.slice(avant);
  assert.ok(apres.some(a => a.methode === 'DELETE'));
  assert.ok(apres.every(a => a.methode !== 'POST'));
  const etat = (await ok(`/devblog/${id}/discord`, f)).publications[0];
  assert.equal(etat.messages, 1);
  assert.equal(etat.aJour, true);
});

// ------------------------------------------------------------------ IA, RGPD, export

test('IA : version anglaise proposée depuis le français (texte du devblog seulement, tâche légère), structure gardée', async () => {
  const base = await baseMigree();
  const appels = [];
  const discuterPour = async (tache, messages, options) => {
    appels.push({ tache, messages, options });
    const fr = JSON.parse(messages[1].content);
    return { moteur: 'api2', texte: `\`\`\`json\n${JSON.stringify({ titre: 'New Update!', intro: 'Hi!', sections: fr.sections.map(s => ({ titre: `EN ${s.titre}`, puces: s.puces.slice(0, -1).map(p => ({ nom: `EN ${p.nom}`, description: 'Short.' })) })), conclusion: 'Thanks!' })}\n\`\`\`` };
  };
  const dv = servicesDevblog({ base, discuterPour, cle: 'x' });
  const r = await dv.traduire({ compte: 'principal', superAdmin: true }, { fr: PREMIER_DEVBLOG_FR });
  assert.equal(appels.length, 1);
  assert.equal(appels[0].tache, 'traduction');
  assert.equal(appels[0].messages[0].content, CONSIGNE_TRADUCTION);
  // Seul le texte du devblog part : ni compte, ni membre, ni emoji.
  const envoye = appels[0].messages[1].content;
  assert.ok(!envoye.includes('principal') && !envoye.includes('🎮'));
  assert.equal(r.en.titre, 'New Update!');
  assert.equal(r.en.sections.length, PREMIER_DEVBLOG_FR.sections.length);
  assert.deepEqual(r.en.sections.map(s => s.emoji), PREMIER_DEVBLOG_FR.sections.map(s => s.emoji));
  // Une puce oubliée par l'IA garde le texte français (rien ne disparaît).
  assert.equal(r.en.sections[0].puces.length, PREMIER_DEVBLOG_FR.sections[0].puces.length);
  assert.equal(r.en.sections[0].puces[0].nom, 'EN Profils de jeu');
  assert.equal(r.en.sections[0].puces.at(-1).nom, PREMIER_DEVBLOG_FR.sections[0].puces.at(-1).nom);
  // Sans IA configurée : 503 propre ; réponse illisible : 502.
  await assert.rejects(servicesDevblog({ base, cle: 'x' }).traduire({ compte: 'principal', superAdmin: true }, { fr: PREMIER_DEVBLOG_FR }), e => e.statut === 503);
  await assert.rejects(servicesDevblog({ base, cle: 'x', discuterPour: async () => ({ texte: 'désolé' }) }).traduire({ compte: 'principal', superAdmin: true }, { fr: PREMIER_DEVBLOG_FR }), e => e.statut === 502);
  await assert.rejects(dv.traduire({ compte: 'lea12345', superAdmin: false }, { fr: PREMIER_DEVBLOG_FR }), e => e.statut === 403);
});

test('RGPD et export : marques « vu » exportées et supprimées avec le compte ; export / import de la base', async () => {
  const { b, A, f, ok } = await preparer();
  await publierPremier({ ok, f });
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}/vu`, A.sessions.lea12345, { methode: 'POST' });
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}/vu`, A.sessions.max12345, { methode: 'POST' });
  const exp = await ok('/moi/export', A.sessions.lea12345);
  assert.deepEqual(exp.devblogVus.map(v => v.devblog), [ID_PREMIER_DEVBLOG]);
  // Suppression par le compte lui-même, puis par l'Administration.
  await ok('/moi', A.sessions.lea12345, { methode: 'DELETE' });
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM devblog_vus WHERE compte_id = 'lea12345'", [])).n, 0);
  await ok('/admin/comptes/max12345/hub', f, { methode: 'DELETE' });
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM devblog_vus WHERE compte_id = 'max12345'", [])).n, 0);
  // Le devblog reste.
  assert.equal((await ok('/devblog', f)).entrees.length, 1);
  // Export / import.
  await ok(`/devblog/${ID_PREMIER_DEVBLOG}/vu`, f, { methode: 'POST' });
  const sauvegarde = await exporterBase(b.base);
  assert.equal(sauvegarde.tables.devblog_entrees.length, 1);
  assert.equal(sauvegarde.tables.devblog_vus.length, 1);
  const neuve = await baseMigree();
  await importerBase(neuve, sauvegarde);
  assert.equal((await neuve.premier("SELECT statut FROM devblog_entrees WHERE id = ?", [ID_PREMIER_DEVBLOG])).statut, 'publie');
  assert.equal((await neuve.premier("SELECT COUNT(*) AS n FROM devblog_vus WHERE compte_id = 'principal'", [])).n, 1);
});
