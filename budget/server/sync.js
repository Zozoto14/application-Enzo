import { db } from './db.js';
import { HttpError, sendJson, clientIp } from './http.js';
import { requireVerifiedSession, requireSession, requireCsrf } from './auth.js';
import { checkLimit, registerFailure } from './ratelimit.js';

const MAX_CIPHERTEXT_CHARS = Number(process.env.MAX_VAULT_CHARS || 10 * 1024 * 1024);

function enforceSyncLimit(req) {
  const status = checkLimit('sync', clientIp(req));
  if (!status.allowed) {
    throw new HttpError(429, 'rate_limited', 'Trop de requêtes de synchronisation.');
  }
  registerFailure('sync', clientIp(req));
}

export async function handleGetVault(req, res) {
  enforceSyncLimit(req);
  const { user } = requireVerifiedSession(req);
  const vault = db.prepare('SELECT ciphertext, iv, version, updated_at FROM vaults WHERE user_id = ?').get(user.id);
  if (!vault) {
    sendJson(res, 200, { exists: false, version: 0 });
    return;
  }
  sendJson(res, 200, {
    exists: true,
    ciphertext: vault.ciphertext,
    iv: vault.iv,
    version: vault.version,
    updatedAt: vault.updated_at,
  });
}

export async function handlePutVault(req, res, body) {
  enforceSyncLimit(req);
  const { session, user } = requireVerifiedSession(req);
  requireCsrf(req, session);

  const { ciphertext, iv, baseVersion } = body;
  if (typeof ciphertext !== 'string' || typeof iv !== 'string' || !ciphertext || !iv) {
    throw new HttpError(400, 'invalid_vault', 'Coffre chiffré invalide.');
  }
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    throw new HttpError(413, 'vault_too_large', 'Coffre trop volumineux. Réduisez le nombre de photos de reçus.');
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new HttpError(400, 'invalid_version', 'Version de base invalide.');
  }

  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT ciphertext, iv, version, updated_at FROM vaults WHERE user_id = ?').get(user.id);
    const currentVersion = current ? current.version : 0;

    // Another device wrote since this client last pulled: hand its copy back so the
    // client can merge record-by-record instead of silently overwriting it.
    if (currentVersion !== baseVersion) {
      db.exec('ROLLBACK');
      sendJson(res, 409, {
        code: 'conflict',
        server: current
          ? { exists: true, ciphertext: current.ciphertext, iv: current.iv, version: current.version, updatedAt: current.updated_at }
          : { exists: false, version: 0 },
      });
      return;
    }

    const nextVersion = currentVersion + 1;
    db.prepare(`
      INSERT INTO vaults (user_id, ciphertext, iv, version, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, version = excluded.version, updated_at = excluded.updated_at
    `).run(user.id, ciphertext, iv, nextVersion, now);
    db.exec('COMMIT');
    sendJson(res, 200, { version: nextVersion, updatedAt: now });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function handleDeleteAccount(req, res) {
  const { session, user } = requireSession(req);
  requireCsrf(req, session);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  sendJson(res, 200, { status: 'account_deleted' });
}
