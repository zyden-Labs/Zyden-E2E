/**
 * Test phone numbers per role for Zyden Edu dev environment.
 * All accounts use OTP 123456 for web login.
 * For API-level testing, POST /auth/test-login returns a JWT directly.
 *
 * Bug notes:
 * - BUG-TEST-CRED-001: ADMIN phone (+919999999999) maps to wrong tenant (islam313, not school-001).
 *   Tests that need ADMIN role on school-001 use test.fixme() until auth-engineer fixes the mapping.
 * - BUG-TEST-CRED-002: PARENT phone (+919999999997) maps to wrong tenant (Ecommerce_Customer).
 *   Tests that need PARENT role on school-001 use test.fixme() until auth-engineer fixes the mapping.
 */
export const USERS = {
  TEACHER: "+919999999995",
  STUDENT: "+919999999996",
  ADMIN: "+919999999999",   // BUG-TEST-CRED-001 — wrong tenant until fixed
  PARENT: "+919999999997",  // BUG-TEST-CRED-002 — wrong tenant until fixed
} as const;

export type UserRole = keyof typeof USERS;

/** Phones confirmed working as of 2026-05-25 QA cycle */
export const WORKING_USERS = {
  TEACHER: USERS.TEACHER,
  STUDENT: USERS.STUDENT,
} as const;

export const AUTH_URL =
  process.env.AUTH_URL || "https://auth-dev.zydenlabs.com";
export const BACKEND_URL =
  process.env.BACKEND_URL || "https://school-api-dev.zydenlabs.com";
export const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://school-dev.zydenlabs.com";
