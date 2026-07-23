/**
 * JOBS ROUTES
 *
 * GET  /jobs                        → public job board (filterable)
 * GET  /jobs/:jobId                 → single job detail
 * POST /jobs/:jobId/apply           → apply for a job (auth or guest)
 * POST /jobs/:jobId/pipeline/advance → advance candidate through pipeline stages
 * POST /jobs                        → create a new job posting (recruiter only)
 */

import { Router } from 'express';

export function jobsRouter({ DB, PIPELINE_STAGES }) {
  const router = Router();

  // GET /jobs  (public)
  router.get('/', (req, res) => {
    const { status, industry, location, q, page = 1, limit = 20 } = req.query;
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
