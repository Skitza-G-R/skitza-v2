import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-1";
const TRACK_ID = "00000000-0000-0000-0000-000000000001";

// Marker objects so the dbMock can branch on which table the caller hit.
// Same pattern as apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts.
const producersMarker = { __table: "producers" };
const portfolioTracksMarker = { __table: "portfolio_tracks" };

type ProducerRow = {
  id: string;
  email: string;
  displayName: string | null;
  slug: string;
  brand: { logoUrl?: string; primary?: string; accent?: string; font?: string } | null;
};
type TrackRow = Record<string, unknown>;

const producerSelectMock = vi.fn<() => Promise<ProducerRow[]>>();
const trackListMock = vi.fn<() => Promise<TrackRow[]>>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectMock() }) };
      }
      // portfolioTracks: list uses .where().orderBy()
      return {
        where: () => ({ orderBy: () => trackListMock() }),
      };
    },
  }),
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  portfolioTracks: portfolioTracksMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

beforeEach(() => {
  producerSelectMock.mockReset().mockResolvedValue([
    {
      id: PRODUCER_ID,
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      slug: "ada",
      brand: { primary: "#ff0066", accent: "#33ccff" },
    },
  ]);
  trackListMock.mockReset().mockResolvedValue([
    { id: TRACK_ID, producerId: PRODUCER_ID, title: "First", position: 0, audioUrl: "https://x/a.mp3" },
  ]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("loadProducerPortfolio", () => {
  it("returns producer + tracks for a known, complete slug", async () => {
    const { loadProducerPortfolio } = await import("../load-portfolio");
    const result = await loadProducerPortfolio("ada");
    expect(result).not.toBeNull();
    expect(result?.producer.id).toBe(PRODUCER_ID);
    expect(result?.producer.displayName).toBe("Ada Lovelace");
    expect(result?.tracks).toHaveLength(1);
    expect((result?.tracks[0] as { title: string }).title).toBe("First");
  });

  it("returns null for an unknown slug", async () => {
    producerSelectMock.mockResolvedValueOnce([]);
    const { loadProducerPortfolio } = await import("../load-portfolio");
    const result = await loadProducerPortfolio("ghost");
    expect(result).toBeNull();
  });

  it("returns null when the producer has not finished onboarding (displayName null)", async () => {
    producerSelectMock.mockResolvedValueOnce([
      { id: PRODUCER_ID, email: "draft@example.com", displayName: null, slug: "draft", brand: {} },
    ]);
    const { loadProducerPortfolio } = await import("../load-portfolio");
    const result = await loadProducerPortfolio("draft");
    expect(result).toBeNull();
  });

  it("returns null when slug is still the email-derived auto-slug", async () => {
    // Mirrors the (app)/layout.tsx onboarding gate: a producer who set a
    // displayName but never customized the auto-generated slug shouldn't
    // be reachable at /p/<auto-slug>.
    const { emailToSlug } = await import("~/lib/slug");
    const email = "halfdone@example.com";
    producerSelectMock.mockResolvedValueOnce([
      {
        id: PRODUCER_ID,
        email,
        displayName: "Half Done",
        slug: emailToSlug(email),
        brand: {},
      },
    ]);
    const { loadProducerPortfolio } = await import("../load-portfolio");
    const result = await loadProducerPortfolio(emailToSlug(email));
    expect(result).toBeNull();
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { loadProducerPortfolio } = await import("../load-portfolio");
    await expect(loadProducerPortfolio("ada")).rejects.toThrow(/DATABASE_URL/);
  });
});
