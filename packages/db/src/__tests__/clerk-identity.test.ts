import { describe, expect, it, vi } from "vitest";

import {
  resolveActiveProviderClerkUserId,
  resolveCanonicalClerkUserId,
  type ClerkIdentityBindingRepository,
  type ClerkIdentityBindingState,
} from "../clerk-identity";

function repository(
  input: {
    provider?: readonly ClerkIdentityBindingState[];
    canonical?: readonly ClerkIdentityBindingState[];
    exists?: boolean;
  } = {},
): ClerkIdentityBindingRepository {
  return {
    findProviderBindings: vi.fn().mockResolvedValue(input.provider ?? []),
    findCanonicalBindings: vi.fn().mockResolvedValue(input.canonical ?? []),
    canonicalIdentityExists: vi.fn().mockResolvedValue(input.exists ?? false),
  };
}

describe("shared Clerk identity resolver", () => {
  it("maps provider to canonical and canonical back to active provider", async () => {
    const binding = {
      canonicalClerkUserId: "user_historical",
      providerClerkUserId: "user_production",
      status: "active" as const,
    };
    const aliases = repository({ provider: [binding], canonical: [binding], exists: true });
    await expect(
      resolveCanonicalClerkUserId(aliases, {
        clerkInstanceId: "ins_production",
        providerClerkUserId: "user_production",
      }),
    ).resolves.toBe("user_historical");
    await expect(
      resolveActiveProviderClerkUserId(aliases, {
        canonicalClerkUserId: "user_historical",
        clerkInstanceId: "ins_production",
      }),
    ).resolves.toBe("user_production");
  });

  it.each(["staged", "revoked"] as const)(
    "fails closed in both directions for %s evidence",
    async (status) => {
      const binding = {
        canonicalClerkUserId: "user_historical",
        providerClerkUserId: "user_production",
        status,
      };
      const aliases = repository({ provider: [binding], canonical: [binding], exists: true });
      await expect(
        resolveCanonicalClerkUserId(aliases, {
          clerkInstanceId: "ins_production",
          providerClerkUserId: "user_production",
        }),
      ).rejects.toThrow(
        status === "staged" ? "IDENTITY_BINDING_NOT_ACTIVE" : "IDENTITY_BINDING_REVOKED",
      );
      await expect(
        resolveActiveProviderClerkUserId(aliases, {
          canonicalClerkUserId: "user_historical",
          clerkInstanceId: "ins_production",
        }),
      ).rejects.toThrow(
        status === "staged" ? "IDENTITY_BINDING_NOT_ACTIVE" : "IDENTITY_BINDING_REVOKED",
      );
    },
  );

  it("does not self-map a known historical identity into another instance", async () => {
    const aliases = repository({ exists: true });
    await expect(
      resolveCanonicalClerkUserId(aliases, {
        clerkInstanceId: "ins_other",
        providerClerkUserId: "user_historical",
      }),
    ).rejects.toThrow("IDENTITY_RELINK_REQUIRED");
    await expect(
      resolveActiveProviderClerkUserId(aliases, {
        canonicalClerkUserId: "user_historical",
        clerkInstanceId: "ins_other",
      }),
    ).rejects.toThrow("IDENTITY_RELINK_REQUIRED");
  });

  it("fails closed when provider history contains different canonical owners", async () => {
    const aliases = repository({
      provider: [
        {
          canonicalClerkUserId: "user_first_owner",
          providerClerkUserId: "user_provider",
          status: "revoked",
        },
        {
          canonicalClerkUserId: "user_second_owner",
          providerClerkUserId: "user_provider",
          status: "active",
        },
      ],
      exists: true,
    });
    await expect(
      resolveCanonicalClerkUserId(aliases, {
        clerkInstanceId: "ins_production",
        providerClerkUserId: "user_provider",
      }),
    ).rejects.toThrow("IDENTITY_BINDING_AMBIGUOUS");
  });
});
