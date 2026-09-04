/**
 * SkillsMine â€“ Mock Server Runner
 *
 * All route logic lives in mock-server/routes/:
 *
 *   routes/auth-v3.js         Auth Service v3 routes under /api/auth-service/v1
 *   routes/users.js           GET/PUT /users/:userId | POST/DELETE /users/:userId/profile-photo
 *   routes/candidates.js      GET  /candidates/landing           (public)
 *                             GET  /candidates/dashboard
 *                             GET  /candidates/profile/
 *                             GET|POST|PUT /candidates/cv-build/
 *                             GET  /candidates/recommended-positions
 *                             GET|POST|DELETE /candidates/saved-jobs[/{jobId}]
 *                             GET  /candidates/ai-actions/
 *                             GET  /candidate/:userId/dashboard  (legacy)
 *                             GET|POST|PUT /candidate/buildmycv  (legacy)
 *                             GET  /candidate/:resumeId/preview  (legacy)
 *                             GET  /candidate/:resumeId/download (legacy)
 *                             GET  /candidate/:candidateId/recommended-jobs (legacy)
 *                             POST /applications/:applicationId/cv/upload
 *   routes/mandateService.js  GET  /jobs | /jobs/:jobProfileId | /industries
 *                             /locations | /companies | /candidates
 *                             POST /jobs | PATCH /jobs/:jobProfileId[/view]
 *                             DELETE /jobs/:jobProfileId
 *   routes/recruiter.js       GET  /recruiter/dashboard
 *                             GET  /recruiter/mandates
 *                             PUT  /recruiter/applications/:applicationId/stage
 *                             GET  /recruiter/candidates/search
 *                             GET  /mandates/:mandateId
 *                             GET  /applications/:applicationId/stage-transition
 *                             GET  /api/v1/candidates/:candidateId/profile
 *                             GET  /api/v1/recruiters/me/tour-status
 *                             PATCH /api/v1/recruiters/me/tour-status
 *   routes/pipeline.js        PATCH /api/v1/pipeline/:pipelineId/stage
 *   routes/skills.js          GET  /skills/search
 *   routes/manco.js           GET  /api/v1/manco/:mancoId/dashboard
 *                             GET  /api/manco/recruiters/:id/performance
 *   routes/crm.js             GET  /api/v1/crm/clients
 *                             POST /api/v1/crm/clients/:clientId/notes
 *   routes/documents.js       POST   /documents/resume
 *                             POST   /documents
 *                             GET    /documents/owner/:ownerType/:ownerId
 *                             GET    /documents/:documentId
 *                             DELETE /documents/:documentId
 *                             GET    /documents/:documentId/download
 *
 * Data files (loaded once at startup, mutated in-memory):
 *   data/users.json            data/candidate-profiles.json  data/resumes.json
 *   data/skills.json           data/jobs.json                data/applications.json
 *   data/mandates.json         data/recruiters.json          data/crm-clients.json
 *   data/documents.json
 *
 * Run:  node mock-server/camouflage-runner.js
 */

import express                                                 from 'express';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname }                                       from 'node:path';
import { fileURLToPath }                                       from 'node:url';
import Handlebars                                              from 'handlebars';
import { load as yamlLoad }                                    from 'js-yaml';

import {
  authV3Router,
  adminV3Router,
  staffProfilesV3Router,
  usersV3Router,
}                                                              from './routes/auth-v3.js';
import { usersRouter }                                         from './routes/users.js';
import {
  candidateDashboardRouter,
  cvBuilderRouter,
  applicationCvRouter,
  candidateLandingRouter,
  candidateSelfDashboardRouter,
  candidateProfileRouter,
  candidateCvBuildRouter,
  candidateRecommendedPositionsRouter,
  candidateSavedJobsRouter,
  candidateAiActionsRouter,
  candidateApplicationsRouter,
  candidateServiceV2Router,
}                                                              from './routes/candidates.js';
import {
  recruiterRouter,
  mandatesRouter,
  applicationStageRouter,
  recruiterCandidateProfileRouter,
  recruiterTourRouter,
}                                                              from './routes/recruiter.js';
import { pipelineRouter }                                      from './routes/pipeline.js';
import { skillsRouter }                                        from './routes/skills.js';
import { mancoRouter, mancoRecruiterPerformanceRouter }        from './routes/manco.js';
import { crmRouter }                                           from './routes/crm.js';
import { jobPostsRouter }                                      from './routes/jobPosts.js';
import { documentsRouter }                                      from './routes/documents.js';
import {
  aiSkillsGenerateRouter,
  aiJobSkillsGenerateRouter,
  aiRecommendedJobsRouter,
  aiMatchScoringRouter,
  aiCandidateMatchScoreRouter,
  aiCandidateActionsRouter,
}                                                                from './routes/ai.js';
import {
  mandateServiceJobsRouter,
  mandateServiceIndustriesRouter,
  mandateServiceLocationsRouter,
  mandateServiceCompaniesRouter,
  mandateServiceCandidatesRouter,
}                                                                from './routes/mandateService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

//  Config
const config = yamlLoad(readFileSync(join(__dirname, 'config.yml'), 'utf-8'));

const PORT      = Number(process.env.PORT ?? config.server.port ?? 4000);
const MOCKS_DIR = join(__dirname, config.server.mocksDir.replace('./mock-server/', ''));
const DELAY_MIN = config.delay.min   ?? 300;
const DELAY_MAX = config.delay.max   ?? 900;
const ERR_RATE  = config.errorSimulation.enabled ? (config.errorSimulation.rate ?? 0.02) : 0;

const PUBLIC_PATHS = [
  '/api/auth-service/v1/auth/login',
  '/api/auth-service/v1/auth/candidates/register',
  '/api/auth-service/v1/auth/candidates/register/visitor/conversion',
  '/api/auth-service/v1/auth/candidates/register-google',
  '/api/auth-service/v1/auth/staff/register',
  '/api/auth-service/v1/auth/forgot-password',
  '/api/auth-service/v1/auth/reset-password',
  '/api/auth-service/v1/users/validate',
  '/skills/search',
  '/skills/generate',
  '/candidates/landing',
  '/industries',
  '/locations',
];

const PUBLIC_GET_PATHS = ['/jobs'];

//  Datasets  â€” loaded once at startup, mutated in-memory
function loadDataset(name) {
  const p = join(__dirname, 'data', `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : [];
}

const DB = {
  users:             loadDataset('users'),
  candidateProfiles: loadDataset('candidate-profiles'),
  candidates:        loadDataset('candidates'),
  resumes:           loadDataset('resumes'),
  skills:            loadDataset('skills'),
  userSkills:        loadDataset('user-skills'),
  jobs:              loadDataset('jobs'),
  applications:      loadDataset('applications'),
  mandates:          loadDataset('mandates'),
  recruiters:        loadDataset('recruiters'),
  clients:           loadDataset('crm-clients'),
  industries:        loadDataset('industries'),
  documents:         loadDataset('documents'),
  visitorProfiles:   loadDataset('visitor-profiles'),
  staffProfiles:     loadDataset('staff-profiles'),
  aiGenerationRuns:  loadDataset('ai-generation-runs'),
  aiScoringRuns:     loadDataset('ai-scoring-runs'),
  candidateAiActions: loadDataset('candidate-ai-actions'),
  companies:         loadDataset('companies'),
  locations:          loadDataset('locations'),
};

// Staff invitations are created by the v3 admin invitation endpoint and kept in memory.
const staffInvitations = new Map(); // invitationToken â†’ invitation record

function saveDataset(name, data) {
  const p = join(__dirname, 'data', `${name}.json`);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

//  Auth helpers  (shared with route files via injection)
const sessions = new Map(); // accessToken â†’ user object

// Pre-seeded users (map by email â€” password is always "Password123")
const USERS = {
  'michael.smith@email.com': {
    sub: '00000001-0000-4000-8000-000000000001', userId: '00000001-0000-4000-8000-000000000001', email: 'michael.smith@email.com',
    firstName: 'Michael', lastName: 'Smith',
    roles: ['JOB_SEEKER'], profileCompleted: 82,
  },
  'ayesha.patel@email.com': {
    sub: '00000001-0000-4000-8000-000000000002', userId: '00000001-0000-4000-8000-000000000002', email: 'ayesha.patel@email.com',
    firstName: 'Ayesha', lastName: 'Patel',
    roles: ['JOB_SEEKER'], profileCompleted: 65,
  },
  'recruiter@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000003', userId: '00000001-0000-4000-8000-000000000003', email: 'recruiter@skillsmine.com',
    firstName: 'Sarah', lastName: 'Johnson',
    roles: ['RECRUITER'], recruiterId: 'r001', profileCompleted: 100,
  },
  'recruiter2@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000004', userId: '00000001-0000-4000-8000-000000000004', email: 'recruiter2@skillsmine.com',
    firstName: 'Bongani', lastName: 'Cele',
    roles: ['RECRUITER'], recruiterId: 'r002', profileCompleted: 100,
  },
  'manco@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000005', userId: '00000001-0000-4000-8000-000000000005', email: 'manco@skillsmine.com',
    firstName: 'David', lastName: 'Botha',
    roles: ['MANCO'], profileCompleted: 100,
  },
  'admin@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000006', userId: '00000001-0000-4000-8000-000000000006', email: 'admin@skillsmine.com',
    firstName: 'Admin', lastName: 'User',
    roles: ['ADMIN'], profileCompleted: 100,
  },
  'exco@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000009', userId: '00000001-0000-4000-8000-000000000009', email: 'exco@skillsmine.com',
    firstName: 'Nomsa', lastName: 'Dlamini',
    roles: ['EXCO'], staffNumber: 'SM-EXC-001', departmentCode: 'EXECUTIVE', profileCompleted: 100,
  },
  // Legacy aliases
  'candidate@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000001', userId: '00000001-0000-4000-8000-000000000001', email: 'michael.smith@email.com',
    firstName: 'Michael', lastName: 'Smith',
    roles: ['JOB_SEEKER'], profileCompleted: 82,
  },
  'candidate2@skillsmine.com': {
    sub: '00000001-0000-4000-8000-000000000002', userId: '00000001-0000-4000-8000-000000000002', email: 'ayesha.patel@email.com',
    firstName: 'Ayesha', lastName: 'Patel',
    roles: ['JOB_SEEKER'], profileCompleted: 65,
  },
  'thabo.nkosi@email.com': {
    sub: '00000001-0000-4000-8000-000000000007', userId: '00000001-0000-4000-8000-000000000007', email: 'thabo.nkosi@email.com',
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

//  Handlebars helpers  (for .mock file templates)
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

//  .mock file resolver  (fallback for paths with no Express route)
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

//  Express app
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

// Strip /api/ prefix so routes work with or without it, except versioned gateway routes.
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/v1/') && !req.path.startsWith('/api/auth-service/') && !req.path.startsWith('/api/manco/')) {
    req.url = req.url.replace('/api/', '/');
  }
  next();
});

// Delay + error injection + auth guard
app.use(async (req, res, next) => {
  const path     = req.path;
  const matchesPublicPath = (paths) => paths.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
  const isPublic = matchesPublicPath(PUBLIC_PATHS) ||
    (req.method === 'GET' && matchesPublicPath(PUBLIC_GET_PATHS));

  await new Promise(r => setTimeout(r, Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN));

  if (!isPublic && Math.random() < ERR_RATE) {
    console.log(`[INJECT] 500 â†’ ${req.method} ${path}`);
    return res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Internal server error â€“ please retry',
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
  } else {
    // Public routes don't require auth, but still resolve the caller's
    // identity when a valid token is supplied (e.g. /candidates/landing
    // returns candidate-specific data for logged-in requests).
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    if (token && sessions.has(token)) {
      req.currentUser = sessions.get(token);
    }
  }

  next();
});

//  Route context
const routeCtx = { DB, sessions, generateToken, saveDataset, staffInvitations };

//  Auth service v3 (OpenAPI â€” /api/auth-service/v1/*)
app.use('/api/auth-service/v1/auth', authV3Router(routeCtx));
app.use('/api/auth-service/v1/admin', adminV3Router(routeCtx));
app.use('/api/auth-service/v1/staff', staffProfilesV3Router(routeCtx));
app.use('/api/auth-service/v1/users', usersV3Router(routeCtx));

//  Users / Profiles
app.use('/users', usersRouter(routeCtx));

//  Candidates  (new contract: /candidates/*)
app.use('/candidates', candidateLandingRouter(routeCtx));           // GET  /candidates/landing        (public + auth-aware)
app.use('/candidates', candidateSelfDashboardRouter(routeCtx));     // GET  /candidates/dashboard
app.use('/candidates', candidateProfileRouter(routeCtx));           // GET  /candidates/profile/
app.use('/candidates', candidateCvBuildRouter(routeCtx));           // GET|POST|PUT /candidates/cv-build/
app.use('/candidates', candidateRecommendedPositionsRouter(routeCtx)); // GET /candidates/recommended-positions
app.use('/candidates', candidateSavedJobsRouter(routeCtx));         // GET|POST /candidates/saved-jobs
app.use('/candidates', candidateAiActionsRouter(routeCtx));         // GET  /candidates/ai-actions/
app.use('/candidates', candidateApplicationsRouter(routeCtx));      // POST /candidates/applications
app.use('/v1/candidates', candidateServiceV2Router(routeCtx));      // Candidate Service v2 contract
app.use('/candidates', aiRecommendedJobsRouter(routeCtx));          // GET  /candidates/:candidateId/recommended-jobs        [AI service]
app.use('/candidates', aiCandidateMatchScoreRouter(routeCtx));      // GET  /candidates/:candidateId/match-score/:jobProfileId [AI service]
app.use('/candidates', aiCandidateActionsRouter(routeCtx));         // GET|POST /candidates/:candidateId/ai-actions           [AI service]
app.use('/candidates', mandateServiceCandidatesRouter(routeCtx));   // GET  /candidates  (Mandate Service v2)

//  Candidate (legacy paths: /candidate/*)
app.use('/candidate', candidateDashboardRouter(routeCtx));
app.use('/candidate', cvBuilderRouter(routeCtx));

// Applications CV upload: POST /applications/:applicationId/cv/upload
app.use('/applications', applicationCvRouter(routeCtx));

//  Jobs  (Mandate Service v2)
app.use('/jobs',         aiJobSkillsGenerateRouter(routeCtx));      // POST /jobs/skills/generate                   [AI service]
app.use('/jobs',         aiMatchScoringRouter(routeCtx));           // POST /jobs/:jobProfileId/match-scores        [AI service]
app.use('/',             mandateServiceJobsRouter(routeCtx));       // /jobs CRUD + view count

//  Skills
app.use('/skills', aiSkillsGenerateRouter(routeCtx));               // POST /skills/generate                       [AI service]
app.use('/skills', skillsRouter(routeCtx));

//  Industries
app.use('/industries', mandateServiceIndustriesRouter(routeCtx));
app.use('/companies',  mandateServiceCompaniesRouter(routeCtx));
app.use('/locations',  mandateServiceLocationsRouter(routeCtx));

//  Recruiter
app.use('/recruiter',     recruiterRouter(routeCtx));
app.use('/mandates',      mandatesRouter(routeCtx));
app.use('/applications',  applicationStageRouter(routeCtx));

//  Pipeline  (PATCH /api/v1/pipeline/:pipelineId/stage)
app.use('/api/v1/pipeline', pipelineRouter(routeCtx));

//  Recruiter candidate profile  (GET /api/v1/candidates/:candidateId/profile)
app.use('/api/v1/candidates', recruiterCandidateProfileRouter(routeCtx));

//  Recruiter tour status  (GET/PATCH /api/v1/recruiters/me/tour-status)
app.use('/api/v1/recruiters', recruiterTourRouter(routeCtx));

//  MANCO
app.use('/api/v1/manco',             mancoRouter(routeCtx));
app.use('/api/manco/recruiters',     mancoRecruiterPerformanceRouter(routeCtx));

//  CRM
app.use('/api/v1/crm', crmRouter(routeCtx));

//  Job Posts  (GET /job-posts, GET /job-posts/:mandateId)
//  Mounted on both /job-posts and /api/job-posts so the
//  route is reachable regardless of the /api/ prefix.
app.use('/job-posts',     jobPostsRouter(routeCtx));
app.use('/api/job-posts', jobPostsRouter(routeCtx));

//  Documents  (document_api_v0.yaml â€” dummy S3-backed storage)
app.use('/documents', documentsRouter(routeCtx));

//  Catch-all â†’ .mock file fallback
//  Only reached if no named route above matched.
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
    console.log(`[MOCK]  ${req.method} ${req.path} â†’ ${status}`);
    res.status(status).send(rendered);
  } catch (err) {
    console.error(`[ERROR] Mock render failed: ${resolved.file}`, err.message);
    res.status(500).json({ success: false, statusCode: 500, message: 'Mock render error', detail: err.message });
  }
});

//  Start
app.listen(PORT, () => {
  let asciiBannerPrinted = false;
  const L = s => {
    if (String(s).includes('â•')) {
      if (!asciiBannerPrinted) {
        console.log(`[SkillsMine Mock Server] Auth Service v3 listening at http://localhost:${PORT}`);
        asciiBannerPrinted = true;
      }
      return;
    }

    console.log(String(s).replace(/â†’/g, '->').replace(/Â·/g, '-').replace(/â€”|â€“/g, '-'));
  };
  
});

