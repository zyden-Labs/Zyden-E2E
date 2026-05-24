/**
 * Auth fixture for Zyden Edu Playwright E2E suite.
 *
 * Two modes:
 * 1. API-level: `getJwt(phone)` — calls POST /auth/test-login and returns the accessToken.
 *    No OTP needed. Requires TEST_LOGIN_ENABLED=true on auth-dev server (confirmed set 2026-05-21).
 *    JWTs are cached per phone for the process lifetime to avoid rate-limiting (429) when
 *    running many tests in parallel. JWTs expire in 24h so intra-run caching is safe.
 * 2. Web-level: `loginOnWeb(page, phone)` — navigates to the login page, enters phone, waits
 *    for OTP field, enters 123456, waits for redirect to dashboard.
 *    NOTE: Web login hits reCAPTCHA in headless mode — use test.skip() for web login tests in CI.
 */

import { Page, test as base, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { AUTH_URL, FRONTEND_URL, UserRole, USERS } from "./test-users";

const CACHE_FILE = path.join(__dirname, "..", ".auth-cache.json");

function readCacheFile(): Record<string, { token: string; fetchedAt: number }> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as Record<string, { token: string; fetchedAt: number }>;
    }
  } catch {
    // ignore
  }
  return {};
}

export interface AuthFixtures {
  authenticatedPage: Page;
  teacherPage: Page;
  studentPage: Page;
}

const JWT_CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23h — JWTs expire in 24h

/**
 * Get a JWT token via the test-login endpoint (bypasses OTP, for API testing).
 *
 * Priority:
 * 1. Read from .auth-cache.json (written by globalSetup before workers start).
 *    This avoids rate-limiting when 3-4 workers call getJwt simultaneously.
 * 2. Fall back to fetching directly if cache is missing or stale.
 *
 * Returns the accessToken string.
 */
export async function getJwt(phone: string): Promise<string> {
  // Try the global setup cache first (shared file, written before workers start)
  const fileCache = readCacheFile();
  const cached = fileCache[phone];
  if (cached && Date.now() - cached.fetchedAt < JWT_CACHE_TTL_MS) {
    return cached.token;
  }

  // Cache miss — fetch directly (rare; only if globalSetup didn't run or cache is stale)
  const res = await fetch(`${AUTH_URL}/auth/test-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `getJwt failed for ${phone}: HTTP ${res.status} — ${body}`
    );
  }

  const json = (await res.json()) as {
    success: boolean;
    data?: { accessToken: string };
    message?: string;
  };

  if (!json.success || !json.data?.accessToken) {
    throw new Error(
      `getJwt: unexpected response shape: ${JSON.stringify(json)}`
    );
  }

  return json.data.accessToken;
}

/**
 * Perform the web OTP login flow on a Playwright Page.
 * Navigates to FRONTEND_URL, fills phone, submits, fills OTP=123456, submits.
 * Waits for the URL to change away from /login (dashboard redirect).
 */
export async function loginOnWeb(page: Page, phone: string): Promise<void> {
  await page.goto(FRONTEND_URL + "/");

  // Wait for the login form to appear (phone input)
  // The app may redirect to /login automatically
  await page.waitForURL(/\/(login|auth|signin)?/, { timeout: 10000 });

  // Fill phone number — try multiple possible selectors
  const phoneInput = page.locator(
    'input[type="tel"], input[name="phone"], input[placeholder*="phone" i], input[placeholder*="Phone" i], input[placeholder*="number" i]'
  ).first();
  await phoneInput.waitFor({ timeout: 10000 });
  await phoneInput.fill(phone);

  // Submit phone
  await page.keyboard.press("Enter");

  // Wait for OTP input to appear
  const otpInput = page.locator(
    'input[name="otp"], input[placeholder*="OTP" i], input[placeholder*="code" i], input[type="number"]'
  ).first();
  await otpInput.waitFor({ timeout: 10000 });
  await otpInput.fill("123456");

  // Submit OTP
  await page.keyboard.press("Enter");

  // Wait for dashboard (URL no longer /login)
  await page.waitForURL((url) => !url.pathname.match(/\/(login|auth|signin)/), {
    timeout: 15000,
  });
}

/**
 * Playwright test fixture: yields a page already logged in as teacher.
 * Use as `teacherPage` in test({ teacherPage }, ...).
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await loginOnWeb(page, USERS.TEACHER);
    await use(page);
  },

  teacherPage: async ({ page }, use) => {
    await loginOnWeb(page, USERS.TEACHER);
    await use(page);
  },

  studentPage: async ({ page }, use) => {
    await loginOnWeb(page, USERS.STUDENT);
    await use(page);
  },
});

export { expect };
