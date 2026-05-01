import { describe, expect, it } from "vitest";

import {
  rankPaletteItems,
  type PaletteCandidate,
  type PaletteItem,
} from "../palette-ranking";

const tabs: PaletteCandidate[] = [
  { kind: "tab", id: "overview", label: "Overview", icon: "home", hint: "Go to · g h" },
  { kind: "tab", id: "music", label: "Music Library", icon: "music", hint: "Go to · g m" },
  { kind: "tab", id: "calendar", label: "Calendar", icon: "calendar", hint: "Go to · g c" },
];

const projects: PaletteCandidate[] = [
  { kind: "project", id: "p1", label: "Lo Laanot", sub: "Shshana", icon: "folder" },
  { kind: "project", id: "p2", label: "Least Oti", sub: "Lior t", icon: "folder" },
];

const tracks: PaletteCandidate[] = [
  { kind: "track", id: "t1", label: "lenasot", sub: "Lior t · 120 BPM", icon: "music" },
  { kind: "track", id: "t2", label: "sd", sub: "Shshana · 90 BPM", icon: "music" },
];

const clients: PaletteCandidate[] = [
  { kind: "client", id: "c1", label: "Lior t", sub: "1 project", icon: "user" },
];

describe("rankPaletteItems", () => {
  it("returns recent + tabs (in 'Jump to' section) when query is empty", () => {
    const items = rankPaletteItems({
      query: "",
      candidates: [...tabs, ...projects, ...tracks, ...clients],
      recents: [],
    });
    // No recents → only tabs in 'Jump to' section
    const sections = items
      .filter((i) => i._section)
      .map((i) => i._section);
    expect(sections).toContain("Jump to");
    expect(items.every((i) => i.kind === "tab")).toBe(true);
  });

  it("shows recents first when query is empty and recents exist", () => {
    const items = rankPaletteItems({
      query: "",
      candidates: [...tabs, ...projects, ...tracks],
      recents: [{ kind: "project", id: "p1" }],
    });
    expect(items[0]?.kind).toBe("project");
    expect(items[0]?.id).toBe("p1");
    expect(items[0]?._section).toBe("Recent");
  });

  it("filters by case-insensitive substring match on label or sub", () => {
    const items = rankPaletteItems({
      query: "shsh",
      candidates: [...tabs, ...projects, ...tracks, ...clients],
      recents: [],
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("p1"); // Lo Laanot has sub "Shshana"
    expect(ids).toContain("t2"); // sd has sub "Shshana"
    expect(ids).not.toContain("p2");
  });

  it("ranks label-prefix matches before mid-string matches", () => {
    const cands: PaletteCandidate[] = [
      { kind: "track", id: "a", label: "alpha", icon: "music" },
      { kind: "track", id: "b", label: "balpha", icon: "music" }, // mid-match
    ];
    const items = rankPaletteItems({
      query: "alpha",
      candidates: cands,
      recents: [],
    });
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("groups by kind in display order: tab, project, track, client", () => {
    const items = rankPaletteItems({
      query: "li",
      candidates: [...tabs, ...projects, ...tracks, ...clients],
      recents: [],
    });
    const kinds = items.map((i) => i.kind);
    const projectIdx = kinds.indexOf("project");
    const trackIdx = kinds.indexOf("track");
    const clientIdx = kinds.indexOf("client");
    if (projectIdx !== -1 && trackIdx !== -1) {
      expect(projectIdx).toBeLessThan(trackIdx);
    }
    if (trackIdx !== -1 && clientIdx !== -1) {
      expect(trackIdx).toBeLessThan(clientIdx);
    }
  });

  it("attaches _section header only to the first item of each kind", () => {
    const items = rankPaletteItems({
      query: "li",
      candidates: [...projects, ...tracks, ...clients],
      recents: [],
    });
    const projectItems = items.filter((i) => i.kind === "project");
    if (projectItems.length > 1) {
      expect(projectItems[0]?._section).toBeTruthy();
      expect(projectItems[1]?._section).toBeUndefined();
    }
  });

  it("returns empty array when no candidate matches", () => {
    const items = rankPaletteItems({
      query: "zzznotfound",
      candidates: [...projects, ...tracks],
      recents: [],
    });
    expect(items).toEqual([]);
  });

  it("caps ranked results to 24 items", () => {
    const many: PaletteCandidate[] = Array.from({ length: 50 }, (_, i) => ({
      kind: "track",
      id: `t${String(i)}`,
      label: `track-${String(i)}`,
      icon: "music",
    }));
    const items = rankPaletteItems({
      query: "track",
      candidates: many,
      recents: [],
    });
    expect(items.length).toBeLessThanOrEqual(24);
  });

  it("preserves item id, label, icon, kind in returned PaletteItem", () => {
    const items: PaletteItem[] = rankPaletteItems({
      query: "music",
      candidates: tabs,
      recents: [],
    });
    const musicItem = items.find((i) => i.id === "music");
    expect(musicItem?.label).toBe("Music Library");
    expect(musicItem?.icon).toBe("music");
    expect(musicItem?.kind).toBe("tab");
  });
});
