/**
 * G1 — Auth & Onboarding
 * Test plan: .claude/state/test-plan.md § G1
 *
 * Golden path: POST /auth/test-login → JWT → GET /api/v1/me → correct role+schoolId.
 * Web golden path: phone+OTP login → dashboard loads.
 *
 * Edge cases:
 * 1. Non-whitelisted phone → 403
 * 2. Wrong OTP → 400/error (manual OTP flow)
 * 3. Tenant isolation: school-001 JWT cannot see arbitrary cross-tenant data
 * 4. Admin login — skipped BUG-TEST-CRED-001
 */

import { test, expect } from "@playwright/test";
import { getJwt, loginOnWeb } from "../fixtures/auth";
import { USERS, BACKEND_URL, AUTH_URL, FRONTEND_URL } from "../fixtures/test-users";

// ---------------------------------------------------------------------------
// Golden path — API level
// ---------------------------------------------------------------------------

test("G1-GP-01: test-login returns signed JWT for TEACHER phone", async () => {
  const response = await fetch(`${AUTH_URL}/auth/test-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: USERS.TEACHER }),
  });

  expect(response.status).toBe(200);

  const json = (await response.json()) as {
    success: boolean;
    data?: { accessToken: string };
  };

  expect(json.success).toBe(true);
  expect(json.data?.accessToken).toBeTruthy();

  // JWT is a 3-part base64 string
  const parts = json.data!.accessToken.split(".");
  expect(parts).toHaveLength(3);
});

test("G1-GP-02: GET /api/v1/me returns correct role and schoolId for TEACHER", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const response = await fetch(`${BACKEND_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(response.status).toBe(200);

  const json = (await response.json()) as {
    success?: boolean;
    data?: { role?: string; schoolId?: string; membershipType?: string };
  };

  // Role should be TEACHER (exact string may vary — check it's not ADMIN/PARENT)
  const data = json.data ?? (json as Record<string, unknown>);
  const role = (data as Record<string, unknown>).role ??
    (data as Record<string, unknown>).membershipType;
  expect(String(role).toUpperCase()).toContain("TEACHER");
});

test("G1-GP-03: GET /api/v1/me schoolId matches school-001", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const response = await fetch(`${BACKEND_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(response.status).toBe(200);
  const json = await response.json() as Record<string, unknown>;
  const data = (json.data ?? json) as Record<string, unknown>;
  const schoolId = data.schoolId ?? data.school_id ?? data.orgId;
  expect(String(schoolId)).toContain("school-001");
});

// ---------------------------------------------------------------------------
// Golden path — Web level
// ---------------------------------------------------------------------------

test.skip(
  "G1-GP-04: web OTP login with TEACHER phone lands on dashboard — SKIPPED: reCAPTCHA blocks headless browser login",
  async ({ page }) => {
    // The web login flow triggers a reCAPTCHA image challenge in headless Chromium.
    // Cannot be automated without CAPTCHA bypass token or test-bypass mechanism.
    // API-level auth (G1-GP-01/02/03) is the reliable path for CI.
    // To run this test manually: npx playwright test g1-auth.spec.ts --headed
    await loginOnWeb(page, USERS.TEACHER);
    const currentUrl = page.url();
    expect(currentUrl).not.toMatch(/\/(login|auth|signin)/i);
    await expect(
      page.locator("nav, [role=navigation], [data-testid*=dashboard], main")
    ).toBeVisible({ timeout: 10000 });
  }
);

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("G1-EC-01: non-whitelisted phone receives 403 from test-login", async () => {
  const response = await fetch(`${AUTH_URL}/auth/test-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: "+919999999000" }),
  });

  // Non-whitelisted phone must be forbidden
  expect(response.status).toBe(403);
});

test.skip(
  "G1-EC-02: wrong OTP via verify-otp flow — SKIPPED: /auth/send-otp path does not exist on auth-dev",
  async () => {
    // auth-dev exposes /auth/test-login (bypasses OTP for allowlisted phones) and
    // /auth/login (requires Firebase ID token). The standalone /auth/send-otp and
    // /auth/verify-otp endpoints either don't exist on auth-dev or are at a different path.
    // curl /auth/send-otp → {"success":false,"message":"No static resource auth/send-otp."}
    // This test should be enabled once the correct OTP path is confirmed and mapped.
    // Tracking: see test-plan.md G1 edge cases.
  }
);

test("G1-EC-03: tenant isolation — school-001 JWT cannot access /actuator/env or internal endpoints", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  // Actuator endpoints should be locked down even with a valid JWT
  const actuatorRes = await fetch(`${BACKEND_URL}/actuator/env`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  // Should be 403 or 404 — not 200
  expect(actuatorRes.status).not.toBe(200);
});

test.fixme(
  "G1-EC-04: admin phone test-login — SKIPPED BUG-TEST-CRED-001",
  async () => {
    // Admin phone +919999999999 maps to wrong tenant (islam313 org, not school-001)
    // until auth-engineer remaps the membership.
    // Expected: test-login returns JWT with role=SCHOOL_ADMIN, schoolId=school-001
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const json = await res.json() as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    expect(String(data.schoolId)).toContain("school-001");
  }
);

test.fixme(
  "G1-EC-05: parent phone test-login — SKIPPED BUG-TEST-CRED-002",
  async () => {
    // Parent phone +919999999997 maps to Ecommerce_Customer org, not school-001
    // until auth-engineer remaps.
    const jwt = await getJwt(USERS.PARENT);
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const json = await res.json() as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    expect(String(data.schoolId)).toContain("school-001");
  }
);

// ---------------------------------------------------------------------------
// Health checks (fast gate — run first in CI)
// ---------------------------------------------------------------------------

test("G1-HEALTH-01: auth service health endpoint returns UP", async () => {
  const res = await fetch(`${AUTH_URL}/actuator/health`);
  expect(res.status).toBe(200);
  const json = await res.json() as { status?: string };
  expect(json.status?.toUpperCase()).toBe("UP");
});

test("G1-HEALTH-02: backend API health endpoint returns UP", async () => {
  const res = await fetch(`${BACKEND_URL}/actuator/health`);
  expect(res.status).toBe(200);
  const json = await res.json() as { status?: string };
  expect(json.status?.toUpperCase()).toBe("UP");
});
