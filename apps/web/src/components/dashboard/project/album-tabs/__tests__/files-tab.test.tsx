import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "files-tab.tsx"), "utf-8");

describe("FilesTab — thin wrapper over the existing FilesSubTab", () => {
  it("exports a FilesTab component (function)", () => {
    expect(SRC).toMatch(/export function FilesTab/);
  });

  it("imports FilesSubTab from the existing sub-tabs module", () => {
    expect(SRC).toContain("FilesSubTab");
    expect(SRC).toContain(
      "~/components/dashboard/project/sub-tabs/files-sub-tab",
    );
  });

  it("renders <FilesSubTab projectId={projectId} /> directly", () => {
    expect(SRC).toMatch(/<FilesSubTab\s+projectId=\{[^}]*projectId[^}]*\}\s*\/>/);
  });

  it("accepts a projectId prop string", () => {
    expect(SRC).toMatch(/projectId:\s*string/);
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
