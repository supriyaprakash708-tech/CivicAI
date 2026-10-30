import './env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  startApp, stopApp, cleanupUploads, login, api, submitComplaint, waitForProcessing,
  insertComplaint, ADMIN, CITIZEN, TINY_PNG,
} from './helpers.js';
import { hashTrackingCode } from '../server/util.js';

let ctx;
let adminCookie;
let citizenCookie;
let created;          // primary submission used by many downstream tests
let createdCode;
let createdId;
let citizenComplaintPublicId;

before(async () => {
  ctx = await startApp();
  adminCookie = (await login(ctx.base, ADMIN.email, ADMIN.password)).cookie;
  citizenCookie = (await login(ctx.base, CITIZEN.email, CITIZEN.password)).cookie;
});

after(async () => {
  await stopApp(ctx);
  cleanupUploads();
});

describe('public surface', () => {
  test('health, metadata and empty statistics are served from the database', async () => {
    const health = await api(ctx.base, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.aiMode, 'local-fallback');

    const meta = await api(ctx.base, 'GET', '/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.json.categories.length, 8);
    assert.equal(meta.json.statuses.length, 8);
    assert.equal(meta.json.ai.mode, 'local-fallback');
    assert.equal(meta.json.ai.providerConfigured, false);
    assert.equal(meta.json.demoMode, false);
    assert.ok(meta.json.limits.descriptionMin >= 20);

    const stats = await api(ctx.base, 'GET', '/api/public/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.summary.total, 0);
    assert.equal(stats.json.byCategory.length, 8);
    assert.equal(stats.json.timeline.length, 30);
    assert.match(stats.json.note, /calculated from the complaint database/i);
  });
});

describe('citizen submission and tracking', () => {
  test('accepts a complaint, stores a hashed tracking code and processes it without an AI provider', async () => {
    const res = await submitComplaint(ctx, { category: 'auto' }, { ip: '10.20.0.1' });
    assert.equal(res.status, 201, res.text);
    const { complaint, trackingCode, tracking, processing, urgentFlag } = res.json;
    assert.match(complaint.publicId, /^CIV-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
    assert.match(trackingCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(complaint.status, 'submitted');
    assert.equal(tracking.complaintId, complaint.publicId);
    assert.equal(processing, 'queued');
    assert.equal(urgentFlag, false);

    const row = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', complaint.publicId);
    assert.ok(row);
    assert.equal(row.tracking_hash, hashTrackingCode(trackingCode));
    assert.notEqual(row.tracking_hash, trackingCode);
    assert.equal(row.is_synthetic, 0);
    const history = ctx.db.all('SELECT * FROM status_history WHERE complaint_id = ?', row.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].to_status, 'submitted');
    const notification = ctx.db.get("SELECT * FROM notifications WHERE complaint_id = ? AND audience = 'admin'", row.id);
    assert.ok(notification);

    const processed = await waitForProcessing(ctx.db, row.id);
    assert.equal(processed.ai_status, 'fallback');
    assert.equal(processed.ai_source, 'heuristic');
    assert.equal(processed.ai_model, 'civicai-local-rules-v1');
    assert.equal(processed.ai_category, 'roads');
    assert.ok(processed.category_confidence > 0 && processed.category_confidence <= 1);
    assert.ok(processed.ai_summary.length > 10);
    assert.ok(processed.recommended_priority);
    assert.equal(processed.priority_source, 'rules');
    const factors = JSON.parse(processed.priority_factors);
    assert.ok(Array.isArray(factors.factors) && factors.factors.length >= 4);
    assert.ok(factors.factors.every((f) => f.label && f.reason));
    assert.match(processed.action_brief, /Automated brief/i);
    assert.match(processed.action_brief, /local transparent rules/i);
    assert.equal(processed.ai_error, null);

    const tracked = await api(ctx.base, 'POST', '/api/track', {
      body: { complaintId: complaint.publicId, trackingCode },
      ip: '10.20.0.2',
    });
    assert.equal(tracked.status, 200);
    assert.equal(tracked.json.trackingVerified, true);
    assert.equal(tracked.json.complaint.publicId, complaint.publicId);
    assert.equal(tracked.json.complaint.aiSource, 'heuristic');
    assert.ok(tracked.json.complaint.history.length >= 1);
    assert.equal(tracked.json.complaint.reporterName, undefined, 'tracking must not expose reporter details');

    created = complaint;
    createdCode = trackingCode;
    createdId = row.id;
  });

  test('an Idempotency-Key replays the original receipt instead of creating a duplicate', async () => {
    const overrides = {
      description: 'The streetlight outside house 8 has been dark for four nights and the lane is unsafe.',
      category: 'streetlights',
      address: '8 Night Lane, Riverside',
      area: 'Riverside',
      lat: '22.5811',
      lng: '88.3712',
    };
    const opts = { ip: '10.20.1.1', idempotencyKey: 'test-idem-1' };
    const first = await submitComplaint(ctx, overrides, opts);
    const second = await submitComplaint(ctx, overrides, opts);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.json.replayed, true);
    assert.equal(second.json.complaint.publicId, first.json.complaint.publicId);
    const rows = ctx.db.all('SELECT id FROM complaints WHERE public_id = ?', first.json.complaint.publicId);
    assert.equal(rows.length, 1);
    await waitForProcessing(ctx.db, rows[0].id);
  });

  test('rejects malformed submissions with field-level validation errors', async () => {
    const cases = [
      { body: { description: 'Too short', address: 'A' }, field: 'Description' },
      { body: { description: 'This description is long enough to pass validation.' }, field: 'address' },
      {
        body: { description: 'This description is long enough to pass validation.', address: 'A', category: 'aliens' },
        field: 'Category',
      },
      {
        body: { description: 'This description is long enough to pass validation.', address: 'A', lat: '22.5' },
        field: 'Latitude',
      },
      {
        body: { description: 'This description is long enough to pass validation.', address: 'A', lat: '999', lng: '88' },
        field: 'Latitude',
      },
      {
        body: { description: 'x'.repeat(2001), address: 'A' },
        field: 'Description',
      },
    ];
    for (const [index, item] of cases.entries()) {
      const res = await api(ctx.base, 'POST', '/api/complaints', {
        body: item.body,
        ip: `10.21.0.${index + 1}`,
      });
      assert.equal(res.status, 400, `${JSON.stringify(item.body)} -> ${res.text}`);
      assert.match(res.json.error, new RegExp(item.field, 'i'));
    }
  });

  test('every complaint receives a unique public identifier', async () => {
    const ids = new Set();
    for (let i = 0; i < 3; i += 1) {
      const res = await submitComplaint(ctx, {
        description: `Uniqueness check number ${i} for a broken footpath in the test district.`,
        address: `${i + 20} Unique Street, Riverside`,
        area: 'Riverside',
      }, { ip: `10.22.0.${i + 1}` });
      assert.equal(res.status, 201);
      ids.add(res.json.complaint.publicId);
      const row = ctx.db.get('SELECT id FROM complaints WHERE public_id = ?', res.json.complaint.publicId);
      await waitForProcessing(ctx.db, row.id);
    }
    assert.equal(ids.size, 3);
  });

  test('tracking requires the matching code while administrators can look up by ID', async () => {
    const wrong = await api(ctx.base, 'POST', '/api/track', {
      body: { complaintId: created.publicId, trackingCode: 'AAAA-BBBB-CCCC' },
      ip: '10.23.0.1',
    });
    assert.equal(wrong.status, 404);

    const missing = await api(ctx.base, 'POST', '/api/track', { body: { complaintId: created.publicId }, ip: '10.23.0.2' });
    assert.equal(missing.status, 400);

    const adminLookup = await api(ctx.base, 'POST', '/api/track', {
      body: { complaintId: created.publicId },
      cookie: adminCookie,
      ip: '10.23.0.3',
    });
    assert.equal(adminLookup.status, 200);
    assert.equal(adminLookup.json.trackingVerified, true);

    const own = await submitComplaint(ctx, {
      description: 'A signed-in citizen reports an overflowing public bin near the market gate.',
      category: 'waste',
      address: 'Market Gate, Riverside',
      area: 'Riverside',
      lat: '22.5850',
      lng: '88.3550',
    }, { cookie: citizenCookie, ip: '10.23.0.4' });
    assert.equal(own.status, 201);
    citizenComplaintPublicId = own.json.complaint.publicId;
    const ownRow = ctx.db.get('SELECT id, user_id FROM complaints WHERE public_id = ?', citizenComplaintPublicId);
    assert.equal(ownRow.user_id, ctx.citizen.id);
    await waitForProcessing(ctx.db, ownRow.id);

    const mine = await api(ctx.base, 'GET', '/api/my/complaints', { cookie: citizenCookie, ip: '10.23.0.5' });
    assert.equal(mine.status, 200);
    assert.ok(mine.json.complaints.some((c) => c.publicId === citizenComplaintPublicId));

    const mineDetail = await api(ctx.base, 'GET', `/api/my/complaints/${citizenComplaintPublicId}`, { cookie: citizenCookie });
    assert.equal(mineDetail.status, 200);
    assert.equal(mineDetail.json.complaint.publicId, citizenComplaintPublicId);

    const notMine = await api(ctx.base, 'GET', `/api/my/complaints/${citizenComplaintPublicId}`, { cookie: adminCookie });
    assert.equal(notMine.status, 200, 'admins may inspect any complaint');

    const anonymous = await api(ctx.base, 'GET', '/api/my/complaints');
    assert.equal(anonymous.status, 401);
  });
});

describe('image upload security and tracking', () => {
  test('rejects a disguised non-image upload', async () => {
    const res = await submitComplaint(ctx, {}, {
      ip: '10.24.0.1',
      image: { buffer: Buffer.from('this is not an image, just text pretending to be one'), type: 'image/png', name: 'fake.png' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'INVALID_IMAGE');
    assert.match(res.json.error, /not a valid JPG, PNG or WebP/i);
  });

  test('accepts a real PNG and protects the file behind the tracking code', async () => {
    const res = await submitComplaint(ctx, {
      description: 'A photo of the deep pothole near the school crossing was attached as evidence.',
      address: 'School Crossing, Riverside',
      area: 'Riverside',
      lat: '22.5750',
      lng: '88.3650',
    }, {
      ip: '10.24.0.2',
      image: { buffer: TINY_PNG, type: 'image/png', name: 'evidence.png' },
    });
    assert.equal(res.status, 201, res.text);
    const publicId = res.json.complaint.publicId;
    const code = res.json.trackingCode;
    assert.equal(res.json.complaint.imageAvailable, true);
    const row = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', publicId);
    assert.ok(row.image_path.endsWith('.png'));
    assert.equal(row.image_mime, 'image/png');
    const processed = await waitForProcessing(ctx.db, row.id);
    const analysis = JSON.parse(processed.image_analysis);
    assert.equal(analysis.available, false);
    assert.match(analysis.note, /not interpreted/i);

    const imageUrl = `${ctx.base}/api/complaints/public/${publicId}/image`;
    assert.equal((await fetch(imageUrl)).status, 403);
    assert.equal((await fetch(`${imageUrl}?code=AAAA-BBBB-CCCC`)).status, 403);
    const withCode = await fetch(`${imageUrl}?code=${encodeURIComponent(code)}`);
    assert.equal(withCode.status, 200);
    assert.match(withCode.headers.get('content-type') || '', /image\/png/);

    const adminRes = await fetch(`${ctx.base}/api/admin/complaints/${row.id}/image`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(adminRes.status, 200);
  });
});

describe('role-based access control', () => {
  test('admin endpoints reject anonymous and citizen callers but serve administrators', async () => {
    assert.equal((await api(ctx.base, 'GET', '/api/admin/stats')).status, 401);
    assert.equal((await api(ctx.base, 'GET', '/api/admin/stats', { cookie: citizenCookie })).status, 403);
    assert.equal((await api(ctx.base, 'GET', '/api/admin/settings', { cookie: citizenCookie })).status, 403);
    const stats = await api(ctx.base, 'GET', '/api/admin/stats', { cookie: adminCookie });
    assert.equal(stats.status, 200);
    assert.ok(stats.json.summary.total >= 1);
    assert.equal(stats.json.byCategory.length, 8);
    assert.equal(stats.json.timeline.length, 30);

    const users = await api(ctx.base, 'GET', '/api/auth/users', { cookie: adminCookie });
    assert.equal(users.status, 200);
    assert.ok(users.json.users.some((u) => u.role === 'admin'));
    assert.equal((await api(ctx.base, 'GET', '/api/auth/users', { cookie: citizenCookie })).status, 403);
  });
});

describe('duplicate detection is advisory until a human decides', () => {
  test('similar nearby reports create a pending candidate that can be merged and unmerged', async () => {
    const overrides = {
      description: 'Deep pothole outside 77 Duplicate Lane. It has been growing for a week and cars are swerving into traffic.',
      category: 'roads',
      address: '77 Duplicate Lane, Riverside',
      area: 'Riverside',
      lat: '22.5700',
      lng: '88.3600',
    };
    const first = await submitComplaint(ctx, overrides, { ip: '10.25.0.1' });
    assert.equal(first.status, 201);
    const firstRow = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', first.json.complaint.publicId);
    await waitForProcessing(ctx.db, firstRow.id);

    const second = await submitComplaint(ctx, overrides, { ip: '10.25.0.2' });
    assert.equal(second.status, 201);
    const secondRow = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', second.json.complaint.publicId);
    await waitForProcessing(ctx.db, secondRow.id);

    assert.equal(ctx.db.get('SELECT merged_into_id FROM complaints WHERE id = ?', firstRow.id).merged_into_id, null);
    assert.equal(ctx.db.get('SELECT merged_into_id FROM complaints WHERE id = ?', secondRow.id).merged_into_id, null);

    const queueRes = await api(ctx.base, 'GET', '/api/admin/duplicates?status=pending&pageSize=50', { cookie: adminCookie });
    assert.equal(queueRes.status, 200);
    const link = queueRes.json.links.find((l) => (
      (l.primary.publicId === firstRow.public_id && l.related.publicId === secondRow.public_id) ||
      (l.primary.publicId === secondRow.public_id && l.related.publicId === firstRow.public_id)
    ));
    assert.ok(link, 'expected a pending duplicate candidate for the identical reports');
    assert.ok(link.similarity >= 0.6);
    assert.ok(link.textSimilarity > 0.9);
    assert.ok(link.distanceM < 10);
    assert.ok(link.reasons.length >= 2);
    assert.match(link.method, /embedding/);
    assert.ok(queueRes.json.pendingTotal >= 1);

    const merge = await api(ctx.base, 'POST', `/api/admin/duplicates/${link.id}/review`, {
      cookie: adminCookie,
      body: { decision: 'merge', note: 'Confirmed: same pothole outside the same address.' },
    });
    assert.equal(merge.status, 200, merge.text);
    assert.equal(merge.json.decision, 'merge');
    const secondaryId = link.primary.id === firstRow.id ? secondRow.id : firstRow.id;
    const primaryId = link.primary.id === firstRow.id ? firstRow.id : secondRow.id;
    const merged = ctx.db.get('SELECT merged_into_id FROM complaints WHERE id = ?', secondaryId);
    assert.equal(merged.merged_into_id, primaryId);
    const note = ctx.db.get("SELECT * FROM notifications WHERE complaint_id = ? AND audience = 'citizen' AND kind = 'duplicate'", secondaryId);
    assert.ok(note);
    const detail = await api(ctx.base, 'GET', `/api/admin/complaints/${secondaryId}`, { cookie: adminCookie });
    assert.equal(detail.json.complaint.mergedInto.id, primaryId);

    const unmerge = await api(ctx.base, 'POST', `/api/admin/complaints/${secondaryId}/unmerge`, {
      cookie: adminCookie,
      body: { note: 'Different pothole after on-site inspection; track independently.' },
    });
    assert.equal(unmerge.status, 200, unmerge.text);
    assert.equal(unmerge.json.detail.complaint.mergedInto, null);
    assert.equal(ctx.db.get('SELECT merged_into_id FROM complaints WHERE id = ?', secondaryId).merged_into_id, null);
    assert.equal(ctx.db.get('SELECT status FROM duplicate_links WHERE id = ?', link.id).status, 'rejected');
  });

  test('rejecting a candidate requires a note and never merges records', async () => {
    const overrides = {
      description: 'Garbage is piling up behind block C and has not been collected for six days.',
      category: 'waste',
      address: 'Block C, Riverside',
      area: 'Riverside',
      lat: '22.5680',
      lng: '88.3520',
    };
    const a = await submitComplaint(ctx, overrides, { ip: '10.26.0.1' });
    const rowA = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', a.json.complaint.publicId);
    await waitForProcessing(ctx.db, rowA.id);
    const b = await submitComplaint(ctx, overrides, { ip: '10.26.0.2' });
    const rowB = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', b.json.complaint.publicId);
    await waitForProcessing(ctx.db, rowB.id);

    const queueRes = await api(ctx.base, 'GET', '/api/admin/duplicates?status=pending&pageSize=50', { cookie: adminCookie });
    const link = queueRes.json.links.find((l) => [l.primary.id, l.related.id].includes(rowA.id) && [l.primary.id, l.related.id].includes(rowB.id));
    assert.ok(link);

    const empty = await api(ctx.base, 'POST', `/api/admin/duplicates/${link.id}/review`, {
      cookie: adminCookie, body: { decision: 'reject' },
    });
    assert.equal(empty.status, 400);
    assert.match(empty.json.error, /why the reports are not duplicates/i);

    const rejected = await api(ctx.base, 'POST', `/api/admin/duplicates/${link.id}/review`, {
      cookie: adminCookie, body: { decision: 'reject', note: 'Two separate collection points after inspection.' },
    });
    assert.equal(rejected.status, 200);
    assert.equal(ctx.db.get('SELECT status FROM duplicate_links WHERE id = ?', link.id).status, 'rejected');
    assert.equal(ctx.db.get('SELECT merged_into_id FROM complaints WHERE id = ?', rowA.id).merged_into_id, null);
  });
});

describe('status workflow, assignment and audit trail', () => {
  test('enforces legal transitions, required resolution data and records history', async () => {
    const citizenAttempt = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: citizenCookie, body: { status: 'resolved', resolutionDetails: 'Not allowed to do this.' },
    });
    assert.equal(citizenAttempt.status, 403);

    const skip = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie, body: { status: 'resolved', resolutionDetails: 'Skipping steps should fail.' },
    });
    assert.equal(skip.status, 409);
    assert.ok(skip.json.details.allowed.includes('under_review'));

    const review = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie,
      body: { status: 'under_review', publicUpdate: 'Assessed by the roads team and queued for repair.' },
    });
    assert.equal(review.status, 200);
    assert.equal(review.json.detail.complaint.status, 'under_review');
    assert.equal(review.json.detail.complaint.history.at(-1).publicUpdate, 'Assessed by the roads team and queued for repair.');

    const assigned = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie, body: { status: 'assigned' },
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.json.detail.complaint.assignedTeam, 'Roads & Paving');
    assert.ok(assigned.json.detail.complaint.assignedAt);

    const progress = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie, body: { status: 'in_progress', publicUpdate: 'Repair crew is on site.' },
    });
    assert.equal(progress.status, 200);

    const noDetails = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie, body: { status: 'resolved' },
    });
    assert.equal(noDetails.status, 400);
    assert.match(noDetails.json.error, /Resolution details/i);

    const resolved = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie,
      body: { status: 'resolved', resolutionDetails: 'Pothole filled and the surrounding surface compacted.' },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.json.detail.complaint.status, 'resolved');
    assert.ok(resolved.json.detail.complaint.resolvedAt);
    const notification = ctx.db.get(
      "SELECT * FROM notifications WHERE complaint_id = ? AND audience = 'citizen' AND kind = 'status' ORDER BY id DESC",
      createdId
    );
    assert.ok(notification);

    const reopened = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie, body: { status: 'reopened', publicUpdate: 'Resident reports the repair failed after rain.' },
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.detail.complaint.resolvedAt, null);

    const invalidStatus = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/status`, {
      cookie: adminCookie, body: { status: 'deleted' },
    });
    assert.equal(invalidStatus.status, 400);
  });

  test('rejection requires an explanation', async () => {
    const res = await submitComplaint(ctx, {
      description: 'An abandoned vehicle has been blocking the service lane behind the market for nine days.',
      category: 'other',
      address: 'Service Lane, North Market',
      area: 'North Market',
      lat: '22.5905',
      lng: '88.3510',
    }, { ip: '10.27.0.1' });
    const row = ctx.db.get('SELECT id FROM complaints WHERE public_id = ?', res.json.complaint.publicId);
    await waitForProcessing(ctx.db, row.id);

    const none = await api(ctx.base, 'POST', `/api/admin/complaints/${row.id}/status`, {
      cookie: adminCookie, body: { status: 'rejected' },
    });
    assert.equal(none.status, 400);
    assert.match(none.json.error, /explanation is required/i);

    const tooShort = await api(ctx.base, 'POST', `/api/admin/complaints/${row.id}/status`, {
      cookie: adminCookie, body: { status: 'rejected', reason: 'Nope' },
    });
    assert.equal(tooShort.status, 400);

    const rejected = await api(ctx.base, 'POST', `/api/admin/complaints/${row.id}/status`, {
      cookie: adminCookie, body: { status: 'rejected', reason: 'Vehicle was removed by its owner before inspection.' },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json.detail.complaint.status, 'rejected');
  });

  test('assignment, comments and corrections are validated and audited', async () => {
    const noTeam = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/assign`, {
      cookie: adminCookie, body: { note: 'missing team' },
    });
    assert.equal(noTeam.status, 400);

    const assign = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/assign`, {
      cookie: adminCookie,
      body: { team: 'Roads & Paving', assignee: 'A. Rahman', note: 'Assigned during morning triage.' },
    });
    assert.equal(assign.status, 200);
    assert.equal(assign.json.detail.complaint.assignedTo, 'A. Rahman');
    assert.equal(assign.json.detail.complaint.status, 'assigned');

    const comment = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/comment`, {
      cookie: adminCookie,
      body: { publicUpdate: 'Crew scheduled for tomorrow morning.', internalNote: 'Check access before 9am.' },
    });
    assert.equal(comment.status, 200);
    const last = comment.json.detail.complaint.history.at(-1);
    assert.equal(last.publicUpdate, 'Crew scheduled for tomorrow morning.');
    assert.equal(last.internalNote, 'Check access before 9am.');

    const empty = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/comment`, {
      cookie: adminCookie, body: {},
    });
    assert.equal(empty.status, 400);

    const badCorrection = await api(ctx.base, 'PATCH', `/api/admin/complaints/${createdId}`, {
      cookie: adminCookie, body: {},
    });
    assert.equal(badCorrection.status, 400);

    const badCoords = await api(ctx.base, 'PATCH', `/api/admin/complaints/${createdId}`, {
      cookie: adminCookie, body: { lat: '22.5' },
    });
    assert.equal(badCoords.status, 400);

    const correction = await api(ctx.base, 'PATCH', `/api/admin/complaints/${createdId}`, {
      cookie: adminCookie,
      body: { category: 'drainage', summary: 'Admin-corrected summary: blocked drain affecting the carriageway.', area: 'Riverside Central' },
    });
    assert.equal(correction.status, 200);
    assert.equal(correction.json.detail.complaint.category, 'drainage');
    assert.equal(correction.json.detail.complaint.categorySource, 'admin');
    assert.equal(correction.json.detail.complaint.area, 'Riverside Central');
    assert.ok(ctx.db.get(
      "SELECT * FROM notifications WHERE complaint_id = ? AND audience = 'citizen' AND kind = 'category'",
      createdId
    ));
  });
});

describe('explainable priority overrides and re-analysis', () => {
  test('an administrator override requires a reason and survives re-analysis', async () => {
    const invalid = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/priority`, {
      cookie: adminCookie, body: { priority: 'urgent', reason: 'Some sufficiently long reason' },
    });
    assert.equal(invalid.status, 400);

    const short = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/priority`, {
      cookie: adminCookie, body: { priority: 'critical', reason: 'short' },
    });
    assert.equal(short.status, 400);
    assert.match(short.json.error, /at least 10/i);

    const override = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/priority`, {
      cookie: adminCookie, body: { priority: 'critical', reason: 'Verified flooding next to a school during site inspection.' },
    });
    assert.equal(override.status, 200);
    const complaint = override.json.detail.complaint;
    assert.equal(complaint.finalPriority, 'critical');
    assert.equal(complaint.priorityOverride.by, ADMIN.name);
    assert.match(complaint.priorityOverride.reason, /Verified flooding/i);

    const reanalyze = await api(ctx.base, 'POST', `/api/admin/complaints/${createdId}/reanalyze`, {
      cookie: adminCookie, body: {},
    });
    assert.equal(reanalyze.status, 200, reanalyze.text);
    assert.equal(reanalyze.json.result.aiStatus, 'fallback');
    assert.equal(reanalyze.json.result.source, 'heuristic');
    assert.equal(reanalyze.json.detail.complaint.finalPriority, 'critical');
    assert.equal(reanalyze.json.detail.complaint.categorySource, 'admin', 're-analysis must not erase admin provenance');
    assert.ok(reanalyze.json.detail.complaint.priorityFactors.factors.length >= 4);
  });
});

describe('dashboard queries, hotspots, analytics and exports', () => {
  test('list filters, search, sorting and pagination are applied server-side', async () => {
    const roads = await api(ctx.base, 'GET', '/api/admin/complaints?category=roads&pageSize=5&page=1', { cookie: adminCookie });
    assert.equal(roads.status, 200);
    assert.equal(roads.json.filters.category, 'roads');
    assert.ok(roads.json.complaints.every((c) => c.category === 'roads'));
    assert.ok(roads.json.complaints.length <= 5);
    assert.ok(roads.json.total >= roads.json.complaints.length);

    const search = await api(ctx.base, 'GET', `/api/admin/complaints?q=${encodeURIComponent(created.publicId)}`, { cookie: adminCookie });
    assert.equal(search.status, 200);
    assert.equal(search.json.total, 1);
    assert.equal(search.json.complaints[0].publicId, created.publicId);
    assert.ok(search.json.complaints[0].lat != null && search.json.complaints[0].lng != null);

    const assigned = await api(ctx.base, 'GET', '/api/admin/complaints?status=assigned&pageSize=100', { cookie: adminCookie });
    assert.ok(assigned.json.complaints.every((c) => c.status === 'assigned'));

    const capped = await api(ctx.base, 'GET', '/api/admin/complaints?pageSize=1000', { cookie: adminCookie });
    assert.equal(capped.json.pageSize, 100);

    const byPriority = await api(ctx.base, 'GET', '/api/admin/complaints?sort=priority&pageSize=100', { cookie: adminCookie });
    assert.equal(byPriority.status, 200);
    assert.equal(byPriority.json.complaints[0].priority, 'critical');

    const filtered = await api(ctx.base, 'GET', '/api/admin/complaints?category=aliens', { cookie: adminCookie });
    assert.equal(filtered.json.filters.category, null, 'invalid filters are ignored rather than trusted');
  });

  test('hotspots are recomputed from stored coordinates and labelled as patterns', async () => {
    const base = { lat: 22.5500, lng: 88.3400, area: 'Hotspot Test', status: 'assigned' };
    const fixtures = [
      insertComplaint(ctx.db, { ...base, category: 'roads', recommendedPriority: 'high' }),
      insertComplaint(ctx.db, { ...base, lat: 22.5505, lng: 88.3404, category: 'drainage' }),
      insertComplaint(ctx.db, { ...base, lat: 22.5496, lng: 88.3397, category: 'roads' }),
      insertComplaint(ctx.db, { ...base, lat: 22.5502, lng: 88.3401, category: 'roads' }),
    ];
    const res = await api(ctx.base, 'POST', '/api/admin/hotspots/recompute', { cookie: adminCookie, body: {} });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.hotspots.length >= 1);
    const cluster = res.json.hotspots.find((h) => h.publicIds.includes(fixtures[0].public_id));
    assert.ok(cluster);
    assert.ok(cluster.count >= 3);
    assert.ok(cluster.radiusM >= 0 && cluster.radiusM < 600);
    assert.ok(cluster.center.lat && cluster.center.lng);
    assert.ok(cluster.categories.some((c) => c.key === 'roads'));
    assert.match(cluster.insight, /not proof of a shared root cause/i);
    assert.ok(cluster.suggestedAction.length > 20);
    assert.match(cluster.source, /DBSCAN/i);

    const publicHotspots = await api(ctx.base, 'GET', '/api/public/hotspots');
    assert.equal(publicHotspots.status, 200);
    assert.ok(publicHotspots.json.hotspots.length >= 1);
    assert.match(publicHotspots.json.note, /does not prove a common cause/i);
  });

  test('analytics figures come from stored records at request time', async () => {
    const res = await api(ctx.base, 'GET', '/api/admin/analytics', { cookie: adminCookie });
    assert.equal(res.status, 200);
    const total = ctx.db.get('SELECT COUNT(*) n FROM complaints').n;
    assert.equal(res.json.stats.summary.total, total);
    assert.equal(res.json.stats.timeline.length, 30);
    assert.ok(res.json.report.mostCommonCategory);
    assert.ok(res.json.report.unresolvedTotal >= 0);
    assert.equal(res.json.report.resolutionRate, res.json.stats.summary.resolutionRate);
    assert.match(res.json.report.note, /computed from stored complaint records/i);
  });

  test('audit and notification feeds expose reviewable activity without secrets', async () => {
    const audit = await api(ctx.base, 'GET', '/api/admin/audit?pageSize=100', { cookie: adminCookie });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.total > 0);
    assert.ok(audit.json.entries.some((e) => e.action === 'complaint.status_changed'));
    assert.ok(audit.json.actions.length > 0);
    assert.ok(audit.json.entries.every((e) => !Object.prototype.hasOwnProperty.call(e.details || {}, 'password')));

    const notifications = await api(ctx.base, 'GET', '/api/admin/notifications', { cookie: adminCookie });
    assert.equal(notifications.status, 200);
    assert.ok(Array.isArray(notifications.json.notifications));
    assert.equal(typeof notifications.json.pendingDuplicates, 'number');
  });

  test('CSV export is protected, quoted and resistant to formula injection', async () => {
    assert.equal((await api(ctx.base, 'GET', '/api/admin/export.csv')).status, 401);
    assert.equal((await api(ctx.base, 'GET', '/api/admin/export.csv', { cookie: citizenCookie })).status, 403);

    const res = await api(ctx.base, 'GET', `/api/admin/export.csv?q=${encodeURIComponent(created.publicId)}`, { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/csv/);
    const rawExport = await fetch(`${ctx.base}/api/admin/export.csv?q=${encodeURIComponent(created.publicId)}`, {
      headers: { cookie: adminCookie },
    });
    const bytes = Buffer.from(await rawExport.arrayBuffer());
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf', 'Excel-friendly UTF-8 BOM');
    const csvText = bytes.toString('utf8');
    assert.match(csvText, /complaint_id,category,area,address/);
    assert.ok(csvText.includes(created.publicId));
    assert.match(csvText, /"yes"|"no"/);

    const injected = await submitComplaint(ctx, {
      description: 'A test report with a spreadsheet formula in the address field.',
      category: 'other',
      address: '=HYPERLINK("http://evil.example","click")',
      area: 'Export Test',
    }, { ip: '10.28.0.1' });
    assert.equal(injected.status, 201);
    const injectedRow = ctx.db.get('SELECT id FROM complaints WHERE public_id = ?', injected.json.complaint.publicId);
    await waitForProcessing(ctx.db, injectedRow.id);
    const csv = await api(ctx.base, 'GET', `/api/admin/export.csv?q=${encodeURIComponent(injected.json.complaint.publicId)}`, { cookie: adminCookie });
    assert.ok(csv.text.includes(`"'=HYPERLINK`), 'leading formula characters must be neutralised');
  });

  test('settings are validated atomically and applied immediately', async () => {
    const before = await api(ctx.base, 'GET', '/api/admin/settings', { cookie: adminCookie });
    const originalThreshold = before.json.settings.duplicateThreshold;
    const originalCity = before.json.settings.cityName;
    assert.equal(before.json.ai.mode, 'local-fallback');

    const badThreshold = await api(ctx.base, 'PATCH', '/api/admin/settings', {
      cookie: adminCookie, body: { duplicateThreshold: 0.2 },
    });
    assert.equal(badThreshold.status, 400);
    const unchanged = await api(ctx.base, 'GET', '/api/admin/settings', { cookie: adminCookie });
    assert.equal(unchanged.json.settings.duplicateThreshold, originalThreshold, 'invalid settings must not persist');

    assert.equal((await api(ctx.base, 'PATCH', '/api/admin/settings', {
      cookie: adminCookie, body: { maxImageMB: 30 },
    })).status, 400);
    assert.equal((await api(ctx.base, 'PATCH', '/api/admin/settings', {
      cookie: adminCookie, body: { hotspotMinPoints: 1 },
    })).status, 400);
    assert.equal((await api(ctx.base, 'PATCH', '/api/admin/settings', {
      cookie: adminCookie, body: { notASetting: true },
    })).status, 400);

    const updated = await api(ctx.base, 'PATCH', '/api/admin/settings', {
      cookie: adminCookie, body: { duplicateThreshold: 0.55, cityName: 'Testville' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.settings.duplicateThreshold, 0.55);
    assert.equal(updated.json.settings.cityName, 'Testville');
    const meta = await api(ctx.base, 'GET', '/api/meta');
    assert.equal(meta.json.cityName, 'Testville');

    const restored = await api(ctx.base, 'PATCH', '/api/admin/settings', {
      cookie: adminCookie, body: { duplicateThreshold: originalThreshold, cityName: originalCity },
    });
    assert.equal(restored.status, 200);
  });
});

describe('authentication, sessions and request hardening', () => {
  test('signup validates credentials and prevents duplicate accounts', async () => {
    const email = `new.citizen.${Date.now()}@example.com`;
    const weak = await api(ctx.base, 'POST', '/api/auth/signup', {
      body: { name: 'New Citizen', email: `weak.${Date.now()}@example.com`, password: 'short' },
      ip: '10.29.0.1',
    });
    assert.equal(weak.status, 400);
    assert.match(weak.json.error, /8/);

    const noDigit = await api(ctx.base, 'POST', '/api/auth/signup', {
      body: { name: 'New Citizen', email: `nodigit.${Date.now()}@example.com`, password: 'onlyletters' },
      ip: '10.29.0.2',
    });
    assert.equal(noDigit.status, 400);
    assert.match(noDigit.json.error, /letter and.*number/i);

    const badEmail = await api(ctx.base, 'POST', '/api/auth/signup', {
      body: { name: 'New Citizen', email: 'not-an-email', password: 'StrongPass9' },
      ip: '10.29.0.3',
    });
    assert.equal(badEmail.status, 400);

    const created1 = await api(ctx.base, 'POST', '/api/auth/signup', {
      body: { name: 'New Citizen', email, password: 'StrongPass9' },
      ip: '10.29.0.4',
    });
    assert.equal(created1.status, 201, created1.text);
    assert.equal(created1.json.user.role, 'citizen');
    const signupCookie = created1.headers.getSetCookie().find((c) => c.startsWith('civicai_session='))?.split(';')[0];
    assert.ok(signupCookie);
    const me = await api(ctx.base, 'GET', '/api/auth/me', { cookie: signupCookie });
    assert.equal(me.json.user.email, email);

    const duplicate = await api(ctx.base, 'POST', '/api/auth/signup', {
      body: { name: 'New Citizen', email, password: 'StrongPass9' },
      ip: '10.29.0.5',
    });
    assert.equal(duplicate.status, 409);

    const cannotSeeOther = await api(ctx.base, 'GET', `/api/my/complaints/${citizenComplaintPublicId}`, { cookie: signupCookie });
    assert.equal(cannotSeeOther.status, 404);
    const owner = await api(ctx.base, 'GET', `/api/my/complaints/${citizenComplaintPublicId}`, { cookie: citizenCookie });
    assert.equal(owner.status, 200);

    const changeWrong = await api(ctx.base, 'POST', '/api/auth/password', {
      cookie: signupCookie, body: { currentPassword: 'wrong', newPassword: 'AnotherPass9' },
      ip: '10.29.0.6',
    });
    assert.equal(changeWrong.status, 400);
    const changed = await api(ctx.base, 'POST', '/api/auth/password', {
      cookie: signupCookie, body: { currentPassword: 'StrongPass9', newPassword: 'AnotherPass9' },
      ip: '10.29.0.7',
    });
    assert.equal(changed.status, 200);
    assert.equal((await api(ctx.base, 'POST', '/api/auth/login', {
      body: { email, password: 'StrongPass9' }, ip: '10.29.0.8',
    })).status, 401);
    assert.equal((await api(ctx.base, 'POST', '/api/auth/login', {
      body: { email, password: 'AnotherPass9' }, ip: '10.29.0.9',
    })).status, 200);
  });

  test('login does not reveal whether an account exists and logout destroys the session', async () => {
    const wrong = await api(ctx.base, 'POST', '/api/auth/login', {
      body: { email: CITIZEN.email, password: 'WrongPassword1' }, ip: '10.30.0.1',
    });
    const unknown = await api(ctx.base, 'POST', '/api/auth/login', {
      body: { email: 'nobody@test.local', password: 'WrongPassword1' }, ip: '10.30.0.2',
    });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error, unknown.json.error);

    const session = await login(ctx.base, CITIZEN.email, CITIZEN.password, { ip: '10.30.0.3' });
    assert.equal((await api(ctx.base, 'GET', '/api/auth/me', { cookie: session.cookie })).json.user.email, CITIZEN.email);
    const logout = await api(ctx.base, 'POST', '/api/auth/logout', { cookie: session.cookie, ip: '10.30.0.4' });
    assert.equal(logout.status, 200);
    assert.equal((await api(ctx.base, 'GET', '/api/auth/me', { cookie: session.cookie })).json.user, null);
  });

  test('demo officer access creates a real, audited administrator session', async () => {
    const res = await api(ctx.base, 'POST', '/api/auth/demo-officer', { ip: '10.30.0.5' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, 'admin');
    assert.equal(res.json.demo, true);

    const cookie = res.headers.getSetCookie()
      .find((value) => value.startsWith('civicai_session='))
      ?.split(';')[0];
    assert.ok(cookie, 'demo access must set a session cookie');
    assert.equal((await api(ctx.base, 'GET', '/api/admin/stats', { cookie })).status, 200);

    const audit = ctx.db.get("SELECT * FROM audit_logs WHERE action = 'auth.demo_officer'");
    assert.ok(audit, 'demo access is recorded in the audit log');
  });

  test('cross-origin writes, malformed JSON and unknown routes are rejected safely', async () => {
    const crossOrigin = await api(ctx.base, 'POST', '/api/complaints', {
      body: { description: 'A valid description that would otherwise pass validation.' },
      headers: { origin: 'https://evil.example' },
      ip: '10.31.0.1',
    });
    assert.equal(crossOrigin.status, 403);
    assert.match(crossOrigin.json.error, /Cross-origin/i);

    const malformed = await api(ctx.base, 'POST', '/api/auth/login', {
      raw: '{"email":', headers: { 'content-type': 'application/json' }, ip: '10.31.0.2',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.code, 'BAD_JSON');

    assert.equal((await api(ctx.base, 'GET', '/api/does-not-exist')).status, 404);
  });

  test('submission rate limiting returns 429 with retry headers', async () => {
    const ip = '10.32.0.1';
    let last;
    for (let i = 0; i < 13; i += 1) {
      last = await api(ctx.base, 'POST', '/api/complaints', { body: {}, ip });
    }
    assert.equal(last.status, 429);
    assert.equal(last.headers.get('x-ratelimit-limit'), '12');
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  });
});
