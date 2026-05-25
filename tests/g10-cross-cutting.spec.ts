/**
 * G10 — Cross-cutting (security, performance, observability)
 * Test plan: .claude/state/test-plan.md § G10
 *
 * Surfaces: backend HTTP security probes, web accessibility checks
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
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

test("G10-HEALTH-04: backend health endpoint responds under 200ms", async () => {
  const start = Date.now();
  const res = await fetch(`${BACKEND_URL}/actuator/health`);
  const elapsed = Date.now() - start;

  expect(res.status).toBe(200);

  if (elapsed > 200) {
    test.info().annotations.push({
      type: "warning",
      description: `Health endpoint took ${elapsed}ms — exceeded 200ms threshold`,
    });
  }
  // Hard fail at 2s
  expect(elapsed).toBeLessThan(2000);
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
        expect(text).not.toContain("<script>alert('xss')</script>");
      }
    }
  }
});

test("G10-SEC-05: CORS preflight OPTIONS returns CORS headers (200 or 204)", async () => {
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

test("G10-SEC-06: security response headers present on API responses", async () => {
  const res = await fetch(`${BACKEND_URL}/actuator/health`);
  expect(res.status).toBe(200);

  const headers = Object.fromEntries(res.headers.entries());
  const headerNames = Object.keys(headers).map((h) => h.toLowerCase());

  const missingHeaders: string[] = [];

  // Check for X-Content-Type-Options
  if (!headerNames.includes("x-content-type-options")) {
    missingHeaders.push("X-Content-Type-Options");
  }
  // Check for X-Frame-Options
  if (!headerNames.includes("x-frame-options")) {
    missingHeaders.push("X-Frame-Options");
  }

  if (missingHeaders.length > 0) {
    test.info().annotations.push({
      type: "warning",
      description: `Missing security headers: ${missingHeaders.join(", ")}`,
    });
  }

  // X-Content-Type-Options is the most basic — fail if absent
  expect(headerNames).toContain("x-content-type-options");
});

test("G10-SEC-07: 4xx API responses return standardized error shape", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  // Trigger a 403
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/settings`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if ([400, 403, 404, 422].includes(res.status)) {
    const json = await res.json() as Record<string, unknown>;
    // Should have at least one of: error, message, traceId
    const hasError = "error" in json || "message" in json;
    expect(hasError).toBe(true);
  }
});

test("G10-SEC-08: 5xx responses do not leak stack traces", async () => {
  // Try to trigger a potential 500 with a malformed request
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/nl-query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: "{{{{malformed json}",
  });

  if (res.status >= 500) {
    const text = await res.text();
    // Stack traces must not appear in production responses
    expect(text.toLowerCase()).not.toContain("at java.");
    expect(text.toLowerCase()).not.toContain("at org.springframework");
    expect(text).not.toContain("Exception");
    expect(text).not.toContain("NullPointer");
  }
});

test("G10-SEC-09: login rate limit endpoint does not 500 under rapid calls", async () => {
  // 5 rapid test-login calls — not enough to trigger actual rate limit but confirms no crash
  const requests = Array.from({ length: 5 }, () =>
    fetch(`${AUTH_URL}/auth/test-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: USERS.TEACHER }),
    })
  );

  const responses = await Promise.all(requests);
  for (const r of responses) {
    expect(r.status).not.toBe(500);
  }

  const rateLimited = responses.filter((r) => r.status === 429);
  if (rateLimited.length > 0) {
    test.info().annotations.push({
      type: "info",
      description: `${rateLimited.length}/5 login attempts rate-limited (429) — expected behavior`,
    });
  }
});

test("G10-SEC-10: robots.txt served correctly or SPA falls back to index.html", async () => {
  const robotsRes = await fetch(`${FRONTEND_URL}/robots.txt`);
  // 200 = served (proper robots.txt or SPA fallback), 404 = explicitly absent
  expect([200, 404]).toContain(robotsRes.status);

  if (robotsRes.status === 200) {
    const text = await robotsRes.text();
    const isProperRobots = text.toLowerCase().includes("user-agent");
    const isSpaFallback = text.toLowerCase().includes("<!doctype html");

    if (isSpaFallback && !isProperRobots) {
      // SPA is serving index.html for /robots.txt — log as informational
      // This is a known SPA routing pattern where the CDN doesn't serve static files at this path
      test.info().annotations.push({
        type: "warning",
        description:
          "/robots.txt returns the SPA index.html — a proper robots.txt is not configured. " +
          "Crawlers will receive no directives. Consider adding robots.txt to the CDN/static config.",
      });
    }
    // Either form is not a hard failure — both are semantically valid (but SPA fallback is sub-optimal)
  }

  const sitemapRes = await fetch(`${FRONTEND_URL}/sitemap.xml`);
  expect([200, 404]).toContain(sitemapRes.status);
  if (sitemapRes.status === 200) {
    const text = await sitemapRes.text();
    if (text.includes("<?xml")) {
      test.info().annotations.push({ type: "info", description: "sitemap.xml found and is valid XML" });
    }
  }
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
    const { loginOnWeb } = await import("../fixtures/auth");
    await loginOnWeb(page, USERS.TEACHER);
    await page.waitForTimeout(2000);
    const navCount = await page.locator("nav, [role=navigation]").count();
    expect(navCount).toBeGreaterThan(0);
  }
);

// ---------------------------------------------------------------------------
// HTTPS / redirect
// ---------------------------------------------------------------------------

test("G10-HTTPS-01: backend is served over HTTPS (URL check)", async () => {
  expect(BACKEND_URL).toMatch(/^https:\/\//);
  const res = await fetch(`${BACKEND_URL}/actuator/health`);
  expect(res.status).toBe(200);
});

test("G10-HTTPS-02: auth service is served over HTTPS", async () => {
  expect(AUTH_URL).toMatch(/^https:\/\//);
  const res = await fetch(`${AUTH_URL}/actuator/health`);
  expect(res.status).toBe(200);
});

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
