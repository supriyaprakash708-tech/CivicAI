import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import { attachUser, sameOriginGuard, errorHandler, requestLogger, notFound } from './middleware.js';
import { publicRoutes } from './routes/public.js';
import { complaintsRoutes } from './routes/complaints.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';

/**
 * Express application factory. Accepts an already-open database so tests can
 * build isolated instances (in-memory or temp-file) without global state.
 */
export function createApp(db) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(attachUser(db));
  app.use(sameOriginGuard);
  app.use(requestLogger(db));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'CivicAI',
      time: new Date().toISOString(),
      aiMode: config.ai.apiKey ? 'provider' : 'local-fallback',
    });
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api', publicRoutes(db));
  app.use('/api', complaintsRoutes(db));
  // Admin routes are guarded inside the router, so unknown /api paths still 404.
  app.use('/api', adminRoutes(db));

  app.use('/api', notFound);

  // Static SPA (no build step). Never cache the shell so updates land immediately.
  const publicDir = path.join(ROOT_DIR, 'public');
  app.use(express.static(publicDir, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-store');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler());
  return app;
}
