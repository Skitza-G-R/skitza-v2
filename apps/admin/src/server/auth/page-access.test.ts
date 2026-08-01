import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  requireActiveAdminAccess: vi.fn(),
  requireFounderRole: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    requireActiveAdminAccess: mocks.requireActiveAdminAccess,
    requireFounderRole: mocks.requireFounderRole,
  };
});

import {
  AdminAccessError,
  type FounderIdentity,
} from "./access";
import {
  requireActiveAdminPage,
  requireFounderRolePage,
} from "./page-access";

const IDENTITY: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "a".repeat(43),
  sessionId: "sess_founder",
  userId: "user_founder",
};

const PAGE_BOUNDARIES = [
  {
    name: "active page",
    invoke: requireActiveAdminPage,
    dependency: mocks.requireActiveAdminAccess,
  },
  {
    name: "founder page",
    invoke: requireFounderRolePage,
    dependency: mocks.requireFounderRole,
  },
] as const;

describe("admin page authorization failures", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each(PAGE_BOUNDARIES)(
    "redirects signed-out requests only after the outer Access boundary for $name",
    async ({ dependency, invoke }) => {
      dependency.mockRejectedValue(new AdminAccessError("signed-out"));

      await expect(invoke()).rejects.toThrow(
        "NEXT_REDIRECT:/sign-in",
      );
      expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
      expect(mocks.notFound).not.toHaveBeenCalled();
    },
  );

  it.each(PAGE_BOUNDARIES)(
    "hides $name for every founder/Access identity denial",
    async ({ dependency, invoke }) => {
      for (const reason of [
        "access-proof-required",
        "access-identity-mismatch",
        "founder-role-required",
        "impersonated-session",
      ] as const) {
        dependency.mockRejectedValueOnce(new AdminAccessError(reason));
        await expect(invoke()).rejects.toThrow("NEXT_NOT_FOUND");
      }

      expect(mocks.notFound).toHaveBeenCalledTimes(4);
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("sends an inactive founder to the secure unlock page", async () => {
    mocks.requireActiveAdminAccess.mockRejectedValue(
      new AdminAccessError("activity-lock-required"),
    );

    await expect(requireActiveAdminPage()).rejects.toThrow(
      "NEXT_REDIRECT:/unlock?reason=inactive",
    );
  });

  it.each(PAGE_BOUNDARIES)(
    "fails closed when $name configuration is unavailable",
    async ({ dependency, invoke }) => {
      dependency.mockRejectedValue(
        new AdminAccessError("configuration-invalid"),
      );

      await expect(invoke()).rejects.toThrow(
        "Admin access configuration is unavailable.",
      );
      expect(mocks.notFound).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it.each(PAGE_BOUNDARIES)(
    "returns the verified identity for $name",
    async ({ dependency, invoke }) => {
      dependency.mockResolvedValue(IDENTITY);
      await expect(invoke()).resolves.toBe(IDENTITY);
    },
  );

  it.each(PAGE_BOUNDARIES)(
    "rethrows unexpected $name failures",
    async ({ dependency, invoke }) => {
      const failure = new Error("unexpected");
      dependency.mockRejectedValue(failure);
      await expect(invoke()).rejects.toBe(failure);
    },
  );
});
