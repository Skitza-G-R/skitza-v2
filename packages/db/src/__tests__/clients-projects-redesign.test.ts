import { describe, it, expect } from "vitest";
import {
  workflowStage,
  clientContacts,
  projects,
  projectTracks,
  bookings,
} from "../index";

describe("Phase 0 — workflow_stage enum", () => {
  it("exports 5 stages in order: brief → production → mixing → mastering → done", () => {
    expect(workflowStage.enumValues).toEqual([
      "brief",
      "production",
      "mixing",
      "mastering",
      "done",
    ]);
  });
});

describe("Phase 0 — client_contacts.invited_at", () => {
  it("exists as a nullable timestamp column on client_contacts", () => {
    const col = clientContacts.invitedAt;
    expect(col).toBeDefined();
    expect(col.name).toBe("invited_at");
    expect(col.notNull).toBe(false);
  });
});

describe("Phase 0 — client_contacts.position", () => {
  it("exists as an integer with default 0 for drag-reorder", () => {
    const col = clientContacts.position;
    expect(col).toBeDefined();
    expect(col.name).toBe("position");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe(0);
  });
});

describe("Phase 0 — projects.position", () => {
  it("exists as an integer with default 0 for drag-reorder", () => {
    const col = projects.position;
    expect(col).toBeDefined();
    expect(col.name).toBe("position");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe(0);
  });
});
