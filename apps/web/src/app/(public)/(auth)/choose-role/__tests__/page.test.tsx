import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

import ChooseRolePage from "../page";

const dualRoleMemberships: UserAccountMemberships = {
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
};

describe("/choose-role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
  });

  it("renders only for a genuine dual account with safe role destinations", async () => {
    authMock.mockResolvedValueOnce({ userId: "dual-user" });
    membershipsMock.mockResolvedValueOnce(dualRoleMemberships);

    const ui = await ChooseRolePage({
      searchParams: Promise.resolve({
        next: "/artist/music/song/version-1?studio=studio-a",
      }),
    });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain('data-auth-page="role-choice"');
    expect(html).toContain("Continue as artist");
    expect(html).toContain("Continue as producer");
    expect(html).toContain(
      'href="/artist/music/song/version-1?studio=studio-a"',
    );
    expect(html).toContain('href="/dashboard"');
  });

  it("does not render the chooser for a single-role account", async () => {
    authMock.mockResolvedValueOnce({ userId: "artist-user" });
    membershipsMock.mockResolvedValueOnce({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });

    await expect(
      ChooseRolePage({
        searchParams: Promise.resolve({ next: "/artist/music" }),
      }),
    ).rejects.toThrow("__REDIRECT__:/artist/music");
  });

  it("drops an unsafe nested target before building either choice", async () => {
    authMock.mockResolvedValueOnce({ userId: "dual-user" });
    membershipsMock.mockResolvedValueOnce(dualRoleMemberships);

    const ui = await ChooseRolePage({
      searchParams: Promise.resolve({
        next: "https://evil.example/artist",
      }),
    });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain('href="/artist"');
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain("evil.example");
  });
});
