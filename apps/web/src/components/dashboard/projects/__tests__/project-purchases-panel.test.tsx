import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectPurchasesPanel, type ProjectPurchaseSummary } from "../project-purchases-panel";

describe("ProjectPurchasesPanel imported agreement", () => {
  it("shows the exact producer provenance without inventing Artist acceptance", () => {
    const purchase: ProjectPurchaseSummary = {
      id: "purchase-imported",
      sourceKind: "imported_existing_work",
      sourceLabel: "Existing single agreement",
      lifecycleStatus: "active",
      totalCents: 120_000,
      currency: "USD",
      reference: "SK-IMPORTED-1",
      provenanceNotice: "Added by producer from an existing agreement",
      installments: [],
    };

    const html = renderToStaticMarkup(
      <ProjectPurchasesPanel projectId="project-1" purchases={[purchase]} />,
    );

    expect(html).toContain("Existing agreement");
    expect(html).toContain("Added by producer from an existing agreement");
    expect(html).toContain("Cancel purchase");
    expect(html).not.toMatch(/artist accepted|accepted by artist/i);
  });
});
