import './env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startApp, stopApp, cleanupUploads, login, api, submitComplaint, waitForProcessing, ADMIN } from './helpers.js';

let dir;
let dbPath;
let ctx;
let adminCookie;
let saved;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civicai-persistence-'));
  dbPath = path.join(dir, 'civicai.db');
  ctx = await startApp({ dbPath });
});

after(async () => {
  await stopApp(ctx);
  cleanupUploads();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SQLite persistence', () => {
  test('writes a complaint, workflow history and session to a real database file', async () => {
    const res = await submitComplaint(ctx, {
      description: 'A burst water pipe has been flooding the service road next to the clinic for two days.',
      category: 'water',
      address: 'Clinic Service Road, East Depot',
      area: 'East Depot',
      lat: '22.5800',
      lng: '88.3900',
    }, { ip: '10.40.0.1' });
    assert.equal(res.status, 201);
    const row = ctx.db.get('SELECT * FROM complaints WHERE public_id = ?', res.json.complaint.publicId);
    const processed = await waitForProcessing(ctx.db, row.id);
    assert.equal(processed.ai_status, 'fallback');
    assert.ok(processed.recommended_priority);

    adminCookie = (await login(ctx.base, ADMIN.email, ADMIN.password, { ip: '10.40.0.2' })).cookie;
    const reviewed = await api(ctx.base, 'POST', `/api/admin/complaints/${row.id}/status`, {
      cookie: adminCookie,
      body: { status: 'under_review', publicUpdate: 'Water utility asked to isolate the burst.' },
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.json.detail.complaint.status, 'under_review');

    saved = {
      id: row.id,
      publicId: res.json.complaint.publicId,
      code: res.json.trackingCode,
      summary: processed.ai_summary,
      priority: processed.recommended_priority,
    };
    assert.ok(fs.existsSync(dbPath));
  });

  test('data survives closing and reopening the database', async () => {
    await stopApp(ctx);
    ctx = await startApp({ dbPath });

    const row = ctx.db.get('SELECT * FROM complaints WHERE id = ?', saved.id);
    assert.ok(row, 'complaint row must survive restart');
    assert.equal(row.public_id, saved.publicId);
    assert.equal(row.ai_summary, saved.summary);
    assert.equal(row.recommended_priority, saved.priority);
    assert.equal(row.status, 'under_review');
    assert.equal(row.is_synthetic, 0);

    const history = ctx.db.all('SELECT * FROM status_history WHERE complaint_id = ? ORDER BY id', saved.id);
    assert.deepEqual(history.map((h) => h.to_status), ['submitted', 'under_review']);
    assert.equal(history[1].public_update, 'Water utility asked to isolate the burst.');

    const tracked = await api(ctx.base, 'POST', '/api/track', {
      body: { complaintId: saved.publicId, trackingCode: saved.code },
      ip: '10.41.0.1',
    });
    assert.equal(tracked.status, 200);
    assert.equal(tracked.json.complaint.status, 'under_review');
    assert.ok(tracked.json.complaint.history.some((h) => h.to === 'under_review'));

    // Sessions are persisted server-side, so the pre-restart cookie still works.
    const me = await api(ctx.base, 'GET', '/api/auth/me', { cookie: adminCookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, ADMIN.email);

    // Uniqueness and autoincrement continue after reopen.
    const second = await submitComplaint(ctx, {
      description: 'A second report after restart confirms that identifiers continue to be unique.',
      category: 'other',
      address: 'After Restart Road',
      area: 'East Depot',
    }, { ip: '10.41.0.2' });
    assert.equal(second.status, 201);
    assert.notEqual(second.json.complaint.publicId, saved.publicId);
    const secondRow = ctx.db.get('SELECT id FROM complaints WHERE public_id = ?', second.json.complaint.publicId);
    assert.ok(secondRow.id > saved.id);
    await waitForProcessing(ctx.db, secondRow.id);
    assert.equal(ctx.db.get('SELECT COUNT(*) n FROM complaints').n, 2);
  });
});
