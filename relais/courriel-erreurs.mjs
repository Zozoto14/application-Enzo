/**
 * Erreurs d'envoi d'e-mails (SMTP, nodemailer) → code court et explication en français simple.
 * Partagé par le relais (/courriel/envoyer, /courriel/tester), le journal de démarrage des serveurs
 * (vérification SMTP) et le récapitulatif de l'Esport. Voir docs/emails.md, « Dépannage ».
 *
 * Jamais le message brut du serveur SMTP dans une réponse ni un journal : il peut citer une adresse.
 * Seuls sortent le code court, le code technique de nodemailer (EAUTH, ESOCKET…) et le code SMTP (535…).
 */

/** Explications (Fondateur, Administration › Messagerie et ~/logs/relais.log). */
export const EXPLICATIONS_SMTP = {
  'non-configure': 'L’envoi d’e-mails n’est pas configuré sur le serveur : il manque des lignes dans ~/.appdashboard/relais.env (docs/emails.md).',
  'smtp-authentification': 'Identifiant ou mot de passe SMTP refusé (EAUTH) : vérifiez SMTP_USER (l’adresse complète, ex. noreply@appdashboard.fr) et SMTP_PASS (mot de passe de la boîte dans cPanel › Comptes de messagerie).',
  'smtp-certificat': 'Le certificat du serveur SMTP ne correspond pas à son nom : mettez SMTP_HOST=<nom du serveur affiché par cPanel> (ex. poisson.o2switch.net), pas mail.appdashboard.fr.',
  'smtp-refuse': 'Connexion refusée par le serveur SMTP (ECONNREFUSED) : SMTP_HOST ou SMTP_PORT incorrect (465 = SSL/TLS, 587 = STARTTLS).',
  'smtp-delai': 'Le serveur SMTP ne répond pas (ETIMEDOUT) : mauvais port ou chiffrement (465 = SSL/TLS, 587 = STARTTLS), ou port bloqué.',
  'smtp-hote-inconnu': 'Serveur SMTP introuvable (ENOTFOUND) : SMTP_HOST est mal écrit.',
  'smtp-injoignable': 'Serveur SMTP injoignable (connexion coupée) : vérifiez SMTP_HOST et SMTP_PORT, puis réessayez.',
  'expediteur-refuse': 'Expéditeur refusé par le serveur SMTP : MAIL_FROM doit être l’adresse de la boîte SMTP_USER (ex. AppDashboard <noreply@appdashboard.fr>).',
  'destinataire-refuse': 'Destinataire refusé par le serveur de messagerie (adresse inexistante ou refusée).',
  'smtp-limite': 'Limite d’envoi de l’hébergeur atteinte (trop d’e-mails par heure) : réessayez plus tard.',
  'smtp-temporaire': 'Refus temporaire du serveur SMTP : réessayez dans quelques minutes.',
  'smtp-erreur': 'Erreur du serveur SMTP.',
  'adresse-invalide': 'Adresse e-mail invalide.',
};

export const expliquerErreurSmtp = code => EXPLICATIONS_SMTP[code] ?? EXPLICATIONS_SMTP['smtp-erreur'];

const MOTIF_LIMITE = /exceeded the max|rate.?limit|too many (?:messages|mails|emails|recipients|connections)|quota|limit(?:e)? (?:d'envoi|exceeded|reached)/i;

/** Code d'erreur court, sans adresse ni détail du serveur. */
export function codeErreurSmtp(e) {
  const code = String(e?.code ?? '');
  const reponse = Number(e?.responseCode);
  const commande = String(e?.command ?? '').toUpperCase();
  const message = String(e?.message ?? '');
  const tout = `${code} ${e?.cause?.code ?? ''} ${message}`;
  if (code === 'EAUTH' || reponse === 535 || reponse === 534) return 'smtp-authentification';
  if (/ERR_TLS_CERT_ALTNAME_INVALID|does not match certificate'?s altnames|self[- ]signed certificate|unable to verify the first certificate/i.test(tout)) return 'smtp-certificat';
  if (MOTIF_LIMITE.test(message) || (reponse === 421 && /limit|too many/i.test(message))) return 'smtp-limite';
  if (commande.startsWith('MAIL') && (code === 'EENVELOPE' || reponse >= 500)) return 'expediteur-refuse';
  if (code === 'EENVELOPE' || commande.startsWith('RCPT') || (reponse >= 550 && reponse < 560)) return 'destinataire-refuse';
  if (/ECONNREFUSED/.test(tout)) return 'smtp-refuse';
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(tout)) return 'smtp-hote-inconnu';
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timed? ?out|Greeting never received/i.test(tout)) return 'smtp-delai';
  if (code === 'ECONNECTION' || code === 'ESOCKET' || /ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(tout)) return 'smtp-injoignable';
  if (reponse >= 400 && reponse < 500) return 'smtp-temporaire';
  return 'smtp-erreur';
}

/** Détail technique sûr (aucune adresse) : « EAUTH 535 », « ESOCKET », pour le journal du serveur. */
export function detailTechnique(e) {
  const code = /^[A-Z_]{3,40}$/.test(String(e?.code ?? '')) ? e.code : '';
  const reseau = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/.exec(String(e?.message ?? ''))?.[1];
  const reponse = Number.isFinite(Number(e?.responseCode)) && e?.responseCode ? String(e.responseCode) : '';
  return [code, reseau && reseau !== code ? reseau : '', reponse].filter(Boolean).join(' ') || 'inconnu';
}
