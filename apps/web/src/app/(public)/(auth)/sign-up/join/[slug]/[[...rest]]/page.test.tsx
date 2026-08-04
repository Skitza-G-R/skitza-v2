import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JoinTargetProducer } from "~/server/contacts/join-continuation";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ userId: string | null }>>(),
  cookieGet: vi.fn<(name: string) => { value: string } | undefined>(),
  findTarget: vi.fn<(dbUrl: string, slug: string) => Promise<JoinTargetProducer | null>>(),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
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
  notFound: () => mocks.notFound(),
  redirect: (href: string) => mocks.redirect(href),
}));

vi.mock("~/server/contacts/join-continuation", () => ({
  findJoinTargetProducer: (dbUrl: string, slug: string) => mocks.findTarget(dbUrl, slug),
}));

import JoinSignUpPage from "./page";

const target: JoinTargetProducer = {
  id: "studio-1",
  clerkUserId: "producer-user",
  displayName: "Northline",
  slug: "northline-studio",
};

type PageInput = {
  slug?: string | undefined;
  rest?: string[] | undefined;
  intent?: string | undefined;
};

function page(input?: PageInput) {
  const route: { slug: string; rest?: string[] } = {
    slug: input?.slug ?? "northline-studio",
  };
  if (input?.rest !== undefined) route.rest = input.rest;
  const query: { intent?: string | string[] } = {};
  if (input?.intent !== undefined) query.intent = input.intent;

  return JoinSignUpPage({
    params: Promise.resolve(route),
    searchParams: Promise.resolve(query),
  });
}

async function render(input?: Parameters<typeof page>[0]) {
  const ui = await page(input);
  return renderToStaticMarkup(ui);
}

describe("dedicated join signup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.findTarget.mockResolvedValue(target);
    mocks.cookieGet.mockReturnValue(undefined);
  });

  it("renders Clerk only after the strict current Producer target exists", async () => {
    const html = await render();

    expect(mocks.findTarget).toHaveBeenCalledWith(
      "postgres://test.invalid/skitza",
      "northline-studio",
    );
    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sign-up/join/northline-studio",
        unsafeMetadata: {
          signupOrigin: "join",
          producerSlug: "northline-studio",
        },
      }),
    );
  });

  it("rejects a malformed slug before looking up a Producer or rendering Clerk", async () => {
    await expect(page({ slug: "Invalid" })).rejects.toThrow("__NOT_FOUND__");

    expect(mocks.findTarget).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("rejects an unknown or stale Producer before rendering Clerk", async () => {
    mocks.findTarget.mockResolvedValue(null);

    await expect(page()).rejects.toThrow("__NOT_FOUND__");

    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns 404 for an authenticated user when the join target is stale", async () => {
    mocks.auth.mockResolvedValue({ userId: "existing-user" });
    mocks.findTarget.mockResolvedValue(null);

    await expect(page()).rejects.toThrow("__NOT_FOUND__");

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("sends an authenticated direct Home invite through the validated continuation", async () => {
    mocks.auth.mockResolvedValue({ userId: "existing-artist" });

    await expect(page({ rest: ["home"] })).rejects.toThrow(
      "__REDIRECT__:/join/northline-studio/continue?action=home",
    );

    expect(mocks.findTarget).toHaveBeenCalledWith(
      "postgres://test.invalid/skitza",
      "northline-studio",
    );
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("keeps a new Home invite on Home through Clerk completion", async () => {
    const html = await render({ rest: ["home"] });

    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sign-up/join/northline-studio/home",
        fallbackRedirectUrl: "/join/northline-studio/continue?action=home",
        forceRedirectUrl: "/join/northline-studio/continue?action=home",
      }),
    );
  });

  it.each([
    {
      label: "Book",
      rest: undefined,
      expected: "/sign-in?redirect_url=%2Fjoin%2Fnorthline-studio%2Fcontinue%3Faction%3Dbook",
    },
    {
      label: "Unlock",
      rest: ["unlock"],
      expected: "/sign-in?redirect_url=%2Fjoin%2Fnorthline-studio%2Fcontinue%3Faction%3Dunlock",
    },
    {
      label: "Home",
      rest: ["home"],
      expected: "/sign-in?redirect_url=%2Fjoin%2Fnorthline-studio%2Fcontinue%3Faction%3Dhome",
    },
  ])(
    "sends a signed-out returning device to Sign in with exact $label intent",
    async ({ rest, expected }) => {
      mocks.cookieGet.mockReturnValue({ value: "1" });

      await expect(page({ rest })).rejects.toThrow(`__REDIRECT__:${expected}`);

      expect(mocks.signUp).not.toHaveBeenCalled();
    },
  );

  it("honors explicit Create account without a returning-device loop", async () => {
    mocks.cookieGet.mockReturnValue({ value: "1" });

    const html = await render({ intent: "signup" });

    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["Book", ["verify-email-address"]],
    ["Unlock", ["unlock", "verify-email-address"]],
    ["Home", ["home", "verify-email-address"]],
  ])("does not interrupt Clerk's nested %s route", async (_label, rest) => {
    mocks.cookieGet.mockReturnValue({ value: "1" });

    const html = await render({ rest });

    expect(html).toContain("data-clerk-sign-up");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
