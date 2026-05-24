/**
 * DB seed/cleanup helpers for Zyden Edu E2E tests.
 *
 * Uses the `qa_test_writer` Postgres role which has INSERT/UPDATE/DELETE
 * only on rows where school_id = 'school-test-qa'.
 *
 * If POSTGRES_QA_WRITER_URL is not set, functions log a warning and no-op.
 * Tests can still run against live school-001 data without seeding.
 *
 * BLOCKER-POSTGRES-MCP-WRITE-001: RESOLVED 2026-05-25 — qa_test_writer role created.
 */

import type { Client } from "pg";

const QA_SCHOOL_ID = "school-test-qa";

function getClient(): Client | null {
  const url = process.env.POSTGRES_QA_WRITER_URL;
  if (!url) {
    console.warn(
      "[seed.ts] POSTGRES_QA_WRITER_URL not set — DB seed/cleanup disabled. Tests run against live school-001 data."
    );
    return null;
  }
  // Dynamic import to avoid hard-fail when pg is not installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("pg") as typeof import("pg");
  return new Client({ connectionString: url });
}

/**
 * Insert a test row into `tableName`.
 * Row MUST include school_id: 'school-test-qa' (enforced by the qa_test_writer role).
 * Returns the inserted row or null if seed is disabled.
 */
export async function seedTestRow(
  tableName: string,
  row: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const client = getClient();
  if (!client) return null;

  const rowWithSchool = { ...row, school_id: QA_SCHOOL_ID };
  const columns = Object.keys(rowWithSchool);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const values = Object.values(rowWithSchool);

  try {
    await client.connect();
    const result = await client.query(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return (result.rows[0] as Record<string, unknown>) ?? null;
  } catch (err) {
    console.error(`[seed.ts] Failed to seed ${tableName}:`, err);
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Delete all rows in `tableName` where school_id = 'school-test-qa'.
 * Safe to call multiple times (idempotent).
 */
export async function cleanupTestRows(tableName: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    await client.connect();
    await client.query(
      `DELETE FROM ${tableName} WHERE school_id = $1`,
      [QA_SCHOOL_ID]
    );
  } catch (err) {
    console.error(`[seed.ts] Failed to cleanup ${tableName}:`, err);
    // Don't rethrow — cleanup failures shouldn't fail tests
  } finally {
    await client.end();
  }
}
