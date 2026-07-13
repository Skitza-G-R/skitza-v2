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
    const procedure = bookingRouter.match(
      /needsFollowUp:[\s\S]*?recentPaidUnacknowledged:/,
    )?.[0];

    expect(procedure).toBeDefined();
    expect(procedure).toContain("count(${bookings.id})::int");
    expect(procedure).toContain(".groupBy(projects.id)");
    expect(procedure).toContain(".limit(FOLLOW_UP_PROJECT_CAP)");
    expect(procedure).not.toContain(".orderBy(desc(bookings.startsAt))");
  });

  it("retains the same 30-day unacknowledged-payment window as the retired Activity feed", () => {
    expect(bookingRouter).toContain("const PAYMENT_SIGNAL_RETENTION_DAYS = 30");
    expect(bookingRouter).toContain(
      "Date.now() - PAYMENT_SIGNAL_RETENTION_DAYS * 24 * 60 * 60 * 1000",
    );
  });

  it("returns comments and invoices independently of the mixed Today cap", () => {
    expect(producerRouter).toContain("const needsYouUnresolvedItems =");
    expect(producerRouter).toMatch(
      /return \{[\s\S]*?items,[\s\S]*?needsYouUnresolvedItems,/,
    );
  });
});
