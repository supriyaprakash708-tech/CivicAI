import { config } from './config.js';
import { HttpError, metaOf } from './util.js';
import { sessionUser } from './auth.js';
import { writeAudit } from './services/audit.js';

/** Attach req.user from session cookie (never throws). */
export function attachUser(db) {
  return (req, res, next) => {
    try {
      req.user = sessionUser(db, req);
    } catch {
      req.user = null;
    }
    next();
  };
}

/** Reject cross-site state-changing requests (defence-in-depth on top of SameSite). */
export function sameOriginGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser client; auth still required
  let expected;
  if (config.publicOrigin) expected = config.publicOrigin;
  else expected = `${req.protocol}://${req.get('host')}`;
  try {
    if (new URL(origin).origin !== new URL(expected).origin) {
      return next(new HttpError(403, 'Cross-origin request blocked'));
    }
  } catch {
    return next(new HttpError(403, 'Invalid origin'));
  }
  next();
}

/** Small in-memory fixed-window rate limiter, keyed per route + IP. */
export function rateLimit({ windowMs = 60000, max = 30, keyPrefix = 'rl' } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.reset - now) / 1000)));
      return next(new HttpError(429, 'Too many requests. Please wait a moment and try again.'));
    }
    // Opportunistic cleanup to avoid unbounded growth.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
    }
    next();
  };
}

export function errorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'The uploaded image exceeds the maximum allowed size.', code: 'FILE_TOO_LARGE' });
    }
    if (err?.name === 'MulterError') {
      return res.status(400).json({ error: `Upload failed: ${err.message}`, code: 'UPLOAD_ERROR' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.', code: 'BODY_TOO_LARGE' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Malformed JSON body.', code: 'BAD_JSON' });
    }
    logger.error?.('[civicai] unhandled error', err);
    res.status(500).json({ error: 'Something went wrong on our side. The action was not completed.', code: 'INTERNAL' });
  };
}

export function requestLogger(db) {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api') && res.statusCode >= 400) {
        const meta = metaOf(req);
        try {
          writeAudit(db, {
            actor: req.user || null,
            action: res.statusCode === 401 || res.statusCode === 403 ? 'http.denied' : 'http.error',
            entityType: 'http',
            entityId: req.path,
            details: { method: req.method, status: res.statusCode, ms: Date.now() - start },
            ip: meta.ip,
          });
        } catch { /* logging must never break requests */ }
      }
    });
    next();
  };
}

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Not found'));
}
