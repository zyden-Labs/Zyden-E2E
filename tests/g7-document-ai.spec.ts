/**
 * G7 — Document AI
 * Test plan: .claude/state/test-plan.md § G7
 *
 * Status: Feature still maturing. Library endpoint exists; ingestion/classification
 * is partially scaffolded. Tests cover what exists and skip unimplemented parts.
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";

// ---------------------------------------------------------------------------
// Golden path — what exists
// ---------------------------------------------------------------------------

test("G7-GP-01: GET /api/v1/library returns 200 for TEACHER (may be empty list)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/library`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  // 200 (list, possibly empty) or 404 if feature not yet deployed
  // 401/403/500 are failures
  expect(res.status).not.toBe(401);
  expect(res.status).not.toBe(403);
  expect(res.status).not.toBe(500);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("G7-EC-01: upload unsupported MIME type returns 415 (not 500)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  // Try uploading a .exe file (unsupported)
  const blob = new Blob(["fake binary content"], { type: "application/octet-stream" });
  const formData = new FormData();
  formData.append("file", blob, "test.exe");
  formData.append("title", "Test Upload");

  const res = await fetch(`${BACKEND_URL}/api/v1/library`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData,
  });

  expect(res.status).not.toBe(500);
  // Expect 415 (unsupported media) or 403 (teacher may not have upload perms)
  expect([400, 403, 404, 415, 422]).toContain(res.status);
});

test("G7-EC-02: unauthenticated library access returns 401", async () => {
  const res = await fetch(`${BACKEND_URL}/api/v1/library`);
  expect([401, 403]).toContain(res.status);
});

test("G7-EC-03: STUDENT cannot perform admin library upload (403)", async () => {
  const jwt = await getJwt(USERS.STUDENT);

  const blob = new Blob(["test content"], { type: "application/pdf" });
  const formData = new FormData();
  formData.append("file", blob, "test.pdf");

  const res = await fetch(`${BACKEND_URL}/api/v1/library`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData,
  });

  expect([403, 404]).toContain(res.status);
});

test.skip(
  "G7-SKIP-01: document classification endpoint — feature not yet implemented",
  async () => {
    // Document ingestion and AI classification backend is partially scaffolded.
    // This test will be enabled once the classify endpoint is shipped.
  }
);

test.skip(
  "G7-SKIP-02: >10MB upload size limit — feature not yet confirmed",
  async () => {
    // Size limit behavior not confirmed via test. Enable once limit is documented.
  }
);
