import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicPortfolioSongsMock } = vi.hoisted(() => ({
  listPublicPortfolioSongsMock: vi.fn(),
}));

vi.mock("~/server/domain/song-publication/config", () => ({
  songPublicationSecret: () => "song-publication-test-secret",
}));

vi.mock("~/server/domain/song-publication/public-read", () => ({
  listPublicPortfolioSongs: listPublicPortfolioSongsMock,
}));

import { countPublicPortfolioTracks, listPublicPortfolioTracks } from "./public-portfolio";

const PRODUCER_ID = "00000000-0000-4000-8000-000000000001";
const db = { marker: "db" } as unknown as Parameters<typeof listPublicPortfolioTracks>[0];

beforeEach(() => {
  listPublicPortfolioSongsMock.mockReset().mockResolvedValue([]);
});

describe("public portfolio domain boundary", () => {
  it("delegates the public list to the song marker plus newest-audio authority", async () => {
    const rows = [{ id: "song-1" }];
    listPublicPortfolioSongsMock.mockResolvedValueOnce(rows);

    await expect(listPublicPortfolioTracks(db, PRODUCER_ID)).resolves.toBe(rows);
    expect(listPublicPortfolioSongsMock).toHaveBeenCalledWith(db, {
      producerId: PRODUCER_ID,
      secret: "song-publication-test-secret",
      limit: 3,
    });
  });

  it("counts the same dynamic public-song read model without legacy snapshots", async () => {
    listPublicPortfolioSongsMock.mockResolvedValueOnce([
      { id: "song-1" },
      { id: "song-2" },
    ]);

    await expect(countPublicPortfolioTracks(db, PRODUCER_ID)).resolves.toBe(2);
    expect(listPublicPortfolioSongsMock).toHaveBeenCalledWith(db, {
      producerId: PRODUCER_ID,
      secret: "song-publication-test-secret",
      limit: Number.MAX_SAFE_INTEGER,
    });
  });
});
