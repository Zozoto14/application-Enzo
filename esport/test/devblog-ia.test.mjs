/**
 * Devblog automatique rédigé par l'IA (docs/esport/devblog.md, « Publication automatique ») : la chaîne réelle
 * cron → service des profils de jeu (répartiteur, ordre, comptage) → connecteur → faux service NVIDIA qui se comporte
 * comme gpt-oss-20b (raisonnement dans `reasoning_content`, réponse coupée quand le budget de jetons est trop court).
 *
 * Cause des échecs quotidiens (« l'IA n'a pas pu le rédiger, un brouillon est à compléter ») : 5000 jetons pour le
 * raisonnement ET les deux langues ; gpt-oss s'arrêtait en route (`finish_reason: "length"`) avec un JSON coupé, que
 * le connecteur rendait comme une réponse normale ; la lecture échouait (« réponse illisible »), sans second essai.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseMigree } from './base.mjs';
import { configIa, creerConnecteur, creerRepartiteurIa } from '../noyau/ia/connecteur.mjs';
import { tacheConfidentielle } from '../noyau/ia/confidentialite.mjs';
import { servicesJeux } from '../noyau/jeux/service.mjs';
import { JETONS_DEVBLOG, TACHE_IA_DEVBLOG, executerDevblogAuto, redigerDevblog } from '../noyau/devblog/auto.mjs';
import { lireRedaction, nettoyerCommit } from '../noyau/devblog/auto-regles.mjs';
import { ecrireReglage } from '../noyau/devblog/publication.mjs';

/** Environnement du serveur : NVIDIA gpt-oss-20b en moteur secondaire seul (IA_ORDRE=api2), pas d'IA locale. */
const ENV = { IA_API2_URL: 'https://integrate.api.nvidia.com/v1', IA_API2_CLE: 'nvapi-cle-de-test-devblog', IA_MODELE2: 'openai/gpt-oss-20b', IA_ORDRE: 'api2' };
/** 18:05 à Paris le 05/11/2026 (heure d'hiver : UTC+1). */
const H18 = Date.parse('2026-11-05T17:05:00.000Z');
const silencieux = { warn() {}, error() {}, info() {} };

const REDACTION = {
  fr: {
    titre: 'Nouvelle Mise à Jour !',
    intro: 'Salut à tous ! Une nouvelle mise à jour est en ligne. Voici ce qui change :',
    sections: [{ emoji: '🎫', titre: 'Tickets', puces: [{ nom: 'Tickets Discord', description: 'Ouvrez un ticket depuis Discord et suivez-le dans l’app.' }] }],
    conclusion: 'Merci pour vos retours et bonne navigation ! 🚀',
  },
  en: {
    titre: 'New Update!',
    intro: 'Hi everyone! A new update is live. Here’s what’s new:',
    sections: [{ emoji: '🎫', titre: 'Tickets', puces: [{ nom: 'Discord tickets', description: 'Open a ticket from Discord and follow it in the app.' }] }],
    conclusion: 'Thanks for your feedback and enjoy! 🚀',
  },
};

/** Devblog d'une vraie journée (six sections de quatre puces, deux langues) : ≈ 1800 jetons de réponse. */
const puces = n => Array.from({ length: 4 }, (_, j) => ({ nom: `Nouveauté ${n}.${j + 1}`, description: 'Une phrase courte et positive qui explique ce qui change pour les membres du club, sur ordinateur comme sur téléphone.' }));
const GRAND = {
  fr: { ...REDACTION.fr, sections: ['🎫', '📋', '🗂️', '🔔', '📱', '🔧'].map((emoji, i) => ({ emoji, titre: `Thème ${i + 1}`, puces: puces(i + 1) })) },
  en: { ...REDACTION.en, sections: ['🎫', '📋', '🗂️', '🔔', '📱', '🔧'].map((emoji, i) => ({ emoji, titre: `Theme ${i + 1}`, puces: puces(i + 1) })) },
};

/**
 * Faux NVIDIA gpt-oss : le raisonnement consomme `raisonnement` jetons (≈ 4 caractères par jeton pour la réponse) ;
 * si `max_tokens` ne suffit pas, la réponse est coupée (`finish_reason: "length"`) au milieu du JSON. `reponses` :
 * réponses successives (objet rendu en JSON, ou texte brut).
 */
function fauxGptOss({ raisonnement = 3500, reponses = [REDACTION] } = {}) {
  const appels = [];
  const fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    appels.push({ url: String(url), corps });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    const texte = typeof r === 'string' ? r : JSON.stringify(r);
    const reste = Math.max(0, corps.max_tokens - raisonnement);
    const coupe = texte.length / 4 > reste;
    const message = { role: 'assistant', content: coupe ? texte.slice(0, reste * 4) : texte, reasoning_content: 'x'.repeat(raisonnement * 4) };
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: coupe ? 'length' : 'stop' }], usage: { prompt_tokens: 3000, completion_tokens: Math.min(corps.max_tokens, raisonnement + Math.ceil(texte.length / 4)) } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { appels, fetch };
}

/** Faux historique git : six commits notables déployés depuis le dernier devblog. */
function fauxGit() {
  const commits = [
    { hash: 'c0ffee0000000000000000000000000000000001', date: '2026-11-04T10:00:00+01:00', sujet: 'Esport : état d’avant', corps: '' },
    { hash: 'c0ffee0000000000000000000000000000000002', date: '2026-11-05T10:00:00+01:00', sujet: 'Tickets Discord, étape 1 : socle et configuration dans l’app', corps: '- Connexion Gateway Discord (WebSocket natif de Node 22) tenue par UN seul\n  processus à la fois\n- Tests : faux serveur Gateway\n- Migration 0054 (SQLite et PostgreSQL)' },
    { hash: 'c0ffee0000000000000000000000000000000003', date: '2026-11-05T11:00:00+01:00', sujet: 'Tickets Discord, étape 3 : tickets dans l’app', corps: '' },
  ];
  return {
    tete: async () => commits.at(-1).hash,
    existe: async h => commits.some(c => c.hash === h),
    commits: async (de, a) => commits.slice(commits.findIndex(c => c.hash === de) + 1, commits.findIndex(c => c.hash === a) + 1),
    deploiements: async () => [],
  };
}

async function preparer(ia) {
  const base = await baseMigree();
  const t = new Date(H18 - 3_600_000).toISOString();
  await base.executer('INSERT INTO comptes (id, pseudo, pseudo_cle, cree_le, maj_le) VALUES (?, ?, ?, ?, ?)', ['principal', 'Fondateur', 'fondateur', t, t]);
  await ecrireReglage(base, 'auto', { actif: true, frequence: 'apres_maj', heure: '18:00', jour: 5, validation: false, mentionHere: true, cibles: [] }, { t });
  await ecrireReglage(base, 'auto_etat', { commit: 'c0ffee0000000000000000000000000000000001', le: t }, { t });
  // Le cron : service des profils de jeu (répartiteur, ordre de repli, comptage), sans IA locale (indisponible).
  const jeux = servicesJeux({ base, maintenant: () => H18, socle: {}, ia: { config: configIa(ENV), fetch: ia.fetch }, travauxIa: 'synchrone', journal: silencieux });
  const passer = () => executerDevblogAuto(base, { source: fauxGit(), discuterPour: jeux.discuterPour, maintenant: H18 });
  const notifications = async () => (await base.tous("SELECT charge FROM notifications WHERE type = 'devblog-auto' ORDER BY cree_le", [])).map(n => JSON.parse(n.charge));
  return { base, passer, notifications };
}

test('routage : la tâche « devblog » n’est pas confidentielle ; elle part à l’API même sans IA locale', async () => {
  assert.equal(tacheConfidentielle(TACHE_IA_DEVBLOG), null);
  const ia = fauxGptOss();
  const rep = creerRepartiteurIa({ moteurs: { api2: creerConnecteur(configIa(ENV).secondaire, { fetch: ia.fetch }), local: { disponible: () => false, indisponible: () => true } }, ordres: configIa(ENV).ordres });
  const r = await rep.discuterPour(TACHE_IA_DEVBLOG, [{ role: 'user', content: 'x' }], { maxJetons: JETONS_DEVBLOG });
  assert.equal(r.moteur, 'api2');
  assert.equal(ia.appels[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
});

test('connecteur : réponse coupée (« length ») avec un JSON incomplet → ia-reponse-tronquee, jamais un texte rendu tel quel', async () => {
  const cx = creerConnecteur(configIa(ENV).secondaire, { fetch: fauxGptOss({ raisonnement: 4000, reponses: [GRAND] }).fetch });
  const e = await cx.discuter([{ role: 'user', content: 'x' }], { maxJetons: 4200 }).catch(x => x);
  assert.equal(e.code, 'ia-reponse-tronquee');
  // JSON complet malgré « length » : utilisable.
  const complet = creerConnecteur(configIa(ENV).secondaire, {
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' }, finish_reason: 'length' }] }), { status: 200 }),
  });
  assert.equal((await complet.discuter([{ role: 'user', content: 'x' }])).texte, '{"ok": true}');
  // Texte libre demandé (json: false) : rendu, même coupé.
  const libre = creerConnecteur(configIa(ENV).secondaire, { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'texte coupé' }, finish_reason: 'length' }] }), { status: 200 }) });
  assert.equal((await libre.discuter([{ role: 'user', content: 'x' }], { json: false })).texte, 'texte coupé');
});

test('ancien budget (5000 jetons) : gpt-oss coupé en route, c’était l’échec quotidien', async () => {
  assert.ok(JSON.stringify(GRAND).length / 4 > 1500);
  const cx = creerConnecteur(configIa(ENV).secondaire, { fetch: fauxGptOss({ raisonnement: 4000, reponses: [GRAND] }).fetch });
  const e = await cx.discuter([{ role: 'user', content: 'x' }], { maxJetons: 5000 }).catch(x => x);
  assert.equal(e.code, 'ia-reponse-tronquee');
});

test('cron : devblog publié par gpt-oss (budget large, JSON par la consigne, effort low), aucune notification d’échec', async () => {
  const ia = fauxGptOss({ raisonnement: 4000, reponses: [GRAND] });
  const { base, passer, notifications } = await preparer(ia);
  const r = await passer();
  assert.equal(r.statut, 'publie', JSON.stringify(r));
  assert.equal(r.moteur, 'api2');
  assert.equal(ia.appels.length, 1);
  const corps = ia.appels[0].corps;
  assert.equal(corps.model, 'openai/gpt-oss-20b');
  assert.equal(corps.max_tokens, JETONS_DEVBLOG);
  assert.equal(corps.reasoning_effort, 'low');
  assert.equal(corps.response_format, undefined, 'sortie non contrainte : le JSON est demandé par la consigne');
  // Rien de technique n'est envoyé : puces techniques écartées, noms de technologies retirés, puce repliée recollée.
  const envoye = corps.messages.at(-1).content;
  for (const t of ['Tests', 'Migration', 'SQLite', 'PostgreSQL', 'Node']) assert.ok(!envoye.includes(t), t);
  assert.match(envoye, /tenue par UN seul processus à la fois/);
  const e = await base.premier("SELECT statut FROM devblog_entrees WHERE id = 'devblog-auto-2026-11-05'", []);
  assert.equal(e.statut, 'publie');
  assert.deepEqual((await notifications()).map(n => n.etat), ['publie']);
  const appel = await base.premier("SELECT genre, moteur, statut FROM ia_appels WHERE genre = 'devblog'", []);
  assert.deepEqual({ ...appel }, { genre: 'devblog', moteur: 'api2', statut: 'ok' });
});

test('cron : première réponse refusée (nom de technologie) ou coupée → second essai avec le motif, puis publié', async () => {
  const jargon = { ...REDACTION, fr: { ...REDACTION.fr, intro: 'Salut à tous ! Grâce à l’API Discord, voici ce qui change :' } };
  for (const premiere of [jargon, `${JSON.stringify(REDACTION).slice(0, 120)}`]) {
    const ia = fauxGptOss({ reponses: [premiere, REDACTION] });
    const { passer, notifications } = await preparer(ia);
    const r = await passer();
    assert.equal(r.statut, 'publie', JSON.stringify(r));
    assert.equal(ia.appels.length, 2);
    const relance = ia.appels[1].corps.messages.at(-1);
    assert.equal(relance.role, 'user');
    assert.match(relance.content, /previous answer was rejected/);
    assert.ok(!relance.content.includes('Grâce à'), 'la réponse refusée n’est jamais renvoyée');
    assert.deepEqual((await notifications()).map(n => n.etat), ['publie']);
  }
});

test('cron : rien de notable selon l’IA (« rien », ou sections vides) → rien créé, aucune notification', async () => {
  for (const reponse of [{ rien: true }, { rien: true, fr: { sections: [] }, en: { sections: [] } }, { fr: { titre: 'x', sections: [] }, en: { titre: 'y', sections: [] } }]) {
    const ia = fauxGptOss({ reponses: [reponse] });
    const { base, passer, notifications } = await preparer(ia);
    const r = await passer();
    assert.equal(r.statut, 'rien', JSON.stringify(reponse));
    assert.equal((await base.premier('SELECT COUNT(*) AS n FROM devblog_entrees WHERE origine = ?', ['auto'])).n, 0);
    assert.deepEqual(await notifications(), []);
  }
  assert.deepEqual(lireRedaction({ rien: 'true' }), { rien: true });
});

test('cron : IA en échec deux fois → brouillon de secours et UNE notification (comme avant)', async () => {
  const ia = fauxGptOss({ reponses: ['désolé, je ne peux pas'] });
  const { passer, notifications } = await preparer(ia);
  const r = await passer();
  assert.equal(r.statut, 'echec');
  assert.equal(ia.appels.length, 2);
  assert.deepEqual((await notifications()).map(n => [n.etat, n.motif]), [['echec', 'ia']]);
});

test('redigerDevblog : une erreur qui n’est pas une réponse (clé refusée…) n’est pas redemandée', async () => {
  let n = 0;
  const e = await redigerDevblog(async () => {
    n++;
    throw Object.assign(new Error('clé'), { code: 'ia-cle-refusee' });
  }, [{ sujet: 'Esport : x', puces: [] }]).catch(x => x);
  assert.equal(e.code, 'ia-cle-refusee');
  assert.equal(n, 1);
});

test('commits : puces repliées recollées, puces techniques écartées, noms de technologies retirés', () => {
  const c = nettoyerCommit({
    sujet: 'Tickets Discord : relecture par l’API en secours',
    corps: '- Ouverture par le bouton d’un panneau, ou par la\n  commande du bot\n- Tests : faux serveur\n- Migration 0055 (SQLite et PostgreSQL)\n- Cron : fermeture après 7 jours\n\nCo-Authored-By: X <x@y.z>',
  });
  assert.equal(c.sujet, 'Tickets Discord : relecture par l’ en secours');
  assert.deepEqual(c.puces, ['Ouverture par le bouton d’un panneau, ou par la commande du bot']);
});
