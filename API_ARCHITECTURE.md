# SkillsMine API Architecture Document

> **Purpose:** This document is the authoritative reference for the SkillsMine mock server (v2 contract). It covers all data models, every API endpoint (with request payloads, query parameters, response shapes, and error contracts), the authentication model, role-permission matrix, and the recruitment pipeline state machine. It reflects the code as implemented in `mock-server/`.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Base Configuration](#2-base-configuration)
3. [Authentication Model](#3-authentication-model)
4. [Roles & Permissions](#4-roles--permissions)
5. [Data Models](#5-data-models)
   - 5.1 [User](#51-user)
   - 5.2 [Candidate Profile](#52-candidate-profile)
   - 5.3 [Resume](#53-resume)
   - 5.4 [Skill](#54-skill)
   - 5.5 [Job](#55-job)
   - 5.6 [Application](#56-application)
   - 5.7 [Mandate](#57-mandate)
   - 5.8 [Recruiter](#58-recruiter)
   - 5.9 [CRM Client](#59-crm-client)
6. [Pipeline State Machine](#6-pipeline-state-machine)
7. [API Endpoints](#7-api-endpoints)
   - 7.1 [Auth](#71-auth)
   - 7.2 [Users / Profiles](#72-users--profiles)
   - 7.3 [Candidate](#73-candidate)
   - 7.4 [Jobs & Applications](#74-jobs--applications)
   - 7.5 [Opportunities (Public Cards)](#75-opportunities-public-cards)
   - 7.6 [Skills](#76-skills)
   - 7.7 [Recruiter (v2)](#77-recruiter-v2)
   - 7.8 [Mandates](#78-mandates)
   - 7.9 [Pipeline](#79-pipeline)
   - 7.10 [Recruiters (legacy ATS)](#710-recruiters-legacy-ats)
   - 7.11 [MANCO (Management)](#711-manco-management)
   - 7.12 [CRM](#712-crm)
8. [Error Contracts](#8-error-contracts)
9. [ID Conventions](#9-id-conventions)
10. [Enum Reference](#10-enum-reference)

---

## 1. System Overview

SkillsMine is a **single-domain, role-based recruitment platform**. The API is a RESTful JSON service serving four actor types — **candidates (JOB_SEEKER)**, **recruiters (RECRUITER)**, **MANCO** (management committee), and **admins (ADMIN)** — all under one domain.

```
Base URL:  http://localhost:4000
           or with optional prefix: http://localhost:4000/api/
```

The `/api/` prefix is stripped automatically for non-versioned routes. Versioned routes at `/api/v1/` and `/api/manco/` are **not** stripped and must be called with that prefix.

**Data stores** (loaded once at startup from `mock-server/data/`, mutated in-memory):

| Collection | File | Description |
|---|---|---|
| `users` | `data/users.json` | Auth accounts for all user types |
| `candidateProfiles` | `data/candidate-profiles.json` | Full candidate profile data |
| `resumes` | `data/resumes.json` | CV/resume records with preview & download URLs |
| `skills` | `data/skills.json` | Skill taxonomy (name + category) |
| `jobs` | `data/jobs.json` | Job postings |
| `applications` | `data/applications.json` | Job applications and pipeline state |
| `mandates` | `data/mandates.json` | Recruiter mandate records |
| `recruiters` | `data/recruiters.json` | Recruiter records with KPI metrics |
| `clients` | `data/crm-clients.json` | CRM client companies |

> **Note:** The old single `candidates` collection is replaced by two separate collections: `users` (auth) and `candidateProfiles` (profile data), linked by `userId`.

---

## 2. Base Configuration

| Setting | Value |
|---|---|
| **Port** | `4000` |
| **Simulated latency** | 300 – 900 ms per request |
| **Random 500 injection** | 2 % of authenticated requests |
| **CORS origins** | `*` |
| **CORS headers** | `Authorization, Content-Type` |
| **CORS methods** | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
| **Token transport** | `Authorization: Bearer <token>` |

---

## 3. Authentication Model

### Token Format

The server issues **mock JWTs** (HS256-shaped, base64url-encoded, not cryptographically verified). The token payload embeds the full user object (sub, userId, email, roles, recruiterId, etc.).

Token lifetime: **86,400 seconds (24 hours)**; shortened to **3,600 seconds (1 hour)** if `rememberMe` is not set.

Sessions are tracked in a server-side `Map<token → userObject>`. The production server should use stateless JWT validation instead.

### Public Paths (no `Authorization` header required)

| Path | Method(s) |
|---|---|
| `/auth/login` | `POST` |
| `/auth/register` | `POST` |
| `/auth/forgot-password` | `POST` |
| `/jobs` | `GET` |
| `/opportunities` | `GET` |
| `/skills/search` | `GET` |

All other paths require `Authorization: Bearer <token>`.

### Seed Test Accounts

All seed accounts use the password **`Password123`**.

| Email | Role | userId | recruiterId |
|---|---|---|---|
| `michael.smith@email.com` | `JOB_SEEKER` | `USR100001` | — |
| `ayesha.patel@email.com` | `JOB_SEEKER` | `USR100002` | — |
| `thabo.nkosi@email.com` | `JOB_SEEKER` | `USR100007` | — |
| `recruiter@skillsmine.com` | `RECRUITER` | `USR100003` | `r001` |
| `recruiter2@skillsmine.com` | `RECRUITER` | `USR100004` | `r002` |
| `manco@skillsmine.com` | `MANCO` | `USR100005` | — |
| `admin@skillsmine.com` | `ADMIN` | `USR100006` | — |

**Legacy aliases:** `candidate@skillsmine.com` → `USR100001`, `candidate2@skillsmine.com` → `USR100002`

---

## 4. Roles & Permissions

| Permission Token | Meaning |
|---|---|
| `VIEW_JOBS` | Browse the public job board |
| `APPLY_JOB` | Submit an application |
| `UPLOAD_CV` | Upload a CV document |
| `VIEW_DASHBOARD` | Access own dashboard |
| `MANDATE_CREATE` | Create a new job posting |
| `MANDATE_EDIT` | Edit an existing job posting |
| `PIPELINE_ADVANCE` | Move a candidate to the next pipeline stage |
| `CRM_EDIT` | Add CRM notes and change client status |
| `CANDIDATE_VIEW` | View candidate profiles (ATS access) |
| `PIPELINE_VIEW` | Read-only pipeline data (MANCO) |
| `REPORT_VIEW` | Access aggregated reports |
| `RECRUITER_VIEW` | View all recruiter records |
| `ALL` | Unrestricted (admin only) |

### Role → Permission Matrix

| Role | Permissions |
|---|---|
| `JOB_SEEKER` | `VIEW_JOBS`, `APPLY_JOB`, `UPLOAD_CV`, `VIEW_DASHBOARD` |
| `RECRUITER` | `MANDATE_CREATE`, `MANDATE_EDIT`, `PIPELINE_ADVANCE`, `CRM_EDIT`, `CANDIDATE_VIEW`, `VIEW_DASHBOARD` |
| `MANCO` | `PIPELINE_VIEW`, `REPORT_VIEW`, `RECRUITER_VIEW`, `VIEW_DASHBOARD` |
| `ADMIN` | `ALL` |

### Route-Level Access Guards

| Route prefix | Blocked roles | Guard location |
|---|---|---|
| `/api/v1/crm/*` | `JOB_SEEKER`, `candidate` | Middleware in `routes/crm.js` |
| `/api/v1/manco/*` | all except `MANCO`, `ADMIN` | Middleware in `routes/manco.js` |
| `POST /jobs` | `JOB_SEEKER`, `candidate` | Inline check in `routes/jobs.js` |

---

## 5. Data Models

### 5.1 User

The core auth record. Created via `POST /auth/register`. All user types share this schema.

| Field | Type | Required | Notes |
|---|---|---|---|
| `userId` | `string` | ✅ | Format: `USR` + 6-digit number, e.g. `USR100001` |
| `userType` | `string` | ✅ | `JOB_SEEKER` \| `RECRUITER` \| `MANCO` \| `ADMIN` |
| `firstName` | `string` | ✅ | |
| `lastName` | `string` | ✅ | |
| `email` | `string` | ✅ | Unique, lowercased |
| `mobileNumber` | `string` | — | E.164 format |
| `password` | `string` | ✅ | Plain-text in mock; **must be hashed in production** |
| `accountStatus` | `string` | ✅ | `ACTIVE` \| `PENDING_VERIFICATION` \| `SUSPENDED` |
| `profileCompleted` | `integer` | ✅ | Percentage 0–100; starts at `10` on registration |
| `roles` | `string[]` | ✅ | e.g. `["JOB_SEEKER"]` |
| `acceptTerms` | `boolean` | — | |
| `acceptPrivacyPolicy` | `boolean` | — | |
| `recruiterId` | `string` | — | FK → Recruiter.recruiterId (RECRUITER users only) |
| `createdAt` | `string` | ✅ | ISO 8601 timestamp |

#### Immutable Fields

`userId`, `userType`, `createdAt`, `roles`

---

### 5.2 Candidate Profile

Extended profile data for a `JOB_SEEKER` user. Linked to `users` via `userId`.

| Field | Type | Notes |
|---|---|---|
| `candidateId` | `string` | Format: `CAND` + 6-digit number, e.g. `CAND100001` |
| `userId` | `string` | FK → User.userId |
| `personalDetails` | `PersonalDetails` | See sub-schema below |
| `desiredJob` | `DesiredJob` | See sub-schema below |
| `education` | `Education[]` | See sub-schema below |
| `experience` | `Experience[]` | See sub-schema below |
| `skills` | `string[]` | Array of skill name strings |
| `languages` | `Language[]` | See sub-schema below |

#### PersonalDetails Sub-Schema

| Field | Type |
|---|---|
| `firstName` | `string` |
| `lastName` | `string` |
| `email` | `string` |
| `mobileNumber` | `string` |
| `location` | `string` |
| `nationality` | `string` |
| `idNumber` | `string` |
| `eeStatus` | `string` |
| `profileImageUrl` | `string` |
| `thumbnailUrl` | `string` |
| `linkedinUrl` | `string` |
| `portfolioUrl` | `string` |

#### DesiredJob Sub-Schema

| Field | Type |
|---|---|
| `jobTitle` | `string` |
| `industry` | `string` |
| `workType` | `string` |
| `employmentType` | `string` |
| `salaryExpectation` | `integer` |
| `availableFrom` | `string` |

#### Education Sub-Schema

| Field | Type | Required |
|---|---|---|
| `institution` | `string` | ✅ |
| `qualification` | `string` | ✅ |
| `year` | `integer` | ✅ |

#### Experience Sub-Schema

| Field | Type | Required |
|---|---|---|
| `company` | `string` | ✅ |
| `jobTitle` | `string` | ✅ |
| `startDate` | `string` | ✅ | Format: `YYYY-MM` |
| `endDate` | `string` | ✅ | Format: `YYYY-MM` or `"Present"` |
| `responsibilities` | `string` | — |

#### Language Sub-Schema

| Field | Type |
|---|---|
| `language` | `string` |
| `proficiency` | `string` | e.g. `"Native"`, `"Fluent"`, `"Conversational"` |

---

### 5.3 Resume

A candidate's generated CV record, with CDN-hosted preview/download links.

| Field | Type | Notes |
|---|---|---|
| `resumeId` | `string` | Format: `RES` + 6-digit number, e.g. `RES100001` |
| `userId` | `string` | FK → User.userId |
| `candidateId` | `string` | FK → CandidateProfile.candidateId |
| `title` | `string` | Display title, e.g. `"Michael Smith – Senior Software Engineer CV"` |
| `status` | `string` | `PUBLISHED` \| `DRAFT` |
| `previewUrl` | `string` | CDN URL to PDF preview |
| `downloadUrl` | `string` | CDN URL to downloadable PDF |
| `summary` | `string` | Career summary text |
| `createdAt` | `string` | ISO 8601 |
| `updatedAt` | `string` | ISO 8601 |

---

### 5.4 Skill

A taxonomy entry for the skills autocomplete system.

| Field | Type | Notes |
|---|---|---|
| `skillId` | `string` | Format: `SKL` + 3-digit number, e.g. `SKL001` |
| `name` | `string` | Skill display name, e.g. `"React"` |
| `category` | `string` | e.g. `"Frontend"`, `"Backend"`, `"Cloud"`, `"DevOps"`, `"Database"`, `"Languages"` |

---

### 5.5 Job

A job posting managed by a recruiter on behalf of a client company.

| Field | Type | Required | Notes |
|---|---|---|---|
| `jobId` | `string` | ✅ | Format: `j` + 3-digit zero-padded, e.g. `j001` |
| `title` | `string` | ✅ | Job title |
| `company` | `string` | ✅ | Hiring company name |
| `location` | `string` | — | e.g. `"Cape Town, Western Cape"` |
| `industry` | `string` | — | e.g. `"Financial Services"`, `"Technology"` |
| `employmentType` | `string` | ✅ | `"Permanent"` \| `"Contract"` |
| `workType` | `string` | ✅ | `"Remote"` \| `"Hybrid"` \| `"On-site"` |
| `salaryMin` | `integer` | — | Monthly gross in ZAR |
| `salaryMax` | `integer` | — | Monthly gross in ZAR |
| `salaryRange` | `string` | ✅ | Auto-derived: `"R<min> – R<max>"` or `"Market related"` |
| `description` | `string` | — | Full role description |
| `requirements` | `string[]` | — | |
| `skills` | `string[]` | — | Required skill strings |
| `status` | `string` | ✅ | `"Open"` \| `"Closed"` \| `"Draft"` |
| `applicationCount` | `integer` | ✅ | Incremented on each application |
| `postedDate` | `string` | ✅ | Format: `YYYY-MM-DD` |
| `recruiterId` | `string` | — | FK → Recruiter.recruiterId |

---

### 5.6 Application

Tracks a candidate's application to a specific job through the pipeline.

| Field | Type | Required | Notes |
|---|---|---|---|
| `applicationId` | `string` | ✅ | Format: `APP` + last-8-digits of timestamp |
| `userId` | `string` | — | FK → User.userId (null for guests) |
| `candidateId` | `string` | ✅ | FK → CandidateProfile.candidateId or `guest-<timestamp>` |
| `jobId` | `string` | ✅ | FK → Job.jobId |
| `jobTitle` | `string` | — | Denormalized |
| `company` | `string` | — | Denormalized |
| `cvId` | `string` | — | FK → Resume.resumeId |
| `sourceChannel` | `string` | — | e.g. `"direct"`, `"referral"` |
| `currentStage` | `string` | ✅ | Pipeline stage; starts at `"Inbound"` |
| `appliedDate` | `string` | ✅ | Format: `YYYY-MM-DD` |
| `matchScore` | `integer` | ✅ | 65–95, computed at application time |
| `isGuest` | `boolean` | ✅ | `true` if applied without an account |
| `updatedAt` | `string` | — | ISO 8601; updated on each stage transition |

---

### 5.7 Mandate

A recruiter's formal instruction to fill a specific role for a client. Linked to a job posting.

| Field | Type | Notes |
|---|---|---|
| `mandateId` | `string` | Format: `MND` + 3-digit number, e.g. `MND001` |
| `jobId` | `string` | FK → Job.jobId |
| `title` | `string` | Role title |
| `client` | `string` | Client company name |
| `clientId` | `string` | FK → CRMClient.clientId |
| `recruiterId` | `string` | FK → Recruiter.recruiterId |
| `recruiterName` | `string` | Denormalized |
| `status` | `string` | `"ACTIVE"` \| `"CLOSED"` \| `"ON_HOLD"` |
| `priority` | `string` | `"HIGH"` \| `"MEDIUM"` \| `"LOW"` |
| `openDate` | `string` | Format: `YYYY-MM-DD` |
| `targetCloseDate` | `string` | Format: `YYYY-MM-DD` |
| `salaryBand` | `string` | Display string |
| `location` | `string` | |
| `workType` | `string` | |
| `employmentType` | `string` | |
| `eeTarget` | `boolean` | Whether EE compliance is required |
| `eeRequirement` | `string` | Description of EE requirement |
| `skills` | `string[]` | Required skills |
| `applicantCount` | `integer` | Total applicants |
| `shortlistedCount` | `integer` | Candidates shortlisted |
| `interviewCount` | `integer` | Candidates at interview stage |
| `pipeline` | `object` | Stage-keyed counts, e.g. `{ "Inbound": 12, "Screening": 8, … }` |

---

### 5.8 Recruiter

A recruiter managing mandates and the candidate pipeline.

| Field | Type | Required | Notes |
|---|---|---|---|
| `recruiterId` | `string` | ✅ | Format: `r` + 3-digit zero-padded, e.g. `r001` |
| `fullName` | `string` | ✅ | |
| `email` | `string` | ✅ | |
| `phone` | `string` | — | |
| `agency` | `string` | — | Default: `"SkillsMine"` |
| `specialisation` | `string[]` | — | e.g. `["Technology", "Cloud", "DevOps"]` |
| `location` | `string` | — | |
| `role` | `string` | — | Always `"recruiter"` |
| `registeredAt` | `string` | — | ISO 8601 |
| `metrics` | `RecruiterMetrics` | — | See sub-schema below |

#### RecruiterMetrics Sub-Schema

| Field | Type | Notes |
|---|---|---|
| `placements` | `integer` | Total successful placements |
| `activeRoles` | `integer` | Current open mandates |
| `candidates` | `integer` | Candidates in database |
| `conversionRate` | `number` | Percentage: placed / total submitted |
| `avgDaysToPlace` | `integer` | Average days from application to placement |
| `revenueYTD` | `integer` | Year-to-date revenue in ZAR |

---

### 5.9 CRM Client

A client company in the CRM pipeline.

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientId` | `string` | ✅ | Format: `cl` + 3-digit zero-padded, e.g. `cl001` |
| `company` | `string` | ✅ | Company name |
| `status` | `string` | ✅ | `"hot_lead"` \| `"warm_contact"` \| `"cold_lead"` \| `"needs_attention"` |
| `contactPerson` | `string` | — | Primary contact name |
| `contactEmail` | `string` | — | |
| `contactPhone` | `string` | — | |
| `industry` | `string` | — | |
| `lastContactDays` | `integer` | — | Days since last contact |
| `overdueDays` | `integer` | — | Days overdue for follow-up; `0` if not overdue |
| `dealValue` | `integer` | — | Estimated deal value in ZAR |
| `mandatesOpen` | `integer` | — | Number of open mandates with this client |
| `notes` | `CRMNote[]` | — | See sub-schema below |

#### CRMNote Sub-Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `noteId` | `string` | ✅ | Format: `note-<timestamp>` |
| `note` | `string` | ✅ | Note body text |
| `noteType` | `string` | — | e.g. `"GENERAL"`, `"FOLLOW_UP"`, `"MEETING"` |
| `addedBy` | `string` | ✅ | Recruiter's full name |
| `addedAt` | `string` | ✅ | ISO 8601 timestamp |

#### CRM Status Descriptions

| Status | Meaning |
|---|---|
| `hot_lead` | Active mandate underway, frequent contact (< 5 days) |
| `warm_contact` | Engaged, mandate in discussion (6–14 days) |
| `needs_attention` | Overdue for contact (15–30 days), risk of losing |
| `cold_lead` | No active mandate, dormant (30+ days) |

---

## 6. Pipeline State Machine

### v2 Stages (used by recruiter dashboard, mandates, and manual stage updates)

Applications progress through these **7 ordered stages**:

```
Inbound → Screening → Shortlisted → Interview → Offer → Placed → Closed
```

### Checklist-Gated Transitions (used by `PATCH /api/v1/pipeline/:pipelineId/stage`)

The pipeline endpoint enforces strict one-step transitions with required checklist items:

| From | To | Required Checklist Items |
|---|---|---|
| `Inbound` | `Screening` | `cvReceived` |
| `Screening` | `Assessment` | `screeningNotesAdded`, `cvVerified` |
| `Assessment` | `Interview` | `assessmentScoreRecorded`, `assessmentPassed` |
| `Interview` | `Shortlisted` | `interviewNotesAdded`, `interviewCompleted` |

- Stages beyond `Interview` (Shortlisted, Offer, Placed, Closed) cannot be advanced via this endpoint.
- The manual stage update (`PUT /recruiter/applications/:applicationId/stage`) bypasses checklist enforcement.
- `Placed` represents a successful placement for reporting purposes.
- Once at `Closed`, no further advancement is allowed.

---

## 7. API Endpoints

> **Convention:** `🔓 Public` = no token required. `🔐 Auth` = Bearer token required. Role restrictions noted per endpoint.

---

### 7.1 Auth

**Base path:** `/auth`

---

#### `POST /auth/register` 🔓 Public

Register a new user account (any user type).

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `userType` | `string` | — | Default: `"JOB_SEEKER"` |
| `firstName` | `string` | ✅ | |
| `lastName` | `string` | ✅ | |
| `email` | `string` | ✅ | |
| `mobileNumber` | `string` | — | |
| `password` | `string` | ✅ | |
| `confirmPassword` | `string` | ✅ | Must match `password` |
| `acceptTerms` | `boolean` | — | |
| `acceptPrivacyPolicy` | `boolean` | — | |

**Success Response `201`:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Registration completed successfully.",
  "data": {
    "userId": "USR100008",
    "email": "user@example.com",
    "accountStatus": "PENDING_VERIFICATION"
  }
}
```

**Errors:** `400` (missing required fields or passwords do not match), `409` (email already registered).

---

#### `POST /auth/login` 🔓 Public

Authenticate any user type. Returns access and refresh tokens.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` | `string` | ✅ | Email address |
| `password` | `string` | ✅ | |
| `rememberMe` | `boolean` | — | If `true`, `expiresIn` = 86400; otherwise 3600 |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "expiresIn": 86400,
    "profileCompleted": 82,
    "roles": ["JOB_SEEKER"]
  }
}
```

**Errors:** `400` (missing fields), `401` (invalid credentials).

---

#### `POST /auth/forgot-password` 🔓 Public

Trigger a password reset email (mocked — always succeeds).

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `email` | `string` | ✅ |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "If the email address is registered, a password reset link has been sent.",
  "data": {
    "email": "user@example.com",
    "resetLinkSent": true,
    "expiresInMinutes": 30
  }
}
```

---

#### `POST /auth/change-password` 🔐 Auth (any role)

Change the authenticated user's password.

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `currentPassword` | `string` | ✅ |
| `newPassword` | `string` | ✅ | Min 8 characters |
| `confirmNewPassword` | `string` | ✅ | Must match `newPassword` |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password changed successfully.",
  "data": { "changedAt": "2024-11-15T10:00:00Z" }
}
```

**Errors:** `400` (missing fields, passwords do not match, or password too short).

---

#### `POST /auth/logout` 🔐 Auth (any role)

Invalidates the current session token.

**Headers required:** `Authorization: Bearer <token>`

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logged out successfully.",
  "data": null
}
```

---

### 7.2 Users / Profiles

**Base path:** `/users`

---

#### `GET /users/:userId` 🔐 Auth (any role)

Retrieve a user's full profile, merging `users` auth data with their `candidateProfiles` record.

**Success Response `200`:**

```json
{
  "status": "SUCCESS",
  "data": {
    "userId": "USR100001",
    "savedJobs": [],
    "personalDetails": {
      "userId": "USR100001",
      "firstName": "Michael",
      "lastName": "Smith",
      "email": "michael.smith@email.com",
      "mobileNumber": "+27821234567",
      "location": "Johannesburg, Gauteng",
      "nationality": "South African",
      "idNumber": "...",
      "eeStatus": "African Male",
      "profileImageUrl": "https://mock-cdn.skillsmine.com/...",
      "thumbnailUrl": "https://mock-cdn.skillsmine.com/...",
      "linkedinUrl": "https://linkedin.com/in/...",
      "portfolioUrl": ""
    },
    "desiredJob": { "jobTitle": "Senior Software Engineer", "...": "..." },
    "education": [ /* Education[] */ ],
    "experience": [ /* Experience[] */ ],
    "authentication": {
      "password": "...",
      "provider": "LOCAL",
      "accountStatus": "ACTIVE"
    }
  }
}
```

**Errors:** `404` (user not found).

---

#### `PUT /users/:userId` 🔐 Auth (any role)

Partial update of a user's profile. Immutable fields (`userId`, `userType`, `createdAt`, `roles`) are silently ignored.

**Request Body:** Any subset of updatable user fields. Nested objects update via deep merge:

| Top-level key | Behaviour |
|---|---|
| `personalDetails` | Deep-merged into `candidateProfiles[].personalDetails` |
| `desiredJob` | Deep-merged into `candidateProfiles[].desiredJob` |
| `education` | Full replacement of `candidateProfiles[].education` array |
| `experience` | Full replacement of `candidateProfiles[].experience` array |
| Any other field | Merged into `users[]` record |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile updated successfully.",
  "data": {
    "userId": "USR100001",
    "updatedAt": "2024-11-15T10:00:00Z"
  }
}
```

**Errors:** `404` (user not found).

---

#### `POST /users/:userId/profile-photo` 🔐 Auth (any role)

Upload a profile photo (mocked — returns generated CDN URLs).

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile photo uploaded successfully.",
  "data": {
    "profileImageUrl": "https://mock-cdn.skillsmine.com/profiles/USR100001/photo.jpg",
    "thumbnailUrl": "https://mock-cdn.skillsmine.com/profiles/USR100001/thumb.jpg"
  }
}
```

**Errors:** `404` (user not found).

---

#### `DELETE /users/:userId/profile-photo` 🔐 Auth (any role)

Remove a user's profile photo (clears `profileImageUrl` and `thumbnailUrl`).

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile photo removed successfully.",
  "data": null
}
```

**Errors:** `404` (user not found).

---

### 7.3 Candidate

**Base paths:** `/candidate`, `/applications`, `/api/v1/candidates`

---

#### `GET /candidate/dashboard` 🔐 Auth (`JOB_SEEKER`)

Candidate home dashboard with application summary, activity chart, quick links, and recent applications.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Dashboard data retrieved.",
  "data": {
    "summary": {
      "profileCompleted": 82,
      "totalApplications": 4,
      "activeApplications": 3,
      "savedJobs": 5,
      "profileViews": 12
    },
    "activity": [
      { "day": "Mon", "applications": 1, "profileViews": 3 },
      { "day": "Tue", "applications": 0, "profileViews": 5 }
    ],
    "applications": [
      {
        "applicationId": "APP12345678",
        "jobTitle": "Senior React Developer",
        "company": "Standard Bank",
        "currentStage": "Interview",
        "appliedDate": "2024-10-16",
        "matchScore": 88
      }
    ],
    "quickLinks": [
      { "label": "Build My CV", "path": "/candidate/buildmycv" },
      { "label": "Browse Jobs", "path": "/jobs" },
      { "label": "View Applications", "path": "/candidate/applications" },
      { "label": "Update Profile", "path": "/users/USR100001" }
    ]
  }
}
```

---

#### `POST /candidate/buildmycv` 🔐 Auth (`JOB_SEEKER`)

Initialise or reload the CV builder, pre-populating all steps from the candidate's existing profile and resume data.

**CV Builder Steps (ordered):**

| Step | Description |
|---|---|
| `personalDetails` | Name, contact, location, EE status, social links |
| `careerHistory` | Work experience entries |
| `skills` | Skill tags array |
| `education` | Education entries |
| `languages` | Language + proficiency pairs |
| `summary` | Career summary paragraph |
| `preferences` | Desired job preferences |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "CV builder data loaded.",
  "data": {
    "resumeId": "RES100001",
    "currentStep": "personalDetails",
    "completedSteps": ["personalDetails", "careerHistory", "education"],
    "steps": ["personalDetails", "careerHistory", "skills", "education", "languages", "summary", "preferences"],
    "personalDetails": { "...": "..." },
    "careerHistory": [ "..." ],
    "skills": ["React", "TypeScript"],
    "education": [ "..." ],
    "languages": [ "..." ],
    "summary": "Experienced software developer...",
    "desiredJob": { "...": "..." }
  }
}
```

---

#### `GET /candidate/:resumeId/preview` 🔐 Auth (`JOB_SEEKER`)

Get a time-limited preview URL for a candidate's resume PDF.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Preview URL generated.",
  "data": {
    "resumeId": "RES100001",
    "previewUrl": "https://mock-cdn.skillsmine.com/resumes/RES100001/preview.pdf",
    "generatedAt": "2024-11-15T10:00:00Z",
    "expiresIn": 3600
  }
}
```

**Errors:** `404` (resume not found).

---

#### `GET /candidate/:resumeId/download` 🔐 Auth (`JOB_SEEKER`)

Get a time-limited download URL for a candidate's resume PDF.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Download URL generated.",
  "data": {
    "resumeId": "RES100001",
    "downloadUrl": "https://mock-cdn.skillsmine.com/resumes/RES100001/download.pdf",
    "filename": "Michael-Smith-Senior-Software-Engineer-CV.pdf",
    "generatedAt": "2024-11-15T10:00:00Z",
    "expiresIn": 900
  }
}
```

**Errors:** `404` (resume not found).

---

#### `GET /candidate/:candidateId/recommended-jobs` 🔐 Auth (`JOB_SEEKER`)

AI-style job recommendations for a candidate, ranked by skill overlap match score.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Recommended jobs retrieved.",
  "data": {
    "candidateId": "CAND100001",
    "jobs": [
      {
        "jobId": "j001",
        "title": "Senior React Developer",
        "company": "Standard Bank",
        "location": "Johannesburg, Gauteng",
        "workType": "Hybrid",
        "salaryRange": "R70 000 – R95 000",
        "matchScore": 91,
        "skills": ["React", "TypeScript", "Redux"],
        "postedDate": "2024-10-15"
      }
    ],
    "total": 6
  }
}
```

---

#### `POST /applications/:applicationId/cv/upload` 🔐 Auth (any role)

Upload and parse a CV for a specific application (mocked OCR extraction).

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "CV uploaded and parsed successfully.",
  "data": {
    "applicationId": "APP12345678",
    "documentId": "DOC54321",
    "extractionStatus": "COMPLETE",
    "personalDetails": {
      "firstName": "Michael",
      "lastName": "Smith",
      "email": "michael.smith@email.com",
      "mobileNumber": "+27821234567",
      "location": "Johannesburg, Gauteng",
      "linkedinUrl": "https://linkedin.com/in/michael-smith-dev"
    },
    "careerHistory": [ { "company": "Accenture", "jobTitle": "Senior Software Engineer", "startDate": "2020-03", "endDate": "Present", "responsibilities": "..." } ],
    "skills": ["React", "Node.js", "TypeScript", "AWS", "PostgreSQL", "GraphQL"],
    "education": [ { "institution": "University of the Witwatersrand", "qualification": "BSc Computer Science", "year": 2016 } ],
    "languages": [ { "language": "English", "proficiency": "Native" } ],
    "validation": { "isComplete": true, "missingFields": [], "warnings": [] },
    "uploadedAt": "2024-11-15T10:00:00Z"
  }
}
```

---

### 7.4 Jobs & Applications

**Base path:** `/jobs`

---

#### `GET /jobs` 🔓 Public

Browse the job board. Only `Open` jobs are returned unless `status` is explicitly set.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | `string` | `Open` \| `Closed` \| `Draft` (default: `Open`) |
| `industry` | `string` | Substring match on `industry` |
| `location` | `string` | Substring match on `location` |
| `q` | `string` | Full-text on `title` and `company` |
| `showEmployerDetails` | `boolean` | Include employer detail flag in response |
| `page` | `integer` | Default: `1` |
| `limit` | `integer` | Default: `10` |

**Success Response `200`:**

```json
{
  "status": "SUCCESS",
  "data": {
    "showEmployerDetails": false,
    "jobs": [ /* Job[] */ ],
    "pagination": { "page": 1, "pageSize": 10, "total": 25, "totalPages": 3 }
  }
}
```

---

#### `GET /jobs/:jobId` 🔓 Public

Retrieve a single job's full details.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Job retrieved.",
  "data": { /* Full Job object */ }
}
```

**Errors:** `404`.

---

#### `POST /jobs/:jobId/save` 🔐 Auth (any role)

Bookmark/save a job for the authenticated user.

**Success Response `200`:** `{ "success": true }`

**Errors:** `404` (job not found).

---

#### `POST /jobs/:jobId/apply` 🔓 Public (guest) / 🔐 Auth (`JOB_SEEKER`)

Submit a job application. Authenticated users are resolved from the token; guests supply a `candidateId`.

**Request Body:**

| Field | Type | Notes |
|---|---|---|
| `candidateId` | `string` | Optional for authenticated users |
| `cvId` | `string` | Resume ID to attach |
| `sourceChannel` | `string` | Default: `"direct"` |

**Success Response `201`:**

```json
{
  "applicationId": "APP87654321",
  "matchScore": 79,
  "status": "submitted",
  "nextStep": "view_dashboard"
}
```

`nextStep` is `"account_prompt"` for guest applications.

**Errors:** `404` (job not found), `422` (job is not `Open`).

---

#### `POST /jobs` 🔐 Auth (`RECRUITER`, `ADMIN`)

Create a new job posting. Created with `status: "Draft"`.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | `string` | ✅ | |
| `company` | `string` | ✅ | |
| `location` | `string` | — | |
| `industry` | `string` | — | |
| `employmentType` | `string` | — | Default: `"Permanent"` |
| `workType` | `string` | — | Default: `"Hybrid"` |
| `salaryMin` | `integer` | — | |
| `salaryMax` | `integer` | — | |
| `description` | `string` | — | |
| `skills` | `string[]` | — | Default: `[]` |
| `requirements` | `string[]` | — | Default: `[]` |

**Success Response `201`:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Job posting created successfully.",
  "data": { /* Full Job object with generated jobId, status: "Draft", applicationCount: 0 */ }
}
```

**Errors:** `400` (missing `title` or `company`), `403` (non-recruiter role).

---

### 7.5 Opportunities (Public Cards)

**Base path:** `/opportunities`

---

#### `GET /opportunities` 🔓 Public

Returns open jobs formatted as marketing display cards for the website/landing page. Only `Open` jobs. Max 50 results.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `q` | `string` | Full-text on `title`, `company`, `description` |
| `tag` | `string` | Match any auto-generated tag (industry, city, `workType`) |
| `workType` | `string` | `Remote` \| `Hybrid` \| `On-site` (exact) |
| `employmentType` | `string` | `Permanent` \| `Contract` (exact) |
| `limit` | `integer` | Max results (default: `10`, max: `50`) |

**Success Response `200`:**

```json
{
  "opportunities": [
    {
      "id": "j001",
      "title": "Senior React Developer",
      "tags": ["Financial Services", "Johannesburg", "Hybrid"],
      "description": "Build and maintain high-performance React applications...",
      "employerName": "Standard Bank",
      "salaryRange": "R70 000 – R95 000",
      "workType": "Hybrid",
      "employmentType": "Permanent",
      "employerOrbColor": "#0a3d6b",
      "employerOrbGlow": "rgba(10, 61, 107, 0.35)",
      "blurredEmployer": false,
      "tallCard": true
    }
  ],
  "total": 25,
  "shown": 10
}
```

> `employerOrbColor`, `employerOrbGlow`, `blurredEmployer`, and `tallCard` are UI display hints seeded per job ID.

---

### 7.6 Skills

**Base path:** `/skills`

---

#### `GET /skills/search` 🔓 Public

Search the skill taxonomy by keyword against skill name or category.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `keyword` | `string` | Substring match on `name` or `category` |
| `limit` | `integer` | Max results (default: `20`, max: `100`) |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Skills retrieved successfully.",
  "data": {
    "skills": [
      { "skillId": "SKL001", "name": "React", "category": "Frontend" },
      { "skillId": "SKL005", "name": "TypeScript", "category": "Languages" }
    ],
    "total": 42,
    "shown": 20
  }
}
```

---

### 7.7 Recruiter (v2)

**Base path:** `/recruiter`

These routes provide the v2 recruiter experience driven by the `mandates` dataset.

---

#### `GET /recruiter/dashboard` 🔐 Auth (`RECRUITER`, `ADMIN`)

Recruiter home dashboard showing the weekly to-do list and live pipeline counts from their assigned mandates.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Recruiter dashboard retrieved.",
  "data": {
    "weeklyTodo": [
      { "id": "t1", "task": "Review CVs for Standard Bank Senior React Developer mandate", "due": "2024-11-16", "priority": "HIGH", "mandateId": "MND001" },
      { "id": "t3", "task": "Follow up on IBM Cloud Architect offer – deadline approaching", "due": "2024-11-16", "priority": "CRITICAL", "mandateId": "MND004" }
    ],
    "pipeline": [
      { "stage": "Inbound", "count": 12 },
      { "stage": "Screening", "count": 8 },
      { "stage": "Shortlisted", "count": 5 },
      { "stage": "Interview", "count": 2 },
      { "stage": "Offer", "count": 1 },
      { "stage": "Placed", "count": 0 },
      { "stage": "Closed", "count": 0 }
    ]
  }
}
```

---

#### `GET /recruiter/mandates` 🔐 Auth (`RECRUITER`, `ADMIN`)

List all mandates assigned to the authenticated recruiter, with pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | `string` | Filter by `ACTIVE` \| `CLOSED` \| `ON_HOLD` (case-insensitive) |
| `page` | `integer` | Default: `1` |
| `limit` | `integer` | Default: `10` |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Mandates retrieved.",
  "data": {
    "mandates": [ /* Mandate[] */ ],
    "pagination": { "page": 1, "pageSize": 10, "total": 4, "totalPages": 1 }
  }
}
```

---

#### `PUT /recruiter/applications/:applicationId/stage` 🔐 Auth (`RECRUITER`, `ADMIN`)

Manually advance or update a candidate's pipeline stage. Does **not** enforce checklist — use `PATCH /api/v1/pipeline/:pipelineId/stage` for checklist-gated transitions.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `stage` | `string` | ✅ | Target pipeline stage |
| `notes` | `string` | — | Optional notes on the stage change |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Candidate moved from Screening to Shortlisted.",
  "data": {
    "applicationId": "APP12345678",
    "previousStage": "Screening",
    "currentStage": "Shortlisted",
    "notes": "Strong CV, recommend shortlist.",
    "updatedAt": "2024-11-15T10:00:00Z"
  }
}
```

**Errors:** `400` (`stage` missing), `404` (application not found).

---

#### `GET /recruiter/candidates/search` 🔐 Auth (`RECRUITER`, `ADMIN`)

ATS candidate search against the `candidateProfiles` dataset with skill and EE status filtering.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `skill` | `string` | Substring match against candidate's skills array |
| `eeStatus` | `string` | Substring match on `personalDetails.eeStatus` |
| `page` | `integer` | Default: `1` |
| `limit` | `integer` | Default: `20` |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Candidates retrieved.",
  "data": {
    "candidates": [
      {
        "candidateId": "CAND100001",
        "userId": "USR100001",
        "firstName": "Michael",
        "lastName": "Smith",
        "email": "michael.smith@email.com",
        "location": "Johannesburg, Gauteng",
        "eeStatus": "African Male",
        "currentTitle": "Senior Software Engineer",
        "skills": ["React", "Node.js", "TypeScript"],
        "profileCompleted": 82,
        "matchScore": 87
      }
    ],
    "pagination": { "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 }
  }
}
```

---

### 7.8 Mandates

**Base path:** `/mandates`

---

#### `GET /mandates/:mandateId` 🔐 Auth (`RECRUITER`, `ADMIN`)

Retrieve full mandate detail including linked job and applicant pipeline summary.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Mandate retrieved.",
  "data": {
    "mandateId": "MND001",
    "jobId": "j001",
    "title": "Senior React Developer",
    "client": "Standard Bank",
    "status": "ACTIVE",
    "...": "all other Mandate fields",
    "jobDetails": { /* full Job object or null */ },
    "applicants": [
      {
        "applicationId": "APP12345678",
        "candidateId": "CAND100001",
        "currentStage": "Interview",
        "matchScore": 88,
        "appliedDate": "2024-10-16"
      }
    ]
  }
}
```

**Errors:** `404` (mandate not found).

---

#### `GET /applications/:applicationId/stage-transition` 🔐 Auth (`RECRUITER`, `ADMIN`)

Returns the full stage history for an application, with per-stage entry/exit timestamps and completion flags.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Stage transition history retrieved.",
  "data": {
    "applicationId": "APP12345678",
    "candidateId": "CAND100001",
    "jobId": "j001",
    "jobTitle": "Senior React Developer",
    "company": "Standard Bank",
    "currentStage": "Interview",
    "matchScore": 88,
    "stageHistory": {
      "Inbound":    { "enteredAt": "2024-10-16T08:00:00Z", "exitedAt": "2024-10-16T14:00:00Z", "notes": "Application received.", "completed": true },
      "Screening":  { "enteredAt": "2024-10-16T14:00:00Z", "exitedAt": "2024-10-16T16:00:00Z", "notes": "Phone screen completed.", "completed": true },
      "Shortlisted":{ "enteredAt": "2024-10-21T08:00:00Z", "exitedAt": null, "notes": "", "completed": true },
      "Interview":  { "enteredAt": "2024-10-23T08:00:00Z", "exitedAt": null, "notes": "", "completed": false },
      "Offer":      { "enteredAt": null, "exitedAt": null, "notes": "", "completed": false },
      "Placed":     { "enteredAt": null, "exitedAt": null, "notes": "", "completed": false },
      "Closed":     { "enteredAt": null, "exitedAt": null, "notes": "", "completed": false }
    }
  }
}
```

**Errors:** `404` (application not found).

---

### 7.9 Pipeline

**Base path:** `/api/v1/pipeline`

---

#### `PATCH /api/v1/pipeline/:pipelineId/stage` 🔐 Auth (`RECRUITER`, `ADMIN`)

Advance a candidate's application stage with checklist validation. `pipelineId` maps to `applicationId`.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `targetStage` | `string` | ✅ | Must be the valid next stage |
| `checklist` | `object` | ✅ | Key-value map of checklist item names to boolean |

**Valid transitions and required checklist items:**

| From | To | Required Keys in `checklist` |
|---|---|---|
| `Inbound` | `Screening` | `cvReceived: true` |
| `Screening` | `Assessment` | `screeningNotesAdded: true`, `cvVerified: true` |
| `Assessment` | `Interview` | `assessmentScoreRecorded: true`, `assessmentPassed: true` |
| `Interview` | `Shortlisted` | `interviewNotesAdded: true`, `interviewCompleted: true` |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Candidate advanced from Inbound to Screening.",
  "data": {
    "pipelineId": "APP12345678",
    "applicationId": "APP12345678",
    "candidateId": "CAND100001",
    "jobId": "j001",
    "previousStage": "Inbound",
    "currentStage": "Screening",
    "checklistItems": { "cvReceived": true },
    "updatedAt": "2024-11-15T10:00:00Z",
    "nextTransition": { "to": "Assessment", "requiredChecklist": ["screeningNotesAdded", "cvVerified"] }
  }
}
```

**Errors:**

| Status | Condition |
|---|---|
| `400` | `targetStage` missing |
| `404` | Application not found |
| `422` | Current stage cannot be advanced further (beyond `Interview`) |
| `422` | `targetStage` is not the valid next stage — returns `allowedTransition` |
| `422` | Checklist incomplete — returns `missingItems` array |

---

#### `GET /api/v1/candidates/:candidateId/profile` 🔐 Auth (`RECRUITER`, `ADMIN`)

Full candidate profile as seen from the recruiter ATS, combining profile, resume, and all applications.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Candidate profile retrieved.",
  "data": {
    "candidateId": "CAND100001",
    "userId": "USR100001",
    "accountStatus": "ACTIVE",
    "profileCompleted": 82,
    "personalDetails": { "...": "..." },
    "desiredJob": { "...": "..." },
    "education": [ "..." ],
    "experience": [ "..." ],
    "skills": ["React", "TypeScript"],
    "languages": [ "..." ],
    "resume": {
      "resumeId": "RES100001",
      "previewUrl": "https://mock-cdn.skillsmine.com/...",
      "downloadUrl": "https://mock-cdn.skillsmine.com/...",
      "updatedAt": "2024-11-01T14:30:00Z"
    },
    "applications": [
      {
        "applicationId": "APP12345678",
        "jobId": "j001",
        "jobTitle": "Senior React Developer",
        "company": "Standard Bank",
        "currentStage": "Interview",
        "appliedDate": "2024-10-16",
        "matchScore": 88
      }
    ],
    "matchScore": 87
  }
}
```

**Errors:** `404` (candidate not found).

---

### 7.10 Recruiters (Legacy ATS)

**Base path:** `/recruiters`

These routes serve the legacy ATS views, backed by the `candidates` and `jobs` datasets.

---

#### `POST /recruiters/register` 🔓 Public

Register a new recruiter account and receive an access token immediately.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `fullName` | `string` | ✅ | |
| `email` | `string` | ✅ | |
| `phone` | `string` | — | |
| `agency` | `string` | — | Default: `"SkillsMine"` |
| `password` | `string` | ✅ | |

**Success Response `201`:**

```json
{
  "recruiterId": "r003",
  "token": "<jwt>",
  "message": "Recruiter registered successfully."
}
```

**Errors:** `400` (missing required fields).

---

#### `GET /recruiters/dashboard` 🔐 Auth (`RECRUITER`, `ADMIN`)

Legacy recruiter dashboard. Returns KPIs from `recruiters` metrics and pipeline counts across all applications.

**Success Response `200`:**

```json
{
  "recruiterId": "r001",
  "recruiterName": "Sarah Johnson",
  "cvsDue": 6,
  "interviewsToSchedule": 3,
  "offerDeadlines": 2,
  "activeMandates": 25,
  "companies": 18,
  "pipelineCounts": {
    "Inbound": 45, "Screening": 30, "Shortlisted": 10,
    "Interview": 15, "Offer": 5, "Placed": 2, "Closed": 3
  },
  "weeklyTasks": [
    { "id": "t1", "task": "Review CVs for Standard Bank mandate", "due": "2024-11-16", "priority": "HIGH" }
  ],
  "kpis": { "placements": 21, "activeRoles": 8, "candidates": 142, "conversionRate": 14.8 },
  "recentPlacements": [
    { "candidate": "CAND100001", "role": "Senior React Developer", "company": "Standard Bank", "date": "2024-10-16" }
  ]
}
```

---

#### `GET /recruiters/jobs` 🔐 Auth (`RECRUITER`, `ADMIN`)

Jobs managed by the authenticated recruiter. Admins see all jobs.

**Query Parameters:** `status` (`Open` \| `Closed` \| `Draft`)

**Success Response `200`:** `{ "jobs": [ /* Job[] */ ], "total": 8 }`

---

#### `GET /recruiters/jobs/:jobId` 🔐 Auth (`RECRUITER`, `ADMIN`)

Job detail with full pipeline breakdown and all applications.

**Success Response `200`:** Job object extended with `pipelineCounts` (stage → count) and `applications` array.

**Errors:** `404`.

---

#### `GET /recruiters/candidates` 🔐 Auth (`RECRUITER`, `ADMIN`)

ATS candidate search (backed by legacy `candidates` dataset).

**Query Parameters:** `q`, `skills` (comma-separated), `location`, `page`, `limit`

**Success Response `200`:**

```json
{
  "candidates": [ { "...candidateFields": "...", "matchScore": 82, "currentStage": "Interview" } ],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

---

#### `GET /recruiters/candidates/:id` 🔐 Auth (`RECRUITER`, `ADMIN`)

Full legacy candidate profile with match score and all applications.

**Success Response `200`:** Candidate object plus `matchScore` and `applications` array.

**Errors:** `404`.

---

#### `POST /candidates/:id/actions/send-latest-matched-jobs` 🔐 Auth (`RECRUITER`, `ADMIN`)

AI action — sends the top 5 open job matches to a candidate (simulated email/notification).

**Success Response `200`:**

```json
{
  "candidateId": "c001",
  "jobsSent": 5,
  "jobs": [
    { "jobId": "j001", "title": "Senior React Developer", "company": "Standard Bank", "matchScore": 87 }
  ],
  "sentAt": "2024-11-15T10:00:00Z",
  "message": "5 matched jobs sent to candidate."
}
```

**Errors:** `404` (candidate not found).

---

### 7.11 MANCO (Management)

**Base paths:** `/api/v1/manco`, `/api/manco/recruiters`

> **Access guard:** Only `MANCO` and `ADMIN` roles may access these routes. All others receive `403`.

---

#### `GET /api/v1/manco/:mancoId/dashboard` 🔐 Auth (`MANCO`, `ADMIN`)

Platform-wide KPI dashboard with recruiter performance table, alerts, and aggregate summary.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `sortedBy` | `string` | Sort recruiter table by `placements` \| `activeRoles` \| `candidates` \| `conversionRate` (default: `placements`) |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "MANCO dashboard retrieved.",
  "data": {
    "alerts": [
      {
        "alertId": "ALT-MND001",
        "type": "MANDATE_STALE",
        "severity": "WARNING",
        "message": "Mandate Senior React Developer at Standard Bank has been open for 52 days.",
        "mandateId": "MND001",
        "daysOpen": 52
      },
      {
        "alertId": "ALT-EE-MND002",
        "type": "EE_COMPLIANCE",
        "severity": "WARNING",
        "message": "EE target not met for mandate FNB Data Engineer at FNB.",
        "mandateId": "MND002"
      }
    ],
    "recruiters": [
      {
        "recruiterId": "r001",
        "name": "Sarah Johnson",
        "email": "recruiter@skillsmine.com",
        "specialisation": ["Technology", "Cloud"],
        "metrics": { "placements": 21, "activeRoles": 8, "candidates": 142, "conversionRate": 14.8 },
        "activeMandates": 3
      }
    ],
    "sortedBy": "placements",
    "summary": {
      "totalActiveMandates": 4,
      "totalCandidatesInPipeline": 12,
      "placementsThisQuarter": 58,
      "revenueYTD": 2850000,
      "avgTimeToPlace": 22
    }
  }
}
```

**Alert types:**

| Type | Trigger |
|---|---|
| `MANDATE_STALE` | Active mandate open > 45 days |
| `EE_COMPLIANCE` | Active mandate with `eeTarget: true` and `shortlistedCount: 0` |

---

#### `GET /api/manco/recruiters/:id/performance` 🔐 Auth (`MANCO`, `ADMIN`)

Individual recruiter KPI metrics with 4-month placement and revenue trend.

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Recruiter performance retrieved.",
  "data": {
    "recruiterId": "r001",
    "name": "Sarah Johnson",
    "email": "recruiter@skillsmine.com",
    "specialisation": ["Technology", "Cloud"],
    "metrics": {
      "placements": 21,
      "activeRoles": 3,
      "candidates": 142,
      "conversionRate": 14.8,
      "avgDaysToPlace": 19,
      "revenueYTD": 1050000
    },
    "kpiTrend": [
      { "month": "Aug", "placements": 18, "revenue": 864000 },
      { "month": "Sep", "placements": 19, "revenue": 912000 },
      { "month": "Oct", "placements": 20, "revenue": 960000 },
      { "month": "Nov", "placements": 21, "revenue": 1008000 }
    ],
    "jobsManaged": 5,
    "activeMandates": 3,
    "closedMandates": 2
  }
}
```

**Errors:** `404` (recruiter not found).

---

### 7.12 CRM

**Base path:** `/api/v1/crm`

> **Access guard:** `JOB_SEEKER` / `candidate` roles receive `403`. Only `RECRUITER`, `MANCO`, and `ADMIN` may access.

---

#### `GET /api/v1/crm/clients` 🔐 Auth (`RECRUITER`, `MANCO`, `ADMIN`)

List all CRM clients with pagination and status summary counts.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | `string` | Filter by `hot_lead` \| `warm_contact` \| `cold_lead` \| `needs_attention` |
| `page` | `integer` | Default: `1` |
| `limit` | `integer` | Default: `20` |

**Success Response `200`:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "CRM clients retrieved.",
  "data": {
    "summary": {
      "hot_lead": 8,
      "warm_contact": 15,
      "cold_lead": 12,
      "needs_attention": 10,
      "total": 45
    },
    "clients": [ /* CRMClient[] */ ],
    "pagination": { "page": 1, "pageSize": 20, "total": 45, "totalPages": 3 }
  }
}
```

---

#### `POST /api/v1/crm/clients/:clientId/notes` 🔐 Auth (`RECRUITER`, `MANCO`, `ADMIN`)

Add a note to a CRM client and optionally transition its status.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `note` | `string` | ✅ | Note body text |
| `noteType` | `string` | — | Default: `"GENERAL"`. e.g. `"FOLLOW_UP"`, `"MEETING"` |
| `newStatus` | `string` | — | If provided, transitions client to this status |

**Success Response `201`:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Note added successfully.",
  "data": {
    "clientId": "cl001",
    "noteId": "note-1700000000000",
    "noteType": "GENERAL",
    "addedBy": "Sarah Johnson",
    "addedAt": "2024-11-15T10:00:00Z",
    "previousStatus": "warm_contact",
    "currentStatus": "hot_lead",
    "totalNotes": 4
  }
}
```

**Errors:** `400` (`note` missing), `404` (client not found).

---

## 8. Error Contracts

All error responses follow this shape:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Human-readable error message."
}
```

Some `422` errors include additional diagnostic fields:

```json
{
  "success": false,
  "statusCode": 422,
  "message": "Required checklist items are incomplete.",
  "missingItems": ["cvVerified"]
}
```

```json
{
  "success": false,
  "statusCode": 422,
  "message": "Invalid transition: 'Inbound' can only advance to 'Screening', not 'Interview'.",
  "allowedTransition": { "from": "Inbound", "to": "Screening" }
}
```

### HTTP Status Code Reference

| Status | Meaning |
|---|---|
| `200` | OK |
| `201` | Resource created |
| `204` | No content (CORS preflight) |
| `400` | Bad request / missing required fields |
| `401` | Not authenticated (missing/invalid/expired token) |
| `403` | Forbidden (authenticated but insufficient role) |
| `404` | Resource not found |
| `409` | Conflict (e.g. email already registered) |
| `422` | Unprocessable entity (business rule violation, e.g. job not open, invalid pipeline transition, checklist incomplete) |
| `500` | Internal server error (2% random injection in mock; real errors in production) |

---

## 9. ID Conventions

| Entity | Format | Example |
|---|---|---|
| User | `USR` + 6-digit number | `USR100001` |
| Candidate Profile | `CAND` + 6-digit number | `CAND100001` |
| Resume | `RES` + 6-digit number | `RES100001` |
| Skill | `SKL` + 3-digit zero-padded | `SKL001`, `SKL042` |
| Job | `j` + 3-digit zero-padded | `j001`, `j025` |
| Application | `APP` + last 8 digits of timestamp | `APP87654321` |
| Mandate | `MND` + 3-digit zero-padded | `MND001`, `MND004` |
| Recruiter | `r` + 3-digit zero-padded | `r001`, `r020` |
| CRM Client | `cl` + 3-digit zero-padded | `cl001`, `cl050` |
| CRM Note | `note-<timestamp>` | `note-1700000000000` |
| Document | `DOC` + 5-digit random | `DOC54321` |
| Alert | `ALT-<mandateId>` or `ALT-EE-<mandateId>` | `ALT-MND001`, `ALT-EE-MND002` |

---

## 10. Enum Reference

### Job Status
| Value | Meaning |
|---|---|
| `Open` | Actively accepting applications |
| `Closed` | Filled or withdrawn |
| `Draft` | Created but not yet published |

### Employment Type
| Value |
|---|
| `Permanent` |
| `Contract` |

### Work Type
| Value |
|---|
| `Remote` |
| `Hybrid` |
| `On-site` |

### Pipeline Stages (ordered, v2)
| Stage | Position | Notes |
|---|---|---|
| `Inbound` | 1 | Application received |
| `Screening` | 2 | Phone/CV screen |
| `Shortlisted` | 3 | Approved for interview |
| `Interview` | 4 | Interview scheduled/completed |
| `Offer` | 5 | Offer extended |
| `Placed` | 6 | Successful placement |
| `Closed` | 7 | Rejected or withdrawn |

### Mandate Status
| Value |
|---|
| `ACTIVE` |
| `CLOSED` |
| `ON_HOLD` |

### CRM Client Status
| Value | Days Since Contact |
|---|---|
| `hot_lead` | 0–5 days |
| `warm_contact` | 6–14 days |
| `needs_attention` | 15–30 days |
| `cold_lead` | 30+ days |

### User Roles
| Value | Description |
|---|---|
| `JOB_SEEKER` | Job-seeking candidate |
| `RECRUITER` | Internal/partner recruiter managing mandates |
| `MANCO` | Management committee — read-only operational access |
| `ADMIN` | Full system access |

### Account Status
| Value |
|---|
| `ACTIVE` |
| `PENDING_VERIFICATION` |
| `SUSPENDED` |

### Task / Alert Priority & Severity
| Value | Context |
|---|---|
| `CRITICAL` | Task priority |
| `HIGH` | Task priority |
| `MEDIUM` | Task priority |
| `LOW` | Task priority |
| `WARNING` | Alert/compliance severity |
| `INFO` | Alert/compliance severity |

### CV Builder Steps (ordered)
| Step | Position |
|---|---|
| `personalDetails` | 1 |
| `careerHistory` | 2 |
| `skills` | 3 |
| `education` | 4 |
| `languages` | 5 |
| `summary` | 6 |
| `preferences` | 7 |

### Skill Categories
| Value |
|---|
| `Frontend` |
| `Backend` |
| `Languages` |
| `Cloud` |
| `DevOps` |
| `Database` |
| `Data` |
| `Mobile` |
| `Design` |
| `Soft Skills` |

---

*This document reflects the complete v2 contract as implemented in `mock-server/`. All production endpoints should honour these schemas, status codes, and business rules exactly.*
