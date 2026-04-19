import { describe, it, expect } from "vitest";
import { buildCheckoutSessionParams } from "./checkout";

const baseArgs = {
  productName: "Single Production",
  currency: "usd",
  totalCents: 10_000_00,
  customerId: "cus_abc",
  destinationAccountId: "acct_xyz",
  successUrl: "https://skitza.app/success",
  cancelUrl: "https://skitza.app/cancel",
  metadata: { projectId: "proj_1" },
};

describe("buildCheckoutSessionParams", () => {
  it("full → mode:payment, unit_amount = total, no setup_future_usage", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "full" },
    });
    expect(p.mode).toBe("payment");
    expect(p.line_items?.[0]?.price_data?.unit_amount).toBe(10_000_00);
    expect(p.payment_intent_data?.setup_future_usage).toBeUndefined();
  });

  it("split_50_50 → mode:payment, unit_amount = half, setup_future_usage set", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "split_50_50" },
    });
    expect(p.mode).toBe("payment");
    expect(p.line_items?.[0]?.price_data?.unit_amount).toBe(5_000_00);
    expect(p.payment_intent_data?.setup_future_usage).toBe("off_session");
  });

  it("monthly → mode:subscription with recurring price, subscription_data metadata carries installments", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "monthly", installments: 4 },
    });
    expect(p.mode).toBe("subscription");
    expect(p.line_items?.[0]?.price_data?.recurring).toEqual({ interval: "month" });
    expect(p.line_items?.[0]?.price_data?.unit_amount).toBe(2_500_00);
    expect(p.subscription_data?.metadata?.installments).toBe("4");
  });

  it("customer is attached for all 3 kinds", () => {
    (["full", "split_50_50"] as const).forEach((kind) => {
      const p = buildCheckoutSessionParams({ ...baseArgs, plan: { kind } });
      expect(p.customer).toBe("cus_abc");
    });
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "monthly", installments: 4 },
    });
    expect(p.customer).toBe("cus_abc");
  });

  it("destination account goes into payment_intent_data for non-subscription", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "full" },
    });
    expect(p.payment_intent_data?.transfer_data).toEqual({ destination: "acct_xyz" });
  });

  it("destination account goes into subscription_data for monthly", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "monthly", installments: 4 },
    });
    expect(p.subscription_data?.transfer_data).toEqual({ destination: "acct_xyz" });
  });
});
