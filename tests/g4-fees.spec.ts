/**
 * G4 — Fees
 * Test plan: .claude/state/test-plan.md § G4
 *
 * Surfaces: backend HTTP, web (Playwright browser)
 * Note: Admin/Parent tests are fixme'd due to BUG-TEST-CRED-001/002.
 */

import { test, expect } from "@playwright/test";
import { getJwt, loginOnWeb } from "../fixtures/auth";
import { USERS, BACKEND_URL, FRONTEND_URL } from "../fixtures/test-users";

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

test("G4-GP-01: TEACHER can view fee announcements (announcements endpoint)", async () => {
  // Fees data is primarily admin/parent — teacher access via announcements
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).toBe(200);
});

test.fixme(
  "G4-GP-02: ADMIN can create fee structure — SKIPPED BUG-TEST-CRED-001",
  async () => {
    // Admin phone maps to wrong tenant until auth-engineer fix
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Fee Component",
        amount: 1000,
        termId: "term-001",
      }),
    });
    expect([200, 201]).toContain(res.status);
  }
);

test.fixme(
  "G4-GP-03: PARENT can GET own fee invoices — SKIPPED BUG-TEST-CRED-002",
  async () => {
    // Parent phone maps to wrong tenant
    const jwt = await getJwt(USERS.PARENT);
    const res = await fetch(`${BACKEND_URL}/api/v1/parent/fees/my`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
  }
);

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("G4-EC-01: unauthenticated access to fee invoices returns 401", async () => {
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices`);
  expect([401, 403]).toContain(res.status);
});

test("G4-EC-02: STUDENT cannot access fee structure endpoints (403)", async () => {
  const jwt = await getJwt(USERS.STUDENT);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect([403, 404]).toContain(res.status);
});

test("G4-EC-03: fee invoice generation with invalid body returns 4xx (not 500)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  // Teacher shouldn't be able to do this — 403 expected
  // If it accepts, should be 4xx for invalid body
  expect(res.status).not.toBe(500);
  expect([400, 403, 404, 422]).toContain(res.status);
});

test.fixme(
  "G4-EC-04: parent cannot view another parent's invoice — SKIPPED BUG-TEST-CRED-002",
  async () => {
    // Requires working PARENT JWT. Deferred until BUG-TEST-CRED-002 is fixed.
  }
);
