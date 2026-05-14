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
