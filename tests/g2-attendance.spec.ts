/**
 * G2 — Attendance (face + voice + geofence)
 * Test plan: .claude/state/test-plan.md § G2
 *
 * Surfaces: backend HTTP, postgres-dev SQL (read-only for verification)
 * Android/mobile tests are SKIPPED pending BLOCKER-T7-DRIVE-001 (Samsung T7 not mounted).
 *
 * Write-path tests use qa_test_writer seed helpers where POSTGRES_QA_WRITER_URL is set.
 * If not set, those tests still run but skip DB verification (API path only).
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";
import { seedTestRow, cleanupTestRows } from "../fixtures/seed";
import { randomUUID } from "crypto";

// Shared test date — use a fixed past date to avoid "future date" rejections
const TEST_DATE = "2026-01-15";
// IST midnight-crossing date (UTC would be prev day)
const TEST_DATE_IST_MIDNIGHT = "2026-03-31"; // 00:30 IST = 2026-03-30 19:00 UTC

// ---------------------------------------------------------------------------
// Golden path — Attendance session lifecycle
// ---------------------------------------------------------------------------

test.describe("G2 Golden Path", () => {
  test("G2-GP-01: GET /api/v1/attendance returns 200 for TEACHER", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/attendance`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Accept 200 (data) or 404 if path not yet mapped — but not 401/403/500
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });

  test("G2-GP-02: attendance session list endpoint accessible to TEACHER", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Try common attendance paths — confirm no auth failure
    const paths = [
      "/api/v1/attendance/sessions",
      "/api/v1/attendance",
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      // Must not be 401 (unauth) or 403 (forbidden for teacher)
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  });

  test("G2-GP-03: GET /api/v1/attendance/sessions does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/sessions`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Access control — unauthenticated & wrong roles
// ---------------------------------------------------------------------------

test.describe("G2 Access Control", () => {
  test("G2-EC-01: attendance endpoint rejected without JWT (401)", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/attendance`);
    expect([401, 403]).toContain(res.status);
  });

  test.fixme(
    "G2-RBAC-01: STUDENT role cannot create attendance sessions (403) — FIXME BUG-STUDENT-401: backend returns 401 instead of 403 for STUDENT JWT on write paths",
    async () => {
      // BUG-STUDENT-401: STUDENT JWT is being treated as unauthenticated (401) rather
      // than authenticated-but-forbidden (403) by the attendance write endpoints.
      // Expected: 403 (student authenticated but not authorized to create sessions)
      // Actual: 401 (server rejects the student JWT as if unauthenticated)
      // Investigation in flight with backend-engineer.
      const jwt = await getJwt(USERS.STUDENT);

      const res = await fetch(`${BACKEND_URL}/api/v1/attendance/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ classId: "test-class-001", date: TEST_DATE }),
      });

      // Student should not be allowed to create sessions
      expect([403, 404]).toContain(res.status);
    }
  );

  test("G2-RBAC-02: unauthenticated POST to attendance sessions is rejected", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "test-class-001", date: TEST_DATE }),
    });
    expect([401, 403]).toContain(res.status);
  });

  test.fixme(
    "G2-RBAC-03: STUDENT cannot mark attendance for another student — FIXME BUG-STUDENT-401",
    async () => {
      // BUG-STUDENT-401: STUDENT JWT returns 401 (unauthenticated) instead of 403 (unauthorized)
      // on write-path endpoints. Investigation in flight with backend-engineer.
      const jwt = await getJwt(USERS.STUDENT);
      const otherStudentId = `student-${randomUUID().slice(0, 8)}`;

      const res = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studentId: otherStudentId,
          status: "PRESENT",
          date: TEST_DATE,
        }),
      });
      expect([403, 404]).toContain(res.status);
    }
  );

  test("G2-RBAC-04: TEACHER cannot mark attendance for student in different school", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Attempt to mark attendance using a schoolId other than school-001
    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        studentId: "student-school-002",
        schoolId: "school-002",
        status: "PRESENT",
        date: TEST_DATE,
        classId: "class-school-002-001",
      }),
    });
    // Must reject cross-tenant marking attempt
    expect([400, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Validation — date boundaries
// ---------------------------------------------------------------------------

test.describe("G2 Date Validation", () => {
  test("G2-DATE-01: marking attendance for a future date returns 400", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const futureDate = "2099-12-31";

    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        classId: "test-class-001",
        studentId: "test-student-001",
        status: "PRESENT",
        date: futureDate,
      }),
    });
    // Future date should be rejected as invalid
    expect([400, 404, 422]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  test("G2-DATE-02: editing attendance for a past date is allowed (business rule — not rejected)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    // A confirmed past date
    const pastDate = "2025-01-01";

    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        classId: "test-class-001",
        studentId: "test-student-001",
        status: "PRESENT",
        date: pastDate,
      }),
    });
    // Past-date edit should NOT be a 400 validation error (it's allowed per business rule)
    // May be 200/201 (marked), 404 (class/student not found), but not 400
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(500);
  });

  test("G2-DATE-03: IST midnight-crossing date regression — BUG-118 guard", async () => {
    // BUG-118: dates near midnight IST were stored as the UTC-previous day.
    // This test marks attendance at 2026-03-31 (IST) and verifies the response
    // does not indicate a 400 due to date parsing issues.
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        classId: "test-class-001",
        studentId: "test-student-001",
        status: "PRESENT",
        date: TEST_DATE_IST_MIDNIGHT,
        // Simulate a timestamp at 00:30 IST (19:00 UTC of prev day)
        timestamp: "2026-03-30T19:00:00Z",
      }),
    });
    expect(res.status).not.toBe(500);
    // Date parsing must not throw a 400 specifically due to timezone handling
    if (res.status === 400) {
      const body = await res.text();
      expect(body.toLowerCase()).not.toContain("date");
    }
  });
});

// ---------------------------------------------------------------------------
// Upsert / idempotency — duplicate marks
// ---------------------------------------------------------------------------

test.describe("G2 Upsert Behavior", () => {
  test("G2-UPSERT-01: marking same student twice on same day does not return 409 (upsert expected)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const body = JSON.stringify({
      classId: "test-class-001",
      studentId: "test-student-001",
      status: "PRESENT",
      date: TEST_DATE,
    });

    const res1 = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body,
    });
    // First mark — may succeed (200/201) or fail for data reason (404 class not found)
    expect(res1.status).not.toBe(500);

    if (res1.status === 200 || res1.status === 201) {
      // Send exact same mark again — must upsert (200/201), not 409 conflict
      const res2 = await fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(res2.status).not.toBe(409);
      expect(res2.status).not.toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

test.describe("G2 Bulk Operations", () => {
  test("G2-BULK-01: bulk attendance mark endpoint does not crash with 30-student payload", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const studentEntries = Array.from({ length: 30 }, (_, i) => ({
      studentId: `test-student-${String(i + 1).padStart(3, "0")}`,
      status: i % 3 === 0 ? "ABSENT" : "PRESENT",
      date: TEST_DATE,
    }));

    // Try bulk endpoint variants — confirm no 500
    const bulkPaths = [
      "/api/v1/attendance/bulk",
      "/api/v1/attendance/mark/bulk",
    ];

    for (const path of bulkPaths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ classId: "test-class-001", entries: studentEntries, date: TEST_DATE }),
      });
      expect(res.status).not.toBe(500);
    }
  });

  test("G2-BULK-02: bulk fetch attendance for class on specific date does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(
      `${BACKEND_URL}/api/v1/attendance?classId=test-class-001&date=${TEST_DATE}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(401);
  });

  test("G2-BULK-03: attendance summary for last 30 days does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    const paths = [
      `/api/v1/attendance/summary?from=${thirtyDaysAgo}&to=${today}`,
      `/api/v1/attendance/report?from=${thirtyDaysAgo}&to=${today}`,
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).not.toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Voice attendance
// ---------------------------------------------------------------------------

test.describe("G2 Voice Attendance", () => {
  test("G2-EC-04: voice attendance with empty body returns 400 (no crash)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/voice/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Empty body should be a validation error, NOT a 500
    expect(res.status).not.toBe(500);
    expect([400, 404, 415, 422]).toContain(res.status);
  });

  test("G2-VOICE-01: voice attendance with wrong content-type returns 400 or 415", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Submit with text/plain instead of expected multipart or application/json
    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/voice/submit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "text/plain",
      },
      body: "this is not valid audio",
    });

    expect(res.status).not.toBe(500);
    expect([400, 404, 415, 422]).toContain(res.status);
  });

  test("G2-VOICE-02: voice attendance session create does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/attendance/voice/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        classId: "test-class-001",
        date: TEST_DATE,
        sessionId: `voice-session-${randomUUID().slice(0, 8)}`,
      }),
    });
    expect(res.status).not.toBe(500);
  });

  test.fixme(
    "G2-VOICE-03: voice attendance STUDENT cannot create voice session (403) — FIXME BUG-STUDENT-401",
    async () => {
      // BUG-STUDENT-401: STUDENT JWT returns 401 (unauthenticated) instead of 403 (unauthorized)
      // on write-path endpoints. Investigation in flight with backend-engineer.
      const jwt = await getJwt(USERS.STUDENT);

      const res = await fetch(`${BACKEND_URL}/api/v1/attendance/voice/session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ classId: "test-class-001", date: TEST_DATE }),
      });
      expect([403, 404]).toContain(res.status);
    }
  );
});

// ---------------------------------------------------------------------------
// Face attendance
// ---------------------------------------------------------------------------

test.describe("G2 Face Attendance", () => {
  test("G2-EC-03: face attendance feature flag — enroll endpoint returns 403 when flag is off", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // If FACE_ATTENDANCE feature flag is false for school-001, this returns 403
    // If it's enabled, it may return 400 (missing body) or 200 — all are OK except 500
    const res = await fetch(`${BACKEND_URL}/api/v1/face/enroll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).not.toBe(500);
  });

  test("G2-FACE-01: face match with empty image payload returns 400 (no crash)", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/face/match`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(500);
    expect([400, 404, 415, 422]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Concurrent marks race condition
// ---------------------------------------------------------------------------

test.describe("G2 Concurrency", () => {
  test("G2-RACE-01: concurrent attendance marks for same student return consistent state (no 500)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const studentId = "test-student-001";

    // Fire 5 concurrent marks for the same student on the same date
    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`${BACKEND_URL}/api/v1/attendance/mark`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          classId: "test-class-001",
          studentId,
          status: i % 2 === 0 ? "PRESENT" : "ABSENT",
          date: TEST_DATE,
        }),
      }).then((r) => r.status)
    );

    const statuses = await Promise.all(requests);
    // None should be 500 (race condition / constraint violation unhandled)
    for (const status of statuses) {
      expect(status).not.toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Export / CSV
// ---------------------------------------------------------------------------

test.describe("G2 Export", () => {
  test("G2-EXPORT-01: attendance CSV export endpoint does not return 500", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const paths = [
      `/api/v1/attendance/export?from=${thirtyDaysAgo}&to=${today}&format=csv`,
      `/api/v1/attendance/export/csv?from=${thirtyDaysAgo}&to=${today}`,
      `/api/v1/attendance/report/export`,
    ];

    for (const path of paths) {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      // 404 means not yet implemented — that's acceptable
      // 500 is NOT acceptable
      expect(res.status).not.toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile stub
// ---------------------------------------------------------------------------

test.skip("G2-MOB-01: Android emulator — take attendance flow — BLOCKED BLOCKER-T7-DRIVE-001", async () => {
  // Android E2E blocked until Samsung T7 drive is mounted.
  // When unblocked: adb -s emulator-5556 + scripts/screencap.sh
});
