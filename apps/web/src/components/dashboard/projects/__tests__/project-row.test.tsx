import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "project-row.tsx"), "utf-8");

describe("ProjectRow source — grid + drag + gradient + status pills", () => {
  it("exports a ProjectRow component (function)", () => {
    expect(SRC).toMatch(/export function ProjectRow/);
  });

  it("uses the exact 8-column grid: 24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px", () => {
    expect(SRC).toContain(
      "24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px",
    );
  });

  it("is draggable=\"true\" for native HTML5 drag-to-reorder", () => {
    expect(SRC).toMatch(/draggable=("|\{)["']?true["']?("|\})/);
  });

  // Note: ProjectRow doesn't import deriveGradient — the avatar/badge
  // gradient comes from producerGradient (asserted below) which is the
  // continuous OKLCH system, not the 6-token discrete system. The hero
  // surfaces use deriveGradient because they need the dark-band map;
  // a row badge is small enough that the OKLCH look-up is the right
  // call. Test kept as a sanity assertion that the file does NOT
  // pull in deriveGradient unintentionally.
  it("does not import deriveGradient (badge uses producerGradient only)", () => {
    expect(SRC).not.toContain("deriveGradient");
  });

  it("imports producerInitials from ~/lib/_phase4-stubs/producer-color", () => {
    expect(SRC).toContain("producerInitials");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("imports producerGradient for the badge gradient (avatar system)", () => {
    expect(SRC).toContain("producerGradient");
  });

  it("links to /dashboard/clients-projects/<id> as the row target", () => {
    expect(SRC).toContain("/dashboard/clients-projects/");
  });

  it("uses Link from next/link for the row's anchor", () => {
    expect(SRC).toContain('from "next/link"');
  });

  it("supports all four status pill tones (danger / warn / ok / neutral)", () => {
    expect(SRC).toContain("pill-danger");
    expect(SRC).toContain("pill-warn");
    expect(SRC).toContain("pill-ok");
    expect(SRC).toContain("pill-neutral");
  });

  it("exposes onDragStart / onDragOver / onDrop via props for the parent reorder controller", () => {
    expect(SRC).toContain("onDragStart");
    expect(SRC).toContain("onDragOver");
    expect(SRC).toContain("onDrop");
  });

  it("renders the row with data-id={id} so the parent can identify dropped rows", () => {
    expect(SRC).toMatch(/data-id=\{[^}]*id[^}]*\}/);
  });

  it("uses the bg-elevated token for the row background", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("uses the border-subtle token", () => {
    expect(SRC).toContain("--border-subtle");
  });

  it("uses fg-muted for the meta line", () => {
    expect(SRC).toContain("--fg-muted");
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("declares a ProjectRowData type with id + title + client + progress + balance + deadline + status", () => {
    expect(SRC).toContain("ProjectRowData");
    expect(SRC).toContain("id");
    expect(SRC).toContain("title");
    expect(SRC).toContain("progress");
    expect(SRC).toContain("balance");
    expect(SRC).toContain("deadline");
    expect(SRC).toContain("status");
  });
});

describe("ProjectRow G5 — status pill + plain chevron", () => {
  it("renders the status label as a visible pill (not just aria-label)", () => {
    // The pill rendering must reference `status` directly in JSX text
    expect(SRC).toMatch(/>\s*\{status\}\s*</);
  });

  it("uses a plain ChevronRight in the 8th column with no pill styling", () => {
    // The LAST ChevronRight in the file is the 8th column.
    // Everything after it (through end of file) must NOT contain pill classes or tone style.
    const lastChevronIdx = SRC.lastIndexOf("ChevronRight");
    expect(lastChevronIdx).toBeGreaterThan(-1);
    const tail = SRC.slice(lastChevronIdx);
    expect(tail).not.toMatch(/pill-(danger|warn|ok|neutral)/);
    expect(tail).not.toMatch(/style=\{tone\}/);
  });

  it("no longer accepts a 'tag' field on ProjectRowData", () => {
    expect(SRC).not.toMatch(/\btag\?:/);
  });
});

describe("ProjectRow PR-A polish — G7..G10 design alignment", () => {
  it("G7: declares clientEmail (not generic meta) and renders it under the client name", () => {
    // Email was previously passed as `meta` and rendered under the
    // title — design puts it as a muted sub-line under the client
    // name in the dedicated client column. The type rename locks the
    // contract; the JSX placement check below ensures the email lives
    // in the cli column (next to `client`).
    expect(SRC).toMatch(/clientEmail\?:/);
    expect(SRC).not.toMatch(/\bmeta\?:/);
    // The clientEmail render must come AFTER the client name span so
    // it stacks visually as name → email muted sub-line. We anchor on
    // {client} and require {clientEmail} after it within ~400 chars.
    const clientIdx = SRC.indexOf("{client}");
    const emailIdx = SRC.indexOf("{clientEmail}");
    expect(clientIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeGreaterThan(clientIdx);
    expect(emailIdx - clientIdx).toBeLessThan(400);
  });

  it("G8: drag handle is permanently visible (opacity-60), not opacity-0", () => {
    // Producers must see at-a-glance that rows are reorderable. The
    // handle brightens on hover but never hides.
    expect(SRC).toMatch(/cursor-grab[\s\S]*?opacity-60/);
    expect(SRC).not.toMatch(/cursor-grab[\s\S]*?opacity-0\b/);
  });

  it("G9: renders a 3px left accent bar for danger/warn rows", () => {
    expect(SRC).toMatch(/accentBarColor/);
    expect(SRC).toMatch(/w-\[3px\]/);
    expect(SRC).toMatch(/fg-danger[\s\S]*?fg-warning|fg-warning[\s\S]*?fg-danger/);
  });

  it("G10: status pill uses 6px radius + 9.5px uppercase tracking (not rounded-full)", () => {
    // Design HTML 131–135 — solid tinted pill, not a rounded chip.
    expect(SRC).toMatch(/rounded-\[6px\]/);
    expect(SRC).toMatch(/text-\[9\.5px\]/);
    expect(SRC).toMatch(/tracking-\[0\.1em\]/);
  });
});
