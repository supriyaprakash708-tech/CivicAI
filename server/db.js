import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(HERE, 'schema.sql'), 'utf8');

export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const api = {
    raw: db,
    path: dbPath,
    get: (sql, ...params) => db.prepare(sql).get(...params),
    all: (sql, ...params) => db.prepare(sql).all(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
    exec: (sql) => db.exec(sql),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      }
    },
    close: () => db.close(),
  };
  return api;
}

let singleton = null;
export function getDb() {
  if (!singleton) singleton = openDatabase(config.dbPath);
  return singleton;
}
export function setDb(db) {
  singleton = db;
}

/* ------------------------------- settings -------------------------------- */
const SETTING_DEFAULTS = {
  duplicateThreshold: 0.6,
  duplicateMaxDistanceM: 1500,
  duplicateWindowDays: 120,
  hotspotRadiusM: 600,
  hotspotMinPoints: 3,
  maxImageMB: config.uploads.defaultMaxMB,
  aiEnabled: true,
  cityName: 'Riverport',
};

export function getSetting(db, key) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return SETTING_DEFAULTS[key];
  const fallback = SETTING_DEFAULTS[key];
  if (typeof fallback === 'number') {
    const n = Number(row.value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof fallback === 'boolean') return row.value === 'true';
  return row.value;
}

export function getAllSettings(db) {
  const rows = db.all('SELECT key, value FROM settings');
  const out = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    const fallback = SETTING_DEFAULTS[row.key] ?? row.value;
    if (typeof fallback === 'number') out[row.key] = Number(row.value);
    else if (typeof fallback === 'boolean') out[row.key] = row.value === 'true';
    else out[row.key] = row.value;
  }
  return out;
}

export function setSetting(db, key, value) {
  if (!(key in SETTING_DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  const fallback = SETTING_DEFAULTS[key];
  let normalized;
  if (typeof fallback === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number`);
    normalized = String(n);
  } else if (typeof fallback === 'boolean') {
    normalized = value === true || value === 'true' ? 'true' : 'false';
  } else {
    normalized = String(value).slice(0, 120);
  }
  db.run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key, normalized, new Date().toISOString()
  );
  return normalized;
}

export { SETTING_DEFAULTS };
