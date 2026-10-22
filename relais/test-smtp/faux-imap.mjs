/**
 * Faux serveur IMAP local (tests seulement) : CAPABILITY, LOGIN, LIST, APPEND (littéral), LOGOUT.
 * Aucun chiffrement (IMAP_SANS_TLS=1 côté client).
 *
 *   const imap = await fauxImap({ dossiers: [{ nom: 'Sent', drapeaux: ['\\Sent'] }] });
 *   … imap.env, imap.ajouts ([{ dossier, drapeaux, date, donnees: Buffer }]), imap.etat.refuserAppend …
 */

import net from 'node:net';

export async function fauxImap({ utilisateur = 'noreply@appdashboard.test', motDePasse = 'mdp-smtp-test', dossiers = [{ nom: 'INBOX', drapeaux: [] }, { nom: 'Sent', drapeaux: ['\\Sent'] }], specialUse = true } = {}) {
  const ajouts = [];
  const etat = { refuserAppend: false, connexions: 0, commandes: [] };
  const serveur = net.createServer(socket => {
    etat.connexions++;
    let tampon = Buffer.alloc(0);
    let connecte = false;
    let attente; // { tag, dossier, drapeaux, date, taille }
    const ecrire = l => socket.write(`${l}\r\n`);
    ecrire('* OK faux-imap prêt');
    socket.on('data', morceau => {
      tampon = Buffer.concat([tampon, morceau]);
      for (;;) {
        if (attente) {
          if (tampon.length < attente.taille + 2) return;
          const donnees = tampon.subarray(0, attente.taille);
          tampon = tampon.subarray(attente.taille + 2);
          const a = attente;
          attente = undefined;
          ajouts.push({ dossier: a.dossier, drapeaux: a.drapeaux, date: a.date, donnees: Buffer.from(donnees) });
          ecrire(`${a.tag} OK [APPENDUID 1 1] Append completed`);
          continue;
        }
        const i = tampon.indexOf('\r\n');
        if (i < 0) return;
        const ligne = tampon.subarray(0, i).toString('utf8');
        tampon = tampon.subarray(i + 2);
        const [tag, cmd, ...reste] = ligne.split(' ');
        const verbe = (cmd ?? '').toUpperCase();
        etat.commandes.push(verbe);
        if (verbe === 'CAPABILITY') {
          ecrire(`* CAPABILITY IMAP4rev1 ${specialUse ? 'SPECIAL-USE ' : ''}LITERAL+`);
          ecrire(`${tag} OK Pretty much complete`);
        } else if (verbe === 'LOGIN') {
          const m = /^"([^"]*)" "([^"]*)"$/.exec(reste.join(' '));
          connecte = m?.[1] === utilisateur && m?.[2] === motDePasse;
          ecrire(connecte ? `${tag} OK Logged in` : `${tag} NO [AUTHENTICATIONFAILED] Authentication failed.`);
        } else if (!connecte) {
          ecrire(`${tag} BAD Login first`);
        } else if (verbe === 'LIST') {
          for (const d of dossiers) ecrire(`* LIST (${[...(specialUse || !d.drapeaux.includes('\\Sent') ? d.drapeaux : []), '\\HasNoChildren'].join(' ')}) "." "${d.nom}"`);
          ecrire(`${tag} OK List completed`);
        } else if (verbe === 'APPEND') {
          const m = /^"([^"]*)" \(([^)]*)\) "([^"]*)" \{(\d+)\}$/.exec(reste.join(' '));
          if (!m) ecrire(`${tag} BAD Syntaxe`);
          else if (etat.refuserAppend || !dossiers.some(d => d.nom === m[1])) ecrire(`${tag} NO [TRYCREATE] Mailbox doesn't exist`);
          else {
            attente = { tag, dossier: m[1], drapeaux: m[2], date: m[3], taille: Number(m[4]) };
            ecrire('+ Ready for literal data');
          }
        } else if (verbe === 'LOGOUT') {
          ecrire('* BYE Logging out');
          ecrire(`${tag} OK Logout completed`);
          socket.end();
        } else {
          ecrire(`${tag} BAD Commande inconnue`);
        }
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const port = serveur.address().port;
  return {
    port,
    ajouts,
    etat,
    env: { IMAP_HOST: '127.0.0.1', IMAP_PORT: String(port), IMAP_SANS_TLS: '1' },
    fermer: () => new Promise(ok => serveur.close(() => ok())),
  };
}
