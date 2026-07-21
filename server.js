// SkillsMine Mock API Server
// Self-contained — run with: npm start  (requires Node >= 22.12)
// Base URL: http://localhost:4000

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from 'json-server/lib/app.js';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const PORT = 4000;
const DB_PATH = join(__dirname, 'db.json');

const DELAY_MIN = 500;   // ms
const DELAY_MAX = 1500;  // ms
const ERROR_RATE = 0.05; // 5 % of authenticated requests

const PUBLIC_PATHS = ['/auth/login'];

// ─────────────────────────────────────────────
// Mock JWT helpers  (no real crypto needed)
// ─────────────────────────────────────────────
function generateToken(user) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url');
  const sig = Buffer.from(`mock-${user.id}-${Date.now()}`).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function decodeToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

// In-memory session store  { token → user }
const sessions = new Map();

// ─────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function loadDb() {
  return JSON.parse(readFileSync(DB_PATH, 'utf-8'));
}

// ─────────────────────────────────────────────
// Build json-server app (lowdb-backed)
// ─────────────────────────────────────────────
async function buildJsonServerApp() {
  const adapter = new JSONFile(DB_PATH);
  const db = new Low(adapter, {});
  await db.read();
  return createApp(db);
}

const jsApp = await buildJsonServerApp();

// ─────────────────────────────────────────────
// Random delay
// ─────────────────────────────────────────────
function randomDelay() {
  return new Promise(r =>
    setTimeout(r, Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN)
  );
}

// ─────────────────────────────────────────────
// Main request handler
// ─────────────────────────────────────────────
async function handler(req, res) {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // Normalise /api/* prefix -> /*
  if (pathname.startsWith('/api/')) {
    pathname = pathname.slice(4);
    req.url  = pathname + (url.search || '');
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  // Simulated network delay
  await randomDelay();

  // Random error injection (skip public routes)
  if (!PUBLIC_PATHS.includes(pathname) && Math.random() < ERROR_RATE) {
    const errors = [
      { status: 401, message: 'Unauthorized - session expired' },
      { status: 403, message: 'Forbidden - insufficient permissions' },
      { status: 500, message: 'Internal server error - please try again' },
    ];
    const err = errors[Math.floor(Math.random() * errors.length)];
    console.log(`[INJECT] ${err.status} -> ${req.method} ${pathname}`);
    return sendJson(res, err.status, { error: err.message, injected: true });
  }

  // Auth guard
  if (!PUBLIC_PATHS.includes(pathname)) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token || !sessions.has(token)) {
      return sendJson(res, 401, { error: 'Not authenticated. Please login first.' });
    }
    req.currentUser = sessions.get(token);
  }

  // ── POST /auth/login ─────────────────────────
  if (pathname === '/auth/login' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch { return sendJson(res, 400, { error: 'Invalid request body.' }); }

    const { email, password } = body;
    if (!email || !password) {
      return sendJson(res, 400, { error: 'email and password are required.' });
    }

    const db   = loadDb();
    const user = db.users.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!user) return sendJson(res, 401, { error: 'Invalid email or password.' });

    const token = generateToken(user);
    sessions.set(token, user);
    console.log(`[AUTH] Login : ${user.email} (${user.role})`);

    const { password: _pw, ...safeUser } = user;
    return sendJson(res, 200, { token, user: safeUser, expiresIn: 86400 });
  }

  // ── GET /auth/me ─────────────────────────────
  if (pathname === '/auth/me' && req.method === 'GET') {
    const user = req.currentUser;
    if (!user) return sendJson(res, 401, { error: 'Not authenticated.' });
    const { password: _pw, ...safeUser } = user;
    return sendJson(res, 200, { user: safeUser });
  }

  // ── POST /auth/logout ────────────────────────
  if (pathname === '/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && sessions.has(token)) {
      const user = sessions.get(token);
      sessions.delete(token);
      console.log(`[AUTH] Logout: ${user.email}`);
    }
    return sendJson(res, 200, { message: 'Logged out successfully.' });
  }

  // ── Dashboard pre-shaped endpoints ───────────
  const dashboardMap = {
    '/dashboard/recruiter': 'dashboard_recruiter',
    '/dashboard/candidate': 'dashboard_candidate',
    '/dashboard/exco':      'dashboard_exco',
  };
  if (req.method === 'GET' && dashboardMap[pathname]) {
    const db = loadDb();
    return sendJson(res, 200, db[dashboardMap[pathname]]);
  }

  // ── All other routes -> json-server (lowdb) ──
  jsApp.handler(req, res);
}

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
const httpServer = createServer(handler);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       SkillsMine Mock API Server                  ║');
  console.log(`║       http://localhost:${PORT}                      ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  POST  /auth/login          (public)              ║');
  console.log('║  GET   /auth/me                                   ║');
  console.log('║  POST  /auth/logout                               ║');
  console.log('║  GET   /candidates  /jobs  /applications          ║');
  console.log('║  GET   /pipeline  /mandates  /crm                 ║');
  console.log('║  GET   /dashboard/recruiter|candidate|exco        ║');
  console.log('║  * All /api/* routes also work                    ║');
  console.log('║  Network delay : 500 - 1500 ms                   ║');
  console.log('║  Error rate    : 5 % of requests                 ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
