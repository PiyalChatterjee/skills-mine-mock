import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  mandateServiceCandidatesRouter,
  mandateServiceCompaniesRouter,
  mandateServiceIndustriesRouter,
  mandateServiceJobsRouter,
} from "../routes/mandateService.js";

const dataDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = (name) => JSON.parse(readFileSync(join(dataDirectory, `${name}.json`), "utf8"));
const DB = {
  jobs: load("jobs"),
  industries: load("industries"),
  companies: load("companies"),
  candidates: load("candidates"),
  dashboardSummary: load("dashboard-summary"),
};

const app = express();
app.use(express.json());
app.use("/", mandateServiceJobsRouter({ DB }));
app.use("/industries", mandateServiceIndustriesRouter({ DB }));
app.use("/companies", mandateServiceCompaniesRouter({ DB }));
app.use("/candidates", mandateServiceCandidatesRouter({ DB }));

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
  const body = response.status === 204
    ? null
    : response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text();
  return { response, body };
}

test("seed volumes, enum coverage and relationships satisfy the migration requirements", () => {
  assert.ok(DB.industries.length >= 20);
  assert.ok(DB.companies.length >= 30);
  assert.ok(DB.jobs.length >= 100);
  assert.ok(DB.candidates.length >= 200);

  const industryIds = new Set(DB.industries.map(({ industryId }) => industryId));
  const companyIds = new Set(DB.companies.map(({ clientId }) => clientId));
  const jobIds = new Set(DB.jobs.map(({ jobProfileId }) => jobProfileId));
  assert.ok(DB.jobs.every((job) => industryIds.has(job.industryId) && companyIds.has(job.clientId)));
  assert.ok(DB.candidates.every((candidate) => jobIds.has(candidate.jobProfileId) && companyIds.has(candidate.clientId)));

  assert.deepEqual(new Set(DB.jobs.map(({ status }) => status)), new Set(["DRAFT", "POSTED", "PAUSED", "FILLED", "CANCELLED", "CLOSED"]));
  assert.deepEqual(new Set(DB.jobs.map(({ employmentType }) => employmentType)), new Set(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERNSHIP", "FREELANCE"]));
  assert.deepEqual(new Set(DB.candidates.map(({ status }) => status)), new Set(["SUBMITTED", "ACTIVE", "ON_HOLD", "CLOSED", "CANCELLED", "REJECTED", "APPLIED"]));
});

test("GET /dashboard/summary returns generated metrics", async () => {
  const { response, body } = await request("/dashboard/summary");
  assert.equal(response.status, 200);
  assert.deepEqual(body, DB.dashboardSummary);
});

test("GET /jobs supports paging and every declared filter", async () => {
  const sample = DB.jobs.find(({ status }) => status === "POSTED");
  const query = new URLSearchParams({
    search: sample.positionTitle.split(" ").at(-1),
    industryId: sample.industryId,
    locationText: sample.locationText.split(",")[0],
    jobType: sample.employmentType,
    clientId: sample.clientId,
    status: sample.status,
    page: "0",
    size: "5",
  });
  const { response, body } = await request(`/jobs?${query}`);
  assert.equal(response.status, 200);
  assert.equal(body.page, 0);
  assert.equal(body.size, 5);
  assert.ok(body.total >= 1);
  assert.ok(body.data.length <= 5);
  assert.ok(body.data.every((job) => job.client.clientId === sample.clientId && job.industry.industryId === sample.industryId));

  const recent = await request("/jobs?datePosted=LAST_30_DAYS&size=100");
  assert.equal(recent.response.status, 200);
  assert.ok(recent.body.data.every(({ publishedAt }) => publishedAt !== null));
});

test("list endpoints reject invalid enums and pagination", async () => {
  assert.equal((await request("/jobs?status=OPEN")).response.status, 400);
  assert.equal((await request("/jobs?datePosted=YESTERDAY")).response.status, 400);
  assert.equal((await request("/jobs?jobType=PERMANENT")).response.status, 400);
  assert.equal((await request("/companies?page=-1")).response.status, 400);
  assert.equal((await request("/candidates?size=101")).response.status, 400);
  assert.equal((await request("/candidates?status=INTERVIEW")).response.status, 400);
});

test("GET detail, industries, companies and candidates match v2 response shapes", async () => {
  const job = DB.jobs[0];
  const detail = await request(`/jobs/${job.jobProfileId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.jobProfileId, job.jobProfileId);
  assert.ok(Array.isArray(detail.body.skills));
  assert.equal(typeof detail.body.applicantCount, "number");

  const industries = await request("/industries?search=tech");
  assert.equal(industries.response.status, 200);
  assert.ok(Array.isArray(industries.body));
  assert.ok(industries.body.every(({ industryName }) => industryName.toLowerCase().includes("tech")));

  const companies = await request("/companies?page=1&size=10");
  assert.equal(companies.response.status, 200);
  assert.deepEqual(Object.keys(companies.body).sort(), ["data", "page", "size", "total"]);
  assert.equal(companies.body.data.length, 10);

  const candidate = DB.candidates[0];
  const candidates = await request(`/candidates?jobProfileId=${candidate.jobProfileId}&status=${candidate.status}`);
  assert.equal(candidates.response.status, 200);
  assert.ok(candidates.body.data.length >= 1);
  assert.ok(candidates.body.data.every((row) => row.jobProfileId === candidate.jobProfileId && !("clientId" in row)));
});

test("POST and PUT /jobs enforce request schema and optimistic locking", async () => {
  assert.equal((await request("/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).response.status, 400);

  const createPayload = {
    companyName: "Contract Test Labs",
    positionTitle: "Integration Engineer",
    fillByDate: "2027-12-01",
    workType: "HYBRID",
    employmentType: "CONTRACT",
    priority: "HIGH",
    industryId: DB.industries[0].industryId,
    skills: [{ skillId: null, originalText: "Node.js", sourceType: "RECRUITER_ENTERED" }],
  };
  const created = await request("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createPayload),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.status, "DRAFT");

  const conflict = await request(`/jobs/${created.body.jobProfileId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ positionTitle: "Integration Engineer", fillByDate: "2027-12-01", versionNo: 99 }),
  });
  assert.equal(conflict.response.status, 409);

  const updated = await request(`/jobs/${created.body.jobProfileId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ positionTitle: "Principal Integration Engineer", fillByDate: "2027-12-01", versionNo: 1 }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.versionNo, 2);
});

test("DELETE /jobs/:jobProfileId returns 204", async () => {
  const created = await request("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyName: DB.companies[0].clientName, positionTitle: "Temporary Test Role", fillByDate: "2027-12-01" }),
  });
  const deleted = await request(`/jobs/${created.body.jobProfileId}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 204);
});

test("removed job actions and opportunities are not exposed", async () => {
  const jobId = DB.jobs[0].jobProfileId;
  assert.equal((await request(`/jobs/${jobId}/save`, { method: "POST" })).response.status, 404);
  assert.equal((await request(`/jobs/${jobId}/apply`, { method: "POST" })).response.status, 404);
  assert.equal((await request("/opportunities")).response.status, 404);
});