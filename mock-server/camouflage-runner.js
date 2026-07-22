/**
 * SkillsMine – Camouflage-compatible Mock Server Runner
 *
 * Implements the Camouflage .mock file format using Express + Handlebars.
 * Fully compatible with Node >= 22 (does not rely on http-deceiver / http_parser).
 *
 * .mock file format:
 *   HTTP/1.1 <STATUS_CODE> <REASON>
 *   Header-Name: header-value
 *   [blank line]
 *   body (Handlebars template)
 *
 * Run:  node mock-server/camouflage-runner.js
 */

import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { load as yamlLoad } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─────────────────────────────────────────────
// Load config
// ─────────────────────────────────────────────
const configPath = join(__dirname, 'config.yml');
const config     = yamlLoad(readFileSync(configPath, 'utf-8'));

const PORT      = config.server.port       ?? 4000;
const MOCKS_DIR = join(__dirname, config.server.mocksDir.replace('./mock-server/', ''));
const DELAY_MIN = config.delay.min         ?? 500;
const DELAY_MAX = config.delay.max         ?? 1500;
const ERR_RATE  = config.errorSimulation.enabled ? (config.errorSimulation.rate ?? 0.05) : 0;
const PUBLIC    = (config.auth.publicPaths ?? ['/auth/login']);

// ─────────────────────────────────────────────
// Handlebars helpers
// ─────────────────────────────────────────────
Handlebars.registerHelper('randomInt', (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min
);

Handlebars.registerHelper('now', (fmt) => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (fmt ?? 'YYYY-MM-DD')
    .replace('YYYY', d.getFullYear())
    .replace('MM',   pad(d.getMonth() + 1))
    .replace('DD',   pad(d.getDate()))
    .replace('HH',   pad(d.getHours()))
    .replace('mm',   pad(d.getMinutes()))
    .replace('ss',   pad(d.getSeconds()));
});

Handlebars.registerHelper('eq', (a, b) => a === b);

Handlebars.registerHelper('jsonStringify', (val) =>
  new Handlebars.SafeString(JSON.stringify(val ?? []))
);

// ─────────────────────────────────────────────
// In-memory session store  { token → user }
// ─────────────────────────────────────────────
const sessions = new Map();

// Pre-baked JWT payloads (base64url-encoded, no real crypto needed for mock)
const USERS = {
  'candidate@skillsmine.com': {
    sub: 'u1', email: 'candidate@skillsmine.com', role: 'candidate',
    firstName: 'Michael', lastName: 'Smith',
    permissions: ['VIEW_JOBS', 'APPLY_JOB'],
  },
  'recruiter@skillsmine.com': {
    sub: 'u2', email: 'recruiter@skillsmine.com', role: 'recruiter',
    firstName: 'Sarah', lastName: 'Johnson',
    permissions: ['MANDATE_CREATE', 'MANDATE_EDIT', 'PIPELINE_ADVANCE', 'CRM_EDIT', 'CANDIDATE_VIEW'],
  },
  'manco@skillsmine.com': {
    sub: 'u3', email: 'manco@skillsmine.com', role: 'manco',
    firstName: 'David', lastName: 'Botha',
    permissions: ['PIPELINE_VIEW', 'REPORT_VIEW'],
  },
  'exco@skillsmine.com': {
    sub: 'u4', email: 'exco@skillsmine.com', role: 'exco',
    firstName: 'Priya', lastName: 'Naidoo',
    permissions: ['REPORT_VIEW', 'EXECUTIVE_VIEW'],
  },
  'admin@skillsmine.com': {
    sub: 'u5', email: 'admin@skillsmine.com', role: 'admin',
    firstName: 'Admin', lastName: 'User',
    permissions: ['ALL'],
  },
};

const PASSWORDS = { 'Password123': true };  // all users share same mock password

function generateToken(user) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...user,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url');
  const sig = Buffer.from(`mock-${user.sub}-${Date.now()}`).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function decodeToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch { return null; }
}

// ─────────────────────────────────────────────
// .mock file parser
// ─────────────────────────────────────────────
function parseMockFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  // Split on first blank line to separate head from body
  const blankLine = raw.indexOf('\n\n');
  const head = blankLine !== -1 ? raw.slice(0, blankLine) : raw;
  const body = blankLine !== -1 ? raw.slice(blankLine + 2) : '';

  const lines  = head.split('\n');
  const status = parseInt(lines[0]?.match(/HTTP\/1\.1\s+(\d+)/)?.[1] ?? '200', 10);
  const headers = {};

  for (let i = 1; i < lines.length; i++) {
    const sep = lines[i].indexOf(':');
    if (sep === -1) continue;
    const key = lines[i].slice(0, sep).trim().toLowerCase();
    const val = lines[i].slice(sep + 1).trim();
    headers[key] = val;
  }

  return { status, headers, bodyTemplate: body };
}

// ─────────────────────────────────────────────
// Resolve a .mock file for a request
// ─────────────────────────────────────────────
function resolveMock(pathname, method) {
  // e.g. /auth/login  -> mock-server/mocks/auth/login/POST.mock
  const relative = pathname.replace(/^\//, '');
  const candidate = join(MOCKS_DIR, relative, `${method.toUpperCase()}.mock`);
  if (existsSync(candidate)) return candidate;
  return null;
}

// ─────────────────────────────────────────────
// Delay helper
// ─────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() {
  return delay(Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN);
}

// ─────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  config.cors.origins  ?? '*');
  res.header('Access-Control-Allow-Headers', config.cors.headers  ?? 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', config.cors.methods  ?? 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Normalise /api/* prefix
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    req.url = req.url.replace('/api/', '/');
  }
  next();
});

// Delay + error injection + auth guard
app.use(async (req, res, next) => {
  const pathname = req.path;

  // Simulated network delay
  await randomDelay();

  const isPublic = PUBLIC.some(p => pathname === p || pathname.startsWith(p));

  // Random error injection (authenticated routes only)
  if (!isPublic && Math.random() < ERR_RATE) {
    const errors = [
      { status: 401, error: 'Unauthorized – session expired',        injected: true },
      { status: 403, error: 'Forbidden – insufficient permissions',  injected: true },
      { status: 500, error: 'Internal server error – please retry',  injected: true },
    ];
    const err = errors[Math.floor(Math.random() * errors.length)];
    console.log(`[INJECT] ${err.status} → ${req.method} ${pathname}`);
    return res.status(err.status).json(err);
  }

  // Auth guard
  if (!isPublic) {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token || !sessions.has(token)) {
      return res.status(401).json({ error: 'Not authenticated. Please login first.' });
    }
    req.currentUser = sessions.get(token);
  }

  next();
});

// ── POST /auth/login ─────────────────────────
app.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required.' });

  const user = USERS[email?.toLowerCase()];
  if (!user || !PASSWORDS[password])
    return res.status(401).json({ error: 'Invalid email or password.' });

  const token = generateToken(user);
  sessions.set(token, user);
  console.log(`[AUTH] Login : ${user.email} (${user.role})`);

  const { sub, iat, exp, ...safeUser } = user;
  return res.status(200).json({ token, user: { id: user.sub, ...safeUser }, expiresIn: 86400 });
});

// ── GET /auth/me ─────────────────────────────
app.get('/auth/me', (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  const { sub, iat, exp, ...safeUser } = user;
  return res.status(200).json({ user: { id: user.sub, ...safeUser } });
});

// ── POST /auth/logout ────────────────────────
app.post('/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token && sessions.has(token)) {
    const user = sessions.get(token);
    sessions.delete(token);
    console.log(`[AUTH] Logout: ${user.email}`);
  }
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// ── Catch-all → .mock file handler ──────────
app.all('*', (req, res) => {
  const mockFile = resolveMock(req.path, req.method);

  if (!mockFile) {
    console.warn(`[404] No mock: ${req.method} ${req.path}`);
    return res.status(404).json({
      error: `No mock defined for ${req.method} ${req.path}`,
      hint: `Create mock-server/mocks${req.path}/${req.method.toUpperCase()}.mock`,
    });
  }

  try {
    const { status, headers, bodyTemplate } = parseMockFile(mockFile);

    // Build template context
    const user = req.currentUser ?? {};
    const context = {
      request: {
        body:    req.body ?? {},
        query:   req.query ?? {},
        headers: req.headers ?? {},
        method:  req.method,
        path:    req.path,
      },
      user,
    };

    const rendered = Handlebars.compile(bodyTemplate)(context).trim();

    // Set headers
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
    if (!headers['content-type']) res.setHeader('content-type', 'application/json');

    console.log(`[MOCK] ${req.method} ${req.path} → ${status} (${mockFile.replace(MOCKS_DIR, '')})`);
    res.status(status).send(rendered);
  } catch (err) {
    console.error(`[ERROR] Failed to render mock: ${mockFile}`, err.message);
    res.status(500).json({ error: 'Mock render error', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    SkillsMine Camouflage Mock Server              ║');
  console.log(`║    http://localhost:${PORT}                         ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  POST  /api/auth/login        (public)            ║');
  console.log('║  GET   /api/auth/me                               ║');
  console.log('║  POST  /api/auth/logout                           ║');
  console.log('║  GET   /api/opportunities     (public)            ║');
  console.log('║  GET   /api/candidates  /api/jobs                 ║');
  console.log('║  POST  /api/jobs  /api/mandates  /api/crm         ║');
  console.log('║  GET   /api/pipeline  /api/mandates  /api/crm     ║');
  console.log('║  PATCH /api/pipeline                              ║');
  console.log('║  GET   /api/dashboard/recruiter|candidate         ║');
  console.log('║  GET   /api/dashboard/manco|exco                  ║');
  console.log(`║  Delay : ${DELAY_MIN}–${DELAY_MAX} ms  │  Error rate : ${ERR_RATE * 100}%         ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
