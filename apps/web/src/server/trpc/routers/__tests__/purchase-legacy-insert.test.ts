import { describe, expect, it, vi } from "vitest";

import { insertPurchaseRequest, loadPurchaseRequestRow } from "../purchase";

function renderSql(query: unknown): string {
  if (
    !query ||
    typeof query !== "object" ||
    !("toQuery" in query) ||
    typeof query.toQuery !== "function"
  ) {
    throw new Error("Expected a Drizzle SQL query");
  }
  return (
    query as {
      toQuery(config: {
        casing: { getColumnCasing: () => string };
        escapeName: (name: string) => string;
        escapeParam: (index: number) => string;
        escapeString: (value: string) => string;
      }): { sql: string };
    }
  ).toQuery({
    casing: { getColumnCasing: () => "" },
    escapeName: (name) => `"${name.replaceAll('"', '""')}"`,
    escapeParam: (index) => "$" + String(index + 1),
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
  }).sql;
}

describe("pre-0023 purchase request insert", () => {
  it("does not use the Drizzle insert builder when the plan columns are absent", async () => {
    const now = new Date("2026-07-11T00:00:00.000Z");
    const legacyRow = {
      id: "11111111-1111-4111-8111-111111111111",
      producerId: "22222222-2222-4222-8222-222222222222",
      clientContactId: "33333333-3333-4333-8333-333333333333",
      productId: "44444444-4444-4444-8444-444444444444",
      projectId: null,
      bookingId: null,
      refNumber: "SK-LEGACY",
      status: "pending" as const,
      statusChangedAt: null,
      approvedAt: null,
      declinedAt: null,
      artistName: "Legacy Artist",
      artistEmail: "legacy@example.com",
      productNameSnapshot: "Legacy Product",
      priceCents: 300_000,
      currency: "ILS",
      paymentPlanSnapshot: { kind: "split_50_50" as const },
      songQty: null,
      unitPriceCents: null,
      contractUrlSnapshot: null,
      createdAt: now,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ columnCount: 0 }] })
      .mockResolvedValueOnce({ rows: [legacyRow] });
    const insert = vi.fn(() => {
      throw new Error("legacy insert must not use the Drizzle insert builder");
    });
    const db = { execute, insert } as unknown as Parameters<typeof insertPurchaseRequest>[0];

    const created = await insertPurchaseRequest(db, {
      producerId: legacyRow.producerId,
      clientContactId: legacyRow.clientContactId,
      productId: legacyRow.productId,
      status: "pending",
      artistName: legacyRow.artistName,
      artistEmail: legacyRow.artistEmail,
      productNameSnapshot: legacyRow.productNameSnapshot,
      priceCents: legacyRow.priceCents,
      currency: legacyRow.currency,
      paymentPlanSnapshot: legacyRow.paymentPlanSnapshot,
      paymentPlanOptionsSnapshot: [legacyRow.paymentPlanSnapshot],
      songQty: null,
      unitPriceCents: null,
      contractUrlSnapshot: null,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
    const rendered = renderSql(execute.mock.calls[1]?.[0]);
    expect(rendered).toContain('insert into "public"."purchase_requests"');
    expect(rendered).not.toContain("payment_plan_options_snapshot");
    expect(rendered).not.toContain("payment_plan_chosen_at");
    expect(rendered).not.toContain("royalty_terms_snapshot");
    expect(rendered).not.toContain("agreement_text_snapshot");
    expect(created).toEqual({
      ...legacyRow,
      paymentPlanOptionsSnapshot: null,
      paymentPlanChosenAt: null,
      royaltyTermsSnapshot: null,
      agreementTextSnapshot: null,
      sessionCountSnapshot: null,
    });
  });

  it("uses the exact 0024 shape before session_count_snapshot exists", async () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const pre0025Row = {
      id: "11111111-1111-4111-8111-111111111111",
      producerId: "22222222-2222-4222-8222-222222222222",
      clientContactId: "33333333-3333-4333-8333-333333333333",
      productId: "44444444-4444-4444-8444-444444444444",
      projectId: null,
      bookingId: null,
      refNumber: "SK-PRE0025",
      status: "pending" as const,
      statusChangedAt: null,
      approvedAt: null,
      declinedAt: null,
      artistName: "Rolling Artist",
      artistEmail: "rolling@example.com",
      productNameSnapshot: "Rolling Product",
      priceCents: 300_000,
      currency: "ILS",
      paymentPlanSnapshot: { kind: "split_50_50" as const },
      paymentPlanOptionsSnapshot: [{ kind: "full" as const }, { kind: "split_50_50" as const }],
      paymentPlanChosenAt: null,
      songQty: null,
      unitPriceCents: null,
      contractUrlSnapshot: null,
      royaltyTermsSnapshot: null,
      agreementTextSnapshot: "Frozen agreement",
      createdAt: now,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ columnCount: 2 }] })
      .mockResolvedValueOnce({ rows: [{ columnCount: 2 }] })
      .mockResolvedValueOnce({ rows: [{ columnCount: 0 }] })
      .mockResolvedValueOnce({ rows: [pre0025Row] });
    const insert = vi.fn(() => {
      throw new Error("0024 insert must not use the current Drizzle schema");
    });
    const db = { execute, insert } as unknown as Parameters<typeof insertPurchaseRequest>[0];

    const created = await insertPurchaseRequest(db, {
      producerId: pre0025Row.producerId,
      clientContactId: pre0025Row.clientContactId,
      productId: pre0025Row.productId,
      status: "pending",
      artistName: pre0025Row.artistName,
      artistEmail: pre0025Row.artistEmail,
      productNameSnapshot: pre0025Row.productNameSnapshot,
      priceCents: pre0025Row.priceCents,
      currency: pre0025Row.currency,
      paymentPlanSnapshot: pre0025Row.paymentPlanSnapshot,
      paymentPlanOptionsSnapshot: pre0025Row.paymentPlanOptionsSnapshot,
      sessionCountSnapshot: 4,
      songQty: null,
      unitPriceCents: null,
      contractUrlSnapshot: null,
      royaltyTermsSnapshot: null,
      agreementTextSnapshot: pre0025Row.agreementTextSnapshot,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(4);
    const rendered = renderSql(execute.mock.calls[3]?.[0]);
    expect(rendered).toContain('"royalty_terms_snapshot"');
    expect(rendered).toContain('"agreement_text_snapshot"');
    expect(rendered).not.toContain('"session_count_snapshot"');
    expect(created).toEqual({ ...pre0025Row, sessionCountSnapshot: null });
  });

  it("reads the exact 0024 projection without naming session_count_snapshot", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      producerId: "22222222-2222-4222-8222-222222222222",
      clientContactId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      projectId: null,
      bookingId: null,
      refNumber: "SK-READ0024",
      status: "approved" as const,
      statusChangedAt: null,
      approvedAt: null,
      declinedAt: null,
      artistName: "Rolling Artist",
      artistEmail: "rolling@example.com",
      productNameSnapshot: "Rolling Product",
      priceCents: 300_000,
      currency: "ILS",
      paymentPlanSnapshot: { kind: "full" as const },
      paymentPlanOptionsSnapshot: [{ kind: "full" as const }],
      paymentPlanChosenAt: null,
      songQty: null,
      unitPriceCents: null,
      contractUrlSnapshot: null,
      royaltyTermsSnapshot: null,
      agreementTextSnapshot: null,
      createdAt: new Date("2026-07-12T00:00:00.000Z"),
    };
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn((projection?: unknown) => {
      void projection;
      return { from };
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ columnCount: 2 }] })
      .mockResolvedValueOnce({ rows: [{ columnCount: 0 }] });
    const db = { execute, select } as unknown as Parameters<typeof loadPurchaseRequestRow>[0];

    const loaded = await loadPurchaseRequestRow(db, row.id, true, row.producerId);

    const projection = select.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(projection).toBeDefined();
    expect(projection).not.toHaveProperty("sessionCountSnapshot");
    expect(loaded).toEqual({ ...row, sessionCountSnapshot: null });
  });
});
