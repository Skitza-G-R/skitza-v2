import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  requireActiveAdminAccess: vi.fn(),
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
  };
});

import { AdminAccessError } from "./access";
import { requireActiveAdminPage } from "./page-access";

describe("admin page authorization failures", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders no page for a signed-in non-founder", async () => {
    mocks.requireActiveAdminAccess.mockRejectedValue(
      new AdminAccessError("founder-role-required"),
    );

    await expect(requireActiveAdminPage()).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("sends an inactive founder to the secure unlock page", async () => {
    mocks.requireActiveAdminAccess.mockRejectedValue(
      new AdminAccessError("activity-lock-required"),
    );

    await expect(requireActiveAdminPage()).rejects.toThrow(
      "NEXT_REDIRECT:/unlock?reason=inactive",
    );
  });
});
