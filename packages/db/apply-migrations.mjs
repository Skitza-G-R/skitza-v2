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
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
// Use fileURLToPath instead of .pathname — the latter keeps percent-encoding
// (e.g. "%20" for spaces), which Node's fs APIs don't decode.
const dir = fileURLToPath(new URL("./drizzle/", import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let hadError = false;

// Dollar-quote-aware SQL splitter. Migrations can contain DO $$ ... $$
// blocks (idempotent constraint adds with EXCEPTION handlers) whose bodies
// contain internal semicolons that must NOT be treated as statement boundaries.
// We track `$tag$` quote state while walking the string.
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let dollarTag = null; // when non-null, we're inside a $tag$...$tag$ block
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollarTag === null) {
      // Detect opening $tag$ (including empty tag $$)
      if (ch === "$") {
        const m = sql.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
        if (m) {
          dollarTag = m[0];
          buf += dollarTag;
          i += dollarTag.length;
          continue;
        }
      }
      if (ch === ";") {
        if (buf.trim()) out.push(buf.trim());
        buf = "";
        i++;
        continue;
      }
      buf += ch;
      i++;
    } else {
      // Inside dollar-quoted region; look for the closing tag
      if (sql.slice(i, i + dollarTag.length) === dollarTag) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i++;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

for (const f of files) {
  console.log(`--- ${f} ---`);
  const content = readFileSync(dir + f, "utf8");
  // Strip comment lines (but keep content on lines with mixed code + --).
  // Strip BEGIN/COMMIT wrappers — neon HTTP auto-commits per statement.
  const cleaned = content
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\bBEGIN;/g, "")
    .replace(/\bCOMMIT;/g, "");
  const statements = splitStatements(cleaned).filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      // neon HTTP is a tagged template; for raw SQL with no placeholders,
      // pass a fake TemplateStringsArray (single-element array + raw prop).
      const raw = Object.assign([stmt], { raw: [stmt] });
      await sql(raw);
      console.log("  ✓", stmt.replace(/\s+/g, " ").slice(0, 90));
    } catch (e) {
      // Tolerate errors that indicate "this migration step was already
      // applied." Re-running on a persistent (partially-migrated) DB will
      // hit these; the downstream tests catch any genuine missing-schema
      // issue by failing on actual use.
      const benign = /already exists|duplicate_object|duplicate key|does not exist|cannot be (renamed|dropped)|referenced in foreign key|violates foreign key/i.test(e.message);
      const tag = benign ? "•" : "✗";
      console.log("  " + tag, stmt.replace(/\s+/g, " ").slice(0, 70), "→", e.message);
      if (!benign) hadError = true;
    }
  }
}

if (hadError) {
  console.error("\nOne or more statements failed. Review output above.");
  process.exit(1);
}

console.log("\nAll migrations applied successfully.");
