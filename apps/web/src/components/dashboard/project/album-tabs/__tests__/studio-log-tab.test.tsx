import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "studio-log-tab.tsx"), "utf-8");

describe("StudioLogTab — insights + activity timeline + sessions", () => {
  it("exports a StudioLogTab component (function)", () => {
    expect(SRC).toMatch(/export function StudioLogTab/);
  });

  it("sets role=tabpanel on the wrapping section", () => {
    expect(SRC).toContain('role="tabpanel"');
  });

  it("renders the 4 insight tile labels: Sessions logged / Studio hours / This month / Last session", () => {
    expect(SRC).toContain("Sessions logged");
    expect(SRC).toContain("Studio hours");
    expect(SRC).toContain("This month");
    expect(SRC).toContain("Last session");
  });

  it("uses StatTile for each insight tile", () => {
    expect(SRC).toContain("StatTile");
    expect(SRC).toContain("~/components/dashboard/common/stat-tile");
  });

  it("renders an Activity section header above the timeline", () => {
    expect(SRC).toMatch(/Activity/);
  });

  it("renders a Sessions section header above the sessions list", () => {
    expect(SRC).toMatch(/Sessions/);
  });

  it("renders an empty state when activities array is empty", () => {
    expect(SRC).toMatch(/No activity/);
  });

  it("renders an empty state when sessions array is empty", () => {
    expect(SRC).toMatch(/No sessions/);
  });

  it("accepts sessionsCount + studioHours + thisMonthCount + lastSessionDate insight props", () => {
    expect(SRC).toContain("sessionsCount");
    expect(SRC).toContain("studioHours");
    expect(SRC).toContain("thisMonthCount");
    expect(SRC).toContain("lastSessionDate");
  });

  it("accepts activities + sessions list props", () => {
    expect(SRC).toContain("activities");
    expect(SRC).toContain("sessions");
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
