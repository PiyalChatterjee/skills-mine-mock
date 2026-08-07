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

// Pipeline stages shown on each application card (contract-specified order)
const APPLICATION_PIPELINE = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'SHORTLISTED',
  'OFFER',
];

// Map internal stage names to the contract enum values used in the pipeline display
const STAGE_TO_ENUM = {
  Inbound:    'APPLIED',
  Screening:  'SCREENING',
  Assessment: 'ASSESSMENT',
  Interview:  'INTERVIEW',
  Shortlisted:'SHORTLISTED',
  Offer:      'OFFER',
  Placed:     'OFFER',
  Closed:     'SCREENING',
};

const STAGE_MESSAGES = {
  Inbound:     'Your application has been received.',
  Screening:   'Your application is being reviewed.',
  Assessment:  'You have been invited to complete an assessment.',
  Interview:   'You have been selected for an interview.',
  Shortlisted: 'Congratulations! You have been shortlisted.',
  Offer:       'An offer has been extended to you.',
  Placed:      'You have been successfully placed.',
  Closed:      'This application has been closed.',
};

// ─── Candidate dashboard ────────────────────────────────────────────────────
export function candidateDashboardRouter({ DB }) {
  const router = Router();

  // GET /candidate/:userId/dashboard
  router.get('/:userId/dashboard', (req, res) => {
    const { userId } = req.params;
    // Fall back to the authenticated user if the caller passes "me" as the id
    const resolvedId = (userId === 'me' ? req.currentUser?.userId : userId) ?? 'USR100001';
    const profile = DB.candidateProfiles.find(p => p.userId === resolvedId) ?? DB.candidateProfiles[0];
    const apps    = DB.applications.filter(
      a => a.userId === resolvedId || a.candidateId === profile?.candidateId
    );

    // summary counts matching contract
    const submitted  = apps.filter(a => a.currentStage === 'Inbound').length;
    const inProgress = apps.filter(a =>
      ['Screening', 'Assessment', 'Interview', 'Shortlisted'].includes(a.currentStage)
    ).length;
    const successful = apps.filter(a => ['Offer', 'Placed'].includes(a.currentStage)).length;

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Dashboard data retrieved.',
      data: {
        id:          resolvedId,
        candidateId: profile?.candidateId ?? null,
        summary: {
          totalApplications: apps.length,
          submitted,
          inProgress,
          successful,
        },
        activity: {
          jobsAppliedThisWeek:           Math.min(apps.length, Math.floor(Math.random() * 4) + 1),
          recruiterProfileViewsThisWeek: Math.floor(Math.random() * 5) + 1,
          coursesCompletedThisWeek:      0,
        },
        applications: apps.slice(0, 5).map(a => {
          const job = DB.jobs.find(j => j.jobId === a.jobId);
          return {
            id:   a.applicationId,
            job: {
              id:      a.jobId,
              title:   a.jobTitle ?? job?.title ?? '',
              company: a.company  ?? job?.company ?? '',
            },
            stage:         STAGE_TO_ENUM[a.currentStage] ?? 'APPLIED',
            statusMessage: STAGE_MESSAGES[a.currentStage] ?? 'Your application is being processed.',
            pipeline:      APPLICATION_PIPELINE,
          };
        }),
        quickLinks: ['CV_BUILDER', 'SAVED_JOBS', 'LATEST_JOBS', 'RECOMMENDED_JOBS'],
      },
    });
  });

  return router;
}

// Updatable CV builder sections — only these keys are merged on PUT/POST
const CV_SECTIONS = ['personalDetails', 'careerHistory', 'skills', 'education', 'languages', 'extractionStatus', 'validation'];

// Canonical empty template matching the frontend UI contract
const EMPTY_CV_TEMPLATE = {
  source:           'BuildCV',
  extractionStatus: 'NOT_STARTED',
  personalDetails: {
    firstName:        '',
    lastName:         '',
    race:             '',
    gender:           '',
    disabilityStatus: '',
    nationality:      '',
    location:         '',
    currentCompany:   '',
    currentPosition:  '',
    noticePeriod:     '',
  },
  careerHistory: [],
  skills:        [],
  education: {
    secondaryEducation: [],
    tertiaryEducation:  [],
  },
  languages:  [],
  validation: [],
};

// ─── CV Builder ──────────────────────────────────────────────────────────────
export function cvBuilderRouter({ DB }) {
  const router = Router();

  // In-memory per-user CV builder store (persists across requests for the server lifetime)
  const cvBuilderStore = new Map(); // userId → cv builder data

  // Seed from resume/profile on first use; returns the stored record or null
  function seedIfEmpty(userId) {
    if (cvBuilderStore.has(userId)) return cvBuilderStore.get(userId);
    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    const resume  = DB.resumes.find(r => r.userId === userId);
    if (profile || resume) {
      const now = new Date().toISOString();

      // Normalise education into { secondaryEducation, tertiaryEducation }
      const rawEdu = profile?.education ?? resume?.education ?? {};
      let education;
      if (Array.isArray(rawEdu)) {
        // Legacy flat array — treat every entry as tertiary
        education = {
          secondaryEducation: [],
          tertiaryEducation: rawEdu.map(e => ({
            institution:   e.institution   ?? '',
            qualification: e.qualification ?? '',
            fieldOfStudy:  e.fieldOfStudy  ?? '',
            yearCompleted: e.endYear ?? e.yearCompleted ?? e.completedYear ?? null,
          })),
        };
      } else {
        // Already structured object shape
        education = {
          secondaryEducation: (rawEdu.secondaryEducation ?? []).map(e => ({
            schoolName:    e.schoolName    ?? '',
            qualification: e.qualification ?? '',
            yearCompleted: e.yearCompleted ?? null,
          })),
          tertiaryEducation: (rawEdu.tertiaryEducation ?? []).map(e => ({
            institution:   e.institution   ?? '',
            qualification: e.qualification ?? '',
            fieldOfStudy:  e.fieldOfStudy  ?? '',
            yearCompleted: e.yearCompleted ?? null,
          })),
        };
      }

      const seeded = {
        source:           'BuildCV',
        extractionStatus: 'NOT_STARTED',
        createdAt:        resume?.updatedAt ?? now,
        lastModified:     resume?.updatedAt ?? now,
        personalDetails: {
          firstName:        profile?.personalDetails?.firstName        ?? '',
          lastName:         profile?.personalDetails?.lastName         ?? '',
          race:             profile?.personalDetails?.race             ?? profile?.personalDetails?.eeStatus ?? '',
          gender:           profile?.personalDetails?.gender           ?? '',
          disabilityStatus: profile?.personalDetails?.disabilityStatus ?? '',
          nationality:      profile?.personalDetails?.nationality      ?? '',
          location:         profile?.personalDetails?.location         ?? '',
          currentCompany:   profile?.personalDetails?.currentCompany   ?? '',
          currentPosition:  profile?.personalDetails?.currentPosition  ?? '',
          noticePeriod:     profile?.personalDetails?.noticePeriod     ?? '',
        },
        careerHistory: (profile?.experience ?? resume?.careerHistory ?? []).map(e => ({
          company:          e.company          ?? '',
          jobTitle:         e.jobTitle         ?? '',
          startDate:        e.startDate        ?? '',
          endDate:          e.endDate          ?? null,
          responsibilities: e.responsibilities ?? '',
        })),
        skills:     profile?.skills ?? resume?.skills ?? [],
        education,
        languages:  profile?.languages ?? [],
        validation: [],
      };
      cvBuilderStore.set(userId, seeded);
      return seeded;
    }
    return null;
  }

  // Shared helper: apply a partial update to an existing record.
  // Rules:
  //   - Only CV_SECTIONS keys in the body are merged.
  //   - Sections absent from body are preserved unchanged.
  //   - For education: either or both sub-arrays can be sent independently;
  //     the other sub-array is preserved.
  function applyPartialUpdate(existing, body, { setCompleted = false } = {}) {
    const now = new Date().toISOString();

    const incomingSections = {};
    CV_SECTIONS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        incomingSections[key] = body[key];
      }
    });

    // Deep-merge education sub-arrays when only one sub-key is sent
    let mergedEducation = existing.education ?? { secondaryEducation: [], tertiaryEducation: [] };
    if (incomingSections.education !== undefined) {
      const inc = incomingSections.education;
      if (inc && typeof inc === 'object' && !Array.isArray(inc)) {
        // Structured: merge only the keys that are present
        mergedEducation = {
          secondaryEducation: Object.prototype.hasOwnProperty.call(inc, 'secondaryEducation')
            ? inc.secondaryEducation
            : mergedEducation.secondaryEducation,
          tertiaryEducation: Object.prototype.hasOwnProperty.call(inc, 'tertiaryEducation')
            ? inc.tertiaryEducation
            : mergedEducation.tertiaryEducation,
        };
      } else {
        // Caller sent something else; store as-is
        mergedEducation = inc;
      }
      delete incomingSections.education;
    }

    return {
      ...existing,
      ...incomingSections,
      education:        mergedEducation,
      source:           'BuildCV',
      extractionStatus: setCompleted ? 'COMPLETED' : (incomingSections.extractionStatus ?? existing.extractionStatus ?? 'NOT_STARTED'),
      lastModified:     now,
      createdAt:        existing.createdAt ?? now,
    };
  }

  // ── GET /candidate/buildmycv ────────────────────────────────────────────────
  // Returns the current user's saved Build My CV state.
  // Never errors — returns empty template when no record exists.
  router.get('/buildmycv', (req, res) => {
    const user   = req.currentUser;
    const userId = user?.userId ?? 'USR100001';

    const saved = cvBuilderStore.get(userId) ?? seedIfEmpty(userId);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: saved ? 'CV builder data retrieved.' : 'No saved CV builder data found. Returning empty template.',
      data: {
        userId,
        ...(saved ?? {
          ...EMPTY_CV_TEMPLATE,
          createdAt:    null,
          lastModified: null,
        }),
      },
    });
  });

  // ── POST /candidate/buildmycv ───────────────────────────────────────────────
  // Creates a new Build My CV record. Uses 201 on first creation.
  router.post('/buildmycv', (req, res) => {
    const user   = req.currentUser;
    const userId = user?.userId ?? 'USR100001';

    const isNew  = !cvBuilderStore.has(userId) && !DB.candidateProfiles.find(p => p.userId === userId);
    const existing = cvBuilderStore.get(userId) ?? seedIfEmpty(userId) ?? {
      ...EMPTY_CV_TEMPLATE,
      createdAt:    new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    const updated = applyPartialUpdate(existing, req.body ?? {}, { setCompleted: !isNew });
    cvBuilderStore.set(userId, updated);

    return res.status(isNew ? 201 : 200).json({
      success: true,
      statusCode: isNew ? 201 : 200,
      message: isNew ? 'Build My CV created successfully.' : 'Build My CV updated successfully.',
      data: { userId, ...updated },
    });
  });

  // ── PUT /candidate/buildmycv ────────────────────────────────────────────────
  // Partially updates an existing Build My CV record.
  // Only the sections present in the request body are overwritten.
  // If no record exists, one is created automatically.
  router.put('/buildmycv', (req, res) => {
    const user   = req.currentUser;
    const userId = user?.userId ?? 'USR100001';

    const existing = cvBuilderStore.get(userId) ?? seedIfEmpty(userId) ?? {
      ...EMPTY_CV_TEMPLATE,
      createdAt:    new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    const updated = applyPartialUpdate(existing, req.body ?? {}, { setCompleted: true });
    cvBuilderStore.set(userId, updated);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Build My CV updated successfully.',
      data: { userId, ...updated },
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
        extractionStatus: 'COMPLETED',
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
