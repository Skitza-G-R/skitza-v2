import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "service-step-client.tsx"), "utf8");
const editorSource = readFileSync(
  join(here, "..", "..", "..", "..", "(producer)", "dashboard", "store", "product-editor.tsx"),
  "utf8",
);
const shellSource = readFileSync(
  join(here, "..", "..", "..", "..", "(producer)", "dashboard", "store", "editor-shell.tsx"),
  "utf8",
);

describe("onboarding first-product editor", () => {
  it("mounts the canonical Store ProductEditor instead of copying its steps", () => {
    expect(source).toContain("<ProductEditor");
    expect(source).toContain('newProductFlow="onboarding"');
    expect(source).not.toContain("<TypeStep");
    expect(source).not.toContain("<PricingStep");
    expect(source).not.toContain("<ReviewStep");
  });

  it("embeds the editor inside the visible onboarding chrome", () => {
    expect(source).toContain("<WizardChrome");
    expect(source).toContain("activePosition={SERVICE_STEP_INDEX}");
    expect(source).toContain('presentation="embedded"');
    expect(source).not.toContain("hideOuterProgress");
  });

  it("preserves the exact seven-step Store flow and runtime draft", () => {
    expect(editorSource).toMatch(
      /const NEW_STEPS[\s\S]*"type"[\s\S]*"details"[\s\S]*"price"[\s\S]*"payment"[\s\S]*"delivery"[\s\S]*"rights"[\s\S]*"review"/,
    );
    expect(source).toContain("useProducerStoreProductDraft");
    expect(source).toContain("persistedDraft={storeDraft.record}");
    expect(source).toContain("onPersistDraft={storeDraft.save}");
  });

  it("creates hidden during onboarding and publishes only at final review", () => {
    expect(editorSource).toContain('newProductFlow?: "store" | "onboarding"');
    expect(shellSource).toContain("Continue setup");
    expect(shellSource).toContain(
      "This stays hidden until you publish your page at the end of setup.",
    );
    expect(shellSource).toMatch(/newProductFlow === "onboarding"[\s\S]*onClick=\{onSaveHidden\}/);
  });

  it("routes by whether the saved product includes bookable sessions", () => {
    expect(source).toContain(
      'includesSessions ? "/onboarding/availability" : "/onboarding/review"',
    );
  });

  it("keeps the development walkthrough write-free", () => {
    expect(source).toContain("previewMode={previewMode}");
    expect(editorSource).toMatch(
      /if \(previewMode\) \{[\s\S]*handleSuccessfulSubmit\(\);[\s\S]*return;/,
    );
  });

  it("keeps dialog presentation as the Store default while onboarding opts into embedding", () => {
    expect(editorSource).toContain('presentation?: "dialog" | "embedded"');
    expect(editorSource).toContain('presentation = "dialog"');
    expect(editorSource).toContain("presentation={presentation}");
  });
});
