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
