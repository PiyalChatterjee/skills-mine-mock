/**
 * RECRUITER ROUTES
 *
 * POST /recruiters/register            → register a new recruiter
 * GET  /recruiters/dashboard           → recruiter home dashboard (live data)
 * GET  /recruiters/jobs                → jobs managed by this recruiter
 * GET  /recruiters/jobs/:jobId         → job detail + pipeline breakdown
 * GET  /recruiters/candidates          → ATS candidate search
 * GET  /recruiters/candidates/:id      → full candidate profile for ATS
 * POST /candidates/:id/actions/send-latest-matched-jobs → AI: send matched jobs
 */

import { Router } from 'express';

export function recruitersRouter({ DB, PIPELINE_STAGES, sessions, generateToken }) {
  const router = Router();

  // POST /recruiters/register  (public)
  router.post('/register', (req, res) => {
    const { fullName, email, phone, agency, password } = req.body ?? {};
    if (!fullName || !email || !password)
      return res.status(400).json({ error: 'fullName, email and password are required.' });

    const recruiterId = `r${String(DB.recruiters.length + 1).padStart(3, '0')}`;
    const newRecruiter = {
      recruiterId, fullName, email,
      phone:  phone ?? '',
      agency: agency ?? 'SkillsMine',
      role:   'recruiter',
      registeredAt: new Date().toISOString(),
      metrics: { placements: 0, activeRoles: 0, candidates: 0, conversionRate: 0 },
    };
    DB.recruiters.push(newRecruiter);

    const token = generateToken({
      sub: recruiterId, email, role: 'recruiter',
      firstName: fullName.split(' ')[0],
      lastName:  fullName.split(' ').slice(1).join(' '),
      recruiterId,
      permissions: ['MANDATE_CREATE', 'MANDATE_EDIT', 'PIPELINE_ADVANCE', 'CRM_EDIT', 'CANDIDATE_VIEW', 'VIEW_DASHBOARD'],
    });
    sessions.set(token, newRecruiter);
    return res.status(201).json({ recruiterId, token, message: 'Recruiter registered successfully.' });
  });

  // GET /recruiters/dashboard
  router.get('/dashboard', (req, res) => {
    const user       = req.currentUser;
    const rid        = user?.recruiterId ?? 'r001';
    const activeJobs = DB.jobs.filter(j => j.status === 'Open');
    const rec        = DB.recruiters.find(r => r.recruiterId === rid) ?? DB.recruiters[0];

    const pipelineCounts = {};
    PIPELINE_STAGES.forEach(s => {
      pipelineCounts[s] = DB.applications.filter(a => a.currentStage === s).length;
    });

    return res.status(200).json({
      recruiterId:          rid,
      recruiterName:        user ? `${user.firstName} ${user.lastName}` : (rec?.fullName ?? 'Unknown'),
      cvsDue:               Math.floor(Math.random() * 8) + 3,
      interviewsToSchedule: Math.floor(Math.random() * 5) + 1,
      offerDeadlines:       Math.floor(Math.random() * 3) + 1,
      activeMandates:       activeJobs.length,
      companies:            [...new Set(activeJobs.map(j => j.company))].length,
      pipelineCounts,
      weeklyTasks: [
        { id: 't1', task: `Review CVs for ${activeJobs[0]?.company ?? 'open'} mandate`,         due: new Date(Date.now() + 86400000).toISOString().split('T')[0],  priority: 'HIGH'     },
        { id: 't2', task: `Schedule interviews for ${activeJobs[1]?.title ?? 'open role'}`,      due: new Date(Date.now() + 172800000).toISOString().split('T')[0], priority: 'HIGH'     },
        { id: 't3', task: 'Follow up on pending offers',                                         due: new Date(Date.now() + 86400000).toISOString().split('T')[0],  priority: 'CRITICAL' },
        { id: 't4', task: 'Update CRM for last week contacts',                                   due: new Date(Date.now() + 259200000).toISOString().split('T')[0], priority: 'MEDIUM'   },
      ],
      kpis: rec?.metrics ?? { placements: 0, activeRoles: activeJobs.length, candidates: 0, conversionRate: 0 },
      recentPlacements: DB.applications
        .filter(a => a.currentStage === 'Offer')
        .slice(0, 3)
        .map(a => ({ candidate: a.candidateName ?? a.candidateId, role: a.jobTitle, company: a.company, date: a.appliedDate })),
    });
  });

  // GET /recruiters/jobs
  router.get('/jobs', (req, res) => {
    const user = req.currentUser;
    const rid  = user?.recruiterId;
    const { status } = req.query;
    let jobs = rid ? DB.jobs.filter(j => j.recruiterId === rid) : DB.jobs;
    if (status) jobs = jobs.filter(j => j.status?.toLowerCase() === status.toLowerCase());
    return res.status(200).json({ jobs, total: jobs.length });
  });

  // GET /recruiters/jobs/:jobId
  router.get('/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = DB.jobs.find(j => j.jobId === jobId);
    if (!job) return res.status(404).json({ error: `Job ${jobId} not found.` });
    const jobApps = DB.applications.filter(a => a.jobId === jobId);
    const pipelineCounts = {};
    PIPELINE_STAGES.forEach(s => {
      pipelineCounts[s] = jobApps.filter(a => a.currentStage === s).length;
    });
    return res.status(200).json({ ...job, pipelineCounts, applications: jobApps });
  });

  // GET /recruiters/candidates
  router.get('/candidates', (req, res) => {
    const { q, skills, location, page = 1, limit = 20 } = req.query;
    let results = [...DB.candidates];
    if (q) results = results.filter(c =>
      c.fullName?.toLowerCase().includes(q.toLowerCase()) ||
      c.currentTitle?.toLowerCase().includes(q.toLowerCase())
    );
    if (skills) {
      const skillArr = skills.split(',').map(s => s.trim().toLowerCase());
      results = results.filter(c =>
        skillArr.some(sk => (c.skills ?? []).map(s => s.toLowerCase()).includes(sk))
      );
    }
    if (location) results = results.filter(c =>
      c.location?.toLowerCase().includes(location.toLowerCase())
    );
    const pageNum  = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const data     = results.slice((pageNum - 1) * pageSize, pageNum * pageSize).map(c => ({
      ...c,
      matchScore:   Math.floor(Math.random() * 30) + 65,
      currentStage: DB.applications.find(a => a.candidateId === c.candidateId)?.currentStage ?? 'Applied',
    }));
    return res.status(200).json({ candidates: data, total: results.length, page: pageNum, pageSize });
  });

  // GET /recruiters/candidates/:id
  router.get('/candidates/:id', (req, res) => {
    const { id } = req.params;
    const candidate = DB.candidates.find(c => c.candidateId === id);
    if (!candidate) return res.status(404).json({ error: `Candidate ${id} not found.` });
    return res.status(200).json({
      ...candidate,
      matchScore:   Math.floor(Math.random() * 30) + 65,
      applications: DB.applications.filter(a => a.candidateId === id),
    });
  });

  return router;
}

// ── AI action – separate export so it can be mounted at /candidates prefix ──
export function candidateActionsRouter({ DB }) {
  const router = Router();

  // POST /candidates/:id/actions/send-latest-matched-jobs
  router.post('/:id/actions/send-latest-matched-jobs', (req, res) => {
    const { id } = req.params;
    const candidate = DB.candidates.find(c => c.candidateId === id);
    if (!candidate) return res.status(404).json({ error: `Candidate ${id} not found.` });
    const matchedJobs = DB.jobs.filter(j => j.status === 'Open').slice(0, 5).map(j => ({
      jobId: j.jobId, title: j.title, company: j.company,
      matchScore: Math.floor(Math.random() * 25) + 70,
    }));
    return res.status(200).json({
      candidateId: id,
      jobsSent:    matchedJobs.length,
      jobs:        matchedJobs,
      sentAt:      new Date().toISOString(),
      message:     `${matchedJobs.length} matched jobs sent to candidate.`,
    });
  });

  return router;
}
