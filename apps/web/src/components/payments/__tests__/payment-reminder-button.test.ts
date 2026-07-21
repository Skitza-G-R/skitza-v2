import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  paymentReminderOperationKey,
  paymentReminderOperationKeyAfterResult,
} from "../payment-reminder-button";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "payment-reminder-button.tsx"), "utf8");

describe("PaymentReminderButton", () => {
  it("announces the exact installment and exposes a visible live success state", () => {
    expect(source).toMatch(/installmentLabel:\s*string/);
    expect(source).toMatch(/aria-label=\{`Send payment reminder for \$\{installmentLabel\}`\}/);
    expect(source).toMatch(/role="status"/);
    expect(source).toContain("Reminder sent.");
    expect(source).toContain("Reminder already sent.");
  });

  it("reuses one operation key while an attempt is in flight", () => {
    const createId = () => "attempt-one";
    const firstKey = paymentReminderOperationKey(null, createId);

    expect(firstKey).toBe("payment-reminder:attempt-one");
    expect(
      paymentReminderOperationKey(firstKey, () => {
        throw new Error("must not generate a second in-flight key");
      }),
    ).toBe(firstKey);
  });

  it("advances to a fresh operation key after a terminal error", () => {
    const failedKey = paymentReminderOperationKey(null, () => "failed-attempt");
    const retryKey = paymentReminderOperationKeyAfterResult(
      { ok: false, retryDisposition: "replace-operation-key" },
      failedKey,
      () => "retry-attempt",
    );

    expect(retryKey).toBe("payment-reminder:retry-attempt");
    expect(retryKey).not.toBe(failedKey);
    expect(
      paymentReminderOperationKey(retryKey, () => {
        throw new Error("must reuse the prepared retry key");
      }),
    ).toBe(retryKey);
  });

  it("keeps the same operation key when delivery is uncertain", () => {
    const activeKey = "payment-reminder:uncertain-attempt";

    expect(
      paymentReminderOperationKeyAfterResult(
        { ok: false, retryDisposition: "keep-operation-key" },
        activeKey,
        () => {
          throw new Error("must not replace an uncertain-delivery key");
        },
      ),
    ).toBe(activeKey);
  });

  it("clears the operation key after success", () => {
    expect(
      paymentReminderOperationKeyAfterResult(
        { ok: true },
        "payment-reminder:successful-attempt",
        () => {
          throw new Error("must not generate a key after success");
        },
      ),
    ).toBeNull();
  });
});
