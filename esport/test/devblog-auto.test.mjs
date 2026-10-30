/**
 * Devblog publié automatiquement (migration 0037, docs/esport/devblog.md, « Publication automatique ») :
 *  - « 🚀 Tout publier » : app + salons Discord en une action ;
 *  - publication programmée : le cron publie à l'heure (jamais avant), une seule fois ; modifiable, annulable ;
 *  - mode automatique (faux historique git, faux moteur IA) : commits techniques écartés, rien d'interne envoyé à
 *    l'IA ni publié (hash, chemins, fichiers, variables), DA du devblog (exemples), validation stricte, au plus un
 *    devblog automatique par jour, échec de l'IA → brouillon + notification, validation avant publication facultative,
 *    « Générer maintenant » (brouillon de test) ;
 *  - export / import du journal.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLE, banc, teamAvecMembres } from './aide.mjs';
import { URL_TEST } from './discord-aide.mjs';
import { ID_PREMIER_DEVBLOG } from '../noyau/devblog/premier.mjs';
import {
  DEVBLOG_23_10,
  EXEMPLE_PREMIER,
  contientFuite,
  echeanceAuto,
  estDuAuto,
  filtrerCommits,
  lireInstantProgramme,
  lireRedaction,
  lireReglagesAuto,
  messagesRedaction,
  nettoyerCommit,
} from '../noyau/devblog/auto-regles.mjs';
import { executerDevblogAuto, publierProgrammes } from '../noyau/devblog/auto.mjs';
import { traiterDevblogDiscord } from '../noyau/devblog/discord.mjs';
import { servicesDevblog } from '../noyau/devblog/service.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';
import { lireJournalDeploiement } from '../serveur/devblog-source.mjs';
import { baseMigree } from './base.mjs';

const JETON_BOT = 'jeton-bot-de-test';
const SALON = '700000000000000001';
const FONDATEUR = { compte: 'principal', superAdmin: true };
/** 18:00 à Paris le 30/10/2026 (heure d'hiver : UTC+1). */
const H18 = Date.parse('2026-10-30T17:00:00.000Z');
const MIN = 60_000;
const JOUR = 86_400_000;

function fauxDiscord() {
  const appels = [];
  let n = 900000000000000000n;
  const fetch = async (url, init) => {
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ url: String(url), methode: init.method, corps });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (init.method === 'PATCH') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    n += 1n;
    return new Response(JSON.stringify({ id: String(n), channel_id: SALON }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { appels, fetch };
}

/** Faux dépôt déployé : commits du plus ancien au plus récent ; `deployer(...)` ajoute des commits (nouvelle mise à jour). */
function fauxGit() {
  let i = 0;
  const etat = { commits: [], deploiements: [] };
  const hash = () => `c0ffee${(++i).toString(16).padStart(34, '0')}`;
  return {
    etat,
    deployer(...liste) {
      const de = etat.commits.at(-1)?.hash ?? null;
      for (const c of liste) etat.commits.push({ hash: hash(), date: '2026-10-30T10:00:00+01:00', sujet: typeof c === 'string' ? c : c.sujet, corps: typeof c === 'string' ? '' : c.corps });
      etat.deploiements.push({ le: '2026-10-30T10:00:00', de, a: etat.commits.at(-1).hash });
      return etat.commits.at(-1).hash;
    },
    tete: async () => etat.commits.at(-1)?.hash ?? null,
    existe: async h => etat.commits.some(c => c.hash === h),
    commits: async (de, a, { max = 200 } = {}) => {
      const debut = de ? etat.commits.findIndex(c => c.hash === de) + 1 : 0;
      const fin = etat.commits.findIndex(c => c.hash === a);
      return etat.commits.slice(debut, fin + 1).slice(-max);
    },
    deploiements: async () => etat.deploiements,
  };
}

const REDACTION = {
  fr: {
    titre: 'Nouvelle Mise à Jour !',
    intro: 'Salut à tous ! Une nouvelle mise à jour est en ligne. Voici ce qui change :',
    sections: [
      { emoji: '👥', titre: 'Membres', puces: [{ nom: 'Badges', description: 'Créez et modifiez vos badges directement depuis la fiche d’un membre.' }] },
      { emoji: '🔧', titre: 'Corrections', puces: [{ nom: 'Menus « ⋯ »', description: 'Toujours visibles, sur ordinateur comme sur téléphone.' }] },
    ],
    conclusion: 'Merci pour vos retours et bonne navigation ! 🚀',
  },
  en: {
    titre: 'New Update!',
    intro: 'Hi everyone! A new update is live. Here’s what’s new:',
    sections: [
      { emoji: '👥', titre: 'Members', puces: [{ nom: 'Badges', description: 'Create and edit your badges right from a member’s card.' }] },
      { emoji: '🔧', titre: 'Fixes', puces: [{ nom: '“⋯” menus', description: 'Always visible, on computer and phone alike.' }] },
    ],
    conclusion: 'Thanks for your feedback and enjoy! 🚀',
  },
};

/** Faux moteur IA : note chaque appel ; `reponse` = objet (rendu en JSON), texte brut, ou fonction qui lève. */
function fauxIa(reponse = REDACTION) {
  const appels = [];
  const discuterPour = async (tache, messages, options) => {
    appels.push({ tache, messages, options });
    const r = typeof reponse === 'function' ? reponse(messages) : reponse;
    return { moteur: 'api2', texte: typeof r === 'string' ? r : `\`\`\`json\n${JSON.stringify(r)}\n\`\`\`` };
  };
  return { appels, discuterPour };
}

/** Commits techniques (écartés) et commits notables, avec des éléments internes à ne jamais laisser sortir. */
const TECHNIQUES = [
  'Jest : délais plus généreux sous charge (CI Site o2switch en échec)',
  'Esport IA : test « API secondaire » (gpt-oss) qui dépassait 90 s, délais par étape et outil de diagnostic',
  'Esport : retire le lien symbolique esport/node_modules ajouté par erreur',
  'Esport : IA locale — documentation (ia-locale.md, o2switch partie J, profils de jeu)',
  'Rôles Esport : e2e et commentaire adaptés au relais sans Cloudflare',
  'deployer.sh : purge des assets sans substitution de processus (CageFS sans /dev/fd)',
  'docs: mise à jour du README',
  'chore(deps): bump pg to 8.14',
  'refactor: découpe du service des strats',
  'ci: cache des dépendances',
  'Esport : correctif des journaux du cron',
  'Dépendances : nodemailer 10.0.13',
  'Esport : IA locale (travail en cours) — gestionnaire llama-server',
];
const NOTABLES = [
  { sujet: 'Trombinoscope : créer et modifier les badges depuis le panneau d’attribution (esport/noyau/trombi/badges.mjs, a1d1e27)', corps: '- badges éditables depuis ~/application-enzo/src/esport/ui/trombi\n- réglé par DISCORD_BOT_TOKEN et https://github.com/x/y\n- --forcer pour tester\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_x' },
  'Esport : le menu « ⋯ » reste entièrement visible (haut/bas, défilement, feuille du bas sur mobile)',
  'Esport › Discord : tester les MP du bot (MP de test, simulation de relance)',
];

// ------------------------------------------------------------------ Règles pures

test('règles : commits techniques écartés (tests, docs, refactor, CI, dépendances, journaux…), notables gardés', () => {
  const tous = [...TECHNIQUES, ...NOTABLES, 'Esport : devblog (fenêtre « Nouveautés », historique, éditeur FR/EN, publication Discord dans la DA)', 'Strats : suppression visible, sélection multiple, toast « Annuler » et corbeille de 30 jours', 'Merge branch main'].map(c => (typeof c === 'string' ? { sujet: c, corps: '' } : c));
  const { retenus, ecartes } = filtrerCommits(tous);
  assert.deepEqual(ecartes.map(c => c.sujet), [...TECHNIQUES, 'Merge branch main']);
  assert.equal(retenus.length, NOTABLES.length + 2);
});

test('règles : rien d’interne ne part à l’IA (hash, chemins, fichiers, variables d’environnement, adresses, options)', () => {
  const brut = NOTABLES[0];
  assert.ok(contientFuite(brut.sujet) && contientFuite(brut.corps));
  const net = nettoyerCommit(brut);
  const texte = JSON.stringify(net);
  assert.ok(!contientFuite(texte), texte);
  for (const interdit of ['a1d1e27', 'esport/noyau', 'badges.mjs', '~/', 'DISCORD_BOT_TOKEN', 'github', 'https', '--forcer', 'Co-Authored', 'Claude-Session', 'noreply']) assert.ok(!texte.includes(interdit), interdit);
  assert.match(net.sujet, /^Trombinoscope : créer et modifier les badges depuis le panneau d’attribution/);
  assert.ok(net.puces.length >= 1 && net.puces.length <= 5);
  for (const t of ['voir a1d1e27f', 'esport/noyau/api.mjs', 'IA_API_CLE', '${HOME}', 'process.env.X', 'https://x.y', 'a@b.fr', 'install.sh', '~/logs/a', 'utilisez --forcer']) assert.ok(contientFuite(t), t);
  for (const t of ['Nouvelle Mise à Jour !', 'Formats 5v5 et 3v3v3v3', 'Posts X, Instagram et TikTok', 'bonne navigation sur appdashboard.fr ! 🚀', 'Menus « ⋯ »']) assert.ok(!contientFuite(t), t);
});

test('règles : rédaction de l’IA validée strictement (DA, mêmes sections FR/EN, aucune fuite, aucun nom de technologie)', () => {
  // Les exemples de la consigne (devblog du 23/10, premier devblog) passent la validation.
  for (const ex of [DEVBLOG_23_10, EXEMPLE_PREMIER, REDACTION]) {
    const r = lireRedaction(JSON.parse(JSON.stringify({ fr: ex.fr, en: ex.en })));
    assert.equal(r.fr.sections.length, ex.fr.sections.length);
  }
  assert.deepEqual(lireRedaction({ rien: true }), { rien: true });
  const avec = f => {
    const r = JSON.parse(JSON.stringify(REDACTION));
    f(r);
    return r;
  };
  const refuse = (r, motif) => assert.throws(() => lireRedaction(r), e => e.code === 'devblog-redaction' && (!motif || motif.test(e.motif)), motif?.source);
  refuse(null);
  refuse({ fr: REDACTION.fr });
  refuse(avec(r => (r.en.sections[0].puces[0].description = 'Plus rapide grâce à NVIDIA.')), /technologie/);
  refuse(avec(r => (r.fr.sections[0].puces[0].description = 'Voir le commit a1d1e27f.')), /interne/);
  refuse(avec(r => (r.fr.sections[0].puces[0].description = 'Réglé dans esport/noyau/api.mjs.')), /interne/);
  refuse(avec(r => (r.fr.sections[0].puces[0].description = 'Ajoutez IA_API_CLE.')), /interne/);
  refuse(avec(r => (r.fr.conclusion = 'Merci ! @everyone')), /mention/);
  refuse(avec(r => r.en.sections.pop()), /sections/);
  refuse(avec(r => r.en.sections[0].puces.push({ nom: 'X', description: 'Y.' })), /puces/);
  refuse(avec(r => (r.fr.sections[0].emoji = 'AB')), /emoji/);
  refuse(avec(r => (r.fr.sections[0].puces[0].nom = '')), /vide/);
  refuse(avec(r => (r.fr.intro = 'x'.repeat(5000))), /trop long/);
  refuse(avec(r => (r.fr.sections = [])), /sections/);
  // Les messages envoyés : consigne, deux exemples (23/10, premier devblog), puis les changements.
  const m = messagesRedaction([{ sujet: 'Badges', puces: [] }]);
  assert.equal(m.length, 6);
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /NO vendor, product or technology names/);
  assert.deepEqual(JSON.parse(m[2].content).fr.sections.map(s => s.emoji), DEVBLOG_23_10.fr.sections.map(s => s.emoji));
  assert.deepEqual(JSON.parse(m[5].content), { changements: [{ sujet: 'Badges', puces: [] }] });
});

test('règles : réglages (défauts), échéance dans le fuseau du club, programmation dans le futur', () => {
  const d = lireReglagesAuto({});
  assert.deepEqual({ actif: d.actif, frequence: d.frequence, heure: d.heure, validation: d.validation, mentionHere: d.mentionHere, cibles: d.cibles }, { actif: false, frequence: 'apres_maj', heure: '18:00', validation: false, mentionHere: true, cibles: null });
  assert.throws(() => lireReglagesAuto({ heure: '25:00' }), e => e.statut === 400);
  assert.throws(() => lireReglagesAuto({ frequence: 'horaire' }), e => e.statut === 400);
  assert.throws(() => lireReglagesAuto({ jour: 9 }), e => e.statut === 400);
  const r = lireReglagesAuto({ actif: true });
  assert.equal(estDuAuto(d, H18 + 5 * MIN), false, 'désactivé');
  assert.equal(estDuAuto(r, H18 - MIN), false, '17:59 à Paris');
  assert.equal(estDuAuto(r, H18), true, '18:00 à Paris');
  assert.equal(estDuAuto(r, H18 + 5 * MIN, { dernierJour: '2026-10-30' }), false, 'déjà passé aujourd’hui');
  assert.equal(echeanceAuto(r, H18 - 3 * 3_600_000), H18);
  assert.equal(echeanceAuto(r, H18 + MIN, { dejaFaitAujourdhui: true }), H18 + JOUR);
  // Hebdomadaire : le vendredi (5) seulement ; le 30/10/2026 est un vendredi.
  const hebdo = lireReglagesAuto({ actif: true, frequence: 'hebdo', jour: 1, heure: '09:30' });
  assert.equal(estDuAuto(hebdo, H18), false);
  assert.equal(echeanceAuto(hebdo, H18), Date.parse('2026-11-02T08:30:00.000Z'));
  assert.equal(estDuAuto(lireReglagesAuto({ actif: true, frequence: 'hebdo', jour: 5 }), H18), true);
  // Programmation : heure de Paris, à venir, à moins de 90 jours.
  assert.equal(lireInstantProgramme('2026-10-30 18:00', H18 - 3_600_000), H18);
  assert.equal(lireInstantProgramme('2026-10-30T17:00:00Z', H18 - 3_600_000), H18);
  assert.throws(() => lireInstantProgramme('2026-10-30 18:00', H18), e => e.code === 'devblog-programme-passe');
  assert.throws(() => lireInstantProgramme('2027-06-01 18:00', H18), e => e.code === 'devblog-programme-loin');
  assert.throws(() => lireInstantProgramme('demain', H18), e => e.code === 'devblog-programme');
  // Journal du déploiement (deployer.sh) lu ligne à ligne.
  assert.deepEqual(lireJournalDeploiement('2026-10-30 10:00:00 code : aaaaaaa1 → bbbbbbb2\n2026-10-30 10:00:01 site : public_html à jour\n2026-10-30 11:00:00 code : aucun → ccccccc3'), [
    { le: '2026-10-30T10:00:00', de: 'aaaaaaa1', a: 'bbbbbbb2' },
    { le: '2026-10-30T11:00:00', de: null, a: 'ccccccc3' },
  ]);
});

// ------------------------------------------------------------------ Banc HTTP

async function preparer({ source = null } = {}) {
  const d = fauxDiscord();
  const b = await banc({ fetchDiscord: d.fetch, discordBot: { jetonBot: JETON_BOT }, devblogSource: source });
  // Horloge du serveur : le 30/10/2026 à 14:00 à Paris (les sessions sont ouvertes à cette date).
  b.horloge.t = H18 - 4 * 3_600_000;
  const A = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const f = A.sessions.fondateur;
  // L'horloge avance de plusieurs heures (sessions d'une heure) : une session expirée est rouverte pour le même compte.
  const comptes = new Map([[f, 'principal'], [A.sessions.lea12345, 'lea12345']]);
  const frais = new Map();
  const api = async (chemin, jeton, options = {}) => {
    const actuel = frais.get(jeton) ?? jeton;
    let r = await b.appel(chemin, { jeton: actuel, ...options });
    if (r.statut === 401 && r.corps?.code === 'session' && comptes.has(jeton)) {
      frais.set(jeton, await b.session(comptes.get(jeton)));
      r = await b.appel(chemin, { jeton: frais.get(jeton), ...options });
    }
    return r;
  };
  const ok = async (chemin, jeton, options) => {
    const r = await api(chemin, jeton, options);
    assert.equal(r.statut, 200, `${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/devblog', f);
  const sal = await ok('/devblog/salons', f, { methode: 'PUT', corps: { webhook: { nom: 'annonces-club', url: URL_TEST } } });
  const club = sal.salons.find(s => s.nom === 'annonces-club').cle;
  return { b, A, f, api, ok, d, club };
}

const postsDiscord = d => d.appels.filter(a => a.methode === 'POST');

test('🚀 Tout publier : app + salons Discord en une action (aperçu préalable, confirmation côté app), jamais deux fois', async () => {
  const { A, f, api, ok, d, club } = await preparer();
  // Aperçu avant de tout publier (brouillon) : le texte exact du serveur, prêt.
  const apercu = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/discord`, f);
  assert.equal(apercu.complet, true);
  assert.ok(apercu.apercu.en.at(-1).endsWith('@here'));
  // Réservé aux gestionnaires ; salon inconnu refusé (rien n'est publié).
  assert.equal((await api(`/devblog/${ID_PREMIER_DEVBLOG}/tout-publier`, A.sessions.lea12345, { methode: 'POST', corps: { cibles: [club] } })).statut, 403);
  assert.equal((await api(`/devblog/${ID_PREMIER_DEVBLOG}/tout-publier`, f, { methode: 'POST', corps: { cibles: ['salon:inconnu'] } })).corps.code, 'devblog-salon-inconnu');
  assert.equal((await ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f)).entree.statut, 'brouillon');

  const r = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/tout-publier`, f, { methode: 'POST', corps: { cibles: [club], mentionHere: true } });
  assert.equal(r.app, 'publie');
  assert.equal(r.entree.statut, 'publie');
  assert.deepEqual(r.resultats, [{ cible: club, etat: 'publication' }]);
  const posts = postsDiscord(d);
  assert.equal(posts.filter(a => a.url.includes('/threads')).length, 1, 'fil français');
  assert.equal(posts.filter(a => a.corps?.content?.includes('@here')).length, 1, '@here une seule fois');
  assert.ok((await ok('/devblog/nouveautes', A.sessions.lea12345)).entree, 'visible des membres');
  // Deuxième clic : rien de plus.
  const avant = d.appels.length;
  const r2 = await ok(`/devblog/${ID_PREMIER_DEVBLOG}/tout-publier`, f, { methode: 'POST', corps: { cibles: [club] } });
  assert.equal(r2.app, 'deja_publie');
  assert.deepEqual(r2.resultats, [{ cible: club, etat: 'deja_publie' }]);
  assert.equal(d.appels.length, avant);
  // App seulement (aucun salon) ; devblog incomplet refusé.
  const vide = await ok('/devblog', f, { methode: 'POST', corps: { fr: { titre: 'Sans anglais', sections: [{ emoji: '✨', titre: 'A', puces: [{ nom: 'B', description: 'C' }] }] } } });
  assert.equal((await api(`/devblog/${vide.entree.id}/tout-publier`, f, { methode: 'POST', corps: { cibles: [] } })).corps.code, 'devblog-titre');
  const complet = await ok(`/devblog/${vide.entree.id}`, f, { methode: 'PATCH', corps: { en: { titre: 'No English', sections: [{ emoji: '✨', titre: 'A', puces: [{ nom: 'B', description: 'C' }] }] } } });
  const seule = await ok(`/devblog/${complet.entree.id}/tout-publier`, f, { methode: 'POST', corps: { cibles: [] } });
  assert.equal(seule.app, 'publie');
  assert.deepEqual(seule.resultats, []);
});

test('publication programmée : le cron publie à l’heure (jamais avant), une seule fois ; modifiable et annulable', async () => {
  const { b, A, f, api, ok, d, club } = await preparer();
  b.horloge.t = H18 - 2 * 3_600_000; // 16:00 à Paris
  const url = `/devblog/${ID_PREMIER_DEVBLOG}/programmation`;
  assert.equal((await api(url, f, { methode: 'PUT', corps: { le: '2026-10-30 15:00', cibles: [club] } })).corps.code, 'devblog-programme-passe');
  assert.equal((await api(url, A.sessions.lea12345, { methode: 'PUT', corps: { le: '2026-10-30 18:00' } })).statut, 403);
  let e = (await ok(url, f, { methode: 'PUT', corps: { le: '2026-10-30 17:30', cibles: [club], mentionHere: true } })).entree;
  assert.deepEqual(e.programmation, { le: new Date(H18 - 30 * MIN).toISOString(), mural: '2026-10-30 17:30', cibles: [club], mentionHere: true });
  // Modifiée avant l'heure : 18:00.
  e = (await ok(url, f, { methode: 'PUT', corps: { le: '2026-10-30 18:00', cibles: [club], mentionHere: true } })).entree;
  assert.equal(e.programmation.le, new Date(H18).toISOString());
  const cron = t => tachesPlanifiees(b.base, { cle: CLE, fetch: d.fetch, jetonBot: JETON_BOT, maintenant: () => t, journal: { error() {} } });

  // 17:59 : rien.
  const rapport = await cron(H18 - MIN);
  assert.ok(rapport.find(x => x.tache === 'devblog programmé').ok);
  assert.equal((await ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f)).entree.statut, 'brouillon');
  assert.equal(postsDiscord(d).length, 0);
  assert.equal((await ok('/devblog/nouveautes', A.sessions.lea12345)).entree, null);
  // 18:00 : publié dans l'app et sur Discord.
  await cron(H18 + 2 * MIN);
  e = (await ok(`/devblog/${ID_PREMIER_DEVBLOG}`, f)).entree;
  assert.equal(e.statut, 'publie');
  assert.equal(e.programmation, null);
  assert.equal(e.publieLe, new Date(H18 + 2 * MIN).toISOString());
  assert.ok(postsDiscord(d).length >= 3);
  assert.equal(postsDiscord(d).filter(a => a.corps?.content?.includes('@here')).length, 1);
  assert.ok((await ok('/devblog/nouveautes', A.sessions.lea12345)).entree);
  // Passage suivant : rien de plus.
  const n = d.appels.length;
  await cron(H18 + 7 * MIN);
  assert.equal(d.appels.length, n);
  // Un devblog publié ne se programme plus.
  b.horloge.t = H18 + 10 * MIN;
  assert.equal((await api(url, f, { methode: 'PUT', corps: { le: '2026-10-31 18:00' } })).corps.code, 'devblog-deja-publie');

  // Annulation : un autre brouillon programmé puis annulé n'est jamais publié.
  const autre = (await ok('/devblog', f, { methode: 'POST', corps: { fr: REDACTION.fr, en: REDACTION.en } })).entree;
  assert.ok((await ok(`/devblog/${autre.id}/programmation`, f, { methode: 'PUT', corps: { le: '2026-10-31 09:00' } })).entree.programmation);
  assert.equal((await ok(`/devblog/${autre.id}/programmation`, f, { methode: 'DELETE' })).entree.programmation, null);
  await cron(H18 + 2 * JOUR);
  assert.equal((await ok(`/devblog/${autre.id}`, f)).entree.statut, 'brouillon');
  // Brouillon incomplet : refusé à la programmation ; devenu incomplet après : annulé par le cron, gestionnaires notifiés.
  await ok(`/devblog/${autre.id}/programmation`, f, { methode: 'PUT', corps: { le: '2026-10-31 09:00' } });
  await ok(`/devblog/${autre.id}`, f, { methode: 'PATCH', corps: { en: { titre: '', sections: [] } } });
  const bilan = await publierProgrammes(b.base, { maintenant: Date.parse('2026-10-31T09:00:00.000Z') });
  assert.deepEqual(bilan, { publies: 0, annules: 1, discord: 0 });
  assert.equal((await ok(`/devblog/${autre.id}`, f)).entree.statut, 'brouillon');
  const notif = await b.base.premier("SELECT charge FROM notifications WHERE compte_id = 'principal' AND type = 'devblog-auto'", []);
  assert.equal(JSON.parse(notif.charge).etat, 'programme-annule');
});

// ------------------------------------------------------------------ Mode automatique

async function preparerAuto() {
  const git = fauxGit();
  git.deployer('Esport : état initial');
  const p = await preparer({ source: git });
  const ia = fauxIa();
  const auto = (t, discuterPour = ia.discuterPour) => executerDevblogAuto(p.b.base, { source: git, discuterPour, maintenant: t });
  const envoyer = t => traiterDevblogDiscord(p.b.base, { cle: CLE, fetch: p.d.fetch, jetonBot: JETON_BOT, maintenant: t });
  return { ...p, git, ia, auto, envoyer };
}

test('mode automatique : désactivé par défaut ; activé, publie au plus un devblog par jour à l’heure choisie (app + Discord, @here)', async () => {
  const { b, f, A, ok, api, d, club, git, ia, auto, envoyer } = await preparerAuto();
  const v = await ok('/devblog/auto', f);
  assert.equal(v.reglages.actif, false);
  assert.equal(v.reglages.validation, false);
  assert.equal(v.reglages.frequence, 'apres_maj');
  assert.equal(v.reglages.heure, '18:00');
  assert.equal(v.source, true);
  assert.equal((await api('/devblog/auto', A.sessions.lea12345)).statut, 403);
  assert.equal((await api('/devblog/auto', A.sessions.lea12345, { methode: 'PUT', corps: { actif: true } })).statut, 403);
  git.deployer(...TECHNIQUES.slice(0, 2), ...NOTABLES);
  assert.equal((await auto(H18 + 5 * MIN)).statut, 'inactif');
  assert.equal(ia.appels.length, 0);

  // Activation : le point de départ est l'état déployé (premier devblog encore en brouillon) : rien d'ancien n'est raconté.
  b.horloge.t = H18 - 3 * 3_600_000;
  const reg = await ok('/devblog/auto', f, { methode: 'PUT', corps: { actif: true } });
  assert.equal(reg.reglages.actif, true);
  assert.equal(reg.prochain, new Date(H18).toISOString());
  assert.deepEqual(reg.cibles, [club], 'salons par défaut : ceux d’« annonces du club »');
  // Nouvelle mise à jour déployée après l'activation.
  git.deployer(...TECHNIQUES.slice(2), ...NOTABLES);
  assert.equal((await ok('/devblog/auto?attente=1', f)).enAttente.retenus, NOTABLES.length);

  assert.equal((await auto(H18 - MIN)).statut, 'pas_encore');
  const r = await auto(H18 + 5 * MIN);
  assert.equal(r.statut, 'publie', JSON.stringify(r));
  // L'IA : tâche « devblog », consigne + exemples, seulement les commits notables, nettoyés.
  assert.equal(ia.appels.length, 1);
  assert.equal(ia.appels[0].tache, 'devblog');
  const envoye = JSON.parse(ia.appels[0].messages.at(-1).content).changements;
  assert.equal(envoye.length, NOTABLES.length);
  const texteEnvoye = JSON.stringify(ia.appels[0].messages.at(-1));
  assert.ok(!contientFuite(texteEnvoye), texteEnvoye);
  for (const c of git.etat.commits) assert.ok(!texteEnvoye.includes(c.hash.slice(0, 7)));
  for (const t of TECHNIQUES) assert.ok(!texteEnvoye.includes(t.slice(0, 20)), t);

  const e = (await ok(`/devblog/devblog-auto-2026-10-30`, f)).entree;
  assert.equal(e.statut, 'publie');
  assert.equal(e.origine, 'auto');
  assert.deepEqual(e.fr, REDACTION.fr);
  assert.deepEqual(e.en, REDACTION.en);
  assert.equal((await ok('/devblog/nouveautes', A.sessions.lea12345)).entree.id, 'devblog-auto-2026-10-30');
  await envoyer(H18 + 6 * MIN);
  const posts = postsDiscord(d);
  assert.ok(posts.length >= 3);
  assert.ok(posts[0].corps.content.startsWith('🚀 DEVBLOG — New Update! 🛠️'));
  assert.equal(posts.filter(a => a.corps?.content?.includes('@here')).length, 1);
  assert.ok(posts.some(a => a.url.includes('/threads') && a.corps.name.startsWith('🇫🇷 Version française')));
  const notif = await b.base.premier("SELECT charge FROM notifications WHERE compte_id = 'principal' AND type = 'devblog-auto'", []);
  assert.equal(JSON.parse(notif.charge).etat, 'publie');

  // Le même jour : nouvelle mise à jour, mais au plus un devblog automatique par jour.
  git.deployer('Esport › Planning : glisser-déposer des événements');
  assert.equal((await auto(H18 + 3_600_000)).statut, 'deja_fait');
  assert.equal(ia.appels.length, 1);
  // Lendemain 18:00 : seulement ce qui est nouveau depuis le devblog d'hier.
  const r2 = await auto(H18 + JOUR + 5 * MIN);
  assert.equal(r2.statut, 'publie');
  const envoye2 = JSON.parse(ia.appels[1].messages.at(-1).content).changements;
  assert.deepEqual(envoye2.map(c => c.sujet), ['Esport › Planning : glisser-déposer des événements']);
  // Surlendemain : seulement des commits techniques → rien (aucun devblog), point de départ avancé.
  git.deployer(...TECHNIQUES.slice(0, 3));
  const r3 = await auto(H18 + 2 * JOUR + 5 * MIN);
  assert.equal(r3.statut, 'rien');
  assert.equal(ia.appels.length, 2);
  // Jour suivant : aucune mise à jour → rien.
  assert.equal((await auto(H18 + 3 * JOUR + 5 * MIN)).statut, 'rien');
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM devblog_entrees WHERE origine = 'auto'", [])).n, 2);
  // Journal de chaque passage.
  const journal = (await ok('/devblog/auto', f)).journal;
  assert.deepEqual(journal.map(j => j.statut), ['rien', 'rien', 'publie', 'publie']);
  assert.equal(journal[3].commitsRetenus, NOTABLES.length);
  assert.equal(journal[3].entree, 'devblog-auto-2026-10-30');
});

test('mode automatique : deux cron en même temps → une seule publication', async () => {
  const { f, ok, git, ia, auto, b } = await preparerAuto();
  b.horloge.t = H18 - 3_600_000;
  await ok('/devblog/auto', f, { methode: 'PUT', corps: { actif: true } });
  git.deployer(...NOTABLES);
  const r = await Promise.all([auto(H18 + 5 * MIN), auto(H18 + 5 * MIN), auto(H18 + 6 * MIN)]);
  assert.deepEqual(r.map(x => x.statut).sort(), ['deja_fait', 'deja_fait', 'publie']);
  assert.equal(ia.appels.length, 1);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM devblog_entrees WHERE statut = 'publie'", [])).n, 1);
});

test('mode automatique : IA en échec ou réponse invalide → brouillon + notification, jamais publié ; validation avant publication', async () => {
  const { b, f, A, ok, d, git, auto, envoyer } = await preparerAuto();
  b.horloge.t = H18 - 3_600_000;
  await ok('/devblog/auto', f, { methode: 'PUT', corps: { actif: true } });

  // 1. L'IA échoue (moteur indisponible).
  git.deployer(...NOTABLES);
  const panne = async () => {
    const e = new Error('Service d’IA injoignable.');
    e.code = 'ia-limite-fournisseur';
    throw e;
  };
  const r1 = await auto(H18 + 5 * MIN, panne);
  assert.equal(r1.statut, 'echec');
  let e = (await ok('/devblog/devblog-auto-2026-10-30', f)).entree;
  assert.equal(e.statut, 'brouillon');
  assert.ok(!contientFuite(JSON.stringify([e.fr, e.en])), JSON.stringify(e.fr));
  assert.ok(e.fr.sections[0].puces.some(p => /badges/i.test(`${p.nom} ${p.description}`)));
  await envoyer(H18 + 6 * MIN);
  assert.equal(postsDiscord(d).length, 0);
  assert.equal((await ok('/devblog/nouveautes', A.sessions.lea12345)).entree, null);
  let notif = await b.base.tous("SELECT charge FROM notifications WHERE compte_id = 'principal' AND type = 'devblog-auto' ORDER BY cree_le", []);
  assert.equal(JSON.parse(notif.at(-1).charge).etat, 'echec');

  // 2. Réponse invalide (nom de technologie, chemin interne) : brouillon de secours, jamais ce texte.
  git.deployer('Esport : nouvelle page Tournois');
  const mauvaise = fauxIa({ ...REDACTION, fr: { ...REDACTION.fr, intro: 'Grâce à NVIDIA, voir esport/noyau/api.mjs :' } });
  const r2 = await auto(H18 + JOUR + 5 * MIN, mauvaise.discuterPour);
  assert.equal(r2.statut, 'echec');
  e = (await ok('/devblog/devblog-auto-2026-10-31', f)).entree;
  assert.equal(e.statut, 'brouillon');
  assert.ok(!JSON.stringify(e).includes('NVIDIA') && !JSON.stringify(e).includes('api.mjs'));
  // Texte illisible : idem.
  git.deployer('Esport : classement des tournois');
  assert.equal((await auto(H18 + 2 * JOUR + 5 * MIN, fauxIa('désolé, je ne peux pas').discuterPour)).statut, 'echec');

  // 3. Validation avant publication : brouillon rédigé par l'IA + notification ; rien dans l'app ni sur Discord.
  await ok('/devblog/auto', f, { methode: 'PUT', corps: { validation: true } });
  git.deployer('Esport : résultats par map');
  const r3 = await auto(H18 + 3 * JOUR + 5 * MIN);
  assert.equal(r3.statut, 'brouillon');
  e = (await ok('/devblog/devblog-auto-2026-11-02', f)).entree;
  assert.equal(e.statut, 'brouillon');
  assert.deepEqual(e.fr, REDACTION.fr);
  notif = await b.base.tous("SELECT charge FROM notifications WHERE compte_id = 'principal' AND type = 'devblog-auto' ORDER BY cree_le", []);
  assert.equal(JSON.parse(notif.at(-1).charge).etat, 'brouillon');
  await envoyer(H18 + 3 * JOUR + 6 * MIN);
  assert.equal(postsDiscord(d).length, 0);
  assert.equal((await ok('/devblog/nouveautes', A.sessions.lea12345)).entree, null);
});

test('mode automatique : une fois par semaine (jour + heure) ; « Générer maintenant » crée un brouillon de test sans consommer le jour', async () => {
  const { b, A, f, ok, api, git, ia, auto } = await preparerAuto();
  b.horloge.t = H18 - 3_600_000;
  await ok('/devblog/auto', f, { methode: 'PUT', corps: { actif: true, frequence: 'hebdo', jour: 1, heure: '09:30' } });
  git.deployer(...NOTABLES);
  // Vendredi 18:05 : pas le bon jour.
  assert.equal((await auto(H18 + 5 * MIN)).statut, 'pas_encore');

  // « Générer maintenant » par l'API : sans IA configurée sur ce banc → brouillon de secours (jamais publié).
  const g = await ok('/devblog/auto/generer', f, { methode: 'POST', corps: {} });
  assert.equal(g.resultat.statut, 'echec');
  const test1 = (await ok(`/devblog/${g.resultat.entree}`, f)).entree;
  assert.equal(test1.statut, 'brouillon');
  // Avec l'IA : brouillon rédigé, toujours en brouillon.
  const dv = servicesDevblog({ base: b.base, discuterPour: ia.discuterPour, cle: CLE, source: git, maintenant: () => H18 + 10 * MIN });
  const g2 = await dv.generer(FONDATEUR);
  assert.equal(g2.resultat.statut, 'brouillon');
  assert.equal((await ok(`/devblog/${g2.resultat.entree}`, f)).entree.statut, 'brouillon');
  assert.equal(ia.appels.length, 1);
  // Membre : refusé.
  assert.equal((await api('/devblog/auto/generer', A.sessions.lea12345, { methode: 'POST', corps: {} })).statut, 403);

  // Lundi 09:30 : le passage hebdomadaire a lieu (le test n'a pas consommé le point de départ).
  const lundi = Date.parse('2026-11-02T08:35:00.000Z');
  const r = await auto(lundi);
  assert.equal(r.statut, 'publie');
  assert.equal(JSON.parse(ia.appels[1].messages.at(-1).content).changements.length, NOTABLES.length);
  // Publier un brouillon de test avance le point de départ (pas de doublon ensuite).
  git.deployer('Esport : profils de jeu plus rapides');
  const dv2 = servicesDevblog({ base: b.base, discuterPour: ia.discuterPour, cle: CLE, source: git, maintenant: () => lundi + 3_600_000 });
  const g3 = await dv2.generer(FONDATEUR);
  await dv2.modifier(FONDATEUR, g3.resultat.entree, { statut: 'publie' });
  assert.equal((await auto(lundi + 7 * JOUR)).statut, 'rien');
});

test('export / import : journal du mode automatique et programmations compris', async () => {
  const { b, f, ok, git, auto } = await preparerAuto();
  b.horloge.t = H18 - 3_600_000;
  await ok('/devblog/auto', f, { methode: 'PUT', corps: { actif: true } });
  git.deployer(...NOTABLES);
  await auto(H18 + 5 * MIN);
  const autre = (await ok('/devblog', f, { methode: 'POST', corps: { fr: REDACTION.fr, en: REDACTION.en } })).entree;
  await ok(`/devblog/${autre.id}/programmation`, f, { methode: 'PUT', corps: { le: '2026-11-01 10:00' } });
  const exp = await exporterBase(b.base);
  assert.equal(exp.tables.devblog_auto.length, 1);
  assert.ok(exp.tables.devblog_entrees.some(e => e.programme_le && e.origine === 'manuel'));
  assert.ok(exp.tables.devblog_reglages.some(r => r.cle === 'auto'));
  const base2 = await baseMigree();
  await importerBase(base2, exp);
  assert.equal((await base2.premier('SELECT statut FROM devblog_auto', [])).statut, 'publie');
  assert.equal((await base2.premier('SELECT programme_le FROM devblog_entrees WHERE id = ?', [autre.id])).programme_le, new Date(Date.parse('2026-11-01T09:00:00.000Z')).toISOString());
});
