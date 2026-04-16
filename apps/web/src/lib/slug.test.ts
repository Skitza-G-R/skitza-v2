import { describe, it, expect } from "vitest";
import { emailToSlug, isAutoSlug } from "./slug";

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

describe("isAutoSlug", () => {
  it("returns true for the literal output of emailToSlug", () => {
    const email = "ada@x.com";
    expect(isAutoSlug(emailToSlug(email), email)).toBe(true);
  });
  it("returns false when the slug has been user-changed", () => {
    expect(isAutoSlug("my-custom-studio", "ada@x.com")).toBe(false);
  });
});
