# Limitations and honesty

CivicAI is a local demonstration prototype. It is not connected to a city
dispatch system, emergency service, official GIS, or public identity provider.
Assignments, status changes, and notifications are stored in the prototype;
they do not dispatch a real crew or send an external message.

## What is real in this prototype

- Reports, user sessions, status history, assignment details, audit entries,
  duplicate-review decisions, and hotspot results are persisted in SQLite.
- Report photos are checked for supported file signatures and stored locally.
- Priority recommendations expose their rule factors and uncertainty.
- The default categorization and summary are deterministic local heuristics.
- Duplicate candidates combine lexical similarity, category, location, and
  recency. A person must review candidates; the system does not auto-merge.
- Hotspots use DBSCAN on report coordinates. Suggested actions are
  rule-generated and do not establish a shared root cause.
- Synthetic reports are marked as synthetic and must not be presented as
  citizen-submitted evidence.

## What is optional or simulated

- A remote language-model analysis is used only when a provider key is
  configured and AI is enabled. Otherwise the transparent local fallback is
  used. A configured provider can still fail, return invalid output, or be
  wrong.
- Image interpretation is disabled by default. An uploaded photo is not
  visually analyzed unless `AI_IMAGE_ANALYSIS=true` and a compatible provider
  is configured.
- The generated demo dataset represents fictional locations around Riverport.
  Map locations and hotspot patterns are synthetic, not current municipal
  conditions.
- Citizen-facing updates are visible through the app's tracking workflow;
  email, SMS, social-media ingestion, and live GIS services are not connected.

## Known limits and next steps

- Keyword rules and summaries can misclassify ambiguous or multilingual
  descriptions. They may miss hazards or overstate the significance of terms.
- Priority scores are advisory, not a safety certification or substitute for
  trained human triage. Hazard flags require prompt human verification.
- Similarity thresholds can miss true duplicates or suggest unrelated reports.
  Geographic proximity alone does not demonstrate a common cause.
- Rate limiting and submission idempotency are held in process memory. A restart
  clears them, and multiple server instances would not share the same limits.
- The map renders at most 100 filtered reports at once. The assignments board
  loads up to 100 reports per open status; larger queues require the filtered
  complaint register. Duplicate review shows the five strongest candidates per
  report.
- There is no reverse geocoding. Area and address text are stored as supplied or
  corrected by an administrator; a map pin provides coordinates only.
- Uploaded evidence is stored on local disk without malware scanning or EXIF
  metadata removal. Only JPEG, PNG, and WebP signatures are accepted. Production
  use needs a trusted object store, virus scanning, and a retention policy.
- CSV export includes an internal `merged_into_complaint_id` for administrators;
  it is not a public-facing identifier.
- Notifications are in-app only. No email, SMS, push, social-media ingestion, or
  external dispatch integration is connected.
- SQLite runs in a single process. There is no high-availability setup, managed
  backup schedule, or multi-instance coordination.
- The prototype has not been independently audited for production scale,
  accessibility, privacy, security, or operational reliability. Do not submit
  real sensitive or personal data to a demo deployment.
- Before real use, add an approved data-retention policy, operational
  monitoring, backups, accessibility and security reviews, local-language
  evaluation, human escalation procedures, and integrations authorized by the
  relevant municipality.
