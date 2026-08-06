/**
 * CANDIDATE ROUTES  (v2 contract)
 *
 * GET  /candidate/dashboard                          → candidate home dashboard
 * POST /candidate/buildmycv                          → initialise / return CV builder data model
 * GET  /candidate/:resumeId/preview                  → CV preview URL
 * GET  /candidate/:resumeId/download                 → CV download URL
 * GET  /candidate/:candidateId/recommended-jobs      → AI job recommendations
 * POST /applications/:applicationId/cv/upload        → upload & parse CV (multipart mock)
 */

import { Router } from 'express';

// ─── Candidate dashboard ────────────────────────────────────────────────────
export function candidateDashboardRouter({ DB }) {
  const router = Router();

  // GET /candidate/dashboard
  router.get('/dashboard', (req, res) => {
    const user = req.currentUser;
    const userId = user?.userId ?? 'USR100001';
    const profile = DB.candidateProfiles.find(p => p.userId === userId) ?? DB.candidateProfiles[0];
    const apps = DB.applications.filter(a => a.userId === userId || a.candidateId === profile?.candidateId);
    const openJobs = DB.jobs.filter(j => j.status === 'Open').slice(0, 3);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Dashboard data retrieved.',
      data: {
        summary: {
          profileCompleted: DB.users.find(u => u.userId === userId)?.profileCompleted ?? 82,
          totalApplications: apps.length,
          activeApplications: apps.filter(a => !['Closed', 'Placed'].includes(a.currentStage)).length,
          savedJobs: Math.floor(Math.random() * 6) + 2,
          profileViews: Math.floor(Math.random() * 15) + 5,
        },
        activity: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({
          day,
          applications: Math.floor(Math.random() * 3),
          profileViews: Math.floor(Math.random() * 8),
        })),
        applications: apps.slice(0, 5).map(a => ({
          applicationId: a.applicationId,
          jobTitle: a.jobTitle,
          company: a.company,
          currentStage: a.currentStage,
          appliedDate: a.appliedDate,
          matchScore: a.matchScore,
        })),
        quickLinks: [
          { label: 'Build My CV',       path: '/candidate/buildmycv'          },
          { label: 'Browse Jobs',        path: '/jobs'                          },
          { label: 'View Applications',  path: '/candidate/applications'        },
          { label: 'Update Profile',     path: `/users/${userId}`               },
        ],
      },
    });
  });

  return router;
}

// ─── CV Builder ──────────────────────────────────────────────────────────────
export function cvBuilderRouter({ DB }) {
  const router = Router();

  // POST /candidate/buildmycv
  router.post('/buildmycv', (req, res) => {
    const user = req.currentUser;
    const userId = user?.userId ?? 'USR100001';
    const profile = DB.candidateProfiles.find(p => p.userId === userId) ?? DB.candidateProfiles[0];
    const resume = DB.resumes.find(r => r.userId === userId) ?? DB.resumes[0];

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'CV builder data loaded.',
      data: {
        resumeId: resume?.resumeId ?? null,
        currentStep: 'personalDetails',
        completedSteps: ['personalDetails', 'careerHistory', 'education'],
        steps: [
          'personalDetails',
          'careerHistory',
          'skills',
          'education',
          'languages',
          'summary',
          'preferences',
        ],
        personalDetails: profile?.personalDetails ?? {},
        careerHistory: profile?.experience ?? [],
        skills: profile?.skills ?? [],
        education: profile?.education ?? [],
        languages: profile?.languages ?? [],
        summary: resume?.summary ?? '',
        desiredJob: profile?.desiredJob ?? {},
      },
    });
  });

  // GET /candidate/:resumeId/preview
  router.get('/:resumeId/preview', (req, res) => {
    const { resumeId } = req.params;
    const resume = DB.resumes.find(r => r.resumeId === resumeId);
    if (!resume)
      return res.status(404).json({ success: false, statusCode: 404, message: `Resume ${resumeId} not found.` });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Preview URL generated.',
      data: {
        resumeId,
        previewUrl: resume.previewUrl ?? `https://mock-cdn.skillsmine.com/resumes/${resumeId}/preview.pdf`,
        generatedAt: new Date().toISOString(),
        expiresIn: 3600,
      },
    });
  });

  // GET /candidate/:resumeId/download
  router.get('/:resumeId/download', (req, res) => {
    const { resumeId } = req.params;
    const resume = DB.resumes.find(r => r.resumeId === resumeId);
    if (!resume)
      return res.status(404).json({ success: false, statusCode: 404, message: `Resume ${resumeId} not found.` });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Download URL generated.',
      data: {
        resumeId,
        downloadUrl: resume.downloadUrl ?? `https://mock-cdn.skillsmine.com/resumes/${resumeId}/download.pdf`,
        filename: `${resume.title?.replace(/\s+/g, '-') ?? resumeId}.pdf`,
        generatedAt: new Date().toISOString(),
        expiresIn: 900,
      },
    });
  });

  // GET /candidate/:candidateId/recommended-jobs
  router.get('/:candidateId/recommended-jobs', (req, res) => {
    const { candidateId } = req.params;
    const profile = DB.candidateProfiles.find(p => p.candidateId === candidateId);
    const candidateSkills = profile?.skills ?? [];

    const jobs = DB.jobs
      .filter(j => j.status === 'Open')
      .slice(0, 6)
      .map(j => {
        const overlap = (j.skills ?? []).filter(s => candidateSkills.includes(s)).length;
        const matchScore = Math.min(99, 55 + overlap * 6 + Math.floor(Math.random() * 15));
        return {
          jobId: j.jobId,
          title: j.title,
          company: j.company,
          location: j.location,
          workType: j.workType,
          salaryRange: j.salaryRange,
          matchScore,
          skills: j.skills ?? [],
          postedDate: j.postedDate,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Recommended jobs retrieved.',
      data: {
        candidateId,
        jobs,
        total: jobs.length,
      },
    });
  });

  return router;
}

// ─── Applications CV upload ──────────────────────────────────────────────────
export function applicationCvRouter() {
  const router = Router();

  // POST /applications/:applicationId/cv/upload
  router.post('/:applicationId/cv/upload', (req, res) => {
    const { applicationId } = req.params;

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'CV uploaded and parsed successfully.',
      data: {
        applicationId,
        documentId: `DOC${String(Math.floor(Math.random() * 90000) + 10000)}`,
        extractionStatus: 'COMPLETE',
        personalDetails: {
          firstName: 'Michael',
          lastName: 'Smith',
          email: 'michael.smith@email.com',
          mobileNumber: '+27821234567',
          location: 'Johannesburg, Gauteng',
          linkedinUrl: 'https://linkedin.com/in/michael-smith-dev',
        },
        careerHistory: [
          {
            company: 'Accenture',
            jobTitle: 'Senior Software Engineer',
            startDate: '2020-03',
            endDate: 'Present',
            responsibilities: 'Lead frontend development using React and Node.js.',
          },
          {
            company: 'Standard Bank',
            jobTitle: 'Software Engineer',
            startDate: '2017-01',
            endDate: '2020-02',
            responsibilities: 'Built and maintained retail banking web applications.',
          },
        ],
        skills: ['React', 'Node.js', 'TypeScript', 'AWS', 'PostgreSQL', 'GraphQL'],
        education: [
          {
            institution: 'University of the Witwatersrand',
            qualification: 'BSc Computer Science',
            year: 2016,
          },
        ],
        languages: [
          { language: 'English', proficiency: 'Native' },
          { language: 'Zulu',    proficiency: 'Conversational' },
        ],
        validation: {
          isComplete: true,
          missingFields: [],
          warnings: [],
        },
        uploadedAt: new Date().toISOString(),
      },
    });
  });

  return router;
}
