import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "~/server/auth/role";

// Tests for the /post-signin router (Bug B — eliminate the producer-
// dashboard flash on artist sign-in). Pins one redirect per role:
//
//   1. unauthenticated (no userId)              → /sign-in
//   2. producer-complete                        → /dashboard
//   3. producer-incomplete                      → /onboarding
//   4. artist                                   → /artist
//   5. orphan (webhook never created a row;
//      critical bug, NOT a race)                → /sign-in?error=...
//      AND Sentry.captureMessage at error level
//
// Per Strategic Lead's correction: NO polling here. Sign-in users
// have DB rows by definition; orphan-on-signin is a production bug.

type CaptureMessageOpts = {
  level: string;
  tags?: { feature?: string; flow?: string };
  extra?: { clerkUserId?: string };
};

let mockUserId: string | null = null;
let mockRole: UserRole = { kind: "unauthenticated" };

const redirectMock = vi.fn<(path: string) => never>((path) => {
  throw new Error(`__REDIRECT__:${path}`);
});

const captureMessageMock =
  vi.fn<(msg: string, opts?: CaptureMessageOpts) => void>();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (msg: string, opts?: CaptureMessageOpts) => {
    captureMessageMock(msg, opts);
  },
}));

vi.mock("~/server/auth/role", () => ({
  fetchUserRole: () => Promise.resolve(mockRole),
}));

beforeEach(() => {
  redirectMock.mockClear();
  captureMessageMock.mockClear();
  mockUserId = null;
  mockRole = { kind: "unauthenticated" };
  process.env.DATABASE_URL = "postgresql://test";
});

describe("PostSigninPage — bulletproof routing (Bug B)", () => {
  it("redirects to /sign-in when there is no userId (unauthenticated direct hit)", async () => {
    mockUserId = null;

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/sign-in");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("redirects producer-complete to /dashboard", async () => {
    mockUserId = "user_producer_done";
    mockRole = {
      kind: "producer-complete",
      producer: {
        id: "producer_1",
        displayName: "Ada",
        slug: "ada-mix",
        email: "ada@example.com",
      },
    };

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/dashboard");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("redirects producer-incomplete to /onboarding", async () => {
    mockUserId = "user_producer_wip";
    mockRole = {
      kind: "producer-incomplete",
      producer: {
        id: "producer_2",
        displayName: null,
        slug: "auto-slug-aaaa",
        email: "wip@example.com",
      },
    };

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/onboarding");
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("redirects an artist to /artist", async () => {
    mockUserId = "user_artist_1";
    mockRole = { kind: "artist" };

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow("__REDIRECT__:/artist");
    expect(redirectMock).toHaveBeenCalledWith("/artist");
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("redirects an orphan to /sign-in with error code AND captures to Sentry at error level", async () => {
    mockUserId = "user_orphan_1";
    mockRole = { kind: "orphan" };

    const { default: Page } = await import("../page");

    await expect(Page()).rejects.toThrow(
      "__REDIRECT__:/sign-in?error=account_setup_incomplete",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/sign-in?error=account_setup_incomplete",
    );
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessageMock.mock.calls[0] ?? [];
    expect(msg).toContain("orphan user");
    expect(opts?.level).toBe("error");
    expect(opts?.tags?.feature).toBe("auth");
    expect(opts?.tags?.flow).toBe("post-signin");
    expect(opts?.extra?.clerkUserId).toBe("user_orphan_1");
  });
});
