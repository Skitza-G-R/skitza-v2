import { describe, expect, it } from "vitest";

import { ProjectOwnershipDomainError } from "~/server/domain/project-ownership/service";

import { isJoinAccountConflict, joinAccountConflictHref } from "./join-recovery";

describe("join account recovery", () => {
  it("recognizes only the stable-owner conflict seen in the join flow", () => {
    expect(
      isJoinAccountConflict(
        new ProjectOwnershipDomainError(
          "OWNER_CONFLICT",
          "This client already belongs to another verified account",
        ),
      ),
    ).toBe(true);
    expect(
      isJoinAccountConflict(new ProjectOwnershipDomainError("NOT_FOUND", "Missing client")),
    ).toBe(false);
    expect(isJoinAccountConflict(new Error("OWNER_CONFLICT"))).toBe(false);
    expect(isJoinAccountConflict({ code: "OWNER_CONFLICT" })).toBe(false);
  });

  it("returns to the exact studio and requested action without an external URL", () => {
    expect(joinAccountConflictHref("northline-studio", "book")).toBe(
      "/join/northline-studio/continue?action=book&problem=account-conflict",
    );
    expect(joinAccountConflictHref("northline-studio", "unlock")).toBe(
      "/join/northline-studio/continue?action=unlock&problem=account-conflict",
    );
    expect(joinAccountConflictHref("studio/elsewhere", "book")).toBe(
      "/join/studio%2Felsewhere/continue?action=book&problem=account-conflict",
    );
  });
});
