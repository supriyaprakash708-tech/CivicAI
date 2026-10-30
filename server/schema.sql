-- CivicAI schema. Executed on every boot (all statements are idempotent).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS complaints (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id             TEXT NOT NULL UNIQUE,
  tracking_hash         TEXT,
  user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description           TEXT NOT NULL,
  category              TEXT NOT NULL,
  category_source       TEXT NOT NULL DEFAULT 'citizen'
                        CHECK (category_source IN ('citizen','ai','heuristic','admin')),
  category_confidence   REAL,
  address               TEXT,
  area                  TEXT,
  lat                   REAL,
  lng                   REAL,
  image_path            TEXT,
  image_mime            TEXT,
  image_analysis        TEXT,
  ai_summary            TEXT,
  ai_category           TEXT,
  ai_category_confidence REAL,
  ai_source             TEXT NOT NULL DEFAULT 'none'
                        CHECK (ai_source IN ('none','ai','heuristic')),
  ai_status             TEXT NOT NULL DEFAULT 'pending'
                        CHECK (ai_status IN ('pending','processing','done','fallback','failed')),
  ai_error              TEXT,
  ai_model              TEXT,
  embedding             TEXT,
  recommended_priority  TEXT CHECK (recommended_priority IN ('critical','high','medium','low')),
  final_priority        TEXT CHECK (final_priority IN ('critical','high','medium','low')),
  priority_score        INTEGER,
  priority_explanation  TEXT,
  priority_factors      TEXT,
  priority_source       TEXT,
  priority_review_required INTEGER NOT NULL DEFAULT 0,
  priority_overridden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority_override_reason TEXT,
  priority_overridden_at TEXT,
  action_brief          TEXT,
  status                TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','under_review','assigned','in_progress','resolved','rejected','awaiting_information','reopened')),
  assigned_team         TEXT,
  assigned_to           TEXT,
  assigned_at           TEXT,
  resolution_details    TEXT,
  resolved_at           TEXT,
  merged_into_id        INTEGER REFERENCES complaints(id) ON DELETE SET NULL,
  reporter_name         TEXT,
  reporter_contact      TEXT,
  is_synthetic          INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category);
CREATE INDEX IF NOT EXISTS idx_complaints_priority ON complaints(final_priority);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_area ON complaints(area);
CREATE INDEX IF NOT EXISTS idx_complaints_merged ON complaints(merged_into_id);

CREATE TABLE IF NOT EXISTS duplicate_links (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_id           INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  related_id           INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  similarity           REAL NOT NULL,
  text_similarity      REAL,
  category_similarity  REAL,
  distance_m           REAL,
  days_apart           REAL,
  method               TEXT NOT NULL DEFAULT 'embedding+geo+time',
  reasons              TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','rejected','linked')),
  reviewed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          TEXT,
  review_note          TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE (primary_id, related_id),
  CHECK (primary_id <> related_id)
);
CREATE INDEX IF NOT EXISTS idx_dupes_status ON duplicate_links(status);
CREATE INDEX IF NOT EXISTS idx_dupes_related ON duplicate_links(related_id);

CREATE TABLE IF NOT EXISTS status_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  changed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL,
  public_update TEXT,
  internal_note TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_complaint ON status_history(complaint_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_label  TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  details      TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS hotspots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  signature        TEXT NOT NULL UNIQUE,
  center_lat       REAL NOT NULL,
  center_lng       REAL NOT NULL,
  radius_m         REAL NOT NULL,
  complaint_count  INTEGER NOT NULL,
  categories       TEXT,
  priorities       TEXT,
  complaint_ids    TEXT,
  public_ids       TEXT,
  insight          TEXT,
  suggested_action TEXT,
  computed_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
  audience     TEXT NOT NULL CHECK (audience IN ('citizen','admin')),
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications(audience, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('duplicateThreshold', '0.6', datetime('now')),
  ('duplicateMaxDistanceM', '1500', datetime('now')),
  ('duplicateWindowDays', '120', datetime('now')),
  ('hotspotRadiusM', '600', datetime('now')),
  ('hotspotMinPoints', '3', datetime('now')),
  ('maxImageMB', '8', datetime('now')),
  ('aiEnabled', 'true', datetime('now')),
  ('cityName', 'Riverport', datetime('now'));
