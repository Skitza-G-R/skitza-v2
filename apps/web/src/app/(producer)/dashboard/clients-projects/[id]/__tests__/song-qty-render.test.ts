import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Task 17 — Producer dashboard renders "× N songs" on per-song
// project rows. Three wired changes:
//   1. Migration 0016 adds song_qty + unit_price_cents to projects.
//   2. checkout-initiator persists them on the project insert when
//      passed via args.songQty / args.unitPriceCents.
//   3. The project page surfaces "× N songs" in the hero name when
//      songQty > 1 so the producer can see what the artist booked.
//
// All assertions are source-grep / file-presence based — vitest
// node env has no DOM.

const here = dirname(fileURLToPath(import.meta.url));
// vitest runs from apps/web, so cwd-relative paths reach the rest
// of the monorepo via ../.. (repo root) → packages or apps/web/src.
const WEB_ROOT = process.cwd();
const REPO_ROOT = join(WEB_ROOT, "..", "..");

const PAGE_PATH = join(here, "..", "page.tsx");
const SCHEMA_PATH = join(
  REPO_ROOT,
  "packages",
  "db",
  "src",
  "schema.ts",
);
const INITIATOR_PATH = join(
  WEB_ROOT,
  "src",
  "server",
  "payments",
  "checkout-initiator.ts",
);
const ARTIST_ROUTER_PATH = join(
  WEB_ROOT,
  "src",
  "server",
  "trpc",
  "routers",
  "artist.ts",
);

describe("migration 0016 — projects song_qty + unit_price_cents", () => {
  it("ships the SQL file alongside the existing 0015 booking migration", () => {
    const migrationPath = join(
      REPO_ROOT,
      "packages",
      "db",
      "drizzle",
      "0016_projects_song_qty.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/projects.*ADD COLUMN IF NOT EXISTS.*song_qty/i);
    expect(sql).toMatch(/projects.*ADD COLUMN IF NOT EXISTS.*unit_price_cents/i);
  });

  it("declares songQty + unitPriceCents on the projects schema", () => {
    const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
    // Both columns appear in the projects pgTable definition.
    expect(schemaSrc).toMatch(/songQty:\s*integer\(["']song_qty["']\)/);
    expect(schemaSrc).toMatch(
      /unitPriceCents:\s*integer\(["']unit_price_cents["']\)/,
    );
  });
});

describe("checkout-initiator persists song_qty + unit_price_cents on per-song projects", () => {
  const src = readFileSync(INITIATOR_PATH, "utf8");

  it("accepts optional songQty + unitPriceCents in args", () => {
    expect(src).toMatch(/songQty\?:\s*number/);
    expect(src).toMatch(/unitPriceCents\?:\s*number/);
  });

  it("includes them in the projects insert when provided", () => {
    expect(src).toMatch(/songQty:\s*args\.songQty/);
    expect(src).toMatch(/unitPriceCents:\s*args\.unitPriceCents/);
  });
});

describe("artist.store.checkout mutation forwards songQty + unitPriceCents", () => {
  const src = readFileSync(ARTIST_ROUTER_PATH, "utf8");
  it("passes input.songQty + input.unitPriceCents into initiatePaidPlanCheckout", () => {
    expect(src).toMatch(/songQty:\s*input\.songQty/);
    expect(src).toMatch(/unitPriceCents:\s*input\.unitPriceCents/);
  });
});

describe("project page renders × N songs in the hero when songQty > 1", () => {
  const pageSrc = readFileSync(PAGE_PATH, "utf8");

  it("reads songQty from data.project on the AlbumSpaceProject mapping", () => {
    expect(pageSrc).toMatch(/data\.project\.songQty/);
  });

  it("renders '× N songs' suffix on the project name when songQty > 1", () => {
    expect(pageSrc).toMatch(/×\s*\$\{[^}]*songQty[^}]*\}\s*song/);
  });
});
