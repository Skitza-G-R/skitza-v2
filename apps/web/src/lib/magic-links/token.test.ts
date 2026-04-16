import { describe, it, expect, beforeAll } from "vitest";
import { issueMagicToken, verifyMagicToken, MagicTokenInvalid } from "./token";

const SECRET = "0".repeat(64);
beforeAll(() => { process.env.MAGIC_LINK_SECRET = SECRET; });

describe("magic-link tokens", () => {
  it("issues and verifies a token round-trip", () => {
    const token = issueMagicToken({ producerId: "p1", target: "portfolio", ttlSeconds: 60 });
    const decoded = verifyMagicToken(token);
    expect(decoded.producerId).toBe("p1");
    expect(decoded.target).toBe("portfolio");
  });
  it("throws on tampered token", () => {
    const token = issueMagicToken({ producerId: "p1", target: "booking", ttlSeconds: 60 });
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "b" : "a");
    expect(() => verifyMagicToken(tampered)).toThrow(MagicTokenInvalid);
  });
  it("throws on expired token", () => {
    const token = issueMagicToken({ producerId: "p1", target: "project", ttlSeconds: -1 });
    expect(() => verifyMagicToken(token)).toThrow(MagicTokenInvalid);
  });
});
