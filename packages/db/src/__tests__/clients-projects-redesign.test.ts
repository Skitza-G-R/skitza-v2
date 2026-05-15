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

// Phase 1 (G6) — Adds `phone` to support the New Client modal in the
// Clients & Projects v3 redesign (DESIGN.md §6.1, migration 0012).
describe("Phase 1 — client_contacts.phone", () => {
  it("exists as a nullable text column on client_contacts", () => {
    const col = clientContacts.phone;
    expect(col).toBeDefined();
    expect(col.name).toBe("phone");
    expect(col.dataType).toBe("string");
    expect(col.notNull).toBe(false);
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

describe("Phase 0 — projects.workflow_stage", () => {
  it("exists as a non-null workflow_stage enum with default 'brief'", () => {
    const col = projects.workflowStage;
    expect(col).toBeDefined();
    expect(col.name).toBe("workflow_stage");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe("brief");
  });
});

describe("Phase 0 — project_tracks.workflow_stage", () => {
  it("exists per-song with default 'brief' to drive the stepper", () => {
    const col = projectTracks.workflowStage;
    expect(col).toBeDefined();
    expect(col.name).toBe("workflow_stage");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe("brief");
  });
});

describe("Phase 0 — bookings.song_id", () => {
  it("exists as a nullable uuid FK to project_tracks", () => {
    const col = bookings.songId;
    expect(col).toBeDefined();
    expect(col.name).toBe("song_id");
    expect(col.notNull).toBe(false);
  });
});
