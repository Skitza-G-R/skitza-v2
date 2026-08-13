import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAccountMemberships } from "~/server/auth/role";

const authMock = vi.fn<() => Promise<{ userId: string | null; providerUserId: string | null }>>();
const membershipsMock =
  vi.fn<(input: { dbUrl: string; userId: string | null }) => Promise<UserAccountMemberships>>();
const syncInvitationMock =
  vi.fn<
    (input: {
      dbUrl: string;
      userId: string | null;
      providerUserId: string | null;
    }) => Promise<{ status: string }>
  >();
const redirectMock = vi.fn((href: string) => {
  throw new Error(`__REDIRECT__:${href}`);
});

vi.mock("~/server/auth/clerk-identity", () => ({
  auth: () => authMock(),
}));

vi.mock("~/server/auth/role", () => ({
  fetchUserAccountMemberships: (input: { dbUrl: string; userId: string | null }) =>
    membershipsMock(input),
}));

vi.mock("~/server/auth/producer-invitation-sync", () => ({
  syncAcceptedProducerInvitation: (input: {
    dbUrl: string;
    userId: string | null;
    providerUserId: string | null;
  }) => syncInvitationMock(input),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
}));

import AuthResolvePage from "../page";

describe("/auth/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    syncInvitationMock.mockResolvedValue({ status: "not_invited" });
  });

  it("routes a single artist back to the requested deep link", async () => {
    authMock.mockResolvedValueOnce({
      userId: "artist-user",
      providerUserId: "artist-user",
    });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      accountStatus: "open",
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });

    await expect(
      AuthResolvePage({
        searchParams: Promise.resolve({
          next: "/artist/music/song/version-1?studio=studio-a",
        }),
      }),
    ).rejects.toThrow("__REDIRECT__:/artist/music/song/version-1?studio=studio-a");
    expect(membershipsMock).toHaveBeenCalledWith({
      dbUrl: "postgres://test.invalid/skitza",
      userId: "artist-user",
    });
    expect(syncInvitationMock).toHaveBeenCalledWith({
      dbUrl: "postgres://test.invalid/skitza",
      userId: "artist-user",
      providerUserId: "artist-user",
    });
    expect(membershipsMock.mock.invocationCallOrder[0]).toBeLessThan(
      syncInvitationMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("lets an explicit role deep link override the saved role for a dual account", async () => {
    authMock.mockResolvedValueOnce({
      userId: "dual-user",
      providerUserId: "dual-user",
    });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      accountStatus: "open",
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
    ).rejects.toThrow("__REDIRECT__:/artist/payments/purchase-1");
    expect(syncInvitationMock).not.toHaveBeenCalled();
  });

  it("routes a signed-in account without a role to Producer invitation information", async () => {
    authMock.mockResolvedValueOnce({
      userId: "no-role-user",
      providerUserId: "no-role-user",
    });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      accountStatus: "open",
      producer: { status: "none", profile: null },
      artist: { hasAccess: false, hasActiveConnections: false },
    });

    await expect(AuthResolvePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "__REDIRECT__:/producer-access",
    );
  });

  it("sends a newly granted Artist directly to Producer onboarding", async () => {
    authMock.mockResolvedValueOnce({
      userId: "artist-user",
      providerUserId: "artist-user",
    });
    membershipsMock
      .mockResolvedValueOnce({
        isAuthenticated: true,
        accountStatus: "open",
        producer: { status: "none", profile: null },
        artist: { hasAccess: true, hasActiveConnections: true },
      })
      .mockResolvedValueOnce({
        isAuthenticated: true,
        accountStatus: "open",
        producer: {
          status: "incomplete",
          profile: {
            id: "producer-new",
            displayName: null,
            slug: "private-placeholder",
            email: "artist@example.test",
          },
        },
        artist: { hasAccess: true, hasActiveConnections: true },
      });
    syncInvitationMock.mockResolvedValueOnce({ status: "created" });

    await expect(AuthResolvePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "__REDIRECT__:/onboarding",
    );
    expect(membershipsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps existing Artist access when Clerk reconciliation is unavailable", async () => {
    authMock.mockResolvedValueOnce({
      userId: "artist-user",
      providerUserId: "artist-user",
    });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      accountStatus: "open",
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });
    syncInvitationMock.mockRejectedValueOnce(new Error("Clerk unavailable"));

    await expect(AuthResolvePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "__REDIRECT__:/artist",
    );
  });
});
