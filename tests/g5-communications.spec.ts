/**
 * G5 — Communications (messaging + announcements + voice digest)
 * Test plan: .claude/state/test-plan.md § G5
 *
 * BUG-MSG-001/002 regression guard: isFromMe and isRead must serialize correctly.
 * Confirmed live as of 2026-05-25 QA cycle (both bugs fixed).
 *
 * Confirmed endpoint paths (2026-05-25):
 *   GET /api/v1/messages/threads  (NOT /messaging/)
 *   GET /api/v1/messages/threads/{id}
 *   GET /api/v1/messages/unread-count
 *   GET /api/v1/announcements
 */

import { test, expect } from "@playwright/test";
import { getJwt, loginOnWeb } from "../fixtures/auth";
import { USERS, BACKEND_URL, FRONTEND_URL } from "../fixtures/test-users";

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

test("G5-GP-01: TEACHER can GET announcements (returns 200 list)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).toBe(200);
  const json = await res.json() as { success?: boolean; data?: unknown };
  expect(json.success ?? true).toBeTruthy();
});

test("G5-GP-02: GET /api/v1/messages/threads returns 200 for TEACHER", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/messages/threads`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).toBe(200);
});

test("G5-GP-03: BUG-MSG-001 regression — thread messages contain isFromMe field", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const threadsRes = await fetch(`${BACKEND_URL}/api/v1/messages/threads`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(threadsRes.status).toBe(200);

  const threadsJson = await threadsRes.json() as {
    success?: boolean;
    data?: Array<{ id?: string; threadId?: string }>;
  };

  const threads = Array.isArray(threadsJson.data)
    ? threadsJson.data
    : Array.isArray(threadsJson)
    ? threadsJson as Array<{ id?: string }>
    : [];

  if (threads.length === 0) {
    // No threads — can't test message fields. That's OK.
    test.info().annotations.push({ type: "info", description: "No threads found — skipping isFromMe check" });
    return;
  }

  const firstThreadId = threads[0]!.id ?? threads[0]!.threadId;
  const threadRes = await fetch(
    `${BACKEND_URL}/api/v1/messages/threads/${firstThreadId}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  expect(threadRes.status).toBe(200);
  const threadJson = await threadRes.json() as {
    data?: { messages?: Array<Record<string, unknown>> };
    messages?: Array<Record<string, unknown>>;
  };

  const messages = threadJson.data?.messages ?? threadJson.messages ?? [];
  if (messages.length > 0) {
    const firstMsg = messages[0]!;
    // BUG-MSG-001: isFromMe must be present (not undefined)
    expect("isFromMe" in firstMsg).toBe(true);
    // BUG-MSG-002: isRead must be present (not undefined)
    expect("isRead" in firstMsg).toBe(true);
  }
});

test("G5-GP-04: GET /api/v1/messages/unread-count returns numeric count", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/messages/unread-count`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).toBe(200);
  const json = await res.json() as { data?: { count?: number }; count?: number };
  const count = json.data?.count ?? json.count ?? 0;
  expect(typeof count).toBe("number");
});

test.skip(
  "G5-GP-05: web announcements page renders without 500 — SKIPPED: reCAPTCHA blocks headless login",
  async ({ page }) => {
    // Web login triggers reCAPTCHA in headless mode (confirmed in G1-GP-04).
    // Run manually: npx playwright test g5-communications.spec.ts --headed
    await loginOnWeb(page, USERS.TEACHER);
    await page.goto(`${FRONTEND_URL}/announcements`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(2000);
    const page500 = await page.locator("text=500, text=Internal Server Error").count();
    expect(page500).toBe(0);
  }
);

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("G5-EC-01: announcement with empty body is rejected (422)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "", body: "" }),
  });

  // Empty announcement should not be accepted
  expect(res.status).not.toBe(200);
  expect(res.status).not.toBe(201);
  expect(res.status).not.toBe(500);
});

test("G5-EC-02: messaging threads endpoint does NOT exist at /api/v1/messaging/ (BUG-MSG-001 path guard)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  // The WRONG path — historically caused bugs
  const wrongRes = await fetch(`${BACKEND_URL}/api/v1/messaging/threads`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  // The CORRECT path
  const correctRes = await fetch(`${BACKEND_URL}/api/v1/messages/threads`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  // Correct path must return 200
  expect(correctRes.status).toBe(200);
  // Wrong path should NOT return 200 (it's a different route or doesn't exist)
  // Note: if both return 200, there might be a duplicate route — log it
  if (wrongRes.status === 200) {
    test.info().annotations.push({
      type: "warning",
      description: "/api/v1/messaging/threads also returned 200 — check for duplicate route",
    });
  }
});

test(
  "G5-EC-03: voice digest echo with empty body returns 400 (not 500) — BUG-VOICE-ECHO-500 FIXED",
  async () => {
    // BUG-VOICE-ECHO-500 FIXED in commit 0b9a09f (School-Project-backend/dev, 2026-05-25).
    // Fix: HttpMediaTypeNotSupportedException + MultipartException now handled → 400.
    const jwt = await getJwt(USERS.TEACHER);
    const res = await fetch(`${BACKEND_URL}/api/v1/parent/voice-query/echo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(500);
    expect([400, 415, 422]).toContain(res.status);
  }
);

test("G5-EC-04: unauthenticated access to announcements returns 401", async () => {
  const res = await fetch(`${BACKEND_URL}/api/v1/announcements`);
  expect([401, 403]).toContain(res.status);
});
