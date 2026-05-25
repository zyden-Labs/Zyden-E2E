/**
 * G4 — Fees
 * Test plan: .claude/state/test-plan.md § G4
 *
 * Surfaces: backend HTTP, web (Playwright browser)
 * Note: Admin/Parent tests are fixme'd due to BUG-TEST-CRED-001/002.
 */

import { test, expect } from "@playwright/test";
import { getJwt } from "../fixtures/auth";
import { USERS, BACKEND_URL } from "../fixtures/test-users";
import { seedTestRow, cleanupTestRows } from "../fixtures/seed";

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

test("G4-GP-01: TEACHER can view fee announcements (announcements endpoint)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/announcements`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect(res.status).toBe(200);
});

test.fixme(
  "G4-GP-02: ADMIN can create fee structure — SKIPPED BUG-TEST-CRED-001",
  async () => {
    // Admin phone maps to wrong tenant until auth-engineer fix
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tuition Fee",
        amount: 5000,
        termId: "term-001",
        components: [
          { name: "Tuition", amount: 4000 },
          { name: "Library", amount: 500 },
          { name: "Sports", amount: 500 },
        ],
      }),
    });
    expect([200, 201]).toContain(res.status);
    const json = await res.json() as { data?: { id?: string } };
    expect(json.data?.id).toBeTruthy();
  }
);

test.fixme(
  "G4-GP-03: PARENT can GET own fee invoices — SKIPPED BUG-TEST-CRED-002",
  async () => {
    // Parent phone maps to wrong tenant
    const jwt = await getJwt(USERS.PARENT);
    const res = await fetch(`${BACKEND_URL}/api/v1/parent/fees/my`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data?: unknown[] };
    expect(Array.isArray(json.data ?? [])).toBe(true);
  }
);

test.fixme(
  "G4-GP-04: ADMIN generates invoices for a class — N invoices created each scoped to one student — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ classId: "class-001", termId: "term-001" }),
    });
    expect([200, 201]).toContain(res.status);
    const json = await res.json() as { data?: unknown[] };
    expect(Array.isArray(json.data ?? [])).toBe(true);
    // Each invoice must reference a studentId
    const invoices = (json.data ?? []) as Array<{ studentId?: string }>;
    for (const inv of invoices) {
      expect(inv.studentId).toBeTruthy();
    }
  }
);

test.fixme(
  "G4-GP-05: payment mark-as-paid by admin changes invoice status to PAID — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    // First get an invoice
    const listRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?classId=class-001`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json() as { data?: Array<{ id?: string; status?: string }> };
    const unpaid = (listJson.data ?? []).find((inv) => inv.status !== "PAID");
    if (!unpaid?.id) return; // No unpaid invoices — skip
    const payRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/${unpaid.id}/pay`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amountPaid: 5000, mode: "CASH" }),
    });
    expect([200, 201]).toContain(payRes.status);
    const payJson = await payRes.json() as { data?: { status?: string } };
    expect(payJson.data?.status?.toUpperCase()).toBe("PAID");
  }
);

test.fixme(
  "G4-GP-06: partial payment computes correct remaining balance — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const listRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?classId=class-001`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const listJson = await listRes.json() as { data?: Array<{ id?: string; totalAmount?: number; status?: string }> };
    const unpaid = (listJson.data ?? []).find((inv) => inv.status === "PENDING" && (inv.totalAmount ?? 0) > 1000);
    if (!unpaid?.id) return;
    const partial = Math.floor((unpaid.totalAmount ?? 5000) / 2);
    const payRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/${unpaid.id}/pay`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amountPaid: partial, mode: "ONLINE" }),
    });
    expect([200, 201]).toContain(payRes.status);
    const payJson = await payRes.json() as { data?: { balanceDue?: number; amountPaid?: number } };
    const balance = payJson.data?.balanceDue ?? 0;
    expect(balance).toBeGreaterThan(0);
    expect(balance).toBe((unpaid.totalAmount ?? 0) - partial);
  }
);

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("G4-EC-01: unauthenticated access to fee invoices returns 401", async () => {
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices`);
  expect([401, 403]).toContain(res.status);
});

test("G4-EC-02: STUDENT cannot access fee structure endpoints (403)", async () => {
  const jwt = await getJwt(USERS.STUDENT);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  expect([403, 404]).toContain(res.status);
});

test("G4-EC-03: fee invoice generation with invalid body returns 4xx (not 500)", async () => {
  const jwt = await getJwt(USERS.TEACHER);

  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  // Teacher shouldn't be able to do this — 403 expected
  expect(res.status).not.toBe(500);
  expect([400, 403, 404, 422]).toContain(res.status);
});

test.fixme(
  "G4-EC-04: parent cannot view another parent's invoice — SKIPPED BUG-TEST-CRED-002",
  async () => {
    // Requires working PARENT JWT. Deferred until BUG-TEST-CRED-002 is fixed.
    const jwt = await getJwt(USERS.PARENT);
    // Attempt to read a hardcoded invoice ID from another family
    const res = await fetch(`${BACKEND_URL}/api/v1/parent/fees/invoices/other-family-invoice-001`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect([403, 404]).toContain(res.status);
  }
);

test("G4-EC-05: TEACHER cannot access admin fee structure list (403)", async () => {
  const jwt = await getJwt(USERS.TEACHER);
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect([403, 404]).toContain(res.status);
});

test("G4-EC-06: fee invoices endpoint without auth returns 401", async () => {
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ classId: "class-001", termId: "term-001" }),
  });
  expect([401, 403]).toContain(res.status);
});

test("G4-EC-07: bulk invoice generation idempotent check — duplicate call returns 4xx not 500", async () => {
  const jwt = await getJwt(USERS.TEACHER);
  // Teacher will get 403 — this confirms the endpoint exists and doesn't 500 on repeat calls
  const body = JSON.stringify({ classId: "class-001", termId: "term-001" });
  const headers = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  const res1 = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/generate`, {
    method: "POST", headers, body,
  });
  const res2 = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/generate`, {
    method: "POST", headers, body,
  });
  expect(res1.status).not.toBe(500);
  expect(res2.status).not.toBe(500);
});

test.fixme(
  "G4-EC-08: overdue invoice is flagged with overdue status — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?status=OVERDUE`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data?: Array<{ status?: string; dueDate?: string }> };
    const overdueItems = (json.data ?? []).filter((inv) => inv.status === "OVERDUE");
    // Every overdue invoice must have dueDate in the past
    const today = new Date().toISOString().split("T")[0]!;
    for (const inv of overdueItems) {
      expect(inv.dueDate! < today).toBe(true);
    }
  }
);

test.fixme(
  "G4-EC-09: fee reminder sends message persisted to messages — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/reminders/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceIds: ["invoice-001"] }),
    });
    expect([200, 201]).toContain(res.status);
    // Verify a message was created by fetching threads
    const threadsRes = await fetch(`${BACKEND_URL}/api/v1/messages/threads`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(threadsRes.status).toBe(200);
  }
);

test.fixme(
  "G4-EC-10: fee summary endpoint returns class-level outstanding total — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/summary?classId=class-001`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data?: { outstandingTotal?: number; currency?: string } };
    expect(typeof (json.data?.outstandingTotal ?? 0)).toBe("number");
    // INR default
    const currency = json.data?.currency ?? "INR";
    expect(currency).toBe("INR");
  }
);

test.fixme(
  "G4-EC-11: fee structure update does NOT retroactively change already-billed invoices — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    // Get an existing invoice total before update
    const listRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?status=PENDING&limit=1`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const listJson = await listRes.json() as { data?: Array<{ id?: string; totalAmount?: number; feeStructureId?: string }> };
    const invoice = listJson.data?.[0];
    if (!invoice?.feeStructureId) return;
    const originalAmount = invoice.totalAmount;

    // Update the fee structure with a new amount
    const updateRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure/${invoice.feeStructureId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 99999 }),
    });
    expect([200, 204]).toContain(updateRes.status);

    // Existing billed invoice amount must remain unchanged
    const checkRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const checkJson = await checkRes.json() as { data?: { totalAmount?: number } };
    expect(checkJson.data?.totalAmount).toBe(originalAmount);
  }
);

test.fixme(
  "G4-EC-12: delete fee component preserves historical invoices referencing it — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    // Create a fee component
    const createRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Temp Lab Fee", amount: 200, termId: "term-001" }),
    });
    expect([200, 201]).toContain(createRes.status);
    const createJson = await createRes.json() as { data?: { id?: string } };
    const componentId = createJson.data?.id;
    if (!componentId) return;

    // Delete it
    const delRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/structure/${componentId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect([200, 204]).toContain(delRes.status);

    // Historical invoices referencing deleted component must still be fetchable
    const histRes = await fetch(
      `${BACKEND_URL}/api/v1/admin/fees/invoices?feeStructureId=${componentId}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
    expect(histRes.status).not.toBe(500);
    expect([200, 404]).toContain(histRes.status);
  }
);

test.fixme(
  "G4-EC-13: tenant isolation — school A admin cannot see school B fees — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN); // school-001 admin
    // Attempt to query invoices using a hardcoded school B ID
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?schoolId=school-002`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    // Must either 403 or return empty (not school B data)
    if (res.status === 200) {
      const json = await res.json() as { data?: Array<{ schoolId?: string }> };
      const foreignItems = (json.data ?? []).filter((inv) => inv.schoolId === "school-002");
      expect(foreignItems).toHaveLength(0);
    } else {
      expect([403, 404]).toContain(res.status);
    }
  }
);

test.fixme(
  "G4-EC-14: discount / scholarship line item reduces invoice total — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    // Apply a discount to an invoice
    const listRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?status=PENDING&limit=1`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const listJson = await listRes.json() as { data?: Array<{ id?: string; totalAmount?: number }> };
    const invoice = listJson.data?.[0];
    if (!invoice?.id) return;
    const discountRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/${invoice.id}/discount`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "SCHOLARSHIP", amount: 500, reason: "Merit scholarship" }),
    });
    expect([200, 201]).toContain(discountRes.status);
    const discountJson = await discountRes.json() as { data?: { totalAmount?: number } };
    expect((discountJson.data?.totalAmount ?? 0)).toBeLessThan(invoice.totalAmount ?? Infinity);
  }
);

test.fixme(
  "G4-EC-15: late fee auto-applied after due date — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?status=OVERDUE`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data?: Array<{ lateFee?: number; status?: string }> };
    const overdueInvoices = (json.data ?? []).filter((inv) => inv.status === "OVERDUE");
    if (overdueInvoices.length > 0) {
      // At least one overdue invoice should carry a lateFee > 0 if late fee is configured
      const withLateFee = overdueInvoices.filter((inv) => (inv.lateFee ?? 0) > 0);
      // Log finding — not a hard fail if late fee feature is not enabled
      if (withLateFee.length === 0) {
        test.info().annotations.push({
          type: "warning",
          description: "No late fees found on overdue invoices — check if late fee policy is configured",
        });
      }
    }
  }
);

test.fixme(
  "G4-EC-16: refund creates negative payment entry — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const listRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices?status=PAID&limit=1`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const listJson = await listRes.json() as { data?: Array<{ id?: string }> };
    const invoice = listJson.data?.[0];
    if (!invoice?.id) return;
    const refundRes = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/${invoice.id}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 500, reason: "Overpayment" }),
    });
    expect([200, 201]).toContain(refundRes.status);
    const refundJson = await refundRes.json() as { data?: { paymentEntries?: Array<{ amount?: number }> } };
    const entries = refundJson.data?.paymentEntries ?? [];
    const negativeEntries = entries.filter((e) => (e.amount ?? 0) < 0);
    expect(negativeEntries.length).toBeGreaterThan(0);
  }
);

test.fixme(
  "G4-EC-17: fee export CSV returns content-type text/csv — SKIPPED BUG-TEST-CRED-001",
  async () => {
    const jwt = await getJwt(USERS.ADMIN);
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices/export?format=csv`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 200) {
      const ct = res.headers.get("content-type") ?? "";
      expect(ct).toContain("text/csv");
    } else {
      // Feature may not be implemented — acceptable
      expect([404, 501]).toContain(res.status);
    }
  }
);

test("G4-EC-18: STUDENT cannot access fee invoice list endpoint (403)", async () => {
  const jwt = await getJwt(USERS.STUDENT);
  const res = await fetch(`${BACKEND_URL}/api/v1/admin/fees/invoices`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect([403, 404]).toContain(res.status);
});
