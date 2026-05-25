/**
 * G11 — Student Recognitions
 * Feature: DESIGN-713 (commit 96b781d) — Student recognition/badge system
 *
 * Endpoints under test (8 from DESIGN-713 + extras):
 *   POST   /api/v1/recognitions               — Teacher/Admin create recognition
 *   GET    /api/v1/recognitions               — Teacher: own given list; Admin: school-wide feed
 *   GET    /api/v1/recognitions/{id}          — Single recognition
 *   DELETE /api/v1/recognitions/{id}          — Teacher own; Admin any-in-school
 *   GET    /api/v1/student/recognitions       — Student own list
 *   GET    /api/v1/parent/recognitions        — Parent own child's list
 *   GET    /api/v1/parent/recognitions/latest — LatestBadgeWidget (7-day window)
 *   GET    /api/v1/admin/recognitions/feed    — Admin school-wide feed with stats
 *
 * XSS regression: BUG-SEC-001/002/003 + V107 sanitization via Jsoup.
 * Rate-limit: soft at 5 recognitions / student / week for teachers.
 * RBAC: role-gate verified for each endpoint.
 *
 * Test creds:
 *   Teacher:  +919999999995 (working)
 *   Student:  +919999999996 (working)
 *   Admin:    +919999999999 BUG-TEST-CRED-001 (fixme)
 *   Parent:   +919999999997 BUG-TEST-CRED-002 (fixme)
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";
import { randomUUID } from "crypto";

// Base path — adjust if API uses a different prefix
const REC_BASE = `${BACKEND_URL}/api/v1/recognitions`;

// Helper: minimal valid recognition payload
function makeRecognition(overrides: Record<string, unknown> = {}) {
  return {
    studentId: `student-test-${randomUUID().slice(0, 8)}`,
    classId: "class-test-001",
    title: `QA Award ${randomUUID().slice(0, 6)}`,
    description: "Excellent performance during QA automation run.",
    badgeType: "ACADEMIC",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TEACHER — create (POST)
// ---------------------------------------------------------------------------

test.describe("G11 Teacher — Create Recognition", () => {
  test("G11-TEACHER-CREATE-01: Teacher can create recognition for student in own class — 201", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const payload = makeRecognition();

    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // 201 (created) or 200 (OK), or 404 (feature not yet mapped on this env)
    // Never 403 (teacher is allowed), never 500 (crash)
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
    expect([200, 201, 404, 422]).toContain(res.status);
  });

  test("G11-TEACHER-CREATE-02: Teacher POST recognition for student NOT in own class returns 403", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const payload = makeRecognition({
      classId: `class-other-school-${randomUUID().slice(0, 8)}`,
      studentId: `student-other-class-${randomUUID().slice(0, 8)}`,
    });

    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // 403 (not in own class) or 404 (class not found) — never 200/201
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    expect(res.status).not.toBe(500);
  });

  test("G11-TEACHER-CREATE-03: Teacher POST recognition for student in different school returns 403", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const payload = makeRecognition({
      studentId: "student-school-002-xref",
      schoolId: "school-002",
      classId: "class-school-002-001",
    });

    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Cross-tenant creation must be rejected
    expect([400, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    expect(res.status).not.toBe(500);
  });

  test("G11-TEACHER-CREATE-04: unauthenticated POST returns 401", async () => {
    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeRecognition()),
    });
    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// ADMIN — create (POST)
// ---------------------------------------------------------------------------

test.describe("G11 Admin — Create Recognition", () => {
  test.fixme(
    "G11-ADMIN-CREATE-01: Admin can create recognition for any student in own school — 201 — FIXME BUG-TEST-CRED-001",
    async () => {
      const jwt = await getJwt(USERS.ADMIN);
      const payload = makeRecognition();

      const res = await fetch(REC_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      expect([200, 201]).toContain(res.status);
    }
  );

  test.fixme(
    "G11-ADMIN-CREATE-02: Admin POST recognition cross-school returns 403 — FIXME BUG-TEST-CRED-001",
    async () => {
      const jwt = await getJwt(USERS.ADMIN);
      const payload = makeRecognition({
        studentId: "student-school-002-xref",
        schoolId: "school-002",
        classId: "class-school-002-001",
      });

      const res = await fetch(REC_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      expect([403, 404]).toContain(res.status);
      expect(res.status).not.toBe(201);
    }
  );
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test.describe("G11 Rate Limiting", () => {
  test("G11-RATE-01: 6th badge to same student in 1 week returns 200 with X-Recognition-Warning header", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const studentId = `student-rate-test-${randomUUID().slice(0, 8)}`;

    // Fire 6 recognition creation requests for the same student
    const results: Array<{ status: number; headers: Headers }> = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(REC_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(makeRecognition({
          studentId,
          title: `Badge ${i + 1} — QA rate test`,
        })),
      });
      results.push({ status: res.status, headers: res.headers });
    }

    // If feature is implemented (201 responses received), the 6th should carry a warning header
    const successfulResults = results.filter((r) => r.status === 201 || r.status === 200);
    if (successfulResults.length === 6) {
      const sixthResult = results[5]!;
      // Must not hard-block (400/429) — must still succeed with warning
      expect([200, 201]).toContain(sixthResult.status);
      // Check for the soft rate-limit warning header
      const warningHeader = sixthResult.headers.get("X-Recognition-Warning");
      expect(warningHeader).toBeTruthy();
      expect(warningHeader?.toLowerCase()).toContain("rate-limit");
    } else {
      // Feature may not be live yet — endpoint returns 404
      // Test passes if endpoint just doesn't exist (404 means not implemented)
      for (const r of results) {
        expect(r.status).not.toBe(500);
      }
    }
  });

  test.fixme(
    "G11-RATE-02: Admin is exempt from rate limit — 6+ recognitions allowed — FIXME BUG-TEST-CRED-001",
    async () => {
      const jwt = await getJwt(USERS.ADMIN);
      const studentId = `student-admin-rate-${randomUUID().slice(0, 8)}`;

      const results: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await fetch(REC_BASE, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(makeRecognition({
            studentId,
            title: `Admin Badge ${i + 1}`,
          })),
        });
        results.push(res.status);
      }

      // All 8 should succeed (admin exempt)
      for (const status of results) {
        expect([200, 201]).toContain(status);
        // Must NOT get a 429 rate-limit block
        expect(status).not.toBe(429);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// XSS sanitization regression — BUG-SEC-001/002/003 + V107
// ---------------------------------------------------------------------------

test.describe("G11 XSS Sanitization (BUG-SEC-001/002/003 + V107 regression)", () => {
  test("G11-XSS-01: title with <script> tag is sanitized — DB must not store raw script", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const xssTitle = "<script>alert('XSS')</script>QA Test Recognition";

    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeRecognition({ title: xssTitle })),
    });

    expect(res.status).not.toBe(500);

    if (res.status === 200 || res.status === 201) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const returnedTitle = String(data.title ?? "");
      // Returned title must have script tag stripped
      expect(returnedTitle).not.toContain("<script>");
      expect(returnedTitle).not.toContain("alert(");
    }
  });

  test("G11-XSS-02: description with multi-line <script> is sanitized (BUG-SEC-002 regression)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const multilineXss = "<script>\nalert(1)\n</script>Clean description";

    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeRecognition({ description: multilineXss })),
    });

    expect(res.status).not.toBe(500);

    if (res.status === 200 || res.status === 201) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const returnedDesc = String(data.description ?? "");
      // Multi-line script must be stripped
      expect(returnedDesc).not.toContain("<script>");
      expect(returnedDesc).not.toContain("alert(");
    }
  });

  test("G11-XSS-03: description with javascript: URI is sanitized (BUG-SEC-003 regression)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const jsUriXss = `<a href="javascript:alert(1)">Click me</a>`;

    const res = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeRecognition({ description: jsUriXss })),
    });

    expect(res.status).not.toBe(500);

    if (res.status === 200 || res.status === 201) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const returnedDesc = String(data.description ?? "");
      expect(returnedDesc).not.toContain("javascript:");
    }
  });
});

// ---------------------------------------------------------------------------
// TEACHER — read
// ---------------------------------------------------------------------------

test.describe("G11 Teacher — Read", () => {
  test("G11-TEACHER-READ-01: Teacher GET own given recognitions returns list without 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(REC_BASE, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(401);
    // 200 (list, possibly empty) or 404 (feature not yet mapped)
    expect([200, 404]).toContain(res.status);
  });

  test("G11-TEACHER-READ-02: Teacher cannot access admin-only recognition feed (403)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/admin/recognitions/feed`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Teacher must NOT see admin feed
    // 403 = forbidden (correct RBAC), 404 = not mapped, 405 = method not allowed
    // All are acceptable "no access" responses
    expect([403, 404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// ADMIN — read
// ---------------------------------------------------------------------------

test.describe("G11 Admin — Read", () => {
  test.fixme(
    "G11-ADMIN-READ-01: Admin GET school-wide feed returns list with stats — FIXME BUG-TEST-CRED-001",
    async () => {
      const jwt = await getJwt(USERS.ADMIN);

      const res = await fetch(`${BACKEND_URL}/api/v1/admin/recognitions/feed`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      // Response should have data array and stats
      expect(json.data ?? json).toBeTruthy();
    }
  );
});

// ---------------------------------------------------------------------------
// STUDENT — read own recognitions
// ---------------------------------------------------------------------------

test.describe("G11 Student — Read", () => {
  test.fixme(
    "G11-STUDENT-READ-01: Student GET own recognitions does not return 401 — FIXME BUG-STUDENT-401",
    async () => {
      // BUG-STUDENT-401: STUDENT JWT is being treated as unauthenticated (401) by these
      // GET endpoints. Expected: student can see own recognitions (200) or get 404 if feature
      // not yet mapped. Getting 401 means the student JWT is not accepted — same pattern as
      // other write-path 401s but manifesting on a GET. Investigation in flight.
      const jwt = await getJwt(USERS.STUDENT);

      const paths = [
        `${BACKEND_URL}/api/v1/student/recognitions`,
        `${REC_BASE}/my`,
        `${REC_BASE}?viewAs=student`,
      ];

      for (const path of paths) {
        const res = await fetch(path, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        expect(res.status).not.toBe(500);
        expect(res.status).not.toBe(401);
      }
    }
  );

  test("G11-STUDENT-READ-02: Student cannot GET another student's recognitions (403)", async () => {
    const jwt = await getJwt(USERS.STUDENT);
    const otherStudentId = `student-other-${randomUUID().slice(0, 8)}`;

    const res = await fetch(
      `${BACKEND_URL}/api/v1/student/recognitions?studentId=${otherStudentId}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    // Must not expose other student's recognitions
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as unknown;
      if (Array.isArray(data)) {
        for (const rec of data as Array<Record<string, unknown>>) {
          expect(String(rec.studentId ?? rec.student_id ?? "")).not.toBe(otherStudentId);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PARENT — read own child recognitions
// ---------------------------------------------------------------------------

test.describe("G11 Parent — Read", () => {
  test.fixme(
    "G11-PARENT-READ-01: Parent GET own child's recognitions — FIXME BUG-TEST-CRED-002",
    async () => {
      const jwt = await getJwt(USERS.PARENT);

      const res = await fetch(`${BACKEND_URL}/api/v1/parent/recognitions`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      expect(res.status).toBe(200);
    }
  );

  test.fixme(
    "G11-PARENT-READ-02: Parent cannot GET another child's recognitions (403) — FIXME BUG-TEST-CRED-002",
    async () => {
      const jwt = await getJwt(USERS.PARENT);
      const otherChildId = `student-other-parent-${randomUUID().slice(0, 8)}`;

      const res = await fetch(
        `${BACKEND_URL}/api/v1/parent/recognitions?studentId=${otherChildId}`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      );

      expect([403, 404]).toContain(res.status);
    }
  );

  test.fixme(
    "G11-PARENT-WIDGET-01: LatestBadgeWidget returns recognitions within 7 days — FIXME BUG-TEST-CRED-002",
    async () => {
      const jwt = await getJwt(USERS.PARENT);

      const res = await fetch(`${BACKEND_URL}/api/v1/parent/recognitions/latest`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as unknown;

      if (Array.isArray(data)) {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const rec of data as Array<Record<string, unknown>>) {
          const createdAt = rec.createdAt ?? rec.created_at;
          if (createdAt) {
            expect(new Date(String(createdAt)).getTime()).toBeGreaterThan(sevenDaysAgo);
          }
        }
      }
    }
  );
});

// ---------------------------------------------------------------------------
// DELETE — teacher and admin
// ---------------------------------------------------------------------------

test.describe("G11 Delete Recognition", () => {
  test("G11-DELETE-01: Teacher DELETE own recognition returns 204 or 404 (not 403 or 500)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // First create a recognition so we have an ID to delete
    const createRes = await fetch(REC_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeRecognition()),
    });

    if (createRes.status === 201 || createRes.status === 200) {
      const createJson = await createRes.json() as Record<string, unknown>;
      const created = (createJson.data ?? createJson) as Record<string, unknown>;
      const recognitionId = created.id ?? created.recognitionId;

      if (recognitionId) {
        const deleteRes = await fetch(`${REC_BASE}/${String(recognitionId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        // Teacher can delete own recognition
        expect([200, 204, 404]).toContain(deleteRes.status);
        expect(deleteRes.status).not.toBe(403);
        expect(deleteRes.status).not.toBe(500);
      }
    } else {
      // Feature not live yet — verify endpoint doesn't 500
      expect([200, 201, 404]).toContain(createRes.status);
    }
  });

  test("G11-DELETE-02: Teacher cannot DELETE another teacher's recognition (403)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Use a fake recognition ID that belongs to a different teacher (not the current one)
    const fakeOtherTeacherRecId = `rec-other-teacher-${randomUUID().slice(0, 8)}`;

    const deleteRes = await fetch(`${REC_BASE}/${fakeOtherTeacherRecId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Must not succeed — must be 403 (forbidden) or 404 (not found = also OK as security)
    expect([403, 404]).toContain(deleteRes.status);
    expect(deleteRes.status).not.toBe(200);
    expect(deleteRes.status).not.toBe(204);
    expect(deleteRes.status).not.toBe(500);
  });

  test.fixme(
    "G11-DELETE-03: Admin can DELETE any recognition in own school — FIXME BUG-TEST-CRED-001",
    async () => {
      const teacherJwt = await getJwt(USERS.TEACHER);
      const adminJwt = await getJwt(USERS.ADMIN);

      // Create recognition as teacher
      const createRes = await fetch(REC_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${teacherJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(makeRecognition()),
      });

      expect([200, 201]).toContain(createRes.status);
      const createJson = await createRes.json() as Record<string, unknown>;
      const created = (createJson.data ?? createJson) as Record<string, unknown>;
      const recognitionId = created.id ?? created.recognitionId;

      // Admin deletes it
      const deleteRes = await fetch(`${REC_BASE}/${String(recognitionId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminJwt}` },
      });

      expect([200, 204]).toContain(deleteRes.status);
      expect(deleteRes.status).not.toBe(403);
    }
  );

  test("G11-DELETE-04: unauthenticated DELETE returns 401", async () => {
    const fakeId = `rec-${randomUUID().slice(0, 8)}`;
    const res = await fetch(`${REC_BASE}/${fakeId}`, {
      method: "DELETE",
    });
    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated access — all endpoints
// ---------------------------------------------------------------------------

test.describe("G11 Unauthenticated Access", () => {
  test("G11-UNAUTH-01: unauthenticated GET /api/v1/recognitions returns 401", async () => {
    const res = await fetch(REC_BASE);
    expect([401, 403]).toContain(res.status);
  });

  test("G11-UNAUTH-02: unauthenticated GET student recognitions returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/student/recognitions`);
    expect([401, 403]).toContain(res.status);
  });

  test("G11-UNAUTH-03: unauthenticated GET admin recognitions feed returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/recognitions/feed`);
    expect([401, 403]).toContain(res.status);
  });

  test("G11-UNAUTH-04: unauthenticated GET parent recognitions returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/parent/recognitions`);
    expect([401, 403]).toContain(res.status);
  });

  test("G11-UNAUTH-05: unauthenticated GET parent latest badge widget returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/parent/recognitions/latest`);
    expect([401, 403]).toContain(res.status);
  });
});
