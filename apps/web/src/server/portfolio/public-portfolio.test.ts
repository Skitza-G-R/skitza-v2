import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  portfolioTracksMarker,
  whereSpy,
  limitSpy,
  countRows,
  setQueryKind,
  dbMock,
} = vi.hoisted(() => {
  const portfolioTracksMarker = {
    __table: "portfolio_tracks",
    id: { __column: "portfolio_tracks.id" },
    producerId: { __column: "portfolio_tracks.producer_id" },
    isPublicSample: { __column: "portfolio_tracks.is_public_sample" },
    title: { __column: "portfolio_tracks.title" },
    artist: { __column: "portfolio_tracks.artist" },
    audioUrl: { __column: "portfolio_tracks.audio_url" },
    durationMs: { __column: "portfolio_tracks.duration_ms" },
    peaksR2Key: { __column: "portfolio_tracks.peaks_r2_key" },
    createdAt: { __column: "portfolio_tracks.created_at" },
  };
  const whereSpy = vi.fn<(predicate: unknown) => void>();
  const limitSpy = vi.fn<(limit: number) => void>();
  const countRows: Record<string, unknown>[] = [];
  let queryKind: "list" | "count" = "list";
  const setQueryKind = (kind: "list" | "count") => {
    queryKind = kind;
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table !== portfolioTracksMarker) {
          throw new Error(`unexpected table ${String(table)}`);
        }
        return {
          where: (predicate: unknown) => {
            whereSpy(predicate);
            if (queryKind === "count") return Promise.resolve(countRows);
            return {
              orderBy: () => ({
                limit: (limit: number) => {
                  limitSpy(limit);
                  return Promise.resolve([]);
                },
              }),
            };
          },
        };
      },
    }),
  };

  return {
    portfolioTracksMarker,
    whereSpy,
    limitSpy,
    countRows,
    setQueryKind,
    dbMock,
  };
});

vi.mock("@skitza/db", () => ({
  portfolioTracks: portfolioTracksMarker,
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (column: unknown) => ({ desc: column }),
}));

import {
  countPublicPortfolioTracks,
  listPublicPortfolioTracks,
} from "./public-portfolio";

const PRODUCER_ID = "00000000-0000-4000-8000-000000000001";

function expectExplicitPublicPredicate(predicate: unknown) {
  expect(predicate).toEqual({
    and: [
      { eq: [portfolioTracksMarker.producerId, PRODUCER_ID] },
      { eq: [portfolioTracksMarker.isPublicSample, true] },
    ],
  });
}

beforeEach(() => {
  whereSpy.mockReset();
  limitSpy.mockReset();
  countRows.length = 0;
  setQueryKind("list");
});

describe("public portfolio domain boundary", () => {
  it("lists only explicitly public tracks for the requested producer", async () => {
    await listPublicPortfolioTracks(
      dbMock as unknown as Parameters<typeof listPublicPortfolioTracks>[0],
      PRODUCER_ID,
    );

    expectExplicitPublicPredicate(whereSpy.mock.calls[0]?.[0]);
    expect(limitSpy).toHaveBeenCalledWith(3);
  });

  it("counts only explicitly public tracks for the requested producer", async () => {
    setQueryKind("count");
    countRows.push({ id: "public-1" }, { id: "public-2" });

    const count = await countPublicPortfolioTracks(
      dbMock as unknown as Parameters<typeof countPublicPortfolioTracks>[0],
      PRODUCER_ID,
    );

    expect(count).toBe(2);
    expectExplicitPublicPredicate(whereSpy.mock.calls[0]?.[0]);
  });
});
