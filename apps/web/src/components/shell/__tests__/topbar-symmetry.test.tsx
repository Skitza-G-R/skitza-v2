import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Safety-net symmetry tests for the producer + artist top bar
// wrappers (SK-31). Pins that both wrappers stay structurally the
// same — both delegate to the shared `AppTopBar`, pass the shared
// navigation contract, and keep their own section maps. Working actions
// remain intentionally role-specific.
//
// What we deliberately do NOT pin:
//   - The literal contents of each section map. Producer and artist
//     have different routes — divergence there is by design.
//   - The exact search placeholder text. Producer/artist copy is
//     audience-specific (see Gili's SK-31 Q1 answer).
//   - The presence/absence of `onSearchClick`. Producer wires it
//     today; artist intentionally does not until the artist palette
//     ships. Both roles do wire their real notification controls.
//     The symmetry we want is in structure, not in identical code.

const here = dirname(fileURLToPath(import.meta.url));
const PRODUCER = readFileSync(join(here, "..", "dashboard-topbar.tsx"), "utf-8");
const ARTIST = readFileSync(join(here, "..", "artist-topbar.tsx"), "utf-8");

const wrappers: { name: string; src: string }[] = [
  { name: "dashboard-topbar (producer)", src: PRODUCER },
  { name: "artist-topbar (artist)", src: ARTIST },
];

describe.each(wrappers)("$name stays on the shared AppTopBar contract", ({ src }) => {
  it("imports the shared AppTopBar", () => {
    expect(src).toMatch(/from\s+["']\.\/app-topbar["']/);
  });

  it("renders <AppTopBar /> (no parallel hand-rolled topbar)", () => {
    expect(src).toMatch(/<AppTopBar/);
  });

  it("passes a sections map", () => {
    expect(src).toMatch(/sections=\{[A-Z_]+_SECTIONS\}/);
  });

  it("passes an explicit chrome variant", () => {
    expect(src).toMatch(/variant=["'](?:producer|artist)["']/);
  });

  it("passes a fallback section", () => {
    expect(src).toMatch(/fallback=\{[A-Z_]+_FALLBACK\}/);
  });

  it("passes the search placeholder", () => {
    expect(src).toMatch(/searchPlaceholder=/);
  });

  it("defines its own *_SECTIONS const at the top of the file", () => {
    expect(src).toMatch(/const\s+[A-Z_]+_SECTIONS\s*=\s*\{/);
  });

  it("defines its own *_FALLBACK constant", () => {
    expect(src).toMatch(/const\s+[A-Z_]+_FALLBACK\s*=\s*\{/);
  });

  it("is a client component (needed for the AppTopBar's hooks)", () => {
    expect(src).toMatch(/^"use client";/);
  });

  it("uses no forbidden Skitza CSS tokens (regression guard)", () => {
    expect(src).not.toContain("--surface-card");
    expect(src).not.toContain("--surface-hover");
    expect(src).not.toContain("--text-muted");
    expect(src).not.toContain("--text-strong");
    expect(src).not.toContain("--brand-primary-on");
  });
});

describe("producer + artist wrappers share the same core prop shape", () => {
  function extractAppTopBarProps(src: string): Set<string> {
    const start = src.indexOf("<AppTopBar");
    expect(start).toBeGreaterThan(-1);
    // Self-closing in both wrappers (`<AppTopBar ... />`).
    const end = src.indexOf("/>", start);
    expect(end).toBeGreaterThan(start);
    const opening = src.slice(start, end);
    const props = new Set<string>();
    const matches = [
      ...opening.matchAll(/^(\s+)([a-zA-Z_][a-zA-Z0-9_]*)=/gm),
    ];
    const propIndent = Math.min(...matches.map((match) => match[1]?.length ?? Infinity));
    for (const match of matches) {
      if (match[1]?.length !== propIndent) continue;
      const name = match[2];
      // `matchAll` types capture groups as `string | undefined`. The
      // regex always captures at least one char, so a defined value
      // is guaranteed — the guard is here to satisfy strict TS, not
      // because undefined is reachable. Ignore the tag name itself.
      if (name && name !== "AppTopBar") props.add(name);
    }
    return props;
  }

  it("both wrappers pass the shared navigation props while only producer passes working actions", () => {
    const producerProps = extractAppTopBarProps(PRODUCER);
    const artistProps = extractAppTopBarProps(ARTIST);
    const coreProps = ["variant", "sections", "fallback", "searchPlaceholder"];

    expect(artistProps).toEqual(new Set([...coreProps, "notificationControl"]));
    expect(producerProps).toEqual(new Set([...coreProps, "onSearchClick", "notificationControl"]));
  });
});
