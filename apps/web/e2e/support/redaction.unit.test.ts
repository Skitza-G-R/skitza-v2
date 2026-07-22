import { describe, expect, it } from "vitest";

import { redactDiagnostic, safeNetworkFailureCode, safeRequestLabel } from "./redaction";

describe("browser evidence redaction", () => {
  it("removes URLs, emails, ids, and common secret shapes", () => {
    const result = redactDiagnostic(
      "https://example.test/private?token=hidden fixture+clerk_test@example.com " +
        "123e4567-e89b-12d3-a456-426614174000 sk_test_abcdefghijklmnopqrstuvwxyz",
    );

    expect(result).toBe("[url] [email] [id] [secret]");
    expect(result).not.toContain("hidden");
  });

  it("keeps only a same-site pathname and hides cross-site hosts", () => {
    expect(
      safeRequestLabel(
        "http://127.0.0.1:3102/dashboard/payments?proof=private",
        "http://127.0.0.1:3102",
      ),
    ).toBe("[same-site] /dashboard/payments");
    expect(safeRequestLabel("https://provider.example/private", "http://127.0.0.1:3102")).toBe(
      "[cross-site request]",
    );
  });

  it("reports only the browser network error code", () => {
    expect(safeNetworkFailureCode("net::ERR_CONNECTION_RESET sensitive detail")).toBe(
      "net::ERR_CONNECTION_RESET",
    );
    expect(safeNetworkFailureCode("provider returned a private value")).toBe("request failed");
  });
});
