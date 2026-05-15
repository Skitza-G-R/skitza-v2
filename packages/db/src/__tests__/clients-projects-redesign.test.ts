import { describe, it, expect } from "vitest";
import {
  workflowStage,
  clientContacts,
  projects,
  projectTracks,
  bookings,
  trackVersions,
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

// Phase 4 (C2) — persists the producer's notes typed in the Upload
// Track modal (DESIGN.md §6.4). Nullable so existing rows are
// unaffected; surfaces on the artist-facing version page.
describe("Phase 4 — track_versions.description", () => {
  it("exists as a nullable text column on track_versions", () => {
    const col = trackVersions.description;
    expect(col).toBeDefined();
    expect(col.name).toBe("description");
    expect(col.dataType).toBe("string");
    expect(col.notNull).toBe(false);
  });
});

// Phase 1 (G7) — New Project modal fields. The producer picks a store
// product, sets a deadline, and confirms total + deposit at create
// time. All four columns are nullable so legacy rows and old callers
// (e.g. project.create without these inputs) continue to work.
// Migration 0014; DESIGN.md §6.2.
describe("Phase 1 — projects.product_id", () => {
  it("exists as a nullable uuid FK to products", () => {
    const col = projects.productId;
    expect(col).toBeDefined();
    expect(col.name).toBe("product_id");
    expect(col.notNull).toBe(false);
  });
});

describe("Phase 1 — projects.deadline_at", () => {
  it("exists as a nullable timestamp column on projects", () => {
    const col = projects.deadlineAt;
    expect(col).toBeDefined();
    expect(col.name).toBe("deadline_at");
    expect(col.notNull).toBe(false);
  });
});

describe("Phase 1 — projects.engagement_total_cents", () => {
  it("exists as a nullable integer column on projects", () => {
    const col = projects.engagementTotalCents;
    expect(col).toBeDefined();
    expect(col.name).toBe("engagement_total_cents");
    expect(col.dataType).toBe("number");
    expect(col.notNull).toBe(false);
  });
});

describe("Phase 1 — projects.deposit_cents", () => {
  it("exists as a nullable integer column on projects", () => {
    const col = projects.depositCents;
    expect(col).toBeDefined();
    expect(col.name).toBe("deposit_cents");
    expect(col.dataType).toBe("number");
    expect(col.notNull).toBe(false);
  });
});
