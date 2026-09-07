/**
 * CANDIDATE ROUTES  (v2 contract)
 *
 * GET  /candidate/dashboard                          → candidate home dashboard
 * POST /candidate/buildmycv                          → initialise / return CV builder data model
 * GET  /candidate/:resumeId/preview                  → CV preview URL
 * GET  /candidate/:resumeId/download                 → CV download URL
 * GET  /candidate/:candidateId/recommended-jobs      → AI job recommendations
 * POST /applications/:applicationId/cv/upload        → upload & parse CV (multipart mock)
 * GET  /candidates                                   → list all candidates (paginated, filterable)
 */

import { Router } from 'express';
import crypto from 'node:crypto';

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

function toCandidateJob(DB, job, extra = {}) {
  const company = DB.companies.find(({ clientId }) => clientId === job.clientId);
  const industry = DB.industries.find(({ industryId }) => industryId === job.industryId);
  return {
    jobId: job.jobProfileId,
    jobProfileId: job.jobProfileId,
    title: job.positionTitle,
    company: company?.clientName ?? '',
    location: job.locationText ?? '',
    industry: industry?.industryName ?? '',
    employmentType: job.employmentType ?? '',
    workType: job.workType ?? '',
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    salaryRange: job.salaryMin != null && job.salaryMax != null
      ? `R${Number(job.salaryMin).toLocaleString()} - R${Number(job.salaryMax).toLocaleString()}`
      : '',
    description: job.jobDescription ?? '',
    requirements: job.requirements ?? [],
    responsibilities: job.responsibilities ?? [],
    skills: (job.skills ?? []).map((skill) => skill.originalText).filter(Boolean),
    status: job.status,
    applicationCount: job.applicantCount ?? 0,
    postedDate: job.publishedAt ?? '',
    ...extra,
  };
}

function savedJobProfileId(entry) {
  if (typeof entry === 'string') return entry;
  return entry?.jobProfileId ?? entry?.jobId ?? '';
}

function normalizeIndustryNames(DB, industryNames = []) {
  const canonicalIndustryNames = new Map(
    DB.industries.map(({ industryName }) => [industryName.toLowerCase(), industryName]),
  );
  const aliases = new Map([
    ['financial services', 'Banking'],
  ]);

  return industryNames.map((industryName) => {
    const normalizedName = industryName.toLowerCase();
    return aliases.get(normalizedName)
      ?? canonicalIndustryNames.get(normalizedName)
      ?? industryName;
  });
}

function toProfileDesiredJob(DB, desiredJob) {
  if (!desiredJob) return null;

  return {
    ...desiredJob,
    industries: normalizeIndustryNames(DB, desiredJob.industries ?? []),
  };
}

function findCandidateById(DB, candidateId) {
  return DB.candidateProfiles.find((profile) =>
    profile.candidateId === candidateId || profile.candidateUuid === candidateId,
  );
}

function requireCandidateAccess(req, res, profile) {
  if (!profile) {
    res.status(404).json({ message: 'Candidate not found', code: 'CANDIDATE_NOT_FOUND' });
    return false;
  }
  if (req.currentUser?.userId && req.currentUser.userId !== profile.userId) {
    res.status(403).json({ message: 'You do not have permission to access this resource', code: 'FORBIDDEN' });
    return false;
  }
  return true;
}

function toV2PersonalDetails(profile) {
  const details = profile.personalDetails ?? {};
  return {
    first_name: details.firstName ?? '',
    last_name: details.lastName ?? '',
    email: details.email ?? '',
    phone_number: details.mobileNumber ?? null,
    residential_location: details.location ?? null,
    nationality: details.nationality ?? null,
    race: details.race ?? null,
    gender: details.gender ?? null,
    disability_status: details.disabilityStatus ?? null,
    current_company: details.currentCompany ?? null,
    current_position: details.currentPosition ?? null,
    notice_period: details.noticePeriod ?? null,
  };
}

function toV2DesiredJob(desiredJob) {
  if (!desiredJob) return null;
  const employmentType = desiredJob.employmentType ?? desiredJob.jobType ?? '';
  return {
    role_title: desiredJob.jobTitle ?? null,
    targeted_industry: desiredJob.industry ?? desiredJob.industries?.[0] ?? null,
    work_type: String(desiredJob.workType ?? '').toUpperCase() || null,
    employment_type: employmentType === 'Permanent' ? 'FULL_TIME' : String(employmentType).toUpperCase().replaceAll(' ', '_'),
    availability_code: desiredJob.availableFrom ?? null,
  };
}

function toV2Education(education) {
  if (!education) return [];
  if (Array.isArray(education)) return education;
  return [
    ...(education.tertiaryEducation ?? []).map((entry) => ({
      institution_name: entry.institution ?? '',
      qualification: entry.qualification ?? '',
      level_code: 'TERTIARY',
      year_completed: entry.yearCompleted ?? null,
    })),
    ...(education.secondaryEducation ?? []).map((entry) => ({
      institution_name: entry.schoolName ?? '',
      qualification: entry.qualification ?? '',
      level_code: 'SECONDARY',
      year_completed: entry.yearCompleted ?? null,
    })),
  ];
}

function toV2CareerHistory(profile) {
  return (profile.experience ?? []).map((entry) => ({
    company_name: entry.company ?? '',
    position_held: entry.jobTitle ?? '',
    start_date: entry.startDate ?? null,
    end_date: entry.endDate ?? null,
    is_current: entry.current ?? entry.endDate == null,
    responsibilities: Array.isArray(entry.responsibilities)
      ? entry.responsibilities
      : entry.responsibilities ? [entry.responsibilities] : [],
    projects: entry.projects ?? [],
  }));
}

function toV2SavedJob(DB, profile, entry) {
  const jobProfileId = savedJobProfileId(entry);
  const job = DB.jobs.find((candidateJob) => candidateJob.jobProfileId === jobProfileId);
  if (!job) return null;
  const company = DB.companies.find(({ clientId }) => clientId === job.clientId);
  const industry = DB.industries.find(({ industryId }) => industryId === job.industryId);
  const application = (profile.applications ?? []).find((candidateApplication) =>
    candidateApplication.jobProfileId === jobProfileId || candidateApplication.jobId === jobProfileId,
  );
  return {
    saved_job_id: `${profile.candidateId}-${jobProfileId}`,
    job_profile_id: jobProfileId,
    job_title: job.positionTitle,
    job_description: (job.jobDescription ?? '').slice(0, 200),
    location: job.locationText ?? '',
    status: job.status,
    industry: industry?.industryName ?? null,
    current_stage_code: application?.currentStage?.toUpperCase() ?? null,
    saved_at: typeof entry === 'object' && entry.savedAt ? entry.savedAt : null,
    company: company?.clientName ?? '',
    employment_type: job.employmentType ?? null,
  };
}

export function candidateServiceV2Router({ DB, saveDataset }) {
  const router = Router();

  router.get('/landing', (req, res) => {
    const profile = req.currentUser
      ? DB.candidateProfiles.find(({ userId }) => userId === req.currentUser.userId)
      : null;
    if (!profile) return res.status(401).json({ message: 'Authentication required. Please provide a valid JWT token.', code: 'UNAUTHORIZED' });
    const applications = DB.applications.filter((application) =>
      application.userId === profile.userId || application.candidateId === profile.candidateId,
    );
    return res.status(200).json({
      candidate_id: profile.candidateId,
      statistics: {
        total_applications: applications.length,
        successful_applications: applications.filter(({ currentStage }) => ['Offer', 'Placed'].includes(currentStage)).length,
        in_progress_applications: applications.filter(({ currentStage }) => ['Inbound', 'Screening', 'Assessment', 'Interview', 'Shortlisted'].includes(currentStage)).length,
      },
    });
  });

  router.get('/dashboard', (req, res) => {
    const profile = req.currentUser
      ? DB.candidateProfiles.find(({ userId }) => userId === req.currentUser.userId)
      : null;
    if (!profile) return res.status(401).json({ message: 'Authentication required. Please provide a valid JWT token.', code: 'UNAUTHORIZED' });
    const applications = DB.applications.filter((application) =>
      application.userId === profile.userId || application.candidateId === profile.candidateId,
    );
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(1, Number(req.query.size ?? 10)));
    const pageItems = applications.slice((page - 1) * size, page * size).map((application) => ({
      application_id: application.applicationId,
      job_profile_id_ref: application.jobProfileId ?? application.jobId,
      job_title: application.jobTitle ?? '',
      current_stage_code: String(application.currentStage ?? '').toUpperCase(),
      stage_progress: (application.stageHistory ?? []).map((stage) => ({
        stage_history_id: `${application.applicationId}-${stage.stage}`,
        from_stage_code: stage.stage,
        to_stage_code: stage.stage,
      })),
    }));
    return res.status(200).json({
      candidate_id: profile.candidateId,
      applications: pageItems,
      pagination: {
        current_page: page,
        page_size: size,
        total_items: applications.length,
        total_pages: Math.max(1, Math.ceil(applications.length / size)),
      },
    });
  });

  function getProfile(req, res) {
    const profile = findCandidateById(DB, req.params.candidateId);
    return requireCandidateAccess(req, res, profile) ? profile : null;
  }

  router.get('/cv-build/:candidateId', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    return res.status(200).json({
      candidate_id: profile.candidateId,
      personal_details: toV2PersonalDetails(profile),
      career_history: toV2CareerHistory(profile),
      skills: profile.skills ?? [],
      education: toV2Education(profile.education),
      languages: profile.languages ?? [],
    });
  });

  router.post('/cv-build/:candidateId', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    const body = req.body ?? {};
    if (!body.personal_details) return res.status(400).json({ message: 'personal_details is required', code: 'VALIDATION_ERROR' });
    const details = body.personal_details;
    profile.personalDetails = {
      ...profile.personalDetails,
      firstName: details.first_name ?? profile.personalDetails?.firstName ?? '',
      lastName: details.last_name ?? profile.personalDetails?.lastName ?? '',
      mobileNumber: details.phone_number ?? profile.personalDetails?.mobileNumber ?? '',
      location: details.residential_location ?? profile.personalDetails?.location ?? '',
      nationality: details.nationality ?? profile.personalDetails?.nationality ?? '',
      race: details.race ?? profile.personalDetails?.race ?? '',
      gender: details.gender ?? profile.personalDetails?.gender ?? '',
      disabilityStatus: details.disability_status ?? profile.personalDetails?.disabilityStatus ?? '',
      currentCompany: details.current_company ?? profile.personalDetails?.currentCompany ?? '',
      currentPosition: details.current_position ?? profile.personalDetails?.currentPosition ?? '',
      noticePeriod: details.notice_period ?? profile.personalDetails?.noticePeriod ?? '',
    };
    if (body.skills !== undefined) profile.skills = body.skills.map((skill) => typeof skill === 'string' ? skill : skill.skill_name).filter(Boolean);
    if (body.languages !== undefined) profile.languages = body.languages;
    saveDataset?.('candidate-profiles', DB.candidateProfiles);
    return res.status(201).json({ candidate_id: profile.candidateId, personal_details: toV2PersonalDetails(profile), career_history: toV2CareerHistory(profile), skills: profile.skills ?? [], education: toV2Education(profile.education), languages: profile.languages ?? [] });
  });

  router.get('/profile/:candidateId', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    const user = DB.users?.find(({ userId }) => userId === profile.userId);
    return res.status(200).json({
      candidate_id: profile.candidateId,
      user_id: profile.userId,
      personal_details: toV2PersonalDetails(profile),
      desired_job: toV2DesiredJob(profile.desiredJob),
      created_at: user?.createdAt ?? null,
      updated_at: profile.updatedAt ?? user?.createdAt ?? null,
    });
  });

  router.put('/profile/:candidateId', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    const body = req.body ?? {};
    if (!body.personal_details || !body.job_details) return res.status(400).json({ message: 'personal_details and job_details are required', code: 'VALIDATION_ERROR' });
    const details = body.personal_details;
    const job = body.job_details;
    profile.personalDetails = { ...profile.personalDetails, firstName: details.first_name ?? profile.personalDetails?.firstName, lastName: details.last_name ?? profile.personalDetails?.lastName, email: details.alternate_email ?? profile.personalDetails?.email, mobileNumber: details.phone_number ?? profile.personalDetails?.mobileNumber, location: details.residential_location ?? profile.personalDetails?.location };
    profile.desiredJob = { ...profile.desiredJob, jobTitle: job.role_title_id ?? profile.desiredJob?.jobTitle, workType: job.preferred_location ?? profile.desiredJob?.workType, employmentType: job.employment_type ?? profile.desiredJob?.employmentType, availableFrom: job.availability ?? profile.desiredJob?.availableFrom };
    saveDataset?.('candidate-profiles', DB.candidateProfiles);
    return res.status(200).json({ candidate_id: profile.candidateId, profile_status: 'ACTIVE', message: 'Profile updated successfully', updated_at: new Date().toISOString() });
  });

  router.get('/:candidateId/saved-jobs', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(1, Number(req.query.size ?? 10)));
    const all = (profile.savedJobs ?? []).map((entry) => toV2SavedJob(DB, profile, entry)).filter(Boolean);
    return res.status(200).json({ candidate_id: profile.candidateId, saved_jobs: all.slice((page - 1) * size, page * size), pagination: { current_page: page, page_size: size, total_items: all.length, total_pages: Math.max(1, Math.ceil(all.length / size)) } });
  });

  router.get('/:candidateId/recommended-positions', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(1, Number(req.query.size ?? 10)));
    const saved = new Set((profile.savedJobs ?? []).map(savedJobProfileId));
    const jobs = DB.jobs.filter((job) => job.status === 'POSTED').map((job) => ({ job_profile_id: job.jobProfileId, job_title: job.positionTitle, job_description: job.jobDescription ?? '', location: job.locationText ?? '', status: job.status, industry: DB.industries.find(({ industryId }) => industryId === job.industryId)?.industryName ?? null, current_stage_code: null, is_saved: saved.has(job.jobProfileId) }));
    return res.status(200).json({ candidate_id: profile.candidateId, recommended_positions: jobs.slice((page - 1) * size, page * size), pagination: { current_page: page, page_size: size, total_items: jobs.length, total_pages: Math.max(1, Math.ceil(jobs.length / size)) } });
  });

  router.post('/:candidateId/saved-jobs/:jobProfileId', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    const job = DB.jobs.find(({ jobProfileId }) => jobProfileId === req.params.jobProfileId);
    if (!job) return res.status(404).json({ message: 'Job profile not found', code: 'JOB_NOT_FOUND' });
    if (!Array.isArray(profile.savedJobs)) profile.savedJobs = [];
    if (!profile.savedJobs.some((entry) => savedJobProfileId(entry) === job.jobProfileId)) profile.savedJobs.push({ jobProfileId: job.jobProfileId, savedAt: new Date().toISOString() });
    saveDataset?.('candidate-profiles', DB.candidateProfiles);
    const entry = profile.savedJobs.find((candidate) => savedJobProfileId(candidate) === job.jobProfileId);
    return res.status(201).json({ saved_job_id: `${profile.candidateId}-${job.jobProfileId}`, candidate_id: profile.candidateId, job_profile_id: job.jobProfileId, saved_at: entry.savedAt, message: 'Job saved successfully' });
  });

  router.delete('/:candidateId/saved-jobs/:jobProfileId', (req, res) => {
    const profile = getProfile(req, res);
    if (!profile) return;
    profile.savedJobs = (profile.savedJobs ?? []).filter((entry) => savedJobProfileId(entry) !== req.params.jobProfileId);
    saveDataset?.('candidate-profiles', DB.candidateProfiles);
    return res.status(200).json({ candidate_id: profile.candidateId, job_profile_id: req.params.jobProfileId, message: 'Job removed from saved list successfully' });
  });

  return router;
}

export function candidateApplicationsRouter({ DB, saveDataset }) {
  const router = Router();

  // The candidate Swagger defines application reads but omits the write
  // operation required by the job-detail workflow.
  router.post('/applications', (req, res) => {
    const userId = req.currentUser?.userId;
    const profile = DB.candidateProfiles.find((candidate) => candidate.userId === userId);
    if (!profile) {
      return res.status(403).json({
        success: false, statusCode: 403,
        message: 'A candidate profile is required to apply for a job.',
      });
    }

    const jobProfileId = req.body?.jobProfileId;
    if (!jobProfileId) {
      return res.status(400).json({
        success: false, statusCode: 400, message: 'jobProfileId is required.',
      });
    }

    const job = DB.jobs.find((candidateJob) => candidateJob.jobProfileId === jobProfileId);
    if (!job) {
      return res.status(404).json({
        success: false, statusCode: 404, message: `Job ${jobProfileId} not found.`,
      });
    }
    if (job.status !== 'POSTED') {
      return res.status(422).json({
        success: false, statusCode: 422, message: 'This job is not accepting applications.',
      });
    }

    const existing = DB.applications.find((application) =>
      application.userId === userId &&
      (application.jobProfileId === jobProfileId || application.jobId === jobProfileId)
    );
    if (existing) {
      return res.status(409).json({
        success: false, statusCode: 409,
        message: 'You have already applied for this job.',
        data: { applicationId: existing.applicationId },
      });
    }

    const company = DB.companies.find(({ clientId }) => clientId === job.clientId);
    const now = new Date().toISOString();
    const application = {
      applicationId: crypto.randomUUID(),
      userId,
      candidateId: profile.candidateId,
      candidateName: [profile.personalDetails?.firstName, profile.personalDetails?.lastName].filter(Boolean).join(' '),
      jobId: jobProfileId,
      jobProfileId,
      jobTitle: job.positionTitle,
      company: company?.clientName ?? '',
      currentStage: 'Inbound',
      applicationStatus: 'SUBMITTED',
      appliedDate: now.slice(0, 10),
      appliedAt: now,
      updatedAt: now,
      matchScore: 65 + Math.floor(Math.random() * 30),
      sourceChannel: req.body?.sourceChannel ?? 'direct',
      cvId: req.body?.cvId ?? null,
      isGuest: false,
      stageHistory: [{ stage: 'Inbound', enteredAt: now, exitedAt: null }],
    };

    DB.applications.push(application);
    if (!Array.isArray(profile.applications)) profile.applications = [];
    profile.applications.push(application);
    job.applicantCount = (job.applicantCount ?? 0) + 1;
    saveDataset?.('applications', DB.applications);
    saveDataset?.('candidate-profiles', DB.candidateProfiles);
    saveDataset?.('jobs', DB.jobs);

    return res.status(201).json({
      applicationId: application.applicationId,
      jobProfileId,
      matchScore: application.matchScore,
      status: 'submitted',
      nextStep: 'view_dashboard',
    });
  });

  return router;
}

// ─── Candidate dashboard ────────────────────────────────────────────────────
export function candidateDashboardRouter({ DB }) {
  const router = Router();

  // GET /candidate/:userId/dashboard
  router.get('/:userId/dashboard', (req, res) => {
    const { userId } = req.params;
    // Fall back to the authenticated user if the caller passes "me" as the id
    const resolvedId = (userId === 'me' ? req.currentUser?.userId : userId) ?? 'USR100001';
    const profile = DB.candidateProfiles.find(p => p.userId === resolvedId);
    const apps    = DB.applications.filter(
      a => a.userId === resolvedId || (profile && a.candidateId === profile.candidateId)
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
        const overlap    = (j.skills ?? []).filter(s => candidateSkills.includes(s)).length;
        const matchScore = Math.min(99, 55 + overlap * 6 + Math.floor(Math.random() * 15));
        return { ...j, matchScore };
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

// ─── Candidate list ───────────────────────────────────────────────────────────
export function candidateListRouter({ DB }) {
  const router = Router();

  /**
   * GET /candidates
   *
   * Query params (all optional):
   *   page      {number}  default 1
   *   limit     {number}  default 20
   *   search    {string}  filter by first/last name or email (case-insensitive)
   *   location  {string}  filter by location (substring, case-insensitive)
   *   skill     {string}  filter by a skill name (substring, case-insensitive)
   */
  router.get('/', (req, res) => {
    const { page = 1, limit, search, location, skill } = req.query;

    let results = [...DB.candidates];

    if (search) {
      const lc = search.toLowerCase();
      results = results.filter(c =>
        (c.fullName  ?? '').toLowerCase().includes(lc) ||
        (c.email     ?? '').toLowerCase().includes(lc)
      );
    }

    if (location) {
      const lc = location.toLowerCase();
      results = results.filter(c =>
        (c.location ?? '').toLowerCase().includes(lc)
      );
    }

    if (skill) {
      const lc = skill.toLowerCase();
      results = results.filter(c =>
        (c.skills ?? []).some(s => s.toLowerCase().includes(lc))
      );
    }

    const total    = results.length;
    const pageNum  = parseInt(page, 10);
    const pageSize = limit !== undefined ? parseInt(limit, 10) : null;

    const sliced = pageSize !== null
      ? results.slice((pageNum - 1) * pageSize, pageNum * pageSize)
      : results;

    const mapped = sliced.map(c => ({
      candidateId:     c.candidateId,
      fullName:        c.fullName        ?? '',
      email:           c.email           ?? '',
      phone:           c.phone           ?? '',
      location:        c.location        ?? '',
      currentTitle:    c.currentTitle    ?? '',
      currentCompany:  c.currentCompany  ?? '',
      experienceYears: c.experienceYears ?? 0,
      skills:          c.skills          ?? [],
      education:       c.education       ?? [],
      experience:      c.experience      ?? [],
      documents:       c.documents       ?? [],
      languages:       c.languages       ?? [],
      profileComplete: c.profileComplete ?? 0,
      applications:    c.applications    ?? [],
    }));

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Candidates retrieved.',
      data: {
        candidates: mapped,
        pagination: {
          page:       pageNum,
          pageSize:   pageSize ?? total,
          total,
          totalPages: pageSize !== null ? Math.ceil(total / pageSize) : 1,
        },
      },
    });
  });

  return router;
}

// ─── Candidates landing page ──────────────────────────────────────────────────
// Public (no auth required) when hit anonymously — returns marketing stats + featured jobs.
// When hit with a valid bearer token, returns the authenticated candidate's historical
// application statistics instead (see CandidateLandingResponse in candidate_api_swagger_v0.yaml,
// operationId: getCandidateLanding). Both shapes are served from GET /candidates/landing.
export function candidateLandingRouter({ DB }) {
  const router = Router();

  // GET /candidates/landing
  router.get('/landing', (req, res) => {
    if (req.currentUser) {
      const userId  = req.currentUser.userId;
      const profile = DB.candidateProfiles.find(p => p.userId === userId);
      const user    = DB.users?.find(u => u.userId === userId);
      const apps    = DB.applications.filter(
        a => a.userId === userId || (profile && a.candidateId === profile.candidateId)
      );

      const successful = apps.filter(a => ['Offer', 'Placed'].includes(a.currentStage)).length;
      const inProgress = apps.filter(a =>
        ['Screening', 'Assessment', 'Interview', 'Shortlisted'].includes(a.currentStage)
      ).length;
      const rejected   = apps.filter(a => ['Rejected', 'Closed'].includes(a.currentStage)).length;

      return res.status(200).json({
        success:    true,
        statusCode: 200,
        message:    'Landing page data retrieved successfully',
        data: {
          candidate_id: profile?.candidateId ?? null,
          statistics: {
            total_applications:       apps.length,
            successful_applications:  successful,
            in_progress_applications: inProgress,
            rejected_applications:    rejected,
          },
          profile_summary: {
            first_name:     profile?.personalDetails?.firstName ?? user?.firstName ?? '',
            last_name:      profile?.personalDetails?.lastName  ?? user?.lastName  ?? '',
            email:          profile?.personalDetails?.email     ?? user?.email     ?? '',
            profile_status: user?.accountStatus ?? 'INCOMPLETE',
          },
          created_at: user?.createdAt ?? null,
        },
      });
    }

    const openJobs = DB.jobs.filter(j => j.status === 'POSTED');

    // Feature up to 6 open jobs on the landing page
    const featuredJobs = openJobs.slice(0, 6).map(j => toCandidateJob(DB, j));

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Landing page data retrieved.',
      data: {
        stats: {
          totalJobs:        openJobs.length,
          totalCandidates:  DB.candidateProfiles.length,
          totalPlacements:  DB.applications.filter(a =>
            ['Offer', 'Placed'].includes(a.currentStage)
          ).length,
        },
        featuredJobs,
      },
    });
  });

  return router;
}

// ─── Candidate self-service dashboard (token-resolved) ───────────────────────
export function candidateSelfDashboardRouter({ DB }) {
  const router = Router();

  const APPLICATION_PIPELINE = ['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'SHORTLISTED', 'OFFER'];
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

  // GET /candidates/dashboard
  router.get('/dashboard', (req, res) => {
    const userId     = req.currentUser?.userId ?? 'USR100001';
    const profile    = DB.candidateProfiles.find(p => p.userId === userId);
    const apps       = DB.applications.filter(
      a => a.userId === userId || (profile && a.candidateId === profile.candidateId)
    );

    const submitted  = apps.filter(a => a.currentStage === 'Inbound').length;
    const inProgress = apps.filter(a =>
      ['Screening', 'Assessment', 'Interview', 'Shortlisted'].includes(a.currentStage)
    ).length;
    const successful = apps.filter(a => ['Offer', 'Placed'].includes(a.currentStage)).length;

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Dashboard data retrieved.',
      data: {
        id:          userId,
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

// ─── Candidate self profile ───────────────────────────────────────────────────
export function candidateProfileRouter({ DB }) {
  const router = Router();

  // GET /candidates/profile/
  router.get('/profile/', (req, res) => {
    const userId  = req.currentUser?.userId ?? 'USR100001';
    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    if (!profile)
      return res.status(404).json({
        success: false, statusCode: 404,
        message: `Profile not found for user ${userId}.`,
      });

    const user   = DB.users?.find(u => u.userId === userId);
    const resume = DB.resumes.find(r => r.userId === userId);

    // Normalise education into EducationRecord shape
    const rawEdu = profile.education;
    let education;
    if (Array.isArray(rawEdu)) {
      education = {
        secondaryEducation: [],
        tertiaryEducation: rawEdu.map(e => ({
          institution:   e.institution   ?? '',
          qualification: e.qualification ?? '',
          fieldOfStudy:  e.fieldOfStudy  ?? '',
          yearCompleted: e.endYear ?? e.yearCompleted ?? e.year ?? null,
        })),
      };
    } else {
      education = rawEdu ?? { secondaryEducation: [], tertiaryEducation: [] };
    }

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Candidate profile retrieved.',
      data: {
        candidateId:      profile.candidateId,
        userId:           profile.userId,
        accountStatus:    user?.accountStatus ?? 'ACTIVE',
        profileCompleted: user?.profileCompleted ?? 85,
        personalDetails:  profile.personalDetails,
        desiredJob:       toProfileDesiredJob(DB, profile.desiredJob),
        education,
        experience:       profile.experience ?? [],
        skills:           profile.skills ?? [],
        languages:        profile.languages ?? [],
        resume: resume ? {
          resumeId:    resume.resumeId,
          previewUrl:  resume.previewUrl,
          downloadUrl: resume.downloadUrl,
          updatedAt:   resume.updatedAt,
        } : null,
        applications: (profile.applications ?? []).map(a => ({
          applicationId: a.applicationId,
          jobId:         a.jobId,
          mandateId:     a.mandateId ?? null,
          recruiterId:   a.recruiterId ?? null,
          jobTitle:      a.jobTitle,
          company:       a.company,
          currentStage:  a.currentStage,
          appliedDate:   a.appliedDate,
          updatedAt:     a.updatedAt ?? null,
          matchScore:    a.matchScore,
        })),
        savedJobs: profile.savedJobs ?? [],
      },
    });
  });

  return router;
}

// ─── Candidate CV Build (new path /candidates/cv-build/) ─────────────────────
export function candidateCvBuildRouter({ DB }) {
  const router = Router();

  const CV_SECTIONS_B = ['personalDetails', 'careerHistory', 'skills', 'education', 'languages', 'extractionStatus', 'validation'];
  const EMPTY_TMPL = {
    source:           'BuildCV',
    extractionStatus: 'NOT_STARTED',
    personalDetails: {
      firstName: '', lastName: '', race: '', gender: '',
      disabilityStatus: '', nationality: '', location: '',
      currentCompany: '', currentPosition: '', noticePeriod: '',
    },
    careerHistory: [],
    skills:        [],
    education: { secondaryEducation: [], tertiaryEducation: [] },
    languages:  [],
    validation: [],
  };

  // In-memory store shared with legacy cvBuilderRouter via module-level Map
  // (declared here to keep this router self-contained)
  const store = new Map();

  function seedIfEmpty(userId) {
    if (store.has(userId)) return store.get(userId);
    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    const resume  = DB.resumes.find(r => r.userId === userId);
    if (!profile && !resume) return null;

    const now    = new Date().toISOString();
    const rawEdu = profile?.education ?? resume?.education ?? {};
    let education;
    if (Array.isArray(rawEdu)) {
      education = {
        secondaryEducation: [],
        tertiaryEducation: rawEdu.map(e => ({
          institution:   e.institution   ?? '',
          qualification: e.qualification ?? '',
          fieldOfStudy:  e.fieldOfStudy  ?? '',
          yearCompleted: e.endYear ?? e.yearCompleted ?? e.year ?? null,
        })),
      };
    } else {
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
      resumeId:        resume?.resumeId ?? '',
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
      skills:    profile?.skills ?? resume?.skills ?? [],
      education,
      languages: profile?.languages ?? [],
      validation: [],
    };
    store.set(userId, seeded);
    return seeded;
  }

  function applyUpdate(existing, body) {
    const now      = new Date().toISOString();
    const incoming = {};
    CV_SECTIONS_B.forEach(k => {
      if (Object.prototype.hasOwnProperty.call(body, k)) incoming[k] = body[k];
    });

    let mergedEdu = existing.education ?? { secondaryEducation: [], tertiaryEducation: [] };
    if (incoming.education !== undefined) {
      const inc = incoming.education;
      if (inc && typeof inc === 'object' && !Array.isArray(inc)) {
        mergedEdu = {
          secondaryEducation: Object.prototype.hasOwnProperty.call(inc, 'secondaryEducation')
            ? inc.secondaryEducation : mergedEdu.secondaryEducation,
          tertiaryEducation: Object.prototype.hasOwnProperty.call(inc, 'tertiaryEducation')
            ? inc.tertiaryEducation : mergedEdu.tertiaryEducation,
        };
      } else {
        mergedEdu = inc;
      }
      delete incoming.education;
    }

    return {
      ...existing,
      ...incoming,
      education:        mergedEdu,
      source:           'BuildCV',
      extractionStatus: incoming.extractionStatus ?? existing.extractionStatus ?? 'NOT_STARTED',
      lastModified:     now,
      createdAt:        existing.createdAt ?? now,
    };
  }

  // GET /candidates/cv-build/
  router.get('/cv-build/', (req, res) => {
    const userId = req.currentUser?.userId ?? 'USR100001';
    const saved  = store.get(userId) ?? seedIfEmpty(userId);

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    saved ? 'CV builder data retrieved.' : 'No saved CV data. Returning empty template.',
      data: {
        userId,
        ...(saved ?? { ...EMPTY_TMPL, createdAt: null, lastModified: null }),
      },
    });
  });

  // POST /candidates/cv-build/
  router.post('/cv-build/', (req, res) => {
    const userId   = req.currentUser?.userId ?? 'USR100001';
    const isNew    = !store.has(userId) && !DB.candidateProfiles.find(p => p.userId === userId);
    const existing = store.get(userId) ?? seedIfEmpty(userId) ?? {
      ...EMPTY_TMPL,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    const updated = applyUpdate(existing, req.body ?? {});
    updated.resumeId = existing.resumeId || `RES-BUILD-${userId}`;
    if (!isNew) updated.extractionStatus = 'COMPLETED';
    store.set(userId, updated);

    return res.status(isNew ? 201 : 200).json({
      success:    true,
      statusCode: isNew ? 201 : 200,
      message:    isNew ? 'Build My CV created successfully.' : 'Build My CV updated successfully.',
      data: { userId, ...updated },
    });
  });

  // PUT /candidates/cv-build/
  router.put('/cv-build/', (req, res) => {
    const userId   = req.currentUser?.userId ?? 'USR100001';
    const existing = store.get(userId) ?? seedIfEmpty(userId) ?? {
      ...EMPTY_TMPL,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    const updated = applyUpdate(existing, req.body ?? {});
    updated.extractionStatus = 'COMPLETED';
    store.set(userId, updated);

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Build My CV updated successfully.',
      data: { userId, ...updated },
    });
  });

  return router;
}

// ─── Candidate recommended positions ─────────────────────────────────────────
export function candidateRecommendedPositionsRouter({ DB }) {
  const router = Router();

  // GET /candidates/recommended-positions
  router.get('/recommended-positions', (req, res) => {
    const userId      = req.currentUser?.userId ?? 'USR100001';
    const profile     = DB.candidateProfiles.find(p => p.userId === userId);
    const candidateId = profile?.candidateId ?? userId;
    const skills      = profile?.skills ?? [];

    const jobs = DB.jobs
      .filter(j => j.status === 'POSTED')
      .slice(0, 6)
      .map(j => {
        const overlap = (j.skills ?? [])
          .map((skill) => skill.originalText)
          .filter((skill) => skills.includes(skill)).length;
        const matchScore = Math.min(99, 55 + overlap * 6 + Math.floor(Math.random() * 15));
        return toCandidateJob(DB, j, { matchScore });
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Recommended positions retrieved.',
      data: { candidateId, jobs, total: jobs.length },
    });
  });

  return router;
}

// ─── Candidate saved jobs ─────────────────────────────────────────────────────
export function candidateSavedJobsRouter({ DB }) {
  const router = Router();

  // GET /candidates/saved-jobs
  router.get('/saved-jobs', (req, res) => {
    const userId      = req.currentUser?.userId ?? 'USR100001';
    const profile     = DB.candidateProfiles.find(p => p.userId === userId);
    const candidateId = profile?.candidateId ?? userId;

    const savedJobIds = profile?.savedJobs ?? [];
    const jobs = savedJobIds.map(entry => {
      const jobProfileId = savedJobProfileId(entry);
      const savedAt = typeof entry === 'object' ? entry.savedAt : null;
      const job = DB.jobs.find(j => j.jobProfileId === jobProfileId);
      if (!job) return null;
      return toCandidateJob(DB, job, {
        savedAt: savedAt ?? new Date().toISOString(),
      });
    }).filter(Boolean);

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Saved jobs retrieved.',
      data: { candidateId, jobs, total: jobs.length },
    });
  });

  // DELETE /candidates/saved-jobs/:jobProfileId
  router.delete('/saved-jobs/:jobProfileId', (req, res) => {
    const userId  = req.currentUser?.userId ?? 'USR100001';
    const { jobProfileId } = req.params;

    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    if (profile && Array.isArray(profile.savedJobs)) {
      profile.savedJobs = profile.savedJobs.filter(e =>
        savedJobProfileId(e) !== jobProfileId
      );
    }

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    `Job ${jobProfileId} removed from saved jobs.`,
    });
  });

  // POST /candidates/saved-jobs
  router.post('/saved-jobs', (req, res) => {
    const userId  = req.currentUser?.userId ?? 'USR100001';
    const jobProfileId = req.body?.jobProfileId ?? req.body?.jobId;

    if (!jobProfileId)
      return res.status(400).json({
        success: false, statusCode: 400, message: 'jobProfileId is required.',
      });

    const job = DB.jobs.find(j => j.jobProfileId === jobProfileId);
    if (!job)
      return res.status(404).json({
        success: false, statusCode: 404, message: `Job ${jobProfileId} not found.`,
      });

    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    if (profile) {
      if (!Array.isArray(profile.savedJobs)) profile.savedJobs = [];
      const alreadySaved = profile.savedJobs.some(e =>
        savedJobProfileId(e) === jobProfileId
      );
      if (!alreadySaved) {
        profile.savedJobs.push({ jobProfileId, savedAt: new Date().toISOString() });
      }
    }

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    `Job ${jobProfileId} saved successfully.`,
    });
  });

  return router;
}

// ─── Candidate AI actions ─────────────────────────────────────────────────────
export function candidateAiActionsRouter({ DB }) {
  const router = Router();

  // GET /candidates/ai-actions/
  router.get('/ai-actions/', (req, res) => {
    const userId      = req.currentUser?.userId ?? 'USR100001';
    const profile     = DB.candidateProfiles.find(p => p.userId === userId);
    const candidateId = profile?.candidateId ?? userId;
    const skills      = profile?.skills ?? [];

    // Count open jobs with at least one skill overlap
    const openJobs       = DB.jobs.filter(j => j.status === 'POSTED');
    const matchingJobs   = openJobs.filter(j =>
      (j.skills ?? []).some((skill) => skills.includes(skill.originalText))
    );
    const topMatchScore  = matchingJobs.length > 0 ? 88 : 60;

    const actions = [
      {
        actionId:    'ai-action-match-summary',
        type:        'MATCH_SUMMARY',
        label:       `Your profile is ${topMatchScore}% matched to ${matchingJobs.length} open role${matchingJobs.length !== 1 ? 's' : ''}`,
        description: 'Based on your skills and experience.',
        payload:     { matchedCount: matchingJobs.length, topMatchScore },
      },
    ];

    if (skills.length < 5) {
      actions.push({
        actionId:    'ai-action-skill-gap',
        type:        'SKILL_GAP',
        label:       'Add more skills to improve your visibility',
        description: 'Candidates with 5+ skills get 3× more recruiter views.',
        payload:     { currentSkillCount: skills.length, recommendedMinimum: 5 },
      });
    }

    if (matchingJobs.length > 0) {
      actions.push({
        actionId:    'ai-action-matched-jobs',
        type:        'SEND_MATCHED_JOBS',
        label:       `View your ${matchingJobs.length} matched position${matchingJobs.length !== 1 ? 's' : ''}`,
        description: 'Recruiters are actively looking for your skills.',
        payload:     { jobIds: matchingJobs.slice(0, 3).map(j => j.jobProfileId) },
      });
    }

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'AI actions retrieved.',
      data: { candidateId, actions },
    });
  });

  return router;
}
