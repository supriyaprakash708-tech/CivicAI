import express from 'express';
import { ensureAdmin, createSession, destroySession, hashPassword, verifyPassword, sessionCookie, clearSessionCookie, requireUser } from '../auth.js';
import { writeAudit } from '../services/audit.js';
import { config } from '../config.js';
import { email as validateEmail, str, metaOf, HttpError, nowIso } from '../util.js';
import { rateLimit } from '../middleware.js';

export function authRoutes(db) {
  const router = express.Router();

  router.post('/signup', rateLimit({ windowMs: 15 * 60000, max: 10, keyPrefix: 'signup' }), (req, res, next) => {
    try {
      const name = str(req.body?.name, { field: 'Name', min: 2, max: 80, required: true });
      const email = validateEmail(req.body?.email);
      const password = String(req.body?.password || '');
      if (password.length < 8 || password.length > 128) throw new HttpError(400, 'Password must be 8–128 characters', { field: 'password' });
      if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        throw new HttpError(400, 'Password must include at least one letter and one number', { field: 'password' });
      }
      const existing = db.get('SELECT id FROM users WHERE email = ?', email);
      if (existing) throw new HttpError(409, 'An account with that email already exists');
      const info = db.run(
        "INSERT INTO users (email, name, role, status, password_hash, created_at) VALUES (?, ?, 'citizen', 'active', ?, ?)",
        email, name, hashPassword(password), nowIso()
      );
      const userId = Number(info.lastInsertRowid);
      const meta = metaOf(req);
      const session = createSession(db, userId, meta);
      res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      writeAudit(db, { actor: { id: userId, name, role: 'citizen' }, action: 'auth.signup', entityType: 'user', entityId: userId, meta, ip: meta.ip });
      res.status(201).json({ user: { id: userId, name, email, role: 'citizen' }, expiresAt: session.expiresAt });
    } catch (err) { next(err); }
  });

  router.post('/login', rateLimit({ windowMs: 15 * 60000, max: 12, keyPrefix: 'login' }), (req, res, next) => {
    try {
      const email = validateEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const user = db.get('SELECT * FROM users WHERE email = ?', email);
      if (!user || !verifyPassword(password, user.password_hash) || user.status !== 'active') {
        // Same message for unknown user and wrong password; no account enumeration.
        throw new HttpError(401, 'Invalid email or password');
      }
      const meta = metaOf(req);
      const session = createSession(db, user.id, meta);
      res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      writeAudit(db, { actor: user, action: 'auth.login', entityType: 'user', entityId: user.id, ip: meta.ip });
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, expiresAt: session.expiresAt });
    } catch (err) { next(err); }
  });

  /**
   * One-click officer access for demos and local evaluation.
   * Disabled in production; a real session and audit entry are still created.
   */
  router.post('/demo-officer', rateLimit({ windowMs: 60000, max: 20, keyPrefix: 'demo' }), (req, res, next) => {
    try {
      if (config.isProduction) throw new HttpError(403, 'Demo officer access is disabled in production');
      const user = db.get(
        "SELECT * FROM users WHERE email = ? AND role = 'admin' AND status = 'active'",
        config.admin.email
      ) || db.get("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1");
      if (!user) throw new HttpError(503, 'No administrator account is available. Run npm run seed first.');
      const meta = metaOf(req);
      const session = createSession(db, user.id, meta);
      res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      writeAudit(db, {
        actor: user, action: 'auth.demo_officer', entityType: 'user', entityId: user.id,
        details: { demo: true }, ip: meta.ip,
      });
      res.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        demo: true,
        expiresAt: session.expiresAt,
      });
    } catch (err) { next(err); }
  });

  router.post('/logout', (req, res, next) => {
    try {
      const user = req.user;
      if (user) {
        writeAudit(db, { actor: user, action: 'auth.logout', entityType: 'user', entityId: user.id, ip: metaOf(req).ip });
      }
      destroySession(db, req);
      res.setHeader('Set-Cookie', clearSessionCookie());
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user || null });
  });

  router.post('/password', requireUser, rateLimit({ windowMs: 15 * 60000, max: 8, keyPrefix: 'pw' }), (req, res, next) => {
    try {
      const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      if (!user) throw new HttpError(401, 'Sign in required');
      const current = String(req.body?.currentPassword || '');
      const next_ = String(req.body?.newPassword || '');
      if (!verifyPassword(current, user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
      if (next_.length < 8 || !/[A-Za-z]/.test(next_) || !/[0-9]/.test(next_)) {
        throw new HttpError(400, 'New password must be 8–128 characters and include a letter and a number');
      }
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next_), user.id);
      db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
      const session = createSession(db, user.id, metaOf(req));
      res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      writeAudit(db, { actor: user, action: 'auth.password_changed', entityType: 'user', entityId: user.id, ip: metaOf(req).ip });
      res.json({ ok: true, message: 'Password updated. Other sessions were signed out.' });
    } catch (err) { next(err); }
  });

  router.get('/users', requireUser, (req, res, next) => {
    // Only admins may list users; used by the assignment UI.
    try {
      if (req.user.role !== 'admin') throw new HttpError(403, 'Administrator access required');
      const users = db.all("SELECT id, name, email, role, status, created_at FROM users WHERE role = 'admin' AND status = 'active' ORDER BY name");
      res.json({ users });
    } catch (err) { next(err); }
  });

  return router;
}

export { ensureAdmin };
