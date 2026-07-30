import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createDb: vi.fn(() => ({ kind: "db" })),
  loadArtistHistoricalAudioRequest: vi.fn(),
  authorizedAudioResponse: vi.fn(
    (_request: Request, _audio: unknown, disposition: "attachment" | "inline") =>
      new Response(null, {
        status: 200,
        headers: { "Content-Disposition": disposition },
      }),
  ),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/artist/history", () => ({
  loadArtistHistoricalAudioRequest: mocks.loadArtistHistoricalAudioRequest,
}));
vi.mock("~/server/domain/audio-delivery/response", () => ({
  authorizedAudioResponse: mocks.authorizedAudioResponse,
}));

import { GET } from "./route";

const producerId = "10000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000002";
const audio = {
  key: "server-only-key",
  objectEtag: "etag",
  sizeBytes: 4_096,
  title: "Night Drive",
  versionLabel: "Master",
};

describe("historical audio route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://unit-test-only";
    mocks.auth.mockResolvedValue({ userId: "user_artist" });
    mocks.loadArtistHistoricalAudioRequest.mockResolvedValue(audio);
  });

  it("streams an exact granted historical version inline", async () => {
    const request = new Request(
      `https://skitza.test/api/audio/history/${producerId}/${versionId}`,
    );
    const response = await GET(request, {
      params: Promise.resolve({ producerId, versionId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.loadArtistHistoricalAudioRequest).toHaveBeenCalledWith(
      { kind: "db" },
      {
        clerkUserId: "user_artist",
        producerId,
        versionId,
        download: false,
      },
    );
    expect(mocks.authorizedAudioResponse).toHaveBeenCalledWith(request, audio, "inline");
  });

  it("requests an attachment only through the exact download grant path", async () => {
    const request = new Request(
      `https://skitza.test/api/audio/history/${producerId}/${versionId}?download=1`,
    );
    const response = await GET(request, {
      params: Promise.resolve({ producerId, versionId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.loadArtistHistoricalAudioRequest).toHaveBeenCalledWith(
      { kind: "db" },
      expect.objectContaining({ download: true }),
    );
    expect(mocks.authorizedAudioResponse).toHaveBeenCalledWith(
      request,
      audio,
      "attachment",
    );
  });

  it.each([
    `https://skitza.test/api/audio/history/${producerId}/${versionId}?download=0`,
    `https://skitza.test/api/audio/history/${producerId}/${versionId}?download=1&download=1`,
  ])("fails closed for an ambiguous download request: %s", async (url) => {
    const response = await GET(new Request(url), {
      params: Promise.resolve({ producerId, versionId }),
    });

    expect(response.status).toBe(404);
    expect(mocks.loadArtistHistoricalAudioRequest).not.toHaveBeenCalled();
  });

  it("returns no metadata when an exact grant is missing or mismatched", async () => {
    mocks.loadArtistHistoricalAudioRequest.mockResolvedValue(null);
    const response = await GET(
      new Request(`https://skitza.test/api/audio/history/${producerId}/${versionId}`),
      { params: Promise.resolve({ producerId, versionId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.authorizedAudioResponse).not.toHaveBeenCalled();
  });
});
