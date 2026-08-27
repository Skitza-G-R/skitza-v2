// A Drizzle `.select({ ... })` that names a column from a table the query never
// joins compiles cleanly and then throws at runtime:
//   Your "projectId" field references a column "projects"."id", but the table
//   "projects" is not part of the query! Did you forget to join it?
//
// SK: the artist reschedule availability branch shipped exactly that, so every
// /artist/sessions/[id]/reschedule render threw into the artist error boundary.
// TypeScript cannot see it, and DB-mocking tests stub the joins away, so this
// static sweep is the guard: every table a select reads from must be joined.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, "..", "..", "..");
const schemaSource = readFileSync(
  join(here, "..", "..", "..", "..", "..", "..", "..", "packages", "db", "src", "schema.ts"),
  "utf8",
);
const tableNames = new Set(
  [...schemaSource.matchAll(/export const (\w+) = pgTable\(/g)].map((match) => match[1]),
);

function serverSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) serverSourceFiles(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

// Returns the balanced slice starting at `open`, which must index a "{" or "(".
function balancedSlice(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "{" || char === "(") depth++;
    else if (char === "}" || char === ")") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

// The builder chain after the select object, up to the statement-ending ";".
function builderChain(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === ";" && depth <= 0) return source.slice(from, i);
  }
  return source.slice(from);
}

function knownTables(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)]
    .map((entry) => entry[1])
    .filter((name): name is string => name !== undefined && tableNames.has(name));
}

function missingJoins(source: string): { line: number; tables: string[] }[] {
  const violations: { line: number; tables: string[] }[] = [];
  const selects = /\.select(?:Distinct)?\(\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = selects.exec(source))) {
    const objectStart = match.index + match[0].length - 1;
    const selectObject = balancedSlice(source, objectStart);
    const chain = builderChain(source, objectStart + selectObject.length);

    // A source that is not a bare table identifier (subquery, alias(...)) makes
    // the joined-table list unknowable from source alone, so skip those chains.
    const sources = /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\(/g;
    let aliased = false;
    let sourceMatch: RegExpExecArray | null;
    while ((sourceMatch = sources.exec(chain))) {
      if (!/^\s*\w+\s*[,)]/.test(chain.slice(sourceMatch.index + sourceMatch[0].length))) {
        aliased = true;
        break;
      }
    }
    if (aliased || /\balias\(/.test(chain)) continue;

    // Tables named inside a raw sql`...` template are correlated subqueries and
    // are not required to be joined, so drop every template before reading names.
    const columnsOnly = selectObject.replace(/`(?:[^`\\]|\\.)*`/g, "``");
    const read = new Set(knownTables(columnsOnly, /\b(\w+)\s*\./g));
    const joined = new Set(
      knownTables(chain, /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\(\s*(\w+)/g),
    );
    if (joined.size === 0) continue;

    const tables = [...read].filter((name) => !joined.has(name));
    if (tables.length > 0) {
      violations.push({ line: source.slice(0, match.index).split("\n").length, tables });
    }
  }
  return violations;
}

describe("drizzle select/join coverage", () => {
  it("finds a real table set to check against", () => {
    expect(tableNames.size).toBeGreaterThan(40);
    expect(tableNames.has("projects")).toBe(true);
  });

  it("joins every table that the artist reschedule availability branch selects", () => {
    const artistRouter = readFileSync(join(here, "..", "artist.ts"), "utf8");
    const availability = artistRouter.slice(
      artistRouter.indexOf("availability: artistProcedure"),
      artistRouter.indexOf("activePackages: artistProcedure"),
    );
    const rescheduleBranch = availability.slice(
      availability.indexOf("if (input.bookingId) {"),
      availability.indexOf("} else if (input.sessionAllowanceId) {"),
    );

    expect(rescheduleBranch).toContain("projectId: projects.id");
    expect(rescheduleBranch).toContain("projectLifecycleStatus: projects.lifecycleStatus");
    expect(rescheduleBranch).toMatch(/\.innerJoin\(\s*projects,/);
  });

  it("never selects a column from a table the query does not join", () => {
    const offenders: string[] = [];
    for (const file of serverSourceFiles(serverRoot)) {
      for (const violation of missingJoins(readFileSync(file, "utf8"))) {
        offenders.push(
          `${relative(serverRoot, file)}:${String(violation.line)} reads ${violation.tables.join(", ")} without joining it`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
