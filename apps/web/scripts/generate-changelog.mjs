#!/usr/bin/env node
/**
 * Generate the changelog JSON file from git log.
 *
 * Reads commits on main (via `git log`), parses conventional-commit
 * prefixes (feat:, fix:, perf:, refactor:, docs:, etc.), groups by
 * date, and emits a JSON file consumed by the /changelog page at
 *   apps/web/src/app/(public)/changelog/entries.generated.json
 *
 * Only surfaces commits that are user-facing:
 *   - feat:  shown in "New" section
 *   - fix:   shown in "Fixes" section
 *   - perf:  shown in "New" section (performance improvements)
 *
 * Silently skips: chore:, test:, ci:, docs:, refactor:, style:, build:,
 * revert: — these are housekeeping commits that don't need to show in
 * the public changelog.
 *
 * Groups entries by ISO date. Within a date, orders by git order
 * (newest first).
 *
 * Usage:
 *   node apps/web/scripts/generate-changelog.mjs
 *   pnpm -F web changelog:regen
 *
 * The GitHub Action `.github/workflows/changelog-update.yml` calls
 * this script on-demand + opens a PR with the diff.
 *
 * 2026-04-22 — audit Task 8 (overnight Task D).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Output path — repo-root-relative so running from anywhere works.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const OUT_PATH = resolve(
  REPO_ROOT,
  "apps/web/src/app/(public)/changelog/entries.generated.json",
);

// Conventional-commit prefixes that surface in the public changelog.
// Everything else silently skipped.
const SURFACE_PREFIXES = {
  feat: "new",
  perf: "new",
  fix: "fix",
};

// Pull commits via execFileSync — safer than exec because args are
// passed as an array (no shell interpolation) even though this
// particular invocation has no untrusted input. `--no-merges` skips
// merge commits; `--date=short` gives YYYY-MM-DD; `%h|%ad|%s` =
// hash, date, subject delimited by pipes.
// Limit 500 to keep the page snappy and the JSON file small.
function getCommits() {
  try {
    const raw = execFileSync(
      "git",
      [
        "log",
        "main",
        "--no-merges",
        "--date=short",
        "--pretty=format:%h|%ad|%s",
        "-500",
      ],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split("|");
        return { hash, date, subject: rest.join("|") };
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("git log failed:", message);
    process.exit(1);
  }
}

// Parse "feat(scope): subject" or "feat: subject" into { type, scope, title }.
// Returns null if the commit doesn't match a known surfaceable prefix.
function parseSubject(subject) {
  const match = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(subject);
  if (!match) return null;
  const [, type, scope, title] = match;
  const kind = SURFACE_PREFIXES[type];
  if (!kind) return null;
  return {
    kind, // "new" | "fix"
    type, // "feat" | "perf" | "fix"
    scope: scope ?? null,
    title: title.trim(),
  };
}

function main() {
  const commits = getCommits();
  const byDate = new Map();

  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    if (!parsed) continue;
    if (!byDate.has(commit.date)) byDate.set(commit.date, []);
    byDate.get(commit.date).push({
      hash: commit.hash,
      kind: parsed.kind,
      scope: parsed.scope,
      title: parsed.title,
    });
  }

  // Sort dates descending (newest first), entries within a date keep
  // git order (already newest-first in git log output).
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));
  const entries = dates.map((date) => ({
    date,
    items: byDate.get(date),
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "git log main --no-merges -500",
    entries,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const totalItems = entries.reduce(
    (sum, entry) => sum + entry.items.length,
    0,
  );
  console.log(
    `✓ generated ${totalItems} item(s) across ${entries.length} date(s) → ${OUT_PATH}`,
  );
}

main();
