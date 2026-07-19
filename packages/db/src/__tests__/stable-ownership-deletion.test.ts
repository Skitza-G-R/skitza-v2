import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "src/schema.ts"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "drizzle/0028_stable_client_ownership.sql"),
  "utf8",
);

describe("SK-91 stable ownership schema", () => {
  it("separates producer archive state from artist disconnect state", () => {
    const clientsBlock = schema.slice(
      schema.indexOf("export const clientContacts ="),
      schema.indexOf("export type ClientContact ="),
    );
    expect(clientsBlock).toContain('producerArchivedAt: timestamp("producer_archived_at"');
  });

  it("keeps project ownership non-null, producer-scoped, and restrictive", () => {
    const projectsBlock = schema.slice(
      schema.indexOf("export const projects ="),
      schema.indexOf("export type Project ="),
    );
    expect(projectsBlock).toContain('clientContactId: uuid("client_contact_id").notNull()');
    expect(projectsBlock).toContain('name: "projects_client_producer_fk"');
    expect(projectsBlock).toContain('.onDelete("restrict")');
  });

  it("freezes the artist owner and project client at the database boundary", () => {
    expect(migration).toContain("skitza_guard_client_contact_owner");
    expect(migration).toContain("SKITZA_CLIENT_OWNER_IMMUTABLE");
    expect(migration).toContain("skitza_guard_project_owner");
    expect(migration).toContain("SKITZA_PROJECT_CLIENT_IMMUTABLE");
  });

  it("allows hard deletion only for empty draft clients and projects", () => {
    expect(migration).toContain("skitza_guard_client_contact_delete");
    expect(migration).toContain("SKITZA_CLIENT_NOT_EMPTY_DRAFT");
    expect(migration).toContain("skitza_guard_project_delete");
    expect(migration).toContain("SKITZA_PROJECT_NOT_EMPTY_DRAFT");
  });

  it("checks every direct client and project history root before deletion", () => {
    for (const table of [
      "projects",
      "purchase_requests",
      "private_offers",
      "purchases",
      "purchase_acceptances",
      "payment_proofs",
      "version_approval_events",
    ]) {
      expect(migration).toContain(`FROM "${table}"`);
    }
    for (const table of [
      "project_tracks",
      "purchases",
      "purchase_requests",
      "private_offers",
      "bookings",
      "notifications",
    ]) {
      expect(migration).toContain(`FROM "${table}"`);
    }
  });

  it("keeps song, version, comment, session, agreement, proof, and payment chains restrictive", () => {
    for (const table of [
      "projectTracks",
      "trackVersions",
      "trackComments",
      "bookings",
      "purchases",
      "purchaseAcceptances",
      "paymentProofs",
      "purchasePayments",
      "purchaseSessionAllowances",
      "versionApprovalEvents",
    ]) {
      const start = schema.indexOf(`export const ${table} =`);
      const end = schema.indexOf(`export type`, start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(schema.slice(start, end)).toContain('.onDelete("restrict")');
    }
  });
});
