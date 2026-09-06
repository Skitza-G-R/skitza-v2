import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const OVERLAY = readFileSync(join(here, "..", "first-artist-simulation.tsx"), "utf8");
const MODEL = readFileSync(join(here, "..", "simulation-model.ts"), "utf8");
const GLOBALS = readFileSync(join(here, "..", "..", "..", "..", "app", "globals.css"), "utf8");

describe("FirstArtistSimulation source contract (SK-310)", () => {
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

  it("draws its pictures instead of mounting the live screens", () => {
    // The reel replaced the eight live-screen frames with six drawn scenes.
    // A live screen would bring its own server actions and its own density
    // back in, so none may be composed here.
    for (const component of [
      "PurchaseRequestReview",
      "ReviewAgreeScreen",
      "PaymentInstructionsScreen",
      "PaymentProofReview",
      "SongPage",
      "BookingClient",
      "ConfirmationHero",
      "MySessionsScreen",
      "OverviewScreen",
      "FocalProductCard",
    ]) {
      expect(OVERLAY).not.toContain(`<${component}`);
    }
    for (const scene of ["HookScene", "LinkScene", "BookingScene", "LibraryScene", "MoneyScene", "StudioScene"]) {
      expect(OVERLAY).toContain(`function ${scene}(`);
    }
  });

  it("stamps every payoff with the same check and taps with the same ring", () => {
    expect(OVERLAY).toContain('data-testid="reel-stamp"');
    expect(OVERLAY).toContain("sk-reel-ring");
    // One Stamp per feature scene: link, booking, library, money.
    expect((OVERLAY.match(/<Stamp ms=/g) ?? []).length).toBe(4);
  });

  it("puts the producer's real product and price inside the pictures", () => {
    expect(OVERLAY).toContain("model.product.name");
    expect(OVERLAY).toContain("formatMoney(model.totalCents");
    expect(OVERLAY).toContain("links.publicUrl");
  });

  it("plays on its own and can be paused, skipped, and stepped", () => {
    expect(OVERLAY).toContain("useSceneTimeline");
    expect(OVERLAY).toContain('aria-label={paused ? "Play" : "Pause"}');
    expect(OVERLAY).toContain("sk-reel-paused");
    expect(OVERLAY).toContain("sk-reel-fill");
    expect(OVERLAY).toContain("aria-label={nextLabel}");
  });

  it("labels every screen as an example and honours reduced motion through existing primitives", () => {
    expect(OVERLAY).toContain("SIMULATION_LABEL");
    expect(OVERLAY).toMatch(/nothing is sent or saved/i);
    expect(OVERLAY).toContain("Nothing was sent or saved.");
    expect(OVERLAY).toContain("sk-step-enter");
    expect(OVERLAY).toContain("prefers-reduced-motion: reduce");
    expect(OVERLAY).not.toMatch(/framer-motion|@keyframes/);
    // Every reel primitive the overlay uses is declared in globals.css and
    // neutralised in its reduce block (motion-primitives.test.ts pins the gate).
    // Class names only: `--sk-reel-t` and friends are custom properties.
    const used = new Set(OVERLAY.match(/(?<!-)sk-reel-[a-z-]+/g) ?? []);
    expect(used.size).toBeGreaterThan(8);
    for (const className of used) {
      expect(GLOBALS).toContain(`.${className}`);
    }
  });

  it("draws the song's waveform from stored peaks, never from audio", () => {
    expect(OVERLAY).toContain("previewPeaks");
    expect(MODEL).toContain("data:audio/wav;base64,");
    expect(MODEL).not.toMatch(/peaksUrl/);
  });
});
