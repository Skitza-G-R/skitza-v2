import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createDb: vi.fn(() => ({ kind: "db" })),
  fetchUserAccountMemberships: vi.fn(),
  authorizeSongArtworkRead: vi.fn(),
  readPrivateSongArtworkObject: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/auth/role", () => ({
  fetchUserAccountMemberships: mocks.fetchUserAccountMemberships,
}));
vi.mock("~/server/domain/song-artwork/service", () => ({
  authorizeSongArtworkRead: mocks.authorizeSongArtworkRead,
}));
vi.mock("~/server/domain/song-artwork/storage", () => ({
  readPrivateSongArtworkObject: mocks.readPrivateSongArtworkObject,
}));

import { GET } from "./route";

const trackId = "10000000-0000-4000-8000-000000000001";

function request() {
  return GET(new Request(`https://skitza.test/api/song-artwork/${trackId}`), {
    params: Promise.resolve({ trackId }),
  });
}

describe("private song artwork route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://unit-test-only";
    mocks.auth.mockResolvedValue({ userId: "user_123" });
    mocks.authorizeSongArtworkRead.mockResolvedValue({
      storageKey: "private-key",
      contentType: "image/png",
      sizeBytes: 3,
      objectEtag: '"etag"',
    });
    mocks.readPrivateSongArtworkObject.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      sizeBytes: 3,
      objectEtag: '"etag"',
    });
  });

  it("delivers artwork to its producer without exposing storage identity", async () => {
    mocks.fetchUserAccountMemberships.mockResolvedValue({
      isAuthenticated: true,
      producer: {
        status: "complete",
        profile: { id: "producer-1" },
      },
      artist: { hasAccess: false, hasActiveConnections: false },
    });

    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(mocks.authorizeSongArtworkRead).toHaveBeenCalledWith(
      { kind: "db" },
      {
        viewer: { role: "producer", producerId: "producer-1" },
        trackId,
      },
    );
    expect([...response.headers.values()].join(" ")).not.toContain("private-key");
  });

  it("uses the artist ownership boundary for artist reads", async () => {
    mocks.fetchUserAccountMemberships.mockResolvedValue({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });

    expect((await request()).status).toBe(200);
    expect(mocks.authorizeSongArtworkRead).toHaveBeenCalledWith(
      { kind: "db" },
      {
        viewer: { role: "artist", clerkUserId: "user_123" },
        trackId,
      },
    );
  });

  it("falls back from exact Producer ownership to exact Artist ownership for a dual role", async () => {
    mocks.fetchUserAccountMemberships.mockResolvedValue({
      isAuthenticated: true,
      producer: {
        status: "complete",
        profile: { id: "producer-self" },
      },
      artist: { hasAccess: true, hasActiveConnections: true },
    });
    mocks.authorizeSongArtworkRead
      .mockRejectedValueOnce(new Error("not producer-owned"))
      .mockResolvedValueOnce({
        storageKey: "private-key",
        contentType: "image/png",
        sizeBytes: 3,
        objectEtag: '"etag"',
      });

    expect((await request()).status).toBe(200);
    expect(mocks.authorizeSongArtworkRead).toHaveBeenNthCalledWith(
      1,
      { kind: "db" },
      {
        viewer: { role: "producer", producerId: "producer-self" },
        trackId,
      },
    );
    expect(mocks.authorizeSongArtworkRead).toHaveBeenNthCalledWith(
      2,
      { kind: "db" },
      {
        viewer: { role: "artist", clerkUserId: "user_123" },
        trackId,
      },
    );
  });

  it("returns the same private 404 for missing auth and authorization failures", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null });
    const signedOut = await request();
    expect(signedOut.status).toBe(404);
    expect(mocks.authorizeSongArtworkRead).not.toHaveBeenCalled();

    mocks.auth.mockResolvedValueOnce({ userId: "user_123" });
    mocks.fetchUserAccountMemberships.mockResolvedValueOnce({
      isAuthenticated: true,
      producer: {
        status: "complete",
        profile: { id: "producer-1" },
      },
      artist: { hasAccess: false, hasActiveConnections: false },
    });
    mocks.authorizeSongArtworkRead.mockRejectedValueOnce(new Error("not yours"));
    const unauthorized = await request();
    expect(unauthorized.status).toBe(404);
    expect(await unauthorized.text()).toBe("Not found");
  });
});
