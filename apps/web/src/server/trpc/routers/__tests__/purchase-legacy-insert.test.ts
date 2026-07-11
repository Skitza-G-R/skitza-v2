import { describe, expect, it, vi } from "vitest";

import { insertPurchaseRequest } from "../purchase";

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
    const db = { execute, insert } as unknown as Parameters<
      typeof insertPurchaseRequest
    >[0];

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
    const legacyInsert: unknown = execute.mock.calls[1]?.[0];
    if (
      !legacyInsert ||
      typeof legacyInsert !== "object" ||
      !("toQuery" in legacyInsert) ||
      typeof legacyInsert.toQuery !== "function"
    ) {
      throw new Error("Legacy insert query was not executed");
    }
    const rendered = (
      legacyInsert as {
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
    });
  });
});
