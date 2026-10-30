# Five-minute demo guide

This is a presenter script for the seeded CivicAI demo. Everything shown comes
from the live database; dashboard figures are not hardcoded.

## Before the demo

From the project folder:

```powershell
npm install
npm run seed
npm start
```

Open two browser windows (or one normal and one private window):

- Citizen/public window: <http://localhost:3000>
- Officer window: <http://localhost:3000/#/admin> — on the officer access screen
  press **Enter demo officer console**, or sign in at
  <http://localhost:3000/#/login?next=%2Fadmin>

Credentials (only needed if you sign in manually):

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@civicai.local` | `CivicAI@2026` |
| Citizen | `citizen@civicai.local` | `Citizen@2026` |

If the app is already running, `npm run seed` replaces only synthetic reports.
It does not remove real citizen submissions.

> **Disposable demo reset:** stop the server, delete `data/civicai.db`,
> `data/civicai.db-shm`, and `data/civicai.db-wal`, then run `npm run seed`
> again. This returns the demo to exactly 46 synthetic reports. Never do this to
> a database containing records you want to keep.

The seed creates 46 fictional reports, pending duplicate candidates, one
confirmed merge, and five geographic hotspot clusters. Photos are not required
for the demo.

---

## 0:00–0:35 — The citizen front door

1. Open `#/` (Home).
2. Point out that the report count, resolution rate, active work, recent
   resolutions, category counts, and hotspot count are loaded from
   `/api/public/stats` and `/api/public/hotspots`.
3. Open `#/public` (Public dashboard). Show the live status/category charts,
   recent public resolutions, and hotspot list.
4. Say the boundary plainly: public views exclude reporter details and private
   evidence unless the tracking code is supplied.

**Message:** “Transparent public reporting without exposing private data.”

## 0:35–1:35 — Submit and track a report

1. Open `#/report`.
2. Leave **Category** on “Let CivicAI suggest a category”.
3. Use this example description:

   > Large pothole on the Main Road near the bus stand. It has been there for
   > two weeks and cyclists are swerving into traffic at night.

4. Enter `Main Road bus stand, Riverside` as the address.
5. Optionally click the map to drop a pin, then submit.
6. On the receipt, point out:
   - the public complaint ID;
   - the one-time private tracking code;
   - the statement that the report was stored before analysis.
7. Open `#/track`, enter the ID and code, and show the current status/history.
8. If no `AI_API_KEY` is configured, point out the visible **local fallback**
   label. The app does not claim a language model was used.

**Message:** “No account required. The code is shown once and stored hashed.”

## 1:35–2:25 — Officer triage and human review

1. In the officer window, open `#/admin` and press **Enter demo officer console**
   (development only), or sign in at `#/login?next=%2Fadmin`.
2. On `#/admin`, show the live KPIs, priority mix, urgent review queue, and
   recent activity. The top bar's **New reports** button shows how many
   submissions are still awaiting triage, and Complaints carries a live count.
3. Open `#/admin/complaints` and search for `manhole` (or the ID just created).
   Open a report.
4. Walk through the detail page:
   - original description, address, category provenance, and photo status;
   - AI/heuristic summary and action brief with source labels;
   - **priority factors** — every point has a reason;
   - uncertainty/missing-information notes;
   - duplicate candidates with their similarity reasons.
5. Open `#/admin/duplicates`. Pick a pending candidate, explain why similarity
   is only a suggestion, and show the **Confirm merge** and **Reject** actions.
   Both require a human decision; rejection requires a note.
6. If demonstrating a merge, confirm one and then use **Unmerge** on the
   complaint detail page to restore it. Re-run `npm run seed` afterwards to
   restore the original synthetic state.

**Message:** “Automation ranks and explains. A person decides.”

## 2:25–3:05 — Map, hotspots, and workload

1. Open `#/admin/map`. Show the five seeded clusters inside their real metre
   radii, pan/zoom, and click a marker to open a report.
2. Apply a category or priority filter, then press **Recompute hotspots**.
3. Open `#/admin/assignments` and show open work by team/assignee.

**Message:** “DBSCAN groups nearby coordinates. It shows a pattern, not a proven
common cause.”

## 3:05–3:55 — Workflow, public update, audit, and export

1. Return to the report detail page.
2. Move it through the legal workflow, for example
   **Under review → Assigned** or **Assigned → In progress**.
3. Enter a citizen-visible public update and, if relevant, an internal note.
4. Return to the citizen tracking view and show the new timestamped update.
5. Open `#/admin/audit` and show the recorded administrative action.
6. Open `#/admin/complaints` and press **Export CSV** (or call
   `/api/admin/export.csv` while signed in).

**Message:** “Every state change is attributable, timestamped, and visible to the
citizen where appropriate.”

## 3:55–4:30 — Analytics and settings

1. Open `#/admin/analytics`. Show resolution performance, category/priority
   trends, and area comparisons computed from the database.
2. Open `#/admin/settings`. Show the duplicate threshold, hotspot radius/minimum
   points, image cap, AI toggle, and city name. Mention validation is atomic and
   changes apply immediately.
3. Optional: open `#/login` as the citizen account, then `#/my`, to show the
   optional account path. A citizen account still cannot open `#/admin` — the
   server returns 403.

**Message:** “Configuration is operational data, not hardcoded UI.”

## 4:30–5:00 — Close with the honest limits

Show `LIMITATIONS.md` or summarize:

- local demo only; no dispatch, email, SMS, or live GIS;
- no AI key means transparent heuristic fallback;
- photos are evidence, not analysed unless explicitly enabled;
- duplicate and hotspot similarity are advisory;
- synthetic reports are clearly marked and are not real civic evidence.

**Closing line:** “CivicAI shows the whole path — report, explanation, human
decision, work, and outcome — without pretending the automation is an oracle.”

---

## Quick route reference

| Screen | Route | Access |
|---|---|---|
| Home | `#/` | Public |
| Report an issue | `#/report` | Public |
| Track a report | `#/track` | Public (ID + code) |
| Public dashboard | `#/public` | Public |
| Citizen sign in / sign up | `#/login`, `#/signup` | Public |
| My reports | `#/my` | Signed-in citizen |
| Admin dashboard | `#/admin` | Administrator |
| Complaints + export | `#/admin/complaints` | Administrator |
| Complaint detail | `#/admin/complaints/<numeric id>` | Administrator |
| Duplicate review | `#/admin/duplicates` | Administrator |
| Map & hotspots | `#/admin/map` | Administrator |
| Assignments | `#/admin/assignments` | Administrator |
| Analytics | `#/admin/analytics` | Administrator |
| Audit log | `#/admin/audit` | Administrator |
| Settings | `#/admin/settings` | Administrator |

## Troubleshooting

- **Port already in use:** stop the existing server or set `PORT` in `.env`.
- **No 46 reports after seeding:** the seed preserves real (non-synthetic)
  records, so the total can be higher. Use the disposable reset above for an
  exact baseline.
- **Analysis badge says fallback:** expected without `AI_API_KEY`; this is the
  supported offline mode, not an error.
- **Forgot the tracking code:** it is shown only once. An administrator can look
  up the complaint internally, but cannot recover the plain code.
- **Changed settings and want defaults:** restore values in `#/admin/settings`,
  or use the disposable database reset.
