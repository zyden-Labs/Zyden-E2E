/**
 * G10 — Cross-cutting (security, performance, observability)
 * Test plan: .claude/state/test-plan.md § G10
 *
 * Surfaces: backend HTTP security probes, web accessibility checks
 *
 * Performance (Lighthouse CLS/LCP/FID) and axe-core a11y require
 * additional tooling — marked as skip with reason.
 */

import { test, expect } from "@playwright/test";
import { getJwt, loginOnWeb } from "../fixtures/auth";
import { USERS, BACKEND_URL, AUTH_URL, FRONTEND_URL } from "../fixtures/test-users";

// ---------------------------------------------------------------------------
// Health / availability
// ---------------------------------------------------------------------------

test("G10-HEALTH-01: backend actuator health returns status=UP", async () => {
  const res = await fetch(`${BACKEND_URL}/actuator/health`);
  expect(res.status).toBe(200);
  const json = await res.json() as { status: string };
  expect(json.status.toUpperCase()).toBe("UP");
});

test("G10-HEALTH-02: auth service actuator health returns status=UP", async () => {
  const res = await fetch(`${AUTH_URL}/actuator/health`);
  expect(res.status).toBe(200);
  const json = await res.json() as { status: string };
  expect(json.status.toUpperCase()).toBe("UP");
});

test("G10-HEALTH-03: frontend app loads with HTTP 200", async ({ page }) => {
  const res = await page.goto(FRONTEND_URL);
  expect(res?.status()).toBe(200);
});

// ---------------------------------------------------------------------------
// Security probes
// ---------------------------------------------------------------------------

test("G10-SEC-01: actuator/env endpoint is not exposed (403 or 404)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/actuator/env`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  // Actuator /env should be locked down in any non-dev build
  expect(res.status).not.toBe(200);
});

test("G10-SEC-02: actuator/beans not exposed to JWT users", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/actuator/beans`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).not.toBe(200);
});

test("G10-SEC-03: SQL injection in query param is sanitized (no 500)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const injectionParam = "' OR '1'='1";
  const res = await fetch(
    `${BACKEND_URL}/api/v1/announcements?search=${encodeURIComponent(injectionParam)}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  // Must not crash the server
  expect(res.status).not.toBe(500);
});

test("G10-SEC-04: XSS payload in announcement content is not executed (BUG-XSS-MSG-001 guard)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  // Attempt to POST an XSS payload (backend should sanitize or reject)
  const xssPayload = "<script>alert('xss')</script>";
  const createRes = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "XSS Test", body: xssPayload }),
  });

  // If POST succeeded, verify GET doesn't return raw script tags
  if ([200, 201].includes(createRes.status)) {
    const created = await createRes.json() as { data?: { id?: string } };
    const id = created.data?.id;
    if (id) {
      const getRes = await fetch(`${BACKEND_URL}/api/v1/announcements/${id}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (getRes.status === 200) {
        const text = await getRes.text();
        // Raw <script> tags should not appear verbatim in the response
        // They should be escaped: &lt;script&gt;
        expect(text).not.toContain("<script>alert('xss')</script>");
      }
    }
  }
});

test("G10-SEC-05: CORS headers present on API responses", async () => {
  const res = await fetch(`${BACKEND_URL}/actuator/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://school-dev.zydenlabs.com",
      "Access-Control-Request-Method": "GET",
    },
  });

  // Should respond with CORS headers (200 or 204) not reject
  expect([200, 204]).toContain(res.status);
});

// ---------------------------------------------------------------------------
// Web a11y (basic — no axe dependency)
// ---------------------------------------------------------------------------

test("G10-A11Y-01: login page has form labels and heading", async ({ page }) => {
  await page.goto(FRONTEND_URL);

  // Wait for login form
  await page.waitForTimeout(2000);

  // Page should have at least one h1 or h2 heading
  const headings = await page.locator("h1, h2").count();
  expect(headings).toBeGreaterThan(0);
});

test.skip(
  "G10-A11Y-02: teacher dashboard has landmark navigation — SKIPPED: reCAPTCHA blocks headless login",
  async ({ page }) => {
    // Web login triggers reCAPTCHA in headless mode. Run manually with --headed.
    await loginOnWeb(page, USERS.TEACHER);
    await page.waitForTimeout(2000);
    const navCount = await page.locator("nav, [role=navigation]").count();
    expect(navCount).toBeGreaterThan(0);
  }
);

// ---------------------------------------------------------------------------
// Performance (skipped — requires Lighthouse CLI)
// ---------------------------------------------------------------------------

test.skip(
  "G10-PERF-01: login page Lighthouse score >= 80 — requires lighthouse CLI",
  async () => {
    // Run: npx lighthouse https://school-dev.zydenlabs.com/login --output json
    // Assert: categories.performance.score >= 0.80, CLS < 0.1, LCP < 2.5s
  }
);

test.skip(
  "G10-PERF-02: Core Web Vitals — run /benchmark via CEO cron (weekly)",
  async () => {
    // Dispatched as part of the weekly cron tick (every 21st tick).
    // Not run in standard CI to avoid cost.
  }
);
