/**
 * SkillsMine – Camouflage-compatible Mock Server Runner
 *
 * This file is BOOTSTRAP ONLY.
 * All route logic lives in mock-server/routes/:
 *
 *   routes/auth.js         POST /auth/login | GET /auth/me | POST /auth/logout
 *   routes/candidates.js   /candidates/*
 *   routes/jobs.js         /jobs/* + GET /opportunities
 *   routes/recruiters.js   /recruiters/*
 *   routes/manco.js        /manco/*
 *   routes/crm.js          /crm/*
 *
 * Data files (loaded once at startup, mutated in-memory):
 *   data/candidates.json   data/jobs.json    data/recruiters.json
 *   data/crm-clients.json  data/applications.json
 *
 * Run:  node mock-server/camouflage-runner.js
 */

import express                                        from 'express';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname }                              from 'node:path';
import { fileURLToPath }                              from 'node:url';
import Handlebars                                     from 'handlebars';
import { load as yamlLoad }                           from 'js-yaml';

import { authRouter }                                 from './routes/auth.js';
import { candidatesRouter }                           from './routes/candidates.js';
import { jobsRouter, opportunitiesRouter }            from './routes/jobs.js';
import { recruitersRouter, candidateActionsRouter }   from './routes/recruiters.js';
import { mancoRouter }                                from './routes/manco.js';
import { crmRouter }                                  from './routes/crm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────
const config = yamlLoad(readFileSync(join(__dirname, 'config.yml'), 'utf-8'));

const PORT      = config.server.port ?? 4000;
const MOCKS_DIR = join(__dirname, config.server.mocksDir.replace('./mock-server/', ''));
const DELAY_MIN = config.delay.min   ?? 300;
const DELAY_MAX = config.delay.max   ?? 900;
const ERR_RATE  = config.errorSimulation.enabled ? (config.errorSimulation.rate ?? 0.02) : 0;
const PUBLIC_PATHS = config.auth.publicPaths ?? ['/auth/login', '/auth/signup', '/jobs', '/opportunities', '/candidates/register', '/recruiters/register'];

// ─────────────────────────────────────────────────────────
//  Datasets  — loaded once at startup, mutated in-memory
// ─────────────────────────────────────────────────────────
function loadDataset(name) {
  const p = join(__dirname, 'data', `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : [];
}

const DB = {
  candidates:   loadDataset('candidates'),
  jobs:         loadDataset('jobs'),
  recruiters:   loadDataset('recruiters'),
  clients:      loadDataset('crm-clients'),
  applications: loadDataset('applications'),
};

function saveDataset(name, data) {
  const p = join(__dirname, 'data', `${name}.json`);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

// Pipeline stage order (shared by jobs + recruiters + manco routes)
const PIPELINE_STAGES = ['Applied', 'Screening', 'Assessment', 'Interview', 'Shortlisted', 'Offer', 'Closed'];

// ─────────────────────────────────────────────────────────
//  Auth helpers  (shared with route files via injection)
// ─────────────────────────────────────────────────────────
const sessions = new Map(); // token → user object

const USERS = {
  'candidate@skillsmine.com': {
    sub: 'u1', email: 'candidate@skillsmine.com', role: 'candidate',
    firstName: 'Michael', lastName: 'Smith', candidateId: 'c001',
    permissions: ['VIEW_JOBS', 'APPLY_JOB', 'UPLOAD_CV', 'VIEW_DASHBOARD'],
  },
  'candidate2@skillsmine.com': {
    sub: 'u10', email: 'candidate2@skillsmine.com', role: 'candidate',
    firstName: 'Ayesha', lastName: 'Patel', candidateId: 'c002',
    permissions: ['VIEW_JOBS', 'APPLY_JOB', 'UPLOAD_CV', 'VIEW_DASHBOARD'],
  },
  'recruiter@skillsmine.com': {
    sub: 'u2', email: 'recruiter@skillsmine.com', role: 'recruiter',
    firstName: 'Sarah', lastName: 'Johnson', recruiterId: 'r001',
    permissions: ['MANDATE_CREATE', 'MANDATE_EDIT', 'PIPELINE_ADVANCE', 'CRM_EDIT', 'CANDIDATE_VIEW', 'VIEW_DASHBOARD'],
  },
  'recruiter2@skillsmine.com': {
    sub: 'u11', email: 'recruiter2@skillsmine.com', role: 'recruiter',
    firstName: 'Bongani', lastName: 'Cele', recruiterId: 'r002',
    permissions: ['MANDATE_CREATE', 'MANDATE_EDIT', 'PIPELINE_ADVANCE', 'CRM_EDIT', 'CANDIDATE_VIEW', 'VIEW_DASHBOARD'],
  },
  'manco@skillsmine.com': {
    sub: 'u3', email: 'manco@skillsmine.com', role: 'manco',
    firstName: 'David', lastName: 'Botha',
    permissions: ['PIPELINE_VIEW', 'REPORT_VIEW', 'RECRUITER_VIEW', 'VIEW_DASHBOARD'],
  },
  'admin@skillsmine.com': {
    sub: 'u5', email: 'admin@skillsmine.com', role: 'admin',
    firstName: 'Admin', lastName: 'User',
    permissions: ['ALL'],
  },
};

const PASSWORDS = { 'Password123': true };

const ROLE_DASHBOARD = {
  candidate: '/candidates/dashboard',
  recruiter: '/recruiters/dashboard',
  manco:     '/manco/dashboard',
  admin:     '/admin/dashboard',
};

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

// ─────────────────────────────────────────────────────────
//  Handlebars helpers  (for .mock file templates)
// ─────────────────────────────────────────────────────────
Handlebars.registerHelper('randomInt',     (min, max) => Math.floor(Math.random() * (max - min + 1)) + min);
Handlebars.registerHelper('eq',            (a, b) => a === b);
Handlebars.registerHelper('ne',            (a, b) => a !== b);
Handlebars.registerHelper('jsonStringify', (val)  => new Handlebars.SafeString(JSON.stringify(val ?? [])));
Handlebars.registerHelper('jsonPretty',    (val)  => new Handlebars.SafeString(JSON.stringify(val ?? {}, null, 2)));
Handlebars.registerHelper('now', (fmt) => {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  return (typeof fmt === 'string' ? fmt : 'YYYY-MM-DD')
    .replace('YYYY', d.getFullYear()).replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate())).replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()));
});

// ─────────────────────────────────────────────────────────
//  .mock file resolver  (fallback for paths with no Express route)
// ─────────────────────────────────────────────────────────
globalThis._readdirSync = readdirSync;

function parseMockFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const sep = raw.indexOf('\n\n');
  const head = sep !== -1 ? raw.slice(0, sep) : raw;
  const body = sep !== -1 ? raw.slice(sep + 2) : '';
  const lines = head.split('\n');
  const status  = parseInt(lines[0]?.match(/HTTP\/1\.1\s+(\d+)/)?.[1] ?? '200', 10);
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].indexOf(':');
    if (c === -1) continue;
    headers[lines[i].slice(0, c).trim().toLowerCase()] = lines[i].slice(c + 1).trim();
  }
  return { status, headers, bodyTemplate: body };
}

function resolveMock(pathname, method) {
  const rel    = pathname.replace(/^\//, '');
  const direct = join(MOCKS_DIR, rel, `${method.toUpperCase()}.mock`);
  if (existsSync(direct)) return { file: direct, params: {} };

  function walkSync(dir, segs, params) {
    if (segs.length === 0) {
      const f = join(dir, `${method.toUpperCase()}.mock`);
      return existsSync(f) ? { file: f, params } : null;
    }
    const [seg, ...rest] = segs;
    const exact = join(dir, seg);
    if (existsSync(exact)) { const r = walkSync(exact, rest, params); if (r) return r; }
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith(':')); }
    catch { /* dir missing */ }
    for (const e of ents) {
      const r = walkSync(join(dir, e.name), rest, { ...params, [e.name.slice(1)]: seg });
      if (r) return r;
    }
    return null;
  }
  return walkSync(MOCKS_DIR, rel.split('/'), {}) ?? null;
}

// ─────────────────────────────────────────────────────────
//  Express app
// ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  config.cors.origins ?? '*');
  res.header('Access-Control-Allow-Headers', config.cors.headers ?? 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', config.cors.methods ?? 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Strip /api/ prefix so routes work with or without it
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) req.url = req.url.replace('/api/', '/');
  next();
});

// Delay + error injection + auth guard
app.use(async (req, res, next) => {
  const path     = req.path;
  const isPublic = PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));

  await new Promise(r => setTimeout(r, Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN));

  if (!isPublic && Math.random() < ERR_RATE) {
    console.log(`[INJECT] 500 → ${req.method} ${path}`);
    return res.status(500).json({ error: 'Internal server error – please retry', injected: true });
  }

  if (!isPublic) {
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    if (!token || !sessions.has(token))
      return res.status(401).json({ error: 'Not authenticated. Please login first.' });
    req.currentUser = sessions.get(token);
  }

  next();
});

// ─────────────────────────────────────────────────────────
//  Mount route modules
// ─────────────────────────────────────────────────────────
const routeCtx = { DB, PIPELINE_STAGES, sessions, generateToken, saveDataset };

app.use('/auth',        authRouter({ ...routeCtx, USERS, PASSWORDS, ROLE_DASHBOARD, DB }));
app.use('/candidates',  candidatesRouter(routeCtx));
app.use('/candidates',  candidateActionsRouter(routeCtx));   // :id/actions/send-latest-matched-jobs
app.use('/jobs',        jobsRouter(routeCtx));
app.use('/opportunities', opportunitiesRouter(routeCtx));
app.use('/recruiters',  recruitersRouter(routeCtx));
app.use('/manco',       mancoRouter(routeCtx));
app.use('/crm',         crmRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Catch-all → .mock file fallback
//  Only reached if no named route above matched.
// ─────────────────────────────────────────────────────────
app.all('*', (req, res) => {
  const resolved = resolveMock(req.path, req.method);
  if (!resolved) {
    console.warn(`[404] No mock: ${req.method} ${req.path}`);
    return res.status(404).json({
      error: `No mock defined for ${req.method} ${req.path}`,
      hint:  `Add a named route in mock-server/routes/ or create mock-server/mocks${req.path}/${req.method.toUpperCase()}.mock`,
    });
  }
  try {
    const { status, headers, bodyTemplate } = parseMockFile(resolved.file);
    const context = {
      request: { body: req.body ?? {}, query: req.query ?? {}, headers: req.headers, method: req.method, path: req.path, params: { ...req.params, ...resolved.params } },
      user:    req.currentUser ?? {},
      params:  { ...req.params, ...resolved.params },
    };
    const rendered = Handlebars.compile(bodyTemplate)(context).trim();
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (!headers['content-type']) res.setHeader('content-type', 'application/json');
    console.log(`[MOCK]  ${req.method} ${req.path} → ${status}`);
    res.status(status).send(rendered);
  } catch (err) {
    console.error(`[ERROR] Mock render failed: ${resolved.file}`, err.message);
    res.status(500).json({ error: 'Mock render error', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const L = s => console.log(s);
  L('');
  L('╔══════════════════════════════════════════════════════════════╗');
  L('║    SkillsMine Mock Server  ·  Single Domain  ·  Role-based  ║');
  L(`║    http://localhost:${PORT}                                    ║`);
  L('╠══════════════════════════════════════════════════════════════╣');
  L('║  routes/auth.js         POST /auth/login                     ║');
  L('║                         POST /auth/signup                    ║');
  L('║                         GET  /auth/me                        ║');
  L('║                         POST /auth/logout                    ║');
  L('║  routes/candidates.js   POST /candidates/register (public)   ║');
  L('║                         POST /candidates/cv/upload           ║');
  L('║                         PUT  /candidates/cv-builder/:step    ║');
  L('║                         GET  /candidates/dashboard           ║');
  L('║                         GET  /candidates/applications        ║');
  L('║                         GET  /candidates/:id                 ║');
  L('║                         PUT  /candidates/:id                 ║');
  L('║                         GET  /candidates                     ║');
  L('║  routes/jobs.js         GET  /jobs  (public)                 ║');
  L('║                         GET  /jobs/:jobId                    ║');
  L('║                         POST /jobs/:jobId/apply              ║');
  L('║                         POST /jobs/:jobId/pipeline/advance   ║');
  L('║                         POST /jobs  (recruiter)              ║');
  L('║  routes/recruiters.js   POST /recruiters/register (public)   ║');
  L('║                         GET  /recruiters/dashboard           ║');
  L('║                         GET  /recruiters/jobs                ║');
  L('║                         GET  /recruiters/jobs/:jobId         ║');
  L('║                         GET  /recruiters/candidates          ║');
  L('║                         GET  /recruiters/candidates/:id      ║');
  L('║  routes/manco.js        GET  /manco/dashboard                ║');
  L('║                         GET  /manco/recruiters               ║');
  L('║                         GET  /manco/recruiters/:id/performance║');
  L('║                         GET  /manco/recruiters/:id/pipeline  ║');
  L('║                         POST /manco/recruiters/:id/resolve   ║');
  L('║  routes/crm.js          GET  /crm/clients                    ║');
  L('║                         POST /crm/clients/:id/notes          ║');
  L('║  routes/jobs.js         GET  /opportunities  (public)        ║');
  L('║                         ?q=  ?tag=  ?workType=  ?limit=      ║');
  L(`║  Delay ${DELAY_MIN}–${DELAY_MAX} ms  ·  Error injection ${ERR_RATE * 100}%             ║`);
  L('╚══════════════════════════════════════════════════════════════╝');
  L('');
  L('  Test accounts (password: Password123)');
  L('    candidate@skillsmine.com    candidate2@skillsmine.com');
  L('    recruiter@skillsmine.com    recruiter2@skillsmine.com');
  L('    manco@skillsmine.com        admin@skillsmine.com');
  L('');
  L('  Data (loaded from mock-server/data/)');
  L(`    ${DB.candidates.length} candidates · ${DB.jobs.filter(j=>j.status==='Open').length} open jobs · ${DB.jobs.filter(j=>j.status==='Closed').length} closed · ${DB.jobs.filter(j=>j.status==='Draft').length} draft`);
  L(`    ${DB.recruiters.length} recruiters · ${DB.clients.length} CRM clients · ${DB.applications.length} applications`);
  L('');
});
