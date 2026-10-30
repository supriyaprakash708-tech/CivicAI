import express from 'express';
import { CATEGORIES, CATEGORY_LABELS, STATUSES, STATUS_LABELS, PRIORITIES, TEAMS, config } from '../config.js';
import { getAllSettings } from '../db.js';
import { publicComplaint, publicHistory, publicUrgency } from '../serialize.js';
import { listHotspots } from '../services/hotspots.js';
import { publicStats } from '../services/stats.js';
import { HttpError, nowIso, hashTrackingCode, safeEqual } from '../util.js';
import { rateLimit } from '../middleware.js';

export function publicRoutes(db) {
  const router = express.Router();

  router.get('/meta', (req, res) => {
    const settings = getAllSettings(db);
    res.json({
      appName: 'CivicAI',
      cityName: settings.cityName,
      categories: CATEGORIES,
      statuses: STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s] })),
      priorities: PRIORITIES,
      teams: TEAMS,
      maxImageMB: settings.maxImageMB,
      ai: {
        providerConfigured: Boolean(config.ai.apiKey) && settings.aiEnabled !== false,
        imageAnalysisEnabled: Boolean(config.ai.apiKey) && config.ai.imageAnalysis,
        model: config.ai.apiKey ? config.ai.model : null,
        mode: config.ai.apiKey ? 'provider' : 'local-fallback',
      },
      limits: {
        descriptionMax: 2000,
        descriptionMin: 20,
        imageFormats: ['JPG', 'JPEG', 'PNG', 'WebP'],
      },
      demoMode: db.get("SELECT COUNT(*) n FROM complaints WHERE is_synthetic = 1").n > 0,
    });
  });

  router.get('/public/stats', (req, res) => {
    res.json(publicStats(db));
  });

  router.get('/public/hotspots', (req, res) => {
    const hotspots = listHotspots(db);
    res.json({
      hotspots,
      note: hotspots.length
        ? 'Hotspots are calculated from real stored coordinates using DBSCAN proximity clustering. Proximity alone does not prove a common cause.'
        : 'No hotspots found. Hotspot detection requires several complaints with coordinates close together.',
    });
  });

  // Secure anonymous tracking: public id + secret tracking code.
  router.post('/track', rateLimit({ windowMs: 60000, max: 30, keyPrefix: 'track' }), (req, res, next) => {
    try {
      const publicId = String(req.body?.complaintId || '').trim().toUpperCase();
      const code = String(req.body?.trackingCode || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!publicId) throw new HttpError(400, 'Complaint ID is required');
      const isAdmin = req.user?.role === 'admin';
      if (!code && !isAdmin) throw new HttpError(400, 'Complaint ID and tracking code are required');
      const row = isAdmin
        ? db.get('SELECT * FROM complaints WHERE public_id = ?', publicId)
        : db.get('SELECT * FROM complaints WHERE public_id = ? AND tracking_hash = ?', publicId, hashTrackingCode(code));
      if (!row) throw new HttpError(404, 'No complaint matches that ID and tracking code. Check both values and try again.');
      const history = db.all(
        'SELECT * FROM status_history WHERE complaint_id = ? ORDER BY id ASC',
        row.id
      );
      const mergedInto = row.merged_into_id
        ? db.get('SELECT public_id FROM complaints WHERE id = ?', row.merged_into_id)
        : null;
      const canonical = mergedInto
        ? db.get('SELECT * FROM complaints WHERE id = ?', row.merged_into_id)
        : null;
      const data = publicComplaint({ ...row, merged_into_public_id: mergedInto?.public_id }, { includeReporter: false });
      data.history = publicHistory(history);
      data.notifications = db.all(
        `SELECT kind, title, body, created_at FROM notifications
          WHERE complaint_id = ? AND audience = 'citizen' ORDER BY id DESC LIMIT 20`,
        row.id
      ).map((n) => ({ kind: n.kind, title: n.title, body: n.body, at: n.created_at }));
      data.mergedInto = mergedInto
        ? { publicId: mergedInto.public_id, status: publicStatusSummary(canonical), resolutionDetails: canonical?.resolution_details || null }
        : null;
      if (canonical) {
        data.history = publicHistory(db.all('SELECT * FROM status_history WHERE complaint_id = ? ORDER BY id ASC', canonical.id));
      }
      res.json({ complaint: data, trackingVerified: true, generatedAt: nowIso() });
    } catch (err) {
      next(err);
    }
  });

  /** Image access: admins, the owner (session), or a valid tracking code. */
  router.get('/complaints/public/:publicId/image', rateLimit({ windowMs: 60000, max: 120, keyPrefix: 'img' }), (req, res, next) => {
    try {
      const row = db.get('SELECT * FROM complaints WHERE public_id = ?', String(req.params.publicId).toUpperCase());
      if (!row || !row.image_path) throw new HttpError(404, 'Image not found');
      const code = String(req.get('x-tracking-code') || req.query.code || '').toUpperCase();
      const isAdmin = req.user?.role === 'admin';
      const isOwner = req.user && row.user_id && req.user.id === row.user_id;
      const validCode = code && row.tracking_hash && safeEqual(hashTrackingCode(code), row.tracking_hash);
      if (!isAdmin && !isOwner && !validCode) throw new HttpError(403, 'You are not authorised to view this image');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(row.image_path, { root: config.uploadDir }, (err) => {
        if (err) next(new HttpError(404, 'Image file is unavailable'));
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function publicStatusSummary(row) {
  if (!row) return null;
  return { label: STATUS_LABELS[row.status] || row.status, category: CATEGORY_LABELS[row.category] || row.category, urgency: publicUrgency(row.final_priority || row.recommended_priority, row.priority_review_required) };
}

export { CATEGORIES };
