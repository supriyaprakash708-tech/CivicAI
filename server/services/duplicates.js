import { config } from '../config.js';
import { nowIso, daysBetween, parseJson } from '../util.js';
import { embed, cosine, tokenSet, containment, addressSimilarity, distanceMeters } from './embeddings.js';

/**
 * Duplicate detection: lexical/embedding text similarity + category + distance
 * + time window. Results are advisory candidates for human review; the system
 * NEVER auto-merges.
 */

const RELATED_CATEGORY_GROUPS = [
  ['roads', 'drainage'],
  ['waste', 'safety'],
  ['waste', 'drainage'],
  ['water', 'drainage'],
  ['streetlights', 'safety'],
  ['infrastructure', 'safety'],
  ['roads', 'safety'],
];

function categorySimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const related = RELATED_CATEGORY_GROUPS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  return related ? 0.5 : 0;
}

export function ensureEmbedding(complaint) {
  if (Array.isArray(complaint.embedding)) return complaint.embedding;
  const parsed = parseJson(complaint.embedding, null);
  if (Array.isArray(parsed) && parsed.length) return parsed;
  return embed(complaint.description);
}

/**
 * Compare one complaint with recent active complaints.
 * Returns candidates sorted by descending combined score.
 */
export function findDuplicateCandidates(db, complaint, settings = {}) {
  const threshold = Number(settings.duplicateThreshold ?? 0.6);
  const maxDistance = Number(settings.duplicateMaxDistanceM ?? 1500);
  const windowDays = Number(settings.duplicateWindowDays ?? 120);
  const selfEmbedding = ensureEmbedding(complaint);
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();

  const others = db.all(
    `SELECT id, public_id, description, category, address, lat, lng, created_at, status, embedding, merged_into_id
       FROM complaints
      WHERE id <> ? AND merged_into_id IS NULL AND status <> 'rejected'
        AND created_at >= ?
      ORDER BY created_at DESC LIMIT 400`,
    complaint.id, cutoff
  );

  const selfTokens = tokenSet(complaint.description);
  const candidates = [];
  for (const other of others) {
    const otherEmbedding = ensureEmbedding(other);
    const cosineScore = cosine(selfEmbedding, otherEmbedding);
    const overlap = containment(selfTokens, tokenSet(other.description));
    const textSim = 0.5 * cosineScore + 0.5 * overlap;
    const addressSim = addressSimilarity(complaint.address, other.address);
    const catSim = categorySimilarity(complaint.category, other.category);
    const dist = distanceMeters(complaint.lat, complaint.lng, other.lat, other.lng);
    const distScore = dist == null ? 0.4 : Math.max(0, 1 - dist / maxDistance);
    const apart = daysBetween(complaint.created_at || nowIso(), other.created_at);
    const timeScore = Math.max(0, 1 - apart / Math.max(1, windowDays));
    const score = 0.62 * textSim + 0.18 * addressSim + 0.1 * distScore + 0.05 * catSim + 0.05 * timeScore;

    const plausible = score >= threshold && (textSim >= 0.42 || (addressSim >= 0.8 && catSim === 1 && dist != null && dist < 150));
    if (!plausible) continue;

    const reasons = [];
    if (textSim >= 0.55) reasons.push(`High textual similarity (${Math.round(textSim * 100)}%)`);
    else if (textSim >= 0.42) reasons.push(`Moderate textual similarity (${Math.round(textSim * 100)}%)`);
    if (addressSim >= 0.8) reasons.push('Addresses are effectively the same');
    else if (addressSim >= 0.4) reasons.push('Addresses share several details');
    if (catSim === 1) reasons.push('Same category');
    else if (catSim > 0) reasons.push('Related categories');
    if (dist != null) reasons.push(`Locations ${formatDistance(dist)} apart`);
    else reasons.push('Location comparison unavailable (missing coordinates)');
    if (apart <= 7) reasons.push(`Reported ${apart < 1 ? 'within a day' : `${Math.round(apart)} day(s)`} of each other`);
    else reasons.push(`Reported ${Math.round(apart)} days apart`);

    candidates.push({
      id: other.id,
      publicId: other.public_id,
      description: other.description,
      category: other.category,
      address: other.address,
      lat: other.lat,
      lng: other.lng,
      status: other.status,
      createdAt: other.created_at,
      similarity: Number(score.toFixed(3)),
      textSimilarity: Number(textSim.toFixed(3)),
      categorySimilarity: catSim,
      addressSimilarity: Number(addressSim.toFixed(3)),
      distanceM: dist == null ? null : Math.round(dist),
      daysApart: Number(apart.toFixed(1)),
      reasons,
      recommendation: 'Human review required — similarity is not proof of duplication.',
    });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, 5);
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Persist candidates as reviewable links (never overwrites a human decision). */
export function storeDuplicateCandidates(db, complaint, candidates) {
  const created = [];
  for (const c of candidates) {
    const existing = db.get(
      'SELECT id, status FROM duplicate_links WHERE primary_id = ? AND related_id = ?',
      complaint.id, c.id
    );
    if (existing) {
      if (existing.status === 'pending') {
        db.run(
          `UPDATE duplicate_links SET similarity=?, text_similarity=?, category_similarity=?, distance_m=?,
             days_apart=?, reasons=? WHERE id=?`,
          c.similarity, c.textSimilarity, c.categorySimilarity, c.distanceM, c.daysApart,
          JSON.stringify(c.reasons), existing.id
        );
      }
      continue;
    }
    const reverse = db.get(
      'SELECT id FROM duplicate_links WHERE primary_id = ? AND related_id = ?',
      c.id, complaint.id
    );
    if (reverse) continue;
    db.run(
      `INSERT INTO duplicate_links
        (primary_id, related_id, similarity, text_similarity, category_similarity, distance_m, days_apart,
         method, reasons, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'embedding+category+geo+time', ?, 'pending', ?)`,
      complaint.id, c.id, c.similarity, c.textSimilarity, c.categorySimilarity, c.distanceM,
      c.daysApart, JSON.stringify(c.reasons), nowIso()
    );
    created.push(c.id);
  }
  return created;
}

export function detectDuplicates(db, complaintId, settings = {}) {
  const complaint = db.get('SELECT * FROM complaints WHERE id = ?', complaintId);
  if (!complaint) return { candidates: [], created: 0 };
  const candidates = findDuplicateCandidates(db, complaint, settings);
  const created = storeDuplicateCandidates(db, complaint, candidates);
  return { candidates, created: created.length };
}

export function duplicateCountFor(db, complaintId) {
  const row = db.get(
    `SELECT COUNT(*) AS n FROM duplicate_links
      WHERE (primary_id = ? OR related_id = ?) AND status IN ('pending','confirmed','linked')`,
    complaintId, complaintId
  );
  return row?.n || 0;
}

/** Fetch all duplicate link rows with joined complaint details, for review UI. */
export function listDuplicateLinks(db, { status = 'pending', limit = 100, offset = 0 } = {}) {
  const where = status ? 'WHERE d.status = ?' : '';
  const params = status ? [status] : [];
  const total = db.get(`SELECT COUNT(*) AS n FROM duplicate_links d ${where}`, ...params).n;
  const rows = db.all(
    `SELECT d.*,
            p.public_id AS primary_public_id, p.category AS primary_category, p.address AS primary_address,
            p.description AS primary_description, p.created_at AS primary_created_at, p.status AS primary_status,
            r.public_id AS related_public_id, r.category AS related_category, r.address AS related_address,
            r.description AS related_description, r.created_at AS related_created_at, r.status AS related_status,
            r.merged_into_id AS related_merged_into
       FROM duplicate_links d
       JOIN complaints p ON p.id = d.primary_id
       JOIN complaints r ON r.id = d.related_id
       ${where}
      ORDER BY d.similarity DESC, d.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  return {
    total,
    links: rows.map((r) => ({
      id: r.id,
      similarity: r.similarity,
      textSimilarity: r.text_similarity,
      categorySimilarity: r.category_similarity,
      distanceM: r.distance_m,
      daysApart: r.days_apart,
      method: r.method,
      reasons: parseJson(r.reasons, []),
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
      reviewNote: r.review_note,
      primary: {
        id: r.primary_id,
        publicId: r.primary_public_id,
        category: r.primary_category,
        address: r.primary_address,
        description: r.primary_description,
        createdAt: r.primary_created_at,
        status: r.primary_status,
      },
      related: {
        id: r.related_id,
        publicId: r.related_public_id,
        category: r.related_category,
        address: r.related_address,
        description: r.related_description,
        createdAt: r.related_created_at,
        status: r.related_status,
        mergedInto: r.related_merged_into,
      },
    })),
  };
}

export function pendingDuplicateCount(db) {
  return db.get("SELECT COUNT(*) AS n FROM duplicate_links WHERE status = 'pending'").n;
}

export function maxSimForComplaint(db, complaintId) {
  const row = db.get(
    `SELECT MAX(similarity) AS s FROM duplicate_links
      WHERE (primary_id = ? OR related_id = ?) AND status IN ('pending','confirmed','linked')`,
    complaintId, complaintId
  );
  return row?.s ?? null;
}

export { categorySimilarity, config };
