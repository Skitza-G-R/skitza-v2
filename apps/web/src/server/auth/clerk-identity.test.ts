import { describe, expect, it, vi } from "vitest";

import { resolveCanonicalClerkUserId, type ClerkIdentityBindingRepository } from "@skitza/db";

function repository(
  input: {
    bindings?: readonly {
      canonicalClerkUserId: string;
      status: "staged" | "active" | "revoked";
    }[];
    canonicalExists?: boolean;
  } = {},
): ClerkIdentityBindingRepository {
  return {
    findProviderBindings: vi.fn().mockResolvedValue(input.bindings ?? []),
    findCanonicalBindings: vi.fn().mockResolvedValue([]),
    canonicalIdentityExists: vi.fn().mockResolvedValue(input.canonicalExists ?? false),
  };
}

const identity = {
  clerkInstanceId: "ins_production",
  providerClerkUserId: "user_new_provider",
};

describe("canonical Clerk identity resolution", () => {
  it("maps an active production provider id to its historical canonical id", async () => {
    await expect(
      resolveCanonicalClerkUserId(
        repository({
          bindings: [{ canonicalClerkUserId: "user_historical", status: "active" }],
        }),
        identity,
      ),
    ).resolves.toBe("user_historical");
  });

  it("keeps a genuinely new unbound account self-canonical", async () => {
    await expect(resolveCanonicalClerkUserId(repository(), identity)).resolves.toBe(
      "user_new_provider",
    );
  });

  it.each([
    ["staged", "IDENTITY_BINDING_NOT_ACTIVE"],
    ["revoked", "IDENTITY_BINDING_REVOKED"],
  ] as const)("fails closed for a known %s provider tuple", async (status, code) => {
    await expect(
      resolveCanonicalClerkUserId(
        repository({
          bindings: [{ canonicalClerkUserId: "user_historical", status }],
        }),
        identity,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("does not let a historical id silently self-bind in another instance", async () => {
    await expect(
      resolveCanonicalClerkUserId(repository({ canonicalExists: true }), identity),
    ).rejects.toMatchObject({
      code: "IDENTITY_RELINK_REQUIRED",
    });
  });

  it("rejects ambiguous active evidence even if the database constraint is bypassed", async () => {
    await expect(
      resolveCanonicalClerkUserId(
        repository({
          bindings: [
            { canonicalClerkUserId: "user_one", status: "active" },
            { canonicalClerkUserId: "user_two", status: "active" },
          ],
        }),
        identity,
      ),
    ).rejects.toMatchObject({
      code: "IDENTITY_BINDING_AMBIGUOUS",
    });
  });
});
