/**
 * Development-only synthetic data generator.
 *
 * Usage:
 *   node server/seed.js                 # replace synthetic records, keep real data
 *   node server/seed.js --reset-synthetic   # delete synthetic records only
 *
 * All records are flagged is_synthetic = 1 and the UI labels them "Synthetic
 * demo record". Production deployments are refused unless explicitly allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, TEAM_BY_CATEGORY, STATUS_LABELS } from './config.js';
import { openDatabase, getAllSettings } from './db.js';
import { ensureAdmin } from './auth.js';
import { hashPassword, verifyPassword } from './auth.js';
import { processComplaint } from './services/pipeline.js';
import { recomputeHotspots } from './services/hotspots.js';
import { nowIso, newPublicId, newTrackingCode, hashTrackingCode, randomToken } from './util.js';

const args = process.argv.slice(2);
const resetOnly = args.includes('--reset-synthetic');
if (config.isProduction && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
  console.error('Refusing to seed in NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true only for an intentional demo environment.');
  process.exit(1);
}

const db = openDatabase(config.dbPath);
const adminCreated = ensureAdmin(db);
const admin = db.get("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");

function ensureCitizen() {
  const email = 'citizen@civicai.local';
  let user = db.get('SELECT * FROM users WHERE email = ?', email);
  if (!user) {
    const info = db.run(
      "INSERT INTO users (email, name, role, status, password_hash, created_at) VALUES (?, ?, 'citizen', 'active', ?, ?)",
      email, 'Demo Citizen', hashPassword('Citizen@2026'), nowIso()
    );
    user = db.get('SELECT * FROM users WHERE id = ?', Number(info.lastInsertRowid));
  }
  return user;
}

function removeSynthetic() {
  const ids = db.all('SELECT id FROM complaints WHERE is_synthetic = 1').map((r) => r.id);
  if (!ids.length) return { complaints: 0, files: 0 };
  let files = 0;
  for (const row of db.all('SELECT image_path FROM complaints WHERE is_synthetic = 1 AND image_path IS NOT NULL')) {
    try { fs.unlinkSync(path.join(config.uploadDir, path.basename(row.image_path))); files += 1; } catch { /* ignore */ }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.run('DELETE FROM complaints WHERE is_synthetic = 1');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { complaints: ids.length, files };
}

if (resetOnly) {
  const removed = removeSynthetic();
  try { recomputeHotspots(db, getAllSettings(db)); } catch { /* ignore */ }
  console.log(`Removed ${removed.complaints} synthetic complaint(s) and ${removed.files} synthetic image(s). Real records were not touched.`);
  db.close();
  process.exit(0);
}

const existing = db.get('SELECT COUNT(*) n FROM complaints').n;
if (existing > 0 && db.get('SELECT COUNT(*) n FROM complaints WHERE is_synthetic = 0').n > 0) {
  console.log('[seed] Real (non-synthetic) records exist. They will be preserved; only synthetic records are replaced.');
}
const removed = removeSynthetic();
if (removed.complaints) console.log(`[seed] Removed ${removed.complaints} previous synthetic complaint(s).`);

const citizen = ensureCitizen();
const now = Date.now();
const hours = (h) => h * 3600000;

const CLUSTERS = {
  mainRoad: { lat: 22.5726, lng: 88.3639 },
  northMarket: { lat: 22.5905, lng: 88.351 },
  westfield: { lat: 22.556, lng: 88.376 },
  eastDepot: { lat: 22.58, lng: 88.39 },
  oldTown: { lat: 22.565, lng: 88.345 },
  scattered: { lat: 22.574, lng: 88.37 },
};

function jitter(base, index, spread = 0.0022) {
  const angle = (index * 137.5 * Math.PI) / 180;
  const radius = spread * (0.35 + (index % 5) * 0.16);
  return {
    lat: Number((base.lat + Math.cos(angle) * radius).toFixed(6)),
    lng: Number((base.lng + Math.sin(angle) * radius * 1.2).toFixed(6)),
  };
}

/** 46 fictional reports across 5 neighbourhood clusters, with deliberate duplicate groups. */
const SPECS = [
  // --- Main Road / Riverside: drainage + road damage cluster ---
  { cluster: 'mainRoad', area: 'Riverside', address: 'Main Road underpass, Riverside', daysAgo: 18, category: null, status: 'in_progress',
    description: 'Waterlogging near the Main Road underpass after every rain. The water is knee-deep, pedestrians cannot cross and two cars stalled last week. This has been happening for two weeks.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Main Road bus stand, Riverside', daysAgo: 16, category: null, status: 'assigned',
    description: 'Blocked drain causing waterlogging near Main Road. The drain outside the bus stand is full of silt and water overflows onto the road. About 200 residents are affected.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Near Main Road bus stand, Riverside', daysAgo: 5, category: null, status: 'under_review',
    description: 'Drain near Main Road bus stand is blocked and overflowing. Stagnant water has been standing for four days and mosquitoes are breeding. The smell is very bad.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Main Road near underpass, Riverside', daysAgo: 12, category: 'roads', status: 'in_progress',
    description: 'Large pothole on Main Road near the underpass. It is deep and two-wheelers are swerving into traffic. It is very dangerous at night.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Main Road underpass, Riverside', daysAgo: 4, category: 'roads', status: 'under_review',
    description: 'Deep pothole near the Main Road underpass is causing accidents. A cyclist fell yesterday and the hole is getting bigger.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Riverside Lane', daysAgo: 30, category: 'infrastructure', status: 'resolved',
    description: 'Road surface near Riverside Lane is cracked and sinking after the drainage work. The edge of the road is breaking away.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Riverside Primary School, Main Road', daysAgo: 3, category: 'safety', status: 'assigned',
    description: 'Storm drain cover is missing near Riverside Primary School. Children walk past the open drain every morning. It is very dangerous.' },
  { cluster: 'mainRoad', area: 'Riverside', address: 'Main Road, near Riverside clinic', daysAgo: 9, category: null, status: 'resolved',
    description: 'Water pipe leaking on Main Road for five days. Drinking water is being wasted and the road is eroding around the leak.' },

  // --- North Market: waste cluster ---
  { cluster: 'northMarket', area: 'North Market', address: 'Sunrise Apartments, North Market', daysAgo: 22, category: null, status: 'resolved',
    description: 'Garbage has been overflowing outside Sunrise Apartments for four days, causing a bad smell and attracting insects. Residents cannot open their windows.' },
  { cluster: 'northMarket', area: 'North Market', address: 'Sunrise Apartments, North Market', daysAgo: 6, category: null, status: 'under_review',
    description: 'Overflowing garbage bins outside Sunrise Apartments. Waste has not been collected for a week and there is a terrible smell. Insects are coming into the building.' },
  { cluster: 'northMarket', area: 'North Market', address: 'Market footpath, North Market', daysAgo: 14, category: 'waste', status: 'assigned',
    description: 'Garbage dumped on the footpath near North Market. Shoppers cannot use the pavement and stray dogs are tearing open the bags.' },
  { cluster: 'northMarket', area: 'North Market', address: 'Vegetable market, North Market', daysAgo: 8, category: null, status: 'submitted',
    description: 'Market waste collection van has not arrived for three days. Bins behind the vegetable market are full and waste is spilling onto the street.' },
  { cluster: 'northMarket', area: 'North Market', address: 'North Market garbage point', daysAgo: 2, category: 'safety', status: 'assigned',
    description: 'Dead animal near the North Market garbage point. There is a strong smell and swarms of flies near the food stalls.' },
  { cluster: 'northMarket', area: 'North Market', address: 'Public toilet, North Market', daysAgo: 25, category: 'infrastructure', status: 'resolved',
    description: 'The public toilet near North Market is overflowing and unusable. Customers at the market have no facility nearby.' },
  { cluster: 'northMarket', area: 'North Market', address: 'North Market gate', daysAgo: 11, category: 'streetlights', status: 'in_progress',
    description: 'Streetlight outside the North Market gate has been dark for a week. Shops close early because the lane is unsafe after sunset.' },

  // --- Westfield Colony: streetlights + electrical hazards ---
  { cluster: 'westfield', area: 'Westfield Colony', address: 'Westfield Colony main lane', daysAgo: 20, category: null, status: 'in_progress',
    description: 'Streetlights on Westfield Colony main lane are not working for the past ten days. The whole stretch is dark at night and women feel unsafe walking home.' },
  { cluster: 'westfield', area: 'Westfield Colony', address: 'Westfield Colony main lane', daysAgo: 5, category: 'streetlights', status: 'under_review',
    description: 'Three streetlights on Westfield Colony main lane near the park are broken. The stretch is completely dark at night and there was an attempted robbery last week.' },
  { cluster: 'westfield', area: 'Westfield Colony', address: 'Westfield Colony bus stop', daysAgo: 0.2, category: 'safety', status: 'submitted',
    description: 'A live electrical wire has fallen across the road near Westfield Colony bus stop. People are stepping over it and a child almost touched it. Extremely dangerous.' },
  { cluster: 'westfield', area: 'Westfield Colony', address: 'Westfield Colony lane 3', daysAgo: 7, category: 'safety', status: 'assigned',
    description: 'Electric pole near Westfield Colony lane 3 is leaning dangerously after the storm. Wires are hanging low over the footpath where children walk.' },
  { cluster: 'westfield', area: 'Westfield Colony', address: 'Westfield playground', daysAgo: 15, category: null, status: 'resolved',
    description: 'Streetlight pole near Westfield playground is rusted and about to fall. The base is cracked and it is next to the swings.' },
  { cluster: 'westfield', area: 'Westfield Colony', address: 'Westfield Colony park', daysAgo: 10, category: 'safety', status: 'awaiting_information',
    description: 'Stray dogs in Westfield Colony park are aggressive. Children play there in the evening and one child was chased last week.' },

  // --- East Depot: water supply cluster ---
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot blocks A-D', daysAgo: 19, category: 'water', status: 'resolved',
    description: 'No water supply in East Depot for four days. More than 300 families are buying tanker water and some have not bathed since Monday.' },
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot blocks A-D', daysAgo: 12, category: null, status: 'assigned',
    description: 'Water supply pressure is very low in East Depot since last week. Taps are dry most of the day and residents have to queue at night.' },
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot railway crossing', daysAgo: 3, category: 'water', status: 'in_progress',
    description: 'Water pipeline burst near East Depot railway crossing. Water has been flooding the road for hours and is being wasted.' },
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot block B', daysAgo: 1, category: null, status: 'under_review',
    description: 'Muddy brown water is coming from the taps in East Depot since yesterday. Residents fear the water is contaminated and children are refusing to drink it.' },
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot community hall', daysAgo: 28, category: 'water', status: 'resolved',
    description: 'Public tap near East Depot community hall is broken and leaking continuously. The surrounding ground is always flooded.' },
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot block C', daysAgo: 2, category: 'safety', status: 'assigned',
    description: 'Sewage water is mixing with the drinking water line near East Depot block C. Several children have fallen sick with stomach problems.' },
  { cluster: 'eastDepot', area: 'East Depot', address: 'East Depot lane 4', daysAgo: 16, category: 'drainage', status: 'resolved',
    description: 'Drain is overflowing in East Depot lane 4. Black water has been on the street for three days and the smell is unbearable.' },

  // --- Old Town: infrastructure cluster ---
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town square', daysAgo: 34, category: 'infrastructure', status: 'resolved',
    description: 'A small section of paint is peeling from a public bench in Old Town square. One plank is also slightly loose.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town park boundary', daysAgo: 13, category: null, status: 'in_progress',
    description: 'The park boundary wall in Old Town is cracked and could collapse onto the footpath. Bricks are already falling near the gate.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town park', daysAgo: 6, category: 'infrastructure', status: 'assigned',
    description: 'Playground swing chain in Old Town park is broken. Children are still using the swing and it could give way.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town bus shelter', daysAgo: 17, category: null, status: 'under_review',
    description: 'Bus shelter roof in Old Town is damaged and leaks during rain. Waiting passengers, including elderly people, have no shade.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town lane 2, near temple', daysAgo: 1, category: 'safety', status: 'submitted',
    description: 'Open manhole on Old Town lane 2 near the temple. It is unmarked and a scooter fell in last night. Nobody has put up a warning.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town lane 2, near temple', daysAgo: 0.5, category: 'safety', status: 'under_review',
    description: 'Open manhole cover on Old Town lane 2 near the temple is unmarked. Children walking to school could fall in and a scooter already fell in last night.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town community centre', daysAgo: 40, category: 'other', status: 'resolved',
    description: 'Graffiti and broken signage at the Old Town community centre. The notice board is also hanging loose.' },
  { cluster: 'oldTown', area: 'Old Town', address: 'Old Town walking path', daysAgo: 21, category: null, status: 'reopened',
    description: 'Public park lights are out and the walking path is uneven. Elderly residents are avoiding the park because they fear falling.' },

  // --- Scattered locations ---
  { cluster: 'scattered', area: 'Hospital District', address: 'Approach road, Riverport General Hospital', daysAgo: 8, category: 'roads', status: 'assigned',
    description: 'Potholes on the approach road to Riverport General Hospital. Ambulances are delayed and patients complain of pain when transported.' },
  { cluster: 'scattered', area: 'School District', address: 'Riverport school crossing', daysAgo: 9, category: null, status: 'under_review',
    description: 'The speed breaker near Riverport school is broken and invisible at night. Cars speed past the crossing where children walk.' },
  { cluster: 'scattered', area: 'Dock Road', address: 'Riverbank behind Dock Road', daysAgo: 4, category: 'waste', status: 'assigned',
    description: 'Garbage is being burnt near the riverbank behind Dock Road. Thick smoke is entering nearby homes and there is a strong plastic smell.' },
  { cluster: 'scattered', area: 'Dock Road', address: 'Riverport railway station taxi rank', daysAgo: 23, category: 'streetlights', status: 'resolved',
    description: 'Streetlight outside Riverport railway station taxi rank is flickering and then goes dark. Drivers cannot see passengers at night.' },
  { cluster: 'scattered', area: 'Dock Road', address: 'Dock Road', daysAgo: 2, category: null, status: 'submitted',
    description: 'The water tanker promised for Dock Road did not arrive. Residents have had no water for two days and the nearest public tap is closed.' },
  { cluster: 'scattered', area: 'Civic Centre', address: 'Riverport library footpath', daysAgo: 27, category: 'infrastructure', status: 'resolved',
    description: 'Broken footpath tiles near Riverport library cause a tripping hazard. An elderly man fell last week.' },
  { cluster: 'scattered', area: 'Dock Road', address: 'Riverbank near Dock Road', daysAgo: 33, category: 'waste', status: 'rejected',
    description: 'Illegal dumping of construction debris on the riverbank near Dock Road. Trucks unload material at night.' },
  { cluster: 'scattered', area: 'Civic Centre', address: 'Riverport clinic', daysAgo: 5, category: null, status: 'awaiting_information',
    description: 'Sewer smell outside Riverport clinic is very strong and patients are complaining. The smell seems to come from the covered drain.' },
  { cluster: 'scattered', area: 'North Market', address: 'Lane behind Riverport market', daysAgo: 6, category: 'other', status: 'awaiting_information',
    description: 'An abandoned vehicle is blocking the lane behind Riverport market. Delivery carts cannot pass and the owner cannot be found.' },
  { cluster: 'scattered', area: 'Dock Road', address: 'Railway bridge, Dock Road', daysAgo: 11, category: 'drainage', status: 'in_progress',
    description: 'Waterlogging under the railway bridge on Dock Road after rain. Cars are stalling and the water does not drain for hours.' },
];

const RESOLUTIONS = {
  2: 'Surface patch completed and the road edge was rebuilt. The contractor was asked to inspect the adjacent lane.',
  7: 'Leaking section replaced by the water utility and the eroded shoulder was filled and compacted.',
  8: 'Accumulated waste cleared, bins washed and collection schedule restored. Public health team visited the site.',
  13: 'The public toilet was cleared, repaired and reopened. Daily cleaning has been scheduled pending a longer-term review.',
  19: 'Rusted pole replaced and the playground area was made safe.',
  21: 'Supply restored after a valve repair; affected blocks were informed through the local office.',
  25: 'Leaking public tap replaced and the surrounding surface drained.',
  26: 'Drain line cleared and disinfected; the crew reported heavy silt build-up from nearby construction.',
  28: 'Loose plank and peeling paint repaired as routine maintenance. No structural issue was found.',
  32: 'Graffiti removed and the notice board re-secured.',
  38: 'Flickering lamp and faulty connection replaced; taxi rank lighting was tested the same evening.',
  40: 'Footpath tiles replaced and the surface levelled.',
};

const people = ['A. Rahman', 'S. Iyer', 'M. Das', 'P. Nguyen', 'J. Okafor', 'L. Fernandes'];
const statusOrder = ['submitted', 'under_review', 'assigned', 'in_progress', 'resolved'];

function insertComplaint(spec, index) {
  const cluster = CLUSTERS[spec.cluster];
  const pos = jitter(cluster, index);
  const createdAt = new Date(now - spec.daysAgo * 86400000 - (index % 6) * hours(3)).toISOString();
  const publicId = newPublicId(new Date(createdAt));
  const trackingCode = newTrackingCode();
  const team = ['assigned', 'in_progress', 'resolved', 'reopened'].includes(spec.status)
    ? TEAM_BY_CATEGORY[spec.category || 'other'] || 'General Operations'
    : null;
  const assignee = team ? people[index % people.length] : null;
  const resolvedAt = spec.status === 'resolved'
    ? new Date(Math.min(now - hours(2), new Date(createdAt).getTime() + (2 + (index % 5)) * 86400000)).toISOString()
    : null;
  const info = db.run(
    `INSERT INTO complaints
       (public_id, tracking_hash, user_id, description, category, category_source, address, area, lat, lng,
        status, assigned_team, assigned_to, assigned_at, resolution_details, resolved_at,
        reporter_name, reporter_contact, is_synthetic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    publicId, hashTrackingCode(trackingCode),
    index % 4 === 0 ? citizen.id : null,
    spec.description,
    spec.category || 'other',
    spec.category ? 'citizen' : 'ai',
    spec.address, spec.area, pos.lat, pos.lng,
    spec.status, team, assignee, team ? createdAt : null,
    spec.status === 'resolved' ? RESOLUTIONS[index] || 'Issue resolved after on-site inspection.' : null,
    resolvedAt,
    index % 3 === 0 ? 'Demo Citizen' : null,
    index % 3 === 0 ? 'citizen@example.invalid' : null,
    createdAt, createdAt
  );
  const id = Number(info.lastInsertRowid);
  const resolved = spec.status === 'resolved';
  db.run(
    `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
     VALUES (?, NULL, 'submitted', NULL, 'Citizen', 'Complaint received and queued for review.', NULL, ?)`,
    id, createdAt
  );
  return { id, publicId, trackingCode, createdAt, resolvedAt, spec, team, assignee, resolved };
}

const created = [];
SPECS.forEach((spec, index) => created.push(insertComplaint(spec, index)));

// Process every synthetic complaint through the real AI/heuristic pipeline.
console.log(`[seed] Processing ${created.length} complaints through the AI pipeline (local rules fallback)…`);
for (const item of created) {
  const result = await processComplaint(db, item.id, { recomputeClusters: false });
  if (result.aiStatus === 'failed') console.warn(`  ! processing failed for ${item.publicId}: ${result.error}`);
}
db.run("UPDATE complaints SET is_synthetic = 1 WHERE id IN (" + created.map(() => '?').join(',') + ')', ...created.map((c) => c.id));

// Simulated administrative workflow: timestamped history, assignments, resolutions.
for (const item of created) {
  const { id, spec, createdAt } = item;
  const targetIndex = statusOrder.indexOf(spec.status);
  const start = new Date(createdAt).getTime();
  const steps = [];
  if (targetIndex >= 1) steps.push('under_review');
  if (targetIndex >= 2) steps.push('assigned');
  if (targetIndex >= 3) steps.push('in_progress');
  if (targetIndex >= 4) steps.push('resolved');
  if (spec.status === 'rejected') steps.push('rejected');
  if (spec.status === 'awaiting_information') steps.push('awaiting_information');
  if (spec.status === 'reopened') steps.push('reopened');
  let previous = 'submitted';
  steps.forEach((status, i) => {
    const at = new Date(start + (i + 1) * hours(10 + i * 4)).toISOString();
    const publicUpdate = {
      under_review: 'Report reviewed by the civic team and prioritised.',
      assigned: `Assigned to ${item.team || 'the responsible team'}.`,
      in_progress: 'Field team has started work at the location.',
      resolved: `Resolved. ${RESOLUTIONS[created.indexOf(item)] || 'Work completed after inspection.'}`,
      rejected: 'This report was reviewed and could not be accepted. Contact the civic office for details.',
      awaiting_information: 'More information is needed from the reporter before work can proceed.',
      reopened: 'The report was reopened after a follow-up inspection found the issue persists.',
    }[status];
    db.run(
      `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
       VALUES (?, ?, ?, ?, 'City Administrator (administrator)', ?, ?, ?)`,
      id, previous, status, admin.id, publicUpdate,
      status === 'rejected' ? 'Rejected in demo data: location/ownership outside municipal scope.' : null,
      at
    );
    previous = status;
  });
  if (steps.length) {
    const lastAt = new Date(start + steps.length * hours(14)).toISOString();
    db.run('UPDATE complaints SET updated_at = ? WHERE id = ?', lastAt, id);
  }
  if (spec.status === 'resolved') {
    db.run(
      `UPDATE complaints SET resolved_at = ?, resolution_details = ? WHERE id = ?`,
      item.resolvedAt || new Date(start + 3 * 86400000).toISOString(),
      RESOLUTIONS[created.indexOf(item)] || 'Issue resolved after on-site inspection.',
      id
    );
  }
  if (spec.status === 'rejected') {
    db.run("UPDATE complaints SET assigned_team = NULL, assigned_to = NULL WHERE id = ?", id);
    db.run(
      `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
       VALUES (?, 'citizen', 'status', ?, ?, ?)`,
      id, 'Report closed after review', 'This report was reviewed and could not be accepted.', new Date(start + 86400000).toISOString()
    );
  }
}

// Demonstrate human priority overrides (with recorded reasons) on two records.
const overrideTargets = [
  { publicId: created[12]?.publicId, priority: 'high', reason: 'Public-health risk next to food stalls; advanced for inspection despite medium automated score.' },
  { publicId: created[35]?.publicId, priority: 'high', reason: 'Ambulance access is affected; escalated after a call with the hospital transport office.' },
];
for (const target of overrideTargets) {
  if (!target.publicId) continue;
  const row = db.get('SELECT id FROM complaints WHERE public_id = ?', target.publicId);
  if (!row) continue;
  db.run(
    `UPDATE complaints SET final_priority = ?, priority_overridden_by = ?, priority_override_reason = ?,
       priority_overridden_at = ?, priority_review_required = 0 WHERE id = ?`,
    target.priority, admin.id, target.reason, nowIso(), row.id
  );
  db.run(
    `INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, details, ip, created_at)
     VALUES (?, 'City Administrator (administrator)', 'complaint.priority_overridden', 'complaint', ?, ?, NULL, ?)`,
    admin.id, String(row.id),
    JSON.stringify({ to: target.priority, reason: target.reason, note: 'Seeded demonstration override' }),
    nowIso()
  );
}

// Confirm one duplicate pair as merged (records preserved) and reject one.
const pending = db.all(
  `SELECT d.* FROM duplicate_links d JOIN complaints p ON p.id = d.primary_id
    WHERE d.status = 'pending' AND p.is_synthetic = 1 ORDER BY d.similarity DESC`
);
let mergedCount = 0;
if (pending.length) {
  const top = pending[0];
  // Preserve the older report as the primary record and merge the newer one into it.
  const primary = db.get('SELECT * FROM complaints WHERE id = ?', top.related_id);
  const secondary = db.get('SELECT * FROM complaints WHERE id = ?', top.primary_id);
  if (primary && secondary && !primary.merged_into_id && !secondary.merged_into_id) {
    const at = nowIso();
    db.run(
      `UPDATE duplicate_links SET status = 'confirmed', reviewed_by = ?, reviewed_at = ?, review_note = ?
        WHERE id = ?`,
      admin.id, at, 'Seeded example: same issue and location confirmed on site.', top.id
    );
    db.run('UPDATE complaints SET merged_into_id = ?, updated_at = ? WHERE id = ?', primary.id, at, secondary.id);
    db.run(
      `INSERT INTO status_history (complaint_id, from_status, to_status, changed_by, actor_label, public_update, internal_note, created_at)
       VALUES (?, ?, ?, ?, 'City Administrator (administrator)', ?, ?, ?)`,
      secondary.id, secondary.status, secondary.status, admin.id,
      `Confirmed as a duplicate of ${primary.public_id}. The original report has been preserved.`,
      'Seeded merge for demonstration.', at
    );
    db.run(
      `INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, details, ip, created_at)
       VALUES (?, 'City Administrator (administrator)', 'duplicate.merge', 'duplicate_link', ?, ?, NULL, ?)`,
      admin.id, String(top.id),
      JSON.stringify({ primary: primary.public_id, secondary: secondary.public_id, note: 'Seeded demonstration merge' }), at
    );
    mergedCount = 1;
  }
}
const rejectCandidate = null;
if (rejectCandidate) {
  db.run(
    `UPDATE duplicate_links SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?
      WHERE id = ?`,
    admin.id, nowIso(), 'Seeded example: similar wording but different location and issue. Reviewed and rejected.', rejectCandidate.id
  );
}

const settings = getAllSettings(db);
try { recomputeHotspots(db, settings); } catch (err) { console.warn('[seed] hotspot error', err.message); }
const hotspots = db.get('SELECT COUNT(*) n FROM hotspots').n;
const dupPending = db.get("SELECT COUNT(*) n FROM duplicate_links WHERE status = 'pending'").n;
const dupConfirmed = db.get("SELECT COUNT(*) n FROM duplicate_links WHERE status = 'confirmed'").n;

console.log('\n  Synthetic demo data ready.');
console.log(`  Complaints:        ${created.length}`);
console.log(`  Duplicate pending: ${dupPending}`);
console.log(`  Duplicate merged:  ${dupConfirmed + mergedCount > 0 ? '1 confirmed merge (records preserved)' : 'none'}`);
console.log(`  Hotspots:          ${hotspots}`);
console.log(`  Admin login:       ${admin.email} / ${config.admin.password}${adminCreated ? ' (new)' : ''}`);
console.log(`  Citizen login:     citizen@civicai.local / Citizen@2026`);
console.log(`  Tracking code example: ${created[0].publicId} / ${created[0].trackingCode}\n`);
console.log('  All seeded records are labelled synthetic. Remove them with: npm run seed:reset\n');

if (!verifyPassword(config.admin.password, admin.password_hash)) {
  console.log('  Note: the administrator password differs from ADMIN_PASSWORD because it was changed earlier.');
}

db.close();
