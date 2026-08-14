import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootLayout = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
const openGraphImage = readFileSync(new URL("../opengraph-image.tsx", import.meta.url), "utf8");

describe("public metadata product truth", () => {
  it("describes agreements and external-payment records without claiming payment or signing execution", () => {
    const publicMetadata = `${rootLayout}\n${openGraphImage}`;

    expect(publicMetadata).toContain("external-payment records");
    expect(publicMetadata).toContain("Producer access by invitation");
    expect(publicMetadata).not.toMatch(
      /pay automatically|sign contracts|contract e-sign|Join the waiting list|DocuSign|Stripe/,
    );
  });
});
