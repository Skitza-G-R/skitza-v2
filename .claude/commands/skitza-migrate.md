---
description: Apply all pending SQL migrations in packages/db/drizzle/ directly against $DATABASE_URL, bypassing the broken drizzle-kit journal
---

## Why this exists

packages/db/drizzle/meta/_journal.json stops tracking at migration 0018. Migrations
0019+ exist as .sql files but drizzle-kit migrate skips them. This command applies
them directly via the neon HTTP client's TemplateStringsArray trick.

## Steps

1. Confirm DATABASE_URL is set: `echo $DATABASE_URL | head -c 20` (should print `postgresql://` or similar). If not, export it from `apps/web/.env.local`.

2. Run the apply script at `packages/db/apply-migrations.mjs`. If the file is missing, recreate it with the content below:

   ```js
   import { neon } from "@neondatabase/serverless";
   import { readFileSync, readdirSync } from "node:fs";

   const sql = neon(process.env.DATABASE_URL);
   const dir = "drizzle";
   const files = readdirSync(dir)
     .filter((f) => f.endsWith(".sql"))
     .sort();

   for (const f of files) {
     console.log(`--- ${f} ---`);
     const content = readFileSync(`${dir}/${f}`, "utf8");
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
         // neon HTTP only accepts tagged template; fake one for raw SQL
         const raw = Object.assign([stmt], { raw: [stmt] });
         await sql(raw);
         console.log("  ✓", stmt.replace(/\s+/g, " ").slice(0, 90));
       } catch (e) {
         console.log("  ✗", stmt.replace(/\s+/g, " ").slice(0, 70), "→", e.message);
       }
     }
   }
   ```

3. Execute: `cd packages/db && node apply-migrations.mjs`

4. Report which migrations applied cleanly vs which had errors.

## Notes

- Migrations are idempotent (use `IF NOT EXISTS` or similar).
- Safe to re-run — already-applied statements are no-ops on Neon.
- This does NOT update `_journal.json`. That's a separate fix (see the journal-sync commit).
