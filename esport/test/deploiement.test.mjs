/**
 * Suivi des mises à jour (docs/mises-a-jour.md) :
 *  - journal de deployer.sh filtré (lignes datées seulement, secrets masqués, 10 dernières) ;
 *  - versions : version.json du site (nouveau et ancien format), commit lu dans .git sans lancer git ;
 *  - synthèse : en cours (build / publication, ≈ X min), à jour, échec du workflow, déploiement bloqué ;
 *  - GitHub (API publique, sans jeton) : cache 2 min, ETag, limite de l'API et réseau en panne tolérés ;
 *  - drapeau « Vérifier maintenant » (aucune commande lancée) ;
 *  - API : Fondateur, permission du club deploiement.voir (désactivée par défaut, même pour le Second CEO), 404 sinon.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import {
  BLOQUE_APRES_MIN,
  CACHE_GITHUB_MS,
  creerServiceDeploiement,
  creerSuiviGithub,
  filtrerJournal,
  lireCommitGit,
  lireVersionSite,
  masquerSecrets,
  memeCommit,
  syntheseEtat,
} from '../serveur/deploiement.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const T0 = Date.parse('2026-10-30T12:00:00.000Z');

test('journal : lignes datées seulement, secrets masqués, 10 dernières, dernier déploiement et échec', () => {
  const lignes = [
    '2026-10-30 10:00:00 code : aucun → ' + SHA_A,
    'added 12 packages, and audited 13 packages in 2s',
    'DATABASE_URL=postgres://moi:motdepasse@localhost/esport',
    '2026-10-30 10:00:05 dépendances : npm install --omit=dev (esport)',
    '2026-10-30 10:00:09 serveurs Esport et relais redémarrés sur abc1234 Esport : devblog',
    '2026-10-30 10:00:12 site : public_html à jour (def5678 Site construit depuis abc1234)',
    '2026-10-30 10:01:00 remote: https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/Zozoto14/application-Enzo.git',
    '2026-10-30 10:02:00 CLE_ESPORT=0123456789abcdef mot de passe: hunter2 postgresql://u:p@h/b Bearer abcdefghijklmnop',
  ];
  for (let i = 0; i < 12; i++) lignes.push(`2026-10-30 11:${String(i).padStart(2, '0')}:00 vérification ${i}`);
  lignes.push('2026-10-30 11:30:00 ÉCHEC : migrations (voir le journal ; l\'ancienne version reste en service)');
  const j = filtrerJournal(lignes.join('\n'));
  assert.equal(j.lignes.length, 10);
  assert.ok(j.lignes.every(l => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(l.date)));
  assert.equal(j.derniere.texte.startsWith('ÉCHEC'), true);
  assert.equal(j.echec.date, '2026-10-30 11:30:00');
  assert.equal(j.dernierDeploiement, '2026-10-30 10:00:12');
  const tout = filtrerJournal(lignes.join('\n'), 100).lignes.map(l => l.texte).join('\n');
  assert.doesNotMatch(tout, /motdepasse|hunter2|ghs_abc|0123456789abcdef|abcdefghijklmnop|added 12 packages/);
  assert.match(tout, new RegExp(SHA_A), 'un commit (40 caractères hexadécimaux) reste lisible');
  assert.match(masquerSecrets('token=abc password: x'), /token=\*\*\* password=\*\*\*/);
  assert.deepEqual(filtrerJournal(''), { lignes: [], derniere: null, dernierDeploiement: null, echec: null });
});

test('versions : version.json (nouveau et ancien format), commits abrégés, commit lu dans .git', () => {
  assert.deepEqual(lireVersionSite(JSON.stringify({ id: 'abc1234-lz', commit: SHA_A, date: '2026-10-30T10:00:00.000Z' })), { id: 'abc1234-lz', commit: SHA_A, date: '2026-10-30T10:00:00.000Z' });
  const ancien = lireVersionSite(JSON.stringify({ id: `abc1234-${T0.toString(36)}` }));
  assert.equal(ancien.commit, 'abc1234');
  assert.equal(ancien.date, new Date(T0).toISOString());
  assert.equal(lireVersionSite('pas du json'), null);
  assert.equal(lireVersionSite('{"autre":1}'), null);
  assert.ok(memeCommit('abc1234', 'abc1234' + 'f'.repeat(33)));
  assert.ok(!memeCommit('abc1234', 'abd1234'));
  assert.ok(!memeCommit(null, SHA_A));
  assert.ok(!memeCommit('abc', 'abc'), 'trop court pour conclure');

  const d = mkdtempSync(join(tmpdir(), 'git-'));
  mkdirSync(join(d, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(d, '.git', 'packed-refs'), `# pack-refs with: peeled\n${SHA_B} refs/heads/main\n`);
  assert.equal(lireCommitGit(d), SHA_B, 'packed-refs');
  writeFileSync(join(d, '.git', 'refs', 'heads', 'main'), `${SHA_A}\n`);
  assert.equal(lireCommitGit(d), SHA_A, 'référence directe');
  writeFileSync(join(d, '.git', 'HEAD'), `${SHA_B}\n`);
  assert.equal(lireCommitGit(d), SHA_B, 'HEAD détaché');
  assert.equal(lireCommitGit(join(d, 'absent')), null);
});

test('synthèse : en cours (build puis publication), à jour, échec, bloqué, inconnu', () => {
  const site = { commit: 'aaaaaaa' };
  const min = n => new Date(T0 - n * 60_000).toISOString();
  const build = syntheseEtat({ site, workflow: { statut: 'en-cours', sha: SHA_B, debut: min(2) }, maintenant: T0 });
  assert.equal(build.etat, 'en-cours');
  assert.equal(build.phase, 'build');
  assert.equal(build.estimationMin, 5, '6 min de build - 2 écoulées + 1 pour la publication');
  assert.equal(syntheseEtat({ site, workflow: { statut: 'en-cours', sha: SHA_B, debut: min(20) }, maintenant: T0 }).estimationMin, 2, 'jamais moins de ≈ 1 min');
  assert.deepEqual(syntheseEtat({ site, workflow: { statut: 'reussi', sha: SHA_A, fin: min(1) }, maintenant: T0 }), { etat: 'a-jour', estimationMin: null });
  const pub = syntheseEtat({ site, workflow: { statut: 'reussi', sha: SHA_B, fin: min(1) }, maintenant: T0, derniereVerification: T0 - 30_000 });
  assert.deepEqual(pub, { etat: 'en-cours', phase: 'publication', estimationMin: 1 });
  assert.equal(syntheseEtat({ site, workflow: { statut: 'reussi', sha: SHA_B, fin: min(1) }, maintenant: T0 }).estimationMin, 5, 'deployer.sh sans guet : 5 min');
  assert.equal(syntheseEtat({ site, workflow: { statut: 'reussi', sha: SHA_B, fin: min(BLOQUE_APRES_MIN + 1) }, maintenant: T0 }).etat, 'bloque');
  assert.equal(syntheseEtat({ site, workflow: { statut: 'reussi', sha: SHA_B, fin: min(1) }, maintenant: T0, echecDeploiement: true }).etat, 'bloque');
  assert.equal(syntheseEtat({ site, workflow: { statut: 'echec', sha: SHA_B }, maintenant: T0 }).etat, 'echec');
  assert.equal(syntheseEtat({ site, workflow: null, maintenant: T0 }).etat, 'inconnu');
});

/** Faux GitHub : réponses programmables, appels notés (avec les en-têtes envoyés). */
function fauxGithub() {
  const appels = [];
  const etat = { panne: false, limite: false, runs: [{ status: 'completed', conclusion: 'success', head_sha: SHA_A, run_number: 7, html_url: 'https://github.com/x/y/actions/runs/1', head_commit: { message: 'Esport : devblog\n\ndétail' }, run_started_at: '2026-10-30T11:50:00Z', updated_at: '2026-10-30T11:55:00Z' }] };
  const fetch = async (url, init) => {
    appels.push({ url: String(url), entetes: init.headers, signal: Boolean(init.signal) });
    if (etat.panne) throw new TypeError('fetch failed');
    if (etat.limite) return new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor((etat.t + 600_000) / 1000)) } });
    const etag = String(url).includes('/commits/') ? '"c1"' : `"r${etat.runs.length}-${etat.runs[0].status}"`;
    if (init.headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
    const corps = String(url).includes('/commits/') ? { sha: SHA_A, commit: { message: 'Esport : devblog', committer: { date: '2026-10-30T11:49:00Z' } } } : { workflow_runs: etat.runs };
    return new Response(JSON.stringify(corps), { status: 200, headers: { 'Content-Type': 'application/json', etag } });
  };
  return { appels, etat, fetch };
}

test('GitHub : cache 2 min, ETag (304), limite de l\'API et panne réseau tolérées, aucun jeton', async () => {
  const gh = fauxGithub();
  const horloge = { t: T0 };
  gh.etat.t = T0;
  const suivi = creerSuiviGithub({ fetch: gh.fetch, maintenant: () => horloge.t });
  const e1 = await suivi.etat();
  assert.equal(e1.erreur, null);
  assert.equal(e1.main.sha, SHA_A);
  assert.equal(e1.workflow.statut, 'reussi');
  assert.equal(e1.workflow.message, 'Esport : devblog');
  assert.equal(gh.appels.length, 2);
  assert.ok(gh.appels.every(a => a.signal && !a.entetes.Authorization && a.url.startsWith('https://api.github.com/repos/Zozoto14/application-Enzo/')));
  // Dans les 2 minutes : rien n'est redemandé.
  horloge.t += CACHE_GITHUB_MS - 1000;
  await suivi.etat();
  assert.equal(gh.appels.length, 2);
  // Après : requêtes conditionnelles (If-None-Match), 304 → réponse gardée.
  horloge.t += 2000;
  const e2 = await suivi.etat();
  assert.equal(gh.appels.length, 4);
  assert.equal(gh.appels[2].entetes['If-None-Match'], '"c1"');
  assert.equal(e2.workflow.sha, SHA_A);
  // Une exécution annulée par une plus récente ne compte pas ; la plus récente en cours, si.
  gh.etat.runs = [{ status: 'in_progress', conclusion: null, head_sha: SHA_B, run_started_at: '2026-10-30T12:03:00Z' }, ...gh.etat.runs];
  horloge.t += CACHE_GITHUB_MS;
  assert.equal((await suivi.etat()).workflow.statut, 'en-cours');
  gh.etat.runs = [{ status: 'completed', conclusion: 'cancelled', head_sha: SHA_B }, ...gh.etat.runs.slice(1)];
  horloge.t += CACHE_GITHUB_MS;
  assert.equal((await suivi.etat()).workflow.sha, SHA_A);
  // Limite de l'API publique : dernière réponse gardée, plus aucun appel avant la remise à zéro annoncée.
  gh.etat.limite = true;
  gh.etat.t = horloge.t;
  horloge.t += CACHE_GITHUB_MS;
  const n = gh.appels.length;
  const e3 = await suivi.etat();
  assert.equal(e3.erreur, 'limite');
  assert.equal(e3.workflow.sha, SHA_A, 'dernière réponse connue');
  assert.ok(e3.reessaiLe);
  horloge.t += 5 * 60_000;
  await suivi.etat();
  assert.ok(gh.appels.length <= n + 2, 'pas de nouvel appel pendant la limite');
  // Panne réseau : erreur « injoignable », données gardées ; jamais d'exception.
  gh.etat.limite = false;
  gh.etat.panne = true;
  horloge.t += 20 * 60_000;
  const e4 = await suivi.etat();
  assert.equal(e4.erreur, 'injoignable');
  assert.equal(e4.main.sha, SHA_A);
  // Premier appel en panne : pas de données, état « inconnu » sans lever.
  const vide = creerSuiviGithub({ fetch: async () => { throw new Error('hors ligne'); }, maintenant: () => T0 });
  assert.deepEqual(await vide.etat(), { main: null, workflow: null, majLe: null, erreur: 'injoignable' });
});

function dossiers() {
  const home = mkdtempSync(join(tmpdir(), 'deploiement-'));
  const etatDir = join(home, '.appdashboard');
  const site = join(home, 'public_html');
  const depot = join(home, 'application-enzo');
  for (const d of [etatDir, site, join(home, 'logs'), join(depot, '.git'), join(depot, 'relais', 'tmp')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(depot, '.git', 'HEAD'), `${SHA_A}\n`);
  writeFileSync(join(depot, 'relais', 'tmp', 'restart.txt'), '');
  writeFileSync(join(etatDir, 'code-deploye'), `${SHA_A}\n`);
  writeFileSync(join(etatDir, 'derniere-verification'), `${Math.floor(T0 / 1000) - 20}\n`);
  writeFileSync(join(site, 'version.json'), JSON.stringify({ id: 'aaaaaaa-x', commit: SHA_A, date: '2026-10-30T11:56:00.000Z' }));
  writeFileSync(join(home, 'logs', 'esport-deploy.log'), '2026-10-30 11:57:00 site : public_html à jour (1234567 Site construit depuis aaaaaaa)\nsortie brute de npm\n');
  return { home, etatDir, site, depot, journal: join(home, 'logs', 'esport-deploy.log') };
}

test('service : versions, journal, état GitHub ; « Vérifier maintenant » dépose seulement un drapeau', async () => {
  const d = dossiers();
  const gh = fauxGithub();
  const service = creerServiceDeploiement({ ...d, github: creerSuiviGithub({ fetch: gh.fetch, maintenant: () => T0 }), maintenant: () => T0 });
  const e = await service.etat();
  assert.equal(e.etat, 'a-jour');
  assert.equal(e.site.commit, SHA_A);
  assert.equal(e.serveur.commit, SHA_A);
  assert.equal(e.serveur.redemarrageEnAttente, false);
  assert.equal(e.relais.commit, SHA_A);
  assert.ok(e.relais.redemarreLe);
  assert.equal(e.deploiement.dernierDeploiement, '2026-10-30 11:57:00');
  assert.deepEqual(e.deploiement.journal.map(l => l.date), ['2026-10-30 11:57:00']);
  assert.equal(e.deploiement.derniereVerification, new Date((Math.floor(T0 / 1000) - 20) * 1000).toISOString());
  assert.equal(e.deploiement.demandeEnAttente, false);
  assert.equal(e.github.workflow.numero, 7);
  // Nouveau build réussi pas encore publié : « en cours », ≈ 1 min (deployer.sh vérifie chaque minute).
  gh.etat.runs = [{ ...gh.etat.runs[0], head_sha: SHA_B }];
  const service2 = creerServiceDeploiement({ ...d, github: creerSuiviGithub({ fetch: gh.fetch, maintenant: () => T0 }), maintenant: () => T0 });
  const e2 = await service2.etat();
  assert.equal(e2.etat, 'en-cours');
  assert.equal(e2.estimationMin, 1);
  // Drapeau : un simple fichier daté, lu (et effacé) par deployer.sh.
  const r = await service.demanderVerification();
  assert.equal(r.demande, true);
  assert.match(readFileSync(join(d.etatDir, 'deployer-demande'), 'utf8'), /^2026-10-30T12:00:00\.000Z\n$/);
  assert.equal((await service.etat()).deploiement.demandeEnAttente, true);
  // Dossier d'état absent : la demande échoue proprement.
  const sans = creerServiceDeploiement({ ...d, etatDir: join(d.home, 'absent'), github: creerSuiviGithub({ fetch: gh.fetch, maintenant: () => T0 }), maintenant: () => T0 });
  assert.deepEqual(await sans.demanderVerification(), { demande: false });
  // Rien à lire (serveur neuf) : état complet quand même, sans lever.
  const vide = mkdtempSync(join(tmpdir(), 'vide-'));
  const e3 = await creerServiceDeploiement({ home: vide, etatDir: join(vide, 'e'), journal: join(vide, 'j.log'), site: join(vide, 's'), depot: vide, github: creerSuiviGithub({ fetch: async () => { throw new Error('x'); }, maintenant: () => T0 }), maintenant: () => T0 }).etat();
  assert.equal(e3.etat, 'inconnu');
  assert.equal(e3.site, null);
  assert.deepEqual(e3.deploiement.journal, []);
});

test('API : Fondateur, permission du club deploiement.voir (pas pour le Second CEO par défaut), 404 sinon', async () => {
  const d = dossiers();
  const gh = fauxGithub();
  const deploiement = creerServiceDeploiement({ ...d, github: creerSuiviGithub({ fetch: gh.fetch, maintenant: () => T0 }), maintenant: () => T0 });
  const b = await banc({ deploiement });
  const A = await teamAvecMembres(b, { membres: { max12345: { pseudo: 'Max', role: 'manager' } } });
  const f = A.sessions.fondateur;
  const max = A.sessions.max12345;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const ok = async (chemin, jeton, options) => {
    const r = await api(chemin, jeton, options);
    assert.equal(r.statut, 200, `${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  assert.equal((await ok('/deploiement', f)).etat, 'a-jour');
  assert.ok((await ok('/sante')).fonctions.includes('deploiement'));
  assert.equal((await api('/deploiement', max)).statut, 404);
  assert.equal((await api('/deploiement/verifier', max, { methode: 'POST', corps: {} })).statut, 404);
  assert.equal(existsSync(join(d.etatDir, 'deployer-demande')), false);
  // Second CEO : pas par défaut.
  const sc = (await ok('/roles-permissions', f)).globaux.roles.find(r => r.cle === 'second_ceo');
  assert.ok(!sc.permissions.includes('deploiement.voir'));
  await ok(`/roles-permissions/globaux/${sc.id}/comptes`, f, { methode: 'POST', corps: { compte: 'max12345' } });
  assert.equal((await api('/deploiement', max)).statut, 404);
  // Rôle du club qui a la permission : accès.
  await ok('/roles-permissions/globaux', f, { methode: 'POST', corps: { nom: 'Suivi des mises à jour', couleur: '#22a879', permissions: ['deploiement.voir'] } });
  const role = (await ok('/roles-permissions', f)).globaux.roles.find(r => r.nom === 'Suivi des mises à jour');
  await ok(`/roles-permissions/globaux/${role.id}/comptes`, f, { methode: 'POST', corps: { compte: 'max12345' } });
  assert.equal((await ok('/deploiement', max)).site.commit, SHA_A);
  assert.equal((await ok('/deploiement/verifier', max, { methode: 'POST', corps: {} })).demande, true);
  assert.ok(existsSync(join(d.etatDir, 'deployer-demande')));
  assert.equal((await api('/deploiement/autre', f)).statut, 404);
  // Serveur sans le service (serveur local) : 404 explicite.
  const sansService = await banc();
  const f2 = await sansService.session('principal');
  const r = await sansService.appel('/deploiement', { jeton: f2 });
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'deploiement-indisponible');
});
