/**
 * MANDATE (JOB) SERVICE ROUTES  (Mandate_Service_v2.yaml)
 * Mounted at /api/v1/job-service — kept separate from the candidate-facing
 * /jobs and /candidates routers to avoid path collisions with those contracts.
 *
 * GET    /dashboard/summary                 → recruiter dashboard snapshot counts
 * GET    /jobs                              → paginated job profile list (dashboard)
 * POST   /jobs                              → create a new job post (DRAFT)
 * GET    /jobs/:jobProfileId                → full job profile detail
 * PUT    /jobs/:jobProfileId                → update a job post (optimistic lock via versionNo)
 * DELETE /jobs/:jobProfileId                → cancel / delete a job post
 * GET    /industries                        → list active industries
 * GET    /companies                         → paginated employer companies
 * GET    /candidates                        → paginated candidate rows
 */

import { Router } from "express";
import crypto from "node:crypto";

function badRequest(res, message) {
  return res.status(400).json({ code: "VALIDATION_ERROR", message });
}
function notFound(res, message) {
  return res.status(404).json({ code: "NOT_FOUND", message });
}

function toIndustryItem(DB, industryId) {
  const industry = DB.industries.find((i) => i.industryId === industryId);
  if (!industry) return null;
  return {
    industryId: industry.industryId,
    industryName: industry.name,
    normalizedKey: industry.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
  };
}

function toCompanyItem(DB, clientId) {
  const company = DB.companies.find((c) => c.clientId === clientId);
  if (!company) return null;
  return { ...company };
}

function toJobProfileSummary(DB, job) {
  return {
    jobProfileId: job.jobProfileId,
    jobReferenceNumber: job.jobReferenceNumber,
    client: toCompanyItem(DB, job.clientId),
    positionTitle: job.title,
    industry: toIndustryItem(DB, job.industryId),
    locationText: job.location ?? "",
    employmentType: job.employmentTypeCode ?? null,
    jobDescriptionSnippet: (job.description ?? "").slice(0, 300),
    fillByDate: job.fillByDate,
    status: job.statusCode ?? "DRAFT",
    publishedAt:
      job.statusCode && job.statusCode !== "DRAFT" && job.postedDate
        ? new Date(job.postedDate).toISOString()
        : null,
    createdAt: job.postedDate ? new Date(job.postedDate).toISOString() : new Date().toISOString(),
    updatedAt: job.postedDate ? new Date(job.postedDate).toISOString() : new Date().toISOString(),
  };
}

function toJobProfile(DB, job) {
  return {
    ...toJobProfileSummary(DB, job),
    workType: job.workTypeCode ?? null,
    employmentType: job.employmentTypeCode ?? null,
    experienceLevel: job.experienceLevel ?? null,
    priority: job.priority ?? "NORMAL",
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    currencyCode: job.currencyCode ?? "ZAR",
    clientRate: job.clientRate ?? null,
    jobDescription: job.description ?? null,
    requirements: job.requirements ?? [],
    responsibilities: job.responsibilities ?? [],
    benefitsText: job.benefitsText ?? [],
    closedAt: job.closedAt ?? null,
    createdByUserId: job.createdByUserId ?? null,
    versionNo: job.versionNo ?? 1,
  };
}

function toJobSkillSummary(DB, skillName) {
  const skill = DB.skills.find((s) => s.name === skillName);
  return {
    skillId: skill?.aiSkillId ?? null,
    originalText: skillName,
    sourceType: "RECRUITER_ENTERED",
  };
}

function toJobProfileDetail(DB, job) {
  const today = new Date();
  const fillBy = job.fillByDate ? new Date(job.fillByDate) : null;
  const isOpenEnded = !["FILLED", "CLOSED", "CANCELLED"].includes(job.statusCode);
  const daysLeftToFill =
    isOpenEnded && fillBy
      ? Math.round((fillBy.getTime() - today.getTime()) / 86400000)
      : null;

  return {
    ...toJobProfile(DB, job),
    skills: (job.skills ?? []).map((name) => toJobSkillSummary(DB, name)),
    viewCount: job.viewCount ?? 0,
    applicantCount: job.applicationCount ?? 0,
    daysLeftToFill,
  };
}

const DATE_POSTED_WINDOW_DAYS = {
  TODAY: 1,
  LAST_3_DAYS: 3,
  LAST_7_DAYS: 7,
  LAST_14_DAYS: 14,
  LAST_30_DAYS: 30,
};

export function mandateServiceJobsRouter({ DB, saveDataset }) {
  const router = Router();

  // GET /dashboard/summary
  router.get("/dashboard/summary", (req, res) => {
    const recruiterId = req.currentUser?.recruiterId ?? "r001";
    const myJobIds = new Set(
      DB.jobs.filter((j) => j.recruiterId === recruiterId).map((j) => j.jobId),
    );
    const myApps = DB.applications.filter((a) => myJobIds.has(a.jobId));

    return res.status(200).json({
      cvsDue: myApps.filter((a) => a.currentStage === "Screening").length,
      interviewsToSchedule: myApps.filter((a) => a.currentStage === "Shortlisted").length,
      offerLettersAcceptanceDeadlines: myApps.filter((a) => a.currentStage === "Offer").length,
    });
  });

  // GET /jobs
  router.get("/jobs", (req, res) => {
    const {
      search, locationText, datePosted, jobType, clientId, status,
      page = 0, size = 20,
    } = req.query;
    let industryIds = req.query.industryId;
    if (industryIds && !Array.isArray(industryIds)) industryIds = [industryIds];

    let results = [...DB.jobs];

    if (search) {
      const q = search.toLowerCase();
      results = results.filter((j) => j.title?.toLowerCase().includes(q));
    }
    if (industryIds?.length) {
      results = results.filter((j) => industryIds.includes(j.industryId));
    }
    if (locationText) {
      const q = locationText.toLowerCase();
      results = results.filter((j) => j.location?.toLowerCase().includes(q));
    }
    if (datePosted) {
      const windowDays = DATE_POSTED_WINDOW_DAYS[datePosted];
      if (windowDays) {
        const cutoff = Date.now() - windowDays * 86400000;
        results = results.filter(
          (j) => j.postedDate && new Date(j.postedDate).getTime() >= cutoff,
        );
      }
    }
    if (jobType) {
      results = results.filter((j) => j.employmentTypeCode === jobType);
    }
    if (clientId) {
      results = results.filter((j) => j.clientId === clientId);
    }
    if (status) {
      results = results.filter((j) => j.statusCode === status);
    }

    const total = results.length;
    const pageNum = parseInt(page, 10) || 0;
    const pageSize = Math.min(parseInt(size, 10) || 20, 100);
    const pageItems = results.slice(pageNum * pageSize, pageNum * pageSize + pageSize);

    return res.status(200).json({
      data: pageItems.map((j) => toJobProfileSummary(DB, j)),
      total, page: pageNum, size: pageSize,
    });
  });

  // POST /jobs
  router.post("/jobs", (req, res) => {
    const body = req.body ?? {};
    if (!body.companyName || !body.positionTitle || !body.fillByDate)
      return badRequest(res, "companyName, positionTitle and fillByDate are required.");

    let company = DB.companies.find(
      (c) => c.clientName.toLowerCase() === body.companyName.toLowerCase(),
    );
    if (!company) {
      company = {
        clientId: `cl${100 + DB.companies.length}`,
        clientName: body.companyName,
        contactName: body.contactName ?? "",
        contactEmail: body.contactEmail ?? "",
        contactPhoneNumber: body.contactPhoneNumber ?? "",
      };
      DB.companies.push(company);
    }

    const seq = DB.jobs.length + 1;
    const jobProfileId = crypto.randomUUID();
    const newJob = {
      jobId: `j${String(seq).padStart(3, "0")}`,
      jobProfileId,
      jobReferenceNumber: body.jobReferenceNumber ?? `JOB-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`,
      title: body.positionTitle,
      company: company.clientName,
      clientId: company.clientId,
      location: body.locationText ?? "",
      industry: null,
      industryId: body.industryId ?? null,
      employmentType: null,
      employmentTypeCode: body.employmentType ?? null,
      workType: null,
      workTypeCode: body.workType ?? null,
      salaryMin: body.salaryMin ?? null,
      salaryMax: body.salaryMax ?? null,
      salaryRange: null,
      currencyCode: body.currencyCode ?? "ZAR",
      clientRate: body.clientRate ?? null,
      experienceLevel: body.experienceLevel ?? null,
      priority: body.priority ?? "NORMAL",
      description: body.jobDescription ?? "",
      requirements: body.requirements ?? [],
      responsibilities: body.responsibilities ?? [],
      benefitsText: body.benefitsText ?? [],
      skills: (body.skills ?? []).map((s) => s.originalText).filter(Boolean),
      fillByDate: body.fillByDate,
      postedDate: null,
      status: "Draft",
      statusCode: "DRAFT",
      applicationCount: 0,
      viewCount: 0,
      recruiterId: req.currentUser?.recruiterId ?? null,
      createdByUserId: req.currentUser?.userId ?? null,
      versionNo: 1,
      closedAt: null,
    };
    DB.jobs.push(newJob);

    return res.status(201).json(toJobProfile(DB, newJob));
  });

  // GET /jobs/:jobProfileId
  router.get("/jobs/:jobProfileId", (req, res) => {
    const job = DB.jobs.find((j) => j.jobProfileId === req.params.jobProfileId);
    if (!job) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);
    return res.status(200).json(toJobProfileDetail(DB, job));
  });

  // PUT /jobs/:jobProfileId
  router.put("/jobs/:jobProfileId", (req, res) => {
    const job = DB.jobs.find((j) => j.jobProfileId === req.params.jobProfileId);
    if (!job) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);

    const body = req.body ?? {};
    if (!body.positionTitle || !body.fillByDate || body.versionNo === undefined)
      return badRequest(res, "positionTitle, fillByDate and versionNo are required.");
    if (body.versionNo !== job.versionNo)
      return res.status(409).json({ code: "VERSION_CONFLICT", message: "versionNo does not match the current job profile version." });

    if (body.companyName) {
      let company = DB.companies.find(
        (c) => c.clientName.toLowerCase() === body.companyName.toLowerCase(),
      );
      if (!company) {
        company = {
          clientId: `cl${100 + DB.companies.length}`,
          clientName: body.companyName,
          contactName: body.contactName ?? "",
          contactEmail: body.contactEmail ?? "",
          contactPhoneNumber: body.contactPhoneNumber ?? "",
        };
        DB.companies.push(company);
      }
      job.company = company.clientName;
      job.clientId = company.clientId;
    }

    if (body.jobReferenceNumber !== undefined) job.jobReferenceNumber = body.jobReferenceNumber;
    job.title = body.positionTitle;
    job.fillByDate = body.fillByDate;
    if (body.locationText !== undefined) job.location = body.locationText;
    if (body.workType !== undefined) job.workTypeCode = body.workType;
    if (body.employmentType !== undefined) job.employmentTypeCode = body.employmentType;
    if (body.experienceLevel !== undefined) job.experienceLevel = body.experienceLevel;
    if (body.priority !== undefined) job.priority = body.priority;
    if (body.salaryMin !== undefined) job.salaryMin = body.salaryMin;
    if (body.salaryMax !== undefined) job.salaryMax = body.salaryMax;
    if (body.currencyCode !== undefined) job.currencyCode = body.currencyCode;
    if (body.clientRate !== undefined) job.clientRate = body.clientRate;
    if (body.jobDescription !== undefined) job.description = body.jobDescription;
    if (body.requirements !== undefined) job.requirements = body.requirements;
    if (body.responsibilities !== undefined) job.responsibilities = body.responsibilities;
    if (body.benefitsText !== undefined) job.benefitsText = body.benefitsText;
    if (body.industryId !== undefined) job.industryId = body.industryId;
    if (body.skills !== undefined) job.skills = body.skills.map((s) => s.originalText).filter(Boolean);
    job.versionNo = (job.versionNo ?? 1) + 1;

    return res.status(200).json(toJobProfile(DB, job));
  });

  // DELETE /jobs/:jobProfileId
  router.delete("/jobs/:jobProfileId", (req, res) => {
    const idx = DB.jobs.findIndex((j) => j.jobProfileId === req.params.jobProfileId);
    if (idx === -1) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);

    const job = DB.jobs[idx];
    const hasApplications = DB.applications.some((a) => a.jobId === job.jobId);
    if (!hasApplications && job.statusCode === "DRAFT") {
      DB.jobs.splice(idx, 1);
    } else {
      job.statusCode = "CANCELLED";
      job.status = "Closed";
      job.closedAt = new Date().toISOString();
    }

    return res.status(204).send();
  });

  return router;
}

export function mandateServiceIndustriesRouter({ DB }) {
  const router = Router();

  // GET /industries
  router.get("/", (req, res) => {
    const { search } = req.query;
    let results = [...DB.industries];
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((i) => i.name.toLowerCase().includes(q));
    }
    results.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json(
      results.map((i) => ({
        industryId: i.industryId,
        industryName: i.name,
        normalizedKey: i.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      })),
    );
  });

  return router;
}

export function mandateServiceCompaniesRouter({ DB }) {
  const router = Router();

  // GET /companies
  router.get("/", (req, res) => {
    const { search, page = 0, size = 20 } = req.query;
    let results = [...DB.companies];
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((c) => c.clientName.toLowerCase().includes(q));
    }

    const total = results.length;
    const pageNum = parseInt(page, 10) || 0;
    const pageSize = Math.min(parseInt(size, 10) || 20, 100);
    const pageItems = results.slice(pageNum * pageSize, pageNum * pageSize + pageSize);

    return res.status(200).json({ data: pageItems, total, page: pageNum, size: pageSize });
  });

  return router;
}

export function mandateServiceCandidatesRouter({ DB }) {
  const router = Router();

  // GET /candidates
  router.get("/", (req, res) => {
    const { companyName, locationText, search, jobProfileId, status, page = 0, size = 20 } = req.query;

    let rows;
    if (jobProfileId) {
      const job = DB.jobs.find((j) => j.jobProfileId === jobProfileId);
      const apps = job ? DB.applications.filter((a) => a.jobId === job.jobId) : [];
      rows = apps.map((a) => {
        const profile = DB.candidateProfiles.find((p) => p.candidateId === a.candidateId);
        const [firstName, ...rest] = (a.candidateName ?? "").split(" ");
        return {
          applicationId: a.applicationId,
          candidateId: profile?.candidateUuid ?? a.candidateId,
          firstName: firstName ?? "",
          lastName: rest.join(" "),
          fullName: a.candidateName ?? "",
          title: a.jobTitle ?? "",
          companyName: a.company ?? job?.company ?? "",
          locationText: profile?.personalDetails?.location ?? "",
          matchPercentage: a.matchScore ?? null,
          status: a.currentStage === "Inbound" ? "APPLIED" : a.currentStage?.toUpperCase() ?? null,
          jobProfileId: job?.jobProfileId ?? null,
        };
      });
    } else {
      rows = DB.candidates.map((c) => ({
        applicationId: null,
        candidateId: c.candidateUuid ?? c.candidateId,
        firstName: (c.fullName ?? "").split(" ")[0] ?? "",
        lastName: (c.fullName ?? "").split(" ").slice(1).join(" "),
        fullName: c.fullName ?? "",
        title: c.currentTitle ?? "",
        companyName: c.currentCompany ?? "",
        locationText: c.location ?? "",
        matchPercentage: null,
        status: null,
        jobProfileId: null,
      }));
    }

    if (companyName) {
      const q = companyName.toLowerCase();
      rows = rows.filter((r) => r.companyName?.toLowerCase().includes(q));
    }
    if (locationText) {
      const q = locationText.toLowerCase();
      rows = rows.filter((r) => r.locationText?.toLowerCase().includes(q));
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.fullName.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
      );
    }
    if (status) {
      rows = rows.filter((r) => r.status === status);
    }

    const total = rows.length;
    const pageNum = parseInt(page, 10) || 0;
    const pageSize = Math.min(parseInt(size, 10) || 20, 100);
    const pageItems = rows.slice(pageNum * pageSize, pageNum * pageSize + pageSize);

    return res.status(200).json({ data: pageItems, total, page: pageNum, size: pageSize });
  });

  return router;
}
