import { describe, expect, it } from "vitest";

import { productDescriptionForDisplay } from "../product-description";

describe("productDescriptionForDisplay", () => {
  it("keeps a normal product description", () => {
    expect(productDescriptionForDisplay("Full production from demo to master.")).toBe(
      "Full production from demo to master.",
    );
  });

  it("removes frontmatter and keeps the customer-facing text", () => {
    expect(
      productDescriptionForDisplay(
        "---\nrevisions: 3\ncontract_text: included\n---\nThree revisions and a final master.",
      ),
    ).toBe("Three revisions and a final master.");
  });

  it("hides incomplete frontmatter instead of showing raw metadata", () => {
    expect(productDescriptionForDisplay("---\nrevisions: 3\ncontract_text: included")).toBeNull();
  });
});
