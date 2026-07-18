import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const bookingRouter = readFileSync(
  join(here, "..", "..", "..", "..", "server", "trpc", "routers", "booking.ts"),
  "utf8",
);
const producerRouter = readFileSync(
  join(here, "..", "..", "..", "..", "server", "trpc", "routers", "producer.ts"),
  "utf8",
);

describe("dashboard signal sources", () => {
  it("groups follow-ups by project before applying a bounded cap", () => {
    const procedure = bookingRouter.match(/needsFollowUp:[\s\S]*?recentPaidUnacknowledged:/)?.[0];

    expect(procedure).toBeDefined();
    expect(procedure).toContain("count(${bookings.id})::int");
    expect(procedure).toContain(".groupBy(projects.id)");
    expect(procedure).toContain(".limit(FOLLOW_UP_PROJECT_CAP)");
    expect(procedure).not.toContain(".orderBy(desc(bookings.startsAt))");
  });

  it("does not infer payment signals from legacy booking history", () => {
    const procedure = bookingRouter.match(
      /recentPaidUnacknowledged:[\s\S]*?acknowledgePayment:/,
    )?.[0];

    expect(procedure).toBeDefined();
    expect(procedure).toContain("query((): RecentPaymentCompatibility[] => [])");
    expect(procedure).not.toMatch(/PAYMENT_SIGNAL_RETENTION_DAYS|statusChangedAt.*gte/);
  });

  it("returns comments independently and leaves removed invoices out of Today", () => {
    expect(producerRouter).toContain("const needsYouUnresolvedItems =");
    expect(producerRouter).toMatch(/return \{[\s\S]*?items,[\s\S]*?needsYouUnresolvedItems,/);
    expect(producerRouter).not.toMatch(/invoiceItems|unpaidInvoiceRows|kind:\s*"invoice"/);
  });
});
