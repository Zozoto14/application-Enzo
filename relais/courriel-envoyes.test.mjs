/**
 * Copie des e-mails envoyés dans « Envoyés » (IMAP APPEND) : faux SMTP + faux IMAP locaux,
 * aucun e-mail ne sort de la machine. Voir esport/serveur/imap-envoyes.mjs et docs/emails.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configSmtp, creerEnvoyeur } from '../esport/serveur/courriel-smtp.mjs';
import { choisirDossier, codeErreurImap, creerCopieur, dateImap } from '../esport/serveur/imap-envoyes.mjs';
import { codeErreur } from './courriel.mjs';
import { fauxSmtp } from './test-smtp/faux-smtp.mjs';
import { fauxImap } from './test-smtp/faux-imap.mjs';

const mail = { a: 'lea@exemple.fr', nom: 'Léa', objet: 'Entraînement mardi', texte: 'Bonjour Léa', html: '<p>Bonjour Léa</p>', langue: 'fr' };

async function banc(optionsImap = {}, envSupplementaire = {}) {
  const smtp = await fauxSmtp();
  const imap = await fauxImap(optionsImap);
  const journal = [];
  const config = configSmtp({ ...smtp.env, ...imap.env, MAIL_COPIE_ENVOYES: '1', ...envSupplementaire });
  const copieur = creerCopieur(config.imap, { journal: code => journal.push(code) });
  const envoyeur = await creerEnvoyeur(config, { copieur });
  return {
    smtp,
    imap,
    journal,
    envoyeur,
    async fin() {
      await envoyeur.fermer();
      await smtp.fermer();
      await imap.fermer();
    },
  };
}

test('configuration : copie activée par défaut, IMAP_HOST = SMTP_HOST, port 993, désactivable', () => {
  const base = { SMTP_HOST: 'poisson.o2switch.net', SMTP_USER: 'noreply@appdashboard.fr', SMTP_PASS: 'x', MAIL_FROM: 'AppDashboard <noreply@appdashboard.fr>' };
  const c = configSmtp(base);
  assert.equal(c.copieEnvoyes, true);
  assert.deepEqual({ ...c.imap, motDePasse: undefined }, { hote: 'poisson.o2switch.net', port: 993, utilisateur: 'noreply@appdashboard.fr', motDePasse: undefined, dossier: undefined, sansTls: false });
  assert.equal(configSmtp({ ...base, MAIL_COPIE_ENVOYES: '0' }).copieEnvoyes, false);
  const d = configSmtp({ ...base, IMAP_HOST: 'imap.exemple.fr', IMAP_PORT: '143', IMAP_DOSSIER: 'INBOX.Sent' });
  assert.equal(d.imap.hote, 'imap.exemple.fr');
  assert.equal(d.imap.port, 143);
  assert.equal(d.imap.dossier, 'INBOX.Sent');
});

test('copie déposée : MIME exact envoyé par SMTP, drapeau \\Seen, date d’envoi, dossier \\Sent', async () => {
  const b = await banc();
  try {
    const { id } = await b.envoyeur(mail);
    assert.match(id, /^<.+@.+>$/);
    assert.equal(b.smtp.messages.length, 1);
    assert.equal(b.imap.ajouts.length, 1);
    const ajout = b.imap.ajouts[0];
    assert.equal(ajout.dossier, 'Sent');
    assert.equal(ajout.drapeaux, '\\Seen');
    assert.match(ajout.date, /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2} \+0000$/);
    // Octet pour octet le message transmis (hors point final du protocole SMTP).
    assert.equal(ajout.donnees.toString('utf8').trimEnd(), b.smtp.messages[0].donnees.trimEnd());
    assert.match(ajout.donnees.toString(), new RegExp(`Message-ID: ${id.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}`, 'i'));
    assert.deepEqual(b.smtp.messages[0].a, ['lea@exemple.fr']);
    assert.deepEqual(b.journal, []);
  } finally {
    await b.fin();
  }
});

test('connexion réutilisée pour plusieurs envois', async () => {
  const b = await banc();
  try {
    await b.envoyeur(mail);
    await b.envoyeur({ ...mail, a: 'tom@exemple.fr' });
    assert.equal(b.imap.ajouts.length, 2);
    assert.equal(b.imap.etat.connexions, 1);
    assert.equal(b.imap.etat.commandes.filter(c => c === 'LIST').length, 1, 'dossier détecté une seule fois');
  } finally {
    await b.fin();
  }
});

test('échec de l’IMAP : l’envoi réussit quand même, journal sans adresse, pause ensuite', async () => {
  const b = await banc();
  b.imap.etat.refuserAppend = true;
  try {
    const r = await b.envoyeur(mail);
    assert.ok(r.id);
    assert.equal(b.smtp.messages.length, 1);
    assert.equal(b.imap.ajouts.length, 0);
    assert.equal(b.journal.length, 1);
    assert.ok(!b.journal.join(' ').includes('@'));
    // Pause de 60 s après un échec : le second envoi n’essaie pas l’IMAP, mais part.
    b.imap.etat.refuserAppend = false;
    await b.envoyeur({ ...mail, a: 'tom@exemple.fr' });
    assert.equal(b.smtp.messages.length, 2);
    assert.equal(b.imap.ajouts.length, 0);
  } finally {
    await b.fin();
  }
});

test('IMAP injoignable ou mauvais identifiants : l’envoi n’est jamais affecté', async () => {
  const smtp = await fauxSmtp();
  const imap = await fauxImap();
  const port = imap.port;
  await imap.fermer();
  const journal = [];
  try {
    const injoignable = await creerEnvoyeur(configSmtp({ ...smtp.env, MAIL_COPIE_ENVOYES: '1', IMAP_HOST: '127.0.0.1', IMAP_PORT: String(port), IMAP_SANS_TLS: '1' }), { copieur: creerCopieur({ hote: '127.0.0.1', port, utilisateur: 'u', motDePasse: 'p', sansTls: true }, { journal: c => journal.push(c) }) });
    assert.ok((await injoignable(mail)).id);
    assert.deepEqual(journal, ['imap-connexion']);
    await injoignable.fermer();
    assert.equal(smtp.messages.length, 1);
  } finally {
    await smtp.fermer();
  }
  const b = await banc();
  try {
    const mauvais = creerCopieur({ hote: '127.0.0.1', port: b.imap.port, utilisateur: 'noreply@appdashboard.test', motDePasse: 'faux', sansTls: true }, { journal: c => b.journal.push(c) });
    const r = await mauvais({ message: Buffer.from('Subject: x\r\n\r\ny'), date: new Date() });
    assert.deepEqual(r, { ok: false, code: 'imap-authentification' });
    assert.deepEqual(b.journal, ['imap-authentification']);
    await mauvais.fermer();
  } finally {
    await b.fin();
  }
});

test('MAIL_COPIE_ENVOYES=0 : aucune copie, envoi par sendMail normal', async () => {
  const smtp = await fauxSmtp();
  const imap = await fauxImap();
  try {
    const e = await creerEnvoyeur(configSmtp({ ...smtp.env, ...imap.env, MAIL_COPIE_ENVOYES: '0' }));
    await e(mail);
    await e.fermer();
    assert.equal(smtp.messages.length, 1);
    assert.equal(imap.etat.connexions, 0);
  } finally {
    await smtp.fermer();
    await imap.fermer();
  }
});

test('détection du dossier : \\Sent, Sent, INBOX.Sent, IMAP_DOSSIER', async () => {
  const sans = d => d.map(nom => ({ nom, drapeaux: [] }));
  assert.equal(choisirDossier(['* LIST (\\HasNoChildren \\Sent) "." "Éléments envoyés"', '* LIST () "." "Sent"']), 'Éléments envoyés');
  assert.equal(choisirDossier(['* LIST (\\HasNoChildren) "." "INBOX"', '* LIST (\\HasNoChildren) "." "INBOX.Sent"']), 'INBOX.Sent');
  assert.equal(choisirDossier(['* LIST () "/" Sent']), 'Sent');
  assert.equal(choisirDossier(['* LIST () "." "INBOX"', '* LIST () "." "Archives"']), undefined);
  // Bout en bout avec le faux serveur
  for (const [dossiers, attendu, options] of [
    [[{ nom: 'INBOX', drapeaux: [] }, { nom: 'Envoyes-perso', drapeaux: ['\\Sent'] }], 'Envoyes-perso', {}],
    [sans(['INBOX', 'INBOX.Sent']), 'INBOX.Sent', {}],
    [sans(['INBOX', 'Sent', 'Perso']), 'Perso', { IMAP_DOSSIER: 'Perso' }],
  ]) {
    const b = await banc({ dossiers }, options);
    try {
      await b.envoyeur(mail);
      assert.equal(b.imap.ajouts[0]?.dossier, attendu);
    } finally {
      await b.fin();
    }
  }
  // Serveur sans SPECIAL-USE : LIST simple, repli sur INBOX.Sent
  const b = await banc({ specialUse: false, dossiers: [{ nom: 'INBOX', drapeaux: [] }, { nom: 'INBOX.Sent', drapeaux: ['\\Sent'] }] });
  try {
    await b.envoyeur(mail);
    assert.equal(b.imap.ajouts[0]?.dossier, 'INBOX.Sent');
  } finally {
    await b.fin();
  }
  // Aucun dossier trouvé : journal, pas d’exception
  const c = await banc({ dossiers: sans(['INBOX']) });
  try {
    assert.ok((await c.envoyeur(mail)).id);
    assert.deepEqual(c.journal, ['imap-dossier']);
  } finally {
    await c.fin();
  }
});

test('dateImap et codes d’erreur IMAP', () => {
  assert.equal(dateImap(new Date('2026-10-22T20:40:06Z')), '22-Oct-2026 20:40:06 +0000');
  assert.equal(codeErreurImap(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })), 'imap-certificat');
  assert.equal(codeErreurImap({ code: 'ECONNREFUSED' }), 'imap-connexion');
  assert.equal(codeErreurImap({ code: 'ETIMEDOUT' }), 'imap-delai');
});

test('messages d’erreur SMTP : certificat, authentification, injoignable', () => {
  const cert = Object.assign(new Error("Hostname/IP does not match certificate's altnames: Host: mail.appdashboard.fr. is not in the cert's altnames: DNS:poisson.o2switch.net"), { code: 'ESOCKET' });
  assert.equal(codeErreur(cert), 'smtp-certificat');
  assert.equal(codeErreur(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })), 'smtp-certificat');
  assert.equal(codeErreur(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })), 'smtp-authentification');
  assert.equal(codeErreur(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ESOCKET' })), 'smtp-refuse');
});
