import { describe, it, expect } from "vitest";
import { selectBanner, type BannerStageInput } from "./banner-helpers";

describe("selectBanner", () => {
  it("returns 'paused' for payment_paused", () => {
    expect(selectBanner("payment_paused")).toBe("paused");
  });

  it("returns 'cancelled' for cancelled (Important 4 — was missing entirely)", () => {
    // Pre-fix the share page only branched on "payment_paused", so
    // cancelled projects rendered the full music + comments room with
    // no signal that the engagement had ended. The artist could keep
    // submitting comments that go nowhere.
    expect(selectBanner("cancelled")).toBe("cancelled");
  });

  it("returns null for normal Kanban stages", () => {
    const normal: BannerStageInput[] = [
      "lead",
      "booked",
      "contract_sent",
      "in_production",
      "final_review",
      "paid",
      "archived",
    ];
    for (const stage of normal) {
      expect(selectBanner(stage)).toBeNull();
    }
  });
});
