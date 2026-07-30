import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STEP_NAME,
  PORTFOLIO_HELPER_COPY,
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_STEP_TITLE,
  routeOnBackFromPortfolio,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
} from "../page";

const pageSource = readFileSync(fileURLToPath(new URL("../page.tsx", import.meta.url)), "utf8");

// Post-publish optional portfolio page contract.
// Repo runs vitest in `node` env (no jsdom) so we pin pure constants
// + helpers, no JSX.

describe("optional portfolio page contract", () => {
  describe("constants", () => {
    it("keeps a valid hidden-shell position without presenting numbered setup progress", () => {
      expect(PORTFOLIO_STEP_INDEX).toBe(4);
    });

    it("title is about the producer's work / portfolio (keyword-level)", () => {
      expect(PORTFOLIO_STEP_TITLE.toLowerCase()).toMatch(/work|taste|sound|show|portfolio/);
    });

    it("subtitle is welcoming and mentions optionality / sample / link", () => {
      expect(PORTFOLIO_STEP_SUBTITLE.toLowerCase()).toMatch(
        /optional|skip|link|later|few|setup|portfolio/,
      );
    });

    it("helper copy stays welcoming (mentions optionality)", () => {
      expect(PORTFOLIO_HELPER_COPY.toLowerCase()).toMatch(/optional|skip|fill what|none/);
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      expect(ONBOARDING_STEP_NAME).toBe("portfolio");
    });
  });

  describe("completion routes", () => {
    it("returns to completion after Continue", () => {
      expect(routeOnContinueFromPortfolio()).toBe("/onboarding/complete");
    });

    it("returns to completion after Skip", () => {
      expect(routeOnSkipFromPortfolio()).toBe("/onboarding/complete");
    });

    it("returns to completion after Back", () => {
      expect(routeOnBackFromPortfolio()).toBe("/onboarding/complete");
    });

    it("preserves the local preview query on every route", () => {
      expect(routeOnContinueFromPortfolio(true)).toBe("/onboarding/complete?__preview=1");
      expect(routeOnSkipFromPortfolio(true)).toBe("/onboarding/complete?__preview=1");
      expect(routeOnBackFromPortfolio(true)).toBe("/onboarding/complete?__preview=1");
    });
  });

  describe("post-publish optional presentation", () => {
    it("passes preview mode through and removes numbered onboarding progress", () => {
      expect(pageSource).toContain("<PortfolioStepClient previewMode />");
      const clientSource = readFileSync(
        fileURLToPath(new URL("../portfolio-step-client.tsx", import.meta.url)),
        "utf8",
      );
      expect(clientSource).toContain("hideOuterProgress");
      expect(clientSource).toContain('stepIndicator="Optional page details"');
      expect(clientSource).not.toMatch(/Step 4 of 5/);
    });

    it("does not write in local preview mode", () => {
      const clientSource = readFileSync(
        fileURLToPath(new URL("../portfolio-step-client.tsx", import.meta.url)),
        "utf8",
      );
      const previewBranch = clientSource.indexOf("if (previewMode)");
      const saveCall = clientSource.indexOf("await saveExternalLinks");
      expect(previewBranch).toBeGreaterThan(-1);
      expect(saveCall).toBeGreaterThan(previewBranch);
    });
  });

  describe("legacy route aliases are removed", () => {
    it("does not advance into another optional task", () => {
      expect(routeOnContinueFromPortfolio()).not.toBe("/onboarding/payment");
    });
  });

  describe("saved-link hydration", () => {
    it("queries links with the authenticated producer id and passes them to the client", () => {
      expect(pageSource).toContain(".from(producerExternalLinks)");
      expect(pageSource).toMatch(
        /\.where\(\s*eq\(\s*producerExternalLinks\.producerId,\s*role\.producer\.id\s*\)\s*\)/s,
      );
      expect(pageSource).toContain("<PortfolioStepClient initialLinks={initialLinks} />");
    });
  });
});
