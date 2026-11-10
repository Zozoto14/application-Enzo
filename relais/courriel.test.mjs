/**
 * E-mails envoyés par le serveur : vrai transport (nodemailer, esport/serveur/courriel-smtp.mjs) vers
 * un FAUX serveur SMTP local (relais/test-smtp/faux-smtp.mjs). Aucun e-mail ne sort de la machine.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { relais, jetonDeProfil } from './relais.mjs';
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
  relais.traiter(new Request(`https://relais.test${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, ...(corps ? { body: JSON.stringify(corps) } : {}) }), env);

test('courriel : configuration SMTP lue dans le .env, incomplète = désactivée', () => {
  assert.equal(configSmtp({}), undefined);
  assert.deepEqual(manquesSmtp({ SMTP_HOST: 'mail.appdashboard.fr' }), ['SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']);
  const c = configSmtp({ SMTP_HOST: 'mail.appdashboard.fr', SMTP_USER: 'noreply@appdashboard.fr', SMTP_PASS: 'x', MAIL_FROM: 'AppDashboard <noreply@appdashboard.fr>' });
  assert.equal(c.port, 465);
  assert.equal(c.securise, true, '465 : SSL/TLS direct');
  assert.equal(configSmtp({ ...smtp.env, SMTP_PORT: '587', SMTP_SANS_TLS: '' }).securise, false, '587 : STARTTLS');
  assert.equal(configSmtp({ ...smtp.env, MAIL_FROM: 'pas une adresse' }), undefined);
});

test('courriel : sans transport SMTP → 503 non-configure ; réservé au jeton maître', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const r = await appel(env, '/courriel/envoyer', { corps: { destinataires: ['lea@exemple.fr'], variables: { objet: 'Salut', message: 'Coucou' } } });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).motif, 'non-configure');
  assert.deepEqual(await (await appel(env, '/courriel/etat', { methode: 'GET' })).json(), { configure: false, expediteur: null, limites: { heure: 100, jour: 300 }, test: true });
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
  assert.deepEqual(lu.resultats, [{ a: 'l***@e***.fr', statut: 'envoye', langue: 'fr' }, { a: 't***@e***.fr', statut: 'envoye', langue: 'en' }], 'doublon ignoré, adresses masquées');
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
  assert.deepEqual(await (await appel(env, '/courriel/etat', { methode: 'GET' })).json(), { configure: true, expediteur: null, limites: { heure: 100, jour: 300 }, test: true });
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

test('courriel : envoi groupé mixte — chaque destinataire reçoit l’habillage (en-tête de langue, pied, sujet) dans SA langue, le corps reste celui du Fondateur', async () => {
  const env = { JETON, BOITE: kvMemoire(), ENVOYER_COURRIEL: envoyeur, LIEN_APP: 'https://appdashboard.fr' };
  const avant = smtp.messages.length;
  const r = await appel(env, '/courriel/envoyer', {
    corps: { destinataires: [{ adresse: 'lea@exemple.fr', nom: 'Léa', langue: 'fr' }, { adresse: 'sam@exemple.com', nom: 'Sam', langue: 'en' }, { adresse: 'zoe@exemple.fr' }], langue: 'fr', variables: { objet: 'Tournoi samedi', message: 'Rendez-vous **samedi**, salle B.' } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).resultats.map(x => x.langue), ['fr', 'en', 'fr']);
  const recus = Object.fromEntries(smtp.messages.slice(avant).map(m => [m.a[0], decoderMessage(m.donnees)]));
  const html = a => recus[a].parties.find(p => /text\/html/.test(p.entetes)).corps;
  assert.match(html('lea@exemple.fr'), /<html lang="fr">/);
  assert.match(html('lea@exemple.fr'), /Vous recevez cet e-mail parce que vous avez un compte AppDashboard/);
  assert.match(html('sam@exemple.com'), /<html lang="en">/);
  assert.match(html('sam@exemple.com'), /You are receiving this e-mail because you have an AppDashboard account/);
  assert.doesNotMatch(html('sam@exemple.com'), /Vous recevez/);
  assert.match(html('zoe@exemple.fr'), /<html lang="fr">/);
  assert.match(recus['sam@exemple.com'].entetes, /Content-Language: en/);
  assert.match(recus['lea@exemple.fr'].entetes, /Content-Language: fr/);
  // Le corps est tel que le Fondateur l'a écrit, dans les deux langues.
  for (const a of Object.keys(recus)) assert.match(html(a), /Rendez-vous <strong>samedi<\/strong>, salle B\./);
  const journal = await (await appel(env, '/courriel/journal', { methode: 'GET' })).json();
  assert.deepEqual(journal.envois[0].resultats.map(x => x.langue), ['fr', 'en', 'fr']);
});

test('courriel : deux versions FR/EN du message — chacun reçoit la sienne (objet, texte, HTML)', async () => {
  const env = { JETON, BOITE: kvMemoire(), ENVOYER_COURRIEL: envoyeur };
  const avant = smtp.messages.length;
  const r = await appel(env, '/courriel/envoyer', {
    corps: {
      destinataires: [{ adresse: 'lea@exemple.fr', langue: 'fr' }, { adresse: 'sam@exemple.com', langue: 'en' }],
      variables: { objet: 'Tournoi samedi', message: 'Salle B, 14 h.', en: { objet: 'Tournament on Saturday', message: 'Room B, 2 pm.' } },
    },
  });
  assert.equal(r.status, 200);
  const recus = Object.fromEntries(smtp.messages.slice(avant).map(m => [m.a[0], decoderMessage(m.donnees)]));
  assert.match(recus['lea@exemple.fr'].entetes, /Subject: Tournoi samedi/);
  assert.match(recus['lea@exemple.fr'].texte, /Salle B, 14 h\./);
  assert.doesNotMatch(recus['lea@exemple.fr'].texte, /Room B/);
  assert.match(recus['sam@exemple.com'].entetes, /Subject: Tournament on Saturday/);
  assert.match(recus['sam@exemple.com'].texte, /Room B, 2 pm\./);
  assert.doesNotMatch(recus['sam@exemple.com'].texte, /Salle B/);
  // Sans version anglaise, l'anglophone reçoit le texte principal (habillage anglais).
  const avant2 = smtp.messages.length;
  await appel(env, '/courriel/envoyer', { corps: { destinataires: [{ adresse: 'sam@exemple.com', langue: 'en' }], variables: { objet: 'Salut', message: 'Coucou tout le monde' } } });
  assert.match(decoderMessage(smtp.messages[avant2].donnees).texte, /Coucou tout le monde/);
  // Version anglaise invalide : refusée.
  for (const en of [{ objet: '', message: 'x y' }, { objet: 'ok', message: '' }, 'texte', { objet: 'ok' }]) {
    assert.equal((await appel(env, '/courriel/envoyer', { corps: { destinataires: ['a@b.fr'], variables: { objet: 'x', message: 'yy', en } } })).status, 400, JSON.stringify(en));
  }
});

test('courriel : aperçu dans la langue choisie (objet, texte, HTML) — sans envoi, sans SMTP, sans adresse, jeton maître seulement', async () => {
  const env = { JETON, BOITE: kvMemoire(), LIEN_APP: 'https://appdashboard.fr' };
  const apercu = (corps, jeton) => appel(env, '/courriel/apercu', { corps, jeton });
  const corps = { variables: { objet: 'Tournoi', message: 'Salle B', en: { objet: 'Tournament', message: 'Room B' } } };
  const fr = await (await apercu({ ...corps, langue: 'fr' })).json();
  const en = await (await apercu({ ...corps, langue: 'en' })).json();
  assert.equal(fr.langue, 'fr');
  assert.equal(fr.objet, 'Tournoi');
  assert.match(fr.html, /Vous recevez cet e-mail/);
  assert.match(fr.html, /Salle B/);
  assert.equal(en.langue, 'en');
  assert.equal(en.objet, 'Tournament');
  assert.match(en.html, /You are receiving this e-mail/);
  assert.match(en.texte, /Room B/);
  const inv = await (await apercu({ modele: 'invitation', langue: 'en', variables: { objet: 'Invite', message: 'Hi Sam!', lien: 'https://appdashboard.fr/#invitation=abc' } })).json();
  assert.match(inv.html, /Accept the invitation/);
  assert.equal((await apercu({ variables: { objet: '', message: 'x' } })).status, 400);
  assert.equal((await apercu({ modele: 'support', variables: { objet: 'x', message: 'yy' } })).status, 400);
  const ami = await jetonDeProfil(JETON, 'abc123def');
  assert.equal((await apercu({ ...corps, langue: 'en' }, ami)).status, 403);
  assert.equal([...env.BOITE.donnees.keys()].some(c => c.startsWith('courriel:journal')), false, 'un aperçu ne laisse aucune trace');
});

test('courriel : réponse au support dans la langue du compte (celle de l’app prime sur celle de la demande)', async () => {
  const fr = rendreCourriel({ modele: 'support', langue: 'fr', variables: { numero: 12, titre: 'Bug', reponse: 'Corrigé.', prenom: 'Léa' } });
  const en = rendreCourriel({ modele: 'support', langue: 'en', variables: { numero: 12, titre: 'Bug', reponse: 'Fixed.', prenom: 'Lea' } });
  assert.equal(fr.objet, 'Réponse à votre demande #12 : Bug');
  assert.equal(en.objet, 'Reply to your request #12: Bug');
  assert.match(en.html, /Hello Lea,/);
  assert.match(en.texte, /Support › My requests/);
  assert.match(fr.texte, /Support › Mes demandes/);
});
