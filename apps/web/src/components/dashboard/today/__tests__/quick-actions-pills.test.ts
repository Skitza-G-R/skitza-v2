import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the QuickActions surface: pins which labels
// the four primary cards + four secondary pills render. A full-DOM
// render test would require mocking next-intl, useToast, server
// actions, and clipboard APIs for what is fundamentally a "did the
// labels we agreed on actually ship?" check. Reading the source
// catches regressions of the form "someone re-added the duplicated
// Copy share link card without re-reading PRD §4.1."
//
// PRD §4.1 (locked 2026-04-25) — the QuickActions strip is:
//   Primary cards (creation/share):
//     - Upload track / New booking / Send invoice / Share via WhatsApp
//   Secondary pills (utilities):
//     - Search / Add offline client / Quick note / Edit /join page
// "Copy share link" + "Preview public page" were retired (the
// ShareLinkCard header carries those actions exclusively).

const here = dirname(fileURLToPath(import.meta.url));
const QUICK_ACTIONS_PATH = join(here, "..", "quick-actions.tsx");
const source = readFileSync(QUICK_ACTIONS_PATH, "utf8");

describe("QuickActions — primary card labels (PRD §4.1)", () => {
  it.each([
    "uploadTrack",
    "newBooking",
    "sendInvoice",
    "shareViaWhatsApp",
  ])("renders <PrimaryButton label={t(%s)}>", (key) => {
    expect(source).toContain(`label={t("${key}")}`);
  });
});

describe("QuickActions — secondary pill labels (PRD §4.1)", () => {
  it.each([
    "search",
    "addOfflineClient",
    "quickNote",
    "editJoinPage",
  ])("renders <Chip label={t(%s)}>", (key) => {
    expect(source).toContain(`label={t("${key}")}`);
  });
});

describe("QuickActions — retired keys must not reappear", () => {
  it.each([
    "copyShareLink",
    "previewPublic",
  ])("source has no t(%s) reference", (key) => {
    expect(source).not.toContain(`t("${key}")`);
  });
});

describe("QuickActions — Edit /join page deep-links to Setup → Profile", () => {
  it("uses the section=profile query param so the producer lands on the right tab", () => {
    expect(source).toContain('href="/dashboard/settings?section=profile"');
  });
});

describe("QuickActions — Share via WhatsApp opens wa.me with encoded text", () => {
  it("uses wa.me with no phone number so the OS picks the share target", () => {
    expect(source).toContain("https://wa.me/?text=");
  });
  it("URL-encodes the share text (avoids breaking on spaces/special chars)", () => {
    expect(source).toContain("encodeURIComponent");
  });
});
