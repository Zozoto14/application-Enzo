/**
 * Transport SMTP des e-mails (Node seulement : relais/serveur/app.mjs et esport/serveur/cron.mjs),
 * avec nodemailer (paquet de esport/, comme `pg`). Voir docs/emails.md.
 *
 * Configuration (fichiers ~/.appdashboard/relais.env et esport.env, HORS du dépôt) :
 *   SMTP_HOST     serveur d'envoi. o2switch : le NOM DU SERVEUR affiché par cPanel (poisson.o2switch.net) ;
 *                 le certificat de mail.appdashboard.fr ne correspond pas (docs/emails.md)
 *   SMTP_PORT     465 (SSL/TLS, par défaut) ou 587 (STARTTLS)
 *   SMTP_USER     la boîte complète : noreply@appdashboard.fr
 *   SMTP_PASS     son mot de passe
 *   MAIL_FROM     expéditeur affiché : « AppDashboard <noreply@appdashboard.fr> »
 *   MAIL_REPLY_TO facultatif : adresse de réponse (sinon personne : boîte « noreply »)
 *   SMTP_SANS_TLS=1  TESTS SEULEMENT (faux serveur local sans chiffrement)
 *
 * Copie dans « Envoyés » (webmail), IMAP APPEND après chaque envoi réussi (esport/serveur/imap-envoyes.mjs) :
 *   MAIL_COPIE_ENVOYES  1 par défaut quand SMTP est configuré ; 0 pour désactiver
 *   IMAP_HOST     par défaut = SMTP_HOST (même identifiant et même mot de passe)
 *   IMAP_PORT     993 (SSL/TLS) par défaut
 *   IMAP_DOSSIER  facultatif : nom exact du dossier si la détection (\Sent, Sent, INBOX.Sent) échoue
 *   IMAP_SANS_TLS=1  TESTS SEULEMENT
 *
 * Jamais de journal du contenu ni des adresses (logger désactivé).
 */

import { codeErreurSmtp, detailTechnique, expliquerErreurSmtp } from '../../relais/courriel-erreurs.mjs';

const MOTIF_ADRESSE = /^[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}$/;

/** Configuration SMTP lue dans l'environnement ; `undefined` si elle est incomplète. */
export function configSmtp(env = process.env) {
  const hote = (env.SMTP_HOST || '').trim();
  const utilisateur = (env.SMTP_USER || '').trim();
  const motDePasse = env.SMTP_PASS || '';
  const de = (env.MAIL_FROM || '').trim();
  if (!hote || !utilisateur || !motDePasse || !de) return undefined;
  const port = Number(env.SMTP_PORT) || 465;
  const adresseDe = /<([^>]+)>/.exec(de)?.[1] ?? de;
  if (!MOTIF_ADRESSE.test(adresseDe)) return undefined;
  return {
    hote,
    port,
    securise: env.SMTP_SECURE ? env.SMTP_SECURE === '1' || env.SMTP_SECURE === 'true' : port === 465,
    utilisateur,
    motDePasse,
    de,
    adresseDe,
    repondreA: (env.MAIL_REPLY_TO || '').trim() || undefined,
    sansTls: env.SMTP_SANS_TLS === '1',
    copieEnvoyes: !['0', 'false', 'non'].includes((env.MAIL_COPIE_ENVOYES || '').trim().toLowerCase()),
    imap: {
      hote: (env.IMAP_HOST || '').trim() || hote,
      port: Number(env.IMAP_PORT) || 993,
      utilisateur,
      motDePasse,
      dossier: (env.IMAP_DOSSIER || '').trim() || undefined,
      sansTls: env.IMAP_SANS_TLS === '1',
    },
  };
}

/** Champs manquants (pour /sante et le journal de démarrage), sans jamais citer une valeur. */
export function manquesSmtp(env = process.env) {
  return ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].filter(k => !(env[k] || '').trim());
}

/**
 * Fonction d'envoi `({ a, nom?, objet, texte, html }) → Promise<{ id }>`, ou `undefined` sans
 * configuration. `creerTransport` : injectable (tests).
 */
export async function creerEnvoyeur(config, { creerTransport, copieur: copieurInjecte, composer: composerInjecte } = {}) {
  if (!config) return undefined;
  // Copie dans « Envoyés » : activée par défaut quand SMTP est configuré (MAIL_COPIE_ENVOYES=0 pour l'éteindre).
  const copieur = copieurInjecte ?? (config.copieEnvoyes && config.imap ? (await import('./imap-envoyes.mjs')).creerCopieur(config.imap) : undefined);
  let Composer = composerInjecte;
  if (copieur && !Composer) Composer = (await import('nodemailer/lib/mail-composer')).default;
  let fabrique = creerTransport;
  if (!fabrique) {
    const nodemailer = (await import('nodemailer')).default;
    fabrique = options => nodemailer.createTransport(options);
  }
  const transport = fabrique({
    host: config.hote,
    port: config.port,
    secure: config.securise,
    auth: { user: config.utilisateur, pass: config.motDePasse },
    logger: false,
    debug: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    ...(config.sansTls ? { ignoreTLS: true, secure: false } : { tls: { minVersion: 'TLSv1.2' }, requireTLS: !config.securise }),
  });
  const envoyer = async ({ a, nom, objet, texte, html, langue }) => {
    if (!MOTIF_ADRESSE.test(a) || /[\r\n]/.test(a) || /[\r\n]/.test(objet)) throw Object.assign(new Error('adresse invalide'), { code: 'EENVELOPE' });
    const mail = {
      from: config.de,
      to: nom ? { name: nom.replace(/[\r\n"<>]/g, ''), address: a } : a,
      ...(config.repondreA ? { replyTo: config.repondreA } : {}),
      subject: objet,
      text: texte,
      html,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All', ...(langue === 'en' || langue === 'fr' ? { 'Content-Language': langue } : {}) },
    };
    if (!copieur) {
      const info = await transport.sendMail(mail);
      return { id: info?.messageId };
    }
    // Avec copie : le MIME est compilé UNE fois (MailComposer) et c'est exactement cet octet-à-octet qui
    // part par SMTP (`raw`) puis qui est déposé dans « Envoyés ».
    const date = new Date();
    const noeud = new Composer({ ...mail, date }).compile();
    const brut = await noeud.build();
    const info = await transport.sendMail({ envelope: { from: config.adresseDe, to: [a] }, raw: brut });
    const id = noeud.messageId();
    // Envoi réussi : la copie ne le fait jamais échouer (le copieur ne lève pas ; garde-fou en plus).
    try {
      await copieur({ message: brut, date });
    } catch {
      /* journalisé par le copieur */
    }
    return { id };
  };
  /** Connexion + identifiants (commande SMTP « AUTH »), sans rien envoyer : diagnostic (démarrage, « Tester l'envoi »). */
  envoyer.verifier = () => transport.verify();
  envoyer.fermer = async () => {
    try {
      await copieur?.fermer?.();
    } finally {
      transport.close?.();
    }
  };
  return envoyer;
}

/** Résumé lisible de la configuration (journal de démarrage) : serveur, port, chiffrement ; jamais le mot de passe. */
export function resumeSmtp(config) {
  if (!config) return null;
  return `${config.hote}:${config.port}, ${config.sansTls ? 'sans chiffrement (tests)' : config.securise ? 'SSL/TLS' : 'STARTTLS'}, expéditeur ${config.adresseDe}`;
}

/**
 * Vérification SMTP au démarrage, SANS bloquer le démarrage : `lancer()` essaie la connexion et les identifiants
 * et écrit le résultat au journal (code EAUTH, ECONNREFUSED, ETIMEDOUT, ENOTFOUND… et explication en français).
 * `etat()` : { statut: non-configure | en-cours | ok | echec, code?, technique?, explication?, le? } (aucun secret),
 * repris par /courriel/etat.
 */
export function suivreVerificationSmtp(envoyeur, { app = 'serveur', journal = console, maintenant = Date.now } = {}) {
  let etat = envoyeur?.verifier ? { statut: 'en-cours' } : { statut: 'non-configure' };
  return {
    etat: () => ({ ...etat }),
    async lancer() {
      if (!envoyeur?.verifier) return etat;
      const debut = maintenant();
      try {
        await envoyeur.verifier();
        etat = { statut: 'ok', le: new Date(maintenant()).toISOString() };
        journal.log(`[${app}] e-mails : connexion SMTP vérifiée, identifiants acceptés (${maintenant() - debut} ms).`);
      } catch (e) {
        const code = codeErreurSmtp(e);
        etat = { statut: 'echec', code, technique: detailTechnique(e), explication: expliquerErreurSmtp(code), le: new Date(maintenant()).toISOString() };
        journal.error(`[${app}] e-mails : vérification SMTP en ÉCHEC : ${code} (${etat.technique}). ${etat.explication}`);
      }
      return etat;
    },
  };
}
