import { describe, expect, it } from "vitest";

import {
  CLIENT_DETAIL_TAB_KEYS,
  isClientDetailTab,
  resolveClientDetailTab,
} from "../client-detail-tab-key";

// Pure-function unit test for the URL → ClientDetailTabKey resolver
// that powers the four-tab navigation on the client detail page
// (Overview / Projects / Payments / Notes & files).
//
// Pinned here so a future tab addition or rename either updates this
// test deliberately or trips it on commit. The resolver must accept
// Next.js's raw `searchParams.tab` shape — `string | string[] |
// undefined` — without throwing, since URL params are external input.

describe("CLIENT_DETAIL_TAB_KEYS", () => {
  it("declares the four tabs in display order", () => {
    expect(CLIENT_DETAIL_TAB_KEYS).toEqual([
      "overview",
      "projects",
      "payments",
      "notes",
    ]);
  });
});

describe("isClientDetailTab", () => {
  it.each(["overview", "projects", "payments", "notes"])(
    "accepts %s",
    (key) => {
      expect(isClientDetailTab(key)).toBe(true);
    },
  );

  it.each([undefined, "", "garbage", "OVERVIEW", " overview", "messages"])(
    "rejects %p",
    (key) => {
      expect(isClientDetailTab(key)).toBe(false);
    },
  );
});

describe("resolveClientDetailTab", () => {
  it.each([
    ["overview", "overview"],
    ["projects", "projects"],
    ["payments", "payments"],
    ["notes", "notes"],
  ])("returns %p when raw is %p", (raw, expected) => {
    expect(resolveClientDetailTab(raw)).toBe(expected);
  });

  it("defaults to overview for undefined", () => {
    expect(resolveClientDetailTab(undefined)).toBe("overview");
  });

  it("defaults to overview for unknown strings", () => {
    expect(resolveClientDetailTab("messages")).toBe("overview");
    expect(resolveClientDetailTab("")).toBe("overview");
  });

  it("uses the first array entry when Next.js delivers searchParams as string[]", () => {
    expect(resolveClientDetailTab(["projects", "payments"])).toBe("projects");
    expect(resolveClientDetailTab(["garbage", "payments"])).toBe("overview");
  });

  it("defaults to overview for an empty array", () => {
    expect(resolveClientDetailTab([])).toBe("overview");
  });
});
