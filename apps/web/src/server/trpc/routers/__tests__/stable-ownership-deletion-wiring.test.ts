import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const project = readFileSync(join(__dirname, "../project.ts"), "utf8");
const clients = readFileSync(join(__dirname, "../client-contacts.ts"), "utf8");
const artistAccess = readFileSync(join(__dirname, "../../../artist/access.ts"), "utf8");
const connectArtist = readFileSync(
  join(__dirname, "../../../contacts/connect-artist.ts"),
  "utf8",
);

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("SK-91 router wiring", () => {
  it("creates projects from a stable client id and never accepts ownership edits", () => {
    const createInput = block(project, "const CreateProjectInput", "const UpdateProjectInput");
    const updateInput = block(project, "const UpdateProjectInput", "const AddTrackInput");

    expect(createInput).toContain("clientContactId: z.string().uuid()");
    expect(createInput).not.toMatch(/artistEmail|clientEmail/);
    expect(updateInput).not.toMatch(/clientContactId|artistEmail|clientEmail/);
  });

  it("delegates hard deletion to the historical deletion domain", () => {
    const clientRemove = block(clients, "  remove: producerProcedure", "  // Clients & Projects");
    const projectDelete = block(project, "  deleteEmptyDraft: producerProcedure", "  addTrack:");

    expect(clientRemove).toContain("permanentlyDeleteEmptyDraftClient");
    expect(clientRemove).not.toContain("ctx.db.delete(clientContacts)");
    expect(projectDelete).toContain("permanentlyDeleteEmptyDraftProject");
    expect(projectDelete).not.toContain("ctx.db.delete(projects)");
  });

  it("removes email-snapshot authorization and historical comment filtering", () => {
    expect(artistAccess).not.toContain("activeArtistClientPair");
    expect(artistAccess).not.toContain("clientContacts.email");
    expect(clients).not.toContain("lower(${trackComments.authorEmail})");
  });

  it("prevents a later email owner from replacing an already-linked account", () => {
    expect(connectArtist).toContain("setWhere:");
    expect(connectArtist).toContain("clientContacts.clerkUserId} IS NULL");
    expect(connectArtist).toContain("assertStableArtistOwnerAssignment");
    expect(connectArtist).toContain('"OWNER_CONFLICT"');
  });
});
