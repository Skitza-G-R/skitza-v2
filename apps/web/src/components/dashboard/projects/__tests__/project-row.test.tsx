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

  it("imports deriveGradient from ~/lib/clients/derive-gradient", () => {
    expect(SRC).toContain("deriveGradient");
    expect(SRC).toContain("~/lib/clients/derive-gradient");
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
