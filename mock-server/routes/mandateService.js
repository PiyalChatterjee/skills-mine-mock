/**
 * MANDATE (JOB) SERVICE ROUTES  (Mandate_Service_v3.yaml)
 * Mounted at the service-relative paths declared by Mandate_Service_v3.yaml.
 *
 * GET    /jobs                              → paginated job profile list (dashboard)
 * POST   /jobs                              → create a new job post (DRAFT)
 * GET    /jobs/:jobProfileId                → full job profile detail
 * PATCH  /jobs/:jobProfileId                → sparse update a job post
 * PATCH  /jobs/:jobProfileId/view           → increment job view count
 * DELETE /jobs/:jobProfileId                → cancel / delete a job post
 * GET    /industries                        → list active industries
 * GET    /locations                         → list distinct job locations
 * GET    /companies                         → paginated employer companies
 * GET    /candidates                        → paginated candidate rows
 */

import { Router } from "express";
import crypto from "node:crypto";

function badRequest(res, message) {
  return apiError(res, 400, "VALIDATION_ERROR", message);
}
function notFound(res, message) {
  return apiError(res, 404, "NOT_FOUND", message);
}
function apiError(res, status, code, message) {
  return res.status(status).json({
    message,
    code,
    requestId: res.req.headers["x-request-id"] ?? null,
    timestamp: new Date().toISOString(),
  });
}

function toIndustryItem(DB, industryId) {
  const industry = DB.industries.find((i) => i.industryId === industryId);
  return industry ? { ...industry } : null;
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
    positionTitle: job.positionTitle,
    industry: toIndustryItem(DB, job.industryId),
    locationText: job.locationText ?? "",
    employmentType: job.employmentType ?? null,
    jobDescriptionSnippet: (job.jobDescription ?? "").slice(0, 300),
    fillByDate: job.fillByDate,
    status: job.status,
    publishedAt: job.publishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toJobProfile(DB, job) {
  return {
    ...toJobProfileSummary(DB, job),
    workType: job.workType ?? null,
    employmentType: job.employmentType ?? null,
    experienceLevel: job.experienceLevel ?? null,
    priority: job.priority ?? "NORMAL",
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    currencyCode: job.currencyCode ?? "ZAR",
    clientRate: job.clientRate ?? null,
    jobDescription: job.jobDescription ?? null,
    requirements: job.requirements ?? [],
    responsibilities: job.responsibilities ?? [],
    benefitsText: job.benefitsText ?? [],
    closedAt: job.closedAt ?? null,
    createdByUserId: job.createdByUserId ?? null,
    versionNo: job.versionNo ?? 1,
  };
}

function toJobProfileDetail(DB, job) {
  const today = new Date();
  const fillBy = job.fillByDate ? new Date(job.fillByDate) : null;
  const isOpenEnded = !["FILLED", "CLOSED", "CANCELLED"].includes(job.status);
  const daysLeftToFill =
    isOpenEnded && fillBy
      ? Math.round((fillBy.getTime() - today.getTime()) / 86400000)
      : null;

  return {
    ...toJobProfile(DB, job),
    skills: job.skills ?? [],
    viewCount: job.viewCount ?? 0,
    applicantCount: job.applicantCount ?? 0,
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

const JOB_TYPES = new Set([
  "FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERNSHIP", "FREELANCE",
]);
const JOB_STATUSES = new Set(["DRAFT", "POSTED", "PAUSED", "FILLED", "CANCELLED", "CLOSED"]);
const WORK_TYPES = new Set(["REMOTE", "HYBRID", "ONSITE"]);
const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const SKILL_SOURCE_TYPES = new Set(["AI_GENERATED", "RECRUITER_ENTERED"]);
const CANDIDATE_STATUSES = new Set(["SUBMITTED", "ACTIVE", "ON_HOLD", "CLOSED", "CANCELLED", "REJECTED", "APPLIED"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePageParams(res, page, size) {
  const pageNum = Number(page);
  const pageSize = Number(size);
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    badRequest(res, "page must be an integer greater than or equal to 0.");
    return null;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    badRequest(res, "size must be an integer between 1 and 100.");
    return null;
  }
  return { pageNum, pageSize };
}

function queryArray(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateJobBody(DB, body, { update = false, patch = false } = {}) {
  const requiredFields = patch
    ? []
    : update
      ? ["positionTitle", "fillByDate"]
      : ["companyName", "contactName", "contactEmail", "contactPhoneNumber", "positionTitle", "fillByDate", "clientRate"];
  const missing = requiredFields
    .filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) return `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`;
  if (body.industryId !== undefined && body.industryId !== null && !DB.industries.some(({ industryId }) => industryId === body.industryId)) return "industryId must reference an existing industry.";
  if (body.workType !== undefined && body.workType !== null && !WORK_TYPES.has(body.workType)) return `workType must be one of: ${[...WORK_TYPES].join(", ")}.`;
  if (body.employmentType !== undefined && body.employmentType !== null && !JOB_TYPES.has(body.employmentType)) return `employmentType must be one of: ${[...JOB_TYPES].join(", ")}.`;
  if (body.priority !== undefined && !PRIORITIES.has(body.priority)) return `priority must be one of: ${[...PRIORITIES].join(", ")}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fillByDate) || Number.isNaN(Date.parse(body.fillByDate))) return "fillByDate must be a valid date in YYYY-MM-DD format.";
  for (const field of ["requirements", "responsibilities", "benefitsText"]) {
    if (body[field] !== undefined && (!Array.isArray(body[field]) || body[field].some((value) => typeof value !== "string"))) return `${field} must be an array of strings.`;
  }
  if (body.skills !== undefined && (!Array.isArray(body.skills) || body.skills.some((skill) => !skill || typeof skill.originalText !== "string" || !SKILL_SOURCE_TYPES.has(skill.sourceType)))) return "skills must contain originalText and a valid sourceType.";
  if (body.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) return "contactEmail must be a valid email address.";
  if (body.clientRate != null && (!Number.isFinite(body.clientRate) || body.clientRate < 0)) return "clientRate must be a non-negative number.";
  if (body.salaryMin != null && (!Number.isFinite(body.salaryMin) || body.salaryMin < 0)) return "salaryMin must be a non-negative number.";
  if (body.salaryMax != null && (!Number.isFinite(body.salaryMax) || body.salaryMax < 0)) return "salaryMax must be a non-negative number.";
  if (body.salaryMin != null && body.salaryMax != null && body.salaryMax < body.salaryMin) return "salaryMax must be greater than or equal to salaryMin.";
  return null;
}

export function mandateServiceJobsRouter({ DB, saveDataset }) {
  const router = Router();

  // GET /jobs
  router.get("/jobs", (req, res) => {
    const { search, datePosted, clientId, status, page = 0, size = 20 } = req.query;
    const pagination = parsePageParams(res, page, size);
    if (!pagination) return;
    if (datePosted && !Object.hasOwn(DATE_POSTED_WINDOW_DAYS, datePosted)) {
      return badRequest(res, `datePosted must be one of: ${Object.keys(DATE_POSTED_WINDOW_DAYS).join(", ")}.`);
    }
    if (status && !JOB_STATUSES.has(status)) {
      return badRequest(res, `status must be one of: ${[...JOB_STATUSES].join(", ")}.`);
    }

    const industryIds = queryArray(req.query.industryId);
    const locations = queryArray(req.query.locationText).map((value) => value.toLowerCase());
    const jobTypes = queryArray(req.query.jobType);

    let results = [...DB.jobs];

    if (search) {
      const q = search.toLowerCase();
      results = results.filter((j) => j.positionTitle.toLowerCase().includes(q));
    }
    if (industryIds?.length) {
      results = results.filter((j) => industryIds.includes(j.industryId));
    }
    if (locations.length) {
      results = results.filter((j) => locations.some((location) => j.locationText.toLowerCase().includes(location)));
    }
    if (datePosted) {
      const windowDays = DATE_POSTED_WINDOW_DAYS[datePosted];
      if (windowDays) {
        const cutoff = Date.now() - windowDays * 86400000;
        results = results.filter(
          (j) => j.publishedAt && new Date(j.publishedAt).getTime() >= cutoff,
        );
      }
    }
    if (jobTypes.length) {
      const invalidJobType = jobTypes.find((jobType) => !JOB_TYPES.has(jobType));
      if (invalidJobType) return badRequest(res, `jobType must be one of: ${[...JOB_TYPES].join(", ")}.`);
      results = results.filter((j) => jobTypes.includes(j.employmentType));
    }
    if (clientId) {
      results = results.filter((j) => j.clientId === clientId);
    }
    if (status) {
      results = results.filter((j) => j.status === status);
    }

    const total = results.length;
    const { pageNum, pageSize } = pagination;
    const pageItems = results.slice(pageNum * pageSize, pageNum * pageSize + pageSize);

    return res.status(200).json({
      data: pageItems.map((j) => toJobProfileSummary(DB, j)),
      total, page: pageNum, size: pageSize,
    });
  });

  // POST /jobs
  router.post("/jobs", (req, res) => {
    const body = req.body ?? {};
    const validationError = validateJobBody(DB, body);
    if (validationError) return badRequest(res, validationError);
    if (body.status !== undefined && body.status !== "DRAFT") return badRequest(res, "New jobs must be created with DRAFT status.");
    if (body.jobReferenceNumber && DB.jobs.some(({ jobReferenceNumber }) => jobReferenceNumber === body.jobReferenceNumber)) {
      return apiError(res, 409, "DUPLICATE_JOB_REFERENCE", "jobReferenceNumber must be unique.");
    }

    let company = DB.companies.find(
      (c) => c.clientName.toLowerCase() === body.companyName.toLowerCase(),
    );
    if (!company) {
      company = {
        clientId: crypto.randomUUID(),
        clientName: body.companyName,
        contactName: body.contactName ?? "",
        contactEmail: body.contactEmail ?? "",
        contactPhoneNumber: body.contactPhoneNumber ?? "",
      };
      DB.companies.push(company);
    }

    const seq = DB.jobs.length + 1;
    const jobProfileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newJob = {
      jobProfileId,
      jobReferenceNumber: body.jobReferenceNumber ?? `JOB-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`,
      clientId: company.clientId,
      positionTitle: body.positionTitle,
      locationText: body.locationText ?? "",
      industryId: body.industryId ?? null,
      employmentType: body.employmentType ?? null,
      workType: body.workType ?? null,
      salaryMin: body.salaryMin ?? null,
      salaryMax: body.salaryMax ?? null,
      salaryRange: null,
      currencyCode: body.currencyCode ?? "ZAR",
      clientRate: body.clientRate ?? null,
      experienceLevel: body.experienceLevel ?? null,
      priority: body.priority ?? "NORMAL",
      jobDescription: body.jobDescription ?? null,
      requirements: body.requirements ?? [],
      responsibilities: body.responsibilities ?? [],
      benefitsText: body.benefitsText ?? [],
      skills: body.skills ?? [],
      fillByDate: body.fillByDate,
      status: "DRAFT",
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      applicantCount: 0,
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
    if (!UUID_PATTERN.test(req.params.jobProfileId)) return badRequest(res, "jobProfileId must be a UUID.");
    const job = DB.jobs.find((j) => j.jobProfileId === req.params.jobProfileId);
    if (!job) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);
    return res.status(200).json(toJobProfileDetail(DB, job));
  });

  // PATCH /jobs/:jobProfileId
  router.patch("/jobs/:jobProfileId", (req, res) => {
    if (!UUID_PATTERN.test(req.params.jobProfileId)) return badRequest(res, "jobProfileId must be a UUID.");
    const job = DB.jobs.find((j) => j.jobProfileId === req.params.jobProfileId);
    if (!job) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);

    const body = req.body ?? {};
    const validationError = validateJobBody(DB, { ...job, ...body }, { patch: true });
    if (validationError) return badRequest(res, validationError);
    if (body.status !== undefined && !JOB_STATUSES.has(body.status)) return badRequest(res, `status must be one of: ${[...JOB_STATUSES].join(", ")}.`);
    if (body.jobReferenceNumber !== undefined && body.jobReferenceNumber !== job.jobReferenceNumber && DB.jobs.some(({ jobReferenceNumber }) => jobReferenceNumber === body.jobReferenceNumber)) {
      return apiError(res, 409, "DUPLICATE_JOB_REFERENCE", "jobReferenceNumber must be unique.");
    }

    if (body.companyName) {
      let company = DB.companies.find(
        (c) => c.clientName.toLowerCase() === body.companyName.toLowerCase(),
      );
      if (!company) {
        company = {
          clientId: crypto.randomUUID(),
          clientName: body.companyName,
          contactName: body.contactName ?? "",
          contactEmail: body.contactEmail ?? "",
          contactPhoneNumber: body.contactPhoneNumber ?? "",
        };
        DB.companies.push(company);
      }
      job.clientId = company.clientId;
    }

    const company = DB.companies.find(({ clientId }) => clientId === job.clientId);
    if (company) {
      for (const field of ["contactName", "contactEmail", "contactPhoneNumber"]) {
        if (Object.hasOwn(body, field)) company[field] = body[field];
      }
      if (Object.hasOwn(body, "clientRate")) company.clientRate = body.clientRate;
    }

    const editableFields = ["jobReferenceNumber", "positionTitle", "fillByDate", "locationText", "workType", "employmentType", "experienceLevel", "priority", "salaryMin", "salaryMax", "currencyCode", "clientRate", "jobDescription", "requirements", "responsibilities", "benefitsText", "industryId", "skills", "status"];
    for (const field of editableFields) {
      if (Object.hasOwn(body, field)) job[field] = body[field];
    }
    job.versionNo = (job.versionNo ?? 1) + 1;
    job.updatedAt = new Date().toISOString();

    return res.status(200).json({ ...toJobProfile(DB, job), skills: job.skills ?? [] });
  });

  // PATCH /jobs/:jobProfileId/view
  router.patch("/jobs/:jobProfileId/view", (req, res) => {
    if (!UUID_PATTERN.test(req.params.jobProfileId)) return badRequest(res, "jobProfileId must be a UUID.");
    const job = DB.jobs.find((candidate) => candidate.jobProfileId === req.params.jobProfileId);
    if (!job) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);
    job.viewCount = (job.viewCount ?? 0) + 1;
    saveDataset?.("jobs", DB.jobs);
    return res.status(200).json({ viewCount: job.viewCount });
  });

  // DELETE /jobs/:jobProfileId
  router.delete("/jobs/:jobProfileId", (req, res) => {
    if (!UUID_PATTERN.test(req.params.jobProfileId)) return badRequest(res, "jobProfileId must be a UUID.");
    const idx = DB.jobs.findIndex((j) => j.jobProfileId === req.params.jobProfileId);
    if (idx === -1) return notFound(res, `Job profile ${req.params.jobProfileId} not found.`);

    const job = DB.jobs[idx];
    const hasApplications = DB.candidates.some((candidate) => candidate.jobProfileId === job.jobProfileId);
    if (!hasApplications && job.status === "DRAFT") {
      DB.jobs.splice(idx, 1);
    } else {
      job.status = "CANCELLED";
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
      results = results.filter((i) => i.industryName.toLowerCase().includes(q));
    }
    results.sort((a, b) => a.industryName.localeCompare(b.industryName));
    return res.status(200).json(results);
  });

  return router;
}

export function mandateServiceLocationsRouter({ DB }) {
  const router = Router();

  router.get("/", (req, res) => {
    const search = String(req.query.search ?? "").toLowerCase();
    const locations = [...new Set([
      ...(DB.locations ?? []),
      ...DB.jobs.map(({ locationText }) => locationText),
    ].filter(Boolean))]
      .filter((location) => !search || location.toLowerCase().includes(search))
      .sort((left, right) => left.localeCompare(right));
    return res.status(200).json(locations);
  });

  return router;
}

export function mandateServiceCompaniesRouter({ DB }) {
  const router = Router();

  // GET /companies
  router.get("/", (req, res) => {
    const { search, page = 0, size = 20 } = req.query;
    const pagination = parsePageParams(res, page, size);
    if (!pagination) return;
    let results = [...DB.companies];
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((c) => c.clientName.toLowerCase().includes(q));
    }

    const total = results.length;
    const { pageNum, pageSize } = pagination;
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
    const pagination = parsePageParams(res, page, size);
    if (!pagination) return;
    if (status && !CANDIDATE_STATUSES.has(status)) {
      return badRequest(res, `status must be one of: ${[...CANDIDATE_STATUSES].join(", ")}.`);
    }
    if (jobProfileId && !UUID_PATTERN.test(jobProfileId)) return badRequest(res, "jobProfileId must be a UUID.");

    let rows = DB.candidates.map(({ clientId, ...candidate }) => candidate);
    if (jobProfileId) rows = rows.filter((candidate) => candidate.jobProfileId === jobProfileId);

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
    const { pageNum, pageSize } = pagination;
    const pageItems = rows.slice(pageNum * pageSize, pageNum * pageSize + pageSize);

    return res.status(200).json({ data: pageItems, total, page: pageNum, size: pageSize });
  });

  return router;
}
