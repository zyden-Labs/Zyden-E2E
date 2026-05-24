import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://school-dev.zydenlabs.com";
const BACKEND_URL =
  process.env.BACKEND_URL || "https://school-api-dev.zydenlabs.com";
const AUTH_URL =
  process.env.AUTH_URL || "https://auth-dev.zydenlabs.com";

export { FRONTEND_URL, BACKEND_URL, AUTH_URL };

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./fixtures/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 3 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["html"]],
  timeout: 30000,
  outputDir: "test-results",

  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
