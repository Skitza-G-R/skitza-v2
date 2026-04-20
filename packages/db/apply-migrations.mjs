// Applies all *.sql files in ./drizzle/ directly via the neon HTTP client.
// Exists because _journal.json is out of sync with migrations 0019+, which
// makes `drizzle-kit migrate` silently skip them. See CLAUDE.md + /skitza-migrate
// for the full context.
//
// Idempotent: every migration uses `ADD COLUMN IF NOT EXISTS` / similar,
// so re-running is a no-op on already-migrated DBs.
//
// Usage: DATABASE_URL=postgres://... node apply-migrations.mjs

import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const dir = new URL("./drizzle/", import.meta.url).pathname;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let hadError = false;

for (const f of files) {
  console.log(`--- ${f} ---`);
  const content = readFileSync(dir + f, "utf8");
  const statements = content
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\bBEGIN;/g, "")
    .replace(/\bCOMMIT;/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      // neon HTTP is a tagged template; for raw SQL with no placeholders,
      // pass a fake TemplateStringsArray (single-element array + raw prop).
      const raw = Object.assign([stmt], { raw: [stmt] });
      await sql(raw);
      console.log("  ✓", stmt.replace(/\s+/g, " ").slice(0, 90));
    } catch (e) {
      console.log("  ✗", stmt.replace(/\s+/g, " ").slice(0, 70), "→", e.message);
      hadError = true;
    }
  }
}

if (hadError) {
  console.error("\nOne or more statements failed. Review output above.");
  process.exit(1);
}

console.log("\nAll migrations applied successfully.");
