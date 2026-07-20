import { describe, expect, it } from "vitest";

import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
  type VersionUploadLifecycleCandidate,
} from "../service";

const activeCandidate: VersionUploadLifecycleCandidate = {
  producerId: "producer-1",
  projectId: "project-1",
  purchaseId: "purchase-1",
  projectLifecycleStatus: "active",
  purchaseLifecycleStatus: "active",
  trackArchivedAt: null,
  currentArtistApprovalAction: null,
};

const expectedScope = {
  producerId: "producer-1",
  projectId: "project-1",
  purchaseId: "purchase-1",
};

describe("version upload lifecycle", () => {
  it("accepts only the exact active owned project and purchase", () => {
    expect(assertActiveVersionUploadLifecycle(activeCandidate, expectedScope)).toEqual(
      activeCandidate,
    );
  });

  it.each(["waiting_for_payment", "paused", "completed", "canceled"] as const)(
    "rejects a %s project",
    (projectLifecycleStatus) => {
      expect(() =>
        assertActiveVersionUploadLifecycle(
          { ...activeCandidate, projectLifecycleStatus },
          expectedScope,
        ),
      ).toThrow(expect.objectContaining<Partial<VersionUploadDomainError>>({ code: "INACTIVE" }));
    },
  );

  it.each(["waiting_for_payment", "canceled"] as const)(
    "rejects a %s purchase",
    (purchaseLifecycleStatus) => {
      expect(() =>
        assertActiveVersionUploadLifecycle(
          { ...activeCandidate, purchaseLifecycleStatus },
          expectedScope,
        ),
      ).toThrow(expect.objectContaining<Partial<VersionUploadDomainError>>({ code: "INACTIVE" }));
    },
  );

  it("rejects an archived track with a restore-specific inactive error", () => {
    expect(() =>
      assertActiveVersionUploadLifecycle(
        {
          ...activeCandidate,
          trackArchivedAt: new Date("2026-07-19T09:00:00.000Z"),
        },
        expectedScope,
      ),
    ).toThrow(
      expect.objectContaining<Partial<VersionUploadDomainError>>({
        code: "INACTIVE",
        message: "Restore this archived song before changing its audio versions",
      }),
    );
  });

  it("locks all audio changes while the newest artist event is approval", () => {
    expect(() =>
      assertActiveVersionUploadLifecycle(
        { ...activeCandidate, currentArtistApprovalAction: "approved" },
        expectedScope,
      ),
    ).toThrow(
      expect.objectContaining<Partial<VersionUploadDomainError>>({
        code: "INACTIVE",
        message: "Reopen this artist-approved song before changing its audio versions",
      }),
    );

    expect(
      assertActiveVersionUploadLifecycle(
        { ...activeCandidate, currentArtistApprovalAction: "revoked" },
        expectedScope,
      ),
    ).toEqual({ ...activeCandidate, currentArtistApprovalAction: "revoked" });
  });

  it("preserves ownership and lifecycle error precedence for archived tracks", () => {
    const archivedAt = new Date("2026-07-19T09:00:00.000Z");

    expect(() =>
      assertActiveVersionUploadLifecycle(
        { ...activeCandidate, producerId: "producer-2", trackArchivedAt: archivedAt },
        expectedScope,
      ),
    ).toThrow(
      expect.objectContaining<Partial<VersionUploadDomainError>>({
        code: "NOT_FOUND",
        message: "The purchase-owned version upload scope was not found",
      }),
    );

    expect(() =>
      assertActiveVersionUploadLifecycle(
        {
          ...activeCandidate,
          projectLifecycleStatus: "completed",
          trackArchivedAt: archivedAt,
        },
        expectedScope,
      ),
    ).toThrow(
      expect.objectContaining<Partial<VersionUploadDomainError>>({
        code: "INACTIVE",
        message: "Audio versions can be changed only while the project and purchase are active",
      }),
    );

    expect(() =>
      assertActiveVersionUploadLifecycle(
        {
          ...activeCandidate,
          purchaseLifecycleStatus: "canceled",
          trackArchivedAt: archivedAt,
        },
        expectedScope,
      ),
    ).toThrow(
      expect.objectContaining<Partial<VersionUploadDomainError>>({
        code: "INACTIVE",
        message: "Audio versions can be changed only while the project and purchase are active",
      }),
    );
  });

  it("fails closed when ownership or the purchase-project binding changes", () => {
    for (const candidate of [
      null,
      { ...activeCandidate, producerId: "producer-2" },
      { ...activeCandidate, projectId: "project-2" },
      { ...activeCandidate, purchaseId: "purchase-2" },
    ]) {
      expect(() => assertActiveVersionUploadLifecycle(candidate, expectedScope)).toThrow(
        expect.objectContaining<Partial<VersionUploadDomainError>>({ code: "NOT_FOUND" }),
      );
    }
  });
});
