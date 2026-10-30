/**
 * Test environment. This module MUST be imported before any server module so
 * that config.js reads deterministic test values (no provider key, isolated
 * uploads, trusted proxy header used to give each test its own rate-limit IP).
 */
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.AI_API_KEY = '';
process.env.AI_IMAGE_ANALYSIS = 'false';
process.env.AI_ENABLED = 'true';
process.env.TRUST_PROXY = 'true';
process.env.SESSION_SECRET = 'civicai-test-session-secret';
process.env.TRACKING_SECRET = 'civicai-test-tracking-secret';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `civicai-test-uploads-${process.pid}`);
process.env.DB_PATH = path.join(os.tmpdir(), `civicai-test-db-${process.pid}.db`);
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Test Administrator';
