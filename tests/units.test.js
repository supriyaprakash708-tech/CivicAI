import './env.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  newPublicId, newTrackingCode, hashTrackingCode,
} from '../server/util.js';
import { hashPassword, verifyPassword } from '../server/auth.js';
import { sniffImage } from '../server/routes/complaints.js';
import {
  embed, cosine, textSimilarity, addressSimilarity, distanceMeters, tokenSet,
} from '../server/services/embeddings.js';
import {
  scorePriority, hasImminentHazard, combineWithAi,
} from '../server/services/priority.js';
import {
  heuristicCategory, extractiveSummary, analyzeHeuristic,
} from '../server/services/ai/heuristic.js';
import { dbscan, summarizeCluster } from '../server/services/hotspots.js';
import { TINY_PNG } from './helpers.js';

const ALPHABET = /^[A-HJ-NP-Z2-9]+$/;

describe('identifiers and tracking secrets', () => {
  test('public IDs and tracking codes use the unambiguous format', () => {
    for (let i = 0; i < 30; i += 1) {
      const id = newPublicId();
      assert.match(id, /^CIV-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
      assert.ok(ALPHABET.test(id.split('-')[2]));
    }
    const code = newTrackingCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  test('tracking codes are hashed case-insensitively and never stored in plain text', () => {
    const code = 'ABCD-EFGH-JKLM';
    const lower = 'abcd-efgh-jklm';
    assert.equal(hashTrackingCode(code), hashTrackingCode(lower));
    assert.notEqual(hashTrackingCode(code), code);
    assert.match(hashTrackingCode(code), /^[a-f0-9]{64}$/);
    assert.notEqual(hashTrackingCode(code, 'one-secret'), hashTrackingCode(code, 'other-secret'));
  });
});

describe('password hashing', () => {
  test('scrypt hashes verify only the correct password', () => {
    const hash = hashPassword('CorrectHorse9');
    assert.match(hash, /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    assert.equal(verifyPassword('CorrectHorse9', hash), true);
    assert.equal(verifyPassword('wrong-password', hash), false);
    assert.equal(verifyPassword('CorrectHorse9', 'not-a-hash'), false);
    assert.notEqual(hashPassword('CorrectHorse9'), hash, 'salt must make hashes unique');
  });
});

describe('image sniffing', () => {
  test('recognises JPEG, PNG and WebP by magic bytes', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    assert.equal(sniffImage(jpeg).mime, 'image/jpeg');
    assert.equal(sniffImage(TINY_PNG).mime, 'image/png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);
    assert.equal(sniffImage(webp).mime, 'image/webp');
  });

  test('rejects text, SVG and short buffers', () => {
    assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(sniffImage(Buffer.from('hello world')), null);
    assert.equal(sniffImage(Buffer.from([0xff, 0xd8])), null);
    assert.equal(sniffImage(null), null);
  });
});

describe('text similarity helpers', () => {
  test('identical text is maximally similar and paraphrases beat unrelated text', () => {
    const a = 'Large pothole on the main road near the school, getting bigger for five days.';
    const b = 'There is a big pothole on the main road close to the school since five days ago.';
    const c = 'Streetlights are not working and the lane is dark at night.';
    assert.ok(textSimilarity(a, a) > 0.99);
    assert.ok(textSimilarity(a, b) > textSimilarity(a, c));
    assert.ok(cosine(embed(a), embed(a)) > 0.99);
  });

  test('address similarity and haversine distance are measured from data', () => {
    assert.equal(addressSimilarity('12 Main Road, Riverside', '12 main road riverside'), 1);
    assert.equal(addressSimilarity('', ''), 0);
    assert.ok(addressSimilarity('12 Main Road', 'Main Road, Riverside') > 0);
    const d = distanceMeters(22.5726, 88.3639, 22.5736, 88.3639);
    assert.ok(d > 90 && d < 130, `expected about 111 m, got ${d}`);
    assert.equal(distanceMeters(null, 88, 22, 88), null);
    assert.equal(tokenSet('The pothole is broken').has('pothole'), true);
  });
});

describe('explainable priority engine', () => {
  test('a cosmetic report scores low without inventing severity', () => {
    const result = scorePriority({ description: 'A small patch of paint is peeling from a bench.', category: 'infrastructure' });
    assert.equal(result.priority, 'low');
    assert.ok(result.score < 30);
    assert.equal(result.reviewRequired, false);
    const category = result.factors.find((f) => f.key === 'category');
    assert.ok(category && category.points > 0);
    assert.ok(result.factors.every((f) => typeof f.reason === 'string' && f.reason.length > 0));
  });

  test('imminent hazards force a critical floor and a human review flag', () => {
    const text = 'A live electrical wire has fallen across the road near the school and children are walking past it.';
    assert.equal(hasImminentHazard(text), true);
    const result = scorePriority({ description: text, category: 'safety' });
    assert.equal(result.priority, 'critical');
    assert.ok(result.score >= 75);
    assert.ok(result.scoreBeforeFloor < result.score);
    assert.equal(result.reviewRequired, true);
    assert.ok(result.hazards.length >= 1);
    assert.match(result.explanation, /critical floor/i);
    assert.match(result.explanation, /not a verified classification/i);
  });

  test('duration, evidence and repetition are separately attributable', () => {
    const result = scorePriority({
      description: 'The drain has been blocked for 3 weeks and there is a bad smell.',
      category: 'drainage',
      hasImage: true,
      duplicateCount: 2,
    });
    assert.equal(result.factors.find((f) => f.key === 'duration').points, 10);
    assert.equal(result.factors.find((f) => f.key === 'evidence').points, 2);
    assert.equal(result.factors.find((f) => f.key === 'repetition').points, 8);
    assert.match(result.factors.find((f) => f.key === 'repetition').reason, /does not prove/i);
  });

  test('AI suggestions can only raise a priority and remain labelled', () => {
    const rule = scorePriority({ description: 'A minor paint mark on a wall.', category: 'other' });
    const combined = combineWithAi(rule, { priority: 'high', priorityReason: 'Possible structural issue' });
    assert.equal(combined.priority, 'high');
    assert.equal(combined.source, 'rules+ai');
    assert.match(combined.explanation, /AI analysis suggested high/i);
    const lower = combineWithAi(rule, { priority: 'low' });
    assert.equal(lower.priority, rule.priority);
  });
});

describe('local AI fallback', () => {
  test('classifies common civic wording deterministically', () => {
    assert.equal(heuristicCategory('Deep pothole on the road outside the school').category, 'roads');
    assert.equal(heuristicCategory('Garbage bins overflowing with a terrible smell').category, 'waste');
    assert.equal(heuristicCategory('Streetlights are dark and not working').category, 'streetlights');
    assert.equal(heuristicCategory('Waterlogging near the underpass after every rain').category, 'drainage');
    assert.equal(heuristicCategory('Muddy brown water is coming from the taps').category, 'water');
    assert.equal(heuristicCategory('The community hall wall is cracked').category, 'infrastructure');
    assert.equal(heuristicCategory('A completely unrelated sentence').category, 'other');
  });

  test('summary is extractive and the brief never claims to be a diagnosis', () => {
    const description = 'There is a large pothole on Main Road. It has been there for five days and two cyclists fell.';
    const summary = extractiveSummary(description);
    assert.ok(summary.length <= 280);
    assert.ok(description.includes(summary.replace(/\.$/, '').slice(0, 30)));
    const result = analyzeHeuristic({ description, address: 'Main Road', relatedCount: 1, imageAvailable: true });
    assert.equal(result.source, 'heuristic');
    assert.equal(result.category, 'roads');
    assert.match(result.actionBrief, /Automated brief/i);
    assert.match(result.actionBrief, /Not a verified diagnosis/i);
    assert.equal(result.imageAnalysis.available, false);
    assert.match(result.imageAnalysis.note, /not interpreted/i);
    assert.ok(result.missingInformation.length >= 1);
  });
});

describe('DBSCAN hotspot clustering', () => {
  test('groups only points that satisfy eps and minPts', () => {
    const points = [
      { id: 1, lat: 22.5726, lng: 88.3639, category: 'roads', area: 'A', final_priority: 'high' },
      { id: 2, lat: 22.5730, lng: 88.3642, category: 'roads', area: 'A', final_priority: 'high' },
      { id: 3, lat: 22.5734, lng: 88.3645, category: 'drainage', area: 'A', final_priority: 'medium' },
      { id: 4, lat: 22.6500, lng: 88.4500, category: 'waste', area: 'B', final_priority: 'low' },
    ];
    const labels = dbscan(points, 600, 3);
    assert.equal(labels.filter((l) => l !== undefined).length, 3);
    assert.equal(labels[3], undefined, 'the distant point is noise');
    const summary = summarizeCluster(points.slice(0, 3));
    assert.equal(summary.count, 3);
    assert.ok(summary.radiusM > 0 && summary.radiusM < 600);
    assert.match(summary.insight, /not proof of a shared root cause/i);
    const singleton = dbscan([points[3]], 600, 3);
    assert.equal(singleton[0], undefined);
  });
});
