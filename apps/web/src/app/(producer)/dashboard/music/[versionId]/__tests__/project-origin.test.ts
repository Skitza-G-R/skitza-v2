import { describe, expect, it } from "vitest";

import {
  canUploadProducerSongVersion,
  producerProjectOriginHref,
} from "../project-origin";

describe("producerProjectOriginHref", () => {
  it("returns to Clients & Projects only when the route context matches the owned project", () => {
    expect(producerProjectOriginHref("project-1", "project-1")).toBe(
      "/dashboard/clients-projects/project-1",
    );
  });

  it("rejects missing or mismatched route context", () => {
    expect(producerProjectOriginHref("project-1", undefined)).toBeUndefined();
    expect(producerProjectOriginHref("project-1", "project-2")).toBeUndefined();
  });
});

describe("canUploadProducerSongVersion", () => {
  const active = {
    projectLifecycleStatus: "active" as const,
    purchaseLifecycleStatus: "active" as const,
    trackArchived: false,
    artistApprovalLocked: false,
  };

  it("allows the next version only inside active, unarchived, unapproved work", () => {
    expect(canUploadProducerSongVersion(active)).toBe(true);
  });

  it("keeps inactive, archived, or artist-approved work closed", () => {
    expect(
      canUploadProducerSongVersion({
        ...active,
        purchaseLifecycleStatus: "canceled",
      }),
    ).toBe(false);
    expect(canUploadProducerSongVersion({ ...active, trackArchived: true })).toBe(false);
    expect(canUploadProducerSongVersion({ ...active, artistApprovalLocked: true })).toBe(false);
  });
});
