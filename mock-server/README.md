# SkillsMine – Camouflage Mock Server

A Camouflage-compatible mock backend for SkillsMine frontend development.
Uses the standard Camouflage `.mock` file format with Handlebars templating,
powered by a Node 22+ compatible Express runner.

---

## Quick Start

```bash
# Install dependencies (once)
npm install

# Start mock server (one-shot)
npm run mock:start

# Start with file-watch / hot-reload
npm run mock:dev
```

Server starts at **http://localhost:4000**

---

## Folder Structure

```
mock-server/
├── config.yml                       ← Server configuration
├── camouflage-runner.js             ← Node 22+ compatible runner
└── mocks/
    ├── auth/
    │   ├── login/POST.mock          ← POST /api/auth/login
    │   ├── me/GET.mock              ← GET  /api/auth/me
    │   └── logout/POST.mock         ← POST /api/auth/logout
    ├── candidates/
    │   └── GET.mock                 ← GET  /api/candidates
    ├── jobs/
    │   ├── GET.mock                 ← GET  /api/jobs
    │   └── POST.mock                ← POST /api/jobs
    ├── applications/
    │   └── GET.mock                 ← GET  /api/applications
    ├── mandates/
    │   ├── GET.mock                 ← GET  /api/mandates
    │   └── POST.mock                ← POST /api/mandates
    ├── pipeline/
    │   ├── GET.mock                 ← GET  /api/pipeline
    │   └── PATCH.mock               ← PATCH /api/pipeline
    ├── crm/
    │   ├── GET.mock                 ← GET  /api/crm
    │   └── POST.mock                ← POST /api/crm
    └── dashboard/
        ├── recruiter/GET.mock       ← GET  /api/dashboard/recruiter
        ├── candidate/GET.mock       ← GET  /api/dashboard/candidate
        ├── manco/GET.mock           ← GET  /api/dashboard/manco
        └── exco/GET.mock            ← GET  /api/dashboard/exco
```

---

## Authentication

### Login

```http
POST http://localhost:4000/api/auth/login
Content-Type: application/json

{
  "email": "recruiter@skillsmine.com",
  "password": "Password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": "u2",
    "email": "recruiter@skillsmine.com",
    "role": "recruiter",
    "firstName": "Sarah",
    "lastName": "Johnson",
    "permissions": ["MANDATE_CREATE", "MANDATE_EDIT", "PIPELINE_ADVANCE", "CRM_EDIT", "CANDIDATE_VIEW"]
  },
  "expiresIn": 86400
}
```

### Using the Token

All protected routes require:
```
Authorization: Bearer <token>
```

### Check Current User

```http
GET http://localhost:4000/api/auth/me
Authorization: Bearer <token>
```

### Logout

```http
POST http://localhost:4000/api/auth/logout
Authorization: Bearer <token>
```

---

## Test Accounts

| Role        | Email                          | Password      | Permissions                                                                 |
|-------------|--------------------------------|---------------|-----------------------------------------------------------------------------|
| `candidate` | candidate@skillsmine.com       | Password123   | VIEW_JOBS, APPLY_JOB                                                        |
| `recruiter` | recruiter@skillsmine.com       | Password123   | MANDATE_CREATE, MANDATE_EDIT, PIPELINE_ADVANCE, CRM_EDIT, CANDIDATE_VIEW   |
| `manco`     | manco@skillsmine.com           | Password123   | PIPELINE_VIEW, REPORT_VIEW                                                  |
| `exco`      | exco@skillsmine.com            | Password123   | REPORT_VIEW, EXECUTIVE_VIEW                                                 |
| `admin`     | admin@skillsmine.com           | Password123   | ALL                                                                         |

---

## API Reference

### Auth

| Method | Endpoint             | Auth? | Description           |
|--------|----------------------|-------|-----------------------|
| POST   | /api/auth/login      | ❌    | Login, receive token  |
| GET    | /api/auth/me         | ✅    | Current user info     |
| POST   | /api/auth/logout     | ✅    | Invalidate session    |

### Resources

| Method | Endpoint                       | Auth? | Description                   |
|--------|--------------------------------|-------|-------------------------------|
| GET    | /api/candidates                | ✅    | List all candidates           |
| GET    | /api/jobs                      | ✅    | List all jobs                 |
| POST   | /api/jobs                      | ✅    | Create a job posting          |
| GET    | /api/applications              | ✅    | List all applications         |
| GET    | /api/mandates                  | ✅    | List all mandates             |
| POST   | /api/mandates                  | ✅    | Create a mandate              |
| GET    | /api/pipeline                  | ✅    | Pipeline stages + candidates  |
| PATCH  | /api/pipeline                  | ✅    | Advance candidate stage       |
| GET    | /api/crm                       | ✅    | CRM records                   |
| POST   | /api/crm                       | ✅    | Create CRM record             |

### Dashboards

| Method | Endpoint                       | Auth? | Role       |
|--------|--------------------------------|-------|------------|
| GET    | /api/dashboard/recruiter       | ✅    | recruiter  |
| GET    | /api/dashboard/candidate       | ✅    | candidate  |
| GET    | /api/dashboard/manco           | ✅    | manco      |
| GET    | /api/dashboard/exco            | ✅    | exco       |

---

## Recruitment Pipeline Stages

```
INBOUND → SCREENING → ASSESSMENT → INTERVIEW → SHORTLIST → OFFER → CLOSED
```

### Advance a Candidate

```http
PATCH http://localhost:4000/api/pipeline
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "app1",
  "candidateId": "c1",
  "previousStage": "INTERVIEW",
  "newStage": "SHORTLIST"
}
```

---

## CRM Status Values

| Status           | Meaning                         |
|------------------|---------------------------------|
| `HOT_LEAD`       | Active opportunity, high intent |
| `WARM`           | Engaged, follow-up in progress  |
| `NEEDS_ATTENTION`| Overdue, needs immediate action |
| `COLD`           | Low engagement, low priority    |

---

## Realistic Behaviour

| Feature            | Value                                      |
|--------------------|--------------------------------------------|
| Network delay      | 500 – 1500 ms (random per request)         |
| Error injection    | 5% of authenticated requests               |
| Error types        | 401 Unauthorized, 403 Forbidden, 500 Error |

> **Tip:** If you receive an unexpected 401/403/500, simply retry — it's simulated chaos.

---

## Adding a New Mock

1. Create the folder: `mock-server/mocks/<resource>/`
2. Add a file: `<METHOD>.mock` (e.g. `GET.mock`, `POST.mock`)
3. Use this format:

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "key": "value",
  "dynamic": "{{randomInt 1 100}}"
}
```

### Available Handlebars Helpers

| Helper                      | Example                        | Output                  |
|-----------------------------|--------------------------------|-------------------------|
| `{{randomInt min max}}`     | `{{randomInt 1 999}}`          | `427`                   |
| `{{now 'YYYY-MM-DD'}}`      | `{{now 'YYYY-MM-DD'}}`         | `2024-11-15`            |
| `{{request.body.field}}`    | `{{request.body.title}}`       | Value from POST body    |
| `{{request.query.field}}`   | `{{request.query.page}}`       | Value from query string |
| `{{user.role}}`             | `{{user.role}}`                | `recruiter`             |
| `{{eq a b}}`                | `{{#if (eq x "foo")}}...{{/if}}`| Conditional check      |

---

## Migration from json-server

| Old (json-server)             | New (Camouflage runner)               |
|-------------------------------|---------------------------------------|
| `db.json`                     | `mock-server/mocks/**/*.mock` files   |
| `routes.json`                 | File-system routing (folder = path)   |
| `server.js`                   | `mock-server/camouflage-runner.js`    |
| `npm run mock:watch`          | `npm run mock:dev`                    |
| `npm run mock`                | `npm run mock` or `npm run mock:start`|

The old `server.js` / `db.json` / `routes.json` are preserved for reference.

---

## Configuration (`config.yml`)

```yaml
server:
  port: 4000
  mocksDir: "./mock-server/mocks"

delay:
  min: 500    # ms
  max: 1500   # ms

errorSimulation:
  enabled: true
  rate: 0.05  # 5%

auth:
  publicPaths:
    - /auth/login
```

---

## OpenAPI Alignment

Each `.mock` file maps 1:1 to an OpenAPI path+operation:

```
mocks/candidates/GET.mock   →  GET /api/candidates
mocks/jobs/POST.mock        →  POST /api/jobs
```

When the real backend is ready, replace `.mock` responses with the actual OpenAPI spec — no frontend code changes required.

---

*SkillsMine Mock Server – for frontend development only. Do not deploy to production.*
