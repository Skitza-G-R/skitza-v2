import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./join-bento.tsx", import.meta.url), "utf8");

describe("public join actions", () => {
  it("routes Book through the trusted booking action", () => {
    expect(source).toContain("const bookingAction = startJoinBooking.bind");
    expect(source).toContain("<form action={bookingAction}>");
    expect(source).toContain("Book a session");
  });

  it("keeps locked-track signup separate from booking", () => {
    expect(source).toContain("const unlockAction = startJoinUnlock.bind");
    expect(source).toContain("<form action={unlockAction}>");
    expect(source).toContain("sign up to unlock");
  });
});
