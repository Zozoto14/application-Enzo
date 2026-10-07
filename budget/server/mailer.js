import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const PROVIDER = process.env.MAIL_PROVIDER || 'console';
const OUTBOX = process.env.MAIL_OUTBOX || resolve(process.cwd(), 'server/data/outbox.log');

// No SMTP client here on purpose: with MAIL_PROVIDER=http this posts to any
// transactional-email HTTP API (Resend, Postmark, Mailgun…) using fetch, so the
// deployment picks its provider without adding a dependency.
async function sendViaHttp({ to, subject, text }) {
  const url = process.env.MAIL_API_URL;
  const apiKey = process.env.MAIL_API_KEY;
  const from = process.env.MAIL_FROM || 'no-reply@example.com';
  if (!url || !apiKey) throw new Error('MAIL_API_URL et MAIL_API_KEY sont requis avec MAIL_PROVIDER=http');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!response.ok) throw new Error(`Envoi email refusé (${response.status})`);
}

function sendViaConsole({ to, subject, text }) {
  const entry = `\n[${new Date().toISOString()}] À: ${to}\nSujet: ${subject}\n${text}\n`;
  console.log('--- EMAIL (mode console) ---', entry);
  try {
    mkdirSync(dirname(OUTBOX), { recursive: true });
    appendFileSync(OUTBOX, entry);
  } catch (e) {
    console.error('Impossible d\'écrire dans l\'outbox', e);
  }
}

export async function sendMail(message) {
  if (PROVIDER === 'http') return sendViaHttp(message);
  return sendViaConsole(message);
}

export function verificationEmail(baseUrl, token) {
  const link = `${baseUrl}/verifier-email.html?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirmez votre adresse email — Mon Budget',
    text: `Bienvenue sur Mon Budget.\n\nConfirmez votre adresse en ouvrant ce lien :\n${link}\n\nCe lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`,
    link,
  };
}
