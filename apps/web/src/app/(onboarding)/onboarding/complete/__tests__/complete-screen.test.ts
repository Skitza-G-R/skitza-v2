import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMPLETE_DASHBOARD_HREF,
  artistPreviewHref,
  completionFollowUpHref,
} from "../complete-screen-client";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "complete-screen-client.tsx"), "utf8");
const pageSource = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("producer onboarding completion screen", () => {
  it("uses truthful published-page language without a Skitza payment promise", () => {
    expect(clientSource).toContain("Your public page is ready to share");
    expect(clientSource).toContain("Published");
    expect(clientSource).not.toMatch(/browse,?\s*book,?\s*and pay/i);
    expect(clientSource).not.toContain("opened my hall");
    expect(clientSource).not.toContain("You're live");
  });

  it("opens the main dashboard with the Store tip", () => {
    expect(COMPLETE_DASHBOARD_HREF).toBe("/dashboard");
    expect(clientSource).toContain("Open dashboard");
  });

  it("offers copy, the first-artist simulation, the public page, and native mobile sharing", () => {
    expect(clientSource).toContain("Copy link");
    expect(clientSource).toContain("Watch your first artist");
    expect(clientSource).toContain("Open public page");
    expect(clientSource).toContain("Preview as artist");
    expect(clientSource).toContain("navigator.share");
    expect(clientSource).toContain("sm:hidden");
  });

  it("plays the simulation before the push ask and feeds it the live product (SK-298)", () => {
    const simulationButton = clientSource.indexOf("Watch your first artist");
    const pushBanner = clientSource.indexOf("<PushMomentBanner");
    expect(simulationButton).toBeGreaterThan(-1);
    expect(pushBanner).toBeGreaterThan(simulationButton);
    expect(clientSource).toContain("<FirstArtistSimulation");
    expect(clientSource).toContain("publicUrl: fullUrl");
    expect(clientSource).toContain("dashboard: COMPLETE_DASHBOARD_HREF");
    expect(pageSource).toContain("toSimulationInput({");
    expect(pageSource).toContain("caller.producer.purchase.paymentInstructions.get()");
    expect(pageSource).toContain("simulation={PREVIEW_SIMULATION_INPUT}");
    // The simulation only exists after the role gate and the active-product check.
    expect(pageSource.indexOf("toSimulationInput({")).toBeGreaterThan(
      pageSource.indexOf('redirect("/onboarding")'),
    );
  });

  it("keeps the local walkthrough inside preview mode", () => {
    expect(artistPreviewHref("preview-studio", true)).toBe("/onboarding/review?__preview=1");
    expect(completionFollowUpHref("/onboarding/portfolio", true)).toBe(
      "/onboarding/portfolio?__preview=1",
    );
    expect(completionFollowUpHref("/onboarding/payment", true)).toBe(
      "/onboarding/payment?__preview=1",
    );
    expect(pageSource).toMatch(
      /<CompleteScreenClient\s+slug="preview-studio"\s+previewMode\s+simulation=\{PREVIEW_SIMULATION_INPUT\}\s*\/>/,
    );
  });

  it("uses the real public page outside preview mode", () => {
    expect(artistPreviewHref("gili-asraf", false)).toBe("https://skitza.app/join/gili-asraf");
    expect(completionFollowUpHref("/onboarding/portfolio", false)).toBe("/onboarding/portfolio");
    expect(pageSource).toContain("packages.some((product) => product.active)");
    expect(pageSource).toContain('redirect("/onboarding")');
  });

  it("keeps portfolio and direct-payment setup optional", () => {
    expect(clientSource).toContain("Optional next steps");
    expect(clientSource).toContain("/onboarding/portfolio");
    expect(clientSource).toContain("/onboarding/payment");
    expect(clientSource).toMatch(/Skitza never handles\s+the money/);
  });
});
