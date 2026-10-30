import crypto from 'node:crypto';
import { CATEGORY_LABELS } from '../config.js';
import { nowIso, parseJson } from '../util.js';
import { distanceMeters } from './embeddings.js';

/**
 * DBSCAN hotspot detection over real stored coordinates.
 * Complaints that were merged are excluded from clustering (their primary is
 * used instead) and rejected complaints are ignored.
 */

export function dbscan(points, epsMeters, minPts) {
  const UNVISITED = 0;
  const VISITED = 1;
  const NOISE = -1;
  const state = new Array(points.length).fill(UNVISITED);
  const labels = new Array(points.length).fill(undefined);
  let cluster = 0;

  const neighborsOf = (i) => {
    const out = [];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const d = distanceMeters(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      if (d != null && d <= epsMeters) out.push(j);
    }
    return out;
  };

  for (let i = 0; i < points.length; i += 1) {
    if (state[i] !== UNVISITED) continue;
    state[i] = VISITED;
    let neighbors = neighborsOf(i);
    if (neighbors.length + 1 < minPts) {
      labels[i] = undefined;
      state[i] = NOISE;
      continue;
    }
    labels[i] = cluster;
    for (let k = 0; k < neighbors.length; k += 1) {
      const j = neighbors[k];
      if (state[j] === NOISE) {
        labels[j] = cluster;
        state[j] = VISITED;
      }
      if (state[j] !== UNVISITED) continue;
      state[j] = VISITED;
      const more = neighborsOf(j);
      if (more.length + 1 >= minPts) neighbors = [...new Set([...neighbors, ...more])];
      labels[j] = cluster;
    }
    cluster += 1;
  }
  return labels;
}

function mode(values) {
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

const ACTIONS = {
  roads: 'Inspect the road surface across the highlighted area. Check whether drainage problems are contributing to pavement damage.',
  waste: 'Audit waste collection frequency and bin capacity in this area, and clear any persistent dumping points.',
  drainage: 'Inspect and clear the stormwater network in this area, then verify whether nearby road damage shares the same cause.',
  streetlights: 'Check the feeder pillar and lighting circuit serving the highlighted poles, including any dark stretches.',
  water: 'Check local supply pressure and inspect the distribution pipes for repeated leaks or interruptions.',
  safety: 'Arrange a joint safety inspection of the highlighted area and record findings before closing any reports.',
  infrastructure: 'Inspect the public assets in this cluster and consolidate repairs into a single work order where appropriate.',
  other: 'Triage the reports together and verify whether the issues share a location or cause.',
};

export function summarizeCluster(points) {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const radius = Math.max(...points.map((p) => distanceMeters(lat, lng, p.lat, p.lng) || 0));
  const categories = mode(points.map((p) => p.category));
  const priorities = mode(points.map((p) => p.final_priority || p.recommended_priority || 'medium'));
  const ids = points.map((p) => p.id).sort((a, b) => a - b);
  const publicIds = points.map((p) => p.public_id);
  const dominant = categories[0]?.[0] || 'other';
  const area = mode(points.map((p) => p.area).filter(Boolean))[0]?.[0] || null;
  const signature = `hs_${crypto.createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16)}`;
  const catText = categories.slice(0, 3).map(([k, n]) => `${CATEGORY_LABELS[k] || k} (${n})`).join(', ');
  const priText = priorities.map(([k, n]) => `${k} (${n})`).join(', ');
  const insight = `${points.length} reports cluster within about ${Math.round(radius)} m${area ? ` in ${area}` : ''}. Categories: ${catText}. Priority mix: ${priText}. The clustering is based only on geographic proximity; the category and priority summary describes the nearby reports and is not proof of a shared root cause.`;
  const categoriesList = categories.map(([key, count]) => ({ key, label: CATEGORY_LABELS[key] || key, count }));
  const crossSector = categories.some(([k]) => k === 'drainage') && categories.some(([k]) => k === 'roads');
  const action = crossSector
    ? 'Coordinate drainage and road-surface inspection: standing water may be accelerating pavement damage. Verify before scheduling combined works.'
    : ACTIONS[dominant] || ACTIONS.other;
  return {
    signature,
    centerLat: Number(lat.toFixed(6)),
    centerLng: Number(lng.toFixed(6)),
    radiusM: Math.round(radius),
    count: points.length,
    categories: categoriesList,
    priorities: priorities.map(([key, count]) => ({ key, count })),
    complaintIds: ids,
    publicIds,
    dominantCategory: dominant,
    area,
    insight,
    suggestedAction: action,
    points,
  };
}

export function computeHotspots(db, settings = {}) {
  const eps = Number(settings.hotspotRadiusM ?? 600);
  const minPts = Number(settings.hotspotMinPoints ?? 3);
  const rows = db.all(
    `SELECT id, public_id, category, area, lat, lng, final_priority, recommended_priority, created_at
       FROM complaints
      WHERE lat IS NOT NULL AND lng IS NOT NULL
        AND merged_into_id IS NULL AND status <> 'rejected'
      ORDER BY created_at ASC`
  );
  if (rows.length < minPts) return { clusters: [], pointsUsed: rows.length, eps, minPts };

  const labels = dbscan(rows, eps, minPts);
  const grouped = new Map();
  labels.forEach((label, i) => {
    if (label === undefined || label < 0) return;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(rows[i]);
  });

  const clusters = [...grouped.values()]
    .filter((pts) => pts.length >= minPts)
    .map(summarizeCluster)
    .sort((a, b) => b.count - a.count);

  return { clusters, pointsUsed: rows.length, eps, minPts };
}

/** Recalculate and persist hotspots. Returns the fresh list. */
export function recomputeHotspots(db, settings = {}) {
  const { clusters, pointsUsed, eps, minPts } = computeHotspots(db, settings);
  const computedAt = nowIso();
  const keep = new Set(clusters.map((c) => c.signature));
  db.transaction(() => {
    for (const c of clusters) {
      db.run(
        `INSERT INTO hotspots
          (signature, center_lat, center_lng, radius_m, complaint_count, categories, priorities,
           complaint_ids, public_ids, insight, suggested_action, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(signature) DO UPDATE SET
           center_lat=excluded.center_lat, center_lng=excluded.center_lng, radius_m=excluded.radius_m,
           complaint_count=excluded.complaint_count, categories=excluded.categories,
           priorities=excluded.priorities, complaint_ids=excluded.complaint_ids,
           public_ids=excluded.public_ids, insight=excluded.insight,
           suggested_action=excluded.suggested_action, computed_at=excluded.computed_at`,
        c.signature, c.centerLat, c.centerLng, c.radiusM, c.count,
        JSON.stringify(c.categories), JSON.stringify(c.priorities),
        JSON.stringify(c.complaintIds), JSON.stringify(c.publicIds),
        c.insight, c.suggestedAction, computedAt
      );
    }
    const existing = db.all('SELECT signature FROM hotspots');
    for (const row of existing) {
      if (!keep.has(row.signature)) db.run('DELETE FROM hotspots WHERE signature = ?', row.signature);
    }
  });
  return { clusters, pointsUsed, eps, minPts, computedAt };
}

export function listHotspots(db) {
  const rows = db.all('SELECT * FROM hotspots ORDER BY complaint_count DESC');
  return rows.map((r) => ({
    signature: r.signature,
    center: { lat: r.center_lat, lng: r.center_lng },
    radiusM: r.radius_m,
    count: r.complaint_count,
    categories: parseJson(r.categories, []),
    priorities: parseJson(r.priorities, []),
    complaintIds: parseJson(r.complaint_ids, []),
    publicIds: parseJson(r.public_ids, []),
    insight: r.insight,
    suggestedAction: r.suggested_action,
    computedAt: r.computed_at,
    source: 'DBSCAN proximity clustering (rule-generated insight)',
  }));
}

export { mode };
