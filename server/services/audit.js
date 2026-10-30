import { nowIso } from '../util.js';

export function writeAudit(db, { actor = null, actorLabel = null, action, entityType, entityId = null, details = null, ip = null }) {
  const label = actorLabel || (actor ? `${actor.name || actor.email} (${actor.role})` : 'anonymous');
  db.run(
    `INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    actor?.id ?? null,
    label,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    details ? JSON.stringify(details) : null,
    ip,
    nowIso()
  );
}

export function listAudit(db, { limit = 50, offset = 0, action = null } = {}) {
  const where = action ? 'WHERE action = ?' : '';
  const params = action ? [action] : [];
  const total = db.get(`SELECT COUNT(*) AS n FROM audit_logs ${where}`, ...params).n;
  const rows = db.all(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  return {
    total,
    entries: rows.map((r) => ({
      id: r.id,
      actor: r.actor_label,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details ? safeParse(r.details) : null,
      ip: r.ip,
      at: r.created_at,
    })),
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
