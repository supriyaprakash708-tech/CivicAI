import './env.js';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../server/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civicai-seed-'));
const dbFile = path.join(dir, 'seed.db');
const uploadDir = path.join(dir, 'uploads');

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runSeed() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_PATH: dbFile,
      UPLOAD_DIR: uploadDir,
      AI_API_KEY: '',
      AI_ENABLED: 'true',
      TRACKING_SECRET: 'civicai-seed-test-tracking',
      SESSION_SECRET: 'civicai-seed-test-session',
      ADMIN_EMAIL: 'seed-admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123',
      ADMIN_NAME: 'Seed Administrator',
    },
  });
  assert.equal(result.status, 0, `seed failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

describe('synthetic demo generator', () => {
  test('creates 30-50 labelled records with duplicates, hotspots and workflow history', () => {
    const run = runSeed();
    assert.match(run.stdout, /Processing \d+ complaints/i);

    const db = openDatabase(dbFile);
    try {
      const total = db.get('SELECT COUNT(*) n FROM complaints').n;
      assert.ok(total >= 30 && total <= 50, `expected 30-50 synthetic complaints, got ${total}`);
      assert.equal(db.get('SELECT COUNT(*) n FROM complaints WHERE is_synthetic = 0').n, 0);
      assert.equal(db.get('SELECT COUNT(DISTINCT public_id) n FROM complaints').n, total);

      const statuses = db.all('SELECT status, COUNT(*) n FROM complaints GROUP BY status');
      const statusNames = statuses.map((s) => s.status);
      for (const expected of ['submitted', 'under_review', 'assigned', 'in_progress', 'resolved', 'rejected']) {
        assert.ok(statusNames.includes(expected), `seed should include ${expected} complaints`);
      }
      assert.ok(statuses.length >= 6);

      const fallback = db.get("SELECT COUNT(*) n FROM complaints WHERE ai_status = 'fallback' AND ai_source = 'heuristic'").n;
      assert.equal(fallback, total, 'all demo complaints must be processed by the labelled local fallback');
      assert.equal(db.get("SELECT COUNT(*) n FROM complaints WHERE priority_factors IS NULL").n, 0);
      assert.equal(db.get("SELECT COUNT(*) n FROM complaints WHERE action_brief IS NULL").n, 0);
      assert.equal(db.get("SELECT COUNT(*) n FROM complaints WHERE length(tracking_hash) <> 64").n, 0);
      assert.equal(db.get("SELECT COUNT(*) n FROM complaints WHERE public_id NOT LIKE 'CIV-%'").n, 0);

      const pending = db.get("SELECT COUNT(*) n FROM duplicate_links WHERE status = 'pending'").n;
      assert.ok(pending >= 3, `expected duplicate candidates from the seeded clusters, got ${pending}`);
      assert.ok(db.get("SELECT COUNT(*) n FROM duplicate_links WHERE status = 'confirmed'").n >= 1);

      const hotspots = db.get('SELECT COUNT(*) n FROM hotspots').n;
      assert.ok(hotspots >= 3, `expected several hotspot clusters, got ${hotspots}`);
      const largest = db.get('SELECT MAX(complaint_count) n FROM hotspots').n;
      assert.ok(largest >= 3);

      const history = db.get('SELECT COUNT(*) n FROM status_history').n;
      assert.ok(history > total, 'workflow history should contain more than one event per complaint on average');
      const resolution = db.get("SELECT resolution_details FROM complaints WHERE status = 'resolved' LIMIT 1");
      assert.ok(resolution.resolution_details.length >= 10);

      assert.ok(db.get("SELECT COUNT(*) n FROM users WHERE role = 'admin'").n >= 1);
      assert.ok(db.get("SELECT COUNT(*) n FROM users WHERE email = 'citizen@civicai.local' AND role = 'citizen'").n === 1);
    } finally {
      db.close();
    }
  });

  test('re-running replaces only synthetic records instead of duplicating them', () => {
    runSeed();
    const db = openDatabase(dbFile);
    try {
      const total = db.get('SELECT COUNT(*) n FROM complaints').n;
      assert.ok(total >= 30 && total <= 50);
      assert.equal(db.get('SELECT COUNT(*) n FROM complaints WHERE is_synthetic = 0').n, 0);
      assert.equal(db.get('SELECT COUNT(DISTINCT public_id) n FROM complaints').n, total);
    } finally {
      db.close();
    }
  });
});
