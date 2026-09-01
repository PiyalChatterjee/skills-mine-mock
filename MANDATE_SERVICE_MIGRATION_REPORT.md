# Mandate Service v2 Migration Report

## Scope

This migration replaces the job-service surface described by
`mock-server/docs/openapi-jobs.yaml` with `Mandate_Service_v2.yaml`. The new
service is exposed at the specification-relative paths. All operations inherit
the global `BearerAuth` requirement.

## Endpoint Diff

| Method | Path | Change |
| --- | --- | --- |
| GET | `/dashboard/summary` | Added; returns `DashboardSummary` without an envelope. |
| GET | `/jobs` | Modified; new filters, zero-based pagination, and `JobProfilePage`. |
| POST | `/jobs` | Modified; accepts `CreateJobRequest`, creates `DRAFT`, returns `JobProfile`. |
| GET | `/jobs/{jobProfileId}` | Modified path key and bare `JobProfileDetail` response. |
| PUT | `/jobs/{jobProfileId}` | Added; full update with `versionNo` optimistic locking. |
| DELETE | `/jobs/{jobProfileId}` | Added; hard-deletes eligible drafts, otherwise cancels. |
| GET | `/industries` | Added to this contract; returns a bare `IndustryItem[]`. |
| GET | `/companies` | Added; searchable `CompanyPage`. |
| GET | `/candidates` | Added; searchable/filterable `CandidatePage`. |
| POST, DELETE | `/jobs/{jobId}/save` | Removed. |
| POST | `/jobs/{jobId}/apply` | Removed. |
| GET | `/opportunities` | Removed. |

## GET /jobs Contract Changes

| Old | New |
| --- | --- |
| `q` | `search` (position title) |
| `industry` | Repeatable `industryId` with OR semantics |
| `location` | `locationText` |
| None | `datePosted`: `TODAY`, `LAST_3_DAYS`, `LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS` |
| None | `jobType`: `FULL_TIME`, `PART_TIME`, `CONTRACT`, `TEMPORARY`, `INTERNSHIP`, `FREELANCE` |
| None | `clientId` |
| Free-form `status` | `DRAFT`, `POSTED`, `PAUSED`, `FILLED`, `CANCELLED`, `CLOSED` |
| One-based `page`, default 1 | Zero-based `page`, default 0 |
| `limit`, default 10 | `size`, default 20, maximum 100 |
| `showEmployerDetails` | Removed |
| Nested success envelope | `{ data, total, page, size }` |

Repeated and comma-separated `industryId` values are accepted by the mock to
make local testing convenient. Invalid enum values and pagination bounds return
`400 VALIDATION_ERROR`.

## Request and Response Changes

- Job identity changed from `jobId` to UUID `jobProfileId`.
- `title`, `location`, and `description` became `positionTitle`, `locationText`,
  and `jobDescription`.
- Employer text became a `clientId` relationship and nested `CompanyItem` response.
- Industry text became an `industryId` relationship and nested `IndustryItem` response.
- Employment and work values now use uppercase enums.
- Skills changed from `string[]` to `{ skillId, originalText, sourceType }[]`.
- `publishedAt`, `createdAt`, and `updatedAt` are ISO date-times; drafts have
  `publishedAt: null`.
- Detail responses add `viewCount`, `applicantCount`, and `daysLeftToFill`.
- Create requires `companyName`, `positionTitle`, and `fillByDate`.
- Update requires `positionTitle`, `fillByDate`, and `versionNo`.
- Error responses use `{ message, code, requestId, timestamp }`.

## Security Changes

The backend specification declares global bearer security, but the product
requires guests to browse and inspect opportunities before registering. The
mock therefore applies an explicit read-only exception to `GET /jobs` and
`GET /jobs/{jobProfileId}`. Job mutations, candidate saved jobs, and candidate
application creation remain bearer-protected. Missing or unknown tokens on
protected operations receive `401` before route handling.

## Validation Implemented

- Zero-based integer `page`; `size` from 1 through 100.
- All job, work, priority, skill-source, date-window, and candidate-status enums.
- UUID path parameters and candidate `jobProfileId` filters.
- Required create/update properties.
- ISO `YYYY-MM-DD` fill date syntax and email syntax.
- Non-negative salaries and `salaryMax >= salaryMin`.
- String-array validation for requirements, responsibilities, and benefits.
- Skill object validation.
- Existing-industry foreign key validation.
- Unique job reference numbers.
- Optimistic `versionNo` conflict handling.
- Posted jobs accept only description and salary edits, as required by the
  operation description.

## Swagger Ambiguities and Mock Decisions

| Ambiguity | Mock decision |
| --- | --- |
| No endpoint is defined for status transitions. | Seeds cover all statuses; CRUD creates drafts and delete can cancel. No undocumented transition endpoint was added. |
| POSTED update description also requires `positionTitle` and `fillByDate` in the request schema. | Those required fields are accepted as unchanged context; any other non-salary/description field returns 422. |
| `fillByDate` prose examples imply a future-date rule, but the schema has no minimum. | Validate date syntax only. Generated seeds use future dates. |
| Candidate Swagger defines application reads but no create operation. | Added `POST /candidates/applications` as a documented mock compatibility operation required by the job-detail Apply workflow. |
| `daysLeftToFill` rounding is unspecified. | Use nearest whole day; terminal statuses return null. |
| Candidate status-to-workflow mapping is unspecified. | Candidate rows are seeded directly with contract statuses rather than inferred from legacy pipeline stages. |
| Dashboard source records are not defined. | Generated summary maps SUBMITTED to CVs due, ACTIVE to interviews, and ON_HOLD to offer deadlines. |
| Sort parameters are absent. | Stable seed order is retained; no undocumented sort query was added. |
| Local server in Swagger uses port 8081 while this mock uses configured port 4000. | Paths and payloads match; the existing mock port remains unchanged. |

## Endpoint Compliance Checklist

- [x] `GET /dashboard/summary`: generated `DashboardSummary`.
- [x] `GET /jobs`: all seven filters, zero-based pagination, `JobProfilePage`.
- [x] `POST /jobs`: validation, company upsert, draft status, `JobProfile`.
- [x] `GET /jobs/{jobProfileId}`: UUID lookup and `JobProfileDetail`.
- [x] `PUT /jobs/{jobProfileId}`: validation, version conflict, edit restrictions.
- [x] `DELETE /jobs/{jobProfileId}`: hard-delete/cancel behavior and 204.
- [x] `GET /industries`: search, alphabetic order, bare array.
- [x] `GET /companies`: search and bounded pagination.
- [x] `GET /candidates`: all filters and bounded pagination.
- [x] Global bearer authentication applies at the production runner.
- [x] Removed job actions and opportunities return 404.
- [x] Focused contract suite covers success, validation, integrity, and removal.
