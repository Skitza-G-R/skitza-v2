import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Mirrors the artist.test.ts pattern with extensions: each table has a
// marker object, the dbMock select() chain dispatches by table, and
// each sub-query has its own FIFO queue so a single test can seed
// multiple parallel SELECTs without interference.
//
// `artist.home` is intentionally chunky — one tRPC call fans out via
// Promise.all into:
//   1. bookings ⨝ producers ⨝ clientContacts — confirmed sessions
//   2. trackVersions ⨝ projects ⨝ clientContacts — most recent mix
//   3. invoices ⨝ clientContacts — outstanding balance
//   4. activity — last 10 events across all 3 sources
//
// Tests target BEHAVIOR (right shape returned given specific inputs),
// not the SQL. The auth-boundary test is the only one that pries open
// the WHERE-clause to verify ctx.userId is the WHERE value.

const {
  clientContactsMarker,
  bookingsMarker,
  trackVersionsMarker,
  projectTracksMarker,
  projectsMarker,
  invoicesMarker,
  producersMarker,
  contactsSelectMock,
  bookingsSelectMock,
  upcomingSessionsMock,
  trackVersionsSelectMock,
  invoicesSelectMock,
  activityTracksMock,
  activityBookingsMock,
  activityInvoicesMock,
  contactsWhereSpy,
  bookingsWhereSpy,
  upcomingSessionsWhereSpy,
  trackVersionsWhereSpy,
  invoicesWhereSpy,
  activityTracksWhereSpy,
  activityBookingsWhereSpy,
  activityInvoicesWhereSpy,
  exactPairJoinSpy,
  clientContactLeftJoinSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const contactsSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const bookingsSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const upcomingSessionsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const trackVersionsSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const invoicesSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const activityTracksMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const activityBookingsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const activityInvoicesMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const contactsWhereSpy = vi.fn<(arg: unknown) => void>();
  // One WHERE-spy per sub-query so the auth-boundary tests can assert
  // every downstream filter (not just the gating contacts SELECT).
  // bookings is hit three times: next-session, upcoming-sessions list,
  // and the activity feed — in that order, matching the router's
  // Promise.all sequence. Other tables stay 2-deep (main + activity).
  const bookingsWhereSpy = vi.fn<(arg: unknown) => void>();
  const upcomingSessionsWhereSpy = vi.fn<(arg: unknown) => void>();
  const trackVersionsWhereSpy = vi.fn<(arg: unknown) => void>();
  const invoicesWhereSpy = vi.fn<(arg: unknown) => void>();
  const activityTracksWhereSpy = vi.fn<(arg: unknown) => void>();
  const activityBookingsWhereSpy = vi.fn<(arg: unknown) => void>();
  const activityInvoicesWhereSpy = vi.fn<(arg: unknown) => void>();
  const exactPairJoinSpy = vi.fn<(arg: unknown) => void>();
  const clientContactLeftJoinSpy = vi.fn<(arg: unknown) => void>();

  const clientContactsMarker = {
    __table: "client_contacts",
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    id: { __column: "client_contacts.id" },
    archivedAt: { __column: "client_contacts.archived_at" },
  };
  const bookingsMarker = {
    __table: "bookings",
    producerId: { __column: "bookings.producer_id" },
    artistEmail: { __column: "bookings.artist_email" },
    status: { __column: "bookings.status" },
    startsAt: { __column: "bookings.starts_at" },
    statusChangedAt: { __column: "bookings.status_changed_at" },
    id: { __column: "bookings.id" },
    durationMin: { __column: "bookings.duration_min" },
    packageNameSnapshot: { __column: "bookings.package_name_snapshot" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    trackId: { __column: "track_versions.track_id" },
    label: { __column: "track_versions.label" },
    audioUrl: { __column: "track_versions.audio_url" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
    id: { __column: "track_versions.id" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
    id: { __column: "project_tracks.id" },
  };
  const projectsMarker = {
    __table: "projects",
    producerId: { __column: "projects.producer_id" },
    artistEmail: { __column: "projects.artist_email" },
    id: { __column: "projects.id" },
  };
  const invoicesMarker = {
    __table: "invoices",
    producerId: { __column: "invoices.producer_id" },
    status: { __column: "invoices.status" },
    customerEmail: { __column: "invoices.customer_email" },
    amountCents: { __column: "invoices.amount_cents" },
    currency: { __column: "invoices.currency" },
    paidAt: { __column: "invoices.paid_at" },
    id: { __column: "invoices.id" },
    description: { __column: "invoices.description" },
    projectId: { __column: "invoices.project_id" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    slug: { __column: "producers.slug" },
  };

  // Per-table call counters so the FIRST hit on each table goes to the
  // "main" mock (next-session, latest-mix, outstanding-balance) and
  // SUBSEQUENT hits go to the activity-feed equivalents. The router's
  // Promise.all order is irrelevant — what matters is which-call-by-table.
  const callCounts = { bookings: 0, track_versions: 0, invoices: 0 };
  const resetCallCounts = () => {
    callCounts.bookings = 0;
    callCounts.track_versions = 0;
    callCounts.invoices = 0;
  };

  // Generic chain handler — returns a thenable terminal at every hop
  // so the router can stop at any link of .where/.orderBy/.limit/...
  // and still get the right Promise back. innerJoin chains transparently.
  // We materialize the Promise once per chain (lazily) so awaiting at
  // .where() and at .limit() resolves the same single mock invocation.
  // The optional whereSpy captures the WHERE arg so auth-boundary tests
  // can assert each sub-query's scoping predicates.
  const chain = (
    terminal: () => Promise<Record<string, unknown>[]>,
    whereSpy?: (arg: unknown) => void,
  ) => {
    let resolved: Promise<Record<string, unknown>[]> | null = null;
    const get = () => {
      resolved ??= terminal();
      return resolved;
    };
    type Link = {
      where: (arg: unknown) => Link;
      orderBy: () => Link;
      limit: () => Promise<Record<string, unknown>[]>;
      innerJoin: (table: unknown, on?: unknown) => Link;
      leftJoin: (table: unknown, on?: unknown) => Link;
      then: Promise<Record<string, unknown>[]>["then"];
    };
    const link: Link = {
      where: (arg: unknown) => {
        whereSpy?.(arg);
        return link;
      },
      orderBy: () => link,
      limit: () => get(),
      innerJoin: (table: unknown, on?: unknown) => {
        if (table === clientContactsMarker) exactPairJoinSpy(on);
        return link;
      },
      leftJoin: (table: unknown, on?: unknown) => {
        if (table === clientContactsMarker) clientContactLeftJoinSpy(on);
        return link;
      },
      // Terminal-as-promise so the router can `await` the chain at any
      // point (e.g. after .where() with no orderBy/limit).
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === clientContactsMarker) {
          // Always exactly one shape: SELECT … FROM client_contacts WHERE …
          return {
            where: (arg: unknown) => {
              contactsWhereSpy(arg);
              return contactsSelectMock();
            },
          };
        }
        if (table === bookingsMarker) {
          callCounts.bookings += 1;
          const n = callCounts.bookings;
          // 1 → next-session, 2 → upcoming-sessions list, 3 → activity.
          const terminal =
            n === 1
              ? bookingsSelectMock
              : n === 2
                ? upcomingSessionsMock
                : activityBookingsMock;
          const whereSpy =
            n === 1
              ? bookingsWhereSpy
              : n === 2
                ? upcomingSessionsWhereSpy
                : activityBookingsWhereSpy;
          return chain(() => terminal(), whereSpy);
        }
        if (table === trackVersionsMarker) {
          callCounts.track_versions += 1;
          const isFirst = callCounts.track_versions === 1;
          return chain(
            () => (isFirst ? trackVersionsSelectMock() : activityTracksMock()),
            isFirst ? trackVersionsWhereSpy : activityTracksWhereSpy,
          );
        }
        if (table === invoicesMarker) {
          callCounts.invoices += 1;
          const isFirst = callCounts.invoices === 1;
          return chain(
            () => (isFirst ? invoicesSelectMock() : activityInvoicesMock()),
            isFirst ? invoicesWhereSpy : activityInvoicesWhereSpy,
          );
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    clientContactsMarker,
    bookingsMarker,
    trackVersionsMarker,
    projectTracksMarker,
    projectsMarker,
    invoicesMarker,
    producersMarker,
    contactsSelectMock,
    bookingsSelectMock,
    upcomingSessionsMock,
    trackVersionsSelectMock,
    invoicesSelectMock,
    activityTracksMock,
    activityBookingsMock,
    activityInvoicesMock,
    contactsWhereSpy,
    bookingsWhereSpy,
    upcomingSessionsWhereSpy,
    trackVersionsWhereSpy,
    invoicesWhereSpy,
    activityTracksWhereSpy,
    activityBookingsWhereSpy,
    activityInvoicesWhereSpy,
    exactPairJoinSpy,
    clientContactLeftJoinSpy,
    resetCallCounts,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_artist_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: clientContactsMarker,
  bookings: bookingsMarker,
  trackVersions: trackVersionsMarker,
  projectTracks: projectTracksMarker,
  projects: projectsMarker,
  invoices: invoicesMarker,
  producers: producersMarker,
  // Other tables imported elsewhere in the router module — opaque
  // markers so the router file loads inside the test.
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
  notifications: { __table: "notifications" },
  trackComments: { __table: "track_comments" },
  stripeCustomers: { __table: "stripe_customers" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({
    sqlValues: values,
  }),
}));

// Re-import the mocked symbols so the auth-boundary tests assert the
// router's WHERE clauses reference the same column markers the rest of
// the codebase imports (both resolve to the markers via the vi.mock
// factory above).
import {
  bookings,
  clientContacts,
  invoices,
  projects,
} from "@skitza/db";

beforeEach(() => {
  contactsSelectMock.mockReset().mockResolvedValue([]);
  bookingsSelectMock.mockReset().mockResolvedValue([]);
  upcomingSessionsMock.mockReset().mockResolvedValue([]);
  trackVersionsSelectMock.mockReset().mockResolvedValue([]);
  invoicesSelectMock.mockReset().mockResolvedValue([]);
  activityTracksMock.mockReset().mockResolvedValue([]);
  activityBookingsMock.mockReset().mockResolvedValue([]);
  activityInvoicesMock.mockReset().mockResolvedValue([]);
  contactsWhereSpy.mockReset();
  bookingsWhereSpy.mockReset();
  upcomingSessionsWhereSpy.mockReset();
  trackVersionsWhereSpy.mockReset();
  invoicesWhereSpy.mockReset();
  activityTracksWhereSpy.mockReset();
  activityBookingsWhereSpy.mockReset();
  activityInvoicesWhereSpy.mockReset();
  exactPairJoinSpy.mockReset();
  clientContactLeftJoinSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_artist_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("artist.home", () => {
  it("returns null fields + [] activity when artist has no studios", async () => {
    contactsSelectMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    const result = await caller.artist.home();

    expect(result).toEqual({
      nextSession: null,
      upcomingSessions: [],
      latestMix: null,
      outstandingBalance: null,
      activity: [],
    });
  });

  it("returns the next confirmed session across all studios", async () => {
    // 1 client_contacts row for producer_a with email dan@x.com.
    contactsSelectMock.mockResolvedValueOnce([
      { id: "c1", producerId: "p1", email: "dan@x.com" },
    ]);
    // bookings query returns the next confirmed session. The router's
    // SQL already does ORDER BY startsAt ASC LIMIT 1, so we only seed
    // the winner.
    bookingsSelectMock.mockResolvedValueOnce([
      {
        id: "b1",
        startsAt: new Date("2026-04-22T14:00:00Z"),
        durationMin: 240,
        producerName: "Gili Asraf Studio",
        producerSlug: "giasraf",
        productName: "4-hour Mix Session",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.home();

    expect(result.nextSession).toEqual({
      id: "b1",
      startsAt: new Date("2026-04-22T14:00:00Z"),
      durationMin: 240,
      producerName: "Gili Asraf Studio",
      producerSlug: "giasraf",
      productName: "4-hour Mix Session",
    });
  });

  it("returns the most recently uploaded track across studios", async () => {
    contactsSelectMock.mockResolvedValueOnce([
      { id: "c1", producerId: "p1", email: "dan@x.com" },
    ]);
    // track_versions query already orders desc + limit(1) — we only
    // seed the winner.
    trackVersionsSelectMock.mockResolvedValueOnce([
      {
        id: "tv1",
        trackTitle: "Summer Song",
        label: "V2",
        producerName: "Gili Asraf Studio",
        producerSlug: "giasraf",
        projectId: "proj1",
        uploadedAt: new Date("2026-04-17T12:00:00Z"),
        audioUrl: "https://r2/summer-v2.mp3",
        lastSeenAt: new Date("2026-04-16T12:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.home();

    expect(result.latestMix).toEqual({
      id: "tv1",
      trackTitle: "Summer Song",
      label: "V2",
      producerName: "Gili Asraf Studio",
      producerSlug: "giasraf",
      projectId: "proj1",
      uploadedAt: new Date("2026-04-17T12:00:00Z"),
      audioUrl: "https://r2/summer-v2.mp3",
      // SK-33: the upload is newer than the relationship's lastSeenAt.
      unread: true,
    });
  });

  it("returns outstanding balance as sum of unpaid invoices", async () => {
    contactsSelectMock.mockResolvedValueOnce([
      { id: "c1", producerId: "p1", email: "dan@x.com" },
    ]);
    // 2 unpaid invoices, sum = 750000 cents.
    invoicesSelectMock.mockResolvedValueOnce([
      { amountCents: 250000, currency: "USD" },
      { amountCents: 500000, currency: "USD" },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.home();

    expect(result.outstandingBalance).not.toBeNull();
    expect(result.outstandingBalance?.totalCents).toBe(750000);
    expect(result.outstandingBalance?.currency).toBe("USD");
  });

  it("caps activity feed at 10 items sorted desc by occurredAt", async () => {
    contactsSelectMock.mockResolvedValueOnce([
      { id: "c1", producerId: "p1", email: "dan@x.com" },
    ]);
    // Spread 15 events across the 3 activity sources. Each source's
    // own SELECT already caps at 10 — but the merged total can exceed
    // 10. The router merges + sorts desc + slices to 10.
    activityTracksMock.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        id: `tv-${String(i)}`,
        trackTitle: `Track ${String(i)}`,
        label: "V1",
        producerName: "Gili",
        producerSlug: "giasraf",
        projectId: `proj-${String(i)}`,
        uploadedAt: new Date(`2026-04-${String(1 + i).padStart(2, "0")}T10:00:00Z`),
      })),
    );
    activityBookingsMock.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        id: `b-${String(i)}`,
        producerName: "Gili",
        producerSlug: "giasraf",
        statusChangedAt: new Date(`2026-04-${String(6 + i).padStart(2, "0")}T10:00:00Z`),
        startsAt: new Date(`2026-05-01T10:00:00Z`),
      })),
    );
    activityInvoicesMock.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        id: `i-${String(i)}`,
        producerName: "Gili",
        producerSlug: "giasraf",
        paidAt: new Date(`2026-04-${String(11 + i).padStart(2, "0")}T10:00:00Z`),
        amountCents: 100000,
        currency: "USD",
      })),
    );

    const caller = await buildCaller();
    const result = await caller.artist.home();

    expect(result.activity).toHaveLength(10);
    // Confirm desc-by-occurredAt ordering.
    for (let i = 0; i < result.activity.length - 1; i++) {
      const a = result.activity[i];
      const b = result.activity[i + 1];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a && b) {
        expect(a.occurredAt.getTime()).toBeGreaterThanOrEqual(
          b.occurredAt.getTime(),
        );
      }
    }
  });

});

// ─── Sub-query auth boundary ─────────────────────────────────────────
// Each Home query must join one active client-contact row to the exact
// resource producer/email pair. Independent producer and email arrays
// create a Cartesian product and authorize the wrong studio/client.
function exactPairJoin(
  clerkUserId: string,
  producerColumn: unknown,
  emailColumn: unknown,
): unknown {
  return {
    and: [
      { eq: [clientContacts.clerkUserId, clerkUserId] },
      { eq: [clientContacts.producerId, producerColumn] },
      {
        eq: [
          { sqlValues: [clientContacts.email] },
          { sqlValues: [emailColumn] },
        ],
      },
      { isNull: clientContacts.archivedAt },
    ],
  };
}

describe("artist.home auth boundary (sub-queries)", () => {
  it("correlates every booking, project, and invoice to one exact active relationship", async () => {
    const caller = await buildCaller("user_alice");
    await caller.artist.home();

    expect(exactPairJoinSpy.mock.calls.map((call) => call[0])).toEqual([
      exactPairJoin("user_alice", bookings.producerId, bookings.artistEmail),
      exactPairJoin("user_alice", bookings.producerId, bookings.artistEmail),
      exactPairJoin("user_alice", projects.producerId, projects.artistEmail),
      exactPairJoin("user_alice", invoices.producerId, invoices.customerEmail),
      exactPairJoin("user_alice", projects.producerId, projects.artistEmail),
      exactPairJoin("user_alice", bookings.producerId, bookings.artistEmail),
      exactPairJoin("user_alice", invoices.producerId, invoices.customerEmail),
    ]);
    expect(clientContactLeftJoinSpy).not.toHaveBeenCalled();
  });
});

// ─── SK-33: derived unread flag on latestMix ─────────────────────────
// Source-grep style — the existing dbMock chain doesn't model leftJoin
// against clientContacts, and threading a 5th marker through the
// chunky harness would dwarf the actual code change. A grep that
// asserts both halves (the column read + the shaped field) catches
// the regression we actually care about: someone deleting or renaming
// the unread derivation.
describe("artist.home() — latestMix.unread (SK-33)", () => {
  const SRC = readFileSync(join(__dirname, "../artist.ts"), "utf-8");

  it("shapes latestMix with an `unread` boolean derived from clientContacts.lastSeenAt", () => {
    expect(SRC).toMatch(/latestMix\s*=\s*mixRow[\s\S]*?unread:\s*/);
    expect(SRC).toMatch(/mixRow\.lastSeenAt/);
  });
});

// ─── SK-33: plan label on myPendingPayments rows ─────────────────────
// Same source-grep rationale as the latestMix.unread test above: the
// dbMock chain doesn't model the products leftJoin shape end-to-end,
// and the field we added is a pure projection over data already in
// scope. Two greps: one for the "50-50" literal that normalizes
// split_50_50, one for `plan` being part of the returned object.
describe("artist.book.myPendingPayments() — calendar plan fallback", () => {
  const SRC = readFileSync(join(__dirname, "../artist.ts"), "utf-8");

  it("uses the shared fallback and returns clear summary copy", () => {
    expect(SRC).toMatch(/calendarPaymentSummary\(/);
    expect(SRC).toMatch(/plan,/);
    expect(SRC).toMatch(/planLabel/);
    expect(SRC).not.toMatch(/paymentPlans\?\.\[0\]/);
  });
});
