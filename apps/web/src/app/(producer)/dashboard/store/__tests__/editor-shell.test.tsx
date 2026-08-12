// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorShell } from "../editor-shell";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-shell.tsx"), "utf8");
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

function EditorShellStepHarness() {
  const [current, setCurrent] = useState("recipient");
  const onNoop = vi.fn();
  const priceStep = current === "price";

  return (
    <EditorShell
      open
      onOpenChange={onNoop}
      presentation="embedded"
      mode="new"
      steps={["recipient", "price"]}
      current={current}
      title={priceStep ? "Set the price" : "Choose a recipient"}
      canContinue
      onBack={() => {
        setCurrent("recipient");
      }}
      onContinue={() => {
        setCurrent("price");
      }}
      onSave={onNoop}
      onPublish={onNoop}
      onSaveHidden={onNoop}
      onDiscard={onNoop}
      isLastStep={priceStep}
      isFirstStep={!priceStep}
      showDiscard={false}
    >
      <p>{priceStep ? "Price fields" : "Recipient fields"}</p>
    </EditorShell>
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

describe("EditorShell shell", () => {
  it("uses Radix Dialog for portal + scrim", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
  });

  it("keeps dialog as the default and supports an inline onboarding frame", () => {
    expect(SRC).toContain('presentation?: "dialog" | "embedded"');
    expect(SRC).toContain('presentation = "dialog"');
    expect(SRC).toContain('presentation === "embedded"');
    expect(SRC).toContain("<section");
    expect(SRC).toContain("overflow-hidden rounded-[var(--radius-xl)] border");
  });

  it("does not render the embedded frame when the editor is closed", () => {
    expect(SRC).toContain("if (!open && embedded) return null");
  });

  it("renders the step indicator label (Step N of M)", () => {
    expect(SRC).toMatch(/Step\s+\$\{|Step \$/);
  });

  it("renders the StepBar component", () => {
    expect(SRC).toMatch(/<StepBar/);
  });

  it("renders the accessible inline save status without the old Draft saved copy", () => {
    expect(SRC).toMatch(/<SaveIndicator\s+status=\{saveStatus\}/);
    expect(SRC).not.toContain("Draft saved");
  });

  it("renders Back and Continue labels in the footer", () => {
    expect(SRC).toContain("Back");
    expect(SRC).toContain("Continue");
  });

  it("makes publish explicit and offers an atomic hidden alternative", () => {
    expect(SRC).toMatch(/Publish product/);
    expect(SRC).toMatch(/Save hidden/);
    expect(SRC).toMatch(/Publishing makes this visible to connected artists immediately/);
  });

  it("labels edits according to their current visibility", () => {
    expect(SRC).toMatch(/Save live changes/);
    expect(SRC).toMatch(/Save hidden changes/);
    expect(SRC).toMatch(/Artists will see this update immediately/);
  });

  it("keeps discard separate from the close button", () => {
    expect(SRC).toMatch(/Discard draft/);
    expect(SRC).toMatch(/onDiscard/);
  });

  it("has a close X button in the header", () => {
    expect(SRC).toMatch(/closeLabel = "Close"/);
    expect(SRC).toMatch(/aria-label=\{closeLabel\}/);
    expect(SRC).toMatch(/DialogPrimitive\.Close[\s\S]*?disabled=\{pending\}/);
    expect(SRC).toContain("if (!nextOpen && pending) return");
  });

  it("uses popIn animation per the design brief", () => {
    expect(SRC).toMatch(/popIn|scale\(0\.97\)|translateY\(12/);
  });

  it("uses the wider desktop modal and a true full-screen mobile flow", () => {
    expect(SRC).toContain("max-w-[680px]");
    expect(SRC).toContain("max-sm:inset-0");
    expect(SRC).toContain("max-sm:h-[100dvh]");
    expect(SRC).toContain("max-sm:max-h-none");
    expect(SRC).not.toContain("max-sm:max-h-[92dvh]");
  });

  it("wraps the final action row and clears the iOS home indicator", () => {
    expect(SRC).toMatch(/max-sm:flex-wrap/);
    expect(SRC).toMatch(/safe-area-inset-bottom/);
  });

  it("keeps only the body scrollable and allows instructions to wrap", () => {
    expect(SRC.match(/overflow-y-auto/g)).toHaveLength(1);
    expect(SRC).toMatch(/whitespace-normal/);
    expect(SRC).not.toMatch(/DialogPrimitive\.Description[^>]*truncate/);
  });

  it("resets the body scroll position when the active step changes", () => {
    expect(SRC).toMatch(/useLayoutEffect/);
    expect(SRC).toMatch(/bodyRef\.current\.scrollTop\s*=\s*0/);
    expect(SRC).toMatch(/\[current, open, presentation\]/);
    expect(SRC).toContain('scrollIntoView({ block: "start" })');
  });

  it("moves focus to the new step heading after an explicit step change", () => {
    render(<EditorShellStepHarness />);

    expect(screen.getByRole("heading", { name: "Choose a recipient" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    const nextHeading = screen.getByRole("heading", { name: "Set the price" });
    expect(document.activeElement).toBe(nextHeading);
  });
});
