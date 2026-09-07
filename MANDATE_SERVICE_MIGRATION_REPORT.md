# Mandate Service v2 to v3 Migration Report

## Scope and Sources

This report compares the currently implemented mock contract in `mock-server/docs/openapi-jobs.yaml` with `Mandate_Service_v3.yaml`, then records the implementation and seed changes required for v3 compliance. The route implementation, registration, tests, and JSON datasets were also reviewed.

## Categorized Migration Summary

| Category | Summary |
| --- | --- |
| Endpoints removed | `GET /dashboard/summary` is commented out in v3; existing `PUT /jobs/{jobProfileId}` is absent from v3. Legacy save/apply/opportunities routes are outside this mandate router and must not be exposed as mandate-service operations. |
| Endpoints added | `PATCH /jobs/{jobProfileId}`, `PATCH /jobs/{jobProfileId}/view`, and `GET /locations`. |
| Endpoints modified | `GET /jobs`, `POST /jobs`, `GET /jobs/{jobProfileId}`, `DELETE /jobs/{jobProfileId}`, `GET /industries`, `GET /companies`, and `GET /candidates` gain v3 descriptions, security/error responses, and schema changes. |
| Query parameters | `GET /jobs.locationText` changes from scalar to repeatable array; `jobType` changes from scalar to repeatable array. `GET /locations` adds optional `search`. |
| Path parameters | `jobProfileId` remains a required UUID. V3 centralizes it as `components.parameters.jobProfileId`; no path-name change. |
| Request schemas | `CreateJobRequest` requires contact fields and `clientRate`; `PatchJobRequest` replaces full-update `UpdateJobRequest` and makes every field optional. |
| Response schemas | Adds `JobProfileWithSkills` for PATCH. `CompanyItem` adds nullable `clientRate`. V3 adds descriptions/examples and explicit resolved skill/detail shapes. |
| Authentication | V3 applies global `BearerAuth` to every operation. Current YAML explicitly makes job reads public and the runner also has a public-path exception; this must be removed for strict v3 compliance. |
| Pagination | V3 remains zero-based with `page=0`, `size=20`, and size 1-100. No pagination model change. |
| Enums | Existing job status, employment type, work type, priority, skill source, candidate status, and date-posted values are unchanged. V3 adds status fields to create and patch requests. |

## A. Endpoint Difference Report

### Removed from active v3

| Method | Path | Current state | Action |
| --- | --- | --- | --- |
| GET | `/dashboard/summary` | Implemented in `mandateService.js` | Remove from the v3 mandate surface, unless deliberately retained as compatibility-only. |
| PUT | `/jobs/{jobProfileId}` | Implemented with optimistic locking | Remove and replace with sparse PATCH semantics. |

The legacy `POST/DELETE /jobs/{jobId}/save`, `POST /jobs/{jobId}/apply`, and `GET /opportunities` operations are absent from the mandate router and must remain unregistered.

### Added in v3

| Method | Path | Required behavior |
| --- | --- | --- |
| PATCH | `/jobs/{jobProfileId}` | Sparse update, absent properties unchanged, automatic version increment, `JobProfileWithSkills` response. |
| PATCH | `/jobs/{jobProfileId}/view` | Increment `viewCount` and return `{ viewCount }`. |
| GET | `/locations` | Distinct alphabetically sorted job locations with optional case-insensitive search. |

## B. Query and Path Parameter Changes

`GET /jobs` currently accepts scalar `locationText` and `jobType`; v3 requires repeatable form arrays with OR semantics. Repeated parameters and comma-separated local requests should both be normalized. `industryId` remains repeatable with OR semantics. No obsolete query parameter is used by the current mandate handler.

`jobProfileId` remains a required UUID path parameter and malformed IDs return the documented `BadRequest` shape.

## C. Request Schema Changes

`CreateJobRequest` changes from requiring only `companyName`, `positionTitle`, and `fillByDate` to requiring `companyName`, `contactName`, `contactEmail`, `contactPhoneNumber`, `positionTitle`, `fillByDate`, and `clientRate`. V3 also documents `status`, although the endpoint description says new posts are DRAFT; the implementation preserves that DRAFT invariant.

`PatchJobRequest` replaces `PUT` and removes required `versionNo`. All fields are optional, including contact fields, salary, status, industry, and skills. Absent properties must be distinguished from explicit nulls and empty arrays. `AddJobSkillRequest` permits the skill ID to be absent/null while the runtime continues to validate usable text and source type.

## D. Response Schema Changes

- Add `JobProfileWithSkills` and use it for PATCH responses.
- Add nullable `clientRate` to `CompanyItem` and preserve it in company responses.
- Keep direct `CompanyPage`, `CandidatePage`, and `JobProfilePage` objects with `data`, `total`, `page`, and `size`.
- Keep `IndustryItem[]` and direct `DashboardSummary` only for compatibility if the route is intentionally retained; dashboard summary is not an active v3 path.
- Keep `{ message, code, requestId, timestamp }` for errors.

## E. Authentication Changes

The v3 document declares global bearer authentication without public operation overrides. The runner currently treats `GET /jobs` as public. Strict compliance requires removing that exception from the v3 route surface, or isolating it as an explicitly non-v3 compatibility route.

## F. Seed and Relationship Assessment

Current data already satisfies the requested minimums and enum coverage: 20+ industries, 30+ companies, 100+ jobs, 200+ candidates, all v3 job statuses and employment types, and all candidate statuses. Every job references an existing company and industry; every candidate references an existing job and company.

Required seed work is corrective/additive:

- Add a location source or derive distinct locations from jobs.
- Ensure companies expose nullable `clientRate` where available.
- Ensure jobs have numeric `viewCount`, valid dates, and v3 response fields.
- Preserve UUID relationships and search, filter, pagination, and empty-state coverage.
- Keep legacy-only fields internal and out of v3 response mappings.

## G. Validation Changes

- Validate UUID path and job filter parameters.
- Validate repeatable array filters and all v3 enums.
- Validate zero-based pagination and size 1-100.
- Validate all v3 create required fields, including contact data and client rate.
- Validate sparse PATCH fields only when present and increment the version once.
- Return documented `400`, `404`, `409`, `422`, and `500` error shapes where declared.

## H. Implementation Checklist

- [x] Replace PUT with PATCH and implement sparse updates.
- [x] Add view increment and persistence through the existing dataset writer.
- [x] Add locations route and location seed source.
- [x] Normalize array filters for jobs.
- [x] Align OpenAPI paths, reusable parameter, schemas, and responses with v3.
- [x] Enforce global bearer security for mandate operations in the runner.
- [x] Remove obsolete dashboard and PUT mandate registrations.
- [x] Add focused tests for PATCH, view count, locations, arrays, and create validation.

## Modified/New Files Planned

Modified files: `mock-server/routes/mandateService.js`, `mock-server/camouflage-runner.js`, `mock-server/docs/openapi-jobs.yaml`, `mock-server/tests/mandate-service.test.js`, and this report.

New file: `mock-server/data/locations.json`, used as the canonical location seed and merged with locations introduced by jobs.

Removed files: none. Legacy datasets remain in place because they support other non-mandate mock services; obsolete mandate operations are no longer registered.

## Swagger Compliance Checklist

- [x] V3 path set: jobs list/detail/create/delete, sparse patch, view increment, industries, locations, companies, and candidates.
- [x] Global bearer security with no public job-read override.
- [x] Repeatable `industryId`, `locationText`, and `jobType` filters with OR matching.
- [x] Zero-based pagination with defaults and bounds.
- [x] V3 create and patch request schemas represented.
- [x] `JobProfileWithSkills`, location array, and view-count response represented.
- [x] Error response shape retained as `{ message, code, requestId, timestamp }`.
- [x] Seed volumes, relationships, and enum coverage retained.
- [x] Focused v3 route suite passes 8/8 tests.

## Intentional Contract Decision

The supplied v3 document comments out `GET /dashboard/summary` while the
earlier contract and mock data included it. It is removed from the v3 route and
Swagger surface as required by the supplied v3 document. New jobs remain DRAFT
even though the v3 request schema shows a POSTED default, because the v3 POST
description explicitly states that creation always persists DRAFT status.
