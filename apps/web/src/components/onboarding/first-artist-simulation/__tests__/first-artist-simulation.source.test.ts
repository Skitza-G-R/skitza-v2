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
    expect(OVERLAY).not.toMatch(/approvePurchaseRequest|declinePurchaseRequest/);
    expect(OVERLAY).not.toMatch(/useMutation|createCaller|fetch\(/);
    expect(OVERLAY).not.toMatch(/dev-gallery-access|isDevGalleryAvailable|isDevPreviewBypass/);
    expect(OVERLAY).not.toMatch(/router\.(?:push|replace)/);
    // The model may import server *types* only.
    const serverImports = MODEL.match(/import[^;]*from "~\/server\/[^"]+";/g) ?? [];
    expect(serverImports.length).toBeGreaterThan(0);
    expect(serverImports.every((line) => line.startsWith("import type"))).toBe(true);
  });

  it("keeps every live screen on a preview seam, since they are all pressable", () => {
    // The artist screens are no longer frozen pictures, so what keeps them
    // safe is that every control which would reach the server or leave the
    // page is handed a callback instead.
    expect(OVERLAY).not.toMatch(/\binert\b\s+aria-hidden/);
    expect(OVERLAY).toContain("onPreviewAccept={goNext}");
    expect(OVERLAY).toContain("onPreviewProof={goNext}");
    expect(OVERLAY).toContain("onPreviewSubmit={actNow}");
    expect(OVERLAY).toContain("swallowInertLink");
    expect(OVERLAY).toContain("previewOnly");
    expect(OVERLAY).toContain("previewSentHref={INERT_HREF}");
    expect(OVERLAY).toContain("previewProofHref={INERT_HREF}");
    expect(OVERLAY).toContain("previewReference={SIMULATION_IDS.requestRef}");
    expect(OVERLAY).toContain("onPreviewDecision={handleProofDecision}");
    expect(OVERLAY).toContain("onPreviewDecision={handleRequestDecision}");
    // The artist frames show what she did, not the screen before she did it.
    expect(OVERLAY).toContain("defaultAccepted={acted}");
    expect(OVERLAY).toContain("model.song.approved");
    // The song page knows it is inside a frame, so it keeps the phone layout
    // and never rewrites the browser address out from under the overlay.
    expect(OVERLAY).toContain("embedded");
    expect(MODEL).not.toMatch(/history\.|location\./);
  });

  it("scrolls to what each caption is about, since the live screens run past a phone", () => {
    expect(OVERLAY).toContain('revealSelector={SIMULATION_AGREE_SELECTOR}');
    expect(OVERLAY).toContain('revealSelector={SIMULATION_NOTE_SELECTOR}');
    expect(OVERLAY).toContain("scrollableAncestor");
  });

  it("gives phones an arrow and desktop a labelled button, with one accessible name", () => {
    expect(OVERLAY).toContain("aria-label={nextLabel}");
    expect(OVERLAY).toMatch(/<ChevronRight className="lg:hidden"/);
    expect(OVERLAY).toMatch(/hidden text-\[15px\] font-bold lg:inline/);
  });

  it("composes the live artist and producer screens instead of mock-ups", () => {
    for (const component of [
      "ProducerHero",
      "FocalProductCard",
      "PurchaseRequestReview",
      "PurchaseRequestCommercialDetails",
      "ReviewAgreeScreen",
      "PaymentInstructionsScreen",
      "PaymentProofReview",
      "SongPage",
      "BookingClient",
      "ConfirmationHero",
      "MySessionsScreen",
      "OverviewScreen",
      "RuntimeStatePreviewProvider",
    ]) {
      expect(OVERLAY).toContain(`<${component}`);
    }
  });

  it("labels every frame as a simulation and honours reduced motion through existing primitives", () => {
    expect(OVERLAY).toContain("SIMULATION_LABEL");
    expect(OVERLAY).toMatch(/nothing is sent or saved/i);
    expect(OVERLAY).toContain("Nothing was sent or saved.");
    expect(OVERLAY).toContain("sk-step-enter");
    expect(OVERLAY).toContain("prefers-reduced-motion: reduce");
    expect(OVERLAY).not.toMatch(/framer-motion|@keyframes/);
  });

  it("uses the existing viewport tokens so fixed funnel screens stay inside their frame", () => {
    expect(OVERLAY).toContain('"--sk-viewport-height": "100%"');
    expect(OVERLAY).toContain('"--sk-viewport-offset-top": "0px"');
    expect(OVERLAY).toContain('transform: "translateZ(0)"');
  });

  it("draws the song's waveform from stored peaks, never from audio", () => {
    expect(MODEL).toContain("previewPeaks");
    expect(MODEL).toContain("data:audio/wav;base64,");
    expect(MODEL).not.toMatch(/peaksUrl/);
  });
});
