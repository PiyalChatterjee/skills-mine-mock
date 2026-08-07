/**
 * RECRUITER ROUTES  (v2 contract)
 *
 * GET  /recruiter/dashboard                              → recruiter home dashboard
 * GET  /recruiter/mandates                               → mandate list for this recruiter
 * GET  /mandates/:mandateId                              → single mandate detail
 * GET  /applications/:applicationId/stage-transition    → stage history grouped by stage
 * PUT  /recruiter/applications/:applicationId/stage     → manually move candidate stage
 * GET  /recruiter/candidates/search                     → ATS candidate search
 * GET  /api/v1/candidates/:candidateId/profile          → recruiter candidate profile view
 */

import { Router } from 'express';

const PIPELINE_STAGES_V2 = ['Inbound', 'Screening', 'Shortlisted', 'Interview', 'Offer', 'Placed', 'Closed'];

export function recruiterRouter({ DB }) {
  const router = Router();

  // GET /recruiter/dashboard
  router.get('/dashboard', (req, res) => {
    const user = req.currentUser;
    const rid  = user?.recruiterId ?? 'r001';
    const rec  = DB.recruiters.find(r => r.recruiterId === rid) ?? DB.recruiters[0];

    const myMandates  = DB.mandates.filter(m => m.recruiterId === rid);
    const myApps      = DB.applications.filter(a =>
      myMandates.some(m => m.jobId === a.jobId)
    );

    const pipeline = PIPELINE_STAGES_V2.map(stage => ({
      stage,
      count: myApps.filter(a => a.currentStage === stage).length,
    }));

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Recruiter dashboard retrieved.',
      data: {
        weeklyTodo: [
          { id: 't1', task: 'Review CVs for Standard Bank Senior React Developer mandate',   due: new Date(Date.now() + 86400000).toISOString().split('T')[0],  priority: 'HIGH',    mandateId: 'MND001' },
          { id: 't2', task: 'Schedule interviews for FNB Data Engineer shortlist',            due: new Date(Date.now() + 172800000).toISOString().split('T')[0], priority: 'HIGH',    mandateId: 'MND002' },
          { id: 't3', task: 'Follow up on IBM Cloud Architect offer – deadline approaching',  due: new Date(Date.now() + 86400000).toISOString().split('T')[0],  priority: 'CRITICAL', mandateId: 'MND004' },
          { id: 't4', task: 'Update CRM notes for Deloitte contact',                          due: new Date(Date.now() + 259200000).toISOString().split('T')[0], priority: 'MEDIUM',  mandateId: null      },
        ],
        pipeline,
      },
    });
  });

  // GET /recruiter/mandates
  router.get('/mandates', (req, res) => {
    const user   = req.currentUser;
    const rid    = user?.recruiterId ?? 'r001';
    const { status, page = 1, limit = 10 } = req.query;

    let results = DB.mandates.filter(m => m.recruiterId === rid);
    if (status) results = results.filter(m => m.status?.toUpperCase() === status.toUpperCase());

    const pageNum  = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const total    = results.length;
    const data     = results.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Mandates retrieved.',
      data: {
        mandates: data,
        pagination: { page: pageNum, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  });

  // PUT /recruiter/applications/:applicationId/stage
  router.put('/applications/:applicationId/stage', (req, res) => {
    const { applicationId } = req.params;
    const { stage, notes } = req.body ?? {};
    if (!stage)
      return res.status(400).json({ success: false, statusCode: 400, message: 'stage is required.' });

    const app = DB.applications.find(a => a.applicationId === applicationId);
    if (!app)
      return res.status(404).json({ success: false, statusCode: 404, message: `Application ${applicationId} not found.` });

    const previousStage = app.currentStage;
    app.currentStage    = stage;
    app.updatedAt       = new Date().toISOString();

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: `Candidate moved from ${previousStage} to ${stage}.`,
      data: {
        applicationId,
        previousStage,
        currentStage: stage,
        notes: notes ?? '',
        updatedAt: app.updatedAt,
      },
    });
  });

  // GET /recruiter/candidates/search
  router.get('/candidates/search', (req, res) => {
    const { skill, eeStatus, page = 1, limit = 20 } = req.query;

    let results = [...DB.candidateProfiles];

    if (skill) {
      const lc = skill.toLowerCase();
      results = results.filter(p =>
        (p.skills ?? []).some(s => s.toLowerCase().includes(lc))
      );
    }
    if (eeStatus) {
      results = results.filter(p =>
        p.personalDetails?.eeStatus?.toLowerCase().includes(eeStatus.toLowerCase())
      );
    }

    const pageNum  = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const total    = results.length;
    const data     = results
      .slice((pageNum - 1) * pageSize, pageNum * pageSize)
      .map(p => {
        const user = DB.users.find(u => u.userId === p.userId);
        return {
          candidateId:  p.candidateId,
          userId:       p.userId,
          firstName:    p.personalDetails.firstName,
          lastName:     p.personalDetails.lastName,
          email:        p.personalDetails.email,
          location:     p.personalDetails.location,
          eeStatus:     p.personalDetails.eeStatus,
          currentTitle: p.experience?.[0]?.jobTitle ?? '',
          skills:       p.skills ?? [],
          profileCompleted: user?.profileCompleted ?? 0,
          matchScore:   Math.floor(Math.random() * 30) + 65,
        };
      });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Candidates retrieved.',
      data: {
        candidates: data,
        pagination: { page: pageNum, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  });

  return router;
}

// ─── Standalone mandate detail ────────────────────────────────────────────────
export function mandatesRouter({ DB }) {
  const router = Router();

  // GET /mandates/:mandateId
  router.get('/:mandateId', (req, res) => {
    const { mandateId } = req.params;
    const mandate = DB.mandates.find(m => m.mandateId === mandateId);
    if (!mandate)
      return res.status(404).json({ success: false, statusCode: 404, message: `Mandate ${mandateId} not found.` });

    const job = DB.jobs.find(j => j.jobId === mandate.jobId);
    const apps = DB.applications.filter(a => a.jobId === mandate.jobId);

    // Group applicants into the pipeline stage buckets for the recruiter view
    const pipelineBuckets = {};
    const STAGES = ['Inbound', 'Screening', 'Shortlisted', 'Interview', 'Offer', 'Placed', 'Closed'];
    STAGES.forEach(s => { pipelineBuckets[s] = []; });
    apps.forEach(a => {
      const bucket = pipelineBuckets[a.currentStage];
      if (bucket) {
        bucket.push({
          applicationId: a.applicationId,
          candidateId:   a.candidateId,
          candidateName: a.candidateName ?? '',
          matchScore:    a.matchScore,
          appliedDate:   a.appliedDate,
          updatedAt:     a.updatedAt,
        });
      }
    });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Mandate retrieved.',
      data: {
        ...mandate,
        jobDetails: job ?? null,
        applicants: apps.map(a => ({
          applicationId: a.applicationId,
          candidateId:   a.candidateId,
          candidateName: a.candidateName ?? '',
          currentStage:  a.currentStage,
          matchScore:    a.matchScore,
          appliedDate:   a.appliedDate,
          updatedAt:     a.updatedAt,
        })),
        pipelineBuckets,
      },
    });
  });

  return router;
}

// ─── Application stage transition ────────────────────────────────────────────
export function applicationStageRouter({ DB }) {
  const router = Router();

  // GET /applications/:applicationId/stage-transition
  router.get('/:applicationId/stage-transition', (req, res) => {
    const { applicationId } = req.params;
    const app = DB.applications.find(a => a.applicationId === applicationId);
    if (!app)
      return res.status(404).json({ success: false, statusCode: 404, message: `Application ${applicationId} not found.` });

    // Use stored stageHistory when present (rich records); synthesise for legacy records
    const ORDERED_STAGES = ['Inbound', 'Screening', 'Shortlisted', 'Interview', 'Offer', 'Placed', 'Closed'];
    let stageHistory;

    if (app.stageHistory && Array.isArray(app.stageHistory) && app.stageHistory.length > 0) {
      // Convert the array format from seed data into the keyed object format
      stageHistory = {};
      ORDERED_STAGES.forEach(stageName => {
        const entry = app.stageHistory.find(h => h.stage === stageName);
        stageHistory[stageName] = entry
          ? { enteredAt: entry.enteredAt, exitedAt: entry.exitedAt ?? null, completed: entry.exitedAt !== null }
          : { enteredAt: null, exitedAt: null, completed: false };
      });
    } else {
      // Fallback synthetic builder for legacy application records
      const now = new Date();
      stageHistory = {
        Inbound: {
          enteredAt: app.appliedDate ? `${app.appliedDate}T08:00:00Z` : now.toISOString(),
          exitedAt:  `${app.appliedDate}T14:00:00Z`,
          completed: true,
        },
        Screening: {
          enteredAt: `${app.appliedDate}T14:00:00Z`,
          exitedAt:  app.currentStage !== 'Inbound' ? `${app.appliedDate}T16:00:00Z` : null,
          completed: app.currentStage !== 'Inbound',
        },
        Shortlisted: {
          enteredAt: ['Shortlisted', 'Interview', 'Offer', 'Placed', 'Closed'].includes(app.currentStage) ? new Date(now.getTime() - 5 * 86400000).toISOString() : null,
          exitedAt:  null,
          completed: ['Interview', 'Offer', 'Placed', 'Closed'].includes(app.currentStage),
        },
        Interview: {
          enteredAt: ['Interview', 'Offer', 'Placed', 'Closed'].includes(app.currentStage) ? new Date(now.getTime() - 3 * 86400000).toISOString() : null,
          exitedAt:  null,
          completed: ['Offer', 'Placed', 'Closed'].includes(app.currentStage),
        },
        Offer: {
          enteredAt: ['Offer', 'Placed'].includes(app.currentStage) ? new Date(now.getTime() - 86400000).toISOString() : null,
          exitedAt:  null,
          completed: app.currentStage === 'Placed',
        },
        Placed: {
          enteredAt: app.currentStage === 'Placed' ? new Date().toISOString() : null,
          exitedAt:  null,
          completed: app.currentStage === 'Placed',
        },
        Closed: {
          enteredAt: app.currentStage === 'Closed' ? new Date().toISOString() : null,
          exitedAt:  null,
          completed: app.currentStage === 'Closed',
        },
      };
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Stage transition history retrieved.',
      data: {
        applicationId,
        candidateId:   app.candidateId,
        candidateName: app.candidateName ?? '',
        mandateId:     app.mandateId ?? null,
        recruiterId:   app.recruiterId ?? null,
        jobId:         app.jobId,
        jobTitle:      app.jobTitle,
        company:       app.company,
        currentStage:  app.currentStage,
        matchScore:    app.matchScore,
        appliedDate:   app.appliedDate,
        updatedAt:     app.updatedAt,
        stageHistory,
      },
    });
  });

  return router;
}

// ─── Recruiter candidate profile (v1 API path) ────────────────────────────────
export function recruiterCandidateProfileRouter({ DB }) {
  const router = Router();

  // GET /api/v1/candidates/:candidateId/profile
  router.get('/:candidateId/profile', (req, res) => {
    const { candidateId } = req.params;
    const profile = DB.candidateProfiles.find(p => p.candidateId === candidateId);
    if (!profile)
      return res.status(404).json({ success: false, statusCode: 404, message: `Candidate ${candidateId} not found.` });

    const user = DB.users.find(u => u.userId === profile.userId);
    const resume = DB.resumes.find(r => r.candidateId === candidateId);
    const apps = DB.applications.filter(a => a.candidateId === candidateId);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Candidate profile retrieved.',
      data: {
        candidateId,
        userId: profile.userId,
        accountStatus: user?.accountStatus ?? 'ACTIVE',
        profileCompleted: user?.profileCompleted ?? 0,
        personalDetails: profile.personalDetails,
        desiredJob: profile.desiredJob,
        education: profile.education,
        experience: profile.experience,
        skills: profile.skills,
        languages: profile.languages,
        resume: resume
          ? {
              resumeId:    resume.resumeId,
              previewUrl:  resume.previewUrl,
              downloadUrl: resume.downloadUrl,
              updatedAt:   resume.updatedAt,
            }
          : null,
        applications: apps.map(a => ({
          applicationId: a.applicationId,
          jobId:         a.jobId,
          jobTitle:      a.jobTitle,
          company:       a.company,
          currentStage:  a.currentStage,
          appliedDate:   a.appliedDate,
          matchScore:    a.matchScore,
        })),
        matchScore: Math.floor(Math.random() * 30) + 65,
      },
    });
  });

  return router;
}
