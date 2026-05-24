# Zyden Edu — Playwright E2E Test Suite

Automated end-to-end tests for the Zyden Edu SaaS platform, targeting all 10 feature groups defined in `.claude/state/test-plan.md`.

**Targets:**
- Frontend: https://school-dev.zydenlabs.com
- Backend API: https://school-api-dev.zydenlabs.com
- Auth service: https://auth-dev.zydenlabs.com

---

## Running locally

### Prerequisites

- Node.js 20+
- Access to the dev environment (VPN not required — all targets are public dev)

### Setup

```bash
cd e2e-playwright
npm install
npx playwright install chromium   # minimum for local runs
cp .env.example .env.local        # fill in POSTGRES_QA_WRITER_URL if you have it
```

### Run all tests

```bash
npm test
# or
npx playwright test
```

### Run a single feature group

```bash
npm run test:g1    # Auth
npm run test:g2    # Attendance
npm run test:g3    # Marks
npm run test:g4    # Fees
npm run test:g5    # Communications
npm run test:g6    # NL Queries
npm run test:g7    # Document AI
npm run test:g8    # Reports
npm run test:g9    # RBAC / Settings
npm run test:g10   # Cross-cutting
```

Or use the grep flag directly:

```bash
npx playwright test --grep G1
npx playwright test --grep "G5|G8"
```

### View the HTML report

```bash
npm run report
# opens playwright-report/index.html in browser
```

### Run a single test in headed mode (for debugging)

```bash
npx playwright test tests/g1-auth.spec.ts --headed --debug
```

---

## Directory structure

```
e2e-playwright/
  playwright.config.ts     # Config: browsers, retries, timeout, reporter
  tsconfig.json
  .env.example             # Template — copy to .env.local, never commit .env.local
  .gitignore

  fixtures/
    auth.ts               # getJwt(phone), loginOnWeb(page, phone), test fixture
    test-users.ts         # USERS constant per role + bug notes on admin/parent
    seed.ts               # DB seed/cleanup via POSTGRES_QA_WRITER_URL

  tests/
    g1-auth.spec.ts
    g2-attendance.spec.ts
    g3-marks.spec.ts
    g4-fees.spec.ts
    g5-communications.spec.ts
    g6-nl-queries.spec.ts
    g7-document-ai.spec.ts
    g8-reports.spec.ts
    g9-settings-rbac.spec.ts
    g10-cross-cutting.spec.ts

  .github/
    workflows/
      e2e.yml             # CI: runs on PR + nightly 02:00 IST
```

---

## Adding new tests

1. Find the correct spec file for the feature group (G1–G10).
2. Follow the naming pattern: `G<n>-<TYPE>-<index>: <short description>`.
   - Types: `GP` = golden path, `EC` = edge case, `HEALTH`, `SEC`, `A11Y`
3. Use `getJwt(USERS.TEACHER)` for API-level tests (fastest, no browser needed).
4. Use `loginOnWeb(page, phone)` for full web flow tests.
5. If a feature is not yet built, use `test.skip()` with a reason string.
6. If a test is blocked by a known bug, use `test.fixme("BUG-ID: description")`.

### Auth in tests

```typescript
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";

test("my test", async () => {
  const jwt = await getJwt(USERS.TEACHER);
  const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(res.status).toBe(200);
});
```

### Web login in tests

```typescript
import { loginOnWeb } from "../fixtures/auth";
import { USERS, FRONTEND_URL } from "../fixtures/test-users";

test("web test", async ({ page }) => {
  await loginOnWeb(page, USERS.TEACHER);
  // page is now logged in, on the dashboard
  await expect(page.locator("nav")).toBeVisible();
});
```

---

## CI workflow

The suite runs automatically via `.github/workflows/e2e.yml`:

- **On every PR** to `main` or `dev`
- **On every push** to `main` or `dev`
- **Nightly at 02:00 IST** (20:30 UTC cron)
- **Manual trigger** via GitHub Actions "Run workflow" (supports a `grep` input to run a specific group)

The workflow runs on `ubuntu-latest`, installs Playwright with Chromium only (to minimize CI minutes), and uploads the HTML report as an artifact for 14 days.

### GitHub Actions secrets required

| Secret | Value | Where to set |
|---|---|---|
| `POSTGRES_QA_WRITER_URL` | `postgresql://qa_test_writer:<password>@<host>:5432/school_dev` | GitHub repo Settings > Secrets > Actions |

Without `POSTGRES_QA_WRITER_URL`, the DB seed/cleanup steps are silently skipped and tests run against live school-001 data only.

### Adding Slack notifications

In `.github/workflows/e2e.yml`, uncomment the `curl` line in the `notify-on-failure` job and set the `SLACK_WEBHOOK_URL` secret.

---

## 20-minute CEO cron integration

The CEO cron tick (at `~/.claude/scheduled-tasks/ceo-tick-20min/SKILL.md`) includes a step to run Playwright tests for the feature groups touched by recent commits.

The mapping is:
| Recent commit path | Playwright grep pattern |
|---|---|
| `auth_service/**`, `**/auth/**` | `G1` |
| `**/attendance/**`, `**/face/**` | `G2` |
| `**/marks/**`, `**/exam*` | `G3` |
| `**/payment/**`, `**/fee*` | `G4` |
| `**/announcement*`, `**/messaging*` | `G5` |
| `**/ai/**`, `**/nlquery*` | `G6` |
| `**/document*`, `**/library*` | `G7` |
| `**/analytics*`, `**/dashboard*` | `G8` |
| `**/admin/settings*`, `**/rbac*` | `G9` |
| `**/security*`, `**/pii/**` | `G10` |

The cron runs:
```bash
cd /Users/zaid/projects/edu-saas-new-platform/e2e-playwright
npx playwright test --grep G1   # (or whichever groups are affected)
```

---

## Debugging a red run

1. Download the `playwright-report-<run-id>` artifact from GitHub Actions.
2. Unzip and open `index.html` in a browser.
3. Click a failed test to see screenshots, traces, and console logs.
4. For `test.fixme()` tests: these are expected failures — check the linked bug ID in the test annotation.
5. For `test.skip()` tests: these are permanently skipped features — no action needed.

To reproduce locally:

```bash
npx playwright test tests/g1-auth.spec.ts --trace on
npx playwright show-trace test-results/g1-auth-*.zip
```

---

## Known limitations

- **Admin/Parent tests** are `test.fixme()` due to BUG-TEST-CRED-001 (admin) and BUG-TEST-CRED-002 (parent) — wrong tenant mapping. Will unblock when auth-engineer fixes the phone-to-membership mapping for school-001.
- **Android/mobile** tests are `test.skip()` — not applicable for Playwright (use adb + scripts/screencap.sh for mobile). Mobile QA is driven separately via the CEO cron adb flow.
- **Performance tests** (G10 Lighthouse) require Lighthouse CLI and are skipped in standard CI. Dispatched as part of the weekly CEO cron `/benchmark` sweep.
- **BLOCKER-T7-DRIVE-001**: Android emulator-based tests are blocked until Samsung T7 drive is mounted. Not relevant to this Playwright suite (it's web+API only) but documented for completeness.

---

## Test plan reference

Full feature group definitions, golden paths, and edge cases: `/Users/zaid/projects/edu-saas-new-platform/.claude/state/test-plan.md`
