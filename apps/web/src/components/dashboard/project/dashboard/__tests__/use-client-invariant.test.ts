// Pinning test for the "use client" / handler invariant.
//
// Discovered via prod incident 2026-04-26: header-strip.tsx had an
// `onClick={() => {}}` stub but no "use client" directive. Server
// components can't pass event handlers to *any* element (including
// HTML primitives) — the function isn't serializable across the
// server/client boundary, and the rendered HTML carries no listener.
// Result: "Error: Event handlers cannot be passed to Client Component
// props" → page falls into the global error boundary ("Something
// buzzed.").
//
// This test reads each Dashboard module file as a string and asserts:
//   if the file uses any `onSomething={(...)` inline handler, the file
//   MUST start with "use client";
//
// We assert on source-text rather than via render() because the repo
// runs vitest in `node` env without jsdom — same convention as the
// project-sub-tab-shared.ts pinning test.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DASHBOARD_DIR = join(
  process.cwd(),
  "src/components/dashboard/project/dashboard",
);

const SUB_TABS_DIR = join(
  process.cwd(),
  "src/components/dashboard/project/sub-tabs",
);

function listTsxFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.startsWith("__"));
}

function firstNonEmptyLine(source: string): string {
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

function hasInlineHandler(source: string): boolean {
  // Catches `onClick={(`, `onChange={async (`, `onSubmit={function`, etc.
  return /\son[A-Z][a-zA-Z]*=\{(\(|async \(|function)/.test(source);
}

describe("Dashboard sub-tab `use client` invariant", () => {
  for (const file of listTsxFiles(DASHBOARD_DIR)) {
    const path = join(DASHBOARD_DIR, file);
    const source = readFileSync(path, "utf8");
    if (!hasInlineHandler(source)) continue;
    it(`${file} declares "use client" because it defines an inline event handler`, () => {
      expect(firstNonEmptyLine(source)).toBe('"use client";');
    });
  }
});

describe("Sub-tabs `use client` invariant", () => {
  for (const file of listTsxFiles(SUB_TABS_DIR)) {
    const path = join(SUB_TABS_DIR, file);
    const source = readFileSync(path, "utf8");
    if (!hasInlineHandler(source)) continue;
    it(`${file} declares "use client" because it defines an inline event handler`, () => {
      expect(firstNonEmptyLine(source)).toBe('"use client";');
    });
  }
});
