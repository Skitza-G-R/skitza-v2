import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

// Pins the invariant that drizzle's `_journal.json` lists every `*.sql`
// file in `drizzle/`. We've shipped two production crashes where a SQL
// file existed but the journal didn't reference it (CLAUDE.md mistake
// log entries 2026-04-20 and 2026-05-06). The file-based runner
// (`apply-migrations.mjs`) doesn't read the journal so it survives the
// drift, but `drizzle-kit migrate` reads the journal and silently
// skips anything not listed — and a future infra switch back to that
// path would re-introduce the same prod-DB-missing-columns crash.
//
// This test runs without DATABASE_URL — pure FS read. Lives in
// packages/db tests because the artifacts under test are owned here.
describe("drizzle migration journal consistency", () => {
  const drizzleDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
  const journalPath = fileURLToPath(
    new URL("../../drizzle/meta/_journal.json", import.meta.url),
  );

  const sqlFiles = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  it("has a journal entry for every *.sql file", () => {
    const sqlTags = sqlFiles.map((f) => f.replace(/\.sql$/, ""));
    const journalTags = journal.entries.map((e) => e.tag);

    const missing = sqlTags.filter((t) => !journalTags.includes(t));

    expect(missing, `journal missing entries for: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("journal entries are indexed contiguously from 0", () => {
    const indices = journal.entries.map((e) => e.idx).sort((a, b) => a - b);
    const expected = indices.map((_, i) => i);

    expect(indices).toEqual(expected);
  });

  it("journal tag prefixes match their idx", () => {
    for (const entry of journal.entries) {
      const expectedPrefix = String(entry.idx).padStart(4, "0");
      expect(
        entry.tag.startsWith(`${expectedPrefix}_`),
        `entry idx=${entry.idx} has tag "${entry.tag}" — prefix should be "${expectedPrefix}_"`,
      ).toBe(true);
    }
  });
});
