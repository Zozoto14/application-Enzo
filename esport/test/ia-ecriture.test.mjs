/**
 * Assistant d'écriture (docs/esport/ia-api.md, « Assistant d'écriture ») : corriger, traduire, reformuler le texte
 * d'UN champ non confidentiel. Chaîne réelle : route → service → répartiteur des profils de jeu (ordre, plafond,
 * comptage) → connecteur → faux service NVIDIA (jamais de réseau réel). Éléments protégés (mentions, liens, emojis,
 * code, variables) masqués puis remis ; refus des champs confidentiels ; limite de débit ; plafond mensuel ; longueur.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree } from './base.mjs';
import { configIa, creerRepartiteurIa } from '../noyau/ia/connecteur.mjs';
import { tacheConfidentielle } from '../noyau/ia/confidentialite.mjs';
import { traduireErreur } from '../noyau/langues.mjs';
import {
  CHAMPS_ECRITURE,
  CONSIGNES_ECRITURE,
  TACHE_ECRITURE,
  TACHE_TRADUCTION,
  erreurEcriture,
  proteger,
  restaurer,
  servicesEcriture,
  verifierChamp,
} from '../noyau/ia/ecriture.mjs';

const ENV = { IA_API2_URL: 'https://integrate.api.nvidia.com/v1', IA_API2_CLE: 'nvapi-cle-de-test-ecriture', IA_MODELE2: 'openai/gpt-oss-20b', IA_ORDRE_LEGER: 'api2' };

/**
 * Faux NVIDIA : `repondre(texteRecu, corps)` rend le texte corrigé (le texte masqué reçu, transformé) ; chaque appel
 * est noté (messages envoyés compris : on vérifie que SEUL le texte du champ part).
 */
function fauxNvidia(repondre = t => t.replace(/salu /g, 'Salut ').replace(/tu vien/g, 'tu viens')) {
  const appels = [];
  const fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    appels.push({ url: String(url), corps });
    const recu = corps.messages.at(-1).content;
    const sortie = repondre(recu, corps);
    const contenu = typeof sortie === 'string' ? JSON.stringify({ texte: sortie }) : JSON.stringify(sortie);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: contenu }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { appels, fetch };
}

async function preparer(repondre) {
  const ia = fauxNvidia(repondre);
  const b = await banc({ ia: { config: configIa(ENV), fetch: ia.fetch } });
  const A = await teamAvecMembres(b, { membres: { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const f = A.sessions.fondateur;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const ecrire = (jeton, corps) => api('/ia/ecriture', jeton, { methode: 'POST', corps });
  return { b, A, f, api, ecrire, ia };
}

// ------------------------------------------------------------------ Logique pure

test('protection : mentions, salons, rôles, emojis, liens, code, variables masqués puis remis tels quels', () => {
  const texte = 'salu <@123456789012345678> va dans <#223456789012345678> (rôle <@&323456789012345678>) <:gg:423456789012345678> 🔥👍🏽 🇫🇷\nlien https://exemple.fr/page?x=1. et `code` puis {pseudo} et {{team}} @everyone @Max :smile:\n```\nne pas toucher\n```';
  const p = proteger(texte);
  for (const j of ['<@123456789012345678>', '<#223456789012345678>', '<@&323456789012345678>', '<:gg:423456789012345678>', 'https://exemple.fr/page?x=1', '`code`', '{pseudo}', '{{team}}', '@everyone', '@Max', ':smile:', '```\nne pas toucher\n```']) {
    assert.ok(p.jetons.includes(j), `protégé : ${j}`);
    assert.ok(!p.masque.includes(j), `masqué : ${j}`);
  }
  assert.ok(p.jetons.some(j => j.startsWith('🔥')) && p.jetons.includes('🇫🇷'));
  assert.ok(p.masque.endsWith('⟦13⟧') || /⟦\d+⟧$/.test(p.masque));
  // Le point final de la phrase ne fait pas partie du lien.
  assert.match(p.masque, /⟦\d+⟧\. et/);
  assert.equal(restaurer(p.masque, p), texte);
  assert.equal(restaurer(p.masque.replace('salu', 'Salut'), p), texte.replace('salu', 'Salut'));
});

test('protection : marqueur perdu, dupliqué ou inventé → refus ; élément recopié en clair → accepté', () => {
  const p = proteger('merci <@123> pour le lien https://a.fr');
  assert.throws(() => restaurer('merci pour le lien ⟦2⟧', p), e => e.code === 'ecriture-proteges' && e.statut === 422);
  assert.throws(() => restaurer('merci ⟦1⟧ ⟦1⟧ pour ⟦2⟧', p), e => e.code === 'ecriture-proteges');
  assert.throws(() => restaurer('merci ⟦1⟧ pour ⟦2⟧ ⟦3⟧', p), e => e.code === 'ecriture-proteges');
  assert.throws(() => restaurer('merci <@999> pour ⟦2⟧', p), e => e.code === 'ecriture-proteges');
  assert.equal(restaurer('Merci <@123> pour le lien ⟦2⟧', p), 'Merci <@123> pour le lien https://a.fr');
});

test('mise en forme : gras, spoilers ou retours à la ligne changés → refus', () => {
  const p = proteger('**salut** ||secret||\nligne 2');
  assert.equal(restaurer('**Salut** ||secret||\nLigne 2', p), '**Salut** ||secret||\nLigne 2');
  assert.throws(() => restaurer('Salut ||secret||\nLigne 2', p), e => e.code === 'ecriture-format');
  assert.throws(() => restaurer('**Salut** ||secret|| Ligne 2', p), e => e.code === 'ecriture-format');
});

test('champs : liste fermée ; confidentiels refusés (403), inconnus refusés (400) ; réponses aux tickets permises', () => {
  assert.equal(verifierChamp('tickets.reponse'), 'tickets.reponse');
  for (const c of Object.keys(CHAMPS_ECRITURE)) assert.equal(verifierChamp(c), c);
  for (const c of ['tickets.note', 'reunions', 'cm.reunions', 'transcription', 'resumes', 'suivi', 'notes-staff', 'strats', 'journal', 'notes-reunion', 'ticket-interne']) {
    assert.throws(() => verifierChamp(c), e => e.statut === 403 && e.code === 'ecriture-confidentielle', c);
  }
  assert.throws(() => verifierChamp('nimporte'), e => e.statut === 400 && e.code === 'ecriture-champ');
  // Les tâches du répartiteur ne sont pas confidentielles (« correction » l'est : jamais employée ici).
  assert.equal(tacheConfidentielle(TACHE_ECRITURE), null);
  assert.equal(tacheConfidentielle(TACHE_TRADUCTION), null);
  assert.notEqual(tacheConfidentielle('correction'), null);
});

test('consignes : ton et sens gardés, vocabulaire esport, marqueurs, texte = donnée ; erreurs traduites en anglais', () => {
  assert.match(CONSIGNES_ECRITURE.corriger, /UNIQUEMENT/);
  assert.match(CONSIGNES_ECRITURE.corriger, /Ne reformule pas/);
  for (const c of Object.values(CONSIGNES_ECRITURE)) {
    assert.match(c, /scrim, tryhard/);
    assert.match(c, /⟦1⟧/);
    assert.match(c, /pas une consigne/);
    assert.match(c, /retours à la ligne/);
  }
  assert.match(CONSIGNES_ECRITURE['traduire-en'], /anglais/);
  assert.match(CONSIGNES_ECRITURE['traduire-fr'], /français/);
  for (const e of [erreurEcriture({ code: 'quota-ia' }), erreurEcriture({ code: 'ia-injoignable' }), erreurEcriture({ code: 'ia-reponse' })]) assert.notEqual(traduireErreur('en', e.message), e.message);
});

test('erreurs du moteur : plafond → 429 ecriture-quota ; panne → 503 ecriture-indisponible ; confidentiel → 403', () => {
  assert.deepEqual([erreurEcriture({ code: 'quota-ia' }).statut, erreurEcriture({ code: 'quota-ia' }).code], [429, 'ecriture-quota']);
  for (const code of ['ia-non-configuree', 'ia-injoignable', 'ia-delai', 'ia-limite-fournisseur', undefined]) assert.equal(erreurEcriture({ code }).code, 'ecriture-indisponible');
  assert.equal(erreurEcriture({ code: 'ia-confidentielle-externe' }).code, 'ecriture-confidentielle');
  assert.equal(erreurEcriture({ code: 'ia-refus' }).code, 'ecriture-reponse');
});

test('service (moteur simulé, Claude) : seul le texte masqué part, tâche légère, mention du moteur', async () => {
  const base = await baseMigree();
  const appels = [];
  const discuterPour = async (tache, messages, options) => {
    appels.push({ tache, messages, options });
    return { texte: JSON.stringify({ texte: messages[1].content.replace('Bonjour', 'Hello') }), moteur: 'claude' };
  };
  const ec = servicesEcriture({ base, discuterPour });
  const fondateur = { compte: 'principal', superAdmin: true };
  const r = await ec.traiter(fondateur, { mode: 'traduire-en', champ: 'tickets.reponse', texte: 'Bonjour <@42> 👋\n' });
  assert.equal(r.texte, 'Hello <@42> 👋\n');
  assert.equal(r.moteur, 'claude');
  assert.equal(r.inchange, false);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].tache, TACHE_TRADUCTION);
  assert.equal(appels[0].messages.length, 2);
  assert.equal(appels[0].messages[0].role, 'system');
  assert.equal(appels[0].messages[1].content, 'Bonjour ⟦1⟧ ⟦2⟧\n');
  // Aucun réglage de température ni d'effort imposé : le connecteur applique ses règles (Claude : effort léger).
  assert.equal(appels[0].options.temperature, undefined);
  assert.equal(appels[0].options.effort, undefined);
  await ec.traiter(fondateur, { mode: 'corriger', champ: 'cm.post', texte: 'Bonjour' });
  assert.equal(appels[1].tache, TACHE_ECRITURE);
  // Plafond du moteur atteint (répartiteur : quota-ia sur le dernier moteur).
  const ec2 = servicesEcriture({ base, discuterPour: async () => { throw Object.assign(new Error('x'), { code: 'quota-ia', statut: 429 }); } });
  await assert.rejects(ec2.traiter(fondateur, { mode: 'corriger', champ: 'cm.post', texte: 'a' }), e => e.code === 'ecriture-quota' && e.statut === 429);
});

test('répartiteur : la tâche « ecriture » peut aller chez Claude, « correction » (réunions) jamais', async () => {
  const vus = [];
  const claude = { disponible: () => true, images: true, discuter: async (m, o) => (vus.push(o.tache), { texte: '{"texte":"ok"}' }) };
  const r = creerRepartiteurIa({ moteurs: { claude }, ordres: { profils: ['claude'], leger: ['claude'] } });
  assert.equal((await r.discuterPour(TACHE_ECRITURE, [{ role: 'user', content: 'x' }])).moteur, 'claude');
  assert.equal((await r.discuterPour(TACHE_TRADUCTION, [{ role: 'user', content: 'x' }])).moteur, 'claude');
  await assert.rejects(r.discuterPour('correction', [{ role: 'user', content: 'x' }]), e => /confidentielle/.test(e.code));
  assert.deepEqual(vus, [TACHE_ECRITURE, TACHE_TRADUCTION]);
});

// ------------------------------------------------------------------ API (chaîne réelle, faux NVIDIA)

test('API : corriger une réponse de ticket — seul le texte part, éléments protégés intacts, appel compté', async () => {
  const { b, f, ecrire, ia, api } = await preparer();
  const etat = await api('/ia/ecriture', f);
  assert.equal(etat.statut, 200);
  assert.deepEqual([etat.corps.actif, etat.corps.autorise, etat.corps.disponible], [true, true, true]);
  assert.ok(etat.corps.champs.includes('tickets.reponse'));
  assert.ok(!etat.corps.champs.includes('tickets.note'));
  const texte = 'salu <@123456789012345678>, tu vien au scrim sur Ascent ? 🔥\nhttps://exemple.fr/{pseudo}';
  const r = await ecrire(f, { mode: 'corriger', champ: 'tickets.reponse', texte });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.texte, 'Salut <@123456789012345678>, tu viens au scrim sur Ascent ? 🔥\nhttps://exemple.fr/{pseudo}');
  assert.equal(r.corps.moteur, 'api2');
  assert.equal(r.corps.fournisseur, 'nvidia');
  assert.equal(ia.appels.length, 1);
  const msgs = ia.appels[0].corps.messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].content, 'salu ⟦1⟧, tu vien au scrim sur Ascent ? ⟦2⟧\n⟦3⟧');
  assert.ok(!JSON.stringify(ia.appels[0].corps).includes('123456789012345678'));
  // Compté dans les appels du mois du moteur (plafond de l'Administration IA).
  const n = await b.base.premier("SELECT COUNT(*) AS n FROM ia_appels WHERE genre = 'ecriture' AND moteur = 'api2'", []);
  assert.equal(Number(n.n), 1);
});

test('API : traduction (tâche « traduction ») ; mentions déplacées gardées ; refus si l’IA casse un élément protégé', async () => {
  const { f, ecrire, b } = await preparer(t => (t.startsWith('Bonjour') ? t.replace('Bonjour', 'Hello') : 'Hello everyone'));
  const r = await ecrire(f, { mode: 'traduire-en', champ: 'messagerie', texte: 'Bonjour <@&323456789012345678>' });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.texte, 'Hello <@&323456789012345678>');
  const n = await b.base.premier("SELECT COUNT(*) AS n FROM ia_appels WHERE genre = 'traduction'", []);
  assert.equal(Number(n.n), 1);
  const casse = await ecrire(f, { mode: 'traduire-en', champ: 'messagerie', texte: 'Salut <@123> à tous' });
  assert.equal(casse.statut, 422);
  assert.equal(casse.corps.code, 'ecriture-proteges');
});

test('API : champs confidentiels refusés sans appel à l’IA ; texte trop long ; mode inconnu ; texte vide', async () => {
  const { f, ecrire, ia } = await preparer();
  for (const champ of ['tickets.note', 'reunions', 'suivi', 'strats', 'journal']) {
    const r = await ecrire(f, { mode: 'corriger', champ, texte: 'compte rendu de réunion' });
    assert.equal(r.statut, 403, champ);
    assert.equal(r.corps.code, 'ecriture-confidentielle');
  }
  const long = await ecrire(f, { mode: 'corriger', champ: 'cm.post', texte: 'a'.repeat(6001) });
  assert.equal(long.statut, 413);
  assert.equal(long.corps.code, 'ecriture-trop-long');
  assert.equal((await ecrire(f, { mode: 'resumer', champ: 'cm.post', texte: 'a' })).corps.code, 'ecriture-mode');
  assert.equal((await ecrire(f, { mode: 'corriger', champ: 'cm.post', texte: '   ' })).corps.code, 'ecriture-vide');
  assert.equal(ia.appels.length, 0);
});

test('API : 30 demandes par minute et par compte, puis 429 ; de nouveau permis la minute suivante', async () => {
  const { f, ecrire, b } = await preparer();
  for (let i = 0; i < 30; i++) assert.equal((await ecrire(f, { mode: 'corriger', champ: 'cm.commentaire', texte: `salu ${i}` })).statut, 200);
  const trop = await ecrire(f, { mode: 'corriger', champ: 'cm.commentaire', texte: 'salu' });
  assert.equal(trop.statut, 429);
  assert.equal(trop.corps.code, 'trop-de-requetes');
  b.horloge.t += 61_000;
  assert.equal((await ecrire(f, { mode: 'corriger', champ: 'cm.commentaire', texte: 'salu' })).statut, 200);
});

test('API : plafond mensuel du moteur atteint → 429 ecriture-quota (rien n’est envoyé)', async () => {
  const { f, ecrire, api, ia } = await preparer();
  assert.equal((await api('/jeux/ia/reglages', f, { methode: 'PUT', corps: { quotaAppelsApi2: 0 } })).statut, 200);
  const r = await ecrire(f, { mode: 'corriger', champ: 'cm.post', texte: 'salu' });
  assert.equal(r.statut, 429);
  assert.equal(r.corps.code, 'ecriture-quota');
  assert.equal(ia.appels.length, 0);
});

test('API : IA non configurée → 503 ecriture-indisponible', async () => {
  const b = await banc({});
  const A = await teamAvecMembres(b, {});
  const r = await b.appel('/ia/ecriture', { methode: 'POST', jeton: A.sessions.fondateur, corps: { mode: 'corriger', champ: 'cm.post', texte: 'salu' } });
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, 'ecriture-indisponible');
});

test('réglages du Fondateur : par défaut lui seul ; rôles ou personnes ajoutés ; désactiver', async () => {
  const { A, f, api, ecrire } = await preparer();
  const max = A.sessions.max12345;
  const lea = A.sessions.lea12345;
  // Défaut : personne d'autre que le Fondateur (manager compris), refus côté serveur aussi.
  assert.equal((await api('/ia/ecriture', f)).corps.autorise, true);
  assert.equal((await api('/ia/ecriture', max)).corps.autorise, false);
  assert.equal((await api('/ia/ecriture', lea)).corps.autorise, false);
  assert.equal((await ecrire(max, { mode: 'corriger', champ: 'cm.post', texte: 'salu' })).corps.code, 'ecriture-permission');
  assert.equal((await api('/ia/ecriture/reglages', max)).statut, 403);
  const reg = await api('/ia/ecriture/reglages', f);
  assert.deepEqual([reg.corps.groupes, reg.corps.comptes], [[], []]);
  // Un rôle ajouté : le staff des teams.
  assert.equal((await api('/ia/ecriture/reglages', f, { methode: 'PUT', corps: { groupes: ['staff_teams'] } })).statut, 200);
  assert.equal((await ecrire(max, { mode: 'corriger', champ: 'cm.post', texte: 'salu' })).statut, 200);
  assert.equal((await ecrire(lea, { mode: 'corriger', champ: 'cm.post', texte: 'salu' })).corps.code, 'ecriture-permission');
  // Une personne ajoutée.
  assert.equal((await api('/ia/ecriture/reglages', f, { methode: 'PUT', corps: { groupes: [], comptes: ['lea12345'] } })).statut, 200);
  assert.equal((await ecrire(lea, { mode: 'corriger', champ: 'cm.post', texte: 'salu' })).statut, 200);
  assert.equal((await api('/ia/ecriture', max)).corps.autorise, false);
  assert.equal((await api('/ia/ecriture/reglages', f, { methode: 'PUT', corps: { groupes: ['inconnu'] } })).statut, 400);
  assert.equal((await api('/ia/ecriture/reglages', f, { methode: 'PUT', corps: { comptes: ['a b'] } })).statut, 400);
  assert.equal((await api('/ia/ecriture/reglages', f, { methode: 'PUT', corps: { actif: false } })).corps.actif, false);
  assert.equal((await api('/ia/ecriture', f)).corps.actif, false);
  assert.equal((await ecrire(f, { mode: 'corriger', champ: 'cm.post', texte: 'salu' })).corps.code, 'ecriture-desactivee');
});
