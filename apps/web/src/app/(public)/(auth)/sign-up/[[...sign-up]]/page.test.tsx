import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ userId: string | null }>>(),
  cookieGet: vi.fn<(name: string) => { value: string } | undefined>(),
  redirect: vi.fn((href: string) => {
    throw new Error(`__REDIRECT__:${href}`);
  }),
  signUp: vi.fn<(props: Record<string, unknown>) => void>(),
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: (props: Record<string, unknown>) => {
    mocks.signUp(props);
    return <div data-clerk-sign-up />;
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mocks.cookieGet }),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => mocks.redirect(href),
}));

vi.mock("./invitation-account-switch-button", () => ({
  InvitationAccountSwitchButton: () => <div data-invitation-account-switch />,
}));

import SignUpPage from "./page";

function page({
  userId = null,
  redirectUrl,
  ticket,
}: {
  userId?: string | null;
  redirectUrl?: string;
  ticket?: string;
} = {}) {
  mocks.auth.mockResolvedValueOnce({ userId });
  return SignUpPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({
      ...(redirectUrl === undefined ? {} : { redirect_url: redirectUrl }),
      ...(ticket === undefined ? {} : { __clerk_ticket: ticket }),
    }),
  });
}

describe("invitation-only Producer sign-up entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue(undefined);
  });

  it("routes an already-authenticated stale signup tab through the role resolver", async () => {
    await expect(page({ userId: "producer-user", redirectUrl: "/onboarding" })).rejects.toThrow(
      "__REDIRECT__:/auth/resolve",
    );

    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("preserves an ordinary protected target for an authenticated account", async () => {
    await expect(
      page({
        userId: "artist-user",
        redirectUrl: "/dashboard/calendar",
      }),
    ).rejects.toThrow("__REDIRECT__:/auth/resolve?next=%2Fdashboard%2Fcalendar");

    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("explains invitation-only access on a direct signed-out visit", async () => {
    const ui = await page({ redirectUrl: "/onboarding" });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("Producer access is invitation-only");
    expect(html).toContain("How Producer invitations work");
    expect(html).not.toContain("data-clerk-sign-up");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("renders Clerk only when the invitation URL carries a ticket", async () => {
    const ui = await page({ ticket: "ticket_from_clerk" });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackRedirectUrl: "/auth/resolve" }),
    );
  });

  it("does not discard an invitation ticket on a returning device", async () => {
    mocks.cookieGet.mockReturnValue({ value: "1" });

    const ui = await page({ ticket: "ticket_from_clerk" });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps a signed-in invitation available through an explicit account switch", async () => {
    const ui = await page({
      userId: "artist-user",
      ticket: "never_serialize_this_ticket",
    });
    const html = renderToStaticMarkup(ui);

    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(html).toContain("Switch accounts to accept");
    expect(html).toContain("data-invitation-account-switch");
    expect(html).not.toContain("never_serialize_this_ticket");
  });
});
