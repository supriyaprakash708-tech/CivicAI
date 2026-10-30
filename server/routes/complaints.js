import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, CATEGORY_KEYS, CATEGORY_LABELS, STATUS_LABELS } from '../config.js';
import { getAllSettings } from '../db.js';
import { writeAudit } from '../services/audit.js';
import { queueProcessing } from '../services/pipeline.js';
import { hasImminentHazard } from '../services/priority.js';
import { publicComplaint, publicHistory, publicUrgency } from '../serialize.js';
import { rateLimit } from '../middleware.js';
import {
  HttpError, newPublicId, newTrackingCode, hashTrackingCode, nowIso,
  str, coord, validCategory, metaOf, randomToken,
} from '../util.js';

/* ------------------------- secure image handling ------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.hardCapBytes, files: 1 },
});

const IMAGE_TYPES = {
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return IMAGE_TYPES.jpg;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return IMAGE_TYPES.png;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return IMAGE_TYPES.webp;
  return null;
}

function sizeMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function complaintsRoutes(db) {
  const router = express.Router();
  const idempotency = new Map();

  function remember(key, payload) {
    idempotency.set(key, { payload, at: Date.now() });
    if (idempotency.size > 800) {
      const cutoff = Date.now() - 10 * 60000;
      for (const [k, v] of idempotency) if (v.at < cutoff) idempotency.delete(k);
    }
  }

  router.post(
    '/complaints',
    rateLimit({ windowMs: 60 * 60000, max: 12, keyPrefix: 'report' }),
    (req, res, next) => {
      upload.single('image')(req, res, (err) => (err ? next(err) : next()));
    },
    async (req, res, next) => {
      let savedFile = null;
      try {
        const settings = getAllSettings(db);
        const body = req.body || {};

        // Idempotency: repeated button clicks must not create duplicates.
        const idemKey = String(req.get('idempotency-key') || '').trim();
        if (idemKey) {
          const scoped = `${req.user?.id || req.ip}:${idemKey}`;
          const existing = idempotency.get(scoped);
          if (existing && Date.now() - existing.at < 10 * 60000) {
            return res.status(existing.payload.status).json({ ...existing.payload.body, replayed: true });
          }
        }

        const description = str(body.description, {
          field: 'Description', min: 20, max: 2000, required: true,
        });
        const rawCategory = String(body.category || '').trim();
        const autoCategory = !rawCategory || rawCategory === 'auto';
        let category = null;
        if (!autoCategory) category = validCategory(rawCategory);

        const address = str(body.address, { field: 'Address or landmark', max: 300 });
        const area = str(body.area, { field: 'Area', max: 100 });
        const lat = coord(body.lat, 'Latitude', { min: -90, max: 90 });
        const lng = coord(body.lng, 'Longitude', { min: -180, max: 180 });
        if ((lat == null) !== (lng == null)) throw new HttpError(400, 'Latitude and longitude must be provided together');
        if (!address && lat == null) {
          throw new HttpError(400, 'A location is required. Enter an address/landmark or select coordinates on the map.', { field: 'address' });
        }
        const reporterName = str(body.reporterName, { field: 'Name', max: 80 });
        const reporterContact = str(body.reporterContact, { field: 'Contact', max: 120 });

        let imagePath = null;
        let imageMime = null;
        if (req.file) {
          const maxBytes = Math.max(0.1, settings.maxImageMB) * 1024 * 1024;
          if (req.file.size > maxBytes) {
            throw new HttpError(413, `Image is ${sizeMB(req.file.size)} MB; the configured limit is ${settings.maxImageMB} MB.`, { field: 'image' }, 'FILE_TOO_LARGE');
          }
          const detected = sniffImage(req.file.buffer);
          if (!detected) {
            throw new HttpError(400, 'The uploaded file is not a valid JPG, PNG or WebP image.', { field: 'image' }, 'INVALID_IMAGE');
          }
          if (!config.uploads.allowedMime.includes(detected.mime)) {
            throw new HttpError(400, 'Unsupported image format.', { field: 'image' });
          }
          fs.mkdirSync(config.uploadDir, { recursive: true });
          const filename = `${new Date().toISOString().slice(0, 10)}-${randomToken(16)}.${detected.ext}`;
          await fs.promises.writeFile(path.join(config.uploadDir, filename), req.file.buffer, { mode: 0o600 });
          savedFile = filename;
          imagePath = filename;
          imageMime = detected.mime;
        }

        const trackingCode = newTrackingCode();
        let publicId = null;
        for (let i = 0; i < 6; i += 1) {
          const candidate = newPublicId();
          if (!db.get('SELECT 1 AS x FROM complaints WHERE public_id = ?', candidate)) { publicId = candidate; break; }
        }
        if (!publicId) throw new HttpError(503, 'Could not allocate a complaint ID. Please retry.');

        const createdAt = nowIso();
        const hazard = hasImminentHazard(description);
        const info = db.run(
          `INSERT INTO complaints
             (public_id, tracking_hash, user_id, description, category, category_source,
              address, area, lat, lng, image_path, image_mime, status, priority_review_required,
              reporter_name, reporter_contact, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?)`,
          publicId,
          hashTrackingCode(trackingCode),
          req.user?.id ?? null,
          description,
          autoCategory ? 'other' : category,
          autoCategory ? 'ai' : 'citizen',
          address,
          area,
          lat,
          lng,
          imagePath,
          imageMime,
          hazard ? 1 : 0,
          reporterName,
          reporterContact,
          createdAt,
          createdAt
        );
        const complaintId = Number(info.lastInsertRowid);

        db.run(
          `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, created_at)
           VALUES (?, NULL, 'submitted', ?, ?, ?, ?)`,
          complaintId, req.user?.id ?? null, req.user ? req.user.name : 'Citizen',
          'Complaint received and queued for review.', createdAt
        );

        db.run(
          `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
           VALUES (?, 'admin', ?, ?, ?, ?)`,
          complaintId,
          hazard ? 'urgent_hazard' : 'new_complaint',
          hazard ? `Urgent hazard flagged: ${publicId}` : `New complaint: ${publicId}`,
          hazard
            ? 'The description contains an immediate-hazard phrase. Verify urgently; priority scoring will follow.'
            : `${CATEGORY_LABELS[category || 'other'] || 'Auto-detect'} — awaiting AI/rules processing.`,
          createdAt
        );

        writeAudit(db, {
          actor: req.user || null,
          action: 'complaint.created',
          entityType: 'complaint',
          entityId: complaintId,
          details: {
            publicId, category: category || 'auto', hasImage: Boolean(imagePath), hazard,
            synthetic: false,
          },
          ip: metaOf(req).ip,
        });

        const row = db.get('SELECT * FROM complaints WHERE id = ?', complaintId);
        const payload = {
          status: 201,
          body: {
            complaint: publicComplaint(row),
            trackingCode,
            tracking: {
              complaintId: publicId,
              note: 'Save this tracking code. It is required to view the complaint privately and is shown only once.',
            },
            processing: 'queued',
            urgentFlag: hazard,
          },
        };
        if (idemKey) remember(`${req.user?.id || req.ip}:${idemKey}`, payload);

        // Persisted first; AI work happens asynchronously.
        queueProcessing(db, complaintId);

        res.status(201).json(payload.body);
      } catch (err) {
        if (savedFile) {
          fs.promises.unlink(path.join(config.uploadDir, savedFile)).catch(() => {});
        }
        next(err);
      }
    }
  );

  /* ---------------------------- my complaints ----------------------------- */
  router.get('/my/complaints', (req, res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Sign in required');
      const rows = db.all(
        'SELECT * FROM complaints WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        req.user.id
      );
      res.json({
        complaints: rows.map((r) => {
          const base = publicComplaint(r);
          base.trackingAvailable = true;
          return base;
        }),
      });
    } catch (err) { next(err); }
  });

  router.get('/my/complaints/:publicId', (req, res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Sign in required');
      const row = db.get('SELECT * FROM complaints WHERE public_id = ?', String(req.params.publicId).toUpperCase());
      if (!row || (row.user_id !== req.user.id && req.user.role !== 'admin')) {
        throw new HttpError(404, 'Complaint not found');
      }
      const history = db.all('SELECT * FROM status_history WHERE complaint_id = ? ORDER BY id', row.id);
      const mergedInto = row.merged_into_id ? db.get('SELECT public_id FROM complaints WHERE id = ?', row.merged_into_id) : null;
      res.json({
        complaint: { ...publicComplaint({ ...row, merged_into_public_id: mergedInto?.public_id }), history: publicHistory(history) },
      });
    } catch (err) { next(err); }
  });

  return router;
}

export { STATUS_LABELS, publicUrgency };
