import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Architectural invariants for the persistent dashboard shell.
//
// Background: until 2026-04-25 every page under /dashboard/* wrapped
// its own copy of <AppShell>. That made navigation between sibling
// dashboard routes visibly remount the entire shell — Sidebar,
// PersistentPlayer, NotificationBell, CoachmarkTour, MobileBottomNav,
// CommandPaletteTrigger — because each page's <AppShell> is a fresh
// instance. Next.js App Router preserves layout instances across
// sibling-route navigation but unmounts page components, so the fix
// is to host the shell in a shared (app)/dashboard/layout.tsx.
//
// These tests pin two invariants:
//   1. dashboard/layout.tsx exists and includes <AppShell>.
//   2. No file under dashboard/**/page.tsx imports AppShell.
//
// If either invariant is violated in a future refactor, the shell
// will silently regress to remounting on navigation. Pinning the rule
// in source-level assertions (rather than runtime DOM checks) means
// the regression trips at the ESLint-fast `vitest run` stage rather
// than only being visible by manual smoke test.
//
// Pattern matches project-sub-tab-shared.test.ts:55 — Skitza's
// canonical "structural rule pinned via file-source read" idiom.

// `fileURLToPath` (not `.pathname`) is required because the
// repository sits at "Skitza 16.4" — that space encodes as `%20` in
// a URL but readdirSync needs an unencoded filesystem path. Same
// hazard would bite any path containing `()`, spaces, or unicode.
const DASHBOARD_DIR = fileURLToPath(new URL("..", import.meta.url));

function findAllPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("__")) continue; // skip __tests__
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findAllPageFiles(full));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

describe("dashboard/layout.tsx — persistent shell host", () => {
  it("exists at apps/web/src/app/(app)/dashboard/layout.tsx", () => {
    const layoutPath = join(DASHBOARD_DIR, "layout.tsx");
    expect(existsSync(layoutPath)).toBe(true);
  });

  it("renders <AppShell> as the sole shell host", () => {
    const layoutPath = join(DASHBOARD_DIR, "layout.tsx");
    const src = readFileSync(layoutPath, "utf8");
    // The layout must import + render AppShell. We pin the import
    // string AND the JSX usage so a partial regression (importing
    // but forgetting to render) still trips the test.
    expect(src).toMatch(/from ["']~\/components\/shell\/app-shell["']/);
    expect(src).toMatch(/<AppShell[\s>]/);
  });
});

describe("dashboard pages — no per-page AppShell wrappers", () => {
  const pageFiles = findAllPageFiles(DASHBOARD_DIR);

  it("finds at least 4 dashboard page files (sanity check on the walker)", () => {
    // Today / music / projects / settings is the bare minimum set —
    // if the walker returns fewer than 4, the test infra is broken
    // before any invariant check runs.
    expect(pageFiles.length).toBeGreaterThanOrEqual(4);
  });

  it.each(pageFiles)("%s does not import AppShell", (file) => {
    const src = readFileSync(file, "utf8");
    // Pin both the import and the JSX usage. A page that imports the
    // type for prop-typing only would be a false-positive on the
    // import alone, but in this codebase AppShell is only imported
    // for JSX rendering — so a single-rule check is sufficient.
    expect(src).not.toMatch(/from ["']~\/components\/shell\/app-shell["']/);
    expect(src).not.toMatch(/<AppShell[\s>]/);
  });
});
