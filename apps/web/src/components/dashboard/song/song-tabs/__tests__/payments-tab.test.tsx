import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "payments-tab.tsx"), "utf-8");

describe("song payments-tab — reuses the album PaymentsTab", () => {
  it("exports a PaymentsTab component (function)", () => {
    expect(SRC).toMatch(/export function PaymentsTab/);
  });

  it("imports the album PaymentsTab implementation", () => {
    expect(SRC).toContain(
      "~/components/dashboard/project/album-tabs/payments-tab",
    );
  });

  it("re-exports the album PaymentMilestone type for parity", () => {
    expect(SRC).toMatch(/export\s*type\s*\{[^}]*PaymentMilestone[^}]*\}|export\s+type\s+PaymentMilestone\b/);
  });

  it("renders the album PaymentsTab (delegates render)", () => {
    expect(SRC).toMatch(/<AlbumPaymentsTab|AlbumPaymentsTab\(/);
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
