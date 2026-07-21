# SkillsMine Mock API Server

A fully-featured mock backend for the SkillsMine React application, powered by **json-server v1**.  
Use this to develop the frontend before real APIs are available.

**Base URL:** `http://localhost:4000`

---

## Quick Start

```bash
# Install dependencies (json-server is already in devDependencies)
npm install

# Start mock server
npm run mock

# Start mock server with file-watch (auto-restarts on db.json / server.js changes)
npm run mock:watch
```

The server prints a startup banner listing all available endpoints.

---

## Simulated Behaviour

| Feature | Detail |
|---|---|
| Network delay | 500 ms – 1500 ms per request |
| Random errors | 5 % of authenticated requests return `401`, `403`, or `500` |
| Auth | Mock JWT tokens stored in-memory |

> **Tip:** error injection is disabled on `/auth/login` so login always succeeds.

---

## Authentication

All endpoints (except `/auth/login`) require a `Bearer` token in the `Authorization` header.

### POST `/auth/login`

**Request body:**
```json
{
  "email": "candidate@skillsmine.com",
  "password": "Password123"
}
```

**Response `200`:**
```json
{
  "token": "<mock-jwt>",
  "expiresIn": 86400,
  "user": {
    "id": "u1",
    "email": "candidate@skillsmine.com",
    "role": "candidate",
    "firstName": "Michael",
    "lastName": "Smith",
    "permissions": ["VIEW_JOBS", "APPLY_JOB"]
  }
}
```

**Response `401`:**
```json
{ "error": "Invalid email or password." }
```

---

### GET `/auth/me`

Returns the current logged-in user from the session.

**Headers:** `Authorization: Bearer <token>`

**Response `200`:**
```json
{
  "user": {
    "id": "u1",
    "email": "candidate@skillsmine.com",
    "role": "candidate",
    "firstName": "Michael",
    "lastName": "Smith",
    "permissions": ["VIEW_JOBS", "APPLY_JOB"]
  }
}
```

---

### POST `/auth/logout`

Destroys the server-side session.

**Headers:** `Authorization: Bearer <token>`

**Response `200`:**
```json
{ "message": "Logged out successfully." }
```

---

## Test Users

| Role | Email | Password | Permissions |
|---|---|---|---|
| Candidate | `candidate@skillsmine.com` | `Password123` | `VIEW_JOBS`, `APPLY_JOB` |
| Recruiter | `recruiter@skillsmine.com` | `Password123` | `MANDATE_CREATE`, `MANDATE_EDIT`, `PIPELINE_ADVANCE`, `CRM_EDIT`, `CANDIDATE_VIEW` |
| MANCO | `manco@skillsmine.com` | `Password123` | `PIPELINE_VIEW`, `REPORT_VIEW` |
| EXCO | `exco@skillsmine.com` | `Password123` | `REPORT_VIEW`, `EXECUTIVE_VIEW` |
| Admin | `admin@skillsmine.com` | `Password123` | `ALL` |

---

## Resource Endpoints

All endpoints accept an `Authorization: Bearer <token>` header.  
All endpoints also accept `?_page=1&_per_page=10` pagination, `?_sort=field&_order=asc` sorting, and `?field=value` filtering (standard json-server v1 query syntax).

---

### Candidates

| Method | Path | Description |
|---|---|---|
| `GET` | `/candidates` | List all 30 candidates |
| `GET` | `/candidates/:id` | Get single candidate |
| `POST` | `/candidates` | Create candidate |
| `PUT` | `/candidates/:id` | Replace candidate |
| `PATCH` | `/candidates/:id` | Update candidate fields |
| `DELETE` | `/candidates/:id` | Delete candidate |

**Example response** `GET /candidates/c1`:
```json
{
  "id": "c1",
  "firstName": "Michael",
  "lastName": "Smith",
  "email": "michael.smith@email.com",
  "phone": "+27 82 123 4567",
  "location": "Johannesburg, Gauteng",
  "currentCompany": "Accenture",
  "jobTitle": "Senior Software Engineer",
  "experienceYears": 8,
  "skills": ["React", "Node.js", "TypeScript", "AWS", "PostgreSQL"],
  "education": [
    { "degree": "BSc Computer Science", "institution": "University of the Witwatersrand", "year": 2015 }
  ],
  "languages": ["English", "Afrikaans"],
  "matchScore": 92,
  "profilePicture": "https://i.pravatar.cc/150?img=1"
}
```

**Filter examples:**
```
GET /candidates?location=Cape Town, Western Cape
GET /candidates?experienceYears_gte=5
GET /candidates?_sort=matchScore&_order=desc
```

---

### Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/jobs` | List all 25 jobs |
| `GET` | `/jobs/:id` | Get single job |
| `POST` | `/jobs` | Create job |
| `PUT` | `/jobs/:id` | Replace job |
| `PATCH` | `/jobs/:id` | Update job fields |
| `DELETE` | `/jobs/:id` | Delete job |

**Example response** `GET /jobs/j1`:
```json
{
  "id": "j1",
  "title": "UX/UI Designer",
  "company": "Standard Bank",
  "location": "Johannesburg, Gauteng",
  "industry": "Financial Services",
  "employmentType": "Permanent",
  "workType": "Hybrid",
  "salaryMin": 45000,
  "salaryMax": 65000,
  "description": "We are looking for a talented UX/UI Designer...",
  "requirements": ["3+ years UX/UI design experience", "..."],
  "responsibilities": ["Design user flows and wireframes", "..."],
  "skills": ["Figma", "Adobe XD", "User Research", "Prototyping", "Design Systems"],
  "postedDate": "2025-06-15",
  "status": "active"
}
```

**Filter examples:**
```
GET /jobs?workType=Remote
GET /jobs?industry=Technology
GET /jobs?employmentType=Permanent&_sort=salaryMax&_order=desc
```

---

### Applications

| Method | Path | Description |
|---|---|---|
| `GET` | `/applications` | List all 40 applications |
| `GET` | `/applications/:id` | Get single application |
| `POST` | `/applications` | Create application |
| `PATCH` | `/applications/:id` | Advance stage / update status |
| `DELETE` | `/applications/:id` | Delete application |

**Stages:** `APPLIED` → `SCREENING` → `ASSESSMENT` → `INTERVIEW` → `SHORTLIST` → `OFFER`

**Example response** `GET /applications/a1`:
```json
{
  "id": "a1",
  "candidateId": "c1",
  "jobId": "j1",
  "currentStage": "INTERVIEW",
  "appliedDate": "2025-06-16",
  "matchScore": 92,
  "statusMessage": "Interview scheduled for 28 June"
}
```

**Filter examples:**
```
GET /applications?candidateId=c1
GET /applications?currentStage=OFFER
GET /applications?jobId=j5
```

---

### Pipeline

| Method | Path | Description |
|---|---|---|
| `GET` | `/pipeline` | Get all 7 pipeline stage counts |
| `GET` | `/pipeline/:id` | Get a single stage |

**Example response** `GET /pipeline`:
```json
[
  { "id": "p1", "stage": "INBOUND",    "count": 245, "weekChange": 12 },
  { "id": "p2", "stage": "SCREENING",  "count": 128, "weekChange": -5 },
  { "id": "p3", "stage": "ASSESSMENT", "count": 64,  "weekChange": 8  },
  { "id": "p4", "stage": "INTERVIEW",  "count": 42,  "weekChange": 3  },
  { "id": "p5", "stage": "SHORTLIST",  "count": 21,  "weekChange": -2 },
  { "id": "p6", "stage": "OFFER",      "count": 9,   "weekChange": 1  },
  { "id": "p7", "stage": "CLOSED",     "count": 187, "weekChange": 6  }
]
```

---

### Mandates

| Method | Path | Description |
|---|---|---|
| `GET` | `/mandates` | List all 25 mandates |
| `GET` | `/mandates/:id` | Get single mandate |
| `POST` | `/mandates` | Create mandate |
| `PATCH` | `/mandates/:id` | Update mandate |
| `DELETE` | `/mandates/:id` | Delete mandate |

**Example response** `GET /mandates/m1`:
```json
{
  "id": "m1",
  "company": "Standard Bank",
  "positionTitle": "Senior UX Designer",
  "salaryRange": "R55,000 - R75,000",
  "postedDate": "2025-06-10",
  "status": "active",
  "applicantCount": 34,
  "transformationApplicants": 22,
  "postedOn": ["LinkedIn", "PNet"]
}
```

**Filter examples:**
```
GET /mandates?status=active
GET /mandates?company=FNB
GET /mandates?_sort=applicantCount&_order=desc
```

---

### CRM

| Method | Path | Description |
|---|---|---|
| `GET` | `/crm` | List all CRM records |
| `GET` | `/crm/:id` | Get single CRM record |
| `POST` | `/crm` | Create CRM record |
| `PATCH` | `/crm/:id` | Update CRM record |
| `DELETE` | `/crm/:id` | Delete CRM record |

**Statuses:** `HOT_LEAD` | `WARM_CONTACT` | `NEEDS_ATTENTION` | `COLD_LEAD`

**Example response** `GET /crm/crm1`:
```json
{
  "id": "crm1",
  "company": "Standard Bank",
  "status": "HOT_LEAD",
  "lastContact": "2025-06-16",
  "followUpDate": "2025-06-23",
  "notes": "MD keen on exclusive placement for CTO role...",
  "contactPerson": "James Nkosi",
  "contactEmail": "j.nkosi@standardbank.co.za",
  "dealValue": 2100000
}
```

**Filter examples:**
```
GET /crm?status=HOT_LEAD
GET /crm?status=NEEDS_ATTENTION
```

---

## Dashboard Endpoints

### GET `/dashboard/recruiter`

Returns aggregated data for the Recruiter dashboard.

```json
{
  "weeklyTasks": [...],
  "cvsDue": 14,
  "interviewsToSchedule": 8,
  "offerDeadlines": 3,
  "pipelineCounts": {
    "INBOUND": 245,
    "SCREENING": 128,
    "ASSESSMENT": 64,
    "INTERVIEW": 42,
    "SHORTLIST": 21,
    "OFFER": 9,
    "CLOSED": 187
  },
  "activeMandates": 103,
  "companies": 70,
  "recentPlacements": [...]
}
```

---

### GET `/dashboard/candidate`

Returns aggregated data for the Candidate dashboard.

```json
{
  "applicationCount": 7,
  "successfulApplications": 2,
  "applicationsInProgress": 4,
  "savedJobs": 12,
  "recommendedJobs": [...],
  "weeklyActivity": [...],
  "recruitersViewed": 6,
  "coursesCompleted": 3,
  "profileCompleteness": 78
}
```

---

### GET `/dashboard/exco`

Returns EXCO-level business intelligence data.

```json
{
  "repeatPlacementRate": 64,
  "referralRate": 38,
  "avgContractValue": 48500,
  "techMarketShare": 22,
  "clientChurn": 8,
  "recruiterRetention": 87,
  "costPerPlacement": 12400,
  "placementsYTD": 214,
  "revenueYTD": 10379000,
  "topRecruiters": [...],
  "topIndustries": [...],
  "revenueForecast": [...]
}
```

---

## /api/* prefix

All endpoints are also available under the `/api/` prefix:

```
POST /api/auth/login
GET  /api/candidates
GET  /api/jobs
...
```

---

## File Structure

```
mock/
├── db.json          ← Full seed dataset (all resources)
├── routes.json      ← URL rewrites (/api/* → /*)
├── server.js        ← Custom Express server with auth + middleware
└── README.md        ← This file
```

---

## Resetting Data

The database (`db.json`) is read fresh on each request for dashboard endpoints.  
For resource endpoints, json-server persists writes to `db.json`.  
To reset to the original seed data, restore `db.json` from git:

```bash
git checkout -- mock/db.json
```
