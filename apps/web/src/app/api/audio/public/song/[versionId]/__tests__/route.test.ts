import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(() => ({ kind: "db" })),
  deliverSongLinkAudio: vi.fn(),
  deliverPortfolioSongAudio: vi.fn(),
  authorizedAudioResponse: vi.fn(
    (_request: Request, _audio: unknown, disposition: "attachment" | "inline") =>
      new Response(null, {
        status: 200,
        headers: { "Content-Disposition": disposition },
      }),
  ),
}));

vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/domain/audio-delivery/response", () => ({
  authorizedAudioResponse: mocks.authorizedAudioResponse,
}));
vi.mock("~/server/domain/song-publication/config", () => ({
  songPublicationSecret: () => "test-public-song-secret",
}));
vi.mock("~/server/domain/song-publication/public-read", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("~/server/domain/song-publication/public-read")
  >();
  return {
    ...actual,
    deliverSongLinkAudio: mocks.deliverSongLinkAudio,
    deliverPortfolioSongAudio: mocks.deliverPortfolioSongAudio,
  };
});

import { GET } from "../route";

const versionId = "10000000-0000-4000-8000-000000000001";
const audio = {
  key: "not-returned-to-guest",
  objectEtag: "etag",
  sizeBytes: 1_000,
  title: "Song",
  versionLabel: "Version 2",
};

describe("public song audio route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://unit-test-only";
    mocks.deliverSongLinkAudio.mockImplementation(
      (_db: unknown, _input: unknown, open: (value: typeof audio) => Response) =>
        Promise.resolve(open(audio)),
    );
  });

  it("streams an authorized public version inline without a download grant", async () => {
    const response = await GET(
      new Request(`https://skitza.test/api/audio/public/song/${versionId}?token=live-token`),
      { params: Promise.resolve({ versionId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe("inline");
    expect(mocks.deliverSongLinkAudio).toHaveBeenCalledOnce();
    expect(mocks.authorizedAudioResponse).toHaveBeenCalledWith(
      expect.any(Request),
      audio,
      "inline",
    );
  });

  it.each([
    `https://skitza.test/api/audio/public/song/${versionId}`,
    `https://skitza.test/api/audio/public/song/${versionId}?token=one&cap=two`,
  ])("fails closed for missing or ambiguous authority: %s", async (url) => {
    const response = await GET(new Request(url), {
      params: Promise.resolve({ versionId }),
    });

    expect(response.status).toBe(404);
    expect(mocks.deliverSongLinkAudio).not.toHaveBeenCalled();
    expect(mocks.deliverPortfolioSongAudio).not.toHaveBeenCalled();
  });
});
