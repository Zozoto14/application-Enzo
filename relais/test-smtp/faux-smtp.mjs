/**
 * Faux serveur SMTP local (tests seulement) : accepte EHLO, AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO,
 * DATA, et garde les messages reçus en mémoire. Aucun chiffrement (SMTP_SANS_TLS=1 côté client).
 *
 *   const smtp = await fauxSmtp({ utilisateur, motDePasse });
 *   … smtp.port, smtp.messages ([{ de, a: [], donnees, auth }]), smtp.refuser = adresse => true …
 *   await smtp.fermer();
 */

import net from 'node:net';

export async function fauxSmtp({ utilisateur = 'noreply@appdashboard.test', motDePasse = 'mdp-smtp-test', port = 0 } = {}) {
  const messages = [];
  const etat = { refuser: () => false, authentifications: 0 };
  const serveur = net.createServer(socket => {
    let tampon = '';
    let enDonnees = false;
    let donnees = [];
    let enAuthLogin = 0;
    let user = '';
    let auth = false;
    let courant = { de: '', a: [] };
    const ecrire = l => socket.write(`${l}\r\n`);
    ecrire('220 faux-smtp ESMTP');
    socket.on('data', morceau => {
      tampon += morceau.toString('utf8');
      let i;
      while ((i = tampon.indexOf('\r\n')) >= 0) {
        const ligne = tampon.slice(0, i);
        tampon = tampon.slice(i + 2);
        if (enDonnees) {
          if (ligne === '.') {
            enDonnees = false;
            messages.push({ ...courant, donnees: donnees.join('\r\n'), auth });
            donnees = [];
            courant = { de: '', a: [] };
            ecrire('250 2.0.0 Ok: queued');
          } else {
            donnees.push(ligne.startsWith('..') ? ligne.slice(1) : ligne);
          }
          continue;
        }
        if (enAuthLogin === 1) {
          user = Buffer.from(ligne, 'base64').toString();
          enAuthLogin = 2;
          ecrire('334 UGFzc3dvcmQ6');
          continue;
        }
        if (enAuthLogin === 2) {
          enAuthLogin = 0;
          etat.authentifications++;
          auth = user === utilisateur && Buffer.from(ligne, 'base64').toString() === motDePasse;
          ecrire(auth ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication failed');
          continue;
        }
        const commande = ligne.slice(0, 4).toUpperCase();
        if (commande === 'EHLO' || commande === 'HELO') {
          socket.write('250-faux-smtp\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        } else if (/^AUTH PLAIN/i.test(ligne)) {
          const [, u, p] = Buffer.from(ligne.split(' ')[2] ?? '', 'base64').toString().split('\u0000');
          etat.authentifications++;
          auth = u === utilisateur && p === motDePasse;
          ecrire(auth ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication failed');
        } else if (/^AUTH LOGIN/i.test(ligne)) {
          enAuthLogin = 1;
          ecrire('334 VXNlcm5hbWU6');
        } else if (commande === 'MAIL') {
          if (!auth) ecrire('530 5.7.0 Authentication required');
          else {
            courant.de = /<([^>]*)>/.exec(ligne)?.[1] ?? '';
            ecrire('250 2.1.0 Ok');
          }
        } else if (commande === 'RCPT') {
          const a = /<([^>]*)>/.exec(ligne)?.[1] ?? '';
          if (etat.refuser(a)) ecrire('550 5.1.1 Mailbox unavailable');
          else {
            courant.a.push(a);
            ecrire('250 2.1.5 Ok');
          }
        } else if (commande === 'DATA') {
          enDonnees = true;
          ecrire('354 End data with <CR><LF>.<CR><LF>');
        } else if (commande === 'RSET') {
          courant = { de: '', a: [] };
          ecrire('250 Ok');
        } else if (commande === 'NOOP') {
          ecrire('250 Ok');
        } else if (commande === 'QUIT') {
          ecrire('221 Bye');
          socket.end();
        } else {
          ecrire('502 5.5.2 Command not recognized');
        }
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(ok => serveur.listen(port, '127.0.0.1', ok));
  return {
    port: serveur.address().port,
    messages,
    etat,
    set refuser(f) {
      etat.refuser = f;
    },
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(serveur.address().port), SMTP_USER: utilisateur, SMTP_PASS: motDePasse, MAIL_FROM: `AppDashboard <${utilisateur}>`, SMTP_SANS_TLS: '1' },
    fermer: () => new Promise(ok => serveur.close(() => ok())),
  };
}

/** Corps décodé d'un message reçu (quoted-printable et base64 des parties texte/HTML), pour les assertions. */
export function decoderMessage(brut) {
  const parties = [];
  const morceaux = brut.split(/\r\n--[^\r\n]+/);
  for (const m of morceaux) {
    const separation = m.indexOf('\r\n\r\n');
    if (separation < 0) continue;
    const entetes = m.slice(0, separation);
    let corps = m.slice(separation + 4);
    if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(entetes)) {
      corps = Buffer.from(corps.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
    } else if (/Content-Transfer-Encoding:\s*base64/i.test(entetes)) {
      corps = Buffer.from(corps.replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    parties.push({ entetes, corps });
  }
  return { entetes: brut.slice(0, brut.indexOf('\r\n\r\n')), parties, texte: parties.map(p => p.corps).join('\n') };
}
