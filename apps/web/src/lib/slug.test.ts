import { describe, it, expect } from "vitest";
import { emailToSlug, invitationPlaceholderSlug, isAutoSlug } from "./slug";

describe("emailToSlug", () => {
  it("converts the local part to lowercase + appends a 4-char hash", () => {
    expect(emailToSlug("Anna.Karenina+test@gmail.com")).toMatch(/^anna-karenina-[a-z0-9]{4}$/);
  });
  it("differs across emails with the same local part but different domain", () => {
    expect(emailToSlug("ada@x.com")).not.toBe(emailToSlug("ada@y.com"));
  });
  it("strips disallowed chars", () => {
    expect(emailToSlug("hello world!@x.com")).toMatch(/^helloworld-[a-z0-9]{4}$/);
  });
});

describe("invitationPlaceholderSlug", () => {
  it("is stable, bounded, and bound to the invitation instead of a guessable email slug", () => {
    const first = invitationPlaceholderSlug(
      "Very.Long.Producer.Name+promo@example.com",
      "inv_secret_identity_a",
    );

    expect(first).toBe(
      invitationPlaceholderSlug(
        "very.long.producer.name+promo@example.com",
        "inv_secret_identity_a",
      ),
    );
    expect(first).not.toBe(
      invitationPlaceholderSlug(
        "very.long.producer.name+promo@example.com",
        "inv_secret_identity_b",
      ),
    );
    expect(first).not.toBe(emailToSlug("very.long.producer.name+promo@example.com"));
    expect(first).toMatch(/^[a-z0-9-]+-[0-9a-f]{12}$/);
    expect(first.length).toBeLessThanOrEqual(48);
  });
});

describe("isAutoSlug", () => {
  it("returns true for the literal output of emailToSlug", () => {
    const email = "ada@x.com";
    expect(isAutoSlug(emailToSlug(email), email)).toBe(true);
  });
  it("returns false when the slug has been user-changed", () => {
    expect(isAutoSlug("my-custom-studio", "ada@x.com")).toBe(false);
  });
});
