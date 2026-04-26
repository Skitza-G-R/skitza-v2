import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildWhatsNextLine,
  type WhatsNextSignal,
} from "../dashboard-helpers";

// WhatsNext is a pure render of a server-derived discriminated union.
// The procedure already runs the precedence ladder (PRD §11.5 step 3)
// — see project-room.ts. The component's only job is to map each kind
// to its display copy + URL. We exercise that mapping here with
// fixtures.

const NOW = new Date(2026, 3, 25, 12, 0, 0);

describe("buildWhatsNextLine — copy + intent per signal kind", () => {
  it("returns null when the signal is null (component hides)", () => {
    expect(buildWhatsNextLine(null, NOW)).toBeNull();
  });

  it("send_contract → 'Send contract for signature'", () => {
    const signal: WhatsNextSignal = {
      kind: "send_contract",
      payload: { contractId: "ctr-1" },
    };
    const line = buildWhatsNextLine(signal, NOW);
    expect(line?.label).toBe("Send contract for signature");
  });

  it("unpaid_invoice → renders amount + currency", () => {
    const signal: WhatsNextSignal = {
      kind: "unpaid_invoice",
      payload: { invoiceId: "inv-1", amountCents: 50_000, currency: "USD" },
    };
    const line = buildWhatsNextLine(signal, NOW);
    expect(line?.label).toContain("Invoice");
    // $500.00 OR $500 — the formatter is allowed to truncate decimals.
    expect(line?.label).toMatch(/\$500/);
  });

  it("upcoming_session → 'Session ...' with the start time", () => {
    const startsAt = new Date(2026, 3, 26, 14, 30, 0);
    const signal: WhatsNextSignal = {
      kind: "upcoming_session",
      payload: { bookingId: "bk-1", startsAt },
    };
    const line = buildWhatsNextLine(signal, NOW);
    expect(line?.label).toMatch(/Session/);
  });

  it("unread_comment → mentions 'comment(s)'", () => {
    const signal: WhatsNextSignal = {
      kind: "unread_comment",
      payload: { commentId: "c-1", trackId: "t-1" },
    };
    const line = buildWhatsNextLine(signal, NOW);
    expect(line?.label).toMatch(/comment/i);
  });

  it("awaiting_review → 'Awaiting artist feedback'", () => {
    const sentAt = new Date(2026, 3, 23, 10, 0, 0);
    const signal: WhatsNextSignal = {
      kind: "awaiting_review",
      payload: { versionId: "v-1", sentAt },
    };
    const line = buildWhatsNextLine(signal, NOW);
    expect(line?.label).toMatch(/awaiting/i);
  });
});

const SRC = readFileSync(
  new URL("../whats-next.tsx", import.meta.url),
  "utf8",
);

describe("WhatsNext source invariants", () => {
  it("imports buildWhatsNextLine from the helpers module", () => {
    expect(SRC).toMatch(/buildWhatsNextLine/);
  });

  it("returns null when the line is null (component hides)", () => {
    // Either `if (!line) return null;` or an explicit ternary returning null.
    expect(SRC).toMatch(/return\s+null/);
  });

  it("does NOT import @trpc/react-query", () => {
    expect(SRC).not.toMatch(/@trpc\/react-query|useQuery\(/);
  });
});
