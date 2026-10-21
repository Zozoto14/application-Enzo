/**
 * Transport SMTP des e-mails (Node seulement : relais/serveur/app.mjs et esport/serveur/cron.mjs),
 * avec nodemailer (paquet de esport/, comme `pg`). Voir docs/emails.md.
 *
 * Configuration (fichiers ~/.appdashboard/relais.env et esport.env, HORS du dépôt) :
 *   SMTP_HOST     serveur d'envoi (o2switch : celui indiqué par cPanel, souvent mail.appdashboard.fr)
 *   SMTP_PORT     465 (SSL/TLS, par défaut) ou 587 (STARTTLS)
 *   SMTP_USER     la boîte complète : noreply@appdashboard.fr
 *   SMTP_PASS     son mot de passe
 *   MAIL_FROM     expéditeur affiché : « AppDashboard <noreply@appdashboard.fr> »
 *   MAIL_REPLY_TO facultatif : adresse de réponse (sinon personne : boîte « noreply »)
 *   SMTP_SANS_TLS=1  TESTS SEULEMENT (faux serveur local sans chiffrement)
 *
 * Jamais de journal du contenu ni des adresses (logger désactivé).
 */

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
export async function creerEnvoyeur(config, { creerTransport } = {}) {
  if (!config) return undefined;
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
  const envoyer = async ({ a, nom, objet, texte, html }) => {
    if (!MOTIF_ADRESSE.test(a) || /[\r\n]/.test(a) || /[\r\n]/.test(objet)) throw Object.assign(new Error('adresse invalide'), { code: 'EENVELOPE' });
    const info = await transport.sendMail({
      from: config.de,
      to: nom ? { name: nom.replace(/[\r\n"<>]/g, ''), address: a } : a,
      ...(config.repondreA ? { replyTo: config.repondreA } : {}),
      subject: objet,
      text: texte,
      html,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    return { id: info?.messageId };
  };
  envoyer.fermer = () => transport.close?.();
  return envoyer;
}
