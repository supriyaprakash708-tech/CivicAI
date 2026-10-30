import crypto from 'node:crypto';
import { config, CATEGORY_KEYS } from './config.js';

/** HTTP error with status + optional machine-readable code/details. */
export class HttpError extends Error {
  constructor(status, message, details = undefined, code = undefined) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export const nowIso = () => new Date().toISOString();

export function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Public complaint id: CIV-YYYY-XXXXXX (unambiguous alphabet). */
export function newPublicId(date = new Date()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) body += alphabet[bytes[i] % alphabet.length];
  return `CIV-${date.getUTCFullYear()}-${body}`;
}

/** Human-friendly tracking code, e.g. 7K3M-Q9XT-2P4R. */
export function newTrackingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function hashTrackingCode(code, secret = config.trackingSecret) {
  return crypto.createHmac('sha256', secret).update(String(code).trim().toUpperCase()).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ------------------------------ validation ------------------------------- */
export function str(value, { field, min = 0, max = 500, required = false, trim = true } = {}) {
  let v = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (trim) v = v.trim();
  if (!v) {
    if (required) throw new HttpError(400, `${field || 'This field'} is required`, { field });
    return null;
  }
  if (v.length < min) throw new HttpError(400, `${field || 'This field'} must be at least ${min} characters`, { field });
  if (v.length > max) throw new HttpError(400, `${field || 'This field'} must be at most ${max} characters`, { field });
  return v;
}

export function oneOf(value, allowed, field, { required = true } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return null;
  }
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`, { field });
  }
  return value;
}

export function coord(value, field, { min, max, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${field} is out of range`, { field });
  }
  return Number(n.toFixed(6));
}

export function email(value, field = 'Email', { required = true } = {}) {
  const v = str(value, { field, max: 200, required });
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new HttpError(400, `${field} is not a valid email address`, { field });
  return v.toLowerCase();
}

export function validCategory(value) {
  return oneOf(value, CATEGORY_KEYS, 'Category', { required: true });
}

export function clampNumber(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function daysBetween(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

export function metaOf(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: (req.get('user-agent') || '').slice(0, 300),
  };
}

/** Basic tolerance for JSON columns. */
export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
