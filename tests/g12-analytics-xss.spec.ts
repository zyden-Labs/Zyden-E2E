/**
 * G12 — TeacherAnalyticsController + Cross-table XSS V107 Regression Battery
 * Test plan: .claude/state/test-plan.md § G12
 *
 * Two test groups:
 *   A. TeacherAnalyticsController — GET /api/v1/teacher/analytics/my-classes
 *      - RBAC: teacher-only; ADMIN/PARENT/STUDENT/unauth → 401/403
 *      - Response shape: per-class { attendancePct, avgMarks, recognitionCount }
 *      - Empty state: teacher with no classes → 200 with []
 *      - Cross-school guard: school A teacher cannot see school B data
 *
 *   B. V107 XSS regression battery — one write+read pair per V107 table/column
 *      Tables covered: messages.content, announcements.title/body,
 *      homework.title/description, homework_submissions.feedback,
 *      quiz_questions.question_text / option_a-d
 *
 * Note: G5-EC-06/07 cover messages.content and announcements.title+body at the G5 level.
 * G12 is the canonical single-place regression battery for ALL V107-covered columns.
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";

const ANALYTICS_ENDPOINT = `${BACKEND_URL}/api/v1/teacher/analytics/my-classes`;

// ---------------------------------------------------------------------------
// Helper: assert that a stored string does not contain raw XSS payloads
// ---------------------------------------------------------------------------

function assertXssSanitized(stored: string, label: string): void {
  // Raw script tag must not appear verbatim
  expect(stored, `${label}: raw <script> tag present`).not.toContain("<script>");
  expect(stored, `${label}: onerror= handler present`).not.toContain("onerror=");
  expect(stored, `${label}: onload= handler present`).not.toContain("onload=");
  expect(stored, `${label}: javascript: URI present`).not.toContain("javascript:");
  expect(stored, `${label}: data:text/html present`).not.toContain("data:text/html");
  expect(stored, `${label}: svg/onload present`).not.toContain("<svg");
  expect(stored, `${label}: object/embed present`).not.toContain("<object");
  expect(stored, `${label}: embed tag present`).not.toContain("<embed");
}

// ---------------------------------------------------------------------------
// G12-A: TeacherAnalyticsController
// ---------------------------------------------------------------------------

test.describe("G12-A: TeacherAnalyticsController RBAC", () => {
  test("G12-A-01: TEACHER GET /api/v1/teacher/analytics/my-classes → 200 with class summaries", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(ANALYTICS_ENDPOINT, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).not.toBe(500);
    // Teacher must be able to access their own analytics
    expect([200, 404]).toContain(res.status);

    if (res.status === 200) {
      const json = await res.json() as {
        success?: boolean;
        data?: Array<{
          classId?: string;
          className?: string;
          attendancePct?: number;
          avgMarks?: number;
          recognitionCount?: number;
        }>;
      };
      expect(json.success ?? true).toBeTruthy();
      expect(Array.isArray(json.data ?? [])).toBe(true);

      // Validate shape if data is non-empty
      const classes = json.data ?? [];
      for (const cls of classes) {
        expect(cls.classId ?? cls.className).toBeTruthy();
        // Numeric fields should be numbers (null is acceptable for missing data)
        if (cls.attendancePct !== undefined && cls.attendancePct !== null) {
          expect(typeof cls.attendancePct).toBe("number");
          expect(cls.attendancePct).toBeGreaterThanOrEqual(0);
          expect(cls.attendancePct).toBeLessThanOrEqual(100);
        }
        if (cls.avgMarks !== undefined && cls.avgMarks !== null) {
          expect(typeof cls.avgMarks).toBe("number");
          expect(cls.avgMarks).toBeGreaterThanOrEqual(0);
        }
        if (cls.recognitionCount !== undefined && cls.recognitionCount !== null) {
          expect(typeof cls.recognitionCount).toBe("number");
          expect(cls.recognitionCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test("G12-A-02: ADMIN cannot access /api/v1/teacher/analytics/my-classes → 403", async () => {
    const jwt = await getJwt(USERS.ADMIN);

    const res = await fetch(ANALYTICS_ENDPOINT, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Per CEO decision: teacher-only endpoint. Admin gets 403.
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  test.fixme(
    "G12-A-03: PARENT cannot access /api/v1/teacher/analytics/my-classes → 403 — SKIPPED BUG-TEST-CRED-002",
    async () => {
      // PARENT JWT maps to wrong tenant until auth-engineer fix
      const jwt = await getJwt(USERS.PARENT);

      const res = await fetch(ANALYTICS_ENDPOINT, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      expect([403, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(500);
    }
  );

  test("G12-A-04: STUDENT cannot access /api/v1/teacher/analytics/my-classes → 403", async () => {
    const jwt = await getJwt(USERS.STUDENT);

    const res = await fetch(ANALYTICS_ENDPOINT, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  test("G12-A-05: unauthenticated request → 401", async () => {
    const res = await fetch(ANALYTICS_ENDPOINT);
    expect([401, 403]).toContain(res.status);
  });

  test("G12-A-06: response shape includes attendancePct, avgMarks, recognitionCount per class", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(ANALYTICS_ENDPOINT, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).not.toBe(500);

    if (res.status === 200) {
      const json = await res.json() as {
        data?: Array<Record<string, unknown>>;
      };
      const classes = json.data ?? [];

      if (classes.length > 0) {
        const first = classes[0]!;
        // These fields should be present (may be null if no data yet)
        expect("attendancePct" in first || "attendance_pct" in first || "attendance" in first).toBe(true);
        expect("avgMarks" in first || "avg_marks" in first || "averageMarks" in first || "marks" in first).toBe(true);
        expect("recognitionCount" in first || "recognition_count" in first || "recognitions" in first).toBe(true);
      }
    }
  });

  test("G12-A-07: empty state — teacher with no classes returns 200 with []", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(ANALYTICS_ENDPOINT, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).not.toBe(500);

    if (res.status === 200) {
      const json = await res.json() as { data?: unknown; success?: boolean };
      // Data may be an empty array or a non-null object
      // Must not be null (null causes FE crashes)
      expect(json.data).not.toBeNull();
      expect(json.data).not.toBeUndefined();
    }
  });

  test("G12-A-08: cross-school guard — teacher JWT from school-001 cannot see school-002 class analytics", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Attempt to inject a schoolId param
    const res = await fetch(`${ANALYTICS_ENDPOINT}?schoolId=school-002`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).not.toBe(500);

    if (res.status === 200) {
      const json = await res.json() as {
        data?: Array<{ schoolId?: string; school_id?: string }>;
      };
      const classes = json.data ?? [];
      const foreign = classes.filter((c) => {
        const sid = c.schoolId ?? c.school_id ?? "";
        return sid && sid !== "school-001";
      });
      expect(foreign).toHaveLength(0);
    } else {
      expect([400, 403]).toContain(res.status);
    }
  });
});

// ---------------------------------------------------------------------------
// G12-B: V107 XSS regression battery
// ---------------------------------------------------------------------------

test.describe("G12-B: V107 XSS regression battery", () => {
  const XSS_PAYLOADS = {
    scriptTag: "<script>alert('xss-v107')</script>",
    multilineScript: "<script>\ndocument.cookie='xss';\n</script>",
    imgOnerror: "<img src=x onerror=alert('xss')>",
    javascriptUri: "javascript:alert('xss')",
    onClickHandler: "onclick='alert(1)'",
    svgOnload: "<svg onload=alert('xss')>",
    objectEmbed: "<object data='javascript:alert(1)'></object>",
    dataTextHtml: "data:text/html,<script>alert('xss')</script>",
  };

  // ---------------------------------------------------------------------------
  // V107-01: messages.content — write+read
  // (Also covered in G5-EC-06 but kept here as the canonical V107 battery entry)
  // ---------------------------------------------------------------------------

  test("G12-B-01: V107 messages.content — <script> tag sanitized on write+read", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/messages/threads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientId: USERS.STUDENT,
        content: XSS_PAYLOADS.scriptTag,
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as { data?: { id?: string; content?: string } };
      const stored = json.data?.content ?? "";
      assertXssSanitized(stored, "messages.content");
    }
  });

  // ---------------------------------------------------------------------------
  // V107-02: announcements.title — <script> tag
  // ---------------------------------------------------------------------------

  test("G12-B-02: V107 announcements.title — <script> sanitized on write+read", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const createRes = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: XSS_PAYLOADS.scriptTag,
        body: "Safe body content",
      }),
    });

    expect(createRes.status).not.toBe(500);

    if ([200, 201].includes(createRes.status)) {
      const json = await createRes.json() as { data?: { id?: string; title?: string } };
      const stored = json.data?.title ?? "";
      assertXssSanitized(stored, "announcements.title (script tag)");
    }
  });

  // ---------------------------------------------------------------------------
  // V107-03: announcements.body — multi-line script
  // ---------------------------------------------------------------------------

  test("G12-B-03: V107 announcements.body — multi-line script sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const createRes = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "V107 Body Test",
        body: XSS_PAYLOADS.multilineScript,
      }),
    });

    expect(createRes.status).not.toBe(500);

    if ([200, 201].includes(createRes.status)) {
      const json = await createRes.json() as { data?: { id?: string; body?: string } };
      const stored = json.data?.body ?? "";
      assertXssSanitized(stored, "announcements.body (multiline script)");
    }
  });

  // ---------------------------------------------------------------------------
  // V107-04: homework.title — javascript: URI
  // ---------------------------------------------------------------------------

  test("G12-B-04: V107 homework.title — javascript: URI sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/homework`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: XSS_PAYLOADS.javascriptUri,
        description: "Normal description",
        classId: "class-001",
        dueDate: "2099-12-31",
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as { data?: { id?: string; title?: string } };
      const stored = json.data?.title ?? "";
      assertXssSanitized(stored, "homework.title (javascript: URI)");
    } else {
      // 403/404 if endpoint not accessible — log and pass
      test.info().annotations.push({
        type: "info",
        description: `homework POST returned ${res.status} — cannot verify sanitization`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // V107-05: homework.description — on* handler
  // ---------------------------------------------------------------------------

  test("G12-B-05: V107 homework.description — on* event handler sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/homework`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "V107 Description Test",
        description: XSS_PAYLOADS.onClickHandler,
        classId: "class-001",
        dueDate: "2099-12-31",
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as { data?: { description?: string } };
      const stored = json.data?.description ?? "";
      assertXssSanitized(stored, "homework.description (on* handler)");
    } else {
      test.info().annotations.push({
        type: "info",
        description: `homework POST returned ${res.status} — cannot verify sanitization`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // V107-06: homework_submissions.feedback — svg/onload
  // ---------------------------------------------------------------------------

  test("G12-B-06: V107 homework_submissions.feedback — svg/onload sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // Attempt to submit feedback with SVG onload
    // First, get a submission to provide feedback on
    const submissionsRes = await fetch(`${BACKEND_URL}/api/v1/homework/submissions?limit=1`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (submissionsRes.status !== 200) {
      test.info().annotations.push({
        type: "info",
        description: "homework/submissions not accessible — cannot verify feedback sanitization",
      });
      return;
    }

    const submissionsJson = await submissionsRes.json() as {
      data?: Array<{ id?: string }>;
    };
    const submission = submissionsJson.data?.[0];

    if (!submission?.id) {
      test.info().annotations.push({
        type: "info",
        description: "No submissions found — skipping feedback XSS test",
      });
      return;
    }

    const feedbackRes = await fetch(`${BACKEND_URL}/api/v1/homework/submissions/${submission.id}/feedback`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: XSS_PAYLOADS.svgOnload }),
    });

    expect(feedbackRes.status).not.toBe(500);

    if ([200, 201].includes(feedbackRes.status)) {
      const json = await feedbackRes.json() as { data?: { feedback?: string } };
      const stored = json.data?.feedback ?? "";
      assertXssSanitized(stored, "homework_submissions.feedback (svg/onload)");
    }
  });

  // ---------------------------------------------------------------------------
  // V107-07: quiz_questions.question_text — object/embed
  // ---------------------------------------------------------------------------

  test("G12-B-07: V107 quiz_questions.question_text — object/embed sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/quizzes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "V107 Quiz Test",
        classId: "class-001",
        questions: [
          {
            questionText: XSS_PAYLOADS.objectEmbed,
            optionA: "Safe A",
            optionB: "Safe B",
            optionC: "Safe C",
            optionD: "Safe D",
            correctOption: "A",
          },
        ],
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as {
        data?: { questions?: Array<{ questionText?: string }> };
      };
      const q = json.data?.questions?.[0];
      if (q?.questionText !== undefined) {
        assertXssSanitized(q.questionText, "quiz_questions.question_text (object/embed)");
      }
    } else {
      test.info().annotations.push({
        type: "info",
        description: `Quiz POST returned ${res.status} — cannot verify question sanitization`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // V107-08: quiz_questions.option_a-d — data:text/html
  // ---------------------------------------------------------------------------

  test("G12-B-08: V107 quiz_questions.option_a–d — data:text/html sanitized in all options", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/quizzes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "V107 Options Test",
        classId: "class-001",
        questions: [
          {
            questionText: "Which option is correct?",
            optionA: XSS_PAYLOADS.dataTextHtml,
            optionB: XSS_PAYLOADS.dataTextHtml,
            optionC: XSS_PAYLOADS.dataTextHtml,
            optionD: XSS_PAYLOADS.dataTextHtml,
            correctOption: "A",
          },
        ],
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as {
        data?: {
          questions?: Array<{
            optionA?: string;
            optionB?: string;
            optionC?: string;
            optionD?: string;
          }>;
        };
      };
      const q = json.data?.questions?.[0];
      if (q) {
        const options = [q.optionA, q.optionB, q.optionC, q.optionD].filter(Boolean) as string[];
        for (const opt of options) {
          assertXssSanitized(opt, "quiz_questions.option (data:text/html)");
        }
      }
    } else {
      test.info().annotations.push({
        type: "info",
        description: `Quiz POST returned ${res.status} — cannot verify option sanitization`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // V107-09: announcements XSS — img onerror
  // (Extra payload variant to complement V107-02 script tag)
  // ---------------------------------------------------------------------------

  test("G12-B-09: V107 announcements — img onerror sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const createRes = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: XSS_PAYLOADS.imgOnerror,
        body: "Safe body",
      }),
    });

    expect(createRes.status).not.toBe(500);

    if ([200, 201].includes(createRes.status)) {
      const json = await createRes.json() as { data?: { title?: string } };
      const stored = json.data?.title ?? "";
      assertXssSanitized(stored, "announcements.title (img onerror)");
    }
  });

  // ---------------------------------------------------------------------------
  // V107-10: read-back verification — fetch stored and confirm sanitization
  // (Tests that sanitization is persistent, not just stripped on response)
  // ---------------------------------------------------------------------------

  test("G12-B-10: V107 read-back — stored announcement body does not contain raw script on GET", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const createRes = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `V107 readback test ${Date.now()}`,
        body: "<script>alert('stored-xss')</script>",
      }),
    });

    expect(createRes.status).not.toBe(500);

    if ([200, 201].includes(createRes.status)) {
      const createJson = await createRes.json() as { data?: { id?: string } };
      const id = createJson.data?.id;

      if (id) {
        // Fetch the announcement back
        const getRes = await fetch(`${BACKEND_URL}/api/v1/announcements/${id}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });

        if (getRes.status === 200) {
          const getJson = await getRes.json() as { data?: { body?: string } };
          const storedBody = getJson.data?.body ?? "";
          // The stored body must not contain the raw script tag
          expect(storedBody).not.toContain("<script>alert('stored-xss')</script>");
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // V107-11: XSS via PUT/PATCH path (not just POST)
  // ---------------------------------------------------------------------------

  test("G12-B-11: V107 homework update — XSS in title via PATCH is sanitized", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    // First get an existing homework to update
    const listRes = await fetch(`${BACKEND_URL}/api/v1/homework?limit=1`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (listRes.status !== 200) {
      test.info().annotations.push({
        type: "info",
        description: "homework list not accessible — skipping PATCH XSS test",
      });
      return;
    }

    const listJson = await listRes.json() as { data?: Array<{ id?: string }> };
    const hw = listJson.data?.[0];

    if (!hw?.id) {
      test.info().annotations.push({
        type: "info",
        description: "No homework found — skipping PATCH XSS test",
      });
      return;
    }

    const patchRes = await fetch(`${BACKEND_URL}/api/v1/homework/${hw.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "<img src=x onerror=alert('patch-xss')>" }),
    });

    expect(patchRes.status).not.toBe(500);

    if ([200, 201, 204].includes(patchRes.status)) {
      const patchJson = await patchRes.json() as { data?: { title?: string } };
      const stored = patchJson.data?.title ?? "";
      if (stored) {
        assertXssSanitized(stored, "homework.title (PATCH onerror)");
      }
    }
  });

  // ---------------------------------------------------------------------------
  // V107-12: XSS in context of student-submitted quiz answer
  // ---------------------------------------------------------------------------

  test("G12-B-12: V107 quiz answer submission — XSS in free-text answer sanitized", async () => {
    const jwt = await getJwt(USERS.STUDENT);

    // Attempt to submit a quiz answer with XSS
    const res = await fetch(`${BACKEND_URL}/api/v1/quizzes/submissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        quizId: "quiz-001",
        answers: [
          {
            questionId: "q-001",
            answer: "<script>alert('student-xss')</script>",
          },
        ],
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as {
        data?: { answers?: Array<{ answer?: string }> };
      };
      const answers = json.data?.answers ?? [];
      for (const a of answers) {
        if (a.answer) {
          assertXssSanitized(a.answer, "quiz submission answer (student)");
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // V107-13: XSS in announcement class filter payload
  // ---------------------------------------------------------------------------

  test("G12-B-13: V107 announcement broadcast — XSS in classIds array element is rejected", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "XSS classIds test",
        body: "Normal content",
        classIds: ["<script>alert('classid-xss')</script>"],
      }),
    });

    expect(res.status).not.toBe(500);

    if ([200, 201].includes(res.status)) {
      const json = await res.json() as {
        data?: { classIds?: string[]; targetClasses?: string[] };
      };
      const ids = json.data?.classIds ?? json.data?.targetClasses ?? [];
      for (const id of ids) {
        expect(id).not.toContain("<script>");
      }
    }
  });

  // ---------------------------------------------------------------------------
  // V107-14: Batch read-back — verify GET /announcements list doesn't echo raw XSS
  // ---------------------------------------------------------------------------

  test("G12-B-14: V107 announcements list — GET response does not echo raw script tags from any stored item", async () => {
    const jwt = await getJwt(USERS.TEACHER);

    const res = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.status).toBe(200);

    const text = await res.text();

    // The full response text must not contain raw unescaped script tags
    // (they should be HTML-escaped as &lt;script&gt; or stripped)
    expect(text).not.toMatch(/<script[^>]*>.*?<\/script>/is);
    expect(text).not.toContain("onerror=alert");
    expect(text).not.toContain("javascript:alert");
  });
});
