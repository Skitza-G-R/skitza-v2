import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TrackRow } from "../track-row";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "track-row.tsx"), "utf-8");

describe("TrackRow — album-page tracklist row", () => {
  it("exports a TrackRow component (function)", () => {
    expect(SRC).toMatch(/export function TrackRow/);
  });

  it("uses one compact responsive row without the old fixed six-column grid", () => {
    expect(SRC).toContain("min-h-[68px]");
    expect(SRC).toContain("sm:min-h-[92px]");
    expect(SRC).not.toContain("30px 38px minmax(0,1fr) 130px 180px 22px");
  });

  it("keeps the phone artwork compact and gives the desktop row a 52px artwork tile", () => {
    expect(SRC).toContain("h-11 w-11");
    expect(SRC).toContain("sm:h-[52px] sm:w-[52px]");
  });

  it("wraps the song details in a Next.js Link", () => {
    expect(SRC).toContain('from "next/link"');
  });

  it("defaults protected Song Pages to click-only loading while allowing explicit non-song prefetch", () => {
    expect(SRC).toContain("prefetch={track.detailPrefetch ?? false}");
    expect(SRC).not.toContain("prefetch={true}");
  });

  it("uses the server-provided player or upload destination without a nested Song Space", () => {
    expect(SRC).toContain("detailHref");
    expect(SRC).not.toContain("projectSongWorkspaceHref");
    expect(SRC).not.toContain("?song=");
    expect(SRC).not.toMatch(/\/songs\/\$\{[^}]*track\.id/);
  });

  it("does not advertise drag/reorder before persistence exists", () => {
    expect(SRC).not.toMatch(/\bdraggable=/);
    expect(SRC).not.toContain("GripVertical");
  });

  it("uses one semantic row Link with a separate sibling Play control", () => {
    expect(SRC).toMatch(/<Link\s+[\s\S]*?className="[^"]*min-h-\[68px\][^"]*"/);
    expect(SRC).toMatch(/<\/Link>[\s\S]*?<button/);
    expect(SRC).not.toContain('className="absolute inset-0 z-0');
  });

  it("renders song details in the Link while keeping Play outside it", () => {
    const html = renderToStaticMarkup(
      <TrackRow
        index={1}
        track={{
          id: "song-1",
          title: "Whole row song",
          artist: "Artist",
          workflowStage: "mixing",
          progress: 64,
          currentVersion: "v2",
          detailHref: "/dashboard/music/version-2?from=project-1",
        }}
      />,
    );

    const linkStart = html.indexOf("<a ");
    const linkEnd = html.indexOf("</a>", linkStart);
    const linkHtml = html.slice(linkStart, linkEnd);
    expect(linkStart).toBeGreaterThanOrEqual(0);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(linkHtml).not.toContain("aria-current");
    expect(linkHtml).toContain("Whole row song");
    expect(linkHtml).toContain("Mixing");
    expect(linkHtml).toContain("64% complete");
    expect(html.indexOf("<button", linkEnd)).toBeGreaterThan(linkEnd);
    expect(html).not.toContain("pointer-events-none");
  });

  it("accepts and displays an optional artist credit in the track metadata", () => {
    expect(SRC).toMatch(/artist:\s*string\s*\|\s*null/);
    expect(SRC).toContain("if (track.artist) metaParts.push(track.artist)");
    expect(SRC).not.toContain("SongActionsMenu");
  });

  it("imports producerGradient for the cover tile", () => {
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("imports stageColor + stageLabel from the workflow-stage helper", () => {
    expect(SRC).toContain("stageColor");
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
  });

  it("imports ChevronRight for the row chevron", () => {
    expect(SRC).toContain("ChevronRight");
    expect(SRC).toContain('from "lucide-react"');
  });

  it("uses tabular-nums for the index column (mono-style 01/02 numbers)", () => {
    expect(SRC).toMatch(/tabular-nums|font-mono/);
  });

  it("formats the index as a zero-padded 2-digit string (01, 02…)", () => {
    expect(SRC).toMatch(/padStart\(\s*2\s*,\s*['"]0['"]\s*\)/);
  });

  it("renders the stage pill with a colored dot using the stage color", () => {
    // The pill border + dot share the same stageColor value
    expect(SRC).toMatch(/stageColor\(/);
  });

  it("renders a progress bar with the brand-primary amber fill", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("renders the percentage label with tabular-nums for alignment", () => {
    expect(SRC).toMatch(/tabular-nums/);
  });

  it("the chevron is plain (no surrounding pill wrapper) and uses fg-muted color", () => {
    // The chevron sits in the trailing 22px column — no rounded pill or
    // border around it. We assert by ruling out a wrapping rounded-full
    // class adjacent to the ChevronRight import.
    expect(SRC).not.toMatch(/rounded-full[^<]*ChevronRight/);
  });

  it("does not expose drag callbacks until a persistence owner exists", () => {
    expect(SRC).not.toContain("onDragStart");
    expect(SRC).not.toContain("onDragOver");
    expect(SRC).not.toContain("onDrop");
  });

  it("renders the meta line: currentVersion · noteCount notes · duration when present", () => {
    expect(SRC).toContain("currentVersion");
    expect(SRC).toContain("noteCount");
    expect(SRC).toContain("durationMs");
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
