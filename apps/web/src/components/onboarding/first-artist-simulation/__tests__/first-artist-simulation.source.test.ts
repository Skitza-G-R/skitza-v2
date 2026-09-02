import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const OVERLAY = readFileSync(join(here, "..", "first-artist-simulation.tsx"), "utf8");
const MODEL = readFileSync(join(here, "..", "simulation-model.ts"), "utf8");

describe("FirstArtistSimulation source contract (SK-298)", () => {
  it("is a render-only overlay with no server, mutation, or dev-gallery dependency", () => {
    expect(OVERLAY).not.toMatch(/from "~\/server\//);
    expect(OVERLAY).not.toMatch(/proof-actions|requestToBookAction|acceptPurchaseAction/);
    expect(OVERLAY).not.toMatch(/useMutation|createCaller|fetch\(/);
    expect(OVERLAY).not.toMatch(/dev-gallery-access|isDevGalleryAvailable|isDevPreviewBypass/);
    expect(OVERLAY).not.toMatch(/router\.(?:push|replace)/);
    // The model may import server *types* only.
    const serverImports = MODEL.match(/import[^;]*from "~\/server\/[^"]+";/g) ?? [];
    expect(serverImports.length).toBeGreaterThan(0);
    expect(serverImports.every((line) => line.startsWith("import type"))).toBe(true);
  });

  it("keeps the artist storyboard inert and the producer screens on their preview callbacks", () => {
    expect(OVERLAY).toMatch(/<div\s+inert\s+aria-hidden/);
    expect(OVERLAY).toContain("previewOnly");
    expect(OVERLAY).toContain("requestHrefOverride={INERT_HREF}");
    expect(OVERLAY).toContain("previewNextHref={INERT_HREF}");
    expect(OVERLAY).toContain("previewSentHref={INERT_HREF}");
    expect(OVERLAY).toContain("previewReference={SIMULATION_IDS.requestRef}");
    expect(OVERLAY).toContain("previewProofHref={INERT_HREF}");
    expect(OVERLAY).toContain("onPreviewDecision={handleProofDecision}");
  });

  it("composes the live artist and producer screens instead of mock-ups", () => {
    for (const component of [
      "ProducerHero",
      "FocalProductCard",
      "ProfessionalProductDetail",
      "PurchaseRequestScreen",
      "RequestSentScreen",
      "ChoosePlanScreen",
      "ReviewAgreeScreen",
      "PaymentInstructionsScreen",
      "UploadProofScreen",
      "PaymentProofReview",
    ]) {
      expect(OVERLAY).toContain(`<${component}`);
    }
  });

  it("labels every frame as a simulation and honours reduced motion through existing primitives", () => {
    expect(OVERLAY).toContain("SIMULATION_LABEL");
    expect(OVERLAY).toMatch(/nothing is sent or saved/i);
    expect(OVERLAY).toContain("Nothing was sent or saved.");
    expect(OVERLAY).toContain("sk-step-enter");
    expect(OVERLAY).not.toMatch(/framer-motion|@keyframes/);
  });

  it("uses the existing viewport tokens so fixed funnel screens stay inside the phone frame", () => {
    expect(OVERLAY).toContain('"--sk-viewport-height": "100%"');
    expect(OVERLAY).toContain('"--sk-viewport-offset-top": "0px"');
    expect(OVERLAY).toContain('transform: "translateZ(0)"');
  });
});
