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
