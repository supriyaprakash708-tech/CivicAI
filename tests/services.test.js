import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { analyzeHeuristic } from '../server/services/ai/heuristic.js';
import { findDuplicateCandidates } from '../server/services/duplicates.js';
import { computeHotspots } from '../server/services/hotspots.js';
import { processComplaint } from '../server/services/pipeline.js';
import { hasImminentHazard, scorePriority } from '../server/services/priority.js';

function withDatabase(run) {
  const db = openDatabase(':memory:');
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function addComplaint(db, {
  publicId,
  description,
  category = 'roads',
  address = 'Main Road',
  area = 'Riverside',
  lat = 22.5726,
  lng = 88.3639,
  categorySource = 'citizen',
  createdAt = new Date().toISOString(),
} = {}) {
  const result = db.run(
    `INSERT INTO complaints
      (public_id, description, category, category_source, address, area, lat, lng, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    publicId,
    description,
    category,
    categorySource,
    address,
    area,
    lat,
    lng,
    createdAt,
    createdAt
  );
  return Number(result.lastInsertRowid);
}

test('local analysis categorizes and summarizes reports without claiming a language model', () => {
  const result = analyzeHeuristic({
    description: 'The streetlight outside the bus stop has been dark for three nights.',
    address: 'Oak Street bus stop',
  });

  assert.equal(result.source, 'heuristic');
  assert.equal(result.category, 'streetlights');
  assert.match(result.summary, /streetlight/i);
  assert.equal(result.priority, null);
});

test('explicit immediate hazards receive a critical recommendation and human-review flag', () => {
  const description = 'An open manhole is beside the school entrance where children walk.';
  const priority = scorePriority({ description, category: 'safety' });

  assert.equal(hasImminentHazard(description), true);
  assert.equal(priority.priority, 'critical');
  assert.equal(priority.reviewRequired, true);
  assert.ok(priority.factors.some((factor) => factor.key === 'safety' && factor.points > 0));
  assert.match(priority.explanation, /human verification/i);
});

test('duplicate detection returns explainable candidates without merging reports', () => withDatabase((db) => {
  addComplaint(db, {
    publicId: 'CIV-2026-000001',
    description: 'A deep pothole on Main Road near Riverside school makes bikes swerve.',
  });
  const newId = addComplaint(db, {
    publicId: 'CIV-2026-000002',
    description: 'Deep road pothole outside Riverside school on Main Road causes cyclists to swerve.',
  });

  const complaint = db.get('SELECT * FROM complaints WHERE id = ?', newId);
  const candidates = findDuplicateCandidates(db, complaint, { duplicateThreshold: 0.5 });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].publicId, 'CIV-2026-000001');
  assert.ok(candidates[0].reasons.length > 0);
  assert.match(candidates[0].recommendation, /Human review required/);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM duplicate_links').n, 0);
  assert.equal(db.get('SELECT merged_into_id FROM complaints WHERE id = ?', newId).merged_into_id, null);
}));

test('hotspot detection groups nearby reports and labels patterns as unverified', () => withDatabase((db) => {
  const reports = [
    { publicId: 'CIV-2026-000011', category: 'drainage', lat: 22.5726, lng: 88.3639 },
    { publicId: 'CIV-2026-000012', category: 'roads', lat: 22.5727, lng: 88.3640 },
    { publicId: 'CIV-2026-000013', category: 'drainage', lat: 22.5725, lng: 88.3641 },
  ];
  for (const [index, report] of reports.entries()) {
    addComplaint(db, {
      ...report,
      description: 'A civic issue has been reported at this location.',
      createdAt: new Date(Date.now() + index * 1000).toISOString(),
    });
  }

  const result = computeHotspots(db, { hotspotRadiusM: 100, hotspotMinPoints: 3 });

  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0].count, 3);
  assert.match(result.clusters[0].insight, /not proof of a shared root cause/i);
  assert.match(result.clusters[0].suggestedAction, /Coordinate drainage and road-surface inspection/);
}));

test('report processing persists a transparent fallback and priority recommendation', async () => {
  const db = openDatabase(':memory:');
  try {
    const id = addComplaint(db, {
      publicId: 'CIV-2026-000021',
      description: 'An open manhole is near a school where children walk every morning.',
      category: 'other',
      categorySource: 'ai',
      address: 'Riverside Primary School',
    });

    const result = await processComplaint(db, id, { recomputeClusters: false });
    const stored = db.get('SELECT * FROM complaints WHERE id = ?', id);

    assert.equal(result.aiStatus, 'fallback');
    assert.equal(result.category, 'safety');
    assert.equal(result.priority, 'critical');
    assert.equal(stored.ai_source, 'heuristic');
    assert.equal(stored.ai_status, 'fallback');
    assert.equal(stored.final_priority, 'critical');
    assert.match(stored.action_brief, /Automated brief/i);
  } finally {
    db.close();
  }
});
