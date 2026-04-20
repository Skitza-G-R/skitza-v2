import { describe, expect, it } from "vitest";

import {
  isValidEmail,
  validateDisplayName,
  validateEmail,
  validateNumber,
  validateSlug,
} from "../validation";

describe("isValidEmail", () => {
  it("accepts common producer email shapes", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
    expect(isValidEmail("alice+tag@mail.co.uk")).toBe(true);
    expect(isValidEmail("  maya@studio.fm  ")).toBe(true); // trims
  });

  it("rejects strings without a local/domain pair", () => {
    expect(isValidEmail("alice")).toBe(false);
    expect(isValidEmail("alice@")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("alice@example")).toBe(false); // no TLD
  });

  it("rejects whitespace-containing strings", () => {
    expect(isValidEmail("alice @example.com")).toBe(false);
    expect(isValidEmail("alice@ example.com")).toBe(false);
  });
});

describe("validateSlug", () => {
  it("flags empty as required (not invalid)", () => {
    expect(validateSlug("")).toEqual({ kind: "required" });
    expect(validateSlug("   ")).toEqual({ kind: "required" });
  });

  it("rejects slugs that are too short or too long", () => {
    expect(validateSlug("ab").kind).toBe("invalid");
    expect(validateSlug("a".repeat(49)).kind).toBe("invalid");
  });

  it("rejects uppercase, underscores, and double-dashes", () => {
    expect(validateSlug("Alice").kind).toBe("invalid");
    expect(validateSlug("alice_prod").kind).toBe("invalid");
    expect(validateSlug("alice--prod").kind).toBe("invalid");
  });

  it("accepts lowercase letters/digits with single-dash separators", () => {
    expect(validateSlug("alice").kind).toBe("valid");
    expect(validateSlug("alice-prod").kind).toBe("valid");
    expect(validateSlug("a1b2c3").kind).toBe("valid");
  });
});

describe("validateDisplayName", () => {
  it("requires non-empty after trim", () => {
    expect(validateDisplayName("").kind).toBe("required");
    expect(validateDisplayName("  ").kind).toBe("required");
  });

  it("caps at 80 characters", () => {
    expect(validateDisplayName("A".repeat(81)).kind).toBe("invalid");
    expect(validateDisplayName("A".repeat(80)).kind).toBe("valid");
  });

  it("accepts normal names", () => {
    expect(validateDisplayName("Maya Ortiz").kind).toBe("valid");
  });
});

describe("validateEmail", () => {
  it("required when empty, invalid when malformed, valid otherwise", () => {
    expect(validateEmail("").kind).toBe("required");
    expect(validateEmail("not-an-email").kind).toBe("invalid");
    expect(validateEmail("alice@example.com").kind).toBe("valid");
  });
});

describe("validateNumber", () => {
  it("enforces min/max bounds", () => {
    expect(validateNumber(10, { min: 15 }).kind).toBe("invalid");
    expect(validateNumber(500, { max: 100 }).kind).toBe("invalid");
    expect(validateNumber(30, { min: 15, max: 60 }).kind).toBe("valid");
  });

  it("rejects non-numeric strings", () => {
    expect(validateNumber("abc", {}).kind).toBe("invalid");
  });

  it("surfaces a formatted echo via formatParsed", () => {
    const s = validateNumber(150, { formatParsed: (n) => `$${n.toFixed(2)}` });
    expect(s.kind).toBe("valid");
    if (s.kind === "valid") expect(s.message).toBe("$150.00");
  });
});
