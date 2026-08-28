/**
 * AI SERVICE ROUTES  (ai-service_v0.yaml)
 *
 * POST /skills/generate                                    → candidate/visitor skill generation
 * POST /jobs/skills/generate                                → job posting skill generation (creates DRAFT job)
 * GET  /candidates/:candidateId/recommended-jobs            → [INTERNAL] ranked job recommendations
 * POST /jobs/:jobProfileId/match-scores                      → [INTERNAL] trigger match scoring batch
 * GET  /jobs/:jobProfileId/match-scores/:batchRunId          → [INTERNAL] poll match scoring batch
 * GET  /candidates/:candidateId/match-score/:jobProfileId    → [INTERNAL] latest candidate-job match score
 * POST /candidates/:candidateId/ai-actions                   → [INTERNAL] generate recruiter next-actions
 * GET  /candidates/:candidateId/ai-actions                   → last saved recruiter next-actions
 */

import { Router } from "express";
import crypto from "node:crypto";

// ─── Shared lookups ───────────────────────────────────────────────────────────
function findCandidateProfile(DB, id) {
  return DB.candidateProfiles.find(
    (p) => p.candidateId === id || p.candidateUuid === id || p.userId === id,
  );
}

function findJob(DB, id) {
  return DB.jobs.find((j) => j.jobProfileId === id || j.jobId === id);
}

function hash(text) {
  return crypto
    .createHash("sha256")
    .update(text ?? "")
    .digest("hex");
}

// Matches the free-text career history / OCR text / job description against the
// skillsmine.skill master table (data/skills.json) — a simple substring match,
// falling back to a handful of popular skills so the response is never empty.
function matchSkillsFromText(DB, text) {
  const lc = (text ?? "").toLowerCase();
  let matches = DB.skills.filter((s) => lc.includes(s.name.toLowerCase()));
  if (matches.length === 0) matches = DB.skills.slice(0, 5);
  return matches
    .slice(0, 8)
    .map((s) => ({ skillId: s.aiSkillId, skillName: s.name }));
}

const WORK_TYPE_MAP = {
  Remote: "REMOTE",
  Hybrid: "HYBRID",
  "On-site": "ONSITE",
  Onsite: "ONSITE",
};
const EMPLOYMENT_TYPE_MAP = {
  Permanent: "FULL_TIME",
  "Full-time": "FULL_TIME",
  "Full Time": "FULL_TIME",
  "Part-time": "PART_TIME",
  Contract: "CONTRACT",
  Temporary: "TEMPORARY",
  Internship: "INTERNSHIP",
  Freelance: "FREELANCE",
};

function badRequest(res, message) {
  return res
    .status(400)
    .json({ status: 400, code: "VALIDATION_ERROR", message });
}
function notFound(res, message) {
  return res.status(404).json({ status: 404, code: "NOT_FOUND", message });
}

// ─── 1. Candidate / Visitor skill generation ─────────────────────────────────
export function aiSkillsGenerateRouter({ DB }) {
  const router = Router();

  // POST /skills/generate
  router.post("/generate", (req, res) => {
    const body = req.body ?? {};
    const {
      subject_type,
      subject_id,
      visitor_registration,
      input_source,
      career_history,
      ocr_context,
    } = body;

    if (!["CANDIDATE", "VISITOR"].includes(subject_type))
      return badRequest(res, "subject_type must be one of CANDIDATE, VISITOR");
    if (!["PROFILE", "OCR"].includes(input_source))
      return badRequest(res, "input_source must be one of PROFILE, OCR");
    if (
      input_source === "PROFILE" &&
      (!Array.isArray(career_history) || career_history.length === 0)
    )
      return badRequest(
        res,
        "career_history is required when input_source = PROFILE.",
      );
    if (input_source === "OCR" && !ocr_context?.extracted_text)
      return res
        .status(422)
        .json({
          status: 422,
          code: "OCR_NOT_READY",
          message:
            "ocr_context is required when input_source = OCR and the referenced ocr_job must be COMPLETE.",
        });

    let useCaseCode;
    let resolvedSubjectId = subject_id;
    let visitorCreated;

    if (subject_type === "CANDIDATE") {
      if (!req.currentUser)
        return res
          .status(401)
          .json({
            status: 401,
            code: "UNAUTHORIZED",
            message: "Bearer token required for CANDIDATE subject_type.",
          });
      if (!subject_id)
        return badRequest(
          res,
          "subject_id is required for CANDIDATE subject_type.",
        );
      const profile = findCandidateProfile(DB, subject_id);
      if (!profile) return notFound(res, `Candidate ${subject_id} not found.`);
      useCaseCode = "CANDIDATE_SKILL_GENERATION";
      resolvedSubjectId = profile.candidateUuid ?? profile.candidateId;
    } else {
      useCaseCode = "VISITOR_SKILL_GENERATION";
      if (subject_id) {
        const visitor = DB.visitorProfiles.find(
          (v) => v.visitorId === subject_id,
        );
        if (!visitor) return notFound(res, `Visitor ${subject_id} not found.`);
        resolvedSubjectId = visitor.visitorId;
      } else {
        if (
          !visitor_registration?.email ||
          !visitor_registration?.first_name ||
          !visitor_registration?.last_name ||
          !visitor_registration?.phone_number
        )
          return badRequest(
            res,
            "visitor_registration (email, first_name, last_name, phone_number) is required for a new visitor.",
          );
        const newVisitor = {
          visitorId: crypto.randomUUID(),
          email: visitor_registration.email,
          firstName: visitor_registration.first_name,
          lastName: visitor_registration.last_name,
          phoneNumber: visitor_registration.phone_number,
          createdAt: new Date().toISOString(),
        };
        DB.visitorProfiles.push(newVisitor);
        resolvedSubjectId = newVisitor.visitorId;
        visitorCreated = true;
      }
    }

    const text =
      input_source === "PROFILE"
        ? career_history
            .map(
              (e) =>
                `${e.position_held ?? ""} ${(e.responsibilities ?? []).join(" ")} ${(e.projects ?? []).join(" ")}`,
            )
            .join(" ")
        : ocr_context.extracted_text;

    const suggestions = matchSkillsFromText(DB, text);
    const generatedAt = new Date().toISOString();
    const run = {
      aiGenerationRunId: crypto.randomUUID(),
      useCaseCode,
      subjectType: subject_type,
      subjectId: resolvedSubjectId,
      visitorCreated,
      inputSource: input_source,
      inputHash: hash(text),
      suggestedSkills: suggestions,
      generatedAt,
    };
    DB.aiGenerationRuns.push(run);

    return res.status(200).json({
      ai_generation_run_id: run.aiGenerationRunId,
      use_case_code: useCaseCode,
      subject_id: resolvedSubjectId,
      visitor_created: visitorCreated,
      suggested_skills: suggestions.map((s) => ({
        skill_id: s.skillId,
        skill_name: s.skillName,
      })),
      generated_at: generatedAt,
    });
  });

  return router;
}

// ─── 2. Job posting skill generation ─────────────────────────────────────────
export function aiJobSkillsGenerateRouter({ DB }) {
  const router = Router();

  // POST /jobs/skills/generate
  router.post("/skills/generate", (req, res) => {
    const {
      company_name,
      position_title,
      fill_by_date,
      responsibilities,
      job_description,
      requirements,
      experience_level,
    } = req.body ?? {};

    if (
      !company_name ||
      !position_title ||
      !fill_by_date ||
      !Array.isArray(responsibilities) ||
      responsibilities.length === 0
    )
      return badRequest(
        res,
        "company_name, position_title, fill_by_date and responsibilities are required.",
      );

    const text = [
      position_title,
      ...responsibilities,
      job_description ?? "",
      ...(requirements ?? []),
    ].join(" ");
    const suggestions = matchSkillsFromText(DB, text);
    const jobProfileId = crypto.randomUUID();
    const seq = DB.jobs.length + 1;

    const newJob = {
      jobId: `j${String(seq).padStart(3, "0")}`,
      jobProfileId,
      jobReferenceNumber: `JOB-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`,
      title: position_title,
      company: company_name,
      location: null,
      industry: null,
      employmentType: null,
      workType: null,
      salaryMin: null,
      salaryMax: null,
      salaryRange: null,
      description: job_description ?? "",
      requirements: requirements ?? [],
      responsibilities,
      skills: suggestions.map((s) => s.skillName),
      fillByDate: fill_by_date,
      experienceLevel: experience_level ?? null,
      postedDate: null,
      status: "DRAFT",
      applicationCount: 0,
      recruiterId: req.currentUser?.recruiterId ?? null,
    };
    DB.jobs.push(newJob);

    const generatedAt = new Date().toISOString();
    const run = {
      aiGenerationRunId: crypto.randomUUID(),
      useCaseCode: "JOB_PROFILE_SKILL_GENERATION",
      subjectType: "JOB",
      subjectId: jobProfileId,
      jobProfileId,
      inputSource: "PROFILE",
      inputHash: hash(text),
      suggestedSkills: suggestions,
      generatedAt,
    };
    DB.aiGenerationRuns.push(run);

    return res.status(200).json({
      ai_generation_run_id: run.aiGenerationRunId,
      job_profile_id: jobProfileId,
      job_status: "DRAFT",
      suggested_skills: suggestions.map((s) => ({
        skill_id: s.skillId,
        skill_name: s.skillName,
      })),
      generated_at: generatedAt,
    });
  });

  return router;
}

// ─── 3. Recommended jobs for candidate  [INTERNAL] ───────────────────────────
export function aiRecommendedJobsRouter({ DB }) {
  const router = Router();

  // GET /candidates/:candidateId/recommended-jobs
  router.get("/:candidateId/recommended-jobs", (req, res) => {
    const { candidateId } = req.params;
    const profile = findCandidateProfile(DB, candidateId);
    if (!profile) return notFound(res, `Candidate ${candidateId} not found.`);

    const page = parseInt(req.query.page, 10) || 0;
    const size = Math.min(parseInt(req.query.size, 10) || 10, 50);
    const minMatchScore =
      req.query.min_match_score !== undefined
        ? parseFloat(req.query.min_match_score)
        : 40;
    const includeApplied =
      req.query.include_applied === "true" ||
      req.query.include_applied === true;

    const appliedJobIds = new Set(
      (profile.applications ?? []).map((a) => a.jobId),
    );
    const skills = profile.skills ?? [];

    let candidates = DB.jobs.filter((j) => j.status === "Open");
    if (!includeApplied)
      candidates = candidates.filter((j) => !appliedJobIds.has(j.jobId));

    const scored = candidates
      .map((job) => {
        const savedScore = DB.aiScoringRuns.find(
          (r) =>
            r.jobId === job.jobId &&
            (r.candidateId === profile.candidateId ||
              r.candidateUuid === profile.candidateUuid),
        );
        const overlapSkills = (job.skills ?? []).filter((s) =>
          skills.includes(s),
        );
        const matchScore =
          savedScore?.matchScore ??
          Math.min(99, 40 + overlapSkills.length * 10);

        const reasons = [];
        if (overlapSkills.length > 0)
          reasons.push(
            `${overlapSkills.length} matching skill${overlapSkills.length !== 1 ? "s" : ""}`,
          );
        if (profile.desiredJob?.jobTitle && job.title)
          reasons.push("Matches preferred role title");
        if (
          profile.desiredJob?.workType &&
          profile.desiredJob.workType === job.workType
        )
          reasons.push(`${job.workType} work type matches preference`);

        return { job, matchScore, reasons };
      })
      .filter((x) => x.matchScore >= minMatchScore)
      .sort((a, b) => b.matchScore - a.matchScore);

    const total = scored.length;
    const startIdx = page * size;
    const pageItems = scored.slice(startIdx, startIdx + size);

    const recommendedJobs = pageItems.map(({ job, matchScore, reasons }) => ({
      job_profile_id: job.jobProfileId,
      job_reference_number: job.jobReferenceNumber,
      position_title: job.title,
      company_name: job.company,
      location_text: job.location ?? null,
      work_type: WORK_TYPE_MAP[job.workType] ?? null,
      employment_type: EMPLOYMENT_TYPE_MAP[job.employmentType] ?? null,
      salary_min: job.salaryMin ?? null,
      salary_max: job.salaryMax ?? null,
      currency_code: "ZAR",
      industry_names: job.industry ? [job.industry] : [],
      skills_required: job.skills ?? [],
      job_description_snippet: (job.description ?? "").slice(0, 200),
      match_score: matchScore,
      match_reasons: reasons,
      is_bookmarked: (profile.savedJobs ?? []).some(
        (e) => (typeof e === "string" ? e : e.jobId) === job.jobId,
      ),
      published_at: job.postedDate
        ? new Date(job.postedDate).toISOString()
        : null,
    }));

    return res.status(200).json({
      candidate_id: profile.candidateUuid ?? profile.candidateId,
      recommended_jobs: recommendedJobs,
      pagination: {
        page,
        size,
        total_elements: total,
        total_pages: Math.max(1, Math.ceil(total / size)),
      },
    });
  });

  return router;
}

// ─── 4. Job-candidate matching & scoring  [INTERNAL] ─────────────────────────
function computeScore(profile, job) {
  const skills = profile.skills ?? [];
  const jobSkills = job.skills ?? [];
  const matched = jobSkills.filter((s) => skills.includes(s));
  const missing = jobSkills.filter((s) => !skills.includes(s));

  const skillOverlap = jobSkills.length
    ? Math.round((matched.length / jobSkills.length) * 100)
    : 50;
  const roleAlignment =
    profile.desiredJob?.jobTitle &&
    job.title
      ?.toLowerCase()
      .includes(profile.desiredJob.jobTitle.toLowerCase().split(" ").pop())
      ? 85
      : 55;
  const experienceLevel = Math.min(
    100,
    (profile.experience?.length ?? 0) * 25 + 40,
  );
  const education =
    (profile.education?.tertiaryEducation?.length ?? 0) > 0 ? 80 : 60;
  const workEmployment =
    profile.desiredJob?.workType === job.workType ? 100 : 60;
  const location =
    profile.personalDetails?.location &&
    job.location?.includes(profile.personalDetails.location.split(",")[0])
      ? 90
      : 50;

  const matchScore = Math.round(
    skillOverlap * 0.4 +
      roleAlignment * 0.2 +
      experienceLevel * 0.15 +
      education * 0.1 +
      workEmployment * 0.1 +
      location * 0.05,
  );

  return {
    candidate_id: profile.candidateUuid ?? profile.candidateId,
    candidateIdInternal: profile.candidateId,
    scoring_run_id: crypto.randomUUID(),
    match_score: matchScore,
    score_breakdown: {
      skill_overlap: skillOverlap,
      role_title_alignment: roleAlignment,
      experience_level: experienceLevel,
      education,
      work_employment_type: workEmployment,
      location,
    },
    matched_skills: matched,
    missing_skills: missing,
    status: "SCORED",
    scored_at: new Date().toISOString(),
  };
}

export function aiMatchScoringRouter({ DB }) {
  const router = Router();
  const batchRuns = new Map(); // batchRunId → batch record

  // POST /jobs/:jobProfileId/match-scores
  router.post("/:jobProfileId/match-scores", (req, res) => {
    const { jobProfileId } = req.params;
    const job = findJob(DB, jobProfileId);
    if (!job) return notFound(res, `Job ${jobProfileId} not found.`);

    const { candidate_ids = [] } = req.body ?? {};
    let profiles;
    if (Array.isArray(candidate_ids) && candidate_ids.length > 0) {
      profiles = candidate_ids
        .map((id) => findCandidateProfile(DB, id))
        .filter(Boolean);
    } else {
      const applicantIds = new Set(
        DB.applications
          .filter((a) => a.jobId === job.jobId)
          .map((a) => a.candidateId),
      );
      profiles = DB.candidateProfiles.filter((p) =>
        applicantIds.has(p.candidateId),
      );
    }

    const results = profiles.map((profile) => computeScore(profile, job));

    // Write the freshest score back onto the matching application record
    results.forEach((r) => {
      const app = DB.applications.find(
        (a) => a.candidateId === r.candidateIdInternal && a.jobId === job.jobId,
      );
      if (app) app.matchScore = r.match_score;
    });

    const batchRunId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    batchRuns.set(batchRunId, {
      batchRunId,
      jobProfileId: job.jobProfileId,
      batchStatus: "COMPLETED",
      totalCandidates: results.length,
      scoredCount: results.length,
      failedCount: 0,
      results,
      createdAt,
      completedAt: new Date().toISOString(),
    });

    return res.status(202).json({
      batch_run_id: batchRunId,
      job_profile_id: job.jobProfileId,
      candidate_count: results.length,
      batch_status: "PENDING",
      created_at: createdAt,
      poll_url: `/jobs/${job.jobProfileId}/match-scores/${batchRunId}`,
    });
  });

  // GET /jobs/:jobProfileId/match-scores/:batchRunId
  router.get("/:jobProfileId/match-scores/:batchRunId", (req, res) => {
    const { batchRunId } = req.params;
    const batch = batchRuns.get(batchRunId);
    if (!batch) return notFound(res, `Batch run ${batchRunId} not found.`);

    return res.status(200).json({
      batch_run_id: batch.batchRunId,
      job_profile_id: batch.jobProfileId,
      batch_status: batch.batchStatus,
      total_candidates: batch.totalCandidates,
      scored_count: batch.scoredCount,
      failed_count: batch.failedCount,
      results: batch.results.map(({ candidateIdInternal, ...r }) => r),
      created_at: batch.createdAt,
      completed_at: batch.completedAt,
    });
  });

  return router;
}

// ─── Latest candidate-job match score  [INTERNAL] ────────────────────────────
export function aiCandidateMatchScoreRouter({ DB }) {
  const router = Router();

  // GET /candidates/:candidateId/match-score/:jobProfileId
  router.get("/:candidateId/match-score/:jobProfileId", (req, res) => {
    const { candidateId, jobProfileId } = req.params;
    const profile = findCandidateProfile(DB, candidateId);
    if (!profile) return notFound(res, `Candidate ${candidateId} not found.`);
    const job = findJob(DB, jobProfileId);
    if (!job) return notFound(res, `Job ${jobProfileId} not found.`);

    const existing = DB.aiScoringRuns
      .filter(
        (r) =>
          (r.candidateId === profile.candidateId ||
            r.candidateUuid === profile.candidateUuid) &&
          (r.jobId === job.jobId || r.jobProfileId === job.jobProfileId),
      )
      .sort((a, b) => new Date(b.scoredAt) - new Date(a.scoredAt))[0];

    if (!existing) {
      return res.status(200).json({
        candidate_id: profile.candidateUuid ?? profile.candidateId,
        job_profile_id: job.jobProfileId,
        scoring_run_id: null,
        status: "NOT_SCORED",
        match_score: null,
        score_breakdown: null,
        matched_skills: [],
        missing_skills: [],
        scored_at: null,
      });
    }

    return res.status(200).json({
      candidate_id: profile.candidateUuid ?? profile.candidateId,
      job_profile_id: job.jobProfileId,
      scoring_run_id: existing.scoringRunId,
      status: "SCORED",
      match_score: existing.matchScore,
      score_breakdown: {
        skill_overlap: existing.scoreBreakdown.skillOverlap,
        role_title_alignment: existing.scoreBreakdown.roleTitleAlignment,
        experience_level: existing.scoreBreakdown.experienceLevel,
        education: existing.scoreBreakdown.education,
        work_employment_type: existing.scoreBreakdown.workEmploymentType,
        location: existing.scoreBreakdown.location,
      },
      matched_skills: existing.matchedSkills,
      missing_skills: existing.missingSkills,
      scored_at: existing.scoredAt,
    });
  });

  return router;
}

// ─── 5. AI next-actions for recruiter (candidate detail page) ────────────────
function requireRecruiterRole(req, res) {
  const roles = req.currentUser?.roles ?? [];
  const allowed = ["RECRUITER", "MANCO", "EXCO"];
  if (!roles.some((r) => allowed.includes(r))) {
    res
      .status(403)
      .json({
        status: 403,
        code: "FORBIDDEN",
        message: "Only RECRUITER, MANCO or EXCO roles may access AI actions.",
      });
    return false;
  }
  return true;
}

function generateActionsForCandidate(DB, profile, jobProfileIdFilter) {
  const actions = [];
  const firstName = profile.personalDetails?.firstName ?? "This candidate";
  let apps = profile.applications ?? [];

  if (jobProfileIdFilter) {
    const job = findJob(DB, jobProfileIdFilter);
    apps = apps.filter((a) => a.jobId === job?.jobId);
  }

  apps.forEach((app) => {
    const score = app.matchScore ?? 0;
    const jobProfileId = findJob(DB, app.jobId)?.jobProfileId ?? null;

    if (score >= 80 && ["Inbound", "Screening"].includes(app.currentStage)) {
      actions.push({
        actionType: "MOVE_TO_NEXT_STAGE",
        priority: "HIGH",
        title: "Move to Interview",
        description: `${firstName} scored ${score}% against the ${app.jobTitle} role at ${app.company} and has passed screening.`,
        jobProfileId,
        jobTitle: app.jobTitle,
        companyName: app.company,
        ctaLabel: "Schedule Interview",
        ctaAction: "ADVANCE_STAGE",
      });
    }
    if (app.currentStage === "Shortlisted") {
      actions.push({
        actionType: "MAKE_OFFER",
        priority: "HIGH",
        title: "Consider making an offer",
        description: `${firstName} is shortlisted for ${app.jobTitle} at ${app.company}.`,
        jobProfileId,
        jobTitle: app.jobTitle,
        companyName: app.company,
        ctaLabel: "Make Offer",
        ctaAction: "OPEN_APPLICATION",
      });
    }
  });

  const requiredSkills = new Set();
  apps.forEach((app) => {
    const job = findJob(DB, app.jobId);
    (job?.skills ?? []).forEach((s) => {
      if (!(profile.skills ?? []).includes(s)) requiredSkills.add(s);
    });
  });
  if (requiredSkills.size > 0) {
    actions.push({
      actionType: "REQUEST_MISSING_SKILLS",
      priority: "MEDIUM",
      title: `Profile gap: ${[...requiredSkills].slice(0, 2).join(", ")}`,
      description: `${requiredSkills.size} required skill(s) across active applications are missing from ${firstName}'s profile.`,
      jobProfileId: null,
      jobTitle: null,
      companyName: null,
      ctaLabel: "Generate Skills",
      ctaAction: "TRIGGER_SKILL_GENERATION",
    });
  }

  if ((profile.skills ?? []).length < 5 || !(profile.experience ?? []).length) {
    actions.push({
      actionType: "COMPLETE_CANDIDATE_PROFILE",
      priority: "LOW",
      title: "Profile incomplete",
      description: `${firstName}'s profile is missing key details, limiting AI matching accuracy.`,
      jobProfileId: null,
      jobTitle: null,
      companyName: null,
      ctaLabel: "View Profile",
      ctaAction: "OPEN_PROFILE",
    });
  }

  if (actions.length === 0) {
    actions.push({
      actionType: "UPDATE_MATCH_SCORE",
      priority: "LOW",
      title: "Refresh match score",
      description:
        "No active application signals found. Recalculate scores once new applications are received.",
      jobProfileId: null,
      jobTitle: null,
      companyName: null,
      ctaLabel: "Recalculate Score",
      ctaAction: "TRIGGER_SCORING",
    });
  }

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return actions.sort((a, b) => order[a.priority] - order[b.priority]);
}

export function aiCandidateActionsRouter({ DB }) {
  const router = Router();

  function findSnapshot(candidateId, profile) {
    const key = profile?.candidateId ?? candidateId;
    return DB.candidateAiActions.find(
      (s) => s.candidateId === key || s.candidateUuid === candidateId,
    );
  }

  function toResponse(snapshot, candidateId) {
    return {
      candidate_id:
        snapshot?.candidateUuid ?? snapshot?.candidateId ?? candidateId,
      actions: (snapshot?.actions ?? []).map((a) => ({
        action_type: a.actionType,
        priority: a.priority,
        title: a.title,
        description: a.description,
        job_profile_id: a.jobProfileId ?? null,
        job_title: a.jobTitle ?? null,
        company_name: a.companyName ?? null,
        cta_label: a.ctaLabel,
        cta_action: a.ctaAction,
      })),
      generated_at: snapshot?.generatedAt ?? null,
      saved_at: snapshot?.savedAt ?? null,
    };
  }

  // GET /:candidateId/ai-actions
  router.get("/:candidateId/ai-actions", (req, res) => {
    if (!requireRecruiterRole(req, res)) return;
    const { candidateId } = req.params;
    const profile = findCandidateProfile(DB, candidateId);
    if (!profile) return notFound(res, `Candidate ${candidateId} not found.`);
    return res
      .status(200)
      .json(toResponse(findSnapshot(candidateId, profile), candidateId));
  });

  // POST /:candidateId/ai-actions
  router.post("/:candidateId/ai-actions", (req, res) => {
    if (!requireRecruiterRole(req, res)) return;
    const { candidateId } = req.params;
    const profile = findCandidateProfile(DB, candidateId);
    if (!profile) return notFound(res, `Candidate ${candidateId} not found.`);

    const { job_profile_id } = req.body ?? {};
    const generated = generateActionsForCandidate(DB, profile, job_profile_id);
    const now = new Date().toISOString();

    let snapshot = findSnapshot(candidateId, profile);
    if (snapshot) {
      snapshot.actions = generated;
      snapshot.generatedAt = now;
      snapshot.savedAt = now;
    } else {
      snapshot = {
        candidateId: profile.candidateId,
        candidateUuid: profile.candidateUuid,
        actions: generated,
        generatedAt: now,
        savedAt: now,
      };
      DB.candidateAiActions.push(snapshot);
    }

    return res.status(200).json(toResponse(snapshot, candidateId));
  });

  return router;
}
