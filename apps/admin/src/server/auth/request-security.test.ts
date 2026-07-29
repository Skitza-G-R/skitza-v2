import { describe, expect, it } from "vitest";

import { isSameOriginMutation } from "./request-security";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://admin.skitza.app/api/admin/session/activity", {
    method: "POST",
    headers,
  });
}

describe("admin mutation origin policy", () => {
  it("allows an explicit same-origin browser mutation", () => {
    expect(
      isSameOriginMutation(
        requestWith({
          origin: "https://admin.skitza.app",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing, cross-origin, and cross-site origins", () => {
    expect(isSameOriginMutation(requestWith({}))).toBe(false);
    expect(
      isSameOriginMutation(
        requestWith({ origin: "https://malicious.example" }),
      ),
    ).toBe(false);
    expect(
      isSameOriginMutation(
        requestWith({
          origin: "https://admin.skitza.app",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });
});
