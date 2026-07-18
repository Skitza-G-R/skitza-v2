import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const artistSource = readFileSync(new URL("../artist.ts", import.meta.url), "utf8");
const projectSource = readFileSync(new URL("../project.ts", import.meta.url), "utf8");

const artistComment = artistSource.slice(
  artistSource.indexOf("  addComment: artistProcedure"),
  artistSource.indexOf("  // L3 song page detail"),
);
const producerComment = projectSource.slice(
  projectSource.indexOf("  addProducerComment: producerProcedure"),
  projectSource.indexOf("  // Sessions now point at an existing purchase-owned project"),
);
const artistDetailStart = artistSource.indexOf("  detail: artistProcedure");
const artistDetail = artistSource.slice(
  artistDetailStart,
  artistSource.indexOf("const approvalRows", artistDetailStart),
);
const artistDetailHead = artistSource.slice(
  artistDetailStart,
  artistSource.indexOf("if (!head)", artistDetailStart),
);

function expectLockedCommentBoundary(source: string) {
  const transaction = source.indexOf("ctx.db.transaction");
  const advisoryLock = source.indexOf("pg_advisory_xact_lock", transaction);
  const projectLock = source.indexOf(".from(projects)", advisoryLock);
  const trackLock = source.indexOf(".from(projectTracks)", projectLock);
  const versionLock = source.indexOf(".from(trackVersions)", trackLock);
  const assertion = source.indexOf("assertWritableCommentTarget", versionLock);
  const insert = source.indexOf(".insert(trackComments)", assertion);

  expect(transaction).toBeGreaterThanOrEqual(0);
  expect(advisoryLock).toBeGreaterThan(transaction);
  expect(projectLock).toBeGreaterThan(advisoryLock);
  expect(trackLock).toBeGreaterThan(projectLock);
  expect(versionLock).toBeGreaterThan(trackLock);
  expect(assertion).toBeGreaterThan(versionLock);
  expect(insert).toBeGreaterThan(assertion);
  expect(source.match(/\.for\("update"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(source).toMatch(/tx\s*\.insert\(trackComments\)/);
}

describe("comment lifecycle wiring", () => {
  it("serializes artist comments with project, track, and version lifecycle rows", () => {
    expectLockedCommentBoundary(artistComment);
  });

  it("serializes producer comments with project, track, and version lifecycle rows", () => {
    expectLockedCommentBoundary(producerComment);
  });

  it("hides only unfinished multipart placeholders from the artist version stack", () => {
    expect(artistDetail).toMatch(
      /or\(\s*isNotNull\(trackVersions\.audioUrl\),\s*isNotNull\(trackVersions\.audioDeletedAt\),?\s*\)/,
    );
  });

  it("refuses an unfinished multipart placeholder as the selected artist version", () => {
    expect(artistDetailHead).toMatch(
      /eq\(trackVersions\.id, input\.versionId\)[\s\S]*?or\(\s*isNotNull\(trackVersions\.audioUrl\),\s*isNotNull\(trackVersions\.audioDeletedAt\),?\s*\)/,
    );
  });
});
