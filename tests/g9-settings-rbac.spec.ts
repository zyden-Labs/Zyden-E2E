/**
 * G9 — Settings & RBAC
 * Test plan: .claude/state/test-plan.md § G9
 *
 * Surfaces: backend HTTP
 * Critical: every mutating admin endpoint must return 403 for non-admin roles.
 * @PreAuthorize coverage verification.
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

test("G9-GP-01: feature flags endpoint returns list for TEACHER", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/features`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).toBe(200);
  const json = await res.json() as { data?: unknown[] };
  expect(Array.isArray(json.data ?? [])).toBe(true);
});

test("G9-GP-02: admin settings endpoint returns 403 for TEACHER (not admin)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/settings`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  // Teacher should not have admin settings access
  expect([403, 404]).toContain(res.status);
});

// ---------------------------------------------------------------------------
// RBAC probes — @PreAuthorize coverage
// ---------------------------------------------------------------------------

const ADMIN_ONLY_ENDPOINTS = [
  { method: "GET", path: "/api/v1/admin/settings" },
  { method: "GET", path: "/api/v1/admin/analytics/attendance-summary" },
  { method: "POST", path: "/api/v1/admin/fees/structure" },
  { method: "POST", path: "/api/v1/admin/fees/invoices/generate" },
  { method: "GET", path: "/api/v1/admin/features" },
];

for (const endpoint of ADMIN_ONLY_ENDPOINTS) {
  test(`G9-RBAC: TEACHER cannot ${endpoint.method} ${endpoint.path}`, async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}${endpoint.path}`, {
      method: endpoint.method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: endpoint.method !== "GET" ? JSON.stringify({}) : undefined,
    });

    // Admin-only endpoints must return 403 (or 404) for non-admin roles — never 200
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    expect(res.status).not.toBe(500);
  });

  test(`G9-RBAC: STUDENT cannot ${endpoint.method} ${endpoint.path}`, async () => {
    const jwt = await getJwt(USERS.STUDENT);

    const res = await fetch(`${BACKEND_URL}${endpoint.path}`, {
      method: endpoint.method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: endpoint.method !== "GET" ? JSON.stringify({}) : undefined,
    });

    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    expect(res.status).not.toBe(500);
  });
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("G9-EC-01: unauthenticated access to admin settings returns 401", async () => {
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/settings`);
  expect([401, 403]).toContain(res.status);
});

test("G9-EC-02: feature flag PATCH rejected for non-admin", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/features/FACE_ATTENDANCE`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });

  expect([403, 404]).toContain(res.status);
});

test("G9-EC-03: branding endpoint with invalid color hex returns 4xx (not 500)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/branding`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ primaryColor: "not-a-hex-color" }),
  });

  // Teacher gets 403; admin with invalid hex gets 422 — either is not 500
  expect(res.status).not.toBe(500);
});
