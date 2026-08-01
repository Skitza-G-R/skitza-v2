import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { StudioLogTab, sortStudioLogEntries, type StudioLogEntry } from "../studio-log-tab";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "studio-log-tab.tsx"), "utf-8");

const ENTRIES: StudioLogEntry[] = [
  {
    id: "created",
    kind: "created",
    ts: new Date("2026-07-01T09:00:00.000Z"),
    description: "Project created",
  },
  {
    id: "session",
    kind: "session",
    ts: new Date("2026-07-03T09:00:00.000Z"),
    durationMinutes: 90,
    attendees: ["Maya"],
    status: "cancelled",
  },
  {
    id: "version",
    kind: "version",
    ts: new Date("2026-07-02T09:00:00.000Z"),
    description: "New version uploaded — V2",
  },
];

describe("StudioLogTab — one newest-first project timeline", () => {
  it("exports a StudioLogTab component (function)", () => {
    expect(SRC).toMatch(/export function StudioLogTab/);
  });

  it("sets role=tabpanel on the wrapping section", () => {
    expect(SRC).toContain('role="tabpanel"');
  });

  it("sorts mixed sessions and activity deterministically, newest first", () => {
    expect(sortStudioLogEntries(ENTRIES).map((entry) => entry.id)).toEqual([
      "session",
      "version",
      "created",
    ]);
  });

  it("renders one timeline with session status, duration, and attendee", () => {
    const html = renderToStaticMarkup(<StudioLogTab entries={ENTRIES} />);
    expect(html.indexOf("Studio session")).toBeLessThan(html.indexOf("New version uploaded"));
    expect(html.indexOf("New version uploaded")).toBeLessThan(html.indexOf("Project created"));
    expect(html).toContain("Canceled");
    expect(html).toContain("1h 30m");
    expect(html).toContain("Maya");
  });

  it("uses one compact empty state and removes the old stat/separate-list layout", () => {
    const html = renderToStaticMarkup(<StudioLogTab entries={[]} />);
    expect(html).toContain("No studio activity yet");
    expect(SRC).not.toContain("StatTile");
    expect(SRC).not.toContain("sessionsCount");
    expect(SRC).not.toContain("studioHours");
  });

  it("does not expose the stopped Add Session action or payment events", () => {
    expect(SRC).not.toContain("Add Session");
    expect(SRC).not.toContain("/artist/book");
    expect(SRC).not.toContain("PaymentHistory");
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
