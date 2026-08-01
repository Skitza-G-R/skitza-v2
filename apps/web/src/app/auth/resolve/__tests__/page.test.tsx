import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAccountMemberships } from "~/server/auth/role";

const authMock = vi.fn<() => Promise<{ userId: string | null }>>();
const membershipsMock = vi.fn<
  (input: {
    dbUrl: string;
    userId: string | null;
  }) => Promise<UserAccountMemberships>
>();
const redirectMock = vi.fn((href: string) => {
  throw new Error(`__REDIRECT__:${href}`);
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("~/server/auth/role", () => ({
  fetchUserAccountMemberships: (input: {
    dbUrl: string;
    userId: string | null;
  }) => membershipsMock(input),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
}));

import AuthResolvePage from "../page";

describe("/auth/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
  });

  it("routes a single artist back to the requested deep link", async () => {
    authMock.mockResolvedValueOnce({ userId: "artist-user" });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });

    await expect(
      AuthResolvePage({
        searchParams: Promise.resolve({
          next: "/artist/music/song/version-1?studio=studio-a",
        }),
      }),
    ).rejects.toThrow(
      "__REDIRECT__:/artist/music/song/version-1?studio=studio-a",
    );
    expect(membershipsMock).toHaveBeenCalledWith({
      dbUrl: "postgres://test.invalid/skitza",
      userId: "artist-user",
    });
  });

  it("lets an explicit role deep link override the saved role for a dual account", async () => {
    authMock.mockResolvedValueOnce({ userId: "dual-user" });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      producer: {
        status: "complete",
        profile: {
          id: "producer-1",
          displayName: "Producer",
          slug: "producer",
          email: "producer@example.com",
        },
      },
      artist: { hasAccess: true, hasActiveConnections: true },
    });

    await expect(
      AuthResolvePage({
        searchParams: Promise.resolve({
          next: "/artist/payments/purchase-1",
        }),
      }),
    ).rejects.toThrow(
      "__REDIRECT__:/artist/payments/purchase-1",
    );
  });
});
