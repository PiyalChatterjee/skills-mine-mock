# SkillsMine Mock Server

Camouflage-compatible mock API server for SkillsMine frontend development.

**Single-domain, role-based access model** — all roles operate under `theskillsmine.com` with role-based route access. No separate subdomains.

## Quick Start

```bash
npm start          # start server
npm run mock:dev   # start with --watch (auto-restart on file changes)
```

Server runs at **http://localhost:4000**

## Test Accounts

All accounts use password `Password123`

| Email | Role | Dashboard URL |
|---|---|---|
| `candidate@skillsmine.com` | Candidate | `/candidates/dashboard` |
| `candidate2@skillsmine.com` | Candidate | `/candidates/dashboard` |
| `recruiter@skillsmine.com` | Recruiter | `/recruiters/dashboard` |
| `recruiter2@skillsmine.com` | Recruiter | `/recruiters/dashboard` |
| `manco@skillsmine.com` | MANCO | `/manco/dashboard` |
| `admin@skillsmine.com` | Admin | `/admin/dashboard` |

---

## API Endpoint Reference

### Authentication
All authenticated endpoints require `Authorization: Bearer <token>` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Login – returns `userId`, `role`, `token`, `dashboardUrl` |
| `GET` | `/api/auth/me` | Required | Get current user profile |
| `POST` | `/api/auth/logout` | Optional | Invalidate token |

**Login response example:**
```json
{
  "userId": "u2",
  "role": "recruiter",
  "token": "<jwt>",
  "dashboardUrl": "/recruiters/dashboard",
  "user": { "id": "u2", "email": "...", "firstName": "Sarah", "permissions": [...] },
  "expiresIn": 86400
}
```

---

### Public Job Board (`/opportunities`)
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/opportunities` | Public | Featured job listings for the marketing site |
| `GET` | `/api/jobs` | Public | Full job list — supports `?status=`, `?industry=`, `?location=`, `?q=`, `?page=`, `?limit=` |
| `GET` | `/api/jobs/:jobId` | Public | Single job detail |

---

### Candidate Module

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/candidates/register` | Public | Register a new candidate |
| `POST` | `/api/jobs/:jobId/apply` | Optional* | Apply for a job (authenticated or guest) |
| `POST` | `/api/candidates/cv/upload` | Required | Upload CV — returns OCR-extracted profile data |
| `PUT` | `/api/candidates/cv-builder/:step` | Required | Save a CV builder step (`personal`, `skills`, `education`, `experience`, `summary`, `preferences`) |
| `GET` | `/api/candidates/cv/preview` | Required | Get CV preview URL |
| `GET` | `/api/candidates/dashboard` | Required | Candidate dashboard with recommended jobs & application status |
| `GET` | `/api/candidates/applications` | Required | My applications list |

*Guest applications require `fullName` and `email` in body.

**CV upload OCR response includes:**
- `documentId`, `uploadedAt`
- `ocrExtracted`: `fullName`, `email`, `phone`, `skills[]`, `education[]`, `experience[]`, `summary`

**CV Builder steps (in order):**
`personal` → `skills` → `education` → `experience` → `summary` → `preferences`

---

### Jobs Module (Recruiter side)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/jobs` | Recruiter | Create a new job posting (status defaults to `Draft`) |
| `POST` | `/api/jobs/:jobId/pipeline/advance` | Recruiter | Advance a candidate to next pipeline stage |

**Pipeline stages (in order):**
`Applied` → `Screening` → `Assessment` → `Interview` → `Shortlisted` → `Offer` → `Closed`

**Pipeline advance body:**
```json
{ "candidateId": "c001", "checklistComplete": true }
```
Returns `422` with `requiredItems` if `checklistComplete: false`.

**Apply response includes `applicationCount`** (increments on each apply):
```json
{
  "applicationId": "app-1234567890",
  "jobId": "j001",
  "currentStage": "Applied",
  "applicationCount": 35,
  "message": "Application submitted successfully."
}
```

---

### Recruiter Module

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/recruiters/register` | Public | Register a new recruiter |
| `GET` | `/api/recruiters/dashboard` | Recruiter | Recruiter dashboard with KPIs, pipeline counts, tasks |
| `GET` | `/api/recruiters/jobs` | Recruiter | My job listings — supports `?status=` |
| `GET` | `/api/recruiters/jobs/:jobId` | Recruiter | Job detail with pipeline breakdown |
| `GET` | `/api/recruiters/candidates` | Recruiter | Search/browse candidates — supports `?q=`, `?skills=`, `?location=`, `?page=`, `?limit=` |
| `GET` | `/api/recruiters/candidates/:id` | Recruiter | Candidate profile with application history |
| `POST` | `/api/candidates/:id/actions/send-latest-matched-jobs` | Recruiter | AI action — send top matched jobs to candidate |

---

### MANCO Module

> MANCO is read-only. Cannot perform recruiter operational actions.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/manco/dashboard` | MANCO/Admin | Platform KPIs: pipeline summary, recruiter performance, compliance flags |
| `GET` | `/api/manco/recruiters` | MANCO/Admin | All recruiter list with metrics |
| `GET` | `/api/manco/recruiters/:id/performance` | MANCO/Admin | Individual recruiter KPI trend |
| `GET` | `/api/manco/recruiters/:id/pipeline` | MANCO/Admin | Recruiter's pipeline breakdown |
| `POST` | `/api/manco/recruiters/:id/resolve` | MANCO/Admin | Resolve a compliance flag (observational only) |

---

### CRM Module

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/crm/clients` | Recruiter/MANCO | All clients — supports `?status=needs_attention\|hot_lead\|warm_contact\|cold_lead` |
| `POST` | `/api/crm/clients/:id/notes` | Recruiter | Add note and optionally update client status |

**CRM Status values:** `hot_lead` → `warm_contact` → `cold_lead` / `needs_attention`

**Add note body:**
```json
{ "note": "Spoke to James — budget approved", "newStatus": "hot_lead" }
```

---

## Datasets

| Dataset | File | Count |
|---|---|---|
| Candidates | `mock-server/data/candidates.json` | **100** |
| Jobs | `mock-server/data/jobs.json` | **40** (25 Open, 10 Closed, 5 Draft) |
| Recruiters | `mock-server/data/recruiters.json` | **20** |
| CRM Clients | `mock-server/data/crm-clients.json` | **50** |
| Applications | `mock-server/data/applications.json` | **101** |

Data is loaded into memory at startup. Mutations (apply, note, pipeline advance) persist in-memory for the session.

---

## Role Permissions

| Permission | Candidate | Recruiter | MANCO | Admin |
|---|---|---|---|---|
| View public jobs | ✅ | ✅ | ✅ | ✅ |
| Apply for jobs | ✅ | — | — | ✅ |
| Upload CV | ✅ | — | — | ✅ |
| Candidate dashboard | ✅ | — | — | ✅ |
| Create jobs | — | ✅ | — | ✅ |
| Manage pipeline | — | ✅ | — | ✅ |
| View all candidates | — | ✅ | — | ✅ |
| CRM edit | — | ✅ | — | ✅ |
| MANCO dashboard | — | — | ✅ | ✅ |
| View recruiter KPIs | — | — | ✅ | ✅ |
| Resolve flags | — | — | ✅ | ✅ |

---

## State-Aware Behaviours

| Behaviour | Description |
|---|---|
| `POST /jobs/:id/apply` | Increments `applicationCount` in the in-memory jobs store |
| `POST /jobs/:id/pipeline/advance` | Advances `currentStage` through `Applied → Screening → Assessment → Interview → Shortlisted → Offer → Closed` |
| `POST /crm/clients/:id/notes` | Appends note to client and optionally changes `status` |
| `POST /candidates/register` | Creates candidate record and returns JWT |
| Login `dashboardUrl` | Role-appropriate — candidate gets `/candidates/dashboard`, recruiter gets `/recruiters/dashboard`, etc. |

---

## Configuration

`mock-server/config.yml`:

```yaml
server:
  port: 4000
delay:
  min: 300   # ms
  max: 900   # ms
errorSimulation:
  enabled: true
  rate: 0.02   # 2% random 500 errors on authenticated routes
```

---

## .mock Files (Static Fallback)

The server uses `.mock` files under `mock-server/mocks/` for the public opportunities endpoint. All other routes are handled by the Express router with live dataset queries.

| Path | File |
|---|---|
| `GET /opportunities` | `mock-server/mocks/opportunities/GET.mock` |

---

## Architecture Decisions

- **Single domain** `theskillsmine.com` — no separate recruiter subdomain
- **Role-based access** enforced in-process (not separate apps)
- **JWT mock tokens** — decoded from base64url payload, no real crypto
- **In-memory state** — mutations persist per server session, reset on restart
- **Public paths** — `/auth/login`, `/jobs`, `/opportunities`, `/candidates/register` require no token
