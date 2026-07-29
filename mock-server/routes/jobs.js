/**
 * JOBS ROUTES
 *
 * GET  /jobs                         → public job board (filterable)
 * GET  /jobs/:jobId                  → single job detail
 * POST /jobs/:jobId/apply            → apply for a job (auth or guest)
 * POST /jobs/:jobId/pipeline/advance → advance candidate through pipeline stages
 * POST /jobs                         → create a new job posting (recruiter only)
 *
 * OPPORTUNITIES ROUTES
 *
 * GET  /opportunities                → public marketing job cards (filterable)
 *   ?q=         full-text on title or employer name
 *   ?tag=       match any tag value  (e.g. "Remote", "Cape Town", "FinTech")
 *   ?workType=  Remote | Hybrid | On-site
 *   ?employmentType= Permanent | Contract
 *   ?limit=     max results (default 10)
 */

import { Router } from 'express';

// ─────────────────────────────────────────────────────────
//  Display metadata for the opportunities card format.
//  Keyed by jobId — enriches DB jobs with branding colours
//  and card layout hints used by the marketing website.
// ─────────────────────────────────────────────────────────
const OPPORTUNITY_META = {
  j001: { employerOrbColor: '#0a3d6b', employerOrbGlow: 'rgba(10, 61, 107, 0.35)',   blurredEmployer: false, tallCard: true  },
  j002: { employerOrbColor: '#cc0000', employerOrbGlow: 'rgba(204, 0, 0, 0.35)',      blurredEmployer: false, tallCard: true  },
  j003: { employerOrbColor: '#444f59', employerOrbGlow: 'rgba(68, 79, 89, 0.35)',     blurredEmployer: false, tallCard: false },
  j004: { employerOrbColor: '#1f70c1', employerOrbGlow: 'rgba(31, 112, 193, 0.35)',   blurredEmployer: false, tallCard: false },
  j005: { employerOrbColor: '#4f64e8', employerOrbGlow: 'rgba(79, 100, 232, 0.35)',   blurredEmployer: false, tallCard: false },
  j006: { employerOrbColor: '#00419e', employerOrbGlow: 'rgba(0, 65, 158, 0.35)',     blurredEmployer: false, tallCard: false },
  j007: { employerOrbColor: '#c8102e', employerOrbGlow: 'rgba(200, 16, 46, 0.35)',    blurredEmployer: false, tallCard: false },
  j008: { employerOrbColor: '#e8403a', employerOrbGlow: 'rgba(232, 64, 58, 0.35)',    blurredEmployer: false, tallCard: false },
  j009: { employerOrbColor: '#e07020', employerOrbGlow: 'rgba(224, 112, 32, 0.35)',   blurredEmployer: true,  tallCard: true  },
  j010: { employerOrbColor: '#d4001a', employerOrbGlow: 'rgba(212, 0, 26, 0.35)',     blurredEmployer: true,  tallCard: false },
  j011: { employerOrbColor: '#0058a3', employerOrbGlow: 'rgba(0, 88, 163, 0.35)',     blurredEmployer: false, tallCard: false },
  j012: { employerOrbColor: '#003f8a', employerOrbGlow: 'rgba(0, 63, 138, 0.35)',     blurredEmployer: false, tallCard: true  },
  j013: { employerOrbColor: '#006652', employerOrbGlow: 'rgba(0, 102, 82, 0.35)',     blurredEmployer: false, tallCard: false },
  j014: { employerOrbColor: '#0a3d6b', employerOrbGlow: 'rgba(10, 61, 107, 0.35)',   blurredEmployer: true,  tallCard: false },
  j015: { employerOrbColor: '#a100ff', employerOrbGlow: 'rgba(161, 0, 255, 0.35)',   blurredEmployer: false, tallCard: false },
  j016: { employerOrbColor: '#c41e3a', employerOrbGlow: 'rgba(196, 30, 58, 0.35)',   blurredEmployer: true,  tallCard: false },
  j017: { employerOrbColor: '#e40000', employerOrbGlow: 'rgba(228, 0, 0, 0.35)',     blurredEmployer: false, tallCard: false },
  j018: { employerOrbColor: '#cc0000', employerOrbGlow: 'rgba(204, 0, 0, 0.35)',     blurredEmployer: false, tallCard: false },
  j019: { employerOrbColor: '#5f2e91', employerOrbGlow: 'rgba(95, 46, 145, 0.35)',   blurredEmployer: false, tallCard: false },
  j020: { employerOrbColor: '#003f8a', employerOrbGlow: 'rgba(0, 63, 138, 0.35)',    blurredEmployer: false, tallCard: false },
  j021: { employerOrbColor: '#444f59', employerOrbGlow: 'rgba(68, 79, 89, 0.35)',    blurredEmployer: false, tallCard: false },
  j022: { employerOrbColor: '#00b4a0', employerOrbGlow: 'rgba(0, 180, 160, 0.35)',   blurredEmployer: false, tallCard: false },
  j023: { employerOrbColor: '#ff6600', employerOrbGlow: 'rgba(255, 102, 0, 0.35)',   blurredEmployer: true,  tallCard: true  },
  j024: { employerOrbColor: '#df7f2f', employerOrbGlow: 'rgba(223, 127, 47, 0.35)',  blurredEmployer: true,  tallCard: false },
  j025: { employerOrbColor: '#5f2e91', employerOrbGlow: 'rgba(95, 46, 145, 0.35)',   blurredEmployer: false, tallCard: false },
};

// Build a tags array from a DB job record
function buildTags(job) {
  const tags = [];
  if (job.industry)        tags.push(job.industry);
  if (job.location)        tags.push(job.location.split(',')[0].trim());   // "Johannesburg, Gauteng" → "Johannesburg"
  if (job.workType)        tags.push(job.workType);
  if (job.employmentType && job.employmentType !== 'Permanent') tags.push(job.employmentType);
  return tags;
}

// Shape a DB job into the opportunities card format
function toOpportunityCard(job) {
  const meta = OPPORTUNITY_META[job.jobId] ?? {
    employerOrbColor: '#3b82d4',
    employerOrbGlow:  'rgba(59, 130, 212, 0.35)',
    blurredEmployer:  false,
    tallCard:         false,
  };
  return {
    id:               job.jobId,
    title:            job.title,
    tags:             buildTags(job),
    description:      job.description,
    employerName:     job.company,
    salaryRange:      job.salaryRange,
    workType:         job.workType,
    employmentType:   job.employmentType,
    ...meta,
  };
}

export function opportunitiesRouter({ DB }) {
  const router = Router();

  // GET /opportunities  (public, filterable)
  router.get('/', (req, res) => {
    const { q, tag, workType, employmentType, limit = '10' } = req.query;

    let results = DB.jobs.filter(j => j.status === 'Open');

    if (q) {
      const lc = q.toLowerCase();
      results = results.filter(j =>
        j.title?.toLowerCase().includes(lc) ||
        j.company?.toLowerCase().includes(lc) ||
        j.description?.toLowerCase().includes(lc)
      );
    }

    if (tag) {
      const lc = tag.toLowerCase();
      results = results.filter(j =>
        buildTags(j).some(t => t.toLowerCase().includes(lc)) ||
        j.industry?.toLowerCase().includes(lc)
      );
    }

    if (workType) {
      const lc = workType.toLowerCase();
      results = results.filter(j => j.workType?.toLowerCase() === lc);
    }

    if (employmentType) {
      const lc = employmentType.toLowerCase();
      results = results.filter(j => j.employmentType?.toLowerCase() === lc);
    }

    const pageSize = Math.min(parseInt(limit, 10) || 10, 50);
    const cards    = results.slice(0, pageSize).map(toOpportunityCard);

    return res.status(200).json({
      opportunities: cards,
      total:         results.length,
      shown:         cards.length,
    });
  });

  return router;
}

export function jobsRouter({ DB, PIPELINE_STAGES }) {
  const router = Router();

  // GET /jobs  (public)
  router.get('/', (req, res) => {
    const { status, industry, location, q, page = 1, limit = 10 } = req.query;
    let results = [...DB.jobs];
    if (status) results = results.filter(j => j.status?.toLowerCase() === status.toLowerCase());
    else        results = results.filter(j => j.status === 'Open');
    if (industry) results = results.filter(j => j.industry?.toLowerCase().includes(industry.toLowerCase()));
    if (location) results = results.filter(j => j.location?.toLowerCase().includes(location.toLowerCase()));
    if (q) results = results.filter(j =>
      j.title?.toLowerCase().includes(q.toLowerCase()) ||
      j.company?.toLowerCase().includes(q.toLowerCase())
    );
    const pageNum  = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const data     = results.slice((pageNum - 1) * pageSize, pageNum * pageSize);
    return res.status(200).json({ jobs: data, total: results.length, page: pageNum, pageSize });
  });

  // GET /jobs/:jobId  (public)
  router.get('/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ error: `Job ${jobId} not found.` });
    return res.status(200).json(job);
  });

  // POST /jobs/:jobId/apply  (auth optional – guest allowed)
  router.post('/:jobId/apply', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ error: `Job ${jobId} not found.` });
    if (job.status !== 'Open')
      return res.status(422).json({ error: 'This position is no longer accepting applications.' });

    const user    = req.currentUser;
    const isGuest = !user;
    const { fullName, email, coverLetter } = req.body ?? {};

    if (isGuest && (!fullName || !email))
      return res.status(400).json({ error: 'Guest applications require fullName and email.' });

    const applicationId = `app-${Date.now()}`;
    const candidateId   = user?.candidateId ?? `guest-${Date.now()}`;

    job.applicationCount = (job.applicationCount ?? 0) + 1;

    DB.applications.push({
      applicationId,
      candidateId,
      jobId,
      jobTitle:     job.title,
      company:      job.company,
      currentStage: 'Applied',
      appliedDate:  new Date().toISOString().split('T')[0],
      matchScore:   Math.floor(Math.random() * 30) + 65,
      coverLetter:  coverLetter ?? '',
      isGuest,
    });

    return res.status(201).json({
      applicationId,
      jobId,
      currentStage:     'Applied',
      applicationCount: job.applicationCount,
      message:          'Application submitted successfully.',
    });
  });

  // POST /jobs/:jobId/pipeline/advance  (recruiter)
  router.post('/:jobId/pipeline/advance', (req, res) => {
    const { jobId } = req.params;
    const { candidateId, checklistComplete } = req.body ?? {};
    if (!candidateId) return res.status(400).json({ error: 'candidateId is required.' });

    const application = DB.applications.find(a => a.jobId === jobId && a.candidateId === candidateId);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const currentIdx = PIPELINE_STAGES.indexOf(application.currentStage);
    if (currentIdx === -1 || currentIdx === PIPELINE_STAGES.length - 1)
      return res.status(422).json({ error: 'Cannot advance: already at final stage.' });

    if (checklistComplete === false)
      return res.status(422).json({
        error:         'Cannot advance: required checklist items are incomplete.',
        requiredItems: ['Screening notes', 'Assessment score'],
      });

    const previousStage       = application.currentStage;
    application.currentStage  = PIPELINE_STAGES[currentIdx + 1];
    application.updatedAt     = new Date().toISOString();

    return res.status(200).json({
      applicationId: application.applicationId,
      candidateId,
      jobId,
      previousStage,
      newStage:  application.currentStage,
      updatedAt: application.updatedAt,
      message:   `Candidate advanced from ${previousStage} to ${application.currentStage}.`,
    });
  });

  // POST /jobs  (recruiter creates a job posting)
  router.post('/', (req, res) => {
    const user = req.currentUser;
    if (!['recruiter', 'admin'].includes(user?.role))
      return res.status(403).json({ error: 'Only recruiters can create job postings.' });

    const {
      title, company, location, industry,
      employmentType, workType,
      salaryMin, salaryMax,
      description, skills, requirements,
    } = req.body ?? {};
    if (!title || !company) return res.status(400).json({ error: 'title and company are required.' });

    const jobId  = `j${String(DB.jobs.length + 1).padStart(3, '0')}`;
    const newJob = {
      jobId, title, company, location, industry,
      employmentType: employmentType ?? 'Permanent',
      workType:       workType ?? 'Hybrid',
      salaryMin:      salaryMin ?? 0,
      salaryMax:      salaryMax ?? 0,
      salaryRange:    salaryMin
        ? `R${salaryMin.toLocaleString()} – R${salaryMax?.toLocaleString() ?? '?'}`
        : 'Market related',
      description:  description ?? '',
      skills:       skills ?? [],
      requirements: requirements ?? [],
      status:           'Draft',
      applicationCount: 0,
      postedDate:       new Date().toISOString().split('T')[0],
      recruiterId:      user.recruiterId ?? user.sub,
    };
    DB.jobs.push(newJob);
    return res.status(201).json({ ...newJob, message: 'Job posting created successfully.' });
  });

  return router;
}
