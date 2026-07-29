import { describe, expect, it } from "vitest";

import {
  buildDashboardBreadcrumbs,
  calculateFloatingMenuPosition,
  createPaginationModel,
} from "./dashboard-interaction-model";

describe("dashboard interaction model", () => {
  it("builds an environment and section path without exposing a record ID", () => {
    expect(buildDashboardBreadcrumbs("/live/users/demo_live_user_1", "Maya Levi")).toEqual([
      { href: "/live", label: "Live" },
      { href: "/live/users", label: "Users" },
      { label: "Maya Levi" },
    ]);

    expect(buildDashboardBreadcrumbs("/live/users/demo_live_user_1")).toEqual([
      { href: "/live", label: "Live" },
      { label: "Users" },
    ]);
  });

  it("marks the current top-level page without a redundant link", () => {
    expect(buildDashboardBreadcrumbs("/test/payments")).toEqual([
      { href: "/test", label: "Test" },
      { label: "Payments" },
    ]);
    expect(buildDashboardBreadcrumbs("/live")).toEqual([{ label: "Live" }]);
  });

  it("keeps pagination within a useful five-page window", () => {
    expect(createPaginationModel({ currentPage: 6, pageSize: 10, totalItems: 118 })).toEqual({
      currentPage: 6,
      endItem: 60,
      pages: [4, 5, 6, 7, 8],
      startItem: 51,
      totalPages: 12,
    });
  });

  it("clamps invalid pagination values and handles empty results", () => {
    expect(createPaginationModel({ currentPage: 90, pageSize: 0, totalItems: 0 })).toEqual({
      currentPage: 1,
      endItem: 0,
      pages: [1],
      startItem: 0,
      totalPages: 1,
    });
  });

  it("positions a fixed action menu outside a scroll wrapper without leaving the viewport", () => {
    expect(
      calculateFloatingMenuPosition({
        menu: { height: 120, width: 192 },
        placement: "down",
        trigger: { bottom: 560, left: 1_100, right: 1_144, top: 516 },
        viewportHeight: 900,
        viewportWidth: 1_440,
      }),
    ).toEqual({ left: 952, top: 566 });

    expect(
      calculateFloatingMenuPosition({
        menu: { height: 120, width: 192 },
        placement: "up",
        trigger: { bottom: 635, left: 1_100, right: 1_144, top: 591 },
        viewportHeight: 640,
        viewportWidth: 1_440,
      }),
    ).toEqual({ left: 952, top: 465 });
  });

  it("flips and clamps a fixed action menu when its preferred edge cannot fit", () => {
    expect(
      calculateFloatingMenuPosition({
        menu: { height: 180, width: 224 },
        placement: "down",
        trigger: { bottom: 620, left: 8, right: 52, top: 576 },
        viewportHeight: 640,
        viewportWidth: 360,
      }),
    ).toEqual({ left: 16, top: 390 });
  });
});
