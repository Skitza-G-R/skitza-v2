import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SURFACES = [
  ["Clients/Projects", "../../dashboard/clients-projects/workspace-list-view.tsx"],
  ["Project Songs/Studio Log", "../../dashboard/project/album-space.tsx"],
  ["Song Overview/Versions/Sessions", "../../dashboard/song/song-space.tsx"],
  [
    "Calendar Sessions/Availability",
    "../../../app/(producer)/dashboard/calendar/calendar-swipe-surface.tsx",
  ],
  ["Settings sections", "../../../app/(producer)/dashboard/settings/settings-client.tsx"],
] as const;

describe("inner-tab swipe surfaces", () => {
  it.each(SURFACES)("%s keeps layout on the surface and motion on a child panel", (_name, path) => {
    const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

    expect(source).toContain("data-tab-swipe-surface");
    expect(source).toContain("data-tab-swipe-panel");
    expect(source).toMatch(
      /data-tab-swipe-surface[\s\S]*?\{\.\.\.(?:modeSwipeHandlers|tabSwipeHandlers|swipeHandlers)\}[\s\S]*?data-tab-swipe-panel/,
    );
  });

  it("keeps the Song-first Library out of a Projects/Songs swipe mode", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../music/library-screen.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("data-tab-swipe-surface");
    expect(source).not.toContain("useTabSwipe");
    expect(source).toContain('aria-label="Filter by project"');
  });

  it("keeps Calendar's server navigation immediate and scroll-stable", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../../app/(producer)/dashboard/calendar/calendar-swipe-surface.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(source).toContain("router.push(`/dashboard/calendar?tab=${next}`");
    expect(source).toContain("{ scroll: false }");
    expect(source).not.toContain("setTimeout(() => router.push");

    const pageSource = readFileSync(
      fileURLToPath(
        new URL("../../../app/(producer)/dashboard/calendar/page.tsx", import.meta.url),
      ),
      "utf8",
    );
    expect(pageSource).toMatch(/<CalendarSwipeSurface\s+active=\{active\}/);
    expect(pageSource).not.toContain("<CalendarSwipeSurface key={active}");
  });
});
