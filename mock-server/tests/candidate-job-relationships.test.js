import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  candidateApplicationsRouter,
  candidateAiActionsRouter,
  candidateLandingRouter,
  candidateRecommendedPositionsRouter,
  candidateSavedJobsRouter,
  candidateServiceV2Router,
  candidateSelfDashboardRouter,
} from "../routes/candidates.js";

const dataDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = (name) => JSON.parse(readFileSync(join(dataDirectory, `${name}.json`), "utf8"));
const DB = {
  jobs: load("jobs"),
  companies: load("companies"),
  industries: load("industries"),
  candidateProfiles: structuredClone(load("candidate-profiles")),
  users: load("users"),
  applications: load("applications"),
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.currentUser = { userId: "USR100001", roles: ["JOB_SEEKER"] };
  next();
});
app.use("/candidates", candidateLandingRouter({ DB }));
app.use("/candidates", candidateSelfDashboardRouter({ DB }));
app.use("/candidates", candidateRecommendedPositionsRouter({ DB }));
app.use("/candidates", candidateSavedJobsRouter({ DB }));
app.use("/candidates", candidateAiActionsRouter({ DB }));
app.use("/candidates", candidateApplicationsRouter({ DB }));
app.use("/v1/candidates", candidateServiceV2Router({ DB }));

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

test("seeded saved jobs resolve to canonical job profiles", async () => {
  const { response, body } = await request("/candidates/saved-jobs");
  assert.equal(response.status, 200);
  assert.equal(body.data.total, 2);
  const jobIds = new Set(DB.jobs.map(({ jobProfileId }) => jobProfileId));
  const postedJobIds = new Set(DB.jobs
    .filter(({ status }) => status === "POSTED")
    .map(({ jobProfileId }) => jobProfileId));
  assert.ok(body.data.jobs.every((job) => jobIds.has(job.jobProfileId)));
  assert.ok(body.data.jobs.every((job) => postedJobIds.has(job.jobProfileId)));
  assert.ok(body.data.jobs.every((job) => job.title && job.company && job.industry));
});

test("candidate profile targeted industries match the industries endpoint seed", () => {
  const industryNames = new Set(DB.industries.map(({ industryName }) => industryName));
  const targetedIndustries = DB.candidateProfiles.flatMap(
    (profile) => profile.desiredJob?.industries ?? [],
  );

  assert.ok(targetedIndustries.length > 0);
  assert.ok(targetedIndustries.every((industryName) => industryNames.has(industryName)));
});

test("saving and removing a job uses jobProfileId", async () => {
  const jobProfileId = DB.jobs[1].jobProfileId;
  const saved = await request("/candidates/saved-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobProfileId }),
  });
  assert.equal(saved.response.status, 200);

  const afterSave = await request("/candidates/saved-jobs");
  assert.ok(afterSave.body.data.jobs.some((job) => job.jobProfileId === jobProfileId));

  const removed = await request(`/candidates/saved-jobs/${jobProfileId}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  const afterRemove = await request("/candidates/saved-jobs");
  assert.ok(!afterRemove.body.data.jobs.some((job) => job.jobProfileId === jobProfileId));
});

test("recommendations and AI actions use canonical posted jobs", async () => {
  const recommendations = await request("/candidates/recommended-positions");
  assert.equal(recommendations.response.status, 200);
  assert.equal(recommendations.body.data.jobs.length, 6);
  assert.ok(recommendations.body.data.jobs.every(({ status }) => status === "POSTED"));

  const actions = await request("/candidates/ai-actions/");
  assert.equal(actions.response.status, 200);
  const jobIds = actions.body.data.actions
    .flatMap((action) => action.payload?.jobIds ?? []);
  assert.ok(jobIds.every((jobId) => DB.jobs.some((job) => job.jobProfileId === jobId)));
});

test("applying creates one canonical dashboard-visible application", async () => {
  const job = DB.jobs.find(({ status, jobProfileId }) =>
    status === "POSTED" && !DB.applications.some((application) =>
      application.userId === "USR100001" && application.jobProfileId === jobProfileId));
  assert.ok(job);

  const created = await request("/candidates/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobProfileId: job.jobProfileId, sourceChannel: "job-details" }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.jobProfileId, job.jobProfileId);

  const dashboard = await request("/candidates/dashboard");
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.data.applications.some((application) => application.job.id === job.jobProfileId));

  const duplicate = await request("/candidates/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobProfileId: job.jobProfileId }),
  });
  assert.equal(duplicate.response.status, 409);
});

test("applying rejects jobs that are not posted", async () => {
  const draft = DB.jobs.find(({ status }) => status === "DRAFT");
  const result = await request("/candidates/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobProfileId: draft.jobProfileId }),
  });
  assert.equal(result.response.status, 422);
});

test("every seeded application references an existing canonical job profile", () => {
  const jobIds = new Set(DB.jobs.map(({ jobProfileId }) => jobProfileId));
  assert.ok(DB.applications.length >= 100);
  assert.ok(DB.applications.every((application) =>
    application.jobId === application.jobProfileId && jobIds.has(application.jobProfileId)));
});

test("candidate service v2 exposes candidate-scoped CV, profile, saved and recommendation contracts", async () => {
  const candidateId = DB.candidateProfiles[0].candidateId;
  const cv = await request(`/v1/candidates/cv-build/${candidateId}`);
  assert.equal(cv.response.status, 200);
  assert.equal(cv.body.candidate_id, candidateId);
  assert.ok(cv.body.personal_details.first_name);
  assert.ok(Array.isArray(cv.body.education));

  const profile = await request(`/v1/candidates/profile/${candidateId}`);
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.candidate_id, candidateId);
  assert.equal(profile.body.desired_job.employment_type, "FULL_TIME");

  const dashboard = await request(`/v1/candidates/dashboard`);
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.candidate_id, candidateId);
  assert.ok(Array.isArray(dashboard.body.applications));
  assert.ok(dashboard.body.pagination.current_page >= 1);

  const recommendations = await request(`/v1/candidates/${candidateId}/recommended-positions`);
  assert.equal(recommendations.response.status, 200);
  assert.ok(Array.isArray(recommendations.body.recommended_positions));
  assert.ok(recommendations.body.pagination.total_items >= 1);
});