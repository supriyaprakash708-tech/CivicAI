import { CATEGORIES, CATEGORY_KEYS, PRIORITIES, STATUSES, STATUS_LABELS, CATEGORY_LABELS } from '../config.js';
import { parseJson } from '../util.js';
import { listHotspots } from './hotspots.js';

const PRIORITY_SQL = 'COALESCE(c.final_priority, c.recommended_priority)';

export function normalizeFilters(query = {}) {
  const f = {};
  const iso = (v, endOfDay = false) => {
    if (!v) return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  f.from = iso(query.from);
  f.to = iso(query.to, true);
  f.category = CATEGORY_KEYS.includes(query.category) ? query.category : null;
  f.priority = PRIORITIES.includes(query.priority) ? query.priority : null;
  f.status = STATUSES.includes(query.status) ? query.status : null;
  f.area = query.area ? String(query.area).slice(0, 100) : null;
  f.team = query.team ? String(query.team).slice(0, 100) : null;
  f.q = query.q ? String(query.q).slice(0, 120) : null;
  f.days = Math.max(1, Math.min(365, Number(query.days) || 30));
  return f;
}

export function buildComplaintWhere(filters = {}, { publicOnly = false } = {}) {
  const conditions = [];
  const params = [];
  if (publicOnly) conditions.push("c.status <> 'rejected'");
  if (filters.from) { conditions.push('c.created_at >= ?'); params.push(filters.from); }
  if (filters.to) { conditions.push('c.created_at <= ?'); params.push(filters.to); }
  if (filters.category) { conditions.push('c.category = ?'); params.push(filters.category); }
  if (filters.priority) { conditions.push(`${PRIORITY_SQL} = ?`); params.push(filters.priority); }
  if (filters.status) { conditions.push('c.status = ?'); params.push(filters.status); }
  if (filters.area) { conditions.push('c.area = ?'); params.push(filters.area); }
  if (filters.team) { conditions.push('c.assigned_team = ?'); params.push(filters.team); }
  if (filters.q) {
    conditions.push('(c.public_id LIKE ? OR c.description LIKE ? OR c.address LIKE ? OR c.area LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
  }
  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1',
    params,
  };
}

function groupCounts(rows, key) {
  return rows.reduce((acc, r) => {
    acc[r[key]] = r.n;
    return acc;
  }, {});
}

function seriesFromRows(rows, days) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const row = map.get(d);
    out.push({ date: d, count: row?.n || 0, resolved: row?.resolved || 0 });
  }
  return out;
}

export function adminStats(db, filters = {}) {
  const { clause, params } = buildComplaintWhere(filters);
  const total = db.get(`SELECT COUNT(*) AS n FROM complaints c ${clause}`, ...params).n;

  const statusRows = db.all(`SELECT c.status, COUNT(*) n FROM complaints c ${clause} GROUP BY c.status`, ...params);
  const priorityRows = db.all(`SELECT ${PRIORITY_SQL} AS priority, COUNT(*) n FROM complaints c ${clause} GROUP BY priority`, ...params);
  const categoryRows = db.all(`SELECT c.category, COUNT(*) n FROM complaints c ${clause} GROUP BY c.category`, ...params);
  const areaRows = db.all(
    `SELECT COALESCE(c.area, 'Unspecified') AS area, COUNT(*) n FROM complaints c ${clause}
      GROUP BY area ORDER BY n DESC LIMIT 8`, ...params
  );
  const status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  Object.assign(status, groupCounts(statusRows, 'status'));
  const priority = Object.fromEntries(PRIORITIES.map((p) => [p, 0]));
  Object.assign(priority, groupCounts(priorityRows, 'priority'));

  const timelineRows = db.all(
    `SELECT substr(c.created_at, 1, 10) AS day, COUNT(*) n,
            SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END) resolved
       FROM complaints c
      ${clause} AND c.created_at >= ?
      GROUP BY day ORDER BY day`,
    ...params, new Date(Date.now() - (filters.days || 30) * 86400000).toISOString()
  );

  const resolvedAgg = db.get(
    `SELECT COUNT(*) n, AVG(julianday(c.resolved_at) - julianday(c.created_at)) avg_days
       FROM complaints c ${clause} ${clause.includes('WHERE') ? 'AND' : 'WHERE'} c.status = 'resolved' AND c.resolved_at IS NOT NULL`,
    ...params
  );

  // Duplicate pairs that still need a decision (global queue, filter-independent
  // except when a specific complaint filter is active).
  let duplicatePending;
  if (filters.category || filters.priority || filters.status || filters.area || filters.q) {
    duplicatePending = db.get(
      `SELECT COUNT(*) n FROM duplicate_links d
        JOIN complaints p ON p.id = d.primary_id
        JOIN complaints r ON r.id = d.related_id
       WHERE d.status = 'pending'
         AND p.id IN (SELECT c.id FROM complaints c ${clause})
         AND r.id IN (SELECT c.id FROM complaints c ${clause})`,
      ...params, ...params
    ).n;
  } else {
    duplicatePending = db.get("SELECT COUNT(*) n FROM duplicate_links WHERE status = 'pending'").n;
  }

  const recent = db.all(
    `SELECT c.id, c.public_id, c.description, c.category, c.address, c.area,
            ${PRIORITY_SQL} AS priority, c.status, c.created_at, c.assigned_team,
            c.priority_review_required, c.merged_into_id,
            (SELECT COUNT(*) FROM duplicate_links d WHERE (d.primary_id = c.id OR d.related_id = c.id) AND d.status = 'pending') AS pending_dupes
       FROM complaints c ${clause}
      ORDER BY c.created_at DESC LIMIT 8`,
    ...params
  );

  const openRows = db.get(
    `SELECT
       SUM(CASE WHEN c.status IN ('submitted','under_review','awaiting_information') THEN 1 ELSE 0 END) open,
       SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END) resolved,
       SUM(CASE WHEN c.status = 'rejected' THEN 1 ELSE 0 END) rejected,
       SUM(CASE WHEN c.status IN ('assigned','in_progress','reopened') THEN 1 ELSE 0 END) active
     FROM complaints c ${clause}`,
    ...params
  );

  const criticalHigh = (priority.critical || 0) + (priority.high || 0);

  return {
    filters,
    summary: {
      total,
      pending: status.submitted || 0,
      underReview: status.under_review || 0,
      assigned: status.assigned || 0,
      inProgress: status.in_progress || 0,
      resolved: status.resolved || 0,
      rejected: status.rejected || 0,
      awaitingInformation: status.awaiting_information || 0,
      reopened: status.reopened || 0,
      criticalHigh,
      critical: priority.critical || 0,
      high: priority.high || 0,
      duplicatePending,
      open: openRows?.open || 0,
      active: openRows?.active || 0,
      resolutionRate: total ? Number((((openRows?.resolved || 0) / total) * 100).toFixed(1)) : 0,
      avgResolutionDays: resolvedAgg?.avg_days ? Number(resolvedAgg.avg_days.toFixed(1)) : null,
    },
    byStatus: status,
    byPriority: priority,
    byCategory: CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: categoryRows.find((r) => r.category === c.key)?.n || 0 })),
    byArea: areaRows.map((r) => ({ area: r.area, count: r.n })),
    timeline: seriesFromRows(timelineRows, filters.days || 30),
    resolvedVsUnresolved: { resolved: status.resolved || 0, unresolved: total - (status.resolved || 0) - (status.rejected || 0), rejected: status.rejected || 0 },
    recent,
  };
}

export function publicStats(db) {
  const filters = { days: 30 };
  const total = db.get("SELECT COUNT(*) n FROM complaints WHERE status <> 'rejected'").n;
  const resolved = db.get("SELECT COUNT(*) n FROM complaints WHERE status = 'resolved'").n;
  const active = db.get("SELECT COUNT(*) n FROM complaints WHERE status IN ('assigned','in_progress','reopened')").n;
  const categoryRows = db.all("SELECT category, COUNT(*) n FROM complaints WHERE status <> 'rejected' GROUP BY category");
  const statusRows = db.all("SELECT status, COUNT(*) n FROM complaints WHERE status <> 'rejected' GROUP BY status");
  const trendRows = db.all(
    `SELECT substr(created_at, 1, 10) day, COUNT(*) n,
            SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) resolved
       FROM complaints WHERE status <> 'rejected' AND created_at >= ?
      GROUP BY day ORDER BY day`,
    new Date(Date.now() - 30 * 86400000).toISOString()
  );
  const recentResolved = db.all(
    `SELECT public_id, category, area, resolved_at, resolution_details
       FROM complaints WHERE status = 'resolved' AND merged_into_id IS NULL
      ORDER BY resolved_at DESC LIMIT 6`
  );
  const hotspots = listHotspots(db);
  const avg = db.get(
    "SELECT AVG(julianday(resolved_at) - julianday(created_at)) d FROM complaints WHERE status='resolved' AND resolved_at IS NOT NULL"
  );
  return {
    summary: {
      total,
      resolved,
      active,
      resolutionRate: total ? Number(((resolved / total) * 100).toFixed(1)) : 0,
      avgResolutionDays: avg?.d ? Number(avg.d.toFixed(1)) : null,
      hotspots: hotspots.length,
    },
    byCategory: CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: categoryRows.find((r) => r.category === c.key)?.n || 0 })),
    byStatus: statusRows.map((r) => ({ key: r.status, label: STATUS_LABELS[r.status] || r.status, count: r.n })),
    timeline: seriesFromRows(trendRows, 30),
    recentResolved,
    hotspots: hotspots.slice(0, 5),
    generatedAt: new Date().toISOString(),
    note: 'Live figures calculated from the complaint database. Rejected and duplicate-merged records are handled as described in the README.',
  };
}

export function areaOptions(db) {
  return db.all("SELECT area, COUNT(*) n FROM complaints WHERE area IS NOT NULL GROUP BY area ORDER BY n DESC LIMIT 40")
    .map((r) => r.area);
}

export { parseJson, CATEGORY_LABELS };
