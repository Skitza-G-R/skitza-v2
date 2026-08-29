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
  it("no longer asks the producer to close out a session that already happened", () => {
    // A finished session is history, not a job: the artist's allowance is
    // already spent at booking time (`reserved` consumes it), so nothing about
    // the count depends on the producer clicking anything afterwards. The row,
    // its query, and its cap all went with it.
    expect(bookingRouter).not.toContain("needsFollowUp");
    expect(bookingRouter).not.toContain("FOLLOW_UP_PROJECT_CAP");
  });

  it("does not infer payment signals from legacy booking history", () => {
    // SK-283 deleted the stubs that used to hold this line. The rule they
    // protected still stands: money signals come from the purchase ledger,
    // never from booking rows.
    expect(bookingRouter).not.toContain("recentPaidUnacknowledged");
    expect(bookingRouter).not.toContain("acknowledgePayment");
    expect(bookingRouter).not.toMatch(/PAYMENT_SIGNAL_RETENTION_DAYS|statusChangedAt.*gte/);
  });

  it("returns comments independently and leaves removed invoices out of Today", () => {
    expect(producerRouter).toContain("const needsYouUnresolvedItems =");
    expect(producerRouter).toMatch(/return \{[\s\S]*?items,[\s\S]*?needsYouUnresolvedItems,/);
    expect(producerRouter).not.toMatch(/invoiceItems|unpaidInvoiceRows|kind:\s*"invoice"/);
  });
});

// SK-283 — the two dead-end fixes that live in the routers, plus proof the
// unreachable payment_received path is gone rather than merely unused.
describe("SK-283 signal sources land where the work gets finished", () => {
  const needsYou = readFileSync(join(here, "..", "needs-you.ts"), "utf8");

  it("gives an open comment the song-version link where Resolve actually lives", () => {
    const builder = producerRouter.match(/const commentItems = [\s\S]*?\}\)\);/)?.[0];

    expect(builder).toBeDefined();
    expect(builder).toContain("/dashboard/music/");
    expect(builder).not.toContain("/dashboard/clients-projects/${c.projectId}");
  });

  it("no longer carries the unreachable payment_received row", () => {
    expect(needsYou).not.toContain("payment_received");
    expect(needsYou).not.toContain("PaymentSource");
  });

  it("no longer carries the finished-session row at all", () => {
    // The word survives once, in the note explaining why the DB CHECK still
    // lists a kind nothing can produce. The row itself is gone.
    expect(needsYou).not.toContain('kind: "follow_up"');
    expect(needsYou).not.toContain("FollowUpSource");
    expect(needsYou).not.toContain("groupFollowUps");
  });
});
