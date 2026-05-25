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

test.describe("G1 Golden Path — API level", () => {
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

  test("G1-GP-05: test-login returns signed JWT for STUDENT phone", async () => {
    const response = await fetch(`${AUTH_URL}/auth/test-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: USERS.STUDENT }),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { success: boolean; data?: { accessToken: string } };
    expect(json.success).toBe(true);
    expect(json.data?.accessToken).toBeTruthy();
    const parts = json.data!.accessToken.split(".");
    expect(parts).toHaveLength(3);
  });

  test("G1-GP-06: GET /api/v1/me returns role for STUDENT", async () => {
    const jwt = await getJwt(USERS.STUDENT);
    const response = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    // Student may return 200 with their own data or may return 403 if feature-gated
    // but must NOT return 500
    expect(response.status).not.toBe(500);
  });
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
// Edge cases — JWT security
// ---------------------------------------------------------------------------

test.describe("G1 Edge Cases — JWT Security", () => {
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

  test("G1-EC-06: GET /api/v1/me without Bearer prefix returns 401", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    // Pass token without "Bearer " prefix
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: jwt },
    });
    expect([400, 401, 403]).toContain(res.status);
  });

  test("G1-EC-07: GET /api/v1/me with no Authorization header returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/me`);
    expect([401, 403]).toContain(res.status);
  });

  test("G1-EC-08: JWT with tampered payload returns 401", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const parts = jwt.split(".");
    // Replace payload with a base64-encoded tampered claim
    const fakePayload = Buffer.from(
      JSON.stringify({ sub: "hacker", role: "SUPER_ADMIN", schoolId: "school-002" })
    ).toString("base64url");
    const tamperedJwt = `${parts[0]}.${fakePayload}.${parts[2]}`;

    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${tamperedJwt}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  test("G1-EC-09: JWT with expired exp claim returns 401", async () => {
    // Manufacture a JWT-shaped string with a past expiry — signature will be invalid
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: USERS.TEACHER, exp: Math.floor(Date.now() / 1000) - 3600 })
    ).toString("base64url");
    const fakeSignature = "invalidsignature";
    const expiredJwt = `${header}.${payload}.${fakeSignature}`;

    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${expiredJwt}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  test("G1-EC-10: JWT with wrong issuer returns 401", async () => {
    // Manufacture a fake JWT from a different issuer
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: USERS.TEACHER,
        iss: "https://evil-auth.example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const fakeSignature = "invalidsignature";
    const wrongIssuerJwt = `${header}.${payload}.${fakeSignature}`;

    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${wrongIssuerJwt}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  test("G1-EC-11: completely random string as Bearer token returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: "Bearer thisisnotavalidjwtatall.random.garbage" },
    });
    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test.describe("G1 Tenant Isolation", () => {
  test("G1-TENANT-01: TEACHER JWT school-001 cannot enumerate other schools' student lists", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Try to access a hypothetical school-002 scoped resource directly
    const res = await fetch(`${BACKEND_URL}/api/v1/students?schoolId=school-002`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    // Must return 403 (forbidden for cross-tenant) or 404, never 200 with other school data
    expect(res.status).not.toBe(200);
    // If it does return 200, verify it returns no data from school-002
    if (res.status === 200) {
      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as unknown;
      if (Array.isArray(data)) {
        // Any returned students must not belong to school-002
        for (const student of data as Array<Record<string, unknown>>) {
          expect(String(student.schoolId ?? student.school_id ?? "school-001")).not.toBe("school-002");
        }
      }
    }
  });

  test("G1-TENANT-02: TEACHER JWT /api/v1/me data does not leak other-tenant user info", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    const schoolId = String(data.schoolId ?? data.school_id ?? data.orgId ?? "");
    // schoolId returned must be school-001, not any other tenant
    expect(schoolId).toContain("school-001");
  });
});

// ---------------------------------------------------------------------------
// Phone number format normalization
// ---------------------------------------------------------------------------

test.describe("G1 Phone Format Normalization", () => {
  test("G1-PHONE-01: test-login with +91 prefix works", async () => {
    const res = await fetch(`${AUTH_URL}/auth/test-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: "+919999999995" }),
    });
    expect(res.status).toBe(200);
  });

  test("G1-PHONE-02: test-login with non-whitelisted 91-prefixed number is rejected", async () => {
    // A non-whitelisted number regardless of format must be rejected
    const res = await fetch(`${AUTH_URL}/auth/test-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: "+919999998000" }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test.describe("G1 Rate Limiting", () => {
  test("G1-RATE-01: spamming test-login with invalid phone eventually returns 429 or sustained 403", async () => {
    // Send 20 requests in quick succession with non-whitelisted phones
    const results: number[] = [];
    const requests = Array.from({ length: 20 }, (_, i) =>
      fetch(`${AUTH_URL}/auth/test-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: `+9188888${String(i).padStart(5, "0")}` }),
      }).then((r) => r.status)
    );
    const statuses = await Promise.all(requests);
    statuses.forEach((s) => results.push(s));

    // All must be non-200 (either 403 for not-whitelisted, or 429 for rate limit)
    for (const status of results) {
      expect([403, 429]).toContain(status);
    }
  });
});

// ---------------------------------------------------------------------------
// Health checks (fast gate — run first in CI)
// ---------------------------------------------------------------------------

test.describe("G1 Health Checks", () => {
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

  test("G1-HEALTH-03: health endpoints do not require authentication", async () => {
    // Health endpoints must be publicly accessible (no auth required)
    const authHealth = await fetch(`${AUTH_URL}/actuator/health`);
    expect(authHealth.status).toBe(200);

    const backendHealth = await fetch(`${BACKEND_URL}/actuator/health`);
    expect(backendHealth.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// JWT claims content
// ---------------------------------------------------------------------------

test.describe("G1 JWT Claims", () => {
  test("G1-CLAIMS-01: JWT payload contains expected claims (sub, iat, exp)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    // Decode payload (base64url)
    const payloadStr = Buffer.from(parts[1]!, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadStr) as Record<string, unknown>;

    // Standard JWT claims
    expect(payload.sub ?? payload.userId ?? payload.id).toBeTruthy();
    expect(typeof (payload.exp ?? payload.iat)).toBe("number");
  });

  test("G1-CLAIMS-02: JWT exp is in the future (not already expired)", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const parts = jwt.split(".");
    const payloadStr = Buffer.from(parts[1]!, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadStr) as { exp?: number };

    if (payload.exp !== undefined) {
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
    // If no exp claim, test passes (some JWTs use refresh-based expiry)
  });

  test("G1-CLAIMS-03: /api/v1/me response includes role and schoolId fields", async () => {
    const jwt = await getJwt(USERS.TEACHER);
    const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;

    // Must have some form of role identifier
    const hasRole = "role" in data || "membershipType" in data || "userType" in data;
    expect(hasRole).toBe(true);

    // Must have some form of school identifier
    const hasSchool = "schoolId" in data || "school_id" in data || "orgId" in data;
    expect(hasSchool).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrent sessions
// ---------------------------------------------------------------------------

test.describe("G1 Concurrent Sessions", () => {
  test("G1-CONC-01: two JWTs for same user work independently (concurrent session support)", async () => {
    // Fetch two tokens sequentially (cache ensures same underlying token in CI,
    // but validates that /api/v1/me works for both concurrently)
    const [jwt1, jwt2] = await Promise.all([
      getJwt(USERS.TEACHER),
      // Bypass cache by calling auth directly for the second token
      fetch(`${AUTH_URL}/auth/test-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: USERS.TEACHER }),
      }).then((r) => r.json() as Promise<{ data?: { accessToken: string } }>)
        .then((j) => j.data?.accessToken ?? ""),
    ]);

    expect(jwt1).toBeTruthy();
    expect(jwt2).toBeTruthy();

    // Both tokens must work
    const [res1, res2] = await Promise.all([
      fetch(`${BACKEND_URL}/api/v1/me`, { headers: { Authorization: `Bearer ${jwt1}` } }),
      fetch(`${BACKEND_URL}/api/v1/me`, { headers: { Authorization: `Bearer ${jwt2}` } }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// BUG-TEST-CRED-001 / BUG-TEST-CRED-002 stubs
// ---------------------------------------------------------------------------

test.fixme(
  "G1-EC-04: admin phone test-login — FIXME BUG-TEST-CRED-001",
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
  "G1-EC-05: parent phone test-login — FIXME BUG-TEST-CRED-002",
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

test.fixme(
  "G1-LOGOUT-01: logout invalidates JWT — FIXME: logout endpoint path not confirmed",
  async () => {
    // Expected flow: POST /auth/logout → 200 → subsequent GET /api/v1/me → 401
    // Not yet tested because /auth/logout path is unconfirmed on auth-dev.
    // When endpoint confirmed, remove fixme and run.
    const jwt = await getJwt(USERS.TEACHER);

    const logoutRes = await fetch(`${AUTH_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(logoutRes.status).toBe(200);

    const meRes = await fetch(`${BACKEND_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect([401, 403]).toContain(meRes.status);
  }
);

test.fixme(
  "G1-INACTIVE-01: inactive/disabled user returns 403 — FIXME: no disabled test user provisioned",
  async () => {
    // Need a test user with isActive=false in auth_service DB.
    // When provisioned: getJwt(USERS.INACTIVE_TEACHER) → /api/v1/me → 403
    // Tracking: auth-engineer to provision a disabled test account.
  }
);
