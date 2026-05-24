/**
 * Playwright globalSetup — pre-fetches JWTs for all working test phones once
 * before any workers start. Writes to .auth-cache.json in the test output dir.
 * Workers read this file via the getJwt() helper.
 *
 * This avoids rate-limiting (HTTP 429) when 3-4 workers call test-login in parallel.
 */

import { FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const AUTH_URL = process.env.AUTH_URL || "https://auth-dev.zydenlabs.com";
const CACHE_FILE = path.join(__dirname, "..", ".auth-cache.json");

const PHONES_TO_PREFETCH = [
  "+919999999995", // TEACHER — confirmed working
  "+919999999996", // STUDENT — confirmed working
];

async function fetchJwt(phone: string): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_URL}/auth/test-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    });

    if (res.status === 429) {
      console.warn(`[global-setup] Rate limited for ${phone} — retrying in 30s`);
      await new Promise((r) => setTimeout(r, 30000));
      return fetchJwt(phone);
    }

    if (!res.ok) {
      console.warn(`[global-setup] test-login failed for ${phone}: HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      success: boolean;
      data?: { accessToken: string };
    };

    return json.data?.accessToken ?? null;
  } catch (err) {
    console.error(`[global-setup] Network error fetching JWT for ${phone}:`, err);
    return null;
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log("[global-setup] Pre-fetching JWTs for test phones...");

  const cache: Record<string, { token: string; fetchedAt: number }> = {};

  // Fetch sequentially to respect rate limit (1 req/sec)
  for (const phone of PHONES_TO_PREFETCH) {
    const token = await fetchJwt(phone);
    if (token) {
      cache[phone] = { token, fetchedAt: Date.now() };
      console.log(`[global-setup] JWT cached for ${phone.slice(-4)}`);
    }
    // Small delay between requests to stay under rate limit
    await new Promise((r) => setTimeout(r, 1500));
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`[global-setup] JWT cache written to ${CACHE_FILE}`);
}
