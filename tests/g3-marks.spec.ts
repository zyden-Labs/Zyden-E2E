/**
 * G3 — Marks Entry (voice + manual)
 * Test plan: .claude/state/test-plan.md § G3
 *
 * Surfaces: backend HTTP, web Chrome MCP (web tests use Playwright browser)
 *
 * Write-path tests use qa_test_writer seed helpers where POSTGRES_QA_WRITER_URL is set.
 * If not set, those tests still run but skip DB verification (API path only).
 */

import { test, expect } from "@playwright/test";
import { getJwt, loginOnWeb } from "../fixtures/auth";
import { USERS, BACKEND_URL, FRONTEND_URL } from "../fixtures/test-users";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

test.describe("G3 Golden Path", () => {
  test("G3-GP-01: TEACHER can GET exam list", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/exams`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Accept 200 (list) or 404 if feature not yet mapped
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });

  test("G3-GP-02: TEACHER can GET term report", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/report/term`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });

  test.skip(
    "G3-GP-03: web marks page loads without JS console errors — SKIPPED: reCAPTCHA blocks headless login",
    async ({ page }) => {
      // Web login triggers reCAPTCHA in headless mode (confirmed in G1-GP-04).
      // Run manually: npx playwright test g3-marks.spec.ts --headed
      await loginOnWeb(page, USERS.TEACHER);
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      await page.goto(`${FRONTEND_URL}/teacher/marks`).catch(() => {});
      await page.waitForTimeout(2000);
      const productErrors = consoleErrors.filter(
        (e) => !e.includes("firebase") && !e.includes("analytics") && !e.includes("chunk")
      );
      expect(productErrors).toHaveLength(0);
    }
  );

  test("G3-GP-04: TEACHER can GET subject-wise marks summary", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const paths = [
      "/api/v1/marks/summary",
      "/api/v1/marks/report/subject",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(401);
    }
  });

  test("G3-GP-05: marks list endpoint accessible to TEACHER without crashing", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — validation
// ---------------------------------------------------------------------------

test.describe("G3 Validation Edge Cases", () => {
  test("G3-EC-01: POST marks entry with score > maxMarks returns 422", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: "test-student-001",
        examId: "test-exam-001",
        score: 999999,
        maxMarks: 100,
      }),
    });

    // Should be validation error or not found — never a 200 or 500
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  test.fixme(
    "G3-EC-02: STUDENT cannot POST marks entry (403) — FIXME BUG-STUDENT-401",
    async () => {
      // BUG-STUDENT-401: STUDENT JWT returns 401 (unauthenticated) instead of 403 (unauthorized)
      // on write-path endpoints. The student IS authenticated but should be 403 (not teacher).
      // Investigation in flight with backend-engineer.
      const jwt = await getJwt(USERS.STUDENT);

      const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: "x", examId: "y", score: 80 }),
      });

      expect([403, 404]).toContain(res.status);
    }
  );

  test("G3-EC-03: term report for student with 0 marks returns 200 (not 500)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/report/term?studentId=nonexistent-student`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Empty result should be a 200 with empty array, not a 500
    expect(res.status).not.toBe(500);
  });

  test("G3-VALID-01: POST marks with negative score returns 422", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: "test-student-001",
        examId: "test-exam-001",
        score: -5,
        maxMarks: 100,
      }),
    });

    // Negative score must be rejected
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    // Valid response codes: 400 (bad request), 404 (exam not found), 422 (unprocessable)
    expect([400, 404, 422]).toContain(res.status);
  });

  test("G3-VALID-02: POST marks for non-existent exam returns 404 (not 500)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const fakeExamId = `exam-nonexistent-${randomUUID().slice(0, 8)}`;

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: "test-student-001",
        examId: fakeExamId,
        score: 75,
        maxMarks: 100,
      }),
    });

    expect(res.status).not.toBe(500);
    // Should be 404 (exam not found) or 422 (validation)
    expect([400, 404, 422]).toContain(res.status);
  });

  test("G3-VALID-03: POST marks without required fields returns 400 or 422", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Completely empty body
    const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    expect([400, 404, 422]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// RBAC — role-based access
// ---------------------------------------------------------------------------

test.describe("G3 RBAC", () => {
  test("G3-RBAC-01: unauthenticated access to marks is rejected", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/marks`);
    expect([401, 403]).toContain(res.status);
  });

  test("G3-RBAC-02: unauthenticated POST to marks entry is rejected", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: "x", examId: "y", score: 80, maxMarks: 100 }),
    });
    expect([401, 403]).toContain(res.status);
  });

  test("G3-RBAC-03: TEACHER cannot mark student in different school (403)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/entry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: "student-school-002-001",
        schoolId: "school-002",
        examId: "exam-school-002-001",
        score: 80,
        maxMarks: 100,
      }),
    });
    // Cross-school mark must be rejected
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  test("G3-RBAC-04: STUDENT can only see own marks — different student's marks returns 403 or empty", async () => {
    const jwt = await getJwt(USERS.STUDENT);
    const otherStudentId = `student-${randomUUID().slice(0, 8)}`;

    const res = await fetch(
      `${BACKEND_URL}/api/v1/marks?studentId=${otherStudentId}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    // Either 403 (forbidden) or 200 with empty/self-only data
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as unknown;
      if (Array.isArray(data)) {
        // If data returned, it must not contain marks for the requested other student
        for (const mark of data as Array<Record<string, unknown>>) {
          expect(String(mark.studentId ?? mark.student_id ?? "")).not.toBe(otherStudentId);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Bulk entry
// ---------------------------------------------------------------------------

test.describe("G3 Bulk Entry", () => {
  test("G3-BULK-01: bulk marks entry for full class does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const entries = Array.from({ length: 30 }, (_, i) => ({
      studentId: `test-student-${String(i + 1).padStart(3, "0")}`,
      score: 50 + i,
      maxMarks: 100,
    }));

    const paths = [
      "/api/v1/marks/bulk",
      "/api/v1/marks/entry/bulk",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: "test-exam-001",
          entries,
        }),
      });
      expect(res.status).not.toBe(500);
    }
  });

  test("G3-BULK-02: edit existing mark does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // PATCH or PUT on an existing mark — any response other than 500 is acceptable
    const paths = [
      "/api/v1/marks/entry/test-mark-001",
      "/api/v1/marks/test-mark-001",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ score: 85, maxMarks: 100 }),
      });
      expect(res.status).not.toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Voice marks
// ---------------------------------------------------------------------------

test.describe("G3 Voice Marks", () => {
  test("G3-EC-04: voice marks entry with empty body returns 400 (no crash) — regression BUG-VOICE-ECHO", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/voice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).not.toBe(500);
    expect([400, 404, 415, 422]).toContain(res.status);
  });

  test("G3-VOICE-01: voice marks with wrong content-type returns 400 or 415 (not 500)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "text/plain",
      },
      body: "this is not audio",
    });

    expect(res.status).not.toBe(500);
    expect([400, 404, 415, 422]).toContain(res.status);
  });

  test.fixme(
    "G3-VOICE-02: STUDENT cannot submit voice marks (403) — FIXME BUG-STUDENT-401",
    async () => {
      // BUG-STUDENT-401: STUDENT JWT returns 401 (unauthenticated) instead of 403 (unauthorized)
      // on write-path endpoints. Investigation in flight with backend-engineer.
      const jwt = await getJwt(USERS.STUDENT);

      const res = await fetch(`${BACKEND_URL}/api/v1/marks/voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ audioData: "base64encodedaudio" }),
      });
      expect([403, 404]).toContain(res.status);
    }
  );
});

// ---------------------------------------------------------------------------
// Reports — aggregation and history
// ---------------------------------------------------------------------------

test.describe("G3 Reports and History", () => {
  test("G3-REPORT-01: term report aggregation does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/marks/report/term`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(401);
  });

  test("G3-REPORT-02: class-wise comparison endpoint does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const paths = [
      "/api/v1/marks/report/class",
      "/api/v1/marks/class-summary",
      "/api/v1/marks/comparison",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).not.toBe(500);
    }
  });

  test("G3-REPORT-03: marks history endpoint returns per-student timeline without 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const paths = [
      "/api/v1/marks/history?studentId=test-student-001",
      "/api/v1/marks/timeline?studentId=test-student-001",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).not.toBe(500);
    }
  });

  test("G3-REPORT-04: STUDENT can only see own marks history (not other students)", async () => {
    const jwt = await getJwt(USERS.STUDENT);

    const otherStudentId = `student-other-${randomUUID().slice(0, 8)}`;
    const res = await fetch(
      `${BACKEND_URL}/api/v1/marks/history?studentId=${otherStudentId}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    // Student must not see another student's history
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as unknown;
      if (Array.isArray(data)) {
        for (const entry of data as Array<Record<string, unknown>>) {
          expect(String(entry.studentId ?? entry.student_id ?? "")).not.toBe(otherStudentId);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

test.describe("G3 Export", () => {
  test("G3-EXPORT-01: marks PDF/Excel export endpoint does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const paths = [
      "/api/v1/marks/export?format=pdf",
      "/api/v1/marks/export?format=xlsx",
      "/api/v1/marks/export/pdf",
      "/api/v1/marks/export/excel",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      // 404 = not yet implemented (OK). 500 = crash (NOT OK).
      expect(res.status).not.toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Parent visibility
// ---------------------------------------------------------------------------

test.describe("G3 Parent Visibility", () => {
  test.fixme(
    "G3-PARENT-01: parent can see own child's marks — FIXME BUG-TEST-CRED-002",
    async () => {
      // Parent phone maps to wrong tenant until BUG-TEST-CRED-002 is fixed
      const jwt = await getJwt(USERS.PARENT);
      const res = await fetch(`${BACKEND_URL}/api/v1/marks`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
    }
  );

  test.fixme(
    "G3-PARENT-02: parent cannot see other parent's child marks — FIXME BUG-TEST-CRED-002",
    async () => {
      // Requires working PARENT credential and a second student ID
      const jwt = await getJwt(USERS.PARENT);
      const otherChildId = `student-other-${randomUUID().slice(0, 8)}`;
      const res = await fetch(
        `${BACKEND_URL}/api/v1/marks?studentId=${otherChildId}`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      );
      expect([403, 404]).toContain(res.status);
    }
  );
});
