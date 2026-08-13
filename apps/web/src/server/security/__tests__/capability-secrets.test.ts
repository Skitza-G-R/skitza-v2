import { describe, expect, it } from "vitest";

import { configuredCapabilitySecrets, resolveCapabilitySecret } from "../capability-secrets";

const ACTIVE = "active-capability-secret-that-is-at-least-32-characters";
const LEGACY = "legacy-capability-secret-that-is-long-enough";
const CLERK = "sk_test_existing-clerk-fallback-secret";

describe("configuredCapabilitySecrets", () => {
  it.each(["development", "test"])(
    "preserves the Clerk-key behavior only in %s before local setup is updated",
    (NODE_ENV) => {
      expect(
        configuredCapabilitySecrets({
          NODE_ENV,
          CLERK_SECRET_KEY: CLERK,
          SKITZA_CAPABILITY_LEGACY_SECRETS: "not-yet-relevant",
        }),
      ).toEqual({ active: CLERK, verification: [CLERK] });
    },
  );

  it("fails closed in production when the dedicated secret is absent", () => {
    expect(() =>
      configuredCapabilitySecrets({
        NODE_ENV: "production",
        CLERK_SECRET_KEY: CLERK,
      }),
    ).toThrow("Missing SKITZA_CAPABILITY_SECRET");
  });

  it("fails closed in an unknown deployed environment when the dedicated secret is absent", () => {
    expect(() => configuredCapabilitySecrets({ CLERK_SECRET_KEY: CLERK })).toThrow(
      "Missing SKITZA_CAPABILITY_SECRET",
    );
  });

  it("signs with the dedicated key and verifies with explicit prior keys", () => {
    expect(
      configuredCapabilitySecrets({
        CLERK_SECRET_KEY: "sk_live_new-clerk-key-is-not-a-capability-key",
        SKITZA_CAPABILITY_SECRET: ACTIVE,
        SKITZA_CAPABILITY_LEGACY_SECRETS: JSON.stringify([LEGACY, ACTIVE, LEGACY]),
      }),
    ).toEqual({ active: ACTIVE, verification: [ACTIVE, LEGACY] });
  });

  it("keeps the first app-owned key stable when Clerk changes", () => {
    const beforeClerkCutover = configuredCapabilitySecrets({
      CLERK_SECRET_KEY: CLERK,
      SKITZA_CAPABILITY_SECRET: CLERK,
      SKITZA_CAPABILITY_LEGACY_SECRETS: "[]",
    });
    const afterClerkCutover = configuredCapabilitySecrets({
      CLERK_SECRET_KEY: "sk_live_replacement-clerk-key-is-not-used-here",
      SKITZA_CAPABILITY_SECRET: CLERK,
      SKITZA_CAPABILITY_LEGACY_SECRETS: "[]",
    });

    expect(afterClerkCutover).toEqual(beforeClerkCutover);
    expect(afterClerkCutover).toEqual({ active: CLERK, verification: [CLERK] });
  });

  it("does not silently fall back when a dedicated rollout is misconfigured", () => {
    expect(() =>
      configuredCapabilitySecrets({
        CLERK_SECRET_KEY: CLERK,
        SKITZA_CAPABILITY_SECRET: "too-short",
      }),
    ).toThrow("SKITZA_CAPABILITY_SECRET must be at least 32 characters");
    expect(() =>
      configuredCapabilitySecrets({
        CLERK_SECRET_KEY: CLERK,
        SKITZA_CAPABILITY_SECRET: "",
      }),
    ).toThrow("SKITZA_CAPABILITY_SECRET must be at least 32 characters");
    expect(() =>
      configuredCapabilitySecrets({
        SKITZA_CAPABILITY_SECRET: ACTIVE,
        SKITZA_CAPABILITY_LEGACY_SECRETS: "not-json",
      }),
    ).toThrow("SKITZA_CAPABILITY_LEGACY_SECRETS must be a JSON string array");
  });

  it("requires either the dedicated secret or an explicit local/test Clerk fallback", () => {
    expect(() => configuredCapabilitySecrets({})).toThrow("Missing SKITZA_CAPABILITY_SECRET");
  });
});

describe("resolveCapabilitySecret", () => {
  it("returns the exact legacy key that verifies an existing capability", () => {
    const resolved = resolveCapabilitySecret([ACTIVE, LEGACY], (secret) => {
      if (secret !== LEGACY) throw new Error("signature mismatch");
      return { token: "verified" };
    });

    expect(resolved).toEqual({ secret: LEGACY, value: { token: "verified" } });
  });

  it("preserves the verifier's generic failure when no key matches", () => {
    const failure = new Error("not found");
    expect(() =>
      resolveCapabilitySecret([ACTIVE, LEGACY], () => {
        throw failure;
      }),
    ).toThrow(failure);
  });
});
