# Candidate Service v2 Migration Report

## Scope

Compared the current `mock-server/docs/openapi-candidates.yaml` and registered
candidate routes with the supplied `candidate_service_v2.yaml`. The new source
contract is the candidate-service API for authenticated candidate CV/profile,
dashboard, landing, saved-job, and recommended-position workflows.

## Contract Comparison Summary

| Area | Current mock / OpenAPI | Candidate Service v2 | Migration |
| --- | --- | --- | --- |
| CV path | `/candidates/cv-build/` and legacy `/candidate/buildmycv` | `/candidates/cv-build/{candidateId}` | Add candidate-scoped GET/POST; preserve existing paths as compatibility aliases. |
| Profile path | `/candidates/profile/` | `/candidates/profile/{candidateId}` | Add candidate-scoped GET and PUT simple-profile update. |
| Landing | Envelope with anonymous featured jobs or authenticated statistics | Direct authenticated `CandidateLandingResponse` | Add v2 candidate-scoped response behavior; retain public UI compatibility path. |
| Dashboard | `/candidates/dashboard` envelope with summary/activity/cards | Direct `CandidateDashboardResponse` with applications and pagination | Add v2 pagination and response mapping while preserving existing UI envelope alias. |
| Saved jobs | `/candidates/saved-jobs` GET/POST; `/candidates/saved-jobs/{jobProfileId}` DELETE | `/candidates/{candidateId}/saved-jobs` GET and `/candidates/{candidateId}/saved-jobs/{jobProfileId}` POST/DELETE | Add candidate-scoped routes and v2 saved-job response shapes. |
| Recommendations | `/candidates/recommended-positions` envelope | `/candidates/{candidateId}/recommended-positions` direct response | Add candidate-scoped paginated route and v2 response mapping. |
| AI actions | `/candidates/ai-actions/` candidate envelope and internal candidate AI routes | Candidate AI path is commented out in supplied v2 | Keep existing implemented AI routes as compatibility/internal surfaces; no new source-contract endpoint is required. |
| CV upload | `/applications/{applicationId}/cv/upload` envelope | Not present | Retain because it is a separate registered workflow, outside candidate-service v2 paths. |
| Legacy paths | `/candidate/*`, `/api/v1/candidates/{candidateId}/profile` | Not present | Keep as deprecated compatibility routes because frontend and other mock workflows consume them. |

## Endpoint Differences

### Added by v2

- `GET /candidates/cv-build/{candidateId}`
- `POST /candidates/cv-build/{candidateId}`
- `GET /candidates/profile/{candidateId}`
- `PUT /candidates/profile/{candidateId}`
- `GET /candidates/{candidateId}/saved-jobs`
- `GET /candidates/{candidateId}/recommended-positions`
- `POST /candidates/{candidateId}/saved-jobs/{jobProfileId}`
- `DELETE /candidates/{candidateId}/saved-jobs/{jobProfileId}`

### Removed or replaced by v2

- Unscoped `/candidates/cv-build/` as the source-contract path.
- Unscoped `/candidates/profile/` as the source-contract path.
- Unscoped `/candidates/saved-jobs` and `/candidates/saved-jobs/{jobProfileId}`.
- Unscoped `/candidates/recommended-positions`.
- The commented `/candidates/ai-actions/{candidateId}` proposal remains absent.

Existing aliases are retained only for backward compatibility with the current
frontend and other mock modules; they are marked as compatibility behavior in
this report and in the implementation comments.

## Parameter Changes

- New required `candidateId` path parameter on CV, profile, saved-job, and
  recommended-position routes; v2 specifies UUID format.
- New required `jobProfileId` path parameter on saved/unsaved operations; UUID.
- Dashboard changes to `page` default 1, minimum 1, and `size` default 10,
  minimum 1, maximum 50.
- Saved jobs and recommendations use the same one-based `page`/bounded `size`
  model.
- Old `limit`, `location`, and `skill` parameters on the unscoped candidate
  list are not part of the candidate-service v2 operations.

## Request Changes

- CV POST uses a required candidate path identity and `CreateCandidateProfile`
  body with `personal_details`, career history, skills, education, and languages.
- Profile PUT uses `SimpleCandidateProfileInput` with `personal_details` and
  `job_details`.
- Saved-job POST has no body; candidate and job identities are path parameters.
- Existing frontend request bodies are normalized at compatibility aliases.

## Response Changes

- Candidate-service v2 responses are direct payloads, not the current generic
  `{ success, statusCode, message, data }` envelope.
- Profile/CV fields use snake_case names in v2, including `personal_details`,
  `desired_job`, `employment_type`, and timestamp fields.
- Dashboard uses `candidate_id`, `applications`, and
  `pagination.current_page/page_size/total_items/total_pages`.
- Saved jobs use `candidate_id`, `saved_jobs`, and the v2 saved-job item shape.
- Recommendations use `candidate_id`, `recommended_positions`, and v2 pagination.
- v2 employment enums are `FULL_TIME`, `PART_TIME`, `CONTRACT`, `TEMPORARY`,
  `INTERNSHIP`, and `FREELANCE`; seed/profile mapping must emit these values.

## Authentication and Authorization

All candidate-service v2 operations inherit `BearerAuth`. Candidate-scoped
handlers verify the requested candidate against the authenticated candidate
identity where the mock has an authenticated user. Invalid/missing auth is
handled by the runner; profile mismatch returns `403` from v2 handlers.
The anonymous landing compatibility behavior is retained only on the existing
public landing endpoint because the frontend uses it before login.

## Data and Model Assessment

The existing `candidate-profiles.json`, `users.json`, `jobs.json`,
`applications.json`, `resumes.json`, and `candidates.json` contain the source
records needed for v2. No new fixture family is required. Response builders
will translate the existing camelCase/internal records to v2 snake_case
payloads and canonical employment enums. Relationships remain linked through
`userId`, `candidateId`, and `jobProfileId`.

## Implementation Checklist

- [x] Add candidate-scoped CV GET/POST routes and v2 mapping.
- [x] Add candidate-scoped profile GET/PUT routes and validation.
- [x] Add v2 dashboard, saved-job, and recommendation response mappings.
- [x] Add candidate/job identity and authorization validation.
- [x] Update canonical candidate Swagger to v2 paths and schemas.
- [x] Keep compatibility aliases documented and isolated.
- [x] Update focused tests for current candidate behavior and compatibility paths.
- [x] Run tests, syntax checks, schema parsing, and Swagger path validation as the final validation step.

## Files

Planned modified files:

- `mock-server/routes/candidates.js`
- `mock-server/camouflage-runner.js`
- `mock-server/docs/openapi-candidates.yaml`
- `mock-server/tests/candidate-job-relationships.test.js`
- `mock-server/tests/cv-builder.test.js`

New file:

- `CANDIDATE_SERVICE_V2_MIGRATION_REPORT.md`

Removed files: none. Existing legacy fixtures and aliases serve other active
mock workflows and are not removed during this migration.

## Final Validation

- `npm test`: 38/38 tests passed.
- `node --check` passed for `routes/candidates.js` and `camouflage-runner.js`.
- Candidate Swagger parsed successfully; all five v2 path groups are present.
- `git diff --check` passed.
- No `lint` or `build` scripts exist in the mock-server package, so those checks
  were unavailable. The frontend build was not part of this backend-only change.

## Compatibility Note

The supplied v2 examples describe UUID candidate identifiers, while the active
mock candidate profiles use stable identifiers such as `CAND100001`. The v2
router accepts the canonical mock identifier and also checks `candidateUuid`
when present, preserving the current seed model without inventing orphan UUID
records.
