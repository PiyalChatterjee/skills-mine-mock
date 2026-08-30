# SkillsMine Mock API

Express-based mock API for the SkillsMine frontend. It provides the current local contract for authentication, candidate profiles and CVs, jobs and applications, recruiter workflows, CRM, documents, AI-assisted endpoints, and mandate-service compatibility endpoints.

The server is intended for frontend development and contract verification. It is not a production authentication or persistence implementation.

## Prerequisites

- Node.js `>= 22.12.0`
- npm

## Start the Server

```bash
npm install
npm run mock
```

The server listens on `http://localhost:4000` by default. Use the watch mode while modifying server files:

```bash
npm run mock:dev
```

The frontend should use this base URL during local development:

```dotenv
VITE_API_BASE_URL=http://localhost:4000
```

The runner also accepts `/api` as a compatibility prefix for non-versioned routes. For example, `GET /api/jobs` is served by the same handler as `GET /jobs`. Keep explicit versioned paths, such as `/api/v1/auth/login` and `/api/v1/crm/clients`, unchanged.

## API Documentation

Use the documents below as the source of truth for the implemented mock contract:

- [API_ARCHITECTURE.md](API_ARCHITECTURE.md): runtime topology, authentication, role access, data models, endpoint inventory, and error conventions.
- [auth_service_current.yaml](mock-server/docs/auth_service_current.yaml): current OpenAPI 3.0 authentication contract.
- [openapi-candidates.yaml](mock-server/docs/openapi-candidates.yaml): candidate profile, dashboard, CV, saved-job, and related endpoints.
- [openapi-cv-builder.yaml](mock-server/docs/openapi-cv-builder.yaml): CV Builder operations and payloads.

The `*_v0.yaml` documents are historical contract snapshots. They are retained for migration context and do not describe the preferred current routes.

## Configuration

[mock-server/config.yml](mock-server/config.yml) controls the local server:

| Setting | Default | Meaning |
|---|---:|---|
| `server.port` | `4000` | HTTP port |
| `delay.min` / `delay.max` | `300` / `900` ms | Simulated request latency |
| `errorSimulation.enabled` | `true` | Enables random failures for authenticated requests |
| `errorSimulation.rate` | `0.02` | Probability of an injected server error |
| `cors.origins` | `*` | Allowed CORS origins |

Fixture data is loaded from [mock-server/data](mock-server/data) at startup. The server keeps data in memory and selected write operations persist the updated dataset back to that directory. Reset a local fixture by restoring its JSON file from source control and restart the server.

## Authentication

Most endpoints require `Authorization: Bearer <accessToken>`. Login returns mock JWT-shaped access tokens, stored server-side for the running process. Tokens are suitable only for local development; they are not cryptographically verified.

Public endpoints include login and registration, public job/opportunity browsing, skills search and generation, candidate landing data, and the public password-recovery flow. The exact public-path list and endpoint-level access controls are documented in [API_ARCHITECTURE.md](API_ARCHITECTURE.md).

### Seed Accounts

All seed accounts use `Password123`.

| Role | Email |
|---|---|
| Job seeker | `michael.smith@email.com` |
| Job seeker | `ayesha.patel@email.com` |
| Recruiter | `recruiter@skillsmine.com` |
| MANCO | `manco@skillsmine.com` |
| EXCO | `exco@skillsmine.com` |
| Admin | `admin@skillsmine.com` |

Legacy aliases `candidate@skillsmine.com` and `candidate2@skillsmine.com` remain available for older clients.

### Quick Login Example

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"michael.smith@email.com\",\"password\":\"Password123\"}"
```

Pass the returned `accessToken` on protected calls:

```bash
curl http://localhost:4000/candidates/dashboard \
  -H "Authorization: Bearer <accessToken>"
```

## Project Layout

```text
mock-server/
  camouflage-runner.js  Express application, middleware, and router registration
  config.yml            Server, latency, error-simulation, and CORS configuration
  routes/               Domain route handlers
  data/                 JSON fixtures and persisted mock state
  docs/                 OpenAPI contracts and historical contract snapshots
  mocks/                Camouflage-style fallback response templates
  tests/                Route-level regression tests
```

## Verification

Run the CV Builder mock-server regression suite:

```bash
node --test mock-server/tests/cv-builder.test.js
```

For a manual smoke check after starting the server:

```bash
curl http://localhost:4000/jobs/j001
```

## Notes for Contributors

- Add a route handler under `mock-server/routes/` and register it in `camouflage-runner.js`.
- Keep fixture shapes, route behavior, [API_ARCHITECTURE.md](API_ARCHITECTURE.md), and the relevant OpenAPI document aligned in the same change.
- Prefer explicit Express handlers for behavior that validates input, enforces access, or mutates state. Use `mocks/` only for suitable static/template fallback responses.
- Do not treat mock authentication, in-memory sessions, or fixture persistence as production security or storage patterns.
