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

import SignUpPage from "./page";

function page({
  userId = null,
  redirectUrl,
}: {
  userId?: string | null;
  redirectUrl?: string;
} = {}) {
  mocks.auth.mockResolvedValueOnce({ userId });
  return SignUpPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(
      redirectUrl === undefined ? {} : { redirect_url: redirectUrl },
    ),
  });
}

describe("default Producer sign-up entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue(undefined);
  });

  it("routes an already-authenticated stale signup tab through the role resolver", async () => {
    await expect(
      page({ userId: "producer-user", redirectUrl: "/onboarding" }),
    ).rejects.toThrow("__REDIRECT__:/auth/resolve");

    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("preserves an explicit onboarding action for an authenticated account", async () => {
    await expect(
      page({
        userId: "artist-user",
        redirectUrl: "/onboarding/studio?intent=create-studio",
      }),
    ).rejects.toThrow(
      "__REDIRECT__:/auth/resolve?next=%2Fonboarding%2Fstudio%3Fintent%3Dcreate-studio",
    );

    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("still renders Clerk for a genuinely signed-out signup", async () => {
    const ui = await page({ redirectUrl: "/onboarding" });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
