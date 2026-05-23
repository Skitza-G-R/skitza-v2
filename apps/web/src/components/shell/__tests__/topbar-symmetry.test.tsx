import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Safety-net symmetry tests for the producer + artist top bar
// wrappers (SK-31). Pins that both wrappers stay structurally the
// same — i.e. both delegate to the shared `AppTopBar`, both pass the
// same set of props, both keep their own section maps. If a future
// PR takes one side off the shared component or adds a feature to
// only one side, this file fails the build before merge.
//
// What we deliberately do NOT pin:
//   - The literal contents of each section map. Producer and artist
//     have different routes — divergence there is by design.
//   - The exact search placeholder text. Producer/artist copy is
//     audience-specific (see Gili's SK-31 Q1 answer).
//   - The presence/absence of `onSearchClick`. Producer wires it
//     today; artist intentionally does not until the artist palette
//     ships. The symmetry we want is in structure, not in identical
//     code.

const here = dirname(fileURLToPath(import.meta.url));
const PRODUCER = readFileSync(
  join(here, "..", "dashboard-topbar.tsx"),
  "utf-8",
);
const ARTIST = readFileSync(join(here, "..", "artist-topbar.tsx"), "utf-8");

const wrappers: { name: string; src: string }[] = [
  { name: "dashboard-topbar (producer)", src: PRODUCER },
  { name: "artist-topbar (artist)", src: ARTIST },
];

describe.each(wrappers)(
  "$name stays on the shared AppTopBar contract",
  ({ src }) => {
    it("imports the shared AppTopBar", () => {
      expect(src).toMatch(/from\s+["']\.\/app-topbar["']/);
    });

    it("renders <AppTopBar /> (no parallel hand-rolled topbar)", () => {
      expect(src).toMatch(/<AppTopBar/);
    });

    it("passes a sections map", () => {
      expect(src).toMatch(/sections=\{[A-Z_]+_SECTIONS\}/);
    });

    it("passes a fallback section", () => {
      expect(src).toMatch(/fallback=\{[A-Z_]+_FALLBACK\}/);
    });

    it("passes the search placeholder", () => {
      expect(src).toMatch(/searchPlaceholder=/);
    });

    it("threads unreadCount through to the shared bar", () => {
      expect(src).toMatch(/unreadCount=\{unreadCount\}/);
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
  },
);

describe("producer + artist wrappers share the same prop shape", () => {
  // Final hard pin: the set of props each side hands to <AppTopBar>
  // must be the same set. We extract every `propName=` token inside
  // each wrapper's `<AppTopBar ...>` block and assert the two sets
  // are equal (ignoring `onSearchClick`, the one intentional
  // asymmetry for SK-31). New prop added to one side without the
  // other → the sets diverge → the test fails.
  function extractAppTopBarProps(src: string): Set<string> {
    const start = src.indexOf("<AppTopBar");
    expect(start).toBeGreaterThan(-1);
    // Self-closing in both wrappers (`<AppTopBar ... />`).
    const end = src.indexOf("/>", start);
    expect(end).toBeGreaterThan(start);
    const opening = src.slice(start, end);
    const props = new Set<string>();
    for (const match of opening.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)=/g)) {
      const name = match[1];
      // `matchAll` types capture groups as `string | undefined`. The
      // regex always captures at least one char, so a defined value
      // is guaranteed — the guard is here to satisfy strict TS, not
      // because undefined is reachable. Ignore the tag name itself.
      if (name && name !== "AppTopBar") props.add(name);
    }
    return props;
  }

  it("the producer + artist wrappers pass an equivalent set of props (modulo onSearchClick)", () => {
    const producerProps = extractAppTopBarProps(PRODUCER);
    const artistProps = extractAppTopBarProps(ARTIST);

    // `onSearchClick` is the one intentional asymmetry (artist
    // palette ships later). Everything else must match. If/when the
    // artist gets its own palette and adds `onSearchClick=`, the
    // two sets will be equal — that day this test passes without
    // modification.
    const normalize = (s: Set<string>) => {
      const copy = new Set(s);
      copy.delete("onSearchClick");
      return [...copy].sort();
    };

    expect(normalize(artistProps)).toEqual(normalize(producerProps));
  });
});
