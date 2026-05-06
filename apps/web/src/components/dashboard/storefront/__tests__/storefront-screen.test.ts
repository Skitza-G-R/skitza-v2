import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Storefront screen — Create + Edit product flows must STAY on the
// Storefront page. A 2026-05-06 bug let both CTAs jump to
// /dashboard/settings?section=services because Services CRUD used to
// live there. PRD v3 §4.5 says the Storefront owns its own products
// surface — the Settings page hosts payment/integration config only.
// These source-grep invariants pin the regression so the link can't
// quietly come back.

const here = dirname(fileURLToPath(import.meta.url));
const STOREFRONT_DIR = join(here, "..");
const screenSource = readFileSync(
  join(STOREFRONT_DIR, "storefront-screen.tsx"),
  "utf8",
);

describe("Storefront screen — Create + Edit stay on Storefront", () => {
  it("does NOT link 'Create product' to /dashboard/settings", () => {
    // The bug: an `<a href="/dashboard/settings?section=services&action=create">`
    // pulled the producer out of Storefront the moment they tried to
    // add a product. Replacement is a button-driven inline form (see
    // NewPackageForm import below).
    //
    // Only flag a literal href attribute pointing at the legacy URL —
    // comments / JSDoc that reference the old route as historical
    // context are intentionally allowed. The regex requires href=
    // immediately followed by an opening quote (single, double, or
    // template) so prose in /* … */ blocks slips through.
    expect(screenSource).not.toMatch(
      /href\s*=\s*[`"']\/dashboard\/settings\?section=services/,
    );
  });

  it("does NOT link product Edit menu item to /dashboard/settings", () => {
    // Same bug, second occurrence — the kebab → Edit item used the
    // same legacy URL with `&product=<id>`. The replacement is an
    // inline modal mounting NewPackageForm with initialValues.
    //
    // The Edit URL was a template literal (\`…${productId}\`), so we
    // also accept a backtick after href= to catch that exact form.
    expect(screenSource).not.toMatch(
      /href\s*=\s*[{`"'][^`"']*\/dashboard\/settings\?section=services&product=/,
    );
  });

  it("imports NewPackageForm so Create + Edit can render the inline form", () => {
    // Hard-pin: removing the bad URL doesn't help if the CTAs silently
    // become no-ops. The page MUST mount the existing form so the
    // producer can finish create + edit flows without leaving
    // Storefront. NewPackageForm covers BOTH cases — passing
    // initialValues flips it into edit mode.
    expect(screenSource).toMatch(/from\s+["']\S*\/booking\/package-form["']/);
    expect(screenSource).toContain("NewPackageForm");
  });
});
