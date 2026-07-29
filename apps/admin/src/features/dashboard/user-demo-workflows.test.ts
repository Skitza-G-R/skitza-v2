import { describe, expect, it } from "vitest";

import type { DemoUserSummary } from "~/lib/admin-demo-view-models";
import {
  appendSupportNote,
  filterAndSortUsers,
  normalizeSupportTags,
  paginateUsers,
  updateUserStatus,
  validateSupportDetails,
  validateWorkspaceDeletion,
} from "./user-demo-workflows";

const USERS: readonly DemoUserSummary[] = [
  {
    id: "demo_live_user_zara",
    initials: "ZA",
    name: "Zara Artist",
    email: "zara@example.com",
    roles: ["Artist"],
    status: "Needs attention",
    onboarding: "In progress",
    activation: "Window open",
    joinedAt: "20 Jul 2026",
    lastActivity: "Yesterday",
    publicPage: "Visible",
    emailDelivery: "Failed",
  },
  {
    id: "demo_live_user_amy",
    initials: "AP",
    name: "Amy Producer",
    email: "amy@example.com",
    roles: ["Producer"],
    status: "Active",
    onboarding: "Complete",
    activation: "Activated",
    joinedAt: "18 Jul 2026",
    lastActivity: "12 min ago",
    publicPage: "Visible",
    emailDelivery: "Delivered",
  },
  {
    id: "demo_live_user_both",
    initials: "BP",
    name: "Both Person",
    email: "both@example.com",
    roles: ["Artist", "Producer"],
    status: "Suspended",
    onboarding: "Not started",
    activation: "Not activated",
    joinedAt: "12 Jul 2026",
    lastActivity: "16 days ago",
    publicPage: "Hidden",
    emailDelivery: "Failed",
  },
];

describe("user demo workflow helpers", () => {
  it("filters by query, role, and status before sorting", () => {
    const result = filterAndSortUsers(USERS, {
      query: "person",
      role: "both",
      status: "suspended",
      sortDirection: "asc",
      sortKey: "name",
    });

    expect(result.map((user) => user.id)).toEqual(["demo_live_user_both"]);
  });

  it("sorts without mutating repository fixtures", () => {
    const originalOrder = USERS.map((user) => user.id);
    const result = filterAndSortUsers(USERS, {
      query: "",
      role: "all",
      status: "all",
      sortDirection: "asc",
      sortKey: "name",
    });

    expect(result.map((user) => user.name)).toEqual([
      "Amy Producer",
      "Both Person",
      "Zara Artist",
    ]);
    expect(USERS.map((user) => user.id)).toEqual(originalOrder);
  });

  it("paginates two users at a time and clamps an invalid page", () => {
    expect(paginateUsers(USERS, 1)).toMatchObject({
      currentPage: 1,
      pageCount: 2,
      items: USERS.slice(0, 2),
    });
    expect(paginateUsers(USERS, 99)).toMatchObject({
      currentPage: 2,
      pageCount: 2,
      items: USERS.slice(2),
    });
  });

  it("normalizes support tags and validates only allowlisted edit fields", () => {
    expect(normalizeSupportTags(" VIP, onboarding, vip ")).toEqual(["VIP", "onboarding"]);
    expect(
      validateSupportDetails({
        displayName: "Maya Support",
        tagsInput: "VIP, onboarding",
        reason: "Correcting the support label.",
      }),
    ).toEqual({});
    expect(
      validateSupportDetails({
        displayName: "",
        tagsInput: "one, two, three, four, five, six",
        reason: "",
      }),
    ).toEqual({
      displayName: "Use a display name between 2 and 80 characters.",
      tagsInput: "Use no more than 5 support tags.",
      reason: "Explain the support reason in at least 8 characters.",
    });
  });

  it("appends support notes and preserves every prior note", () => {
    const first = {
      id: "note_1",
      body: "Existing note",
      author: "Founder",
      addedAt: "Yesterday",
    };

    const result = appendSupportNote([first], {
      id: "note_2",
      body: "  New support context  ",
      addedAt: "Just now",
    });

    expect(result).toEqual([
      first,
      {
        id: "note_2",
        body: "New support context",
        author: "Founder",
        addedAt: "Just now",
      },
    ]);
  });

  it("requires a reason and an exact registered email before scheduling deletion", () => {
    expect(
      validateWorkspaceDeletion({
        reason: "No",
        registeredEmail: "amy@example.com",
        typedEmail: "Amy@example.com",
      }),
    ).toEqual({
      reason: "Explain the admin reason in at least 8 characters.",
      typedEmail: "Type the registered email exactly to continue.",
    });
    expect(
      validateWorkspaceDeletion({
        reason: "Workspace closure requested.",
        registeredEmail: "amy@example.com",
        typedEmail: "amy@example.com",
      }),
    ).toEqual({});
  });

  it("changes account status by returning a new in-memory record", () => {
    const firstUser = USERS[0];
    if (!firstUser) throw new Error("Expected a user fixture.");
    const updated = updateUserStatus(firstUser, "Suspended");

    expect(updated.status).toBe("Suspended");
    expect(USERS[0]?.status).toBe("Needs attention");
  });
});
