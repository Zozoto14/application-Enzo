/**
 * E-mails envoyés par le serveur : vrai transport (nodemailer, esport/serveur/courriel-smtp.mjs) vers
 * un FAUX serveur SMTP local (relais/test-smtp/faux-smtp.mjs). Aucun e-mail ne sort de la machine.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import relais, { jetonDeProfil } from './worker.mjs';
import { configSmtp, creerEnvoyeur, manquesSmtp } from '../esport/serveur/courriel-smtp.mjs';
import { adresseValide, markdownVersHtml, markdownVersTexte, masquerAdresse, rendreCourriel } from './courriel-modeles.mjs';
import { decoderMessage, fauxSmtp } from './test-smtp/faux-smtp.mjs';

const JETON = 'jeton-de-test-0123456789abcdef';
let smtp;
let envoyeur;

function kvMemoire() {
  const donnees = new Map();
  return { donnees, get: async c => (donnees.has(c) ? donnees.get(c) : null), put: async (c, v) => void donnees.set(c, v), delete: async c => void donnees.delete(c) };
}

before(async () => {
  smtp = await fauxSmtp();
  envoyeur = await creerEnvoyeur(configSmtp(smtp.env));
});
after(async () => {
  envoyeur?.fermer?.();
  await smtp.fermer();
});

const appel = (env, chemin, { methode = 'POST', corps, jeton = JETON } = {}) =>
  relais.fetch(new Request(`https://relais.test${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, ...(corps ? { body: JSON.stringify(corps) } : {}) }), env);

test('courriel : configuration SMTP lue dans le .env, incomplète = désactivée', () => {
  assert.equal(configSmtp({}), undefined);
  assert.deepEqual(manquesSmtp({ SMTP_HOST: 'mail.appdashboard.fr' }), ['SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']);
  const c = configSmtp({ SMTP_HOST: 'mail.appdashboard.fr', SMTP_USER: 'noreply@appdashboard.fr', SMTP_PASS: 'x', MAIL_FROM: 'AppDashboard <noreply@appdashboard.fr>' });
  assert.equal(c.port, 465);
  assert.equal(c.securise, true, '465 : SSL/TLS direct');
  assert.equal(configSmtp({ ...smtp.env, SMTP_PORT: '587', SMTP_SANS_TLS: '' }).securise, false, '587 : STARTTLS');
  assert.equal(configSmtp({ ...smtp.env, MAIL_FROM: 'pas une adresse' }), undefined);
});

test('courriel : sans transport (Worker Cloudflare) → 503 non-configure ; réservé au jeton maître', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const r = await appel(env, '/courriel/envoyer', { corps: { destinataires: ['lea@exemple.fr'], variables: { objet: 'Salut', message: 'Coucou' } } });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).motif, 'non-configure');
  assert.deepEqual(await (await appel(env, '/courriel/etat', { methode: 'GET' })).json(), { configure: false, expediteur: null, limites: { heure: 100, jour: 300 } });
  const ami = await jetonDeProfil(JETON, 'abc123def');
  for (const chemin of ['/courriel/etat', '/courriel/journal']) assert.equal((await appel(env, chemin, { methode: 'GET', jeton: ami })).status, 403);
  assert.equal((await appel({ ...env, ENVOYER_COURRIEL: envoyeur }, '/courriel/envoyer', { jeton: ami, corps: { destinataires: ['a@b.fr'] } })).status, 403);
});

test('courriel : message libre envoyé par le vrai transport au faux SMTP (HTML + texte, un e-mail par destinataire)', async () => {
  const env = { JETON, BOITE: kvMemoire(), ENVOYER_COURRIEL: envoyeur, LIEN_APP: 'https://appdashboard.fr' };
  const avant = smtp.messages.length;
  const r = await appel(env, '/courriel/envoyer', {
    corps: {
      destinataires: [{ adresse: 'lea@exemple.fr', nom: 'Léa' }, { adresse: 'tom@exemple.fr', langue: 'en' }, 'LEA@exemple.fr'],
      variables: { objet: 'Tournoi samedi', message: '# Rendez-vous\n**Samedi 14 h**, salle B.\n- apportez vos *souris*\n- [le règlement](https://exemple.fr/r)\n<script>alert(1)</script>' },
      ref: 'messagerie',
    },
  });
  assert.equal(r.status, 200);
  const lu = await r.json();
  assert.equal(lu.ok, true);
  assert.deepEqual(lu.resultats, [{ a: 'l***@e***.fr', statut: 'envoye' }, { a: 't***@e***.fr', statut: 'envoye' }], 'doublon ignoré, adresses masquées');
  const recus = smtp.messages.slice(avant);
  assert.equal(recus.length, 2);
  assert.deepEqual(recus.map(m => m.a), [['lea@exemple.fr'], ['tom@exemple.fr']], 'personne ne voit l’adresse des autres');
  assert.ok(recus.every(m => m.auth), 'authentifié auprès du serveur SMTP');
  const m = decoderMessage(recus[0].donnees);
  assert.match(m.entetes, /Subject: Tournoi samedi/);
  assert.match(m.entetes, /From: AppDashboard <noreply@appdashboard\.test>/);
  assert.match(m.entetes, /multipart\/alternative/);
  const html = m.parties.find(p => /text\/html/.test(p.entetes)).corps;
  const texte = m.parties.find(p => /text\/plain/.test(p.entetes)).corps;
  assert.match(html, /<strong>Samedi 14 h<\/strong>/);
  assert.match(html, /<a href="https:\/\/exemple\.fr\/r"/);
  assert.ok(!html.includes('<script>'), 'aucune balise venue du texte');
  assert.match(html, /&lt;script&gt;/);
  assert.match(texte, /Samedi 14 h, salle B\./, 'version texte');
  const journal = await (await appel(env, '/courriel/journal', { methode: 'GET' })).json();
  assert.equal(journal.envois[0].objet, 'Tournoi samedi');
  assert.equal(journal.envois[0].ref, 'messagerie');
  const brut = [...env.BOITE.donnees.values()].join('\n');
  assert.ok(!/lea@exemple|tom@exemple/i.test(brut), 'aucune adresse en clair dans la boîte');
  assert.deepEqual(await (await appel(env, '/courriel/etat', { methode: 'GET' })).json(), { configure: true, expediteur: null, limites: { heure: 100, jour: 300 } });
});

test('courriel : invitation (bouton vers le lien), FR et EN', async () => {
  const env = { JETON, BOITE: kvMemoire(), ENVOYER_COURRIEL: envoyeur };
  const avant = smtp.messages.length;
  const r = await appel(env, '/courriel/envoyer', {
    corps: { modele: 'invitation', langue: 'en', destinataires: ['sam@exemple.com'], variables: { objet: 'Enzo invites you', message: 'Hi Sam!\nOpen the link.', lien: 'https://appdashboard.fr/#invitation=abc' }, ref: 'invitation:sam' },
  });
  assert.equal(r.status, 200);
  const m = decoderMessage(smtp.messages[avant].donnees);
  assert.match(m.texte, /Accept the invitation/);
  assert.match(m.texte, /href="https:\/\/appdashboard\.fr\/#invitation=abc"/);
  assert.match(rendreCourriel({ modele: 'invitation', langue: 'fr', variables: { objet: 'x', message: 'y', lien: 'https://a.fr/x' } }).html, /Accepter l’invitation/);
  assert.equal((await appel(env, '/courriel/envoyer', { corps: { modele: 'invitation', destinataires: ['a@b.fr'], variables: { objet: 'x', message: 'yy', lien: 'javascript:alert(1)' } } })).status, 400);
  assert.equal((await appel(env, '/courriel/envoyer', { corps: { modele: 'piratage', destinataires: ['a@b.fr'], variables: { objet: 'x', message: 'yy' } } })).status, 400);
});

test('courriel : échec SMTP (destinataire refusé, mauvais mot de passe) → statut « échec », code court, sans adresse', async () => {
  const env = { JETON, BOITE: kvMemoire(), ENVOYER_COURRIEL: envoyeur };
  smtp.refuser = a => a.startsWith('inconnu');
  try {
    const r = await appel(env, '/courriel/envoyer', { corps: { destinataires: ['inconnu@exemple.fr', 'ok@exemple.fr', 'pas-une-adresse'], variables: { objet: 'Test', message: 'Bonjour' } } });
    assert.equal(r.status, 200);
    const lu = await r.json();
    assert.equal(lu.ok, false);
    assert.deepEqual(lu.resultats.map(x => x.statut), ['echec', 'envoye', 'echec']);
    assert.equal(lu.resultats[0].erreur, 'destinataire-refuse');
    assert.equal(lu.resultats[2].erreur, 'adresse-invalide');
    assert.ok(!JSON.stringify(lu).includes('inconnu@'));
  } finally {
    smtp.refuser = () => false;
  }
  const mauvais = await creerEnvoyeur(configSmtp({ ...smtp.env, SMTP_PASS: 'faux' }));
  try {
    const r = await appel({ ...env, ENVOYER_COURRIEL: mauvais }, '/courriel/envoyer', { corps: { destinataires: ['ok@exemple.fr'], variables: { objet: 'Test', message: 'Bonjour' } } });
    assert.equal(r.status, 502);
    assert.equal((await r.json()).resultats[0].erreur, 'smtp-authentification');
  } finally {
    mauvais.fermer();
  }
});

test('courriel : limite d’envoi (100 par heure)', async () => {
  let n = 0;
  const env = { JETON, BOITE: kvMemoire(), ENVOYER_COURRIEL: async () => void n++ };
  const lot = Array.from({ length: 60 }, (_, i) => `membre${i}@exemple.fr`);
  assert.equal((await appel(env, '/courriel/envoyer', { corps: { destinataires: lot, variables: { objet: 'A', message: 'Bonjour' } } })).status, 200);
  const refus = await appel(env, '/courriel/envoyer', { corps: { destinataires: lot, variables: { objet: 'B', message: 'Bonjour' } } });
  assert.equal(refus.status, 429);
  assert.equal((await refus.json()).motif, 'limite');
  assert.equal(n, 60);
  assert.equal((await appel(env, '/courriel/envoyer', { corps: { destinataires: lot.slice(0, 40), variables: { objet: 'C', message: 'Bonjour' } } })).status, 200);
  assert.equal((await appel(env, '/courriel/envoyer', { corps: { destinataires: Array.from({ length: 101 }, (_, i) => `x${i}@e.fr`), variables: { objet: 'D', message: 'Bonjour' } } })).status, 400);
});

test('courriel : modèles et aides (Markdown sûr, adresses)', () => {
  assert.equal(masquerAdresse('enzo.axel@icloud.com'), 'e***@i***.com');
  assert.equal(masquerAdresse('n’importe quoi'), '***');
  assert.ok(adresseValide('lea@exemple.fr'));
  for (const a of ['lea@exemple', 'lea@exemple.fr\r\nBcc: x@y.fr', 'a b@c.fr', '<a@b.fr>', 'a@b.fr,c@d.fr']) assert.ok(!adresseValide(a), a);
  const html = markdownVersHtml('Lien [piège](javascript:alert(1)) et {{rouge|rouge}} et ==surligné== et `<b>`\n> cité\n1. un\n2. deux\n- [x] fait');
  assert.ok(!/javascript:/i.test(html.replace(/\[piège\]\(javascript:alert\(1\)\)/, '')) || !html.includes('href="javascript'));
  assert.ok(!html.includes('href="javascript'));
  assert.match(html, /<span style="color:#d64545">rouge<\/span>/);
  assert.match(html, /<mark/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<blockquote/);
  assert.match(html, /<ol/);
  assert.match(html, /☑ fait/);
  assert.equal(markdownVersTexte('**gras** et [lien](https://a.fr)'), 'gras et lien (https://a.fr)');
  const s = rendreCourriel({ modele: 'support', langue: 'fr', variables: { numero: 3, titre: 'Bug', reponse: 'Corrigé', prenom: 'Léa' } });
  assert.equal(s.objet, 'Réponse à votre demande #3 : Bug');
  assert.match(s.texte, /Bonjour Léa/);
  const r = rendreCourriel({ modele: 'recap', langue: 'en', variables: { prenom: 'Sam', elements: [{ titre: 'Match tomorrow', texte: '20:00' }] } });
  assert.match(r.objet, /digest \(1 notification/);
});
