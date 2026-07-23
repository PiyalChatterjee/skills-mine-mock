/**
 * MANCO ROUTES  (read-only — cannot perform recruiter operational actions)
 *
 * GET  /manco/dashboard                      → platform KPIs + pipeline + compliance
 * GET  /manco/recruiters                     → all recruiters with metrics
 * GET  /manco/recruiters/:id/performance     → individual recruiter KPI trend
 * GET  /manco/recruiters/:id/pipeline        → recruiter pipeline breakdown
 * POST /manco/recruiters/:id/resolve         → resolve a compliance flag
 */

import { Router } from 'express';

export function mancoRouter({ DB, PIPELINE_STAGES }) {
  const router = Router();

  // Role guard: only manco / admin may access these routes
  router.use((req, res, next) => {
    const role = req.currentUser?.role;
    if (role === 'candidate' || role === 'recruiter')
      return res.status(403).json({ error: 'Access denied: MANCO or admin role required.' });
    next();
  });

  // GET /manco/dashboard
  router.get('/dashboard', (req, res) => {
    const pipelineCounts = {};
    PIPELINE_STAGES.forEach(s => {
      pipelineCounts[s] = DB.applications.filter(a => a.currentStage === s).length;
    });

    const recruiterPerformance = DB.recruiters.slice(0, 5).map(r => ({
      recruiterId:    r.recruiterId,
      name:           r.fullName,
      placements:     r.metrics?.placements ?? 0,
      activeMandates: DB.jobs.filter(j => j.recruiterId === r.recruiterId && j.status === 'Open').length,
      avgDays:        r.metrics?.avgDaysToPlace ?? 21,
      conversionRate: r.metrics?.conversionRate ?? 0,
    }));

    return res.status(200).json({
      totalActiveMandates:       DB.jobs.filter(j => j.status === 'Open').length,
      totalCandidatesInPipeline: DB.applications.length,
      placementsThisQuarter:     DB.applications.filter(a => a.currentStage === 'Offer').length,
      avgTimeToPlace:            21,
      pipelineSummary:           pipelineCounts,
      recruiterPerformance,
      industryBreakdown: [
        { industry: 'Technology',         mandates: 12, placements: 8 },
        { industry: 'Financial Services', mandates: 7,  placements: 5 },
        { industry: 'Retail',             mandates: 5,  placements: 3 },
        { industry: 'Healthcare',         mandates: 3,  placements: 2 },
        { industry: 'Creative',           mandates: 3,  placements: 2 },
      ],
      complianceFlags: [
        { mandateId: 'j001', flag: 'Transformation target not met',    severity: 'WARNING' },
        { mandateId: 'j004', flag: 'No pipeline movement in 14 days',  severity: 'INFO'    },
      ],
    });
  });

  // GET /manco/recruiters
  router.get('/recruiters', (req, res) => {
    const recruiters = DB.recruiters.map(r => ({
      recruiterId: r.recruiterId,
      fullName:    r.fullName,
      email:       r.email,
      agency:      r.agency,
      metrics:     r.metrics,
      activeJobs:  DB.jobs.filter(j => j.recruiterId === r.recruiterId && j.status === 'Open').length,
    }));
    return res.status(200).json({ recruiters, total: recruiters.length });
  });

  // GET /manco/recruiters/:id/performance
  router.get('/recruiters/:id/performance', (req, res) => {
    const { id } = req.params;
    const rec = DB.recruiters.find(r => r.recruiterId === id);
    if (!rec) return res.status(404).json({ error: `Recruiter ${id} not found.` });
    const jobs = DB.jobs.filter(j => j.recruiterId === id);
    return res.status(200).json({
      recruiterId: id,
      fullName:    rec.fullName,
      metrics:     rec.metrics,
      jobsManaged: jobs.length,
      activeJobs:  jobs.filter(j => j.status === 'Open').length,
      closedJobs:  jobs.filter(j => j.status === 'Closed').length,
      kpiTrend: [
        { month: 'Aug', placements: 2, revenue: 96000 },
        { month: 'Sep', placements: 3, revenue: 144000 },
        { month: 'Oct', placements: 4, revenue: 192000 },
        { month: 'Nov', placements: rec.metrics?.placements ?? 0, revenue: (rec.metrics?.placements ?? 0) * 48000 },
      ],
    });
  });

  // GET /manco/recruiters/:id/pipeline
  router.get('/recruiters/:id/pipeline', (req, res) => {
    const { id } = req.params;
    const rec = DB.recruiters.find(r => r.recruiterId === id);
    if (!rec) return res.status(404).json({ error: `Recruiter ${id} not found.` });
    const recJobs = DB.jobs.filter(j => j.recruiterId === id);
    const recApps = DB.applications.filter(a => recJobs.some(j => j.jobId === a.jobId));
    const stageCounts = {};
    PIPELINE_STAGES.forEach(s => {
      stageCounts[s] = recApps.filter(a => a.currentStage === s).length;
    });
    return res.status(200).json({
      recruiterId: id,
      fullName:    rec.fullName,
      stageCounts,
      applications: recApps,
    });
  });

  // POST /manco/recruiters/:id/resolve  (observational flag resolution only)
  router.post('/recruiters/:id/resolve', (req, res) => {
    const { id } = req.params;
    const rec = DB.recruiters.find(r => r.recruiterId === id);
    if (!rec) return res.status(404).json({ error: `Recruiter ${id} not found.` });
    const { flagId, resolution, notes } = req.body ?? {};
    const user = req.currentUser;
    return res.status(200).json({
      recruiterId: id,
      flagId:      flagId ?? 'flag-001',
      resolution:  resolution ?? 'acknowledged',
      notes:       notes ?? '',
      resolvedAt:  new Date().toISOString(),
      resolvedBy:  user ? `${user.firstName} ${user.lastName}` : 'MANCO',
      message:     'Flag resolved. Note: MANCO cannot perform recruiter operational actions.',
    });
  });

  return router;
}
