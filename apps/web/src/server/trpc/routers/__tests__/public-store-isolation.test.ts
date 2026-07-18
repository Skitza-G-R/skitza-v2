import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const publicRouter = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/public-profile.ts"),
  "utf8",
);
const publicPage = readFileSync(
  join(process.cwd(), "src/app/(public)/join/[slug]/page.tsx"),
  "utf8",
);

describe("public portfolio and signed-in Store isolation", () => {
  it("does not read or return Store products from the anonymous profile contract", () => {
    expect(publicRouter).not.toMatch(/\bproducts\b/);
    expect(publicRouter).not.toMatch(/\bstoreProducts\b/);
    expect(publicRouter).not.toMatch(/\bproductId\b/);
  });

  it("does not mount Store product UI on the public portfolio", () => {
    expect(publicPage).not.toContain("FocalProductCard");
    expect(publicPage).not.toContain("ProductDetailScreen");
    expect(publicPage).not.toMatch(/\/artist\/store/);
    expect(publicPage).not.toMatch(/\/artist\/purchase/);
  });
});
