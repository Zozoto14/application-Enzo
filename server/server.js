import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { HttpError, readJson, sendJson } from './http.js';
import { cleanupExpired } from './db.js';
import {
  handlePrelogin, handleSignup, handleLogin, handleLogout, handleSessionInfo,
  handleVerifyEmail, handleResendVerification, handleChangePassword,
} from './auth.js';
import { handleGetVault, handlePutVault, handleDeleteAccount } from './sync.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = resolve(process.cwd(), process.env.PUBLIC_DIR || '.');
const BEHIND_TLS = process.env.BEHIND_TLS === 'true';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (BEHIND_TLS) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function baseUrlFor(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = BEHIND_TLS ? 'https' : 'http';
  return `${proto}://${req.headers.host || `${HOST}:${PORT}`}`;
}

// Same-origin check for state-changing requests, on top of the CSRF token and
// SameSite=Strict cookies.
function verifyOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = baseUrlFor(req);
  if (origin !== expected && process.env.ALLOW_ANY_ORIGIN !== 'true') {
    throw new HttpError(403, 'bad_origin', 'Origine non autorisée.');
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const filePath = join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { code: 'forbidden', message: 'Accès refusé.' });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      // The service worker must not be served from a stale cache or the app can
      // get stuck on an old build.
      'Cache-Control': ext === '.html' || relative === 'sw.js' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
  }
}

const ROUTES = {
  'POST /api/auth/prelogin': async (req, res) => handlePrelogin(req, res, await readJson(req)),
  'POST /api/auth/signup': async (req, res) => handleSignup(req, res, await readJson(req), baseUrlFor(req)),
  'POST /api/auth/login': async (req, res) => handleLogin(req, res, await readJson(req)),
  'POST /api/auth/logout': async (req, res) => handleLogout(req, res),
  'GET /api/auth/session': async (req, res) => handleSessionInfo(req, res),
  'POST /api/auth/verify-email': async (req, res) => handleVerifyEmail(req, res, await readJson(req)),
  'POST /api/auth/resend-verification': async (req, res) => handleResendVerification(req, res, await readJson(req), baseUrlFor(req)),
  'POST /api/auth/change-password': async (req, res) => handleChangePassword(req, res, await readJson(req)),
  'GET /api/vault': async (req, res) => handleGetVault(req, res),
  'PUT /api/vault': async (req, res) => handlePutVault(req, res, await readJson(req)),
  'DELETE /api/account': async (req, res) => handleDeleteAccount(req, res),
};

const server = createServer(async (req, res) => {
  applySecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const routeKey = `${req.method} ${url.pathname}`;

  if (url.pathname.startsWith('/api/')) {
    try {
      if (req.method !== 'GET') verifyOrigin(req);
      const handler = ROUTES[routeKey];
      if (!handler) {
        sendJson(res, 404, { code: 'not_found', message: 'Route inconnue.' });
        return;
      }
      await handler(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { code: error.code, message: error.message, ...error.extra });
      } else {
        console.error('Erreur serveur', error);
        sendJson(res, 500, { code: 'server_error', message: 'Erreur interne du serveur.' });
      }
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { code: 'method_not_allowed', message: 'Méthode non autorisée.' });
    return;
  }
  await serveStatic(req, res, url.pathname);
});

setInterval(cleanupExpired, 60 * 60 * 1000).unref();
cleanupExpired();

server.listen(PORT, HOST, () => {
  console.log(`Mon Budget — serveur démarré sur http://${HOST}:${PORT}`);
  if (!BEHIND_TLS && process.env.NODE_ENV === 'production') {
    console.warn('ATTENTION : BEHIND_TLS n\'est pas activé. Les cookies de session exigent HTTPS en production.');
  }
});
