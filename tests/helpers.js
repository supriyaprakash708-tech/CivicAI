import fs from 'node:fs';
import { once } from 'node:events';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { ensureAdmin, hashPassword } from '../server/auth.js';
import { config } from '../server/config.js';
import { newPublicId, nowIso } from '../server/util.js';

export const ADMIN = {
  email: config.admin.email,
  password: config.admin.password,
  name: config.admin.name,
};

export const CITIZEN = {
  email: 'citizen@test.local',
  password: 'CitizenPass123',
  name: 'Test Citizen',
};

let ipCounter = 1;

/** Unique synthetic client IP so unrelated tests do not share rate limits. */
export function nextIp() {
  const n = ipCounter++;
  return `10.10.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}

export function resetIps() {
  ipCounter = 1;
}

export function createUser(db, { email, password, name, role = 'citizen' }) {
  const existing = db.get('SELECT * FROM users WHERE email = ?', email);
  if (existing) return existing;
  const info = db.run(
    'INSERT INTO users (email, name, role, status, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    email, name, role, 'active', hashPassword(password), nowIso()
  );
  return db.get('SELECT * FROM users WHERE id = ?', Number(info.lastInsertRowid));
}

/**
 * Start an isolated app instance. Each call gets its own database handle (in
 * memory by default) and an ephemeral TCP port.
 */
export async function startApp({ dbPath = ':memory:', withCitizen = true } = {}) {
  const db = openDatabase(dbPath);
  ensureAdmin(db);
  if (withCitizen) createUser(db, CITIZEN);
  const admin = db.get("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const citizen = withCitizen ? db.get('SELECT * FROM users WHERE email = ?', CITIZEN.email) : null;

  const app = createApp(db);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    db,
    server,
    admin,
    citizen,
    base: `http://127.0.0.1:${port}`,
  };
}

export async function stopApp(ctx) {
  if (!ctx) return;
  try {
    await waitForNoProcessing(ctx.db, 8000);
  } catch { /* best effort before closing */ }
  await new Promise((resolve) => {
    ctx.server.close(resolve);
    ctx.server.closeIdleConnections?.();
  });
  try { ctx.db.close(); } catch { /* already closed */ }
}

export function cleanupUploads() {
  try { fs.rmSync(config.uploadDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Minimal HTTP client. X-Forwarded-For is trusted (TRUST_PROXY=true in tests)
 * so every call can get an independent rate-limit bucket by default.
 */
export async function api(base, method, path, { body, raw, form, cookie, headers = {}, ip } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  h['x-forwarded-for'] = ip || nextIp();

  let payload;
  if (form) {
    payload = form;
  } else if (raw !== undefined) {
    payload = raw;
    if (!h['content-type']) h['content-type'] = 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }

  const res = await fetch(`${base}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: res.status, headers: res.headers, text, json };
}

export function sessionFrom(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of cookies) {
    const first = String(value).split(';')[0];
    if (first.startsWith('civicai_session=')) return first;
  }
  return null;
}

export async function login(base, email, password, { ip } = {}) {
  const res = await api(base, 'POST', '/api/auth/login', { body: { email, password }, ip });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${res.text}`);
  }
  const cookie = sessionFrom(res);
  if (!cookie) throw new Error('Login response did not set a session cookie');
  return { cookie, user: res.json.user };
}

/** Build a multipart complaint submission with sensible defaults. */
export async function submitComplaint(ctx, overrides = {}, { cookie, ip, idempotencyKey, image } = {}) {
  const fields = {
    description: 'There is a large pothole on the main road that has been getting bigger for five days and is dangerous for cyclists.',
    address: '12 Test Road, Riverside',
    area: 'Riverside',
    lat: '22.5726',
    lng: '88.3639',
    category: 'roads',
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  if (image) {
    form.append('image', new Blob([image.buffer], { type: image.type || 'image/png' }), image.name || 'photo.png');
  }
  const headers = idempotencyKey ? { 'idempotency-key': idempotencyKey } : {};
  return api(ctx.base, 'POST', '/api/complaints', { form, cookie, ip, headers });
}

/** Insert a complaint directly (for hotspot/analytics fixtures). */
export function insertComplaint(db, overrides = {}) {
  const createdAt = overrides.createdAt || nowIso();
  const publicId = overrides.publicId || newPublicId();
  const info = db.run(
    `INSERT INTO complaints
       (public_id, tracking_hash, description, category, category_source, address, area, lat, lng,
        status, recommended_priority, final_priority, priority_score, priority_source, ai_source,
        ai_status, is_synthetic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    publicId,
    overrides.trackingHash || null,
    overrides.description || 'A test civic complaint used as a fixture.',
    overrides.category || 'roads',
    overrides.categorySource || 'citizen',
    overrides.address || 'Fixture Street',
    overrides.area || 'Fixture Area',
    overrides.lat ?? null,
    overrides.lng ?? null,
    overrides.status || 'submitted',
    overrides.recommendedPriority || 'medium',
    overrides.finalPriority || null,
    overrides.priorityScore ?? 40,
    overrides.prioritySource || 'rules',
    overrides.aiSource || 'heuristic',
    overrides.aiStatus || 'done',
    overrides.isSynthetic ? 1 : 0,
    createdAt,
    createdAt
  );
  return db.get('SELECT * FROM complaints WHERE id = ?', Number(info.lastInsertRowid));
}

export async function waitFor(fn, { timeout = 8000, interval = 20, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Wait until the asynchronous analysis pipeline settles a complaint. */
export async function waitForProcessing(db, id) {
  return waitFor(() => {
    const row = db.get('SELECT * FROM complaints WHERE id = ?', id);
    if (!row) return null;
    return ['pending', 'processing'].includes(row.ai_status) ? null : row;
  }, { label: `processing of complaint ${id}` });
}

export async function waitForNoProcessing(db, timeout = 8000) {
  try {
    await waitFor(() => {
      const row = db.get("SELECT COUNT(*) n FROM complaints WHERE ai_status IN ('pending','processing')");
      return row.n === 0 ? true : null;
    }, { timeout, label: 'the analysis queue to drain' });
  } catch { /* database may already be closing */ }
}

/** 1x1 transparent PNG (valid magic bytes, used for upload tests). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
