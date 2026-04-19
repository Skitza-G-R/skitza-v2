import { describe, it, expect } from "vitest";
import { parsePaymentPlansFromFormData } from "../payment-plans-parser";

describe("parsePaymentPlansFromFormData", () => {
  it("returns [full] when only full is checked", () => {
    const fd = new FormData();
    fd.set("plan_full", "on");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([{ kind: "full" }]);
  });

  it("returns all 3 when all checkboxes checked", () => {
    const fd = new FormData();
    fd.set("plan_full", "on");
    fd.set("plan_split", "on");
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "4");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 4 },
    ]);
  });

  it("defaults to [full] if nothing checked (safety fallback)", () => {
    const fd = new FormData();
    expect(parsePaymentPlansFromFormData(fd)).toEqual([{ kind: "full" }]);
  });

  it("clamps monthly N to [2, 12]", () => {
    const fd = new FormData();
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "99");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "monthly", installments: 12 },
    ]);
  });

  it("clamps monthly N below 2 up to 2", () => {
    const fd = new FormData();
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "1");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "monthly", installments: 2 },
    ]);
  });

  it("rejects non-numeric monthly N → falls back to 4", () => {
    const fd = new FormData();
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "abc");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "monthly", installments: 4 },
    ]);
  });
});
