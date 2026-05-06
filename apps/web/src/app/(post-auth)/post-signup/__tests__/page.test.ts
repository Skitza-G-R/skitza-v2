import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the /post-signup router (Bug A — bulletproof slug
// signup). Pins the four-branch contract:
//
//   1. join-origin metadata + slug regex passes + DB resolves the slug
//      → redirect to /artist-welcome/<slug>
//   2. join-origin metadata + tampered slug
//      (regex fail OR DB miss — both defense layers)
//      → redirect to /post-signin
//   3. non-join origin (no metadata, or signupOrigin !== "join")
//      → redirect to /post-signin
//   4. no signed-in user (someone hits /post-signup directly)
//      → redirect to /sign-in
//
// Test pattern matches `apps/web/src/app/__tests__/landing-page.test.tsx`:
// the `redirect()` mock throws `__REDIRECT__:<path>` so each test can
// `await expect(Page()).rejects.toThrow(...)` and assert on the path.
// Mock-fn signatures match `actions.test.ts` (vi.fn<TFunc>().mockX).

type ClerkUser = {
  id: string;
  unsafeMetadata?: Record<string, unknown>;
} | null;

type BreadcrumbArg = {
  category: string;
  message: string;
  level: string;
  data: { clerkUserId: string; producerSlug: string };
};

let mockUser: ClerkUser = null;

const redirectMock = vi.fn<(path: string) => never>((path) => {
  throw new Error(`__REDIRECT__:${path}`);
});

const breadcrumbMock = vi.fn<(arg: BreadcrumbArg) => void>();

// DB mock — broken into individually-typed pieces (same pattern as
// `apps/web/src/app/(onboarding)/onboarding/__tests__/actions.test.ts`)
// so each link in the chain has an explicit type and ESLint doesn't
// flag inferred `any` returns. The page only does ONE select:
// producers WHERE slug = ? LIMIT 1.
const producersMarker = { __table: "producers" };

const limitMock = vi
  .fn<() => Promise<{ id: string }[]>>()
  .mockResolvedValue([]);
const whereMock = vi.fn<() => { limit: typeof limitMock }>(() => ({
  limit: limitMock,
}));
const fromMock = vi.fn<(table: unknown) => { where: typeof whereMock }>(
  (table) => {
    if (table !== producersMarker) {
      throw new Error(`unexpected select.from(${String(table)})`);
    }
    return { where: whereMock };
  },
);
const selectMock = vi.fn<() => { from: typeof fromMock }>(() => ({
  from: fromMock,
}));
const dbMock = { select: selectMock };

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: () => Promise.resolve(mockUser),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: (arg: BreadcrumbArg) => {
    breadcrumbMock(arg);
  },
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));

beforeEach(() => {
  redirectMock.mockClear();
  breadcrumbMock.mockClear();
  selectMock.mockClear();
  fromMock.mockClear();
  whereMock.mockClear();
  limitMock.mockReset();
  limitMock.mockResolvedValue([]);
  mockUser = null;
  process.env.DATABASE_URL = "postgresql://test";
});

describe("PostSignupPage — bulletproof routing (Bug A)", () => {
  it("redirects join-origin signups with a valid slug to /artist-welcome/<slug>", async () => {
    mockUser = {
      id: "user_artist_1",
      unsafeMetadata: { signupOrigin: "join", producerSlug: "ada-mix" },
    };
    limitMock.mockResolvedValue([{ id: "producer_ada" }]);

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/artist-welcome/ada-mix");
    expect(redirectMock).toHaveBeenCalledWith("/artist-welcome/ada-mix");
    // DB lookup must have happened (defense-in-depth).
    expect(selectMock).toHaveBeenCalledTimes(1);
    // Sentry breadcrumb fires after DB resolves, before redirect.
    expect(breadcrumbMock).toHaveBeenCalledTimes(1);
    const breadcrumbArg = breadcrumbMock.mock.calls[0]?.[0];
    expect(breadcrumbArg?.category).toBe("auth");
    expect(breadcrumbArg?.level).toBe("info");
    expect(breadcrumbArg?.data.clerkUserId).toBe("user_artist_1");
    expect(breadcrumbArg?.data.producerSlug).toBe("ada-mix");
  });

  it("redirects to /post-signin when the slug is tampered (regex fail OR DB miss — both defense layers)", async () => {
    const { default: Page } = await import("../page");

    // Sub-case A: regex fail — uppercase. MUST short-circuit BEFORE
    // the DB call, so a tampered client can't even probe whether a
    // slug exists.
    mockUser = {
      id: "user_attacker_a",
      unsafeMetadata: { signupOrigin: "join", producerSlug: "Ada-Mix" },
    };
    await expect(Page()).rejects.toThrow("__REDIRECT__:/post-signin");
    expect(selectMock).not.toHaveBeenCalled();
    expect(breadcrumbMock).not.toHaveBeenCalled();

    // Reset between sub-cases — we exercise the page twice in one
    // test because the discriminating logic is shared (both fall to
    // the same destination via different short-circuits).
    redirectMock.mockClear();
    selectMock.mockClear();
    breadcrumbMock.mockClear();

    // Sub-case B: regex passes, but slug doesn't resolve to a real
    // producer (deleted producer / stale link / fabricated slug).
    // MUST hit the DB (proves the lookup happened) AND MUST NOT
    // emit a breadcrumb (only the success path emits one).
    mockUser = {
      id: "user_attacker_b",
      unsafeMetadata: { signupOrigin: "join", producerSlug: "stale-slug" },
    };
    limitMock.mockResolvedValue([]); // default, but explicit for the assertion
    await expect(Page()).rejects.toThrow("__REDIRECT__:/post-signin");
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(breadcrumbMock).not.toHaveBeenCalled();
  });

  it("redirects to /post-signin for non-join origin signups (default path)", async () => {
    // Producer-default signup (no unsafeMetadata). The page MUST hand
    // off to /post-signin so the role resolver picks the right
    // destination.
    mockUser = { id: "user_producer_1" };

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/post-signin");
    expect(redirectMock).toHaveBeenCalledWith("/post-signin");
    expect(selectMock).not.toHaveBeenCalled();
    expect(breadcrumbMock).not.toHaveBeenCalled();
  });

  it("redirects to /sign-in when no user is signed in", async () => {
    mockUser = null;

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/sign-in");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
    expect(selectMock).not.toHaveBeenCalled();
  });
});
