import { describe, it, expect } from "vitest";
import { emailToSlug } from "./slug";

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
