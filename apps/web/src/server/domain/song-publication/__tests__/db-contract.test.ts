import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "db.ts"), "utf8");

function sourceBlock(startToken: string, endToken?: string): string {
  const start = source.indexOf(startToken);
  const end = endToken ? source.indexOf(endToken, start) : source.length;
  expect(start, startToken).toBeGreaterThanOrEqual(0);
  expect(end, endToken ?? "end of source").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("song publication Postgres repository contract", () => {
  it("discovers ownership before loading publication state and hides missing or foreign ids", () => {
    const discovery = sourceBlock("async function discoverSongScope", "/**\n * Keep this lock order");
    const repository = sourceBlock("export function songPublicationRepository");

    expect(discovery).toContain("eq(projectTracks.id, scope.trackId)");
    expect(discovery).toContain("eq(projects.producerId, scope.producerId)");
    expect(discovery).toContain("eq(purchases.producerId, scope.producerId)");
    expect(discovery).toContain("eq(purchases.clientContactId, projects.clientContactId)");
    expect(repository).toContain("if (!discovered) return work(unavailableTransaction())");
    expect(repository.indexOf("discoverSongScope(tx, scope)")).toBeLessThan(
      repository.indexOf("lockCoreSongScope(tx, scope, discovered)"),
    );
  });

  it("takes project and purchase advisory locks before core rows, then versions, link, and events", () => {
    const core = sourceBlock("async function lockCoreSongScope", "function versionSelection");
    const repository = sourceBlock("export function songPublicationRepository");
    const projectAdvisory = core.indexOf("hashtextextended(${discovered.projectId}");
    const purchaseAdvisory = core.indexOf("hashtextextended(${discovered.purchaseId}");

    expect(projectAdvisory).toBeGreaterThanOrEqual(0);
    expect(purchaseAdvisory).toBeGreaterThan(projectAdvisory);
    expect(core.match(/\.for\("update"\)/g)).toHaveLength(3);

    const versions = repository.indexOf("lockVersions(tx, locked)");
    const link = repository.indexOf("lockLink(tx, locked)");
    const events = repository.indexOf("lockAuditEvents(tx, locked)");
    expect(versions).toBeGreaterThan(repository.indexOf("lockCoreSongScope"));
    expect(link).toBeGreaterThan(versions);
    expect(events).toBeGreaterThan(link);
  });

  it("counts only the fail-closed stored-audio projection and loads ordered event state", () => {
    const repository = sourceBlock("export function songPublicationRepository");
    const versions = sourceBlock("async function lockVersions", "async function lockLink");
    const events = sourceBlock("async function lockAuditEvents", "function exactLinkScope");

    expect(versions).toContain("trackVersions.trackId");
    expect(versions).toContain("trackVersions.purchaseId");
    expect(versions).toContain("trackVersions.producerId");
    expect(versions).toContain('.for("update")');
    expect(events).toContain("asc(songPublicAccessEvents.sequence)");
    expect(events).toContain('.for("update")');
    expect(repository).toContain("selectPublicStoredVersions(versions, locked).length");
    expect(repository).toContain("events.at(-1)?.sequence ?? 0");
  });

  it("uses exact optimistic predicates and touches the project with portfolio changes", () => {
    const adapter = sourceBlock("function transactionAdapter", "export function songPublicationRepository");
    const updateLink = adapter.slice(
      adapter.indexOf("updateLink: async"),
      adapter.indexOf("setPortfolioPublishedAt: async"),
    );
    const portfolio = adapter.slice(
      adapter.indexOf("setPortfolioPublishedAt: async"),
      adapter.indexOf("appendAuditEvent: async"),
    );

    for (const predicate of [
      "songPublicLinks.id",
      "songPublicLinks.trackId",
      "songPublicLinks.purchaseId",
      "songPublicLinks.producerId",
      "songPublicLinks.tokenVersion",
      "input.expectedDisabledAt",
    ]) {
      expect(updateLink, predicate).toContain(predicate);
    }
    expect(portfolio).toContain("input.expectedPortfolioPublishedAt");
    expect(portfolio).toContain("eq(projects.producerId, scope.producerId)");
    expect(portfolio).toContain("updatedAt: input.changedAt");
  });

  it("persists every immutable audit snapshot field and turns unique races into null", () => {
    const append = sourceBlock("appendAuditEvent: async", "export function songPublicationRepository");
    for (const field of [
      "trackId",
      "purchaseId",
      "producerId",
      "linkId",
      "versionId",
      "action",
      "sequence",
      "tokenVersion",
      "tokenHash",
      "changed",
      "linkEnabled",
      "portfolioPublished",
      "remainingAudioCount",
      "operationKey",
      "operationDigest",
      "changedByClerkUserId",
      "createdAt",
    ]) {
      expect(append, field).toContain(`${field}: event.${field}`);
    }
    expect(append).toContain(".onConflictDoNothing()");
    expect(append).toContain("return inserted ? auditEventFromRow(inserted) : null");
  });
});
