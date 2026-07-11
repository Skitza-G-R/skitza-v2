import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { products, purchaseRequests, type ProductRoyaltyTerms } from "../schema";

describe("product commercial terms schema", () => {
  it("exports the structured royalty terms contract", () => {
    const terms: ProductRoyaltyTerms = {
      master: { mode: "percentage", bps: 250 },
      composition: {
        mode: "percentage",
        bps: 1250,
        role: "composer",
        collectingSociety: "ACUM",
      },
      notes: "Headline terms only",
    };

    expect(terms.master).toEqual({ mode: "percentage", bps: 250 });
    expect(terms.composition).toMatchObject({ bps: 1250, collectingSociety: "ACUM" });
  });

  it("adds nullable product terms and immutable request snapshots", () => {
    expect(products.royaltyTerms.name).toBe("royalty_terms");
    expect(products.agreementText.name).toBe("agreement_text");
    expect(purchaseRequests.royaltyTermsSnapshot.name).toBe("royalty_terms_snapshot");
    expect(purchaseRequests.agreementTextSnapshot.name).toBe("agreement_text_snapshot");
  });

  it("ships the matching idempotent SQL migration", () => {
    const path = join(process.cwd(), "drizzle", "0024_product_commercial_terms.sql");
    expect(existsSync(path)).toBe(true);

    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/ALTER TABLE "products"[\s\S]*royalty_terms/);
    expect(sql).toMatch(/ALTER TABLE "products"[\s\S]*agreement_text/);
    expect(sql).toMatch(/ALTER TABLE "purchase_requests"[\s\S]*royalty_terms_snapshot/);
    expect(sql).toMatch(/ALTER TABLE "purchase_requests"[\s\S]*agreement_text_snapshot/);
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
  });
});
