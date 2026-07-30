import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "product-detail-screen.tsx"), "utf8");
const actions = readFileSync(join(here, "..", "actions.ts"), "utf8");
const page = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(artist)",
    "artist",
    "purchase",
    "[productId]",
    "page.tsx",
  ),
  "utf8",
);

describe("unified artist product detail", () => {
  it("renders product, producer, deliverables, rights, and enabled plans", () => {
    expect(source).toMatch(/product\.name/);
    expect(source).toMatch(/producer\.name/);
    expect(source).toMatch(/product\.includes\.map/);
    expect(source).toMatch(/royaltyTermsDisplay/);
    expect(source).toMatch(/product\.paymentPlans\.map/);
  });

  it("owns per-song quantity and deterministic volume pricing", () => {
    expect(source).toMatch(/product\.pricingModel === "per_song"/);
    expect(source).toMatch(/<SongCountStepper/);
    expect(source).toMatch(/songQty: songState\.qty/);
    expect(source).not.toMatch(/unitPriceCents: songState/);
  });

  it("defaults to a new project and makes an existing target deliberate", () => {
    expect(source).toMatch(/useState<"new" \| "existing">\("new"\)/);
    expect(source).toMatch(/Start a new project/);
    expect(source).toMatch(/Add to an existing project/);
    expect(source).toMatch(/targetKind === "existing" && projectId/);
    expect(source).toMatch(/activePurchase !== null/);
    expect(source).toMatch(/\(!online && requiresLiveRequest\)/);
    expect(source).toMatch(/!targetIsReady/);
  });

  it("shows enough context for each same-client project", () => {
    expect(source).toMatch(/project\.title/);
    expect(source).toMatch(/project\.lifecycleStatus/);
    expect(source).toMatch(/project\.workflowStage/);
    expect(source).toMatch(/project\.updatedAtIso/);
  });

  it("uses tax-inclusive totals and preserves unlimited commercial rules", () => {
    expect(source).toMatch(/applyTaxToCents\(proposalSubtotal, taxMode, taxRatePct\)/);
    expect(source).toMatch(/planLabel\(plan, proposalTotal/);
    expect(source).toMatch(/product\.unlimitedRevisions/);
    expect(source).not.toMatch(/: "1 project"/);
  });

  it("sends only request intent with a stable operation identity", () => {
    expect(source).toMatch(/requestToBookAction\(\{/);
    expect(source).toMatch(/operationKeyRef\.current \?\? crypto\.randomUUID\(\)/);
    expect(source).toMatch(/projectId \? \{ projectId \}/);
    expect(actions).toMatch(/songQty\?: number/);
    expect(actions).toMatch(/projectId\?: string/);
    expect(actions).not.toMatch(/unitPriceCents/);
  });

  it("routes a successful request to the sent state", () => {
    expect(source).toMatch(/router\.push\(/);
    expect(source).toMatch(/withArtistStudio\(/);
    expect(source).toMatch(
      /`\/artist\/purchase\/\$\{productId\}\/sent\?req=\$\{result\.purchaseRequestId\}`/,
    );
    expect(source).toMatch(/studioId/);
  });

  it("shows the server-authored active purchase guard before another request", () => {
    expect(page).toContain("caller.artist.purchase.activeForStudio");
    expect(source).toContain("activePurchase");
    expect(source).toContain("Finish your current purchase");
    expect(source).toContain("withArtistStudio(activePurchase.href, studioId)");
    expect(source).toMatch(/activePurchase !== null/);
  });

  it("states the actual acceptance boundary instead of promising a request-time lock", () => {
    expect(source).toMatch(/freeze only when\s+you\s+accept after approval/);
    expect(source).not.toMatch(/locks at request|price locks now|stays fixed once you request/i);
  });

  it("keeps an in-flow back action and mobile controls reachable", () => {
    expect(source).toContain("Back to Store");
    expect(source).toContain('router.push(withArtistStudio("/artist/store", studioId))');
    expect(source).toMatch(/min-h-11/);
    expect(source).not.toContain("<StickyNav");
    expect(source).not.toContain("fixed inset-0");
  });

  it("supports a producer preview with callback back and no real submission", () => {
    expect(source).toMatch(/previewMode\?: boolean/);
    expect(source).toMatch(/onPreviewBack\?: \(\) => void/);
    expect(source).toMatch(
      /if \(previewMode \|\| activePurchase \|\| sending \|\| !targetIsReady\) return/,
    );
    expect(source).toMatch(
      /disabled=\{\s*previewMode \|\|[\s\S]*activePurchase !== null \|\|[\s\S]*\(!online && requiresLiveRequest\)/,
    );
    expect(source).toMatch(/if \(onPreviewBack\)/);
  });
});
