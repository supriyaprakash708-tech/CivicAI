import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  config, TEAMS, TEAM_BY_CATEGORY, PRIORITIES, STATUSES, STATUS_LABELS,
  STATUS_TRANSITIONS, CATEGORY_KEYS, CATEGORY_LABELS,
} from '../config.js';
import { getAllSettings, setSetting } from '../db.js';
import { writeAudit, listAudit } from '../services/audit.js';
import { adminStats, normalizeFilters, buildComplaintWhere, areaOptions } from '../services/stats.js';
import { listDuplicateLinks, pendingDuplicateCount } from '../services/duplicates.js';
import { listHotspots, recomputeHotspots } from '../services/hotspots.js';
import { processComplaint } from '../services/pipeline.js';
import { adminComplaint, adminListRow, publicHistory } from '../serialize.js';
import { HttpError, nowIso, str, validCategory, coord, metaOf } from '../util.js';
import { requireAdmin } from '../auth.js';

const PRIORITY_SQL = 'COALESCE(c.final_priority, c.recommended_priority)';

function actorLabel(user) {
  return `${user.name} (administrator)`;
}

export function adminRoutes(db) {
  const router = express.Router();

  // All /api/admin/* endpoints require an authenticated administrator. Keeping
  // the guard inside the router means unrelated /api paths can still 404.
  router.use('/admin', requireAdmin);

  function getComplaint(id) {
    const row = db.get('SELECT * FROM complaints WHERE id = ?', Number(id));
    if (!row) throw new HttpError(404, 'Complaint not found');
    return row;
  }

  function complaintDetail(id) {
    const row = db.get(
      `SELECT c.*, m.public_id AS merged_into_public_id, u.name AS priority_overridden_by_name,
              (SELECT COUNT(*) FROM complaints x WHERE x.merged_into_id = c.id) AS merged_count
         FROM complaints c
         LEFT JOIN complaints m ON m.id = c.merged_into_id
         LEFT JOIN users u ON u.id = c.priority_overridden_by
        WHERE c.id = ?`,
      Number(id)
    );
    if (!row) throw new HttpError(404, 'Complaint not found');
    const history = db.all(
      'SELECT * FROM status_history WHERE complaint_id = ? ORDER BY id ASC',
      row.id
    );
    const dupes = db.all(
      `SELECT d.*, p.public_id AS primary_public_id, r.public_id AS related_public_id
         FROM duplicate_links d
         JOIN complaints p ON p.id = d.primary_id
         JOIN complaints r ON r.id = d.related_id
        WHERE d.primary_id = ? OR d.related_id = ?
        ORDER BY d.status = 'pending' DESC, d.similarity DESC`,
      row.id, row.id
    ).map((d) => ({
      id: d.id,
      similarity: d.similarity,
      textSimilarity: d.text_similarity,
      categorySimilarity: d.category_similarity,
      distanceM: d.distance_m,
      daysApart: d.days_apart,
      reasons: safeParse(d.reasons, []),
      status: d.status,
      reviewNote: d.review_note,
      reviewedAt: d.reviewed_at,
      primaryId: d.primary_id,
      relatedId: d.related_id,
      primaryPublicId: d.primary_public_id,
      relatedPublicId: d.related_public_id,
      direction: d.primary_id === row.id ? 'outgoing' : 'incoming',
    }));
    const mergedReports = db.all(
      'SELECT id, public_id, status, created_at FROM complaints WHERE merged_into_id = ? ORDER BY created_at',
      row.id
    ).map((r) => ({ id: r.id, publicId: r.public_id, status: r.status, createdAt: r.created_at }));
    const audit = db.all(
      "SELECT * FROM audit_logs WHERE entity_type = 'complaint' AND entity_id = ? ORDER BY id DESC LIMIT 30",
      String(row.id)
    ).map((a) => ({ id: a.id, action: a.action, actor: a.actor_label, details: safeParse(a.details, null), at: a.created_at }));
    return {
      complaint: adminComplaint(row, { history, duplicates: dupes }),
      mergedReports,
      audit,
      teams: TEAMS,
      transitions: STATUS_TRANSITIONS[row.status] || [],
    };
  }

  /* ------------------------------- dashboard ------------------------------ */
  router.get('/admin/stats', (req, res) => {
    const filters = normalizeFilters(req.query);
    res.json(adminStats(db, filters));
  });

  router.get('/admin/complaints', (req, res) => {
    const filters = normalizeFilters(req.query);
    const { clause, params } = buildComplaintWhere(filters);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const sortMap = {
      newest: 'c.created_at DESC',
      oldest: 'c.created_at ASC',
      updated: 'c.updated_at DESC',
      priority: `CASE ${PRIORITY_SQL} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, c.created_at DESC`,
      status: 'c.status ASC, c.created_at DESC',
      category: 'c.category ASC, c.created_at DESC',
      public_id: 'c.public_id ASC',
    };
    const order = sortMap[req.query.sort] || sortMap.newest;
    const total = db.get(`SELECT COUNT(*) n FROM complaints c ${clause}`, ...params).n;
    const rows = db.all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM duplicate_links d WHERE (d.primary_id = c.id OR d.related_id = c.id) AND d.status = 'pending') AS pending_dupes,
              (SELECT MAX(d.similarity) FROM duplicate_links d WHERE (d.primary_id = c.id OR d.related_id = c.id) AND d.status IN ('pending','confirmed','linked')) AS max_similarity,
              (SELECT COUNT(*) FROM complaints x WHERE x.merged_into_id = c.id) AS merged_count
         FROM complaints c ${clause}
        ORDER BY ${order}
        LIMIT ? OFFSET ?`,
      ...params, pageSize, offset
    );
    res.json({
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      filters,
      complaints: rows.map(adminListRow),
      areas: areaOptions(db),
    });
  });

  router.get('/admin/complaints/:id', (req, res) => {
    res.json(complaintDetail(req.params.id));
  });

  router.get('/admin/complaints/:id/image', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      if (!row.image_path) throw new HttpError(404, 'No image attached');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(path.basename(row.image_path), { root: config.uploadDir }, (err) => {
        if (err) next(new HttpError(404, 'Image file is unavailable'));
      });
    } catch (err) { next(err); }
  });

  /* -------------------------------- workflow ------------------------------ */
  router.post('/admin/complaints/:id/status', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      const status = String(req.body?.status || '');
      if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
      const allowed = STATUS_TRANSITIONS[row.status] || [];
      if (!allowed.includes(status)) {
        throw new HttpError(409, `Cannot move a complaint from ${STATUS_LABELS[row.status]} to ${STATUS_LABELS[status] || status}.`, {
          current: row.status, allowed,
        });
      }
      const publicUpdate = str(req.body?.publicUpdate, { field: 'Public update', max: 1000 });
      const internalNote = str(req.body?.internalNote, { field: 'Internal note', max: 2000 });
      const reason = str(req.body?.reason, { field: 'Reason', max: 1000 });
      const resolutionDetails = str(req.body?.resolutionDetails, { field: 'Resolution details', max: 2000 });

      if (status === 'rejected' && (!reason || reason.length < 8)) {
        throw new HttpError(400, 'An explanation is required when rejecting a report.', { field: 'reason' });
      }
      if (status === 'resolved' && (!resolutionDetails || resolutionDetails.length < 10)) {
        throw new HttpError(400, 'Resolution details (at least 10 characters) are required when resolving a complaint.', { field: 'resolutionDetails' });
      }

      const team = row.assigned_team || TEAM_BY_CATEGORY[row.category] || 'General Operations';
      const defaults = {
        under_review: 'Your report is now under review by the civic team.',
        assigned: `The report has been assigned to ${team}.`,
        in_progress: `${team} has started work on this issue.`,
        resolved: `The issue has been marked resolved. ${resolutionDetails || ''}`.trim(),
        rejected: 'This report was reviewed and closed. Please contact the civic office if you believe this is an error.',
        awaiting_information: 'The civic team needs more information before proceeding. Please check for a message from the authority.',
        reopened: 'The report has been reopened for further action.',
        submitted: 'Your report has been recorded.',
      };
      const now = nowIso();
      db.transaction(() => {
        db.run(
          `UPDATE complaints SET status = ?, resolution_details = COALESCE(?, resolution_details),
             assigned_team = CASE WHEN ? = 'assigned' THEN ? ELSE assigned_team END,
             assigned_at = CASE WHEN ? = 'assigned' AND assigned_at IS NULL THEN ? ELSE assigned_at END,
             resolved_at = CASE WHEN ? = 'resolved' THEN ? WHEN ? = 'reopened' THEN NULL ELSE resolved_at END,
             updated_at = ? WHERE id = ?`,
          status, status === 'resolved' ? resolutionDetails : null,
          status, team, status, now, status, now, status, now, row.id
        );
        db.run(
          `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id, row.status, status, req.user.id, actorLabel(req.user),
          publicUpdate || defaults[status], internalNote || reason || null, now
        );
        if (status === 'rejected' && reason) {
          db.run(
            `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
             VALUES (?, 'citizen', 'status', ?, ?, ?)`,
            row.id, `Report ${row.public_id} closed`,
            publicUpdate || 'The report was closed after review. Contact the civic office for details.', now
          );
        } else {
          db.run(
            `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
             VALUES (?, 'citizen', 'status', ?, ?, ?)`,
            row.id, `Report ${row.public_id}: ${STATUS_LABELS[status]}`,
            publicUpdate || defaults[status], now
          );
        }
        writeAudit(db, {
          actor: req.user,
          action: 'complaint.status_changed',
          entityType: 'complaint',
          entityId: row.id,
          details: { from: row.status, to: status, reason: reason || null, publicUpdate: publicUpdate || null },
          ip: metaOf(req).ip,
        });
      });
      res.json({ ok: true, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  router.post('/admin/complaints/:id/assign', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      const team = str(req.body?.team, { field: 'Team', max: 100, required: true });
      const assignee = str(req.body?.assignee, { field: 'Assignee', max: 100 });
      const note = str(req.body?.note, { field: 'Note', max: 1000 });
      const now = nowIso();
      const nextStatus = ['submitted', 'under_review', 'reopened', 'awaiting_information'].includes(row.status) ? 'assigned' : row.status;
      db.transaction(() => {
        db.run(
          `UPDATE complaints SET assigned_team = ?, assigned_to = ?, assigned_at = ?, status = ?, updated_at = ? WHERE id = ?`,
          team, assignee, now, nextStatus, now, row.id
        );
        db.run(
          `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id, row.status, nextStatus, req.user.id, actorLabel(req.user),
          `Assigned to ${team}${assignee ? ` (${assignee})` : ''}.`, note || null, now
        );
        db.run(
          `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
           VALUES (?, 'citizen', 'assignment', ?, ?, ?)`,
          row.id, `Report ${row.public_id}: assigned`,
          `Your report has been assigned to ${team}.`, now
        );
        writeAudit(db, {
          actor: req.user, action: 'complaint.assigned', entityType: 'complaint', entityId: row.id,
          details: { team, assignee: assignee || null, fromStatus: row.status, toStatus: nextStatus }, ip: metaOf(req).ip,
        });
      });
      res.json({ ok: true, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  router.post('/admin/complaints/:id/priority', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      const priority = String(req.body?.priority || '');
      if (!PRIORITIES.includes(priority)) throw new HttpError(400, 'Invalid priority');
      const reason = str(req.body?.reason, { field: 'Reason', max: 1000, required: true });
      if (reason.length < 10) throw new HttpError(400, 'Please explain the priority change (at least 10 characters).', { field: 'reason' });
      const now = nowIso();
      db.transaction(() => {
        db.run(
          `UPDATE complaints SET final_priority = ?, priority_overridden_by = ?, priority_override_reason = ?,
             priority_overridden_at = ?, priority_review_required = 0, updated_at = ?
           WHERE id = ?`,
          priority, req.user.id, reason, now, now, row.id
        );
        db.run(
          `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
           VALUES (?, 'citizen', 'priority', ?, ?, ?)`,
          row.id, `Report ${row.public_id}: priority reviewed`,
          'An authorised administrator reviewed the urgency of this report.', now
        );
        writeAudit(db, {
          actor: req.user, action: 'complaint.priority_overridden', entityType: 'complaint', entityId: row.id,
          details: { from: row.final_priority || row.recommended_priority, to: priority, reason, aiRecommendation: row.recommended_priority }, ip: metaOf(req).ip,
        });
      });
      res.json({ ok: true, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  router.post('/admin/complaints/:id/comment', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      const publicUpdate = str(req.body?.publicUpdate, { field: 'Public update', max: 1000 });
      const internalNote = str(req.body?.internalNote, { field: 'Internal note', max: 2000 });
      if (!publicUpdate && !internalNote) throw new HttpError(400, 'Enter a public update and/or an internal note.');
      const now = nowIso();
      db.transaction(() => {
        db.run(
          `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id, row.status, row.status, req.user.id, actorLabel(req.user), publicUpdate, internalNote, now
        );
        if (publicUpdate) {
          db.run(
            `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
             VALUES (?, 'citizen', 'update', ?, ?, ?)`,
            row.id, `Update on ${row.public_id}`, publicUpdate, now
          );
        }
        db.run('UPDATE complaints SET updated_at = ? WHERE id = ?', now, row.id);
        writeAudit(db, {
          actor: req.user, action: 'complaint.comment_added', entityType: 'complaint', entityId: row.id,
          details: { public: Boolean(publicUpdate), internal: Boolean(internalNote) }, ip: metaOf(req).ip,
        });
      });
      res.json({ ok: true, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  router.patch('/admin/complaints/:id', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      const changes = {};
      const body = req.body || {};
      if (body.category !== undefined) {
        const category = validCategory(body.category);
        if (category !== row.category) changes.category = category;
      }
      if (body.summary !== undefined) {
        const summary = str(body.summary, { field: 'Summary', max: 600, required: true });
        if (summary !== row.ai_summary) changes.ai_summary = summary;
      }
      if (body.address !== undefined) {
        changes.address = str(body.address, { field: 'Address', max: 300 });
      }
      if (body.area !== undefined) {
        changes.area = str(body.area, { field: 'Area', max: 100 });
      }
      if (body.lat !== undefined || body.lng !== undefined) {
        const lat = coord(body.lat, 'Latitude', { min: -90, max: 90 });
        const lng = coord(body.lng, 'Longitude', { min: -180, max: 180 });
        if ((lat == null) !== (lng == null)) throw new HttpError(400, 'Latitude and longitude must be provided together');
        changes.lat = lat;
        changes.lng = lng;
      }
      if (!Object.keys(changes).length) throw new HttpError(400, 'No supported corrections were supplied.');
      if (changes.category) {
        changes.category_source = 'admin';
      }
      const now = nowIso();
      const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
      db.run(`UPDATE complaints SET ${sets}, updated_at = ? WHERE id = ?`, ...Object.values(changes), now, row.id);
      writeAudit(db, {
        actor: req.user, action: 'complaint.corrected', entityType: 'complaint', entityId: row.id,
        details: { changes, before: { category: row.category, summary: row.ai_summary, address: row.address, area: row.area } },
        ip: metaOf(req).ip,
      });
      if (changes.category) {
        db.run(
          `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
           VALUES (?, 'citizen', 'category', ?, ?, ?)`,
          row.id, `Report ${row.public_id}: category updated`,
          `The category was corrected to ${CATEGORY_LABELS[changes.category]}.`, now
        );
      }
      res.json({ ok: true, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  router.post('/admin/complaints/:id/reanalyze', async (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      if (row.ai_status === 'processing') throw new HttpError(409, 'Analysis is already running for this complaint.');
      const result = await processComplaint(db, row.id);
      writeAudit(db, {
        actor: req.user, action: 'complaint.reanalyzed', entityType: 'complaint', entityId: row.id,
        details: { source: result.source, fallback: result.fallback, aiStatus: result.aiStatus }, ip: metaOf(req).ip,
      });
      res.json({ ok: true, result, warning: result.warning || null, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  /* ------------------------------- duplicates ----------------------------- */
  router.get('/admin/duplicates', (req, res) => {
    const status = ['pending', 'confirmed', 'rejected', 'linked'].includes(req.query.status) ? req.query.status : 'pending';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 20));
    const data = listDuplicateLinks(db, { status, limit: pageSize, offset: (page - 1) * pageSize });
    res.json({
      ...data,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(data.total / pageSize)),
      pendingTotal: pendingDuplicateCount(db),
      thresholdNote: 'Candidates combine text similarity, category, distance and time. Nothing is merged automatically.',
    });
  });

  router.post('/admin/duplicates/:id/review', (req, res, next) => {
    try {
      const link = db.get('SELECT * FROM duplicate_links WHERE id = ?', Number(req.params.id));
      if (!link) throw new HttpError(404, 'Duplicate candidate not found');
      const decision = String(req.body?.decision || '');
      const note = str(req.body?.note, { field: 'Review note', max: 1000 });
      if (!['merge', 'reject', 'link'].includes(decision)) throw new HttpError(400, 'Decision must be merge, reject or link');
      if (decision === 'reject' && (!note || note.length < 5)) {
        throw new HttpError(400, 'Please record why the reports are not duplicates.', { field: 'note' });
      }
      if (link.status !== 'pending' && decision === 'reject') throw new HttpError(409, 'This candidate has already been reviewed.');
      const primaryId = Number(req.body?.primaryId) || link.primary_id;
      if (![link.primary_id, link.related_id].includes(primaryId)) {
        throw new HttpError(400, 'Primary complaint must be one of the linked reports.');
      }
      const secondaryId = primaryId === link.primary_id ? link.related_id : link.primary_id;
      const primary = getComplaint(primaryId);
      const secondary = getComplaint(secondaryId);
      if (primary.merged_into_id) throw new HttpError(409, 'The selected primary report is itself merged into another report.');
      if (secondary.merged_into_id && decision === 'merge') throw new HttpError(409, 'The selected duplicate is already merged into another report.');
      const now = nowIso();
      const statusMap = { merge: 'confirmed', reject: 'rejected', link: 'linked' };

      db.transaction(() => {
        db.run(
          'UPDATE duplicate_links SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?',
          statusMap[decision], req.user.id, now, note || null, link.id
        );
        if (decision === 'merge') {
          db.run('UPDATE complaints SET merged_into_id = ?, updated_at = ? WHERE id = ?', primary.id, now, secondary.id);
          db.run(
            `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            secondary.id, secondary.status, secondary.status, req.user.id, actorLabel(req.user),
            `This report was reviewed and linked to ${primary.public_id}, which covers the same issue. The original report has been preserved.`,
            note || null, now
          );
          db.run(
            `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            primary.id, primary.status, primary.status, req.user.id, actorLabel(req.user),
            null, `Merged duplicate report ${secondary.public_id} into this complaint.`, now
          );
          db.run(
            `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
             VALUES (?, 'citizen', 'duplicate', ?, ?, ?)`,
            secondary.id, `Report ${secondary.public_id}: linked to ${primary.public_id}`,
            'Your report was confirmed as describing the same issue as another report. Both records are preserved and updates will be tracked together.', now
          );
        }
        writeAudit(db, {
          actor: req.user, action: `duplicate.${decision}`, entityType: 'duplicate_link', entityId: link.id,
          details: {
            primary: primary.public_id, secondary: secondary.public_id, similarity: link.similarity,
            note: note || null, merged: decision === 'merge',
          },
          ip: metaOf(req).ip,
        });
      });

      if (decision === 'merge') {
        try { recomputeHotspots(db, getAllSettings(db)); } catch { /* non-fatal */ }
      }
      res.json({ ok: true, detail: complaintDetail(primary.id), decision });
    } catch (err) { next(err); }
  });

  router.post('/admin/complaints/:id/unmerge', (req, res, next) => {
    try {
      const row = getComplaint(req.params.id);
      if (!row.merged_into_id) throw new HttpError(409, 'This complaint is not merged into another report.');
      const note = str(req.body?.note, { field: 'Note', max: 1000, required: true });
      const now = nowIso();
      db.transaction(() => {
        db.run(
          `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id, row.status, row.status, req.user.id, actorLabel(req.user),
          'This report was unlinked from its duplicate and is tracked independently again.', note, now
        );
        db.run('UPDATE complaints SET merged_into_id = NULL, updated_at = ? WHERE id = ?', now, row.id);
        db.run(
          `UPDATE duplicate_links SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?
            WHERE (primary_id = ? AND related_id = ?) OR (primary_id = ? AND related_id = ?)`,
          req.user.id, now, `Unmerged: ${note}`, row.id, row.merged_into_id, row.merged_into_id, row.id
        );
        writeAudit(db, {
          actor: req.user, action: 'duplicate.unmerged', entityType: 'complaint', entityId: row.id,
          details: { fromPrimaryId: row.merged_into_id, note }, ip: metaOf(req).ip,
        });
      });
      res.json({ ok: true, detail: complaintDetail(row.id) });
    } catch (err) { next(err); }
  });

  /* ---------------------------------- map --------------------------------- */
  router.get('/admin/hotspots', (req, res) => {
    const settings = getAllSettings(db);
    const hotspots = listHotspots(db);
    const geolocated = db.get(
      "SELECT COUNT(*) n FROM complaints WHERE lat IS NOT NULL AND lng IS NOT NULL AND merged_into_id IS NULL AND status <> 'rejected'"
    ).n;
    res.json({
      hotspots,
      computedAt: hotspots[0]?.computedAt || null,
      parameters: {
        epsMeters: settings.hotspotRadiusM,
        minPoints: settings.hotspotMinPoints,
        geolocatedComplaints: geolocated,
      },
      note: hotspots.length
        ? 'DBSCAN over stored coordinates. A hotspot is a proximity pattern, not a confirmed shared cause.'
        : `No clusters of at least ${settings.hotspotMinPoints} reports within ${settings.hotspotRadiusM} m were found. Add more geolocated reports or adjust settings.`,
    });
  });

  router.post('/admin/hotspots/recompute', (req, res, next) => {
    try {
      const settings = getAllSettings(db);
      const result = recomputeHotspots(db, settings);
      writeAudit(db, {
        actor: req.user, action: 'hotspots.recomputed', entityType: 'hotspot', entityId: null,
        details: { clusters: result.clusters.length, points: result.pointsUsed, eps: result.eps, minPts: result.minPts },
        ip: metaOf(req).ip,
      });
      res.json({
        hotspots: listHotspots(db),
        computedAt: result.computedAt,
        parameters: { epsMeters: result.eps, minPoints: result.minPts, geolocatedComplaints: result.pointsUsed },
        note: 'Recalculated with the current settings.',
      });
    } catch (err) { next(err); }
  });

  /* ------------------------------- analytics ------------------------------ */
  router.get('/admin/analytics', (req, res) => {
    const filters = normalizeFilters(req.query);
    const stats = adminStats(db, filters);
    const unresolved = db.all(
      `SELECT id, public_id, category, COALESCE(final_priority, recommended_priority) priority, status,
              assigned_team, created_at, julianday('now') - julianday(created_at) AS age_days
         FROM complaints
        WHERE status NOT IN ('resolved','rejected')
        ORDER BY CASE COALESCE(final_priority, recommended_priority)
                   WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 created_at ASC
        LIMIT 12`
    );
    const hotspots = listHotspots(db);
    const topCategory = stats.byCategory.slice().sort((a, b) => b.count - a.count)[0];
    const unresolvedTotal = db.get("SELECT COUNT(*) n FROM complaints WHERE status NOT IN ('resolved','rejected')").n;
    const recurringCategories = db.all(
      `SELECT c.category, COUNT(*) n FROM duplicate_links d
         JOIN complaints c ON c.id = d.primary_id
        WHERE d.status IN ('pending','confirmed','linked')
        GROUP BY c.category ORDER BY n DESC LIMIT 5`
    );
    res.json({
      generatedAt: nowIso(),
      filters,
      stats,
      report: {
        mostCommonCategory: topCategory && topCategory.count > 0 ? topCategory : null,
        unresolvedTotal,
        unresolvedOldest: unresolved.slice().sort((a, b) => b.age_days - a.age_days).slice(0, 5),
        highPriorityOpen: db.get(
          "SELECT COUNT(*) n FROM complaints WHERE status NOT IN ('resolved','rejected') AND COALESCE(final_priority, recommended_priority) IN ('critical','high')"
        ).n,
        duplicateLinkedCategories: recurringCategories,
        hotspots,
        resolutionRate: stats.summary.resolutionRate,
        avgResolutionDays: stats.summary.avgResolutionDays,
        note: 'All figures are computed from stored complaint records at request time.',
      },
    });
  });

  /* --------------------------------- export ------------------------------- */
  router.get('/admin/export.csv', (req, res, next) => {
    try {
      const filters = normalizeFilters(req.query);
      const { clause, params } = buildComplaintWhere(filters);
      const rows = db.all(
        `SELECT c.public_id, c.category, c.area, c.address, c.lat, c.lng,
                COALESCE(c.final_priority, c.recommended_priority) priority, c.priority_source,
                c.recommended_priority, c.status, c.assigned_team, c.assigned_to,
                c.created_at, c.resolved_at, c.resolution_details, c.ai_source,
                c.is_synthetic, c.merged_into_id
           FROM complaints c ${clause}
          ORDER BY c.created_at DESC`,
        ...params
      );
      const header = [
        'complaint_id', 'category', 'area', 'address', 'latitude', 'longitude',
        'priority', 'priority_source', 'ai_recommended_priority', 'status', 'assigned_team',
        'assigned_to', 'submitted_at', 'resolved_at', 'resolution_details', 'ai_source',
        'synthetic_demo_record', 'merged_into_complaint_id',
      ];
      const esc = (value) => {
        let v = value == null ? '' : String(value);
        if (/^[=+\-@]/.test(v)) v = `'${v}`;
        return `"${v.replace(/"/g, '""')}"`;
      };
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([
          r.public_id, r.category, r.area, r.address, r.lat, r.lng, r.priority, r.priority_source,
          r.recommended_priority, r.status, r.assigned_team, r.assigned_to, r.created_at,
          r.resolved_at, r.resolution_details, r.ai_source, r.is_synthetic ? 'yes' : 'no',
          r.merged_into_id ? String(r.merged_into_id) : '',
        ].map(esc).join(','));
      }
      writeAudit(db, {
        actor: req.user, action: 'complaints.exported', entityType: 'complaint', entityId: null,
        details: { rows: rows.length, filters }, ip: metaOf(req).ip,
      });
      const filename = `civicai-complaints-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
    } catch (err) { next(err); }
  });

  /* --------------------------------- audit -------------------------------- */
  router.get('/admin/audit', (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 30));
    const data = listAudit(db, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      action: req.query.action ? String(req.query.action).slice(0, 80) : null,
    });
    res.json({
      ...data,
      page, pageSize,
      pages: Math.max(1, Math.ceil(data.total / pageSize)),
      actions: db.all('SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY n DESC LIMIT 25'),
    });
  });

  /* ------------------------------ notifications --------------------------- */
  router.get('/admin/notifications', (req, res) => {
    const rows = db.all(
      `SELECT n.*, c.public_id FROM notifications n LEFT JOIN complaints c ON c.id = n.complaint_id
        WHERE n.audience = 'admin' ORDER BY n.id DESC LIMIT 40`
    );
    const since = String(req.query.since || '');
    res.json({
      notifications: rows.map((n) => ({
        id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.created_at,
        publicId: n.public_id, complaintId: n.complaint_id, unread: since ? n.created_at > since : true,
      })),
      pendingDuplicates: pendingDuplicateCount(db),
      newReports: db.get(
        "SELECT COUNT(*) AS n FROM complaints WHERE status = 'submitted' AND merged_into_id IS NULL"
      ).n,
    });
  });

  /* -------------------------------- settings ------------------------------ */
  router.get('/admin/settings', (req, res) => {
    const settings = getAllSettings(db);
    res.json({
      settings,
      ai: {
        providerConfigured: Boolean(config.ai.apiKey),
        enabled: config.ai.enabled,
        model: config.ai.apiKey ? config.ai.model : null,
        baseUrlConfigured: Boolean(config.ai.apiKey),
        imageAnalysis: config.ai.imageAnalysis,
        mode: config.ai.apiKey ? 'provider' : 'local-fallback',
      },
      environment: {
        nodeEnv: config.env,
        sessionDays: config.sessionDays,
        uploadHardCapMB: Math.round(config.uploads.hardCapBytes / 1048576),
        dbPath: config.dbPath,
      },
      teams: TEAMS,
      note: 'Changes take effect immediately. AI provider credentials are read from environment variables and are never returned by the API.',
    });
  });

  router.patch('/admin/settings', (req, res, next) => {
    try {
      const allowed = ['duplicateThreshold', 'duplicateMaxDistanceM', 'duplicateWindowDays', 'hotspotRadiusM', 'hotspotMinPoints', 'maxImageMB', 'aiEnabled', 'cityName'];
      const candidate = {};
      for (const [key, value] of Object.entries(req.body || {})) {
        if (allowed.includes(key)) candidate[key] = value;
      }
      if (!Object.keys(candidate).length) throw new HttpError(400, 'No supported settings were supplied.');

      // Validate every value BEFORE persisting any of them: a rejected request
      // must leave the existing configuration untouched.
      if (candidate.maxImageMB !== undefined) {
        const mb = Number(candidate.maxImageMB);
        if (!Number.isFinite(mb) || mb <= 0) throw new HttpError(400, 'maxImageMB must be a positive number.');
        if (mb > 25) throw new HttpError(400, 'maxImageMB cannot exceed the hard cap of 25 MB.');
      }
      if (candidate.duplicateThreshold !== undefined) {
        const t = Number(candidate.duplicateThreshold);
        if (!Number.isFinite(t) || t < 0.3 || t > 0.95) {
          throw new HttpError(400, 'Duplicate threshold must be between 0.3 and 0.95.');
        }
      }
      if (candidate.duplicateMaxDistanceM !== undefined) {
        const d = Number(candidate.duplicateMaxDistanceM);
        if (!Number.isFinite(d) || d < 50 || d > 20000) {
          throw new HttpError(400, 'Duplicate distance must be between 50 and 20000 metres.');
        }
      }
      if (candidate.duplicateWindowDays !== undefined) {
        const d = Number(candidate.duplicateWindowDays);
        if (!Number.isFinite(d) || d < 1 || d > 730) {
          throw new HttpError(400, 'Duplicate window must be between 1 and 730 days.');
        }
      }
      if (candidate.hotspotRadiusM !== undefined) {
        const r = Number(candidate.hotspotRadiusM);
        if (!Number.isFinite(r) || r < 50 || r > 10000) {
          throw new HttpError(400, 'Hotspot radius must be between 50 and 10000 metres.');
        }
      }
      if (candidate.hotspotMinPoints !== undefined) {
        const n = Number(candidate.hotspotMinPoints);
        if (!Number.isInteger(n) || n < 2 || n > 50) {
          throw new HttpError(400, 'Hotspot minimum points must be a whole number between 2 and 50.');
        }
      }

      const updates = {};
      for (const [key, value] of Object.entries(candidate)) {
        updates[key] = setSetting(db, key, value);
      }
      writeAudit(db, {
        actor: req.user, action: 'settings.updated', entityType: 'settings', entityId: null,
        details: updates, ip: metaOf(req).ip,
      });
      res.json({ ok: true, settings: getAllSettings(db) });
    } catch (err) { next(err); }
  });

  return router;
}

function safeParse(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export { PRIORITY_SQL, CATEGORY_KEYS, fs, publicHistory };
