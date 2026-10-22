/**
 * Copie des e-mails envoyés dans le dossier « Envoyés » de la boîte (IMAP APPEND), pour qu'ils
 * apparaissent dans le webmail (Roundcube chez o2switch). Voir docs/emails.md.
 *
 * Petit client IMAP maison, APPEND seulement, en TLS (node:tls) : imapflow tire 8 dépendances et
 * ~2 Mo pour une seule commande utile ici. Commandes utilisées : CAPABILITY, LOGIN, LIST (SPECIAL-USE),
 * APPEND, LOGOUT.
 *
 * Règles :
 *  - un échec ne fait JAMAIS échouer l'envoi : `copier` ne lève jamais, il renvoie un code court ;
 *  - jamais d'adresse, de mot de passe ni de contenu dans les journaux (code d'erreur seulement) ;
 *  - connexion ouverte à la demande, réutilisée, fermée après quelques secondes d'inactivité ;
 *  - après un échec, pause de 60 s (pas de file d'attente de délais quand l'IMAP est en panne).
 */

import net from 'node:net';
import tls from 'node:tls';

const DELAI_CONNEXION_MS = 8_000;
const DELAI_COMMANDE_MS = 10_000;
const INACTIVITE_MS = 15_000;
const PAUSE_APRES_ECHEC_MS = 60_000;
const CANDIDATS = ['sent', 'inbox.sent', 'inbox/sent'];
const MOIS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const guillemets = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

/** Date IMAP (INTERNALDATE) en UTC : 22-Oct-2026 20:40:06 +0000. */
export function dateImap(date) {
  const d = new Date(date);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${MOIS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Code d'erreur court (sans détail du serveur ni adresse) pour le journal. */
export function codeErreurImap(e) {
  if (typeof e?.imap === 'string') return e.imap;
  const texte = `${e?.code ?? ''} ${e?.message ?? ''}`;
  if (/ALTNAME|certificate|CERT_|self.signed/i.test(texte)) return 'imap-certificat';
  if (/ETIMEDOUT|timeout|delai/i.test(texte)) return 'imap-delai';
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|EPIPE|socket|closed/i.test(texte)) return 'imap-connexion';
  return 'imap-erreur';
}

const echec = (imap, message) => Object.assign(new Error(message ?? imap), { imap });

/** Une session IMAP : lignes tagguées, littéraux pour APPEND. */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.tampon = Buffer.alloc(0);
    this.etape = null; // { tag, lignes, resoudre, rejeter, continuation }
    this.salut = null;
    this.fini = false;
    this.n = 0;
    socket.on('data', morceau => {
      this.tampon = Buffer.concat([this.tampon, morceau]);
      this.lire();
    });
    const fin = e => {
      this.fini = true;
      const cible = this.etape;
      this.etape = null;
      cible?.rejeter(echec(codeErreurImap(e ?? { message: 'closed' })));
      this.salut?.rejeter(echec(codeErreurImap(e ?? { message: 'closed' })));
    };
    socket.on('error', fin);
    socket.on('close', () => fin());
  }

  lire() {
    for (;;) {
      const i = this.tampon.indexOf('\r\n');
      if (i < 0) return;
      const ligne = this.tampon.subarray(0, i).toString('utf8');
      this.tampon = this.tampon.subarray(i + 2);
      if (this.salut) {
        const s = this.salut;
        this.salut = null;
        if (/^\* (OK|PREAUTH)/i.test(ligne)) s.resoudre(ligne);
        else s.rejeter(echec('imap-connexion'));
        continue;
      }
      const e = this.etape;
      if (!e) continue;
      if (ligne.startsWith('+') && e.continuation) {
        e.continuation();
        e.continuation = null;
        continue;
      }
      if (ligne.startsWith(`${e.tag} `)) {
        this.etape = null;
        const etat = /^\S+ (OK|NO|BAD)/i.exec(ligne)?.[1]?.toUpperCase();
        if (etat === 'OK') e.resoudre({ lignes: e.lignes, reponse: ligne });
        else e.rejeter(echec(/AUTHENTICATIONFAILED|authentication/i.test(ligne) ? 'imap-authentification' : /TRYCREATE|NONEXISTENT|doesn'?t exist/i.test(ligne) ? 'imap-dossier' : 'imap-refus'));
      } else {
        e.lignes.push(ligne);
      }
    }
  }

  attendreSalut() {
    return new Promise((resoudre, rejeter) => {
      this.salut = { resoudre, rejeter };
    });
  }

  /** Envoie une commande ; `litteral` (Buffer) : attend « + » puis envoie les octets. */
  commande(texte, litteral) {
    if (this.fini) return Promise.reject(echec('imap-connexion'));
    const tag = `A${++this.n}`;
    return new Promise((resoudre, rejeter) => {
      const minuteur = setTimeout(() => {
        this.etape = null;
        rejeter(echec('imap-delai'));
        this.socket.destroy();
      }, DELAI_COMMANDE_MS);
      const sortie = f => v => {
        clearTimeout(minuteur);
        f(v);
      };
      this.etape = {
        tag,
        lignes: [],
        resoudre: sortie(resoudre),
        rejeter: sortie(rejeter),
        continuation: litteral ? () => this.socket.write(Buffer.concat([litteral, Buffer.from('\r\n')])) : null,
      };
      this.socket.write(litteral ? `${tag} ${texte} {${litteral.length}}\r\n` : `${tag} ${texte}\r\n`);
    });
  }

  fermer() {
    this.fini = true;
    try {
      this.socket.destroy();
    } catch {
      /* déjà fermé */
    }
  }
}

function ouvrir({ hote, port, sansTls }) {
  return new Promise((resoudre, rejeter) => {
    const options = sansTls ? { host: hote, port } : { host: hote, port, servername: net.isIP(hote) ? undefined : hote, minVersion: 'TLSv1.2' };
    const socket = sansTls ? net.connect(options) : tls.connect(options);
    const minuteur = setTimeout(() => {
      socket.destroy();
      rejeter(echec('imap-delai'));
    }, DELAI_CONNEXION_MS);
    const session = new Session(socket);
    const salut = session.attendreSalut();
    salut.catch(() => {});
    salut.then(
      () => {
        clearTimeout(minuteur);
        resoudre(session);
      },
      e => {
        clearTimeout(minuteur);
        session.fermer();
        rejeter(e);
      },
    );
  });
}

/** Dossier des envoyés dans la liste `* LIST (\Sent …) "." "Nom"` : attribut \Sent, sinon Sent / INBOX.Sent. */
export function choisirDossier(lignesList) {
  const noms = [];
  for (const l of lignesList) {
    const m = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))/i.exec(l);
    if (!m) continue;
    const nom = (m[2] ?? m[3]).replace(/\\(["\\])/g, '$1');
    noms.push({ nom, drapeaux: m[1].toLowerCase().split(/\s+/) });
  }
  const special = noms.find(n => n.drapeaux.includes('\\sent') && !n.drapeaux.includes('\\noselect'));
  if (special) return special.nom;
  for (const c of CANDIDATS) {
    const trouve = noms.find(n => n.nom.toLowerCase() === c && !n.drapeaux.includes('\\noselect'));
    if (trouve) return trouve.nom;
  }
  return undefined;
}

/**
 * Copieur : `copier({ message: Buffer, date })` → `{ ok: true, dossier }` ou `{ ok: false, code }`, sans jamais lever.
 * `config` : { hote, port, utilisateur, motDePasse, dossier?, sansTls? }. `journal(code)` : sans donnée personnelle.
 */
export function creerCopieur(config, { journal = code => console.error(`[courriel] copie dans « Envoyés » impossible (${code}) ; l'envoi n'est pas affecté.`), maintenant = Date.now } = {}) {
  let session;
  let minuteurInactif;
  let dossier = config.dossier || undefined;
  let pauseJusqua = 0;
  let file = Promise.resolve();

  const fermerSession = () => {
    clearTimeout(minuteurInactif);
    session?.fermer();
    session = undefined;
  };

  async function obtenir() {
    clearTimeout(minuteurInactif);
    if (session && !session.fini) return session;
    session = undefined;
    const s = await ouvrir(config);
    try {
      const caps = (await s.commande('CAPABILITY')).lignes.join(' ');
      if (/LOGINDISABLED/i.test(caps)) throw echec('imap-authentification');
      if (/[\r\n]/.test(config.utilisateur + config.motDePasse)) throw echec('imap-authentification');
      await s.commande(`LOGIN ${guillemets(config.utilisateur)} ${guillemets(config.motDePasse)}`);
      s.specialUse = /SPECIAL-USE/i.test(caps);
    } catch (e) {
      s.fermer();
      throw e;
    }
    session = s;
    return s;
  }

  async function trouverDossier(s) {
    if (dossier) return dossier;
    let lignes;
    try {
      lignes = (await s.commande(s.specialUse ? 'LIST "" "*" RETURN (SPECIAL-USE)' : 'LIST "" "*"')).lignes;
    } catch {
      lignes = (await s.commande('LIST "" "*"')).lignes;
    }
    const trouve = choisirDossier(lignes);
    if (!trouve) throw echec('imap-dossier');
    dossier = trouve;
    return dossier;
  }

  async function tenter({ message, date }) {
    const s = await obtenir();
    const boite = await trouverDossier(s);
    await s.commande(`APPEND ${guillemets(boite)} (\\Seen) "${dateImap(date)}"`, message);
    minuteurInactif = setTimeout(fermerSession, INACTIVITE_MS);
    minuteurInactif.unref?.();
    return boite;
  }

  async function copier({ message, date = new Date() }) {
    if (maintenant() < pauseJusqua) return { ok: false, code: 'imap-pause' };
    let derniere;
    for (let essai = 0; essai < 2; essai++) {
      try {
        return { ok: true, dossier: await tenter({ message, date }) };
      } catch (e) {
        derniere = e;
        fermerSession();
        // Connexion réutilisée tombée entre deux envois : une seule nouvelle tentative, à neuf.
        if (codeErreurImap(e) !== 'imap-connexion') break;
      }
    }
    const code = codeErreurImap(derniere);
    if (code === 'imap-dossier') dossier = config.dossier || undefined;
    pauseJusqua = maintenant() + PAUSE_APRES_ECHEC_MS;
    try {
      journal(code);
    } catch {
      /* le journal ne bloque rien */
    }
    return { ok: false, code };
  }

  const enFile = arg => {
    const suite = file.then(() => copier(arg));
    file = suite.catch(() => {});
    return suite;
  };
  enFile.fermer = async () => {
    await file.catch(() => {});
    if (session && !session.fini) {
      try {
        await session.commande('LOGOUT');
      } catch {
        /* ignoré */
      }
    }
    fermerSession();
  };
  return enFile;
}
