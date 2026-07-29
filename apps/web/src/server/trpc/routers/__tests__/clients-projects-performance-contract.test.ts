import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "client-contacts.ts"), "utf8");
const realDbTest = readFileSync(
  join(here, "clients-projects-sk145-real-db.integration.test.ts"),
  "utf8",
);

const listStart = source.indexOf("  listWithProjects: producerProcedure");
const listEnd = source.indexOf("\n\n  // Batch D", listStart);
const listWithProjects = source.slice(listStart, listEnd);

const detailStart = source.indexOf("  detail: producerProcedure");
const detailEnd = source.indexOf("\n\n  // Client Space", detailStart);
const detail = source.slice(detailStart, detailEnd);
const clientSpaceDetailStart = source.indexOf("  clientSpaceDetail: producerProcedure");
const clientSpaceDetailEnd = source.indexOf("\n});", clientSpaceDetailStart);
const clientSpaceDetail = source.slice(clientSpaceDetailStart, clientSpaceDetailEnd);

describe("Clients & Projects read-performance contracts", () => {
  it("offers one combined workspace view without changing existing view names", () => {
    expect(listWithProjects).toContain('z.enum(["by-client", "all-projects", "workspace"])');
    expect(listWithProjects).toContain('view: "workspace" as const');
    expect(listWithProjects).toMatch(
      /view:\s*"workspace" as const,[\s\S]*projects:[\s\S]*clients:/,
    );
    expect(listWithProjects).toContain('view: "all-projects" as const');
    expect(listWithProjects).toContain('view: "by-client" as const');
  });

  it("loads the shared project, comment, and contact inputs once and concurrently", () => {
    expect(listWithProjects).toMatch(
      /const \[projectRows, commentAgg, contacts\] = await Promise\.all\(\[/,
    );
    expect(listWithProjects.match(/\.from\(projects\)/g)).toHaveLength(1);
    expect(listWithProjects.match(/\.from\(trackComments\)/g)).toHaveLength(1);
    expect(listWithProjects.match(/\.from\(clientContacts\)/g)).toHaveLength(1);
  });

  it("keeps Client Space lean without widening the legacy detail contract", () => {
    expect(detail).toContain(".input(z.object({ id: z.string().uuid() }))");
    expect(detail).toContain("getClientMoneyLedger");
    expect(detail).toContain(".from(trackComments)");
    expect(detail).toContain(".from(trackVersions)");
    expect(clientSpaceDetail).toContain("loadClientDetailBase(ctx, input.id)");
    expect(clientSpaceDetail).not.toContain("getClientMoneyLedger");
    expect(clientSpaceDetail).not.toContain(".from(trackComments)");
    expect(clientSpaceDetail).not.toContain(".from(trackVersions)");
  });

  it("fails CI instead of silently skipping the SK-145 database cases", () => {
    expect(realDbTest).toContain("process.env.DATABASE_URL_TEST");
    expect(realDbTest).toContain('process.env.CI !== undefined && process.env.CI !== "false"');
    expect(realDbTest).toContain("if (runningInCi && !testDatabaseUrl)");
    expect(realDbTest).toContain(
      "SK-145 CI requires DATABASE_URL_TEST; these DB cases must run, not skip",
    );
  });
});
