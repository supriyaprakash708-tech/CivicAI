import { config } from './config.js';
import { openDatabase, setDb } from './db.js';
import { ensureAdmin } from './auth.js';
import { createApp } from './app.js';
import { getAllSettings } from './db.js';
import { recomputeHotspots } from './services/hotspots.js';

const db = openDatabase(config.dbPath);
setDb(db);

const created = ensureAdmin(db);
if (created) {
  console.log('[civicai] Bootstrap administrator created:');
  console.log(`          email:    ${config.admin.email}`);
  console.log(`          password: ${config.admin.password}`);
  console.log('          Change this password in Settings after first login.');
}

// Keep hotspot records fresh on boot (cheap for prototype-scale data).
try {
  const result = recomputeHotspots(db, getAllSettings(db));
  console.log(`[civicai] Hotspots recalculated: ${result.clusters.length} cluster(s) from ${result.pointsUsed} geolocated reports.`);
} catch (err) {
  console.error('[civicai] Hotspot calculation failed on boot:', err.message);
}

const app = createApp(db);
const server = app.listen(config.port, () => {
  const aiMode = config.ai.apiKey ? `provider (${config.ai.model})` : 'local fallback rules (no AI_API_KEY configured)';
  console.log(`\n  CivicAI running at http://localhost:${config.port}`);
  console.log(`  Environment: ${config.env}`);
  console.log(`  AI mode: ${aiMode}`);
  console.log(`  Database: ${config.dbPath}\n`);
});

function shutdown(signal) {
  console.log(`\n[civicai] ${signal} received, closing…`);
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
