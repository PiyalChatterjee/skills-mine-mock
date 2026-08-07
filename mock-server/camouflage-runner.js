/**
 * SkillsMine – Mock Server Runner  (v2 contract)
 *
 * All route logic lives in mock-server/routes/:
 *
 *   routes/auth.js            POST /auth/register | /auth/login | /auth/forgot-password
 *                             POST /auth/change-password | /auth/logout
 *   routes/users.js           GET/PUT /users/:userId | POST/DELETE /users/:userId/profile-photo
 *   routes/candidates.js      GET /candidate/:userId/dashboard
 *                             POST /candidate/buildmycv
 *                             GET /candidate/:resumeId/preview  | /download
 *                             GET /candidate/:candidateId/recommended-jobs
 *                             POST /applications/:applicationId/cv/upload
 *   routes/jobs.js            GET  /jobs (public)
 *                             GET  /jobs/:jobId
 *                             POST /jobs/:jobId/save
 *                             POST /jobs/:jobId/apply
 *                             POST /jobs (recruiter)
 *                             GET  /opportunities
 *   routes/recruiter.js       GET  /recruiter/dashboard
 *                             GET  /recruiter/mandates
 *                             PUT  /recruiter/applications/:applicationId/stage
 *                             GET  /recruiter/candidates/search
 *                             GET  /mandates/:mandateId
 *                             GET  /applications/:applicationId/stage-transition
 *                             GET  /api/v1/candidates/:candidateId/profile
 *   routes/pipeline.js        PATCH /api/v1/pipeline/:pipelineId/stage
 *   routes/skills.js          GET  /skills/search
 *   routes/manco.js           GET  /api/v1/manco/:mancoId/dashboard
 *                             GET  /api/manco/recruiters/:id/performance
 *   routes/crm.js             GET  /api/v1/crm/clients
 *                             POST /api/v1/crm/clients/:clientId/notes
 *
 * Data files (loaded once at startup, mutated in-memory):
 *   data/users.json            data/candidate-profiles.json  data/resumes.json
 *   data/skills.json           data/jobs.json                data/applications.json
 *   data/mandates.json         data/recruiters.json          data/crm-clients.json
 *
 * Run:  node mock-server/camouflage-runner.js
 */

import express                                                 from 'express';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname }                                       from 'node:path';
import { fileURLToPath }                                       from 'node:url';
import Handlebars                                              from 'handlebars';
import { load as yamlLoad }                                    from 'js-yaml';

import { authRouter }                                          from './routes/auth.js';
import { usersRouter }                                         from './routes/users.js';
import {
  candidateDashboardRouter,
  cvBuilderRouter,
  applicationCvRouter,
}                                                              from './routes/candidates.js';
import {
  jobsRouter,
  opportunitiesRouter,
}                                                              from './routes/jobs.js';
import {
  recruiterRouter,
  mandatesRouter,
  applicationStageRouter,
  recruiterCandidateProfileRouter,
}                                                              from './routes/recruiter.js';
import { pipelineRouter }                                      from './routes/pipeline.js';
import { skillsRouter }                                        from './routes/skills.js';
import { mancoRouter, mancoRecruiterPerformanceRouter }        from './routes/manco.js';
import { crmRouter }                                           from './routes/crm.js';

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

const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/jobs',
  '/opportunities',
  '/skills/search',
];

// ─────────────────────────────────────────────────────────
//  Datasets  — loaded once at startup, mutated in-memory
// ─────────────────────────────────────────────────────────
function loadDataset(name) {
  const p = join(__dirname, 'data', `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : [];
}

const DB = {
  users:             loadDataset('users'),
  candidateProfiles: loadDataset('candidate-profiles'),
  resumes:           loadDataset('resumes'),
  skills:            loadDataset('skills'),
  userSkills:        loadDataset('user-skills'),
  jobs:              loadDataset('jobs'),
  applications:      loadDataset('applications'),
  mandates:          loadDataset('mandates'),
  recruiters:        loadDataset('recruiters'),
  clients:           loadDataset('crm-clients'),
};

function saveDataset(name, data) {
  const p = join(__dirname, 'data', `${name}.json`);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

// ─────────────────────────────────────────────────────────
//  Auth helpers  (shared with route files via injection)
// ─────────────────────────────────────────────────────────
const sessions = new Map(); // accessToken → user object

// Pre-seeded users (map by email — password is always "Password123")
const USERS = {
  'michael.smith@email.com': {
    sub: 'USR100001', userId: 'USR100001', email: 'michael.smith@email.com',
    firstName: 'Michael', lastName: 'Smith',
    roles: ['JOB_SEEKER'], profileCompleted: 82,
  },
  'ayesha.patel@email.com': {
    sub: 'USR100002', userId: 'USR100002', email: 'ayesha.patel@email.com',
    firstName: 'Ayesha', lastName: 'Patel',
    roles: ['JOB_SEEKER'], profileCompleted: 65,
  },
  'recruiter@skillsmine.com': {
    sub: 'USR100003', userId: 'USR100003', email: 'recruiter@skillsmine.com',
    firstName: 'Sarah', lastName: 'Johnson',
    roles: ['RECRUITER'], recruiterId: 'r001', profileCompleted: 100,
  },
  'recruiter2@skillsmine.com': {
    sub: 'USR100004', userId: 'USR100004', email: 'recruiter2@skillsmine.com',
    firstName: 'Bongani', lastName: 'Cele',
    roles: ['RECRUITER'], recruiterId: 'r002', profileCompleted: 100,
  },
  'manco@skillsmine.com': {
    sub: 'USR100005', userId: 'USR100005', email: 'manco@skillsmine.com',
    firstName: 'David', lastName: 'Botha',
    roles: ['MANCO'], profileCompleted: 100,
  },
  'admin@skillsmine.com': {
    sub: 'USR100006', userId: 'USR100006', email: 'admin@skillsmine.com',
    firstName: 'Admin', lastName: 'User',
    roles: ['ADMIN'], profileCompleted: 100,
  },
  // Legacy aliases
  'candidate@skillsmine.com': {
    sub: 'USR100001', userId: 'USR100001', email: 'michael.smith@email.com',
    firstName: 'Michael', lastName: 'Smith',
    roles: ['JOB_SEEKER'], profileCompleted: 82,
  },
  'candidate2@skillsmine.com': {
    sub: 'USR100002', userId: 'USR100002', email: 'ayesha.patel@email.com',
    firstName: 'Ayesha', lastName: 'Patel',
    roles: ['JOB_SEEKER'], profileCompleted: 65,
  },
  'thabo.nkosi@email.com': {
    sub: 'USR100007', userId: 'USR100007', email: 'thabo.nkosi@email.com',
    firstName: 'Thabo', lastName: 'Nkosi',
    roles: ['JOB_SEEKER'], profileCompleted: 55,
  },
};

function generateToken(user) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...user,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url');
  const sig = Buffer.from(`mock-${user.sub ?? user.userId}-${Date.now()}`).toString('base64url');
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

// Strip /api/ prefix so routes work with or without it — but keep /api/v1/ for versioned routes
app.use((req, _res, next) => {
  // Rewrite bare /api/ to / but leave /api/v1/ alone (handled at mount)
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/v1/') && !req.path.startsWith('/api/manco/')) {
    req.url = req.url.replace('/api/', '/');
  }
  next();
});

// Delay + error injection + auth guard
app.use(async (req, res, next) => {
  const path     = req.path;
  const isPublic = PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));

  await new Promise(r => setTimeout(r, Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN));

  if (!isPublic && Math.random() < ERR_RATE) {
    console.log(`[INJECT] 500 → ${req.method} ${path}`);
    return res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Internal server error – please retry',
      injected: true,
    });
  }

  if (!isPublic) {
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    if (!token || !sessions.has(token))
      return res.status(401).json({
        success: false,
        statusCode: 401,
        message: 'Not authenticated. Please login first.',
      });
    req.currentUser = sessions.get(token);
  }

  next();
});

// ─────────────────────────────────────────────────────────
//  Route context
// ─────────────────────────────────────────────────────────
const routeCtx = { DB, sessions, generateToken, saveDataset };

// ─────────────────────────────────────────────────────────
//  Auth
// ─────────────────────────────────────────────────────────
app.use('/auth', authRouter({ ...routeCtx, USERS }));

// ─────────────────────────────────────────────────────────
//  Users / Profiles
// ─────────────────────────────────────────────────────────
app.use('/users', usersRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Candidate (dashboard, CV builder, recommendations)
// ─────────────────────────────────────────────────────────
app.use('/candidate', candidateDashboardRouter(routeCtx));
app.use('/candidate', cvBuilderRouter(routeCtx));

// Applications CV upload: POST /applications/:applicationId/cv/upload
app.use('/applications', applicationCvRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Jobs + Opportunities
// ─────────────────────────────────────────────────────────
app.use('/jobs',         jobsRouter(routeCtx));
app.use('/opportunities', opportunitiesRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Skills
// ─────────────────────────────────────────────────────────
app.use('/skills', skillsRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Recruiter
// ─────────────────────────────────────────────────────────
app.use('/recruiter',     recruiterRouter(routeCtx));
app.use('/mandates',      mandatesRouter(routeCtx));
app.use('/applications',  applicationStageRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Pipeline  (PATCH /api/v1/pipeline/:pipelineId/stage)
// ─────────────────────────────────────────────────────────
app.use('/api/v1/pipeline', pipelineRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Recruiter candidate profile  (GET /api/v1/candidates/:candidateId/profile)
// ─────────────────────────────────────────────────────────
app.use('/api/v1/candidates', recruiterCandidateProfileRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  MANCO
// ─────────────────────────────────────────────────────────
app.use('/api/v1/manco',             mancoRouter(routeCtx));
app.use('/api/manco/recruiters',     mancoRecruiterPerformanceRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  CRM
// ─────────────────────────────────────────────────────────
app.use('/api/v1/crm', crmRouter(routeCtx));

// ─────────────────────────────────────────────────────────
//  Catch-all → .mock file fallback
//  Only reached if no named route above matched.
// ─────────────────────────────────────────────────────────
app.all('*', (req, res) => {
  const resolved = resolveMock(req.path, req.method);
  if (!resolved) {
    console.warn(`[404] No mock: ${req.method} ${req.path}`);
    return res.status(404).json({
      success: false,
      statusCode: 404,
      message: `No mock defined for ${req.method} ${req.path}`,
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
    res.status(500).json({ success: false, statusCode: 500, message: 'Mock render error', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const L = s => console.log(s);
  L('');
  L('╔══════════════════════════════════════════════════════════════════════════╗');
  L('║    SkillsMine Mock Server  ·  v2 Contract  ·  Role-based  (ESM)         ║');
  L(`║    http://localhost:${PORT}                                                ║`);
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  AUTH                                                                    ║');
  L('║    POST  /auth/register                                                  ║');
  L('║    POST  /auth/login                                                     ║');
  L('║    POST  /auth/forgot-password                                           ║');
  L('║    POST  /auth/change-password                                           ║');
  L('║    POST  /auth/logout                                                    ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  USERS / PROFILES                                                        ║');
  L('║    GET   /users/:userId                                                  ║');
  L('║    PUT   /users/:userId                                                  ║');
  L('║    POST  /users/:userId/profile-photo                                    ║');
  L('║    DELETE /users/:userId/profile-photo                                   ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  CANDIDATE                                                               ║');
  L('║    GET   /candidate/:userId/dashboard                                    ║');
  L('║    GET   /candidate/buildmycv   (read)                                   ║');
  L('║    POST  /candidate/buildmycv   (create)                                 ║');
  L('║    PUT   /candidate/buildmycv   (partial update)                         ║');
  L('║    GET   /candidate/:resumeId/preview                                    ║');
  L('║    GET   /candidate/:resumeId/download                                   ║');
  L('║    GET   /candidate/:candidateId/recommended-jobs                        ║');
  L('║    POST  /applications/:applicationId/cv/upload                          ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  JOBS                                                                    ║');
  L('║    GET   /jobs  (public)                                                 ║');
  L('║    GET   /jobs/:jobId                                                    ║');
  L('║    POST  /jobs/:jobId/save                                               ║');
  L('║    POST  /jobs/:jobId/apply                                              ║');
  L('║    POST  /jobs  (recruiter)                                              ║');
  L('║    GET   /opportunities  (public)                                        ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  SKILLS                                                                  ║');
  L('║    GET   /skills/search?keyword=&limit=                                  ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  RECRUITER                                                               ║');
  L('║    GET   /recruiter/dashboard                                            ║');
  L('║    GET   /recruiter/mandates                                             ║');
  L('║    PUT   /recruiter/applications/:applicationId/stage                    ║');
  L('║    GET   /recruiter/candidates/search                                    ║');
  L('║    GET   /mandates/:mandateId                                            ║');
  L('║    GET   /applications/:applicationId/stage-transition                   ║');
  L('║    GET   /api/v1/candidates/:candidateId/profile                         ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  PIPELINE                                                                ║');
  L('║    PATCH /api/v1/pipeline/:pipelineId/stage                              ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  MANCO                                                                   ║');
  L('║    GET   /api/v1/manco/:mancoId/dashboard                                ║');
  L('║    GET   /api/manco/recruiters/:id/performance                           ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L('║  CRM                                                                     ║');
  L('║    GET   /api/v1/crm/clients  (?status=)                                 ║');
  L('║    POST  /api/v1/crm/clients/:clientId/notes                             ║');
  L('╠══════════════════════════════════════════════════════════════════════════╣');
  L(`║  Delay ${DELAY_MIN}–${DELAY_MAX} ms · Error injection ${(ERR_RATE * 100).toFixed(0)}%                              ║`);
  L('╚══════════════════════════════════════════════════════════════════════════╝');
  L('');
  L('  Test accounts (password: Password123)');
  L('    michael.smith@email.com    (JOB_SEEKER / USR100001)');
  L('    ayesha.patel@email.com     (JOB_SEEKER / USR100002)');
  L('    recruiter@skillsmine.com   (RECRUITER  / USR100003)');
  L('    recruiter2@skillsmine.com  (RECRUITER  / USR100004)');
  L('    manco@skillsmine.com       (MANCO      / USR100005)');
  L('    admin@skillsmine.com       (ADMIN      / USR100006)');
  L('  Legacy aliases: candidate@skillsmine.com, candidate2@skillsmine.com');
  L('');
  L('  Data (loaded from mock-server/data/)');
  L(`    ${DB.users.length} users · ${DB.candidateProfiles.length} candidate profiles · ${DB.resumes.length} resumes`);
  L(`    ${DB.jobs.filter(j => j.status === 'Open').length} open jobs · ${DB.mandates.length} mandates`);
  L(`    ${DB.recruiters.length} recruiters · ${DB.clients.length} CRM clients · ${DB.applications.length} applications`);
  L(`    ${DB.skills.length} skills`);
  L('');
});
