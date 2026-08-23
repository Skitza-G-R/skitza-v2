import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailDeliveryError } from "../delivery-error";

// Each case re-imports the module so the cached client and the env read fresh.
async function loadClient() {
  vi.resetModules();
  return import("../client");
}

describe("getResend", () => {
  const originalKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it("reports a key that cannot travel in an HTTP header as a configuration error", async () => {
    // A pasted key that picked up an arrow ("→", code point 8594) made
    // `new Headers({ Authorization })` throw a raw TypeError in production.
    process.env.RESEND_API_KEY = "re_0123456789abcdef→0123456789";
    const { getResend } = await loadClient();

    let caught: unknown;
    try {
      getResend();
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("EmailDeliveryError");
    expect((caught as EmailDeliveryError).provider.name).toBe("configuration_error");
    expect((caught as EmailDeliveryError).provider.message).not.toContain("0123456789abcdef");
  });

  it("builds a client for a plain key", async () => {
    process.env.RESEND_API_KEY = "re_0123456789abcdef_0123456789abcdef";
    const { getResend } = await loadClient();
    expect(getResend()).toBeTruthy();
  });
});
