import { describe, expect, it } from "vitest";

import { isolatedClerkSetupOptions } from "./clerk-setup";

describe("isolated Clerk test setup", () => {
  it("disables dotenv and passes only the runtime-approved key pair", () => {
    expect(
      isolatedClerkSetupOptions({
        clerkPublishableKey: "pk_test_approved",
        clerkSecretKey: "sk_test_approved",
      }),
    ).toEqual({
      dotenv: false,
      publishableKey: "pk_test_approved",
      secretKey: "sk_test_approved",
    });
  });
});
