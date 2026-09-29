import { randomBytes, createHash, createHmac, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { db } from './db.js';
import { HttpError, sendJson, parseCookies, buildCookie, clientIp } from './http.js';
import { checkLimit, registerFailure, clearLimit } from './ratelimit.js';
import { sendMail, verificationEmail } from './mailer.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
const SESSION_COOKIE = 'sid';
const CSRF_COOKIE = 'csrf';
const MIN_KDF_ITERATIONS = 200000;

const SECURE_COOKIES = process.env.SECURE_COOKIES !== 'false' && process.env.NODE_ENV === 'production';

function getServerSecret() {
  if (process.env.SERVER_SECRET) return process.env.SERVER_SECRET;
  const secretPath = resolve(process.cwd(), 'server/data/server-secret');
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim();
  const generated = randomBytes(32).toString('base64');
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

const SERVER_SECRET = getServerSecret();

function sha256(value) {
  return createHash('sha256').update(value).digest('base64');
}

function hashAuthKey(authKey) {
  const salt = randomBytes(16);
  const derived = scryptSync(authKey, salt, SCRYPT_KEYLEN);
  return `${salt.toString('base64')}:${derived.toString('base64')}`;
}

function verifyAuthKey(authKey, stored) {
  const [saltB64, expectedB64] = String(stored).split(':');
  if (!saltB64 || !expectedB64) return false;
  const derived = scryptSync(authKey, Buffer.from(saltB64, 'base64'), SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedB64, 'base64');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function isBase64(value, minBytes, maxBytes) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const len = Buffer.from(value, 'base64').length;
    return len >= minBytes && len <= maxBytes;
  } catch (e) {
    return false;
  }
}

// Deterministic decoy salts so an unknown email is indistinguishable from a real
// one at prelogin — otherwise the endpoint becomes an account-enumeration oracle.
function decoySalts(email) {
  const authSalt = createHmac('sha256', SERVER_SECRET).update(`auth:${email}`).digest().subarray(0, 16).toString('base64');
  const vaultSalt = createHmac('sha256', SERVER_SECRET).update(`vault:${email}`).digest().subarray(0, 16).toString('base64');
  return { authSalt, vaultSalt };
}

function issueSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, csrfToken, now, now + SESSION_TTL_MS);

  res.setHeader('Set-Cookie', [
    buildCookie(SESSION_COOKIE, token, { httpOnly: true, secure: SECURE_COOKIES, maxAge: Math.floor(SESSION_TTL_MS / 1000) }),
    buildCookie(CSRF_COOKIE, csrfToken, { httpOnly: false, secure: SECURE_COOKIES, maxAge: Math.floor(SESSION_TTL_MS / 1000) }),
  ]);
  return csrfToken;
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    buildCookie(SESSION_COOKIE, '', { httpOnly: true, secure: SECURE_COOKIES, maxAge: 0 }),
    buildCookie(CSRF_COOKIE, '', { httpOnly: false, secure: SECURE_COOKIES, maxAge: 0 }),
  ]);
}

// Every protected endpoint resolves the user from the session cookie only — never
// from anything the client can assert about itself.
export function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return null;
  return { session, user };
}

export function requireSession(req) {
  const found = getSession(req);
  if (!found) throw new HttpError(401, 'unauthenticated', 'Session expirée, reconnectez-vous.');
  return found;
}

export function requireVerifiedSession(req) {
  const found = requireSession(req);
  if (!found.user.email_verified) {
    throw new HttpError(403, 'email_unverified', "Confirmez votre adresse email avant d'utiliser la synchronisation.");
  }
  return found;
}

// Double-submit CSRF: the cookie is readable by our own page, a cross-site page
// can send the cookie but cannot read it to mirror it into this header.
export function requireCsrf(req, session) {
  const header = req.headers['x-csrf-token'];
  if (!header || typeof header !== 'string') throw new HttpError(403, 'csrf_missing', 'Jeton CSRF manquant.');
  const expected = Buffer.from(session.csrf_token);
  const provided = Buffer.from(header);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new HttpError(403, 'csrf_invalid', 'Jeton CSRF invalide.');
  }
}

function enforceLimit(action, identity) {
  const status = checkLimit(action, identity);
  if (!status.allowed) {
    throw new HttpError(429, 'rate_limited', `Trop de tentatives. Réessayez dans ${Math.ceil(status.retryAfterMs / 1000)} secondes.`, {
      retryAfterSeconds: Math.ceil(status.retryAfterMs / 1000),
    });
  }
}

async function createVerificationToken(user, baseUrl) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, used) VALUES (?, ?, ?, ?, 0)')
    .run(sha256(token), user.id, 'verify_email', Date.now() + EMAIL_TOKEN_TTL_MS);
  const mail = verificationEmail(baseUrl, token);
  await sendMail({ to: user.email, subject: mail.subject, text: mail.text });
}

export async function handlePrelogin(req, res, body) {
  const email = normalizeEmail(body.email);
  enforceLimit('login', clientIp(req));
  if (!isValidEmail(email)) throw new HttpError(400, 'invalid_email', 'Adresse email invalide.');
  const user = db.prepare('SELECT auth_salt, vault_salt, kdf_iterations FROM users WHERE email = ?').get(email);
  if (user) {
    sendJson(res, 200, { authSalt: user.auth_salt, vaultSalt: user.vault_salt, iterations: user.kdf_iterations });
    return;
  }
  const decoy = decoySalts(email);
  sendJson(res, 200, { authSalt: decoy.authSalt, vaultSalt: decoy.vaultSalt, iterations: MIN_KDF_ITERATIONS });
}

export async function handleSignup(req, res, body, baseUrl) {
  const ip = clientIp(req);
  enforceLimit('signup', ip);

  const email = normalizeEmail(body.email);
  const { authKey, authSalt, vaultSalt, iterations } = body;

  if (!isValidEmail(email)) throw new HttpError(400, 'invalid_email', 'Adresse email invalide.');
  if (!isBase64(authKey, 32, 64)) throw new HttpError(400, 'invalid_auth_key', 'Clé d\'authentification invalide.');
  if (!isBase64(authSalt, 16, 32) || !isBase64(vaultSalt, 16, 32)) throw new HttpError(400, 'invalid_salt', 'Sel de dérivation invalide.');
  if (!Number.isInteger(iterations) || iterations < MIN_KDF_ITERATIONS || iterations > 5000000) {
    throw new HttpError(400, 'weak_kdf', `Le nombre d'itérations doit être d'au moins ${MIN_KDF_ITERATIONS}.`);
  }
  if (authSalt === vaultSalt) throw new HttpError(400, 'invalid_salt', 'Les sels doivent être distincts.');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    // Same shape and cost as a success so signup cannot be used to enumerate accounts.
    registerFailure('signup', ip);
    sendJson(res, 202, { status: 'verification_sent' });
    return;
  }

  const user = {
    id: randomUUID(),
    email,
    auth_salt: authSalt,
    vault_salt: vaultSalt,
    kdf_iterations: iterations,
    auth_hash: hashAuthKey(authKey),
    created_at: Date.now(),
  };
  db.prepare(`
    INSERT INTO users (id, email, auth_salt, vault_salt, kdf_iterations, auth_hash, email_verified, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(user.id, user.email, user.auth_salt, user.vault_salt, user.kdf_iterations, user.auth_hash, user.created_at);

  await createVerificationToken(user, baseUrl);
  sendJson(res, 202, { status: 'verification_sent' });
}

export async function handleLogin(req, res, body) {
  const ip = clientIp(req);
  const email = normalizeEmail(body.email);
  enforceLimit('login', ip);
  if (isValidEmail(email)) enforceLimit('login', `email:${email}`);

  const { authKey } = body;
  if (!isValidEmail(email) || !isBase64(authKey, 32, 64)) {
    registerFailure('login', ip);
    throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    // Burn comparable CPU time on unknown accounts so response latency does not leak existence.
    scryptSync(authKey, randomBytes(16), SCRYPT_KEYLEN);
    registerFailure('login', ip);
    registerFailure('login', `email:${email}`);
    throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');
  }

  if (!verifyAuthKey(authKey, user.auth_hash)) {
    registerFailure('login', ip);
    const status = registerFailure('login', `email:${email}`);
    if (!status.allowed) {
      throw new HttpError(429, 'rate_limited', `Trop de tentatives. Réessayez dans ${Math.ceil(status.retryAfterMs / 1000)} secondes.`);
    }
    throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');
  }

  clearLimit('login', `email:${email}`);
  clearLimit('login', ip);
  const csrfToken = issueSession(res, user.id);
  sendJson(res, 200, {
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    vaultSalt: user.vault_salt,
    iterations: user.kdf_iterations,
    csrfToken,
  });
}

export async function handleLogout(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  clearSessionCookies(res);
  sendJson(res, 200, { status: 'logged_out' });
}

export async function handleSessionInfo(req, res) {
  const found = getSession(req);
  if (!found) {
    sendJson(res, 200, { authenticated: false });
    return;
  }
  sendJson(res, 200, {
    authenticated: true,
    email: found.user.email,
    emailVerified: Boolean(found.user.email_verified),
    vaultSalt: found.user.vault_salt,
    iterations: found.user.kdf_iterations,
    csrfToken: found.session.csrf_token,
  });
}

export async function handleVerifyEmail(req, res, body) {
  const ip = clientIp(req);
  enforceLimit('verify', ip);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) {
    registerFailure('verify', ip);
    throw new HttpError(400, 'invalid_token', 'Lien de confirmation invalide.');
  }
  const row = db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?').get(sha256(token), 'verify_email');
  if (!row || row.used || row.expires_at < Date.now()) {
    registerFailure('verify', ip);
    throw new HttpError(400, 'invalid_token', 'Lien de confirmation invalide ou expiré.');
  }
  db.prepare('UPDATE email_tokens SET used = 1 WHERE token_hash = ?').run(row.token_hash);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
  sendJson(res, 200, { status: 'verified' });
}

export async function handleResendVerification(req, res, body, baseUrl) {
  const ip = clientIp(req);
  enforceLimit('signup', ip);
  registerFailure('signup', ip);
  const email = normalizeEmail(body.email);
  const user = isValidEmail(email) ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (user && !user.email_verified) await createVerificationToken(user, baseUrl);
  sendJson(res, 202, { status: 'verification_sent' });
}

// Proxies the Have I Been Pwned range API so the page can run a breach check
// without relaxing connect-src to a third-party origin. Only the 5-character
// hash prefix transits, and it is never logged.
export async function handleBreachCheck(req, res, url) {
  const ip = clientIp(req);
  enforceLimit('verify', ip);
  const prefix = String(url.searchParams.get('prefix') || '').toUpperCase();
  if (!/^[0-9A-F]{5}$/.test(prefix)) {
    registerFailure('verify', ip);
    throw new HttpError(400, 'invalid_prefix', 'Préfixe de hachage invalide.');
  }
  // Counts against the same bucket so this cannot be used as a traffic amplifier.
  registerFailure('verify', ip);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'mon-budget-self-hosted' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HIBP ${response.status}`);
    const text = await response.text();
    sendJson(res, 200, { suffixes: text.split('\n').map((line) => line.trim()).filter(Boolean) });
  } catch (e) {
    // The local strength rules still applied; this check is a bonus, not a gate.
    sendJson(res, 200, { unavailable: true });
  }
}

export async function handleChangePassword(req, res, body) {
  const { session, user } = requireSession(req);
  requireCsrf(req, session);
  const ip = clientIp(req);
  enforceLimit('login', ip);

  const { currentAuthKey, newAuthKey, newAuthSalt, newVaultSalt, iterations, vault } = body;
  if (!isBase64(currentAuthKey, 32, 64) || !isBase64(newAuthKey, 32, 64)) {
    throw new HttpError(400, 'invalid_auth_key', 'Clé d\'authentification invalide.');
  }
  if (!isBase64(newAuthSalt, 16, 32) || !isBase64(newVaultSalt, 16, 32) || newAuthSalt === newVaultSalt) {
    throw new HttpError(400, 'invalid_salt', 'Sel de dérivation invalide.');
  }
  if (!Number.isInteger(iterations) || iterations < MIN_KDF_ITERATIONS) {
    throw new HttpError(400, 'weak_kdf', 'Paramètres de dérivation insuffisants.');
  }
  if (!vault || typeof vault.ciphertext !== 'string' || typeof vault.iv !== 'string') {
    throw new HttpError(400, 'invalid_vault', 'Coffre rechiffré manquant.');
  }
  if (!verifyAuthKey(currentAuthKey, user.auth_hash)) {
    registerFailure('login', ip);
    throw new HttpError(401, 'invalid_credentials', 'Mot de passe actuel incorrect.');
  }

  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET auth_salt = ?, vault_salt = ?, kdf_iterations = ?, auth_hash = ? WHERE id = ?')
      .run(newAuthSalt, newVaultSalt, iterations, hashAuthKey(newAuthKey), user.id);
    const current = db.prepare('SELECT version FROM vaults WHERE user_id = ?').get(user.id);
    const nextVersion = (current ? current.version : 0) + 1;
    db.prepare(`
      INSERT INTO vaults (user_id, ciphertext, iv, version, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, version = excluded.version, updated_at = excluded.updated_at
    `).run(user.id, vault.ciphertext, vault.iv, nextVersion, now);
    // Every other device must re-authenticate with the new password.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, session.token_hash);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  sendJson(res, 200, { status: 'password_changed' });
}
