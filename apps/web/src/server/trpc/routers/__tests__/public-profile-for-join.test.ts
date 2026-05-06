import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for `publicProfile.forJoin` — Story 02 of the /join flow.
//
// This is the public surface a stranger hits when a producer shares
// their IG-bio link. Procedure must:
//   - accept `{ slug }` and resolve the producer with NO auth
//   - return a minimal, scrubbed producer payload (no email, no stripe
//     ids, no autopilot flags — those leak data about a producer's
//     operation that a random visitor should never see)
//   - return up to 3 tracks where `is_public_sample = true`, ordered
//     by `created_at desc`
//   - return an empty `externalLinks` array in Wave 1 (table ships
//     in Wave 2, see architecture doc)
//   - throw NOT_FOUND for an unknown slug
//
// Mock-DB pattern mirrors portfolio.test.ts: marker objects per table,
// deterministic mock queues. The producer row carries sensitive fields
// (email, stripe_*, autopilot_*) so we can assert the procedure strips
// them from the response shape.

const PRODUCER_ID = "producer-uuid-1";
const PRODUCER_SLUG = "gili-asraf";
const TRACK_ID_1 = "00000000-0000-0000-0000-000000000001";
const TRACK_ID_2 = "00000000-0000-0000-0000-000000000002";
const TRACK_ID_3 = "00000000-0000-0000-0000-000000000003";

const producersMarker = { __table: "producers" };
const portfolioTracksMarker = { __table: "portfolio_tracks" };
const externalLinksMarker = { __table: "producer_external_links" };

type Row = Record<string, unknown>;
const producerSelectMock = vi.fn<() => Promise<Row[]>>();
const trackSelectMock = vi.fn<() => Promise<Row[]>>();
const externalLinksSelectMock = vi.fn<() => Promise<Row[]>>();

// Capture the last WHERE args handed to the portfolio-tracks select
// so the public-sample-filter test can assert the `isPublicSample` eq
// predicate is actually in the where-tree.
let lastTrackWhereArgs: unknown = null;
// Capture the limit the router requested — acceptance criterion
// says "limit 3", so assert it on the chain.
let lastTrackLimit: number | null = null;
// Capture the WHERE args for external links — used to verify producer
// scoping (only the caller's producer's links are returned).
let lastExternalLinksWhereArgs: unknown = null;

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectMock() }) };
      }
      if (table === portfolioTracksMarker) {
        return {
          where: (args: unknown) => {
            lastTrackWhereArgs = args;
            return {
              orderBy: () => ({
                limit: (n: number) => {
                  lastTrackLimit = n;
                  return trackSelectMock();
                },
              }),
            };
          },
        };
      }
      if (table === externalLinksMarker) {
        return {
          where: (args: unknown) => {
            lastExternalLinksWhereArgs = args;
            return { orderBy: () => externalLinksSelectMock() };
          },
        };
      }
      throw new Error(`unexpected select().from(${String(table)})`);
    },
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: null }),
}));

// next/headers must be mocked — the publicCtx helper calls it for the
// IP-hashed rate-limit bucket. In node vitest land there's no request
// to attach headers to, so we stub the `get("x-forwarded-for")` call.
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  portfolioTracks: portfolioTracksMarker,
  producerExternalLinks: externalLinksMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
}));

function sensitiveProducerRow(overrides: Partial<Row> = {}): Row {
  // Shape mirrors producers.$inferSelect — we need the sensitive fields
  // present on the source row to prove the router strips them.
  return {
    id: PRODUCER_ID,
    slug: PRODUCER_SLUG,
    displayName: "Gili Asraf",
    // Bio lives under `brand` in schema today; keep both so we can
    // assert the router doesn't lean on a field that doesn't exist.
    bio: "Mixing producer based in Tel Aviv.",
    brand: {
      logoUrl: "https://example.com/logo.png",
      primary: "212 150 10",
      accent: "176 104 48",
    },
    email: "gili@secret.example",
    clerkUserId: "user_secret_123",
    stripeAccountId: "acct_sensitive",
    stripeChargesEnabled: true,
    defaultSessionMin: 60,
    autoConfirmBookings: false,
    autopilotWelcomeEmail: true,
    autopilotCommentNotify: true,
    autopilotAutoArchive: false,
    autopilotRequestTestimonial: false,
    autopilotUnpaidReminder: false,
    timezone: "Asia/Jerusalem",
    defaultCurrency: "USD",
    cancellationPolicyHours: 24,
    // Marketing meta — defaults to all-null for an unset producer.
    // Tests that need real values pass them via `overrides`.
    genres: null,
    releasedSummary: null,
    streamsSummary: null,
    responseHours: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  producerSelectMock.mockReset().mockResolvedValue([]);
  trackSelectMock.mockReset().mockResolvedValue([]);
  externalLinksSelectMock.mockReset().mockResolvedValue([]);
  lastTrackWhereArgs = null;
  lastTrackLimit = null;
  lastExternalLinksWhereArgs = null;
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  // Public procedure: no auth required — pass userId: null.
  return appRouter.createCaller({ userId: null });
};

// Walk a where-predicate tree looking for `eq(col.name, expectedValue)`.
// Matches the `findPredicate` helper used in other router tests; inlined
// here to keep this test self-contained and because it only needs to
// match the shape emitted by the mocked `eq` / `and` helpers above.
function containsEq(tree: unknown, columnMarker: unknown, value: unknown): boolean {
  if (tree && typeof tree === "object") {
    const t = tree as Record<string, unknown>;
    if (Array.isArray(t.eq) && t.eq[0] === columnMarker && t.eq[1] === value) {
      return true;
    }
    if (Array.isArray(t.and)) {
      return t.and.some((child) => containsEq(child, columnMarker, value));
    }
  }
  return false;
}

describe("publicProfile.forJoin — happy path", () => {
  it("returns producer + public samples + empty externalLinks when producer has none", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([
      {
        id: TRACK_ID_1,
        title: "Sample A",
        artist: "Artist A",
        audioUrl: "https://example.com/a.mp3",
        durationMs: 180_000,
        peaksR2Key: "peaks/a.json",
        isPublicSample: true,
        createdAt: new Date("2026-03-03"),
      },
    ]);
    // externalLinksSelectMock default in beforeEach is [] — no links
    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    expect(result.producer.id).toBe(PRODUCER_ID);
    expect(result.producer.slug).toBe(PRODUCER_SLUG);
    expect(result.producer.displayName).toBe("Gili Asraf");
    expect(result.producer.logoUrl).toBe("https://example.com/logo.png");
    expect(result.producer.brandColor).toBe("212 150 10");
    expect(result.publicSamples).toHaveLength(1);
    expect(result.publicSamples[0]?.title).toBe("Sample A");
    expect(result.externalLinks).toEqual([]);
  });
});

describe("publicProfile.forJoin — external links (Wave 2, PRD §6.2 Section B)", () => {
  it("returns external links in position order with all required fields", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([]);
    externalLinksSelectMock.mockResolvedValueOnce([
      {
        id: "link-1",
        platform: "spotify",
        url: "https://open.spotify.com/artist/abc",
        title: "My latest single",
        position: 0,
      },
      {
        id: "link-2",
        platform: "youtube",
        url: "https://www.youtube.com/watch?v=xyz",
        title: null,
        position: 1,
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    expect(result.externalLinks).toHaveLength(2);
    expect(result.externalLinks[0]).toEqual({
      id: "link-1",
      platform: "spotify",
      url: "https://open.spotify.com/artist/abc",
      title: "My latest single",
      position: 0,
    });
    expect(result.externalLinks[1]?.platform).toBe("youtube");
  });

  it("scopes external links to the resolved producer", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([]);
    externalLinksSelectMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    const { producerExternalLinks } = await import("@skitza/db");
    expect(
      containsEq(
        lastExternalLinksWhereArgs,
        producerExternalLinks.producerId,
        PRODUCER_ID,
      ),
    ).toBe(true);
  });
});

describe("publicProfile.forJoin — external-links resilience (audit 2026-04-22 Task 2)", () => {
  // Guard against the production incident logged in docs/audit-report.md:
  // migration 0031 hadn't been applied to prod, so the external-links
  // query threw `relation "producer_external_links" does not exist`,
  // which propagated up and 500'd the whole /join page. The fix wraps
  // the query in try/catch and falls back to []. This test pins that
  // contract so a future refactor can't silently re-introduce the crash.
  it("returns externalLinks: [] when the external-links query throws, without losing producer or samples", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([
      {
        id: TRACK_ID_1,
        title: "Sample A",
        artist: "Artist A",
        audioUrl: "https://example.com/a.mp3",
        durationMs: 180_000,
        peaksR2Key: "peaks/a.json",
        isPublicSample: true,
        createdAt: new Date("2026-03-03"),
      },
    ]);
    // Simulate the exact Neon error we saw in prod: the table doesn't
    // exist because the migration hasn't landed yet. Any rejected
    // promise here would do — we pick this one for realism.
    externalLinksSelectMock.mockRejectedValueOnce(
      new Error('relation "producer_external_links" does not exist'),
    );
    // Spy on the server-side log so we can (a) keep test output clean
    // and (b) assert the observability path still fires — Sentry will
    // subscribe to console.error in S2.3.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    // Page still renders: producer + samples present, links degrade
    // gracefully to [].
    expect(result.producer.id).toBe(PRODUCER_ID);
    expect(result.publicSamples).toHaveLength(1);
    expect(result.externalLinks).toEqual([]);
    // Observability invariant: the error must reach the log, so when
    // Sentry is wired this gets captured. If this assertion fails,
    // someone swallowed the error silently — bad.
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("publicProfile.forJoin — 404", () => {
  it("throws NOT_FOUND when slug has no producer", async () => {
    producerSelectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.publicProfile.forJoin({ slug: "does-not-exist" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("publicProfile.forJoin — portfolio scope", () => {
  // Behavior change (post-F9 iteration): the producer surface dropped
  // the per-track "Public sample" toggle. The public profile IS the
  // public surface — every portfolio track shows on /join/<slug>, no
  // opt-in step. Consequence: no isPublicSample filter in the WHERE
  // clause, scope only by producerId.
  it("scopes by producerId and does NOT filter by isPublicSample", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    const { portfolioTracks } = await import("@skitza/db");
    expect(
      containsEq(lastTrackWhereArgs, portfolioTracks.producerId, PRODUCER_ID),
    ).toBe(true);
    expect(
      containsEq(lastTrackWhereArgs, portfolioTracks.isPublicSample, true),
    ).toBe(false);
  });
});

describe("publicProfile.forJoin — sensitive data stripped", () => {
  it("does not leak email / stripe / clerk / autopilot fields", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    // Serialize the whole response tree and assert that none of the
    // sensitive fingerprints survive. Serialization is the cheapest
    // way to catch a leak at any nesting depth.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("gili@secret.example");
    expect(serialized).not.toContain("user_secret_123");
    expect(serialized).not.toContain("acct_sensitive");
    expect(serialized).not.toMatch(/autopilot/i);
    expect(serialized).not.toMatch(/stripe/i);
    expect(serialized).not.toMatch(/clerkUserId/i);
    expect(serialized).not.toMatch(/defaultCurrency/i);
  });
});

describe("publicProfile.forJoin — marketing meta (migration 0006)", () => {
  it("returns the producer's marketing fields verbatim when they're set", async () => {
    producerSelectMock.mockResolvedValueOnce([
      sensitiveProducerRow({
        genres: ["indie", "alt-pop"],
        releasedSummary: "3 LPs",
        streamsSummary: "On Spotify, Apple",
        responseHours: 48,
      }),
    ]);
    trackSelectMock.mockResolvedValueOnce([]);
    externalLinksSelectMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    expect(result.meta).toEqual({
      genres: ["indie", "alt-pop"],
      releasedSummary: "3 LPs",
      streamsSummary: "On Spotify, Apple",
      responseHours: 48,
    });
  });

  it("returns null fields when the producer hasn't filled them in", async () => {
    // All-null meta is the default for a fresh producer row. The
    // router must NOT substitute defaults — that's the React layer's
    // job. Sending null preserves the contract that the strip can
    // hide a stat block when the producer hasn't authored it.
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    trackSelectMock.mockResolvedValueOnce([]);
    externalLinksSelectMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    expect(result.meta).toEqual({
      genres: null,
      releasedSummary: null,
      streamsSummary: null,
      responseHours: null,
    });
  });
});

describe("publicProfile.forJoin — limit 3", () => {
  it("requests at most 3 samples from the DB", async () => {
    producerSelectMock.mockResolvedValueOnce([sensitiveProducerRow()]);
    // Seed 3 rows — router should've asked for no more than 3 and
    // the DB response stream is pre-capped. The key assertion is on
    // the `.limit(n)` value.
    trackSelectMock.mockResolvedValueOnce([
      { id: TRACK_ID_1, title: "Most recent", artist: null, audioUrl: null, durationMs: null, peaksR2Key: null, isPublicSample: true, createdAt: new Date("2026-03-05") },
      { id: TRACK_ID_2, title: "Middle", artist: null, audioUrl: null, durationMs: null, peaksR2Key: null, isPublicSample: true, createdAt: new Date("2026-03-04") },
      { id: TRACK_ID_3, title: "Oldest of 3", artist: null, audioUrl: null, durationMs: null, peaksR2Key: null, isPublicSample: true, createdAt: new Date("2026-03-03") },
    ]);
    const caller = await buildCaller();
    const result = await caller.publicProfile.forJoin({ slug: PRODUCER_SLUG });

    expect(lastTrackLimit).toBe(3);
    expect(result.publicSamples).toHaveLength(3);
    // Producer may have had 5 flagged samples; only 3 come back, most
    // recent first. The mock is already sorted, we're asserting the
    // router didn't resort or slice the wrong way.
    expect(result.publicSamples[0]?.title).toBe("Most recent");
    expect(result.publicSamples[2]?.title).toBe("Oldest of 3");
  });
});
