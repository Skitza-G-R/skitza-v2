import { describe, expect, it } from "vitest";

import { buildClientInviteUrl } from "../invite-url";

describe("buildClientInviteUrl", () => {
  it("builds the canonical verified artist signup URL", () => {
    expect(buildClientInviteUrl("gili-asraf")).toBe("https://skitza.app/sign-up/join/gili-asraf");
  });

  it("encodes the producer slug and normalizes an environment-specific origin", () => {
    expect(buildClientInviteUrl("producer/name with spaces", "https://preview.example/")).toBe(
      "https://preview.example/sign-up/join/producer%2Fname%20with%20spaces",
    );
  });

  it("contains no client or private-offer identifier", () => {
    const url = buildClientInviteUrl("gili-asraf");

    expect(url).not.toContain("00000000-0000-0000-0000-000000000001");
    expect(url).not.toMatch(/offer/i);
  });
});
