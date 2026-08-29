import { describe, expect, it } from "vitest";

import { assertDismissibleKind, isDismissibleKind } from "../policy";

describe("attention dismissal policy", () => {
  it("allows the three deadline-free rows", () => {
    expect(isDismissibleKind("follow_up")).toBe(true);
    expect(isDismissibleKind("comment")).toBe(true);
    expect(isDismissibleKind("urgent_project")).toBe(true);
  });

  it("refuses money and anything on a clock", () => {
    // Hiding these would make "Nothing needs you right now" a lie. A session
    // request in particular expires in 48h and cancels silently overnight.
    expect(isDismissibleKind("payment_proof")).toBe(false);
    expect(isDismissibleKind("payment_due")).toBe(false);
    expect(isDismissibleKind("purchase_request")).toBe(false);
    expect(isDismissibleKind("session_approval")).toBe(false);
    expect(isDismissibleKind("setup")).toBe(false);
  });

  it("throws with the allowed list when asked to hide something else", () => {
    expect(() => assertDismissibleKind("payment_due")).toThrow(/cannot be dismissed/);
    expect(() => assertDismissibleKind("payment_due")).toThrow(/follow_up, comment, urgent_project/);
  });

  it("narrows the type when the kind is allowed", () => {
    expect(assertDismissibleKind("comment")).toBe("comment");
  });
});
