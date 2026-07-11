import { describe, expect, it } from "vitest";

import { isSafeAgreementUrl, safeAgreementUrl } from "./agreement-url";

describe("agreement URL safety", () => {
  it("accepts public HTTP and HTTPS links", () => {
    expect(isSafeAgreementUrl("https://example.com/terms.pdf")).toBe(true);
    expect(isSafeAgreementUrl("http://localhost:3000/terms")).toBe(true);
  });

  it("rejects executable, embedded, and invalid URL schemes", () => {
    expect(isSafeAgreementUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAgreementUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeAgreementUrl("file:///tmp/terms.pdf")).toBe(false);
    expect(safeAgreementUrl("not a url")).toBeNull();
  });
});
