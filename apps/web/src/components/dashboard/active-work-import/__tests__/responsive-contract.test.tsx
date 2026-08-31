import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const editorSource = readFileSync(join(here, "..", "import-row-editor.tsx"), "utf8");
const listSource = readFileSync(join(here, "..", "import-row-list.tsx"), "utf8");
const agreementSource = readFileSync(join(here, "..", "agreement-editor.tsx"), "utf8");
const paymentSource = readFileSync(join(here, "..", "payment-history-editor.tsx"), "utf8");
const reviewSource = readFileSync(join(here, "..", "review-and-finish.tsx"), "utf8");
const workspaceSource = readFileSync(join(here, "..", "active-work-import-workspace.tsx"), "utf8");
const globalsCss = readFileSync(
  join(here, "..", "..", "..", "..", "app", "globals.css"),
  "utf8",
);

describe.each([360, 390])("active-work import at %ipx", (width) => {
  it("keeps the mobile editor above the producer bottom navigation", () => {
    expect(width).toBeGreaterThanOrEqual(360);
    expect(editorSource).toContain(
      "sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[70] flex flex-col overflow-hidden",
    );
    expect(editorSource).toContain("sk-native-action-dock fixed inset-x-0 z-[80]");
    expect(editorSource).toContain("sk-native-scroll min-h-0 flex-1");
    expect(workspaceSource).toContain("createPortal(reviewPanel, mobilePortalTarget)");
    expect(workspaceSource).toContain("mobilePortalTarget");
    expect(workspaceSource).toContain("document.body");
    expect(editorSource).not.toContain("fixed inset-0 z-30");
  });

  // SK: the mobile editor and Review panel are pinned to
  // `--sk-viewport-offset-top` so the keyboard cannot push them out of the
  // visual viewport. iOS also reports a transient non-zero `offsetTop` during
  // an ordinary rubber-band overscroll, which slid the whole screen with the
  // finger — scrolling down made the editor jump back up. globals.css anchors
  // every `.sk-native-screen` while the keyboard is closed; these producer
  // screens must be covered by that rule, not only the Artist shell.
  it("anchors the full-screen editor during rubber-band overscroll", () => {
    expect(globalsCss).toMatch(
      /body:not\(\[data-sk-keyboard="open"\]\)\s+\.sk-native-screen\s*\{\s*top:\s*0;\s*\}/,
    );
    expect(globalsCss).not.toMatch(
      /main#main-content\[data-artist-shell-mode="focused"\]\s*\.sk-native-screen/,
    );
    expect(editorSource).toContain("sk-native-screen");
    expect(reviewSource).toContain("sk-native-screen");
  });

  // iOS Safari implements no <datalist>, so a combobox built on one offers a
  // phone nothing at all. The client picker must stay a plain search + list.
  it("picks a client from real controls rather than a datalist", () => {
    expect(editorSource).not.toContain("<datalist");
    expect(editorSource).not.toMatch(/\blist=\{`import-client-options/);
    expect(editorSource).toContain('aria-label="Matching clients"');
    expect(editorSource).toContain("Change client");
  });

  it("keeps content shrinkable with no fixed phone-width surface", () => {
    expect(editorSource).toContain("min-w-0");
    expect(listSource).toContain("min-w-0");
    expect(editorSource).not.toMatch(/w-\[(?:360|390|400|440)px\]/);
    expect(listSource).not.toMatch(/min-w-\[(?:360|390|400|440)px\]/);
  });

  it("keeps review and payment actions at least 44px tall", () => {
    expect(reviewSource).toContain(
      "sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[70] flex min-w-0 flex-col overflow-hidden",
    );
    expect(reviewSource).toContain("sk-native-action-dock fixed inset-x-0 z-[80]");
    expect(reviewSource).toMatch(/summary className="[^"]*min-h-11[^"]*"/);
    expect(paymentSource).toMatch(/className="[^"]*min-h-11[^"]*"[\s\S]{0,120}Remove proof/);
    expect(paymentSource).not.toMatch(/min-h-9[^"]*"[\s\S]{0,120}Remove proof/);
  });
});

describe("active-work import semantics", () => {
  it("gives the 360px header enough room for the full title and progress copy", () => {
    expect(workspaceSource).toContain(
      "max-[374px]:grid max-[374px]:grid-cols-[2.75rem_minmax(0,1fr)_auto]",
    );
    expect(workspaceSource).toContain('className="min-w-0 flex-1 max-[374px]:contents"');
    expect(workspaceSource).toMatch(
      /<h1 className="[^"]*max-\[374px\]:col-span-2[^"]*max-\[374px\]:text-clip[^"]*">\s*Bring in active work/,
    );
    expect(workspaceSource).toMatch(
      /aria-label="Import progress"[\s\S]{0,360}max-\[374px\]:col-span-2[\s\S]{0,260}max-\[374px\]:text-clip/,
    );
    expect(workspaceSource).toMatch(
      /<span className="[^"]*max-\[374px\]:overflow-visible max-\[374px\]:text-clip">\s*\{String\(needsInfoCount\)\} Need info/,
    );
    expect(workspaceSource).toContain("max-[374px]:px-2 sm:min-w-36");
  });

  it("keeps native list and button semantics", () => {
    expect(listSource).toMatch(/<ul\s+aria-label="Active work items"/);
    expect(listSource).toContain("<li key={row.operationKey}>");
    expect(listSource).not.toContain('role="listitem"');
  });

  it("uses simple agreement language", () => {
    expect(listSource).toContain("Add one client, project, and agreement");
    expect(listSource).not.toContain("Client + Project + Purchase");
    expect(editorSource).not.toContain("One album is one Project");
  });

  it("renders one three-step surface and keeps the mobile dock clear of content", () => {
    expect(editorSource).toContain(
      'IMPORT_EDITOR_STEPS = ["Client & Project", "Agreement", "Payments"]',
    );
    expect(editorSource).not.toContain('"Client", "Project"');
    expect(editorSource).toContain("data-active-import-step");
    expect(editorSource).toContain("pb-36");
    expect(editorSource).toContain("Finish item");
    expect(editorSource).toContain("Save for later");
  });

  it("uses the compact desktop queue and keeps optional agreement details collapsed", () => {
    expect(listSource).toContain('data-active-import-queue="compact-table"');
    expect(listSource).toContain("lg:min-h-[64px]");
    expect(editorSource).toContain('title="Client & Project"');
    expect(editorSource).toContain("Add phone");
    expect(editorSource).toContain("Continue to agreement");
    expect(editorSource).toContain("Continue to payments");
    expect(agreementSource).toContain("More agreement details");
    expect(agreementSource).toContain("Step 2 of 3");
    expect(agreementSource).not.toMatch(/Service[\s\S]{0,80}\(optional\)/);
    expect(agreementSource).toContain("Press Enter to add another.");
    expect(agreementSource).toContain("resizeAgreementTerms");
    expect(agreementSource).toContain("min-h-24 resize-none overflow-hidden");
  });

  it("uses the shell-aligned 1024px switch for the split and full-screen editor", () => {
    expect(workspaceSource).toContain('window.matchMedia("(max-width: 1023px)")');
    expect(workspaceSource).toContain("lg:h-[calc(100dvh-4rem)]");
    expect(workspaceSource).toContain("lg:overflow-hidden lg:px-6 lg:pb-4");
    expect(workspaceSource).toContain(
      "lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(22rem,0.96fr)_minmax(0,1.44fr)] lg:items-stretch",
    );
    expect(workspaceSource).toContain("lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden");
    expect(workspaceSource).toContain("hidden min-w-0 lg:block lg:h-full lg:min-h-0");
    expect(workspaceSource).not.toContain("md:h-[calc(100dvh-4rem)]");
    expect(listSource).not.toMatch(
      /\bmd:(?:grid|block|hidden|flex-1|min-h-\[64px\]|overflow-y-auto)/,
    );
  });

  it("uses canonical quiet surfaces and keeps Syne to the page title", () => {
    expect(listSource).toContain("border-[rgb(var(--border-subtle))]");
    expect(listSource).toContain("shadow-[var(--shadow-sm)]");
    expect(editorSource).toContain("shadow-[var(--shadow-md)]");
    expect(editorSource).not.toContain("shadow-[0_22px_54px");
    expect(workspaceSource).toContain("sm:rounded-[var(--radius-md)] sm:pr-3");
    expect(agreementSource).toContain("sm:min-h-9 sm:rounded-[var(--radius-md)]");
    expect(agreementSource).toMatch(/font-mono text-\[9\.5px\][^\n]*uppercase">\s*Exact total/);
    expect(agreementSource).not.toMatch(/text-\[8(?:\.5)?px\][^\n]*Exact total/);
    const displayTypeUses = [workspaceSource, listSource, editorSource, agreementSource]
      .join("\n")
      .match(/font-syne/g);
    expect(displayTypeUses ?? []).toHaveLength(1);
  });

  it("lets the inline payment editor own the only primary action", () => {
    expect(editorSource).toContain("onEditingChange={setPaymentEditing}");
    expect(editorSource).toContain("activeStepIndex === 2 && paymentEditing");
    expect(editorSource).toContain("shadow-none");
    expect(paymentSource).toContain("onEditingChange?: (editing: boolean) => void");
  });

  it("uses a local-calendar date limit and never shows proof capability tokens", () => {
    expect(paymentSource).toContain("max={localDateInputValue()}");
    expect(paymentSource).not.toContain("toISOString().slice(0, 10)");
    expect(reviewSource).not.toMatch(/proofUploadToken|proofCapabilities|uploadToken/);
  });
});
