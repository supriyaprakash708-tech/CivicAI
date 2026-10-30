import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError, nowIso, randomToken, sha256 } from './util.js';

const COOKIE_NAME = 'civicai_session';
const KEYLEN = 64;

/** scrypt password hashing (no native deps). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const derived = crypto.scryptSync(String(password), salt, KEYLEN, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
    }
  }
  return out;
}

export function createSession(db, userId, meta = {}) {
  const token = randomToken(32);
  const created = new Date();
  const expires = new Date(created.getTime() + config.sessionDays * 86400000);
  db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    sha256(token), userId, created.toISOString(), expires.toISOString(), meta.ip || null, meta.userAgent || null
  );
  return { token, expiresAt: expires.toISOString() };
}

export function sessionCookie(token, expiresAt) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie() {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (config.isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionToken(req) {
  return parseCookies(req.headers.cookie || '')[COOKIE_NAME] || null;
}

export function sessionUser(db, req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const row = db.get(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.name, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    sha256(token)
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || row.status !== 'active') {
    db.run('DELETE FROM sessions WHERE token_hash = ?', row.token_hash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function destroySession(db, req) {
  const token = readSessionToken(req);
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in required'));
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in required'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Administrator access required'));
  next();
}

export function ensureAdmin(db) {
  const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if (admins.n > 0) return false;
  const existing = db.get('SELECT id FROM users WHERE email = ?', config.admin.email);
  if (existing) {
    db.run("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?", hashPassword(config.admin.password), existing.id);
    return true;
  }
  db.run(
    `INSERT INTO users (email, name, role, status, password_hash, created_at)
     VALUES (?, ?, 'admin', 'active', ?, ?)`,
    config.admin.email, config.admin.name, hashPassword(config.admin.password), nowIso()
  );
  return true;
}
