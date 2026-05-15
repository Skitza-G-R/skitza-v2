import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "add-version-drop-zone.tsx"),
  "utf-8",
);

describe("AddVersionDropZone — first row of the Versions tab", () => {
  it("exports an AddVersionDropZone component (function)", () => {
    expect(SRC).toMatch(/export function AddVersionDropZone/);
  });

  it("uses the same VersionRow grid: 36px minmax(0,1fr) 48px 48px 56px 32px", () => {
    expect(SRC).toContain("36px minmax(0,1fr) 48px 48px 56px 32px");
  });

  it("renders the 'Add a new version' headline", () => {
    expect(SRC).toMatch(/Add\s*a\s*new\s*version/);
  });

  it("renders a WAV/MP3 drop hint as the meta line", () => {
    expect(SRC).toMatch(/WAV/);
    expect(SRC).toMatch(/MP3/);
  });

  it("renders a '+' circle icon (Plus from lucide-react)", () => {
    expect(SRC).toContain("Plus");
    expect(SRC).toContain('from "lucide-react"');
  });

  it("uses --brand-primary for the '+' icon color (amber)", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("renders as <button type=\"button\">", () => {
    expect(SRC).toMatch(/<button[^>]*type=["']button["']/);
  });

  it("falls back to disabled when no onClick is wired (Phase 3 stub)", () => {
    // Native disabled attribute + Coming-soon tooltip — same pattern as
    // HeroCTA.
    expect(SRC).toMatch(/disabled/);
    expect(SRC).toContain("Coming soon");
  });

  it("dims the row visually when disabled (opacity / not-allowed cursor)", () => {
    expect(SRC).toMatch(/opacity-70|opacity-50|disabled:opacity/);
    expect(SRC).toMatch(/cursor-not-allowed/);
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
});
