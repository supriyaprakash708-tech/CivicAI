# CivicAI — From complaints to action

CivicAI is a working, local-first civic complaint management platform. Citizens
can report an issue anonymously, receive a private tracking code, and follow
what happened. Administrators get an evidence-based triage console: explainable
priorities, advisory duplicate review, a live proximity map, assignments, a
status workflow, audit history, analytics, and CSV export.

It is a complete prototype for demonstration and evaluation — not a live
connection to a municipal dispatch system. Every automated recommendation is
labelled, inspectable, and reversible by a human. See
[Limitations and honesty](./LIMITATIONS.md) before treating any output as
operational fact.

## Quick start

**Requirements:** Node.js 22.5 or newer (Node 24+ recommended; verified on Node
26). The project uses Node's built-in `node:sqlite`, so there is no native module
build step and no external database service.

```powershell
npm install
Copy-Item .env.example .env
npm run seed
npm start
```

Open <http://localhost:3000>.

The server creates its SQLite database and upload directory under `data/` on
first run. Seed data is entirely synthetic: **46 fictional reports across five
neighbourhood clusters plus scattered locations**, with deliberate duplicates,
urgent hazards, varied statuses, workflow history, pending duplicate candidates,
and one confirmed merge.

Re-running `npm run seed` replaces only synthetic reports and preserves
citizen-submitted records. To remove generated demo reports without touching
real submissions, run `npm run seed:reset`.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@civicai.local` | `CivicAI@2026` |
| Citizen | `citizen@civicai.local` | `Citizen@2026` |

These are development credentials only. Change them before any non-local use.
The bootstrap administrator is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
when the user table has no administrator. Do not enter real personal data in a
demo.

The **Officer console** link in the site header opens `#/admin`. In development
and test environments it offers **one-click demo officer access** (a real,
audited administrator session) so the console can be evaluated without typing
credentials or creating an account. Demo officer access is disabled when
`NODE_ENV=production`. Citizen reporting never requires an account.

A guided walkthrough is in [DEMO.md](./DEMO.md).

## What the application does

### Citizen experience

- Submit a report with or without an account; description is required, and an
  address or map pin provides location.
- Choose a category or let CivicAI suggest one from the text.
- Attach a JPG, PNG, or WebP photo (verified by magic bytes, size-capped).
- Receive a public complaint ID and a one-time private tracking code. Only the
  hash of the code is stored.
- Track status, public updates, resolution details, and timestamped history
  using the ID and code.
- Create an optional citizen account to see “My reports”.
- Public dashboard with live counts, category breakdown, recent resolutions, and
  geographic hotspots. No private reporter details are exposed.

### Administrator console

- **Dashboard** — live KPIs, trends, category/priority/status breakdowns, urgent
  review queue, recent activity, and CSV export.
- **Complaints** — server-side search, filters, sorting, and pagination; detail
  view with the original report, photo, AI/heuristic provenance, duplicate
  candidates, priority factors, location map, and history.
- **Duplicate review** — inspect why reports were matched, confirm and merge,
  reject with a required note, or unmerge. Nothing merges automatically.
- **Map & hotspots** — pan/zoom city map, click-to-pin, hotspot rings with real
  metre radii, category/status/priority filters, and DBSCAN recomputation.
- **Assignments** — work board for open statuses with team and assignee context.
- **Analytics** — workload, resolution performance, category and priority
  distributions, area comparisons, and hotspot context. Every figure comes from
  stored records at request time.
- **Audit log** — filterable record of administrative actions, denied requests,
  and API errors.
- **Settings** — duplicate threshold/distance/window, hotspot radius/minimum
  points, maximum image size, AI on/off, and city name. Validated atomically and
  applied immediately.
- **Account security** — sign in, sign out, and change password. RBAC is
  enforced on the server for every admin endpoint.

### Status workflow

`submitted → under_review → assigned → in_progress → resolved`

Additional states: `rejected`, `awaiting_information`, and `reopened`.
Transitions are validated by the backend; rejection requires a reason and
resolution requires resolution details. Every transition creates a timestamped
history entry with the actor, a citizen-visible update, and an optional internal
note.

## How the analysis works

The complaint is always stored **before** analysis. Analysis never deletes a
report; a failure leaves the record usable and visibly marked.

### AI-assisted, with a transparent fallback

1. If a remote OpenAI-compatible provider is configured (`AI_API_KEY`) and AI is
   enabled in Settings, the provider is asked for a category, summary, action
   brief, priority suggestion, hazards, and missing information.
2. Provider output is schema-validated. Invalid or failed responses fall back to
   deterministic local rules.
3. Without a provider, local keyword rules categorize, an extractive method
   summarizes, and rule-based text patterns produce the action brief.
4. Results record their source: `ai`, `heuristic`, `citizen`, or `admin`, plus
   `ai_status` (`pending`, `processing`, `done`, `fallback`, `failed`). The UI
   labels the mode rather than implying a model was used when it was not.
5. Image analysis is optional and **off by default**. Without
   `AI_IMAGE_ANALYSIS=true` and a vision-capable provider, the photo is retained
   as evidence but explicitly reported as “not interpreted”.
6. Missing details are represented as uncertainty or nulls — never invented.

### Explainable priority

Priority is a 0–100 rule score assembled from attributable factors:

| Factor | Maximum contribution |
|---|---|
| Category baseline | 4–18 |
| Reported duration | 10 |
| Severity language | 8 |
| Condition / public-health risk | 13 |
| Immediate hazard indicators | 35 |
| Safety-risk language (non-imminent) | 10 |
| Potential public impact | 20 |
| Repeated nearby reports | 10 |
| Attached photo (analysed / not analysed) | 4 / 2 |

Thresholds: **70+ critical, 50+ high, 30+ medium, otherwise low**. An
imminent-hazard phrase applies a **critical floor of 75** and a mandatory
human-review flag. Administrators can override the priority with a written
reason; overrides survive re-analysis and are visible in the audit trail.

### Advisory duplicate detection

Candidates combine deterministic hashed text similarity, token containment,
address similarity, category relatedness, Haversine distance, and recency:

`0.62 × text + 0.18 × address + 0.10 × distance + 0.05 × category + 0.05 × time`

Defaults: threshold **0.6**, maximum distance **1,500 m**, lookback **120 days**.
Each candidate shows its score components and human-readable reasons. A person
must confirm, reject, or merge. Confirmed merges keep the original record and
can be undone.

### Geographic hotspots

DBSCAN clusters reports that have coordinates. Defaults are **600 m** and
**3 reports**. Merged and rejected reports are excluded. The displayed radius is
the real maximum distance from the cluster centre. Category and priority mix are
summaries of the nearby reports; the clustering itself uses **geographic
proximity only** and is labelled as a pattern, not proof of a shared cause.

## Architecture

```
public/                     No-build-step SPA (vanilla ES modules + SVG map)
  index.html
  css/styles.css            Design system, responsive layouts, accessibility
  js/app.js                 Hash router, auth shell, public/admin layouts
  js/api.js                 Fetch client and typed API errors
  js/ui.js, charts.js, map.js
  js/pages/citizen.js       Home, report, track, public dashboard, auth, my reports
  js/pages/admin.js         Dashboard, complaints, review, duplicates, map, etc.
server/
  index.js                  Boot: DB, admin bootstrap, hotspot refresh, HTTP
  app.js                    Express app factory, security headers, static SPA
  config.js                 Env parsing, categories, statuses, teams, transitions
  db.js                     node:sqlite wrapper, WAL, schema, settings
  schema.sql                Idempotent schema and defaults
  auth.js                   scrypt hashing, sessions, RBAC guards
  middleware.js             Origin guard, rate limits, errors, audit logging
  routes/                   public, complaints, auth, admin APIs
  services/
    ai/                     Provider adapter + deterministic local fallback
    pipeline.js             Post-submit analysis orchestration
    priority.js             Transparent scoring and AI combination
    embeddings.js           Hashed embedding, similarity, distance
    duplicates.js           Candidate scoring and human review state
    hotspots.js             DBSCAN and rule-generated cluster summaries
    stats.js                Dashboard and analytics queries
  seed.js                   Synthetic 46-report generator/reset
tests/                      node:test unit, API, persistence, and seed suites
```

- **Express 5** serves JSON APIs and the static SPA; runtime dependencies are
  only `express` and `multer`.
- **SQLite** persists complaints, users, sessions, status history, duplicate
  links, audit logs, notifications, hotspots, and settings.
- **No frontend build, CDN, or inline scripts.** The CSP is `script-src 'self'`;
  all handlers are bound from ES modules.
- The map is a stylized local SVG city map with real coordinates, metre-scaled
  hotspot rings, pan/zoom, and click-to-pin — no external tile provider.

## Data and seed behaviour

Synthetic records have `is_synthetic = 1` and fictional descriptions/locations
around “Riverport”. The seed:

- creates 46 reports across five cluster areas plus scattered reports;
- varies statuses, priorities, assignments, resolutions, and history;
- creates pending duplicate candidates and one confirmed merge;
- leaves urgent hazard reports flagged for human review;
- is repeatable and replaces only synthetic records.

The database ignores uploaded evidence by extension alone: image signatures are
checked server-side. Files are stored under `data/uploads/`; the database stores
a relative path, not the binary.

## API overview

All APIs are under `/api`. Authentication uses an `HttpOnly`, `SameSite=Lax`
session cookie. State-changing requests also pass a same-origin check.

| Area | Endpoints |
|---|---|
| Public | `GET /health`, `GET /meta`, `GET /public/stats`, `GET /public/hotspots`, `POST /track`, `GET /complaints/public/:publicId/image` |
| Complaints | `POST /complaints` (multipart, optional `Idempotency-Key`), `GET /my/complaints`, `GET /my/complaints/:publicId` |
| Auth | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`, `GET /auth/users` |
| Admin read | `GET /admin/stats`, `GET /admin/complaints`, `GET /admin/complaints/:id`, `GET /admin/complaints/:id/image`, `GET /admin/duplicates`, `GET /admin/hotspots`, `GET /admin/analytics`, `GET /admin/export.csv`, `GET /admin/audit`, `GET /admin/notifications`, `GET /admin/settings` |
| Admin write | `POST /admin/complaints/:id/status`, `/assign`, `/priority`, `/comment`, `/reanalyze`, `/unmerge`; `POST /admin/duplicates/:id/review`; `POST /admin/hotspots/recompute`; `PATCH /admin/complaints/:id`; `PATCH /admin/settings` |

`POST /complaints` returns the stored complaint, tracking code, tracking view,
processing state, and urgent flag. Duplicate keys replay the original receipt
instead of creating another report.

## Configuration

Copy `.env.example` to `.env`. The important settings are:

- `PORT`, `NODE_ENV`, `PUBLIC_ORIGIN`
- `DB_PATH`, `UPLOAD_DIR`
- `SESSION_SECRET`, `TRACKING_SECRET`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- `SESSION_TTL_DAYS`, `MAX_IMAGE_MB`
- `AI_ENABLED`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS`,
  `AI_IMAGE_ANALYSIS`
- optional `TRUST_PROXY=true` when behind a trusted reverse proxy

In development, blank secrets are generated once into `data/.secret`. In
production, always set strong `SESSION_SECRET` and `TRACKING_SECRET` values and
use HTTPS. AI is optional: leave `AI_API_KEY` blank to run entirely on local
fallback rules.

When a remote provider is configured, report text and metadata are sent to that
provider; image data is sent only if image analysis is enabled. Review the
provider's data policy before using non-synthetic reports.

## Security and privacy

- Passwords use salted **scrypt** hashes; verification is timing-safe.
- Session tokens are random 256-bit values; only SHA-256 hashes are stored.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Tracking codes are hashed with a server secret; the plain code is shown once.
- Anonymous tracking requires **both** the public ID and tracking code.
- RBAC and status-transition rules are enforced server-side, not just hidden in
  the UI.
- Cross-origin writes are rejected; security headers include CSP, nosniff,
  frame denial, referrer policy, and a restrictive permissions policy.
- Inputs are validated, JSON bodies are size-limited, and uploads are checked by
  magic bytes and capped in size.
- Fixed-window rate limits cover submission, tracking, login, signup, password
  changes, and image access.
- Administrative actions, denied requests, and API errors are written to an
  audit log. CSV exports are quoted and protected against formula injection.
- Reporter name/contact and evidence are never included in public responses.

## Tests and checks

```powershell
npm test
npm run check
```

`npm test` runs the `node:test` suites against isolated in-memory or temporary
databases and upload directories. The current suite contains **48 passing
tests** across 18 suites:

- identifier/tracking formats, scrypt hashing, image sniffing, similarity,
  priority, local fallback, and DBSCAN units;
- submission, idempotency, validation, upload security, tracking, RBAC,
  duplicate merge/unmerge, workflow, assignment, priority override, filters,
  hotspots, analytics, audit, CSV hardening, settings, auth/session, origin
  checks, and rate limiting;
- SQLite close/reopen persistence and ID continuity;
- synthetic seed generation, labelling, and idempotent replacement.

`npm run check` is a quick syntax check of the server entry point. All server
and browser modules can also be checked with `node --check <file>`; the browser
application performs no build step.

## Limitations

CivicAI is a prototype. Assignments and notifications do not dispatch real
crews or send external messages. Automated categorization and priority can be
wrong, similarity is not proof of duplication, and hotspot proximity is not
proof of a shared cause. Image interpretation is disabled by default. See
[LIMITATIONS.md](./LIMITATIONS.md) for the full, plain-language list.
