# Mandate Service v2 Seed Migration Report

## Impact Analysis

The old `jobs.json` combined public-card fields, legacy identifiers, and partial
v2 aliases. The migrated dataset stores canonical v2 fields plus only the
internal foreign keys and recruiter identifier needed to produce responses.

| Legacy field | Migration |
| --- | --- |
| `jobId` | Removed; `jobProfileId` is the UUID identity. |
| `title` | Renamed to `positionTitle`. |
| `company` | Removed; `clientId` references `companies.json`. |
| `location` | Renamed to `locationText`. |
| `industry` | Removed; `industryId` references `industries.json`. |
| `employmentTypeCode` | Renamed to `employmentType`; values use the v2 enum. |
| `workTypeCode` | Renamed to `workType`; values use the v2 enum. |
| `description` | Renamed to `jobDescription`. |
| `postedDate` | Replaced by nullable ISO `publishedAt`. |
| `statusCode` | Renamed to `status`; values use the v2 enum. |
| `applicationCount` | Renamed to `applicantCount`. |
| `skills: string[]` | Changed to `JobSkillSummary[]`. |
| `salaryRange` | Removed; not present in the v2 schema. |

Industries changed from `{ industryId, name }` to `IndustryItem`. Companies use
`CompanyItem`. Candidates changed from profile-heavy records to `CandidateRow`
records with UUID job and application relationships. Dashboard metrics are a
generated dataset rather than hard-coded route values.

## Generated Volumes

| Dataset | Count | Purpose |
| --- | ---: | --- |
| `industries.json` | 25 | Search, picker population, job relationships. |
| `companies.json` | 32 | Search and two or more result pages. |
| `jobs.json` | 120 | All filters, statuses, date windows, and six pages at default size. |
| `candidates.json` | 240 | All filters, statuses, per-job lists, and 12 default-size pages. |
| `dashboard-summary.json` | 1 object | Metrics derived from candidate statuses. |

Run `npm run seed:mandates` to reproduce all five datasets. The generator is
deterministic in record selection and relationships; date fields are generated
relative to execution time so date-window filters remain useful.

## Relationship Validation

- Every job `clientId` exists in `companies.json`.
- Every job `industryId` exists in `industries.json`.
- Every candidate `jobProfileId` exists in `jobs.json`.
- Every application `jobId` and `jobProfileId` contains the same canonical UUID and references an existing job.
- Candidate profile application arrays are rebuilt from canonical global application records.
- Every candidate internal `clientId` exists in `companies.json` and agrees
  with its `companyName`.
- Job, candidate, application, company, industry, user, and skill identifiers
  use valid UUID-shaped values.
- API serializers remove internal `clientId` from `CandidateRow` responses.

These invariants are executable assertions in
`mock-server/tests/mandate-service.test.js`.

## Enum Coverage

- Job status: `DRAFT`, `POSTED`, `PAUSED`, `FILLED`, `CANCELLED`, `CLOSED`.
- Employment type: `FULL_TIME`, `PART_TIME`, `CONTRACT`, `TEMPORARY`,
  `INTERNSHIP`, `FREELANCE`.
- Work type: `REMOTE`, `HYBRID`, `ONSITE`.
- Priority: `LOW`, `NORMAL`, `HIGH`, `CRITICAL`.
- Skill source: `AI_GENERATED`, `RECRUITER_ENTERED`.
- Candidate status: `SUBMITTED`, `ACTIVE`, `ON_HOLD`, `CLOSED`, `CANCELLED`,
  `REJECTED`, `APPLIED`.

## Filter and Scenario Coverage

| Endpoint | Seed support |
| --- | --- |
| Jobs `search` | 18 recurring position families with senior variants. |
| Jobs `industryId` | Jobs distributed over all 25 industries. |
| Jobs `locationText` | Nine South African location values. |
| Jobs `datePosted` | Published records spread from today through 44 days ago. |
| Jobs `jobType` | Every employment type repeats 20 times. |
| Jobs `clientId` | Jobs distributed across all 32 companies. |
| Jobs `status` | Every status repeats 20 times. |
| Candidates `companyName` | Candidate employment distributed across all companies. |
| Candidates `locationText` | Candidate locations span all nine values. |
| Candidates `search` | Fourteen first names, fourteen surnames, and 18 titles. |
| Candidates `jobProfileId` | Every job has two linked candidate rows. |
| Candidates `status` | Every candidate status has at least 34 rows. |
| Pagination | 120 jobs, 32 companies, and 240 candidates create full and partial pages. |
| Empty states | Valid UUIDs and unmatched text naturally return empty pages. |

## Cleanup

The regenerated mandate datasets no longer contain saved-job arrays,
opportunity-card presentation fields, guest-application fields, legacy job
identifiers, or duplicate legacy/v2 enum columns. Other data files used by
separate mock services remain untouched.
