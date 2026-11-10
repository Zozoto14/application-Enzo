/**
 * Diagnostic des e-mails : codes d'erreur SMTP précis (vraies erreurs de nodemailer contre le FAUX serveur SMTP
 * local, un port fermé, un serveur muet, un nom inconnu), vérification au démarrage, route « Tester l'envoi »
 * (/courriel/tester) et version en service du relais (/serveur/version). Aucun e-mail ne sort de la machine.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { relais, jetonDeProfil } from './relais.mjs';
import { codeErreurSmtp, detailTechnique, expliquerErreurSmtp } from './courriel-erreurs.mjs';
import { configSmtp, creerEnvoyeur, manquesSmtp, resumeSmtp, suivreVerificationSmtp } from '../esport/serveur/courriel-smtp.mjs';
import { etatVersion, infosDemarrage } from '../esport/serveur/version-serveur.mjs';
import { ligneDemarrage } from './serveur/app.mjs';
import { fauxSmtp } from './test-smtp/faux-smtp.mjs';

const nodemailer = createRequire(new URL('../esport/serveur/', import.meta.url))('nodemailer');
const JETON = 'jeton-de-test-0123456789abcdef';
let smtp;

const kvMemoire = () => {
  const d = new Map();
  return { get: async c => (d.has(c) ? d.get(c) : null), put: async (c, v) => void d.set(c, v), delete: async c => void d.delete(c) };
};
const appel = (env, chemin, { methode = 'POST', corps, jeton = JETON } = {}) =>
  relais.traiter(new Request(`https://relais.test${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, ...(corps ? { body: JSON.stringify(corps) } : {}) }), env);

/** Env du relais comme relais/serveur/app.mjs le prépare, avec un envoyeur réel vers `cible`. */
async function envRelais(variables) {
  const config = configSmtp(variables);
  const envoyeur = await creerEnvoyeur(config);
  const suivi = suivreVerificationSmtp(envoyeur, { journal: { log() {}, error() {} } });
  return {
    envoyeur,
    env: {
      JETON,
      BOITE: kvMemoire(),
      ...(envoyeur ? { ENVOYER_COURRIEL: envoyeur, MAIL_FROM_AFFICHE: config.adresseDe } : {}),
      COURRIEL_DIAGNOSTIC: { manques: manquesSmtp(variables), verifier: envoyeur?.verifier, verification: suivi.etat },
    },
  };
}

/** Erreur réelle de nodemailer (verify) avec des délais courts. */
async function erreurVerify(options) {
  const t = nodemailer.createTransport({ logger: false, ignoreTLS: true, secure: false, connectionTimeout: 800, greetingTimeout: 800, socketTimeout: 1000, auth: { user: 'a@b.fr', pass: 'x' }, ...options });
  try {
    await t.verify();
    return null;
  } catch (e) {
    return e;
  } finally {
    t.close();
  }
}

before(async () => {
  smtp = await fauxSmtp();
});
after(async () => {
  await smtp.fermer();
});

test('codes SMTP : connexion refusée, délai, nom inconnu, identifiants refusés (vraies erreurs de nodemailer)', async () => {
  const ferme = net.createServer();
  await new Promise(ok => ferme.listen(0, '127.0.0.1', ok));
  const portFerme = ferme.address().port;
  await new Promise(ok => ferme.close(ok));
  const refus = await erreurVerify({ host: '127.0.0.1', port: portFerme });
  assert.equal(codeErreurSmtp(refus), 'smtp-refuse');
  assert.match(detailTechnique(refus), /ESOCKET ECONNREFUSED/);

  const muet = net.createServer(() => {});
  await new Promise(ok => muet.listen(0, '127.0.0.1', ok));
  const delai = await erreurVerify({ host: '127.0.0.1', port: muet.address().port });
  muet.close();
  assert.equal(codeErreurSmtp(delai), 'smtp-delai');
  assert.match(detailTechnique(delai), /ETIMEDOUT/);

  const inconnu = await erreurVerify({ host: 'serveur-smtp.invalid', port: 25 });
  assert.equal(codeErreurSmtp(inconnu), 'smtp-hote-inconnu');

  const auth = await erreurVerify({ host: '127.0.0.1', port: smtp.port });
  assert.equal(codeErreurSmtp(auth), 'smtp-authentification');
  assert.equal(detailTechnique(auth), 'EAUTH 535');
  assert.match(expliquerErreurSmtp('smtp-authentification'), /SMTP_USER.*SMTP_PASS/);
  assert.match(expliquerErreurSmtp('smtp-refuse'), /ECONNREFUSED/);
  assert.match(expliquerErreurSmtp('smtp-delai'), /ETIMEDOUT/);
  assert.match(expliquerErreurSmtp('smtp-hote-inconnu'), /ENOTFOUND/);
});

test('codes SMTP : expéditeur refusé, destinataire refusé, limite de l’hébergeur (faux SMTP)', async () => {
  const envoyeur = await creerEnvoyeur(configSmtp(smtp.env));
  const essai = async () => {
    try {
      await envoyeur({ a: 'lea@exemple.fr', objet: 'x', texte: 'x', html: '<p>x</p>' });
      return null;
    } catch (e) {
      return e;
    }
  };
  try {
    smtp.refuserExpediteur = () => true;
    assert.equal(codeErreurSmtp(await essai()), 'expediteur-refuse');
    smtp.refuserExpediteur = () => false;
    smtp.refuser = () => true;
    assert.equal(codeErreurSmtp(await essai()), 'destinataire-refuse');
    smtp.refuser = () => false;
    smtp.limite = true;
    assert.equal(codeErreurSmtp(await essai()), 'smtp-limite');
  } finally {
    smtp.limite = false;
    smtp.refuser = () => false;
    smtp.refuserExpediteur = () => false;
    envoyeur.fermer();
  }
  assert.equal(codeErreurSmtp({ code: 'EENVELOPE' }), 'destinataire-refuse', 'adresse invalide refusée avant tout envoi');
  assert.equal(codeErreurSmtp({ responseCode: 451, message: '451 4.3.0 try again later' }), 'smtp-temporaire');
  assert.equal(codeErreurSmtp({}), 'smtp-erreur');
});

test('vérification au démarrage : ok, échec (code et explication au journal), non configuré', async () => {
  const lignes = [];
  const journal = { log: l => lignes.push(['log', l]), error: l => lignes.push(['error', l]) };
  const bon = await creerEnvoyeur(configSmtp(smtp.env));
  const v = suivreVerificationSmtp(bon, { app: 'relais', journal });
  assert.equal(v.etat().statut, 'en-cours');
  assert.equal((await v.lancer()).statut, 'ok');
  assert.match(lignes.at(-1)[1], /^\[relais\] e-mails : connexion SMTP vérifiée/);
  bon.fermer();

  const mauvais = await creerEnvoyeur(configSmtp({ ...smtp.env, SMTP_PASS: 'faux-mot-de-passe' }));
  const e = await suivreVerificationSmtp(mauvais, { app: 'relais', journal }).lancer();
  assert.deepEqual({ statut: e.statut, code: e.code, technique: e.technique }, { statut: 'echec', code: 'smtp-authentification', technique: 'EAUTH 535' });
  assert.equal(lignes.at(-1)[0], 'error');
  assert.match(lignes.at(-1)[1], /ÉCHEC : smtp-authentification \(EAUTH 535\)\. Identifiant ou mot de passe SMTP refusé/);
  assert.ok(!lignes.some(([, l]) => l.includes('faux-mot-de-passe')), 'jamais le mot de passe au journal');
  mauvais.fermer();

  assert.equal((await suivreVerificationSmtp(undefined).lancer()).statut, 'non-configure');
  assert.equal(resumeSmtp(configSmtp(smtp.env)), `127.0.0.1:${smtp.port}, sans chiffrement (tests), expéditeur noreply@appdashboard.test`);
});

test('Tester l’envoi : non configuré (variables manquantes), identifiants refusés, e-mail de test reçu, réservé au Fondateur', async () => {
  // Non configuré : 503 et la liste des variables manquantes (jamais une valeur).
  const vide = await envRelais({ SMTP_HOST: 'poisson.o2switch.net', SMTP_PASS: 'secret' });
  const r1 = await appel(vide.env, '/courriel/tester', { corps: {} });
  assert.equal(r1.status, 503);
  const c1 = await r1.json();
  assert.deepEqual({ ok: c1.ok, etape: c1.etape, code: c1.code, manques: c1.manques }, { ok: false, etape: 'configuration', code: 'non-configure', manques: ['SMTP_USER', 'MAIL_FROM'] });
  assert.match(c1.explication, /Manquant : SMTP_USER, MAIL_FROM/);
  assert.ok(!JSON.stringify(c1).includes('secret'));
  const etat = await (await appel(vide.env, '/courriel/etat', { methode: 'GET' })).json();
  assert.deepEqual(etat.manques, ['SMTP_USER', 'MAIL_FROM']);
  assert.equal(etat.verification.statut, 'non-configure');

  // Identifiants refusés : arrêt à l'étape « connexion », code précis, rien n'est envoyé.
  const mauvais = await envRelais({ ...smtp.env, SMTP_PASS: 'pas-le-bon' });
  const avant = smtp.messages.length;
  const c2 = await (await appel(mauvais.env, '/courriel/tester', { corps: { adresse: 'enzo@exemple.fr' } })).json();
  assert.deepEqual({ ok: c2.ok, etape: c2.etape, code: c2.code, technique: c2.technique }, { ok: false, etape: 'connexion', code: 'smtp-authentification', technique: 'EAUTH 535' });
  assert.equal(smtp.messages.length, avant);
  mauvais.envoyeur.fermer();

  // Tout va bien : e-mail de test reçu à l'adresse du Fondateur, adresse masquée dans la réponse et le journal.
  const bon = await envRelais(smtp.env);
  const c3 = await (await appel(bon.env, '/courriel/tester', { corps: { adresse: 'enzo@exemple.fr' } })).json();
  assert.deepEqual({ ok: c3.ok, etape: c3.etape, a: c3.a }, { ok: true, etape: 'envoi', a: 'e***@e***.fr' });
  assert.deepEqual(smtp.messages.at(-1).a, ['enzo@exemple.fr']);
  const journal = await (await appel(bon.env, '/courriel/journal', { methode: 'GET' })).json();
  assert.equal(journal.envois[0].ref, 'test');
  assert.ok(!JSON.stringify(journal).includes('enzo@exemple.fr'));
  // Sans adresse : la boîte d'envoi elle-même.
  await appel(bon.env, '/courriel/tester', { corps: {} });
  assert.deepEqual(smtp.messages.at(-1).a, ['noreply@appdashboard.test']);
  // Destinataire refusé : étape « envoi », code précis.
  smtp.refuser = () => true;
  const c4 = await (await appel(bon.env, '/courriel/tester', { corps: { adresse: 'nexiste@exemple.fr' } })).json();
  smtp.refuser = () => false;
  assert.deepEqual({ ok: c4.ok, etape: c4.etape, code: c4.code }, { ok: false, etape: 'envoi', code: 'destinataire-refuse' });
  // Adresse invalide.
  assert.equal((await appel(bon.env, '/courriel/tester', { corps: { adresse: 'pas une adresse' } })).status, 400);
  // Réservé au Fondateur.
  const ami = await jetonDeProfil(JETON, 'abc123def');
  assert.equal((await appel(bon.env, '/courriel/tester', { corps: {}, jeton: ami })).status, 403);
  bon.envoyeur.fermer();
});

test('version en service : /serveur/version (Fondateur), écart avec le commit déployé = pas redémarré', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'version-relais-'));
  try {
    const infos = { app: 'relais', commit: 'a'.repeat(40), demarreLe: '2026-11-07T12:00:00.000Z', pid: 4242, node: '22.12.0' };
    const maintenant = () => Date.parse('2026-11-10T12:00:00.000Z');
    const env = { JETON, BOITE: kvMemoire(), VERSION_SERVEUR: () => etatVersion(infos, { etatDir: dossier, maintenant }) };
    let v = await (await appel(env, '/serveur/version', { methode: 'GET' })).json();
    assert.deepEqual(v, { ...infos, commitCourt: 'aaaaaaa', dureeS: 3 * 86_400, codeDeploye: null, aJour: null, heure: '2026-11-10T12:00:00.000Z' });
    writeFileSync(join(dossier, 'code-deploye'), `${'a'.repeat(40)}\n`);
    assert.equal((await (await appel(env, '/serveur/version', { methode: 'GET' })).json()).aJour, true);
    writeFileSync(join(dossier, 'code-deploye'), `${'b'.repeat(40)}\n`);
    v = await (await appel(env, '/serveur/version', { methode: 'GET' })).json();
    assert.equal(v.aJour, false, 'un autre commit a été déployé depuis le démarrage');
    assert.equal(v.codeDeploye, 'b'.repeat(40));
    const ami = await jetonDeProfil(JETON, 'abc123def');
    assert.equal((await appel(env, '/serveur/version', { methode: 'GET', jeton: ami })).status, 403);
    assert.equal((await appel(env, '/serveur/version', { methode: 'GET', jeton: 'mauvais' })).status, 401);
    assert.equal((await appel({ JETON, BOITE: kvMemoire() }, '/serveur/version', { methode: 'GET' })).status, 404);
    // Relevé réel du démarrage : commit du dépôt, pid et Node du processus.
    const reel = infosDemarrage({ app: 'relais' });
    assert.equal(reel.pid, process.pid);
    assert.equal(reel.node, process.versions.node);
    assert.ok(reel.commit === null || /^[0-9a-f]{40}$/.test(reel.commit));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('ligne de démarrage du relais : version, Node, pid, configuration, SMTP ou variables manquantes', () => {
  const infos = { app: 'relais', commit: 'abc1234'.padEnd(40, '0'), demarreLe: '2026-11-10T12:00:00.000Z', pid: 77, node: '22.12.0' };
  const ok = ligneDemarrage({ infos, config: { fichierEnv: '/home/x/.appdashboard/relais.env', smtp: configSmtp(smtp.env), smtpManques: [] }, journal: { fichier: '/home/x/logs/relais.log' } });
  assert.match(ok, /^\[relais\] démarrage : version abc1234, Node 22\.12\.0, pid 77, configuration \/home\/x\/\.appdashboard\/relais\.env, journal \/home\/x\/logs\/relais\.log ; e-mails : SMTP configuré \(127\.0\.0\.1:\d+/);
  assert.ok(!ok.includes(smtp.env.SMTP_PASS));
  const ko = ligneDemarrage({ infos, config: { fichierEnv: null, smtp: undefined, smtpManques: ['SMTP_PASS', 'MAIL_FROM'] }, journal: null });
  assert.match(ko, /journal désactivé ; e-mails : SMTP NON configuré \(manquant : SMTP_PASS, MAIL_FROM\)$/);
});
