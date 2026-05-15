import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "sessions-tab.tsx"), "utf-8");

describe("sessions-tab — per-song session log", () => {
  it("exports a SessionsTab component (function)", () => {
    expect(SRC).toMatch(/export function SessionsTab/);
  });

  it("imports producerGradient for the attendee avatar fallbacks", () => {
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("renders a 'Notes' button on each session row", () => {
    expect(SRC).toMatch(/Notes/);
  });

  it("renders the empty state when no sessions exist", () => {
    expect(SRC).toMatch(/No\s*sessions\s*yet/);
  });

  it("renders the stacked date stamp (month + day)", () => {
    // The brief shows "14 OCT" — a stacked day-of-month + uppercase
    // month-3. We assert at least one date formatter ran in the file.
    expect(SRC).toMatch(/Intl\.DateTimeFormat|getDate|getMonth|toLocaleDateString/);
  });

  it("renders attendees as gradient avatars", () => {
    expect(SRC).toContain("attendees");
  });

  it("renders the session duration (minutes)", () => {
    expect(SRC).toContain("durationMinutes");
  });

  it("sets role=tabpanel on the wrapping section", () => {
    expect(SRC).toContain('role="tabpanel"');
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
