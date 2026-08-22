import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProducerInvitationSyncResult } from "~/server/auth/producer-invitation-sync";
import type { UserAccountMemberships } from "~/server/auth/role";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ userId: string | null }>>(),
  memberships: vi.fn<() => Promise<UserAccountMemberships>>(),
  redirect: vi.fn((href: string) => {
    throw new Error(`__REDIRECT__:${href}`);
  }),
  sync: vi.fn<(input: unknown) => Promise<ProducerInvitationSyncResult>>(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mocks.auth() }));
vi.mock("~/server/auth/producer-invitation-sync", () => ({
  syncAcceptedProducerInvitation: (input: unknown) => mocks.sync(input),
}));
vi.mock("~/server/auth/role", () => ({
  fetchUserAccountMemberships: () => mocks.memberships(),
}));
vi.mock("next/navigation", () => ({ redirect: (href: string) => mocks.redirect(href) }));
// Client island (Clerk hooks) — stubbed so the server page renders statically.
vi.mock("./sign-out-home-button", () => ({
  SignOutHomeButton: ({ label }: { label: string }) => (
    <button type="button" data-testid="sign-out-home">
      {label}
    </button>
  ),
}));

import ProducerAccessPage from "./page";

describe("Producer access information", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.sync.mockResolvedValue({ status: "not_invited" });
    mocks.memberships.mockResolvedValue({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });
  });

  it("explains the invitation flow without offering an access bypass", async () => {
    const html = renderToStaticMarkup(await ProducerAccessPage());

    expect(html).toContain("Producer access is invitation-only");
    expect(html).toContain("Accept it using the same");
    expect(html).toContain("Your Artist account stays active");
    expect(html).toContain("maya@email.com");
    expect(html).not.toContain("Create a studio");
    expect(html).not.toContain("data-clerk-sign-up");
  });

  it("keeps the plain homepage link for signed-out visitors", async () => {
    const html = renderToStaticMarkup(await ProducerAccessPage());

    expect(html).toContain("Back to Skitza");
    expect(html).not.toContain("data-testid=\"sign-out-home\"");
  });

  it("offers sign-out instead of the looping homepage link to a membership-less account", async () => {
    // "/" redirects every signed-in account through /auth/resolve, which
    // sends a no-membership account right back here — so the homepage link
    // must be replaced by a real session exit.
    mocks.auth.mockResolvedValue({ userId: "orphan-user" });
    mocks.memberships.mockResolvedValue({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: false, hasActiveConnections: false },
    });

    const html = renderToStaticMarkup(await ProducerAccessPage());

    expect(html).toContain("Sign out and back to homepage");
    expect(html).not.toContain("Back to Skitza");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the homepage link and adds sign-out for a signed-in Artist", async () => {
    mocks.auth.mockResolvedValue({ userId: "artist-user" });

    const html = renderToStaticMarkup(await ProducerAccessPage());

    expect(html).toContain("Back to Skitza");
    expect(html).toContain("Sign out");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a newly invited Artist to Producer setup without removing Artist access", async () => {
    mocks.auth.mockResolvedValue({ userId: "artist-user" });
    mocks.sync.mockResolvedValue({ status: "created" });

    await expect(ProducerAccessPage()).rejects.toThrow("__REDIRECT__:/onboarding");
    expect(mocks.sync).toHaveBeenCalled();
  });

  it("redirects an existing Producer without asking Clerk for another invitation", async () => {
    mocks.auth.mockResolvedValue({ userId: "producer-user" });
    mocks.memberships.mockResolvedValue({
      isAuthenticated: true,
      producer: {
        status: "complete",
        profile: {
          id: "producer-1",
          displayName: "Producer",
          slug: "producer",
          email: "producer@example.test",
        },
      },
      artist: { hasAccess: false, hasActiveConnections: false },
    });

    await expect(ProducerAccessPage()).rejects.toThrow("__REDIRECT__:/dashboard");
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("fails closed with retry guidance when Clerk is unavailable", async () => {
    mocks.auth.mockResolvedValue({ userId: "artist-user" });
    mocks.sync.mockRejectedValue(new Error("Clerk unavailable"));

    const html = renderToStaticMarkup(await ProducerAccessPage());

    expect(html).toContain("could not check your invitation");
    expect(html).toContain("existing account is unchanged");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
