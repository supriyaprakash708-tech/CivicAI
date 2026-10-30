import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader (no external dependency). Existing env wins. */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv();

const DATA_DIR = path.join(ROOT, 'data');

function resolvePath(p, fallback) {
  const v = p && p.trim() ? p.trim() : fallback;
  return path.isAbsolute(v) ? v : path.join(ROOT, v);
}

/** Persistent development secret so sessions survive restarts. */
function localSecret() {
  const file = path.join(DATA_DIR, '.secret');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  } catch {
    return crypto.randomBytes(48).toString('hex');
  }
}

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const ROOT_DIR = ROOT;
export const DATA_DIR_PATH = DATA_DIR;

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  dbPath: resolvePath(process.env.DB_PATH, './data/civicai.db'),
  uploadDir: resolvePath(process.env.UPLOAD_DIR, './data/uploads'),
  sessionDays: num(process.env.SESSION_TTL_DAYS, 7),
  sessionSecret: process.env.SESSION_SECRET || localSecret(),
  trackingSecret: process.env.TRACKING_SECRET || process.env.SESSION_SECRET || localSecret(),
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@civicai.local',
    password: process.env.ADMIN_PASSWORD || 'CivicAI@2026',
    name: process.env.ADMIN_NAME || 'City Administrator',
  },
  uploads: {
    hardCapBytes: 25 * 1024 * 1024,
    defaultMaxMB: num(process.env.MAX_IMAGE_MB, 8),
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
  ai: {
    enabled: (process.env.AI_ENABLED || 'true').toLowerCase() !== 'false',
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 20000),
    imageAnalysis: (process.env.AI_IMAGE_ANALYSIS || 'false').toLowerCase() === 'true',
  },
  isProduction: process.env.NODE_ENV === 'production',
};

export const CATEGORIES = [
  { key: 'roads', label: 'Roads and potholes' },
  { key: 'waste', label: 'Waste management' },
  { key: 'drainage', label: 'Waterlogging and drainage' },
  { key: 'streetlights', label: 'Streetlights' },
  { key: 'water', label: 'Water supply' },
  { key: 'safety', label: 'Public safety' },
  { key: 'infrastructure', label: 'Public infrastructure' },
  { key: 'other', label: 'Other civic issues' },
];
export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export const STATUSES = [
  'submitted',
  'under_review',
  'assigned',
  'in_progress',
  'resolved',
  'rejected',
  'awaiting_information',
  'reopened',
];
export const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under review',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
  awaiting_information: 'Awaiting information',
  reopened: 'Reopened',
};

export const PRIORITIES = ['critical', 'high', 'medium', 'low'];

export const TEAMS = [
  'Roads & Paving',
  'Sanitation',
  'Drainage & Stormwater',
  'Electrical Services',
  'Water Utilities',
  'Public Safety',
  'Parks & Buildings',
  'General Operations',
];

export const TEAM_BY_CATEGORY = {
  roads: 'Roads & Paving',
  waste: 'Sanitation',
  drainage: 'Drainage & Stormwater',
  streetlights: 'Electrical Services',
  water: 'Water Utilities',
  safety: 'Public Safety',
  infrastructure: 'Parks & Buildings',
  other: 'General Operations',
};

/** Allowed status transitions (backend enforced). */
export const STATUS_TRANSITIONS = {
  submitted: ['under_review', 'rejected', 'awaiting_information', 'assigned'],
  under_review: ['assigned', 'rejected', 'awaiting_information', 'in_progress', 'resolved'],
  assigned: ['in_progress', 'awaiting_information', 'rejected', 'assigned'],
  in_progress: ['resolved', 'awaiting_information', 'rejected'],
  awaiting_information: ['under_review', 'assigned', 'rejected', 'reopened'],
  reopened: ['under_review', 'assigned', 'in_progress', 'rejected'],
  resolved: ['reopened'],
  rejected: ['reopened'],
};
