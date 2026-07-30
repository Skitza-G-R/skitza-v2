import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ArtistProductPreview } from "~/app/(producer)/dashboard/store/artist-product-preview";

const here = dirname(fileURLToPath(import.meta.url));
const reviewSource = readFileSync(join(here, "..", "review-step-client.tsx"), "utf8");
const chromeSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "components",
    "onboarding",
    "wizard-shell",
    "wizard-chrome.tsx",
  ),
  "utf8",
);

describe("onboarding review composition", () => {
  it("opts into a wide two-column canvas without changing the default onboarding width", () => {
    expect(reviewSource).toContain('contentWidth="wide"');
    expect(reviewSource).toContain("lg:grid-cols");
    expect(chromeSource).toContain('contentWidth = "default"');
    expect(chromeSource).toContain('contentWidth === "wide"');
    expect(chromeSource).toContain("max-w-[620px]");
  });

  it("frames a full signed-in Store preview with real artist-facing components", () => {
    expect(reviewSource).toContain('presentation="storefront"');
    expect(reviewSource).toContain('aria-label="Artist Store preview"');

    const html = renderToStaticMarkup(
      <ArtistProductPreview
        name="Signature production"
        tagline="From the first idea to a release-ready master."
        producerName="Maya Stone"
        priceCents={180_000}
        currency="ILS"
        pricingModel="flat"
        volumeTiers={[]}
        includesSessions={true}
        sessions={3}
        unlimitedSessions={false}
        duration="60 min"
        includes={["Production", "Mix", "Master"]}
        revisions={2}
        unlimitedRevisions={false}
        paymentPlans={[{ kind: "split_50_50" }]}
        royaltyTerms={null}
        agreementText=""
        presentation="storefront"
      />,
    );

    expect(html).toContain("Store");
    expect(html).toContain('aria-label="Maya Stone storefront"');
    expect(html).toContain("Signature production");
    expect(html).toContain("₪1,800");
    expect(html).toContain("View details");
  });
});
