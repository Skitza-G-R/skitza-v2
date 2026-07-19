import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("legacy artist Store product route", () => {
  it("keeps the signed-in boundary before redirecting", () => {
    expect(pageSrc).toMatch(/const \{ userId \} = await auth\(\)/);
    expect(pageSrc).toMatch(/if \(!userId\) return null/);
  });

  it("redirects every old product URL to the unified purchase route", () => {
    expect(pageSrc).toMatch(
      /redirect\(`\/artist\/purchase\/\$\{encodeURIComponent\(productId\)\}`\)/,
    );
    expect(pageSrc).not.toMatch(/StoreProductClient|requestStorePurchaseAction/);
  });
});
