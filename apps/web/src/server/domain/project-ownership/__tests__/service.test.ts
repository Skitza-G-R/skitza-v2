import { describe, expect, it } from "vitest";

import {
  assertStableArtistOwnerAssignment,
  createStableClientProject,
  type StableProjectRepository,
} from "../service";

function repository(
  contact:
    | {
        id: string;
        producerId: string;
        name: string;
        email: string;
      }
    | null,
): StableProjectRepository & { inserts: Array<Record<string, unknown>> } {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    atomically: async (_scope, work) =>
      work({
        lockClient: () => Promise.resolve(contact),
        insertProject: (input) => {
          inserts.push(input);
          return Promise.resolve({ id: "project-1", ...input });
        },
      }),
  };
}

describe("stable project ownership", () => {
  it("creates a project from an exact producer-owned client id", async () => {
    const repo = repository({
      id: "client-1",
      producerId: "producer-1",
      name: "Maya",
      email: "maya@example.test",
    });

    const project = await createStableClientProject(repo, {
      producerId: "producer-1",
      clientContactId: "client-1",
      title: "Maya EP",
      inviteToken: "invite-token",
      deadlineAt: null,
    });

    expect(project.clientContactId).toBe("client-1");
    expect(repo.inserts).toEqual([
      expect.objectContaining({
        producerId: "producer-1",
        clientContactId: "client-1",
        artistName: "Maya",
        artistEmail: "maya@example.test",
      }),
    ]);
  });

  it("fails closed for a foreign or missing client without distinguishing them", async () => {
    const repo = repository(null);

    await expect(
      createStableClientProject(repo, {
        producerId: "producer-1",
        clientContactId: "foreign-client",
        title: "Hidden",
        inviteToken: "invite-token",
        deadlineAt: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repo.inserts).toHaveLength(0);
  });
});

describe("stable artist login ownership", () => {
  it("allows first assignment and exact-owner reconnect", () => {
    expect(assertStableArtistOwnerAssignment(null, "user-1")).toBe("user-1");
    expect(assertStableArtistOwnerAssignment("user-1", "user-1")).toBe("user-1");
  });

  it("rejects ownership transfer after an email edit", () => {
    expect(() => assertStableArtistOwnerAssignment("user-1", "user-2")).toThrow(
      expect.objectContaining({ code: "OWNER_CONFLICT" }),
    );
  });
});
