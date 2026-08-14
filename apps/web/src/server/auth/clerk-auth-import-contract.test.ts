import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("server Clerk auth import contract", () => {
  it("routes every server auth() caller through canonical identity resolution", () => {
    const sourceRoot = join(process.cwd(), "src");
    const directAuthImport =
      /import\s*\{[^}]*\bauth(?:\s+as\s+\w+)?\b[^}]*\}\s*from\s*["']@clerk\/nextjs\/server["']/;
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => directAuthImport.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path))
      .filter((path) => path !== "server/auth/clerk-identity.ts");

    expect(offenders).toEqual([]);
  });
});
