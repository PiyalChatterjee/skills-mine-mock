/**
 * JOBS ROUTES  (v2 contract)
 *
 * GET  /jobs                         → public job board (filterable), showEmployerDetails flag
 * GET  /jobs/:jobId                  → single job detail
 * POST /jobs/:jobId/save             → save / bookmark a job
 * POST /jobs/:jobId/apply            → apply for a job
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
};

function buildTags(job) {
  const tags = [];
  if (job.industry)        tags.push(job.industry);
  if (job.location)        tags.push(job.location.split(',')[0].trim());
  if (job.workType)        tags.push(job.workType);
  if (job.employmentType && job.employmentType !== 'Permanent') tags.push(job.employmentType);
  return tags;
}

function toOpportunityCard(job) {
  const meta = OPPORTUNITY_META[job.jobId] ?? {
    employerOrbColor: '#3b82d4',
    employerOrbGlow:  'rgba(59, 130, 212, 0.35)',
    blurredEmployer:  false,
    tallCard:         false,
  };
  return {
    id:             job.jobId,
    title:          job.title,
    tags:           buildTags(job),
    description:    job.description,
    employerName:   job.company,
    salaryRange:    job.salaryRange,
    workType:       job.workType,
    employmentType: job.employmentType,
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

export function jobsRouter({ DB }) {
  const router = Router();

  // GET /jobs  (public)
  router.get('/', (req, res) => {
    const {
      status, industry, location, q,
      page = 1, limit = 10,
      showEmployerDetails,
    } = req.query;

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
    const total    = results.length;
    const data     = results.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    return res.status(200).json({
      status: 'SUCCESS',
      data: {
        showEmployerDetails: showEmployerDetails === 'true' || showEmployerDetails === true,
        jobs: data,
        pagination: {
          page:       pageNum,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    });
  });

  // GET /jobs/:jobId  (public)
  router.get('/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ success: false, statusCode: 404, message: `Job ${jobId} not found.` });
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Job retrieved.',
      data: job,
    });
  });

  // POST /jobs/:jobId/save
  router.post('/:jobId/save', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ success: false, statusCode: 404, message: `Job ${jobId} not found.` });

    // Persist save to the authenticated user's savedJobs list
    const user = req.currentUser;
    if (user?.userId) {
      const userRecord = DB.users.find(u => u.userId === user.userId);
      if (userRecord) {
        if (!userRecord.savedJobs) userRecord.savedJobs = [];
        if (!userRecord.savedJobs.includes(jobId)) {
          userRecord.savedJobs.push(jobId);
        }
      }
      const profile = DB.candidateProfiles.find(p => p.userId === user.userId);
      if (profile) {
        if (!Array.isArray(profile.savedJobs)) profile.savedJobs = [];
        if (!profile.savedJobs.some(entry => (typeof entry === 'string' ? entry : entry.jobId) === jobId)) {
          profile.savedJobs.push({ jobId, savedAt: new Date().toISOString() });
        }
      }
    }

    return res.status(200).json({ success: true });
  });

  // DELETE /jobs/:jobId/save
  router.delete('/:jobId/save', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ success: false, statusCode: 404, message: `Job ${jobId} not found.` });

    const user = req.currentUser;
    if (user?.userId) {
      const userRecord = DB.users.find(u => u.userId === user.userId);
      if (userRecord && Array.isArray(userRecord.savedJobs)) {
        userRecord.savedJobs = userRecord.savedJobs.filter(id => id !== jobId);
      }
      const profile = DB.candidateProfiles.find(p => p.userId === user.userId);
      if (profile && Array.isArray(profile.savedJobs)) {
        profile.savedJobs = profile.savedJobs.filter(entry =>
          (typeof entry === 'string' ? entry : entry.jobId) !== jobId
        );
      }
    }

    return res.status(200).json({ success: true });
  });

  // POST /jobs/:jobId/apply
  router.post('/:jobId/apply', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ success: false, statusCode: 404, message: `Job ${jobId} not found.` });
    if (job.status !== 'Open')
      return res.status(422).json({ success: false, statusCode: 422, message: 'This position is no longer accepting applications.' });

    const { candidateId, cvId, sourceChannel } = req.body ?? {};

    const applicationId = `APP${String(Date.now()).slice(-8)}`;
    const matchScore    = Math.floor(Math.random() * 30) + 65;

    const user = req.currentUser;
    const resolvedCandidateId = candidateId ?? user?.userId ?? `guest-${Date.now()}`;

    job.applicationCount = (job.applicationCount ?? 0) + 1;

    DB.applications.push({
      applicationId,
      userId:        user?.userId ?? null,
      candidateId:   resolvedCandidateId,
      jobId,
      jobTitle:      job.title,
      company:       job.company,
      cvId:          cvId ?? null,
      sourceChannel: sourceChannel ?? 'direct',
      currentStage:  'Inbound',
      appliedDate:   new Date().toISOString().split('T')[0],
      matchScore,
      isGuest:       !user,
    });

    return res.status(201).json({
      applicationId,
      matchScore,
      status:   'submitted',
      nextStep: user ? 'view_dashboard' : 'account_prompt',
    });
  });

  // POST /jobs  (recruiter creates a job posting)
  router.post('/', (req, res) => {
    const user = req.currentUser;
    if (!['RECRUITER', 'ADMIN', 'recruiter', 'admin'].some(r => (user?.roles ?? []).includes(r) || user?.role === r))
      return res.status(403).json({ success: false, statusCode: 403, message: 'Only recruiters can create job postings.' });

    const {
      title, company, location, industry,
      employmentType, workType,
      salaryMin, salaryMax,
      description, skills, requirements,
    } = req.body ?? {};
    if (!title || !company)
      return res.status(400).json({ success: false, statusCode: 400, message: 'title and company are required.' });

    const jobId  = `j${String(DB.jobs.length + 1).padStart(3, '0')}`;
    const newJob = {
      jobId, title, company, location, industry,
      employmentType: employmentType ?? 'Permanent',
      workType:       workType ?? 'Hybrid',
      salaryMin:      salaryMin ?? 0,
      salaryMax:      salaryMax ?? 0,
      salaryRange:    salaryMin
        ? `R${Number(salaryMin).toLocaleString()} – R${Number(salaryMax ?? 0).toLocaleString()}`
        : 'Market related',
      description:      description ?? '',
      skills:           skills ?? [],
      requirements:     requirements ?? [],
      status:           'Draft',
      applicationCount: 0,
      postedDate:       new Date().toISOString().split('T')[0],
      recruiterId:      user?.recruiterId ?? user?.userId ?? null,
    };
    DB.jobs.push(newJob);

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Job posting created successfully.',
      data: newJob,
    });
  });

  return router;
}
