import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  describeActivityEvent,
  type ActivityEvent,
} from "../dashboard-helpers";

// RecentActivityFeed renders a Linear-style collapsed history. The
// Linear pattern: 5 most-recent events visible by default, then a
// "Show earlier" toggle expands the rest. The slice helper
// (`selectVisibleEvents`) is covered in dashboard-helpers.test.ts;
// here we cover the per-kind copy via `describeActivityEvent`.

describe("describeActivityEvent — per-kind one-line summary", () => {
  it("version_uploaded → 'New version V<N> · <track title>'", () => {
    const ev: ActivityEvent = {
      id: "v:1",
      kind: "version_uploaded",
      occurredAt: new Date(),
      payload: {
        versionId: "v-1",
        trackId: "t-1",
        trackTitle: "Sunshine",
        label: "V2",
      },
    };
    const out = describeActivityEvent(ev);
    expect(out.label).toMatch(/V2/);
    expect(out.label).toMatch(/Sunshine/);
  });

  it("comment_posted (artist) → 'Artist <name> commented'", () => {
    const ev: ActivityEvent = {
      id: "c:1",
      kind: "comment_posted",
      occurredAt: new Date(),
      payload: {
        commentId: "c-1",
        authorName: "Maya",
        preview: "make the kick punchier",
        fromProducer: false,
      },
    };
    const out = describeActivityEvent(ev);
    expect(out.label).toMatch(/Maya/);
    expect(out.label).toMatch(/comment/i);
  });

  it("comment_posted (producer) → 'You commented'", () => {
    const ev: ActivityEvent = {
      id: "c:2",
      kind: "comment_posted",
      occurredAt: new Date(),
      payload: {
        commentId: "c-2",
        authorName: "Producer",
        preview: "next pass tomorrow",
        fromProducer: true,
      },
    };
    const out = describeActivityEvent(ev);
    expect(out.label).toMatch(/You/);
  });

  it("session_booked → 'Session booked'", () => {
    const ev: ActivityEvent = {
      id: "b:1",
      kind: "session_booked",
      occurredAt: new Date(),
      payload: {},
    };
    expect(describeActivityEvent(ev).label).toMatch(/booked/i);
  });

  it("session_confirmed → 'Session confirmed'", () => {
    const ev: ActivityEvent = {
      id: "b:2",
      kind: "session_confirmed",
      occurredAt: new Date(),
      payload: {},
    };
    expect(describeActivityEvent(ev).label).toMatch(/confirmed/i);
  });

  it("session_cancelled → 'Session cancelled'", () => {
    const ev: ActivityEvent = {
      id: "b:3",
      kind: "session_cancelled",
      occurredAt: new Date(),
      payload: {},
    };
    expect(describeActivityEvent(ev).label).toMatch(/cancel/i);
  });

  it("invoice_sent → 'Invoice sent · $X'", () => {
    const ev: ActivityEvent = {
      id: "i:1",
      kind: "invoice_sent",
      occurredAt: new Date(),
      payload: { invoiceId: "i-1", amountCents: 25_000, currency: "USD" },
    };
    const out = describeActivityEvent(ev);
    expect(out.label).toMatch(/sent/i);
    expect(out.label).toMatch(/\$250/);
  });

  it("invoice_paid → 'Invoice paid · $X'", () => {
    const ev: ActivityEvent = {
      id: "i:2",
      kind: "invoice_paid",
      occurredAt: new Date(),
      payload: { invoiceId: "i-2", amountCents: 50_000, currency: "USD" },
    };
    expect(describeActivityEvent(ev).label).toMatch(/paid/i);
  });

  it("contract_signed → 'Contract signed'", () => {
    const ev: ActivityEvent = {
      id: "ct:1",
      kind: "contract_signed",
      occurredAt: new Date(),
      payload: {},
    };
    expect(describeActivityEvent(ev).label).toMatch(/signed/i);
  });
});

const SRC = readFileSync(
  new URL("../recent-activity-feed.tsx", import.meta.url),
  "utf8",
);

describe("RecentActivityFeed source invariants", () => {
  it("imports selectVisibleEvents (the 5-event slice helper)", () => {
    expect(SRC).toMatch(/selectVisibleEvents/);
  });

  it("imports describeActivityEvent (the per-kind copy helper)", () => {
    expect(SRC).toMatch(/describeActivityEvent/);
  });

  it("uses a useState toggle for show/hide-earlier (client component)", () => {
    expect(SRC).toMatch(/use client/);
    expect(SRC).toMatch(/useState/);
  });

  it("renders a 'Show earlier' toggle (or similar disclosure copy)", () => {
    expect(SRC).toMatch(/Show earlier|Show all|Show more/i);
  });

  it("renders an explicit empty placeholder when events are empty", () => {
    expect(SRC).toMatch(/Project just started|events will appear|just started/i);
  });

  it("does NOT import @trpc/react-query", () => {
    expect(SRC).not.toMatch(/@trpc\/react-query|useQuery\(/);
  });
});
