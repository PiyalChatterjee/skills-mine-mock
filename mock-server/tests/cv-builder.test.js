/**
 * CV Builder endpoint tests
 *
 * Tests the GET / POST / PUT /candidate/buildmycv contract.
 * Uses Node's built-in test runner (node:test) — no external deps required.
 *
 * Run:
 *   node --test mock-server/tests/cv-builder.test.js
 *
 * The mock server must be running on http://localhost:4000 before executing.
 * Log in as michael.smith@email.com / Password123 to obtain a token,
 * then set the MOCK_TOKEN environment variable:
 *
 *   $env:MOCK_TOKEN = "<accessToken from POST /auth/login response>"
 *   node --test mock-server/tests/cv-builder.test.js
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:4000';

// ─── Auth helper ────────────────────────────────────────────────────────────
let TOKEN = process.env.MOCK_TOKEN ?? null;

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'michael.smith@email.com', password: 'Password123' }),
  });
  const json = await res.json();
  TOKEN = json.data?.accessToken;
  assert.ok(TOKEN, 'Login must return an accessToken');
}

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fetch with automatic retry on injected 500s (errorSimulation in config). */
async function fetchWithRetry(url, options = {}, expectedStatus = 200, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    if (res.status === 500) {
      const body = await res.json().catch(() => ({}));
      if (body.injected) continue; // injected chaos — retry
    }
    assert.equal(res.status, expectedStatus);
    return res.json();
  }
  throw new Error(`Still getting injected 500 after ${retries} retries`);
}

async function getCv() {
  return fetchWithRetry(`${BASE}/candidate/buildmycv`, { headers: authHeaders() });
}

async function putCv(body) {
  return fetchWithRetry(
    `${BASE}/candidate/buildmycv`,
    { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) },
  );
}

// ─── Test suite ──────────────────────────────────────────────────────────────
describe('CV Builder endpoints', () => {
  before(async () => {
    if (!TOKEN) await login();
  });

  // ── GET ───────────────────────────────────────────────────────────────────
  describe('GET /candidate/buildmycv', () => {
    test('returns 200 with correct envelope', async () => {
      const json = await getCv();
      assert.equal(json.success, true);
      assert.equal(json.statusCode, 200);
      assert.ok(typeof json.message === 'string');
      assert.ok(json.data, 'data must be present');
    });

    test('response data contains all required model fields', async () => {
      const { data } = await getCv();
      const required = ['source', 'extractionStatus', 'personalDetails',
                        'careerHistory', 'skills', 'education', 'languages', 'validation'];
      for (const field of required) {
        assert.ok(Object.prototype.hasOwnProperty.call(data, field),
          `data.${field} must be present`);
      }
    });

    test('source is always "BuildCV"', async () => {
      const { data } = await getCv();
      assert.equal(data.source, 'BuildCV');
    });

    test('extractionStatus is a known enum value', async () => {
      const { data } = await getCv();
      const valid = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
      assert.ok(valid.includes(data.extractionStatus),
        `extractionStatus "${data.extractionStatus}" must be one of ${valid.join(', ')}`);
    });

    test('careerHistory, skills, languages, validation are arrays', async () => {
      const { data } = await getCv();
      for (const key of ['careerHistory', 'skills', 'languages', 'validation']) {
        assert.ok(Array.isArray(data[key]), `data.${key} must be an array`);
      }
    });

    test('education has secondaryEducation and tertiaryEducation arrays', async () => {
      const { data } = await getCv();
      assert.ok(data.education && typeof data.education === 'object' && !Array.isArray(data.education),
        'data.education must be an object');
      assert.ok(Array.isArray(data.education.secondaryEducation),
        'data.education.secondaryEducation must be an array');
      assert.ok(Array.isArray(data.education.tertiaryEducation),
        'data.education.tertiaryEducation must be an array');
    });
  });

  // ── PUT – skills only ─────────────────────────────────────────────────────
  describe('PUT /candidate/buildmycv – update skills only', () => {
    const newSkills = [
      { name: 'Java', level: 'ADVANCED' },
      { name: 'Spring Boot', level: 'INTERMEDIATE' },
    ];

    test('returns 200 with success envelope', async () => {
      const json = await putCv({ skills: newSkills });
      assert.equal(json.success, true);
      assert.equal(json.statusCode, 200);
      assert.equal(json.message, 'Build My CV updated successfully.');
    });

    test('skills are updated to the supplied values', async () => {
      await putCv({ skills: newSkills });
      const { data } = await getCv();
      assert.deepEqual(data.skills, newSkills);
    });

    test('careerHistory is preserved after skills-only update', async () => {
      // Capture careerHistory before the update
      const before = await getCv();
      const originalCareer = before.data.careerHistory;

      await putCv({ skills: newSkills });

      const after = await getCv();
      assert.deepEqual(after.data.careerHistory, originalCareer,
        'careerHistory must be unchanged after skills-only PUT');
    });

    test('education is preserved after skills-only update', async () => {
      const before = await getCv();
      const originalEducation = before.data.education;

      await putCv({ skills: newSkills });

      const after = await getCv();
      assert.deepEqual(after.data.education, originalEducation,
        'education must be unchanged after skills-only PUT');
    });

    test('lastModified is updated after PUT', async () => {
      const before = await getCv();
      const tsBefore = before.data.lastModified;

      // Small delay to guarantee timestamp difference
      await new Promise(r => setTimeout(r, 50));

      await putCv({ skills: newSkills });
      const after = await getCv();

      if (tsBefore) {
        assert.notEqual(after.data.lastModified, tsBefore,
          'lastModified must change after a PUT');
      }
    });

    test('createdAt is not changed by PUT', async () => {
      const before = await getCv();
      const createdBefore = before.data.createdAt;

      await putCv({ skills: newSkills });

      const after = await getCv();
      assert.equal(after.data.createdAt, createdBefore,
        'createdAt must be immutable');
    });
  });

  // ── PUT – education only ──────────────────────────────────────────────────
  describe('PUT /candidate/buildmycv – update education only', () => {
    const newTertiary = [
      {
        institution: 'University of Cape Town',
        qualification: 'BCom Information Systems',
        fieldOfStudy: 'Information Systems',
        yearCompleted: 2022,
      },
    ];
    const newSecondary = [
      { schoolName: 'Northcliff High School', qualification: 'Grade 12', yearCompleted: 2013 },
    ];

    test('returns 200 with success envelope', async () => {
      const json = await putCv({ education: { tertiaryEducation: newTertiary } });
      assert.equal(json.success, true);
      assert.equal(json.statusCode, 200);
      assert.equal(json.message, 'Build My CV updated successfully.');
    });

    test('tertiaryEducation is updated, secondaryEducation preserved', async () => {
      // Set a known secondary first
      await putCv({ education: { secondaryEducation: newSecondary } });
      // Now update only tertiary
      await putCv({ education: { tertiaryEducation: newTertiary } });
      const { data } = await getCv();
      assert.deepEqual(data.education.tertiaryEducation, newTertiary,
        'tertiaryEducation must match the supplied values');
      assert.deepEqual(data.education.secondaryEducation, newSecondary,
        'secondaryEducation must be preserved when only tertiaryEducation is sent');
    });

    test('skills are preserved after education-only update', async () => {
      const knownSkills = [{ name: 'React', level: 'ADVANCED' }];
      await putCv({ skills: knownSkills });

      await putCv({ education: { tertiaryEducation: newTertiary } });

      const { data } = await getCv();
      assert.deepEqual(data.skills, knownSkills,
        'skills must be unchanged after education-only PUT');
    });

    test('personalDetails are preserved after education-only update', async () => {
      const before = await getCv();
      const originalPD = before.data.personalDetails;

      await putCv({ education: { tertiaryEducation: newTertiary } });

      const after = await getCv();
      assert.deepEqual(after.data.personalDetails, originalPD,
        'personalDetails must be unchanged after education-only PUT');
    });

    test('source remains "BuildCV" after education update', async () => {
      await putCv({ education: { tertiaryEducation: newTertiary } });
      const { data } = await getCv();
      assert.equal(data.source, 'BuildCV');
    });

    test('extractionStatus defaults to COMPLETED on PUT', async () => {
      await putCv({ education: { tertiaryEducation: newTertiary } });
      const { data } = await getCv();
      assert.equal(data.extractionStatus, 'COMPLETED');
    });
  });

  // ── PUT – explicit empty overwrite ────────────────────────────────────────
  describe('PUT /candidate/buildmycv – explicit empty clears section', () => {
    test('sending skills: [] clears the skills array', async () => {
      await putCv({ skills: [{ name: 'React', level: 'ADVANCED' }] });
      await putCv({ skills: [] });
      const { data } = await getCv();
      assert.deepEqual(data.skills, [], 'skills must be empty after explicit [] update');
    });

    test('sending education: { tertiaryEducation: [] } clears tertiary', async () => {
      await putCv({ education: { tertiaryEducation: [{ institution: 'UCT', qualification: 'BSc', fieldOfStudy: 'CS', yearCompleted: 2020 }] } });
      await putCv({ education: { tertiaryEducation: [] } });
      const { data } = await getCv();
      assert.deepEqual(data.education.tertiaryEducation, [],
        'tertiaryEducation must be empty after explicit [] update');
    });
  });
});
